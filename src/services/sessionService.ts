/**
 * @file src/services/sessionService.ts
 *
 * Session lifecycle management service: session creation (`createSession`),
 * analytics aggregation (`calculateSessionAnalytics`), GDPR finalization
 * (`finalizeSessionClient` / `finalizeSessionDirectly`), test-session
 * classification (`setSessionTestStatus`), and cascading test-session purge
 * (`purgeSessionCascading`).
 */

import {
  doc,
  getDoc,
  setDoc,
  collection,
  getDocs,
  writeBatch,
  deleteField,
  terminate,
  clearIndexedDbPersistence,
  DocumentReference,
  QueryDocumentSnapshot,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions, auth } from './firebase';
import {
  Session,
  SystemSettings,
  RepairItem,
  SessionAnalytics,
  SessionVolunteerSummary,
} from '../types';
import { cafeConfig } from '../config/cafe.config';
import { isAuthorizedOrganizer } from '../utils/authUtils';
import { removeUndefined } from './repairService';
import {
  APP_BUILD_TIMESTAMP,
  APP_VERSION,
  shouldPublishAppVersion,
} from './pwaUpdateService';

/**
 * Helper that reads existing `settings/system` once and returns both merged
 * `organizerEmails` and the raw `SystemSettings` snapshot.
 */
async function getSystemSettingsWithEmails(): Promise<{
  effectiveEmails: string[];
  settings: SystemSettings | null;
}> {
  try {
    // Load the global system settings document from Firestore
    const settingsRef = doc(db, 'settings', 'system');
    const snap = await getDoc(settingsRef);
    if (snap.exists()) {
      const data = snap.data() as SystemSettings;
      // Merge static config emails with dynamically configured organiser emails
      const effectiveEmails = Array.isArray(data.organizerEmails)
        ? Array.from(new Set([...cafeConfig.organizerEmails, ...data.organizerEmails]))
        : [...cafeConfig.organizerEmails];
      return { effectiveEmails, settings: data };
    }
  } catch (err) {
    console.warn('Could not read existing organizerEmails from settings/system:', err);
  }
  // Fall back to static cafeConfig organiser emails if settings/system is unreadable
  return { effectiveEmails: [...cafeConfig.organizerEmails], settings: null };
}

/**
 * Helper that reads existing `settings/system.organizerEmails` and merges them with
 * static `cafeConfig.organizerEmails` so dynamic volunteer organisers are never overwritten.
 */
async function getEffectiveOrganizerEmails(): Promise<string[]> {
  // Delegate to getSystemSettingsWithEmails and return only the merged email list
  const { effectiveEmails } = await getSystemSettingsWithEmails();
  return effectiveEmails;
}

/**
 * Publishes the running client's compile-time `APP_VERSION` and `APP_BUILD_TIMESTAMP`
 * to `settings/system` when an authenticated organiser opens a newly deployed build.
 * Consumes zero extra reads by accepting the `currentSettings` already received via `useActiveSession()`.
 */
export async function publishAppVersionToSystemSettings(
  currentSettings?: SystemSettings | null
): Promise<boolean> {
  // Skip write if the current build is not newer than what is already recorded in Firestore
  if (!shouldPublishAppVersion(APP_VERSION, APP_BUILD_TIMESTAMP, currentSettings)) {
    return false;
  }

  try {
    // Merge the new deployed version and build timestamp into settings/system
    const settingsRef = doc(db, 'settings', 'system');
    await setDoc(
      settingsRef,
      {
        deployedVersion: APP_VERSION,
        deployedBuildTimestamp: APP_BUILD_TIMESTAMP,
        updatedAt: Date.now(),
      },
      { merge: true }
    );
    return true;
  } catch (err) {
    console.warn('Could not publish app version to settings/system:', err);
    return false;
  }
}

/**
 * Hashes a 4-digit PIN using SHA-256 for secure comparison.
 */
export async function hashPin(pin: string): Promise<string> {
  // Encode trimmed PIN string into a UTF-8 byte buffer and compute its SHA-256 digest
  const encoder = new TextEncoder();
  const data = encoder.encode(pin.trim());
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Retrieves the currently active session (if any).
 */
export async function getActiveSession(): Promise<Session | null> {
  // Fetch the active session pointer from settings/system
  const settingsRef = doc(db, 'settings', 'system');
  const settingsSnap = await getDoc(settingsRef);

  if (!settingsSnap.exists()) return null;
  const settings = settingsSnap.data() as SystemSettings;
  if (!settings.activeSessionId) return null;

  // Load the referenced active session document
  const sessionRef = doc(db, 'sessions', settings.activeSessionId);
  const sessionSnap = await getDoc(sessionRef);
  if (!sessionSnap.exists()) return null;

  return sessionSnap.data() as Session;
}

/**
 * Updates `settings/system` to activate the newly created session while preserving
 * dynamic `organizerEmails` and stamping the current app build if newer.
 */
async function activateSessionInSystemSettings(sessionId: string): Promise<void> {
  // Read existing system settings so dynamic organiser emails are preserved
  const { effectiveEmails, settings } = await getSystemSettingsWithEmails();
  const includeVersionStamp = shouldPublishAppVersion(
    APP_VERSION,
    APP_BUILD_TIMESTAMP,
    settings
  );

  // Merge activeSessionId, allowRegistration, and optional build version into settings/system
  const settingsRef = doc(db, 'settings', 'system');
  await setDoc(
    settingsRef,
    {
      activeSessionId: sessionId,
      allowRegistration: true,
      cafeName: cafeConfig.cafeName,
      organizerEmails: effectiveEmails,
      // Optionally stamp the current build version and timestamp if newer
      ...(includeVersionStamp
        ? {
            deployedVersion: APP_VERSION,
            deployedBuildTimestamp: APP_BUILD_TIMESTAMP,
          }
        : {}),
    },
    { merge: true }
  );
}

/**
 * Creates and starts a new Repair Café session, including any initial attending volunteers
 * and optional `isTest` rehearsal/training flag (Issue #24).
 */
export async function createSession(params: {
  id: string;
  name: string;
  date: string;
  volunteerPin: string;
  cardRangeStart: number;
  cardRangeEnd: number;
  attendingVolunteers?: SessionVolunteerSummary[];
  isTest?: boolean;
}): Promise<Session> {
  // Hash the daily volunteer PIN and sort attending volunteers alphabetically
  const volunteerPinHash = await hashPin(params.volunteerPin);
  const summaries = [...(params.attendingVolunteers || [])].sort((a, b) =>
    a.name.localeCompare(b.name)
  );
  const attendingVolunteerIds = summaries.map((v) => v.id);

  // Build the Session document payload including the normalized boolean isTest flag
  const sessionData: Session = removeUndefined({
    id: params.id,
    name: params.name,
    date: params.date,
    status: 'ACTIVE',
    isTest: Boolean(params.isTest),
    volunteerPinHash,
    cardRangeStart: params.cardRangeStart,
    // Store card range upper bound, volunteer roster, and creation timestamp
    cardRangeEnd: params.cardRangeEnd,
    attendingVolunteerIds,
    attendingVolunteers: summaries,
    createdAt: Date.now(),
  });

  // Persist the session document and activate it in settings/system
  await setDoc(doc(db, 'sessions', params.id), sessionData);
  await activateSessionInSystemSettings(params.id);
  return sessionData;
}

/**
 * Lists past and present sessions.
 */
export async function listSessions(): Promise<Session[]> {
  // Fetch all documents in the top-level sessions collection
  const sessionsRef = collection(db, 'sessions');
  const snap = await getDocs(sessionsRef);
  return snap.docs.map((d) => d.data() as Session);
}

/** Mutable accumulator used while tallying repair items in {@link calculateSessionAnalytics}. */
interface AnalyticsAccumulator {
  totalItems: number;
  repairedCount: number;
  partialCount: number;
  unfixableCount: number;
  adviceCount: number;
  takenHomeCount: number;
  totalRepairTimeMinutes: number;
  totalWeightKg: number;
  mainsCount: number;
  patTestedCount: number;
  patFailedCount: number;
  categoryBreakdown: Record<string, number>;
}

/**
 * Tallies a single {@link RepairItem} into an {@link AnalyticsAccumulator}.
 */
function tallyRepairItemForAnalytics(acc: AnalyticsAccumulator, item: RepairItem): void {
  // Increment total item counter and category histogram
  acc.totalItems++;
  const cat = item.item?.category || 'OTHER';
  acc.categoryBreakdown[cat] = (acc.categoryBreakdown[cat] || 0) + 1;

  // Count 240V mains-powered items and accumulate valid item weight in kg
  if (item.item?.powerType === 'MAINS_240V') {
    acc.mainsCount++;
  }
  if (item.item?.weightKg && typeof item.item.weightKg === 'number' && !Number.isNaN(item.item.weightKg)) {
    acc.totalWeightKg += item.item.weightKg;
  }

  // Tally fixer repair time and repair outcome disposition
  if (item.repair) {
    if (item.repair.repairTimeMinutes && typeof item.repair.repairTimeMinutes === 'number') {
      acc.totalRepairTimeMinutes += item.repair.repairTimeMinutes;
    }
    // Increment the outcome counter matching the fixer's logged disposition
    if (item.repair.outcome === 'FIXED') acc.repairedCount++;
    else if (item.repair.outcome === 'PARTIAL') acc.partialCount++;
    else if (item.repair.outcome === 'UNFIXABLE') acc.unfixableCount++;
    else if (item.repair.outcome === 'ADVICE_GIVEN') acc.adviceCount++;
    else if (item.repair.outcome === 'TAKEN_HOME') acc.takenHomeCount++;
  } else if (item.status === 'UNFIXABLE') {
    // Include items quarantined at PAT 1 as unfixable
    acc.unfixableCount++;
  }

  // Tally PAT electrical safety tests (PAT 1 and/or PAT 2) and safety failures
  if (item.patInitial || item.patFinal) {
    acc.patTestedCount++;
    if (
      item.patInitial?.outcome === 'FAIL_REPAIRABLE_CORD' ||
      item.patInitial?.outcome === 'DANGER_DO_NOT_ENERGIZE' ||
      item.patFinal?.outcome === 'FAIL'
    ) {
      acc.patFailedCount++;
    }
  }
}

/**
 * Pure helper function to compute session analytics from repair records,
 * propagating the optional `isTest` flag (Issue #24).
 */
export function calculateSessionAnalytics(
  sessionId: string,
  sessionName: string,
  sessionDate: string,
  repairs: RepairItem[],
  now: number = Date.now(),
  volunteerCount: number = 0,
  isTest: boolean = false
): SessionAnalytics {
  // Initialize zeroed outcome, weight, duration, and PAT counters
  const acc: AnalyticsAccumulator = {
    totalItems: 0,
    repairedCount: 0,
    partialCount: 0,
    unfixableCount: 0,
    adviceCount: 0,
    takenHomeCount: 0,
    // Initialize repair time, weight, electrical PAT counters, and category map
    totalRepairTimeMinutes: 0,
    totalWeightKg: 0,
    mainsCount: 0,
    patTestedCount: 0,
    patFailedCount: 0,
    categoryBreakdown: {},
  };

  // Aggregate metrics across all repair items in the session
  for (const item of repairs) {
    tallyRepairItemForAnalytics(acc, item);
  }

  // Compute success rate, average repair duration, and PAT failure rate percentages
  const successRatePercent =
    acc.totalItems > 0 ? Math.round(((acc.repairedCount + acc.partialCount) / acc.totalItems) * 100) : 0;
  const totalAssessed = acc.repairedCount + acc.partialCount + acc.unfixableCount + acc.adviceCount;
  const averageRepairTimeMinutes =
    totalAssessed > 0 ? Math.round(acc.totalRepairTimeMinutes / totalAssessed) : 0;
  const patFailureRatePercent =
    acc.patTestedCount > 0 ? Math.round((acc.patFailedCount / acc.patTestedCount) * 100) : 0;

  // Return the structured SessionAnalytics object including the normalized isTest flag
  return {
    sessionId,
    sessionName,
    date: sessionDate,
    isTest: Boolean(isTest),
    totalItems: acc.totalItems,
    repairedCount: acc.repairedCount,
    partialCount: acc.partialCount,
    unfixableCount: acc.unfixableCount,
    // Populate remaining outcome counts, repair durations, diversion weight, and category breakdown
    adviceCount: acc.adviceCount,
    takenHomeCount: acc.takenHomeCount,
    totalRepairTimeMinutes: acc.totalRepairTimeMinutes,
    averageRepairTimeMinutes,
    successRatePercent,
    totalWeightDivertedKg: Math.round(acc.totalWeightKg * 10) / 10,
    categoryBreakdown: acc.categoryBreakdown,
    // Populate electrical PAT safety counters, volunteer count, and finalization timestamp
    mainsItemsCount: acc.mainsCount,
    patTestedCount: acc.patTestedCount,
    patFailureRatePercent,
    volunteerCount,
    finalizedAt: now,
  };
}

/**
 * Redacts customer PII (`customerName`, `firstName`, `contactPhone`) across all repair
 * documents in chunks of 200 items (400 operations per batch).
 */
async function redactSessionRepairsPii(
  sessionId: string,
  repairDocs: QueryDocumentSnapshot[],
  now: number
): Promise<void> {
  // Process repair documents in chunks of 200 (2 writes per repair = 400 batch ops)
  const CHUNK_SIZE = 200;
  for (let i = 0; i < repairDocs.length; i += CHUNK_SIZE) {
    const chunk = repairDocs.slice(i, i + CHUNK_SIZE);
    const batch = writeBatch(db);
    // Redact visitor name on each repair doc and scrub private/customer subcollection
    for (const repairDoc of chunk) {
      const repairRef = doc(db, 'sessions', sessionId, 'repairs', repairDoc.id);
      batch.update(repairRef, { customerName: '[REDACTED]' });
      const privateCustomerRef = doc(
        db,
        'sessions',
        sessionId,
        'repairs',
        repairDoc.id,
        'private',
        'customer'
      );
      // Overwrite firstName, delete contactPhone, and stamp redactedAt
      batch.set(
        privateCustomerRef,
        {
          firstName: '[REDACTED]',
          contactPhone: deleteField(),
          redactedAt: now,
        },
        { merge: true }
      );
    }
    await batch.commit();
  }
}

/**
 * Direct client-side finalization fallback:
 * Gathers repairs, redacts customer PII in private/customer subcollections,
 * computes analytics, and marks the session FINALIZED in Firestore.
 */
export async function finalizeSessionDirectly(sessionId: string): Promise<void> {
  // Check both static config and dynamically synced settings/system.organizerEmails
  const effectiveEmails = await getEffectiveOrganizerEmails();
  const currentUser = auth.currentUser;
  if (!currentUser?.email || !isAuthorizedOrganizer(currentUser.email, effectiveEmails)) {
    throw new Error('Only authenticated organizers may finalize a Repair Café session.');
  }

  // Load the target session document and verify its existence
  const sessionRef = doc(db, 'sessions', sessionId);
  const sessionSnap = await getDoc(sessionRef);
  if (!sessionSnap.exists()) {
    throw new Error(`Session ${sessionId} was not found.`);
  }
  const sessionData = sessionSnap.data() as Session;

  // Fetch all repairs for this session and determine volunteer attendance count
  const repairsSnap = await getDocs(collection(db, 'sessions', sessionId, 'repairs'));
  const repairs: RepairItem[] = repairsSnap.docs.map((d) => ({
    id: d.id,
    ...(d.data() as Omit<RepairItem, 'id'>),
  }));
  const now = Date.now();
  // Resolve attending volunteer count from summaries or IDs
  const volunteerCount = Array.isArray(sessionData.attendingVolunteers)
    ? sessionData.attendingVolunteers.length
    : Array.isArray(sessionData.attendingVolunteerIds)
      ? sessionData.attendingVolunteerIds.length
      : 0;

  // Compute session analytics (including isTest) and redact customer PII across all repairs
  const analyticsDoc = calculateSessionAnalytics(
    sessionId,
    sessionData.name,
    sessionData.date,
    repairs,
    now,
    volunteerCount,
    Boolean(sessionData.isTest)
  );
  await redactSessionRepairsPii(sessionId, repairsSnap.docs, now);

  // Save analytics, mark session FINALIZED, and reset settings/system.activeSessionId
  const finalBatch = writeBatch(db);
  finalBatch.set(doc(db, 'analytics', sessionId), analyticsDoc);
  finalBatch.update(sessionRef, { status: 'FINALIZED', finalizedAt: now });
  finalBatch.set(
    doc(db, 'settings', 'system'),
    { activeSessionId: null, allowRegistration: false, organizerEmails: effectiveEmails },
    { merge: true }
  );
  await finalBatch.commit();
}

/**
 * Finalizes the session by calling the finalizeSession Cloud Function
 * to scrub customer PII (GDPR) and compile analytics.
 * Automatically falls back to direct client-side Firestore finalization
 * if the Cloud Function returns a 403, permission-denied, or offline error.
 */
export async function finalizeSessionClient(sessionId: string): Promise<void> {
  // 1. Resolve merged static + dynamic organizerEmails before finalization
  const effectiveEmails = await getEffectiveOrganizerEmails();
  try {
    const settingsRef = doc(db, 'settings', 'system');
    await setDoc(settingsRef, { organizerEmails: effectiveEmails }, { merge: true });
  } catch (err) {
    console.warn('Could not sync organizerEmails to settings/system:', err);
  }

  let finalized = false;

  // 2. Attempt Cloud Function finalization (if online)
  if (navigator.onLine) {
    try {
      // Invoke the backend finalizeSession Cloud Function
      const finalizeCallable = httpsCallable<
        { sessionId: string; organizerEmails?: string[] },
        { success: boolean; analyticsId: string }
      >(functions, 'finalizeSession');
      await finalizeCallable({ sessionId, organizerEmails: effectiveEmails });
      finalized = true;
    } catch (err) {
      console.warn(
        'Backend finalizeSession Cloud Function returned an error, falling back to direct Firestore finalization:',
        err
      );
    }
  }

  // 3. Fallback to direct client-side session finalization and GDPR redaction
  if (!finalized) {
    await finalizeSessionDirectly(sessionId);
  }

  // 4. Clear client IndexedDB cache to ensure no residual customer PII remains
  try {
    await terminate(db);
    await clearIndexedDbPersistence(db);
  } catch (err) {
    console.warn('Local IndexedDB persistence clear notice:', err);
  }
}

/**
 * Updates the `isTest` classification flag on an existing session and/or its
 * corresponding `analytics/{sessionId}` summary document (Issue #24).
 */
export async function setSessionTestStatus(
  sessionId: string,
  isTest: boolean
): Promise<void> {
  // Verify the caller is an authenticated organiser with an authorised email
  const effectiveEmails = await getEffectiveOrganizerEmails();
  const currentUser = auth.currentUser;
  if (!currentUser?.email || !isAuthorizedOrganizer(currentUser.email, effectiveEmails)) {
    throw new Error('Only authenticated organizers may update session test classification.');
  }

  // Read both sessions/{sessionId} and analytics/{sessionId} to avoid creating stub documents
  const sessionRef = doc(db, 'sessions', sessionId);
  const analyticsRef = doc(db, 'analytics', sessionId);
  const [sessionSnap, analyticsSnap] = await Promise.all([
    getDoc(sessionRef),
    getDoc(analyticsRef),
  ]);

  if (!sessionSnap.exists() && !analyticsSnap.exists()) {
    throw new Error(`Session "${sessionId}" not found.`);
  }

  // Update isTest only on the document(s) that actually exist in Firestore
  const batch = writeBatch(db);
  const normalizedIsTest = Boolean(isTest);
  if (sessionSnap.exists()) {
    batch.update(sessionRef, { isTest: normalizedIsTest });
  }
  if (analyticsSnap.exists()) {
    batch.update(analyticsRef, { isTest: normalizedIsTest });
  }
  await batch.commit();
}

/**
 * Maximum number of Firestore delete operations per batch during cascading session purge.
 * Kept strictly below Firestore's 500-operation transaction/batch limit.
 */
const PURGE_BATCH_CHUNK_SIZE = 400;

/**
 * Collects all Level 3 leaf `DocumentReference`s (`photos` and `private/customer`)
 * followed by Level 2 `repairs` `DocumentReference`s for bottom-up deletion.
 */
async function collectClientSessionPurgeRefs(sessionId: string): Promise<{
  orderedSubcollectionRefs: DocumentReference[];
  deletedRepairs: number;
  deletedPhotos: number;
}> {
  // Fetch all repair documents under sessions/{sessionId}/repairs and their photo subcollections
  const repairsSnap = await getDocs(collection(db, 'sessions', sessionId, 'repairs'));
  const photoSnaps = await Promise.all(
    repairsSnap.docs.map((rDoc) =>
      getDocs(collection(db, 'sessions', sessionId, 'repairs', rDoc.id, 'photos'))
    )
  );

  // Enqueue Level 3 leaf documents (photos and private/customer) before Level 2 repair documents
  const leafDeleteRefs: DocumentReference[] = [];
  const repairDeleteRefs: DocumentReference[] = [];
  let deletedPhotos = 0;

  // Iterate over each repair document to collect its child leaf refs and the repair ref itself
  repairsSnap.docs.forEach((rDoc, index) => {
    photoSnaps[index].docs.forEach((pDoc) => {
      leafDeleteRefs.push(pDoc.ref);
      deletedPhotos++;
    });
    // Queue segregated private/customer PII document and parent repair document
    leafDeleteRefs.push(doc(db, 'sessions', sessionId, 'repairs', rDoc.id, 'private', 'customer'));
    repairDeleteRefs.push(rDoc.ref);
  });

  return {
    orderedSubcollectionRefs: [...leafDeleteRefs, ...repairDeleteRefs],
    deletedRepairs: repairsSnap.docs.length,
    deletedPhotos,
  };
}

/**
 * Clears volunteer PIN `sessionStorage` keys and, if the purged session was the
 * active session, terminates and clears local IndexedDB persistence.
 */
async function clearPurgedSessionClientCache(
  sessionId: string,
  wasActiveSession: boolean
): Promise<void> {
  // Clear any volunteer PIN sessionStorage keys for the purged session on this browser
  try {
    sessionStorage.removeItem(`volunteer_unlocked_${sessionId}`);
    sessionStorage.removeItem(`volunteer_token_${sessionId}`);
  } catch {
    // Ignore sessionStorage errors in restricted browser contexts
  }

  // Terminate and clear local IndexedDB cache when discarding the active session
  if (wasActiveSession) {
    try {
      await terminate(db);
      await clearIndexedDbPersistence(db);
    } catch (err) {
      console.warn('Local IndexedDB persistence clear notice:', err);
    }
  }
}

/**
 * Performs a bottom-up cascading deletion of a test session and all of its nested
 * subcollections (`photos`, `private/customer`, `repairs`), `analytics/{sessionId}`,
 * and `sessions/{sessionId}`, resetting `settings/system.activeSessionId` if active (Issue #24).
 */
export async function purgeSessionCascading(
  sessionId: string,
  options?: { forceNonTest?: boolean }
): Promise<{ deletedRepairs: number; deletedPhotos: number }> {
  // Block purging while offline so unsynced items on other tablets are never missed
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    throw new Error('Cannot purge a session while offline. Please reconnect to the internet first.');
  }

  // Verify the caller is an authenticated organiser with an authorised email
  const { effectiveEmails, settings } = await getSystemSettingsWithEmails();
  const currentUser = auth.currentUser;
  if (!currentUser?.email || !isAuthorizedOrganizer(currentUser.email, effectiveEmails)) {
    throw new Error('Only authenticated organizers may purge a Repair Café session.');
  }

  // Load both session and analytics documents to verify existence and test classification
  const sessionRef = doc(db, 'sessions', sessionId);
  const analyticsRef = doc(db, 'analytics', sessionId);
  const [sessionSnap, analyticsSnap] = await Promise.all([getDoc(sessionRef), getDoc(analyticsRef)]);
  if (!sessionSnap.exists() && !analyticsSnap.exists()) {
    throw new Error(`Session "${sessionId}" not found.`);
  }

  // Protect official sessions from accidental deletion unless forceNonTest is explicitly true
  const isMarkedTest = Boolean(sessionSnap.data()?.isTest || analyticsSnap.data()?.isTest);
  if (!isMarkedTest && !options?.forceNonTest) {
    throw new Error(
      `Session "${sessionId}" is not marked as a test session. Mark it as a test session first before purging.`
    );
  }

  // Collect and commit all subcollection deletions in chunks of at most 400 operations
  const { orderedSubcollectionRefs, deletedRepairs, deletedPhotos } =
    await collectClientSessionPurgeRefs(sessionId);
  for (let i = 0; i < orderedSubcollectionRefs.length; i += PURGE_BATCH_CHUNK_SIZE) {
    const chunk = orderedSubcollectionRefs.slice(i, i + PURGE_BATCH_CHUNK_SIZE);
    const batch = writeBatch(db);
    chunk.forEach((ref) => batch.delete(ref));
    await batch.commit();
  }

  // Delete root analytics/{sessionId}, sessions/{sessionId}, and reset activeSessionId if needed
  const wasActiveSession = settings?.activeSessionId === sessionId;
  const rootBatch = writeBatch(db);
  rootBatch.delete(analyticsRef);
  rootBatch.delete(sessionRef);
  if (wasActiveSession) {
    rootBatch.set(
      doc(db, 'settings', 'system'),
      { activeSessionId: null, allowRegistration: false, organizerEmails: effectiveEmails },
      { merge: true }
    );
  }
  await rootBatch.commit();
  await clearPurgedSessionClientCache(sessionId, wasActiveSession);

  return { deletedRepairs, deletedPhotos };
}
