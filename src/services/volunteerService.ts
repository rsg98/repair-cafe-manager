import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
} from 'firebase/firestore';
import { db } from './firebase';
import { Volunteer, SessionVolunteerSummary, Session } from '../types';
import { cafeConfig } from '../config/cafe.config';
import { removeUndefined } from './repairService';
import {
  APP_BUILD_TIMESTAMP,
  APP_VERSION,
  shouldPublishAppVersion,
} from './pwaUpdateService';

/**
 * Input payload for creating or validating a Volunteer Register entry.
 */
export interface VolunteerInput {
  name: string;
  phone?: string;
  email?: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  emergencyContactRelationship?: string;
  isOrganiser: boolean;
  isPatTrained: boolean;
  inducted: boolean;
  inductedAt?: number;
  inductedBy?: string;
}

/**
 * Validates mandatory fields for a volunteer record, including the rule that
 * any volunteer flagged as an Organiser (`isOrganiser: true`) must supply a valid email.
 */
export function validateVolunteerInput(input: VolunteerInput): {
  valid: boolean;
  error?: string;
} {
  // Ensure volunteer full name is present
  if (!input.name || !input.name.trim()) {
    return { valid: false, error: 'Volunteer name is required.' };
  }

  // Ensure emergency contact name and phone number are provided for safety compliance
  if (!input.emergencyContactName || !input.emergencyContactName.trim()) {
    return { valid: false, error: 'Emergency contact name is required.' };
  }
  if (!input.emergencyContactPhone || !input.emergencyContactPhone.trim()) {
    return { valid: false, error: 'Emergency contact phone number is required.' };
  }

  // Ensure emergency contact is another person, not the volunteer themselves
  if (
    input.emergencyContactName.trim().toLowerCase() ===
    input.name.trim().toLowerCase()
  ) {
    return {
      valid: false,
      error: 'Emergency contact must be another person, not the volunteer themselves.',
    };
  }

  // Normalize phone strings to ensure the emergency phone differs from the volunteer's own phone
  const normalizedVolunteerPhone = (input.phone || '').replace(/[\s\-()]/g, '');
  const normalizedEmergencyPhone = input.emergencyContactPhone.replace(
    /[\s\-()]/g,
    ''
  );
  if (
    normalizedVolunteerPhone &&
    normalizedVolunteerPhone === normalizedEmergencyPhone
  ) {
    return {
      valid: false,
      error:
        'Emergency contact phone number must be different from the volunteer phone number.',
    };
  }

  // Organisers require a Google-compatible email address for Front Desk sign-in authorization
  const trimmedEmail = (input.email || '').trim();
  if (input.isOrganiser) {
    if (!trimmedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      return {
        valid: false,
        error:
          'Email address is required when marking a volunteer as an Organiser.',
      };
    }
  } else if (trimmedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
    // If an optional email is supplied for a non-organiser, verify basic format
    return { valid: false, error: 'Please enter a valid email address.' };
  }

  return { valid: true };
}

/**
 * Checks whether a volunteer name already exists in the register (case-insensitive),
 * ignoring archived records and optionally excluding a specific volunteer ID when editing.
 */
export function hasDuplicateVolunteerName(
  name: string,
  existingVolunteers: ReadonlyArray<Pick<Volunteer, 'id' | 'name'> & { archived?: boolean }>,
  excludeId?: string
): boolean {
  const normalized = name.trim().toLowerCase();
  if (!normalized) return false;

  // Match against active volunteers while ignoring archived records and the record being updated
  return existingVolunteers.some(
    (v) =>
      v.id !== excludeId &&
      !v.archived &&
      v.name.trim().toLowerCase() === normalized
  );
}

/**
 * Formats a volunteer's full name to First-name and Initial of Surname only
 * (e.g. "Alice Smith" -> "Alice S") for UK GDPR compliance when archiving.
 */
export function formatArchivedVolunteerName(fullName: string): string {
  const parts = (fullName || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0];

  const firstName = parts[0];
  const surname = parts[parts.length - 1];
  const letterMatch = surname.match(/[A-Za-zÀ-ÖØ-öø-ÿ]/);
  const surnameInitial = (
    letterMatch ? letterMatch[0] : surname.charAt(0)
  ).toUpperCase();

  return surnameInitial ? `${firstName} ${surnameInitial}` : firstName;
}

/**
 * Evaluates whether a volunteer record is eligible to be archived.
 * Volunteers enabled as an organiser (`isOrganiser: true`) cannot be archived
 * until their organiser flag has been removed.
 */
export function canArchiveVolunteer(
  volunteer: Pick<Volunteer, 'isOrganiser' | 'archived'>
): { allowed: boolean; reason?: string } {
  if (volunteer.archived) {
    return {
      allowed: false,
      reason: 'This volunteer is already archived.',
    };
  }
  if (volunteer.isOrganiser) {
    return {
      allowed: false,
      reason:
        'Cannot archive a volunteer who is enabled as an organiser. Please remove the Organiser role from this volunteer before archiving.',
    };
  }
  return { allowed: true };
}

/**
 * Verifies that the confirmation text entered by the Front Desk organiser matches
 * the volunteer's full name (case-insensitive, whitespace-normalised).
 */
export function validateArchiveConfirmationName(
  expectedFullName: string,
  confirmationInput: string
): boolean {
  const expected = (expectedFullName || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
  const actual = (confirmationInput || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
  if (!expected || !actual) return false;
  return expected === actual;
}

/**
 * Pure helper that transforms a `Volunteer` record into its GDPR-archived form:
 * - Alters `name` to First-name and Initial of Surname only
 * - Removes `phone`, `email`, and all emergency contact details
 * - Sets `archived: true` and `archivedAt` while preserving `id` and historical metadata
 */
export function buildArchivedVolunteerRecord(
  volunteer: Volunteer,
  now: number = Date.now()
): Volunteer {
  const check = canArchiveVolunteer(volunteer);
  if (!check.allowed) {
    throw new Error(check.reason);
  }

  return removeUndefined({
    id: volunteer.id,
    name: formatArchivedVolunteerName(volunteer.name),
    emergencyContactName: '',
    emergencyContactPhone: '',
    isOrganiser: false,
    isPatTrained: Boolean(volunteer.isPatTrained),
    inducted: Boolean(volunteer.inducted),
    inductedAt: volunteer.inductedAt,
    inductedBy: volunteer.inductedBy,
    archived: true,
    archivedAt: now,
    createdAt: volunteer.createdAt,
    updatedAt: now,
  });
}

/**
 * Filters a list of volunteers to only active (non-archived) records.
 * Used by default in the Volunteer Register and when starting or editing a live session.
 */
export function filterActiveVolunteers<T extends { archived?: boolean }>(
  volunteers: ReadonlyArray<T>
): T[] {
  return volunteers.filter((v) => !v.archived);
}

/**
 * Projects a full `Volunteer` document down to a non-PII `SessionVolunteerSummary`
 * safe for embedding on public/volunteer-readable `Session` documents.
 */
export function toSessionVolunteerSummary(
  volunteer: Pick<
    Volunteer,
    'id' | 'name' | 'isOrganiser' | 'isPatTrained' | 'inducted'
  >
): SessionVolunteerSummary {
  // Strip contact phone, email, and emergency contact details before storing on Session
  return {
    id: volunteer.id,
    name: volunteer.name.trim(),
    isOrganiser: Boolean(volunteer.isOrganiser),
    isPatTrained: Boolean(volunteer.isPatTrained),
    inducted: Boolean(volunteer.inducted),
  };
}

/**
 * Merges static `cafeConfig.organizerEmails` with the email addresses of all active volunteers
 * who have `isOrganiser: true`, returning a deduplicated, normalized array.
 */
export function mergeOrganiserEmails(
  staticEmails: string[],
  volunteers: Array<Pick<Volunteer, 'isOrganiser' | 'email'> & { archived?: boolean }>
): string[] {
  const emailSet = new Set<string>();

  // Seed with static bootstrap organiser emails and domain rules from cafeConfig
  for (const entry of staticEmails) {
    const cleaned = entry.trim().toLowerCase();
    if (cleaned) {
      emailSet.add(cleaned);
    }
  }

  // Add normalized emails for all active volunteers currently marked as organisers
  for (const volunteer of volunteers) {
    if (volunteer.isOrganiser && !volunteer.archived && volunteer.email) {
      const cleaned = volunteer.email.trim().toLowerCase();
      if (cleaned) {
        emailSet.add(cleaned);
      }
    }
  }

  return Array.from(emailSet);
}

/**
 * Filters a session's attending volunteers to only those who are PAT trained (`isPatTrained: true`),
 * sorted alphabetically by name for the PAT Station dropdown.
 */
export function getQualifiedPatTesters(
  attendingVolunteers: SessionVolunteerSummary[] = []
): SessionVolunteerSummary[] {
  // Clone, filter to PAT-qualified attendees, and sort alphabetically
  return [...attendingVolunteers]
    .filter((v) => v.isPatTrained === true)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Normalises a raw Firestore document from `volunteers/{volunteerId}` into a typed `Volunteer`
 * object, defaulting omitted emergency contact fields (e.g. on archived records) to empty strings.
 */
function normalizeVolunteerDoc(
  id: string,
  raw: Partial<Volunteer>
): Volunteer {
  return {
    ...(raw as Omit<Volunteer, 'id'>),
    id,
    name: raw.name || '',
    emergencyContactName: raw.emergencyContactName ?? '',
    emergencyContactPhone: raw.emergencyContactPhone ?? '',
    isOrganiser: Boolean(raw.isOrganiser),
    isPatTrained: Boolean(raw.isPatTrained),
    inducted: Boolean(raw.inducted),
    createdAt: raw.createdAt ?? 0,
    updatedAt: raw.updatedAt ?? 0,
  };
}

/**
 * Fetches all volunteers from the `volunteers` collection, sorted alphabetically by name.
 */
export async function listVolunteers(): Promise<Volunteer[]> {
  const volunteersRef = collection(db, 'volunteers');
  const snap = await getDocs(volunteersRef);

  // Map Firestore documents to typed Volunteer objects and sort by name
  const volunteers = snap.docs.map((d) =>
    normalizeVolunteerDoc(d.id, d.data() as Partial<Volunteer>)
  );
  return volunteers.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Point-reads a single volunteer document from `volunteers/{volunteerId}`
 * (used when opening an emergency contact card from the active session banner).
 */
export async function getVolunteerById(
  volunteerId: string
): Promise<Volunteer | null> {
  const volunteerRef = doc(db, 'volunteers', volunteerId);
  const snap = await getDoc(volunteerRef);
  if (!snap.exists()) return null;

  // Return the hydrated Volunteer record with its document ID
  return normalizeVolunteerDoc(snap.id, snap.data() as Partial<Volunteer>);
}

/**
 * Computes the merged list of static + dynamic organiser emails and persists it
 * to `settings/system.organizerEmails` so newly designated organisers can sign in.
 */
export async function syncOrganiserEmailsToSystemSettings(
  providedVolunteers?: Volunteer[]
): Promise<string[]> {
  // Load current volunteers from Firestore if not already provided by the caller
  const volunteers = providedVolunteers ?? (await listVolunteers());
  const mergedEmails = mergeOrganiserEmails(cafeConfig.organizerEmails, volunteers);

  // Persist merged organiser email list (and production build version metadata) to settings/system with merge: true
  const settingsRef = doc(db, 'settings', 'system');
  const includeVersionStamp = shouldPublishAppVersion(
    APP_VERSION,
    APP_BUILD_TIMESTAMP,
    null
  );
  await setDoc(
    settingsRef,
    {
      organizerEmails: mergedEmails,
      updatedAt: Date.now(),
      ...(includeVersionStamp
        ? {
            deployedVersion: APP_VERSION,
            deployedBuildTimestamp: APP_BUILD_TIMESTAMP,
          }
        : {}),
    },
    { merge: true }
  );

  return mergedEmails;
}

/**
 * Creates a new volunteer in `volunteers/{volunteerId}` after validating inputs and duplicate names,
 * then synchronizes `settings/system.organizerEmails`.
 */
export async function createVolunteer(input: VolunteerInput): Promise<Volunteer> {
  // Validate mandatory fields and organiser email requirement
  const validation = validateVolunteerInput(input);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  // Enforce unique case-insensitive volunteer names across the register
  const existing = await listVolunteers();
  if (hasDuplicateVolunteerName(input.name, existing)) {
    throw new Error(`A volunteer named "${input.name.trim()}" is already on the register.`);
  }

  // Generate timestamp and target document reference in `volunteers` collection
  const now = Date.now();
  const volunteerRef = doc(collection(db, 'volunteers'));

  // Build sanitized volunteer document payload with contact and role flags
  const newVolunteer: Volunteer = removeUndefined({
    id: volunteerRef.id,
    name: input.name.trim(),
    phone: input.phone?.trim() || undefined,
    email: input.email?.trim().toLowerCase() || undefined,
    emergencyContactName: input.emergencyContactName.trim(),
    emergencyContactPhone: input.emergencyContactPhone.trim(),
    emergencyContactRelationship:
      input.emergencyContactRelationship?.trim() || undefined,
    // Populate role flags and induction metadata
    isOrganiser: Boolean(input.isOrganiser),
    isPatTrained: Boolean(input.isPatTrained),
    inducted: Boolean(input.inducted),
    inductedAt: input.inducted ? input.inductedAt || now : undefined,
    inductedBy: input.inducted ? input.inductedBy?.trim() || undefined : undefined,
    createdAt: now,
    updatedAt: now,
  });

  // Save document and update dynamic organiser emails if needed
  await setDoc(volunteerRef, newVolunteer);
  await syncOrganiserEmailsToSystemSettings([...existing, newVolunteer]);

  return newVolunteer;
}

/**
 * Updates an existing volunteer record in `volunteers/{volunteerId}`, synchronizes
 * `settings/system.organizerEmails`, and refreshes the active session's `attendingVolunteers`
 * summary if the volunteer is currently marked as attending.
 */
export async function updateVolunteer(
  volunteerId: string,
  input: VolunteerInput,
  activeSessionId?: string | null
): Promise<Volunteer> {
  // Validate mandatory fields and organiser email requirement
  const validation = validateVolunteerInput(input);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  // Verify the volunteer exists and check for duplicate names against other records
  const existing = await listVolunteers();
  const currentRecord = existing.find((v) => v.id === volunteerId);
  if (!currentRecord) {
    throw new Error('Volunteer record not found.');
  }
  if (hasDuplicateVolunteerName(input.name, existing, volunteerId)) {
    throw new Error(`A volunteer named "${input.name.trim()}" is already on the register.`);
  }

  // Build updated volunteer payload preserving original creation and induction timestamps
  const now = Date.now();
  const updatedVolunteer: Volunteer = removeUndefined({
    id: volunteerId,
    name: input.name.trim(),
    phone: input.phone?.trim() || undefined,
    email: input.email?.trim().toLowerCase() || undefined,
    emergencyContactName: input.emergencyContactName.trim(),
    emergencyContactPhone: input.emergencyContactPhone.trim(),
    emergencyContactRelationship:
      input.emergencyContactRelationship?.trim() || undefined,
    // Update role flags and preserve prior induction metadata when remaining inducted
    isOrganiser: Boolean(input.isOrganiser),
    isPatTrained: Boolean(input.isPatTrained),
    inducted: Boolean(input.inducted),
    inductedAt: input.inducted
      ? currentRecord.inductedAt || input.inductedAt || now
      : undefined,
    inductedBy: input.inducted
      ? input.inductedBy?.trim() || currentRecord.inductedBy || undefined
      : undefined,
    createdAt: currentRecord.createdAt,
    updatedAt: now,
  });

  // Overwrite document cleanly so cleared optional fields are removed
  const volunteerRef = doc(db, 'volunteers', volunteerId);
  await setDoc(volunteerRef, updatedVolunteer);

  // Sync updated organiser email list to settings/system
  const updatedList = existing.map((v) =>
    v.id === volunteerId ? updatedVolunteer : v
  );
  await syncOrganiserEmailsToSystemSettings(updatedList);

  // If there is an active session where this volunteer is attending, keep summary in sync
  if (activeSessionId) {
    await refreshVolunteerInActiveSession(activeSessionId, updatedVolunteer);
  }

  return updatedVolunteer;
}

/**
 * Archives a volunteer in `volunteers/{volunteerId}` in compliance with UK GDPR:
 * - Prevents archival if `isOrganiser` is true until the organiser flag is removed
 * - Requires the organiser to confirm by entering the volunteer's full name
 * - Alters `name` to First-name and Initial of Surname only
 * - Removes emergency contact information, email address, and phone number from the database
 * - Preserves the document ID so completed repairs and historical session volunteer counts remain accurate
 * - Removes the volunteer from any currently active live session attendance
 */
export async function archiveVolunteer(
  volunteerId: string,
  confirmationName: string,
  activeSessionId?: string | null
): Promise<Volunteer> {
  const currentRecord = await getVolunteerById(volunteerId);
  if (!currentRecord) {
    throw new Error('Volunteer record not found.');
  }

  // Enforce organiser archival guard
  const eligibility = canArchiveVolunteer(currentRecord);
  if (!eligibility.allowed) {
    throw new Error(eligibility.reason);
  }

  // Verify full-name confirmation matches before redacting PII
  if (!validateArchiveConfirmationName(currentRecord.name, confirmationName)) {
    throw new Error(
      `Confirmation name does not match "${currentRecord.name}". Please enter the volunteer's full name.`
    );
  }

  const archivedRecord = buildArchivedVolunteerRecord(currentRecord, Date.now());

  // Build Firestore document omitting emergency contact, email, and phone fields entirely
  const {
    emergencyContactName: _omitEmergencyName,
    emergencyContactPhone: _omitEmergencyPhone,
    emergencyContactRelationship: _omitEmergencyRel,
    phone: _omitPhone,
    email: _omitEmail,
    ...firestorePayload
  } = archivedRecord;
  void _omitEmergencyName;
  void _omitEmergencyPhone;
  void _omitEmergencyRel;
  void _omitPhone;
  void _omitEmail;

  const volunteerRef = doc(db, 'volunteers', volunteerId);
  await setDoc(volunteerRef, removeUndefined(firestorePayload));

  // Remove the archived volunteer from the active live session's attendance roster if present
  if (activeSessionId) {
    const sessionRef = doc(db, 'sessions', activeSessionId);
    const sessionSnap = await getDoc(sessionRef);
    if (sessionSnap.exists()) {
      const sessionData = sessionSnap.data() as Session;
      const currentSummaries = sessionData.attendingVolunteers || [];
      if (currentSummaries.some((s) => s.id === volunteerId)) {
        const nextSummaries = currentSummaries.filter((s) => s.id !== volunteerId);
        await updateDoc(sessionRef, {
          attendingVolunteerIds: nextSummaries.map((s) => s.id),
          attendingVolunteers: nextSummaries,
        });
      }
    }
  }

  return archivedRecord;
}

/**
 * Restores an archived volunteer record to active status once their full name and
 * mandatory emergency contact details have been re-entered by an organiser.
 */
export async function restoreVolunteer(
  volunteerId: string,
  input: VolunteerInput,
  activeSessionId?: string | null
): Promise<Volunteer> {
  return updateVolunteer(volunteerId, input, activeSessionId);
}

/**
 * Deletes a volunteer from `volunteers/{volunteerId}`, re-syncs `settings/system.organizerEmails`,
 * and removes them from the active session's attendance roster if currently checked in.
 */
export async function deleteVolunteer(
  volunteerId: string,
  activeSessionId?: string | null
): Promise<void> {
  // Delete the volunteer document from Firestore
  const volunteerRef = doc(db, 'volunteers', volunteerId);
  await deleteDoc(volunteerRef);

  // Re-sync system organiser emails so removed organiser emails are revoked
  await syncOrganiserEmailsToSystemSettings();

  // Remove the deleted volunteer from the active session's attendance arrays if present
  if (activeSessionId) {
    const sessionRef = doc(db, 'sessions', activeSessionId);
    const sessionSnap = await getDoc(sessionRef);
    if (sessionSnap.exists()) {
      const sessionData = sessionSnap.data() as Session;
      const currentSummaries = sessionData.attendingVolunteers || [];
      // Only write to the session document if the deleted volunteer was listed as attending
      if (currentSummaries.some((s) => s.id === volunteerId)) {
        const nextSummaries = currentSummaries.filter((s) => s.id !== volunteerId);
        await updateDoc(sessionRef, {
          attendingVolunteerIds: nextSummaries.map((s) => s.id),
          attendingVolunteers: nextSummaries,
        });
      }
    }
  }
}

/**
 * Marks a volunteer as inducted (`inducted: true`, `inductedAt`, `inductedBy`) and
 * updates their summary inside the active session's `attendingVolunteers` array if present.
 */
export async function markVolunteerInducted(
  volunteerId: string,
  inductedBy: string,
  activeSessionId?: string | null
): Promise<void> {
  const now = Date.now();
  const volunteerRef = doc(db, 'volunteers', volunteerId);

  // Update induction fields on the Volunteer Register record
  await updateDoc(
    volunteerRef,
    removeUndefined({
      inducted: true,
      inductedAt: now,
      inductedBy: inductedBy.trim() || 'Organiser',
      updatedAt: now,
    })
  );

  // Also update the embedded summary on the active session without an extra volunteer read
  if (activeSessionId) {
    const sessionRef = doc(db, 'sessions', activeSessionId);
    const sessionSnap = await getDoc(sessionRef);
    if (sessionSnap.exists()) {
      const sessionData = sessionSnap.data() as Session;
      const currentSummaries = sessionData.attendingVolunteers || [];
      // Flip `inducted: true` on the matching attending volunteer entry if present
      if (currentSummaries.some((s) => s.id === volunteerId)) {
        const nextSummaries = currentSummaries.map((s) =>
          s.id === volunteerId ? { ...s, inducted: true } : s
        );
        await updateDoc(sessionRef, {
          attendingVolunteers: nextSummaries,
        });
      }
    }
  }
}

/**
 * Updates the list of attending volunteers on a running or newly created session.
 */
export async function updateSessionAttendance(
  sessionId: string,
  selectedVolunteers: Array<
    Pick<Volunteer, 'id' | 'name' | 'isOrganiser' | 'isPatTrained' | 'inducted'>
  >
): Promise<SessionVolunteerSummary[]> {
  // Project selected volunteers to non-PII summaries sorted alphabetically
  const summaries = selectedVolunteers
    .map((v) => toSessionVolunteerSummary(v))
    .sort((a, b) => a.name.localeCompare(b.name));
  const ids = summaries.map((s) => s.id);

  // Persist both ID list and summary objects on the Session document
  const sessionRef = doc(db, 'sessions', sessionId);
  await updateDoc(sessionRef, {
    attendingVolunteerIds: ids,
    attendingVolunteers: summaries,
  });

  return summaries;
}

/**
 * Internal helper that updates a single volunteer's summary entry inside an active session
 * if they are currently listed in `session.attendingVolunteers`.
 */
async function refreshVolunteerInActiveSession(
  sessionId: string,
  updatedVolunteer: Volunteer
): Promise<void> {
  const sessionRef = doc(db, 'sessions', sessionId);
  const sessionSnap = await getDoc(sessionRef);
  if (!sessionSnap.exists()) return;

  // Check if the modified volunteer is currently attending the session
  const sessionData = sessionSnap.data() as Session;
  const currentSummaries = sessionData.attendingVolunteers || [];
  if (!currentSummaries.some((s) => s.id === updatedVolunteer.id)) {
    return;
  }

  // Replace the stale summary entry and sort alphabetically
  const nextSummaries = currentSummaries
    .map((s) =>
      s.id === updatedVolunteer.id ? toSessionVolunteerSummary(updatedVolunteer) : s
    )
    .sort((a, b) => a.name.localeCompare(b.name));

  // Persist refreshed summaries and IDs to the active session document
  await updateDoc(sessionRef, {
    attendingVolunteerIds: nextSummaries.map((s) => s.id),
    attendingVolunteers: nextSummaries,
  });
}
