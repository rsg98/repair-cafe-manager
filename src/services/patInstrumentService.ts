/**
 * @file src/services/patInstrumentService.ts
 *
 * Pure validation & calibration calculation helpers and offline-resilient Cloud Firestore
 * CRUD operations for the PAT Testing Instrument Registry (`patInstruments/{instrumentId}`)
 * at Station 3 (Issue #27).
 *
 * Strictly adheres to the $0.00/month Firebase Free Tier guardrails by using a lightweight
 * one-time `getDocs` fetch on station unlock (backed by IndexedDB `persistentLocalCache`)
 * rather than attaching an `onSnapshot` collection listener.
 */

import {
  collection,
  doc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  deleteField
} from 'firebase/firestore';
import { db } from './firebase';
import { PatInstrument, PatInstrumentInput } from '../types';
import { cafeConfig } from '../config/cafe.config';
import { removeUndefined } from './repairService';

/**
 * Firestore top-level collection name storing registered PAT testing instruments.
 */
export const PAT_INSTRUMENTS_COLLECTION = 'patInstruments';

/**
 * Parses an ISO 8601 calendar date string (`YYYY-MM-DD`) and verifies that the year,
 * month, and day round-trip without JavaScript Date rollover (rejecting impossible
 * dates such as `2026-02-31` or `2025-02-29`).
 */
function parseStrictIsoCalendarDate(
  isoDateString: string
): { year: number; month: number; day: number; utcMs: number } | null {
  // Reject non-string values or strings that do not match the strict YYYY-MM-DD pattern
  const trimmed = (isoDateString || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return null;
  }

  // Split into numeric year, month (1..12), and day (1..31) components
  const [year, month, day] = trimmed.split('-').map(Number);
  const utcMs = Date.UTC(year, month - 1, day);
  const parsed = new Date(utcMs);

  // Verify calendar components did not overflow into the next month (e.g. Feb 31 -> Mar 3)
  if (
    Number.isNaN(utcMs) ||
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() + 1 !== month ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }

  // Return verified calendar components and UTC midnight timestamp
  return { year, month, day, utcMs };
}

/**
 * Validates a `PatInstrumentInput` payload prior to creating or updating a PAT instrument.
 * Enforces required fields, character length bounds matching `firestore.rules`, strict
 * `YYYY-MM-DD` calendar validity, and non-future calibration dates.
 */
export function validatePatInstrumentInput(
  input: PatInstrumentInput,
  referenceDate: Date = new Date()
): { valid: boolean; error?: string } {
  // Trim required and optional text fields prior to validation
  const displayName = (input.displayName || '').trim();
  const manufacturer = (input.manufacturer || '').trim();
  const serialNumber = (input.serialNumber || '').trim();
  const model = (input.model || '').trim();
  const notes = (input.notes || '').trim();

  // Validate required displayName presence and <= 100 char Firestore rule bound
  if (!displayName) {
    return { valid: false, error: 'Display name is required.' };
  }
  if (displayName.length > 100) {
    return { valid: false, error: 'Display name must be 100 characters or fewer.' };
  }

  // Validate required manufacturer presence and <= 100 char Firestore rule bound
  if (!manufacturer) {
    return { valid: false, error: 'Manufacturer is required.' };
  }
  if (manufacturer.length > 100) {
    return { valid: false, error: 'Manufacturer must be 100 characters or fewer.' };
  }

  // Validate required constant serialNumber presence and <= 100 char Firestore rule bound
  if (!serialNumber) {
    return { valid: false, error: 'Serial number is required.' };
  }
  if (serialNumber.length > 100) {
    return { valid: false, error: 'Serial number must be 100 characters or fewer.' };
  }

  // Validate optional model and notes character ceilings
  if (model.length > 100) {
    return { valid: false, error: 'Model must be 100 characters or fewer.' };
  }
  if (notes.length > 500) {
    return { valid: false, error: 'Notes must be 500 characters or fewer.' };
  }

  // Validate lastCalibratedDate is a real calendar date in YYYY-MM-DD format
  const parsedDate = parseStrictIsoCalendarDate(input.lastCalibratedDate);
  if (!parsedDate) {
    return {
      valid: false,
      error: 'Please enter a valid service/calibration date (YYYY-MM-DD).'
    };
  }

  // Compare against the reference date's local calendar date mapped to UTC midnight
  // to avoid British Summer Time (BST) or local timezone offset drift
  const refUtcMs = Date.UTC(
    referenceDate.getFullYear(),
    referenceDate.getMonth(),
    referenceDate.getDate()
  );
  if (parsedDate.utcMs > refUtcMs) {
    return {
      valid: false,
      error: 'Service/calibration date cannot be in the future.'
    };
  }

  // Input passed all domain and security rule validations
  return { valid: true };
}

/**
 * Checks whether a candidate `serialNumber` collides (case-insensitively after trimming)
 * with any existing PAT instrument in the registry, optionally excluding the instrument
 * currently being edited (`excludeId`).
 */
export function hasDuplicatePatInstrumentSerial(
  serialNumber: string,
  existingInstruments: ReadonlyArray<Pick<PatInstrument, 'id' | 'serialNumber'>>,
  excludeId?: string
): boolean {
  // Normalise candidate serial number for case-insensitive comparison
  const normalizedTarget = (serialNumber || '').trim().toLowerCase();
  if (!normalizedTarget) {
    return false;
  }

  // Check if any other registered instrument already uses the same hardware serial number
  return existingInstruments.some(
    (inst) =>
      inst.id !== excludeId &&
      (inst.serialNumber || '').trim().toLowerCase() === normalizedTarget
  );
}

/**
 * Determines whether a PAT instrument's `lastCalibratedDate` (`YYYY-MM-DD`) is strictly
 * older than `serviceIntervalMonths` calendar months relative to `referenceDate`.
 *
 * Clamps the target day to the last valid day of the due month so leap-year dates
 * (`2024-02-29` + 12m -> `2025-02-28`) and 31-day months never overflow into the next month.
 */
export function isPatInstrumentCalibrationOverdue(
  lastCalibratedDate: string,
  serviceIntervalMonths: number = cafeConfig.patTesterServiceIntervalMonths,
  referenceDate: Date = new Date()
): boolean {
  // Treat missing or malformed calibration dates as overdue so the volunteer is alerted
  const parsedDate = parseStrictIsoCalendarDate(lastCalibratedDate);
  if (!parsedDate) {
    return true;
  }

  // Calculate the target month index and clamp day to the end of the target month
  const { year, month, day } = parsedDate;
  const targetMonthIndex = month - 1 + serviceIntervalMonths;
  const lastDayOfTargetMonth = new Date(Date.UTC(year, targetMonthIndex + 1, 0)).getUTCDate();
  const clampedDay = Math.min(day, lastDayOfTargetMonth);

  // Compare reference local calendar date (at UTC midnight) against the clamped due date
  const dueUtcMs = Date.UTC(year, targetMonthIndex, clampedDay);
  const refUtcMs = Date.UTC(
    referenceDate.getFullYear(),
    referenceDate.getMonth(),
    referenceDate.getDate()
  );

  // Overdue only when the reference date is strictly past the calibration due date
  return refUtcMs > dueUtcMs;
}

/**
 * Formats the `<option>` label for a `PatInstrument` in the PAT Station dropdown.
 * Prefixes with `⚠️ ` and appends ` [Service Overdue]` when calibration is overdue.
 */
export function formatPatInstrumentOptionLabel(
  instrument: Pick<
    PatInstrument,
    'displayName' | 'manufacturer' | 'model' | 'serialNumber' | 'lastCalibratedDate'
  >,
  serviceIntervalMonths: number = cafeConfig.patTesterServiceIntervalMonths,
  referenceDate: Date = new Date()
): string {
  // Build the human-readable instrument description with manufacturer, optional model, and S/N
  const modelPart = instrument.model?.trim() ? ` ${instrument.model.trim()}` : '';
  const baseLabel = `${instrument.displayName} — ${instrument.manufacturer}${modelPart} (S/N: ${instrument.serialNumber})`;

  // Prefix with warning triangle and suffix with overdue tag if calibration has expired
  const overdue = isPatInstrumentCalibrationOverdue(
    instrument.lastCalibratedDate,
    serviceIntervalMonths,
    referenceDate
  );
  return overdue ? `⚠️ ${baseLabel} [Service Overdue]` : baseLabel;
}

/**
 * Awaits a Firestore write Promise (`setDoc`, `updateDoc`, `deleteDoc`) while ensuring
 * offline community venue resilience: when `navigator.onLine === false`, Firestore queues
 * the mutation synchronously into IndexedDB (`persistentLocalCache`) but only resolves the
 * returned Promise after server reconnect, so we race against a short timeout when offline.
 */
async function commitFirestoreWriteWithOfflineFallback(
  writePromise: Promise<void>,
  timeoutMs: number = 1500
): Promise<void> {
  // Online path: await the Firestore server acknowledgement normally
  const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
  if (!isOffline) {
    await writePromise;
    return;
  }

  // Offline path: allow local IndexedDB queueing to complete without blocking the modal UI
  await Promise.race([
    writePromise,
    new Promise<void>((resolve) => setTimeout(resolve, timeoutMs))
  ]);
}

/**
 * Fetches all registered PAT testing instruments via a one-time `getDocs` call,
 * sorted alphabetically by `displayName`.
 */
export async function listPatInstruments(): Promise<PatInstrument[]> {
  // Execute a one-time collection read (served from IndexedDB cache when available)
  const snap = await getDocs(collection(db, PAT_INSTRUMENTS_COLLECTION));
  const instruments: PatInstrument[] = snap.docs.map((d) => ({
    ...(d.data() as Omit<PatInstrument, 'id'>),
    id: d.id
  }));

  // Sort alphabetically by friendly displayName for predictable station selection
  return instruments.sort((a, b) => (a.displayName || '').localeCompare(b.displayName || ''));
}

/**
 * Validates and creates a new `PatInstrument` document in `patInstruments/{instrumentId}`.
 */
export async function createPatInstrument(
  input: PatInstrumentInput,
  existingInstruments: ReadonlyArray<Pick<PatInstrument, 'id' | 'serialNumber'>> = [],
  referenceDate: Date = new Date()
): Promise<PatInstrument> {
  // Validate input fields and calibration date
  const validation = validatePatInstrumentInput(input, referenceDate);
  if (!validation.valid) {
    throw new Error(validation.error || 'Invalid PAT instrument details.');
  }

  // Prevent duplicate hardware serial numbers across the café's PAT instrument registry
  if (hasDuplicatePatInstrumentSerial(input.serialNumber, existingInstruments)) {
    throw new Error(
      `A PAT instrument with serial number "${input.serialNumber.trim()}" is already registered.`
    );
  }

  // Construct normalised PatInstrument document with generated Firestore ID and timestamps
  const now = Date.now();
  const instrumentRef = doc(collection(db, PAT_INSTRUMENTS_COLLECTION));
  const record: PatInstrument = {
    id: instrumentRef.id,
    displayName: input.displayName.trim(),
    manufacturer: input.manufacturer.trim(),
    model: input.model?.trim() || undefined,
    serialNumber: input.serialNumber.trim(),
    lastCalibratedDate: input.lastCalibratedDate.trim(),
    notes: input.notes?.trim() || undefined,
    createdAt: now,
    updatedAt: now
  };

  // Persist to Firestore (with offline IndexedDB fallback) and return the saved record
  await commitFirestoreWriteWithOfflineFallback(
    setDoc(instrumentRef, removeUndefined(record))
  );
  return record;
}

/**
 * Validates and updates an existing `PatInstrument` document in `patInstruments/{id}`.
 * Preserves `createdAt` to satisfy `firestore.rules` immutability checks and uses
 * `deleteField()` when optional `model` or `notes` fields are cleared.
 */
export async function updatePatInstrument(
  id: string,
  input: PatInstrumentInput,
  options?: {
    existingCreatedAt?: number;
    existingInstruments?: ReadonlyArray<Pick<PatInstrument, 'id' | 'serialNumber'>>;
    referenceDate?: Date;
  }
): Promise<PatInstrument> {
  // Validate updated fields and calibration date
  const validation = validatePatInstrumentInput(input, options?.referenceDate);
  if (!validation.valid) {
    throw new Error(validation.error || 'Invalid PAT instrument details.');
  }

  // Reject serial number edits that collide with another registered instrument
  if (hasDuplicatePatInstrumentSerial(input.serialNumber, options?.existingInstruments || [], id)) {
    throw new Error(
      `Another PAT instrument with serial number "${input.serialNumber.trim()}" is already registered.`
    );
  }

  // Normalise trimmed strings and preserve original createdAt timestamp
  const now = Date.now();
  const createdAt = options?.existingCreatedAt ?? now;
  const trimmedModel = input.model?.trim() || undefined;
  const trimmedNotes = input.notes?.trim() || undefined;

  // Build Firestore update payload, explicitly deleting cleared optional fields
  const instrumentRef = doc(db, PAT_INSTRUMENTS_COLLECTION, id);
  const firestorePayload: Record<string, unknown> = {
    id,
    displayName: input.displayName.trim(),
    manufacturer: input.manufacturer.trim(),
    model: trimmedModel !== undefined ? trimmedModel : deleteField(),
    serialNumber: input.serialNumber.trim(),
    lastCalibratedDate: input.lastCalibratedDate.trim(),
    notes: trimmedNotes !== undefined ? trimmedNotes : deleteField(),
    createdAt,
    updatedAt: now
  };

  // Commit update and return the clean in-memory PatInstrument representation
  await commitFirestoreWriteWithOfflineFallback(updateDoc(instrumentRef, firestorePayload));
  return {
    id,
    displayName: input.displayName.trim(),
    manufacturer: input.manufacturer.trim(),
    model: trimmedModel,
    serialNumber: input.serialNumber.trim(),
    lastCalibratedDate: input.lastCalibratedDate.trim(),
    notes: trimmedNotes,
    createdAt,
    updatedAt: now
  };
}

/**
 * Deletes a retired PAT testing instrument from `patInstruments/{id}`.
 * Historical `RepairItem` records retain their immutable `instrumentSerial` string.
 */
export async function deletePatInstrument(id: string): Promise<void> {
  // Delete the instrument document from Firestore (or queue deletion in IndexedDB when offline)
  const instrumentRef = doc(db, PAT_INSTRUMENTS_COLLECTION, id);
  await commitFirestoreWriteWithOfflineFallback(deleteDoc(instrumentRef));
}
