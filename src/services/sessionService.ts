import { 
  doc, 
  getDoc, 
  setDoc, 
  collection, 
  getDocs, 
  writeBatch, 
  deleteField, 
  terminate, 
  clearIndexedDbPersistence 
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

/**
 * Helper that reads existing `settings/system.organizerEmails` and merges them with
 * static `cafeConfig.organizerEmails` so dynamic volunteer organisers are never overwritten.
 */
async function getEffectiveOrganizerEmails(): Promise<string[]> {
  try {
    const settingsRef = doc(db, 'settings', 'system');
    const snap = await getDoc(settingsRef);
    if (snap.exists()) {
      const data = snap.data() as SystemSettings;
      if (Array.isArray(data.organizerEmails)) {
        return Array.from(
          new Set([...cafeConfig.organizerEmails, ...data.organizerEmails])
        );
      }
    }
  } catch (err) {
    console.warn('Could not read existing organizerEmails from settings/system:', err);
  }
  return [...cafeConfig.organizerEmails];
}

/**
 * Hashes a 4-digit PIN using SHA-256 for secure comparison
 */
export async function hashPin(pin: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(pin.trim());
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Retrieves the currently active session (if any)
 */
export async function getActiveSession(): Promise<Session | null> {
  const settingsRef = doc(db, 'settings', 'system');
  const settingsSnap = await getDoc(settingsRef);

  if (!settingsSnap.exists()) return null;
  const settings = settingsSnap.data() as SystemSettings;
  if (!settings.activeSessionId) return null;

  const sessionRef = doc(db, 'sessions', settings.activeSessionId);
  const sessionSnap = await getDoc(sessionRef);
  if (!sessionSnap.exists()) return null;

  return sessionSnap.data() as Session;
}

/**
 * Creates and starts a new Repair Café session, including any initial attending volunteers.
 */
export async function createSession(params: {
  id: string;
  name: string;
  date: string;
  volunteerPin: string;
  cardRangeStart: number;
  cardRangeEnd: number;
  attendingVolunteers?: SessionVolunteerSummary[];
}): Promise<Session> {
  const volunteerPinHash = await hashPin(params.volunteerPin);
  // Sort attending volunteers alphabetically and extract their IDs
  const summaries = [...(params.attendingVolunteers || [])].sort((a, b) =>
    a.name.localeCompare(b.name)
  );
  const attendingVolunteerIds = summaries.map((v) => v.id);

  const sessionData: Session = removeUndefined({
    id: params.id,
    name: params.name,
    date: params.date,
    status: 'ACTIVE',
    volunteerPinHash,
    cardRangeStart: params.cardRangeStart,
    cardRangeEnd: params.cardRangeEnd,
    attendingVolunteerIds,
    attendingVolunteers: summaries,
    createdAt: Date.now()
  });

  // 1. Create session document
  const sessionRef = doc(db, 'sessions', params.id);
  await setDoc(sessionRef, sessionData);

  // 2. Set as active in settings while preserving dynamically added organiser emails
  const effectiveEmails = await getEffectiveOrganizerEmails();
  const settingsRef = doc(db, 'settings', 'system');
  await setDoc(settingsRef, {
    activeSessionId: params.id,
    allowRegistration: true,
    cafeName: cafeConfig.cafeName,
    organizerEmails: effectiveEmails
  }, { merge: true });

  return sessionData;
}

/**
 * Lists past and present sessions
 */
export async function listSessions(): Promise<Session[]> {
  const sessionsRef = collection(db, 'sessions');
  const snap = await getDocs(sessionsRef);
  return snap.docs.map(d => d.data() as Session);
}

/**
 * Pure helper function to compute session analytics from repair records
 */
export function calculateSessionAnalytics(
  sessionId: string,
  sessionName: string,
  sessionDate: string,
  repairs: RepairItem[],
  now: number = Date.now(),
  volunteerCount: number = 0
): SessionAnalytics {
  // Initialize item outcome counters
  let totalItems = 0;
  let repairedCount = 0;
  let partialCount = 0;
  let unfixableCount = 0;
  let adviceCount = 0;
  // Initialize duration, weight, and electrical safety counters
  let takenHomeCount = 0;
  let totalRepairTimeMinutes = 0;
  let totalWeightKg = 0;
  let mainsCount = 0;
  let patTestedCount = 0;
  let patFailedCount = 0;
  const categoryBreakdown: Record<string, number> = {};

  // Aggregate metrics across all repair items in the session
  for (const item of repairs) {
    totalItems++;
    const cat = item.item?.category || 'OTHER';
    categoryBreakdown[cat] = (categoryBreakdown[cat] || 0) + 1;

    // Count 240V mains-powered items and total diverted weight
    if (item.item?.powerType === 'MAINS_240V') {
      mainsCount++;
    }

    if (item.item?.weightKg && typeof item.item.weightKg === 'number' && !Number.isNaN(item.item.weightKg)) {
      totalWeightKg += item.item.weightKg;
    }

    // Tally fixer repair time and repair outcome disposition
    if (item.repair) {
      if (item.repair.repairTimeMinutes && typeof item.repair.repairTimeMinutes === 'number') {
        totalRepairTimeMinutes += item.repair.repairTimeMinutes;
      }

      // Increment outcome counter matching the fixer's logged result
      switch (item.repair.outcome) {
        case 'FIXED':
          repairedCount++;
          break;
        case 'PARTIAL':
          partialCount++;
          break;
        // Tally unfixable, advice-given, and taken-home outcomes
        case 'UNFIXABLE':
          unfixableCount++;
          break;
        case 'ADVICE_GIVEN':
          adviceCount++;
          break;
        case 'TAKEN_HOME':
          takenHomeCount++;
          break;
      }
    } else if (item.status === 'UNFIXABLE') {
      // Include items quarantined at PAT 1 as unfixable
      unfixableCount++;
    }

    // Tally initial PAT tests and cord/safety failures
    if (item.patInitial) {
      patTestedCount++;
      if (
        item.patInitial.outcome === 'FAIL_REPAIRABLE_CORD' ||
        item.patInitial.outcome === 'DANGER_DO_NOT_ENERGIZE'
      ) {
        patFailedCount++;
      }
    }
  }

  // Compute percentage of items successfully or partially repaired
  const successRatePercent = totalItems > 0
    ? Math.round(((repairedCount + partialCount) / totalItems) * 100)
    : 0;

  // Compute average repair duration across assessed items
  const totalAssessedItems = repairedCount + partialCount + unfixableCount + adviceCount;
  const averageRepairTimeMinutes = totalAssessedItems > 0
    ? Math.round(totalRepairTimeMinutes / totalAssessedItems)
    : 0;

  // Compute PAT failure rate percentage
  const patFailureRatePercent = patTestedCount > 0
    ? Math.round((patFailedCount / patTestedCount) * 100)
    : 0;

  // Return the structured SessionAnalytics object
  return {
    sessionId,
    sessionName,
    date: sessionDate,
    totalItems,
    repairedCount,
    partialCount,
    unfixableCount,
    adviceCount,
    // Include volunteer hours, diversion weight, PAT metrics, and volunteer attendance count
    takenHomeCount,
    totalRepairTimeMinutes,
    averageRepairTimeMinutes,
    successRatePercent,
    totalWeightDivertedKg: Math.round(totalWeightKg * 10) / 10,
    categoryBreakdown,
    mainsItemsCount: mainsCount,
    patTestedCount,
    patFailureRatePercent,
    volunteerCount,
    finalizedAt: now
  };
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
  if (currentUser?.email && !isAuthorizedOrganizer(currentUser.email, effectiveEmails)) {
    throw new Error("Only authenticated organizers may finalize a Repair Café session.");
  }

  const sessionRef = doc(db, 'sessions', sessionId);
  const sessionSnap = await getDoc(sessionRef);
  if (!sessionSnap.exists()) {
    throw new Error(`Session ${sessionId} was not found.`);
  }
  const sessionData = sessionSnap.data() as Session;

  // 1. Fetch all repairs for this session
  const repairsRef = collection(db, 'sessions', sessionId, 'repairs');
  const repairsSnap = await getDocs(repairsRef);
  const repairs: RepairItem[] = repairsSnap.docs.map(d => ({
    id: d.id,
    ...(d.data() as Omit<RepairItem, 'id'>)
  }));

  const now = Date.now();
  // Determine total attending volunteers recorded on the session
  const volunteerCount = Array.isArray(sessionData.attendingVolunteers)
    ? sessionData.attendingVolunteers.length
    : Array.isArray(sessionData.attendingVolunteerIds)
      ? sessionData.attendingVolunteerIds.length
      : 0;

  // 2. Compute Analytics including volunteer attendance count
  const analyticsDoc = calculateSessionAnalytics(
    sessionId,
    sessionData.name,
    sessionData.date,
    repairs,
    now,
    volunteerCount
  );

  // 3. Chunked GDPR Redaction of customer PII in private/customer subcollections & repair docs
  const CHUNK_SIZE = 200;
  for (let i = 0; i < repairsSnap.docs.length; i += CHUNK_SIZE) {
    const chunk = repairsSnap.docs.slice(i, i + CHUNK_SIZE);
    const batch = writeBatch(db);
    for (const repairDoc of chunk) {
      const repairRef = doc(db, 'sessions', sessionId, 'repairs', repairDoc.id);
      batch.update(repairRef, {
        customerName: '[REDACTED]'
      });
      const privateCustomerRef = doc(db, 'sessions', sessionId, 'repairs', repairDoc.id, 'private', 'customer');
      batch.set(
        privateCustomerRef,
        {
          firstName: '[REDACTED]',
          contactPhone: deleteField(),
          redactedAt: now
        },
        { merge: true }
      );
    }
    await batch.commit();
  }

  // 4. Save Analytics and Finalize Session Status while preserving effective organizerEmails
  const finalBatch = writeBatch(db);
  finalBatch.set(doc(db, 'analytics', sessionId), analyticsDoc);
  finalBatch.update(sessionRef, {
    status: 'FINALIZED',
    finalizedAt: now
  });
  finalBatch.update(doc(db, 'settings', 'system'), {
    activeSessionId: null,
    allowRegistration: false,
    organizerEmails: effectiveEmails
  });
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
    await setDoc(settingsRef, {
      organizerEmails: effectiveEmails
    }, { merge: true });
  } catch (err) {
    console.warn("Could not sync organizerEmails to settings/system:", err);
  }

  let finalized = false;

  // 2. Attempt Cloud Function finalization (if online)
  if (navigator.onLine) {
    try {
      const finalizeCallable = httpsCallable<
        { sessionId: string; organizerEmails?: string[] },
        { success: boolean; analyticsId: string }
      >(functions, 'finalizeSession');
      await finalizeCallable({
        sessionId,
        organizerEmails: effectiveEmails
      });
      finalized = true;
    } catch (err) {
      console.warn("Backend finalizeSession Cloud Function returned an error, falling back to direct Firestore finalization:", err);
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
    console.warn("Local IndexedDB persistence clear notice:", err);
  }
}
