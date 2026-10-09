import { 
  doc, 
  getDoc, 
  setDoc, 
  updateDoc, 
  collection, 
  getDocs, 
  writeBatch,
  deleteField,
  terminate,
  clearIndexedDbPersistence
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions, auth } from './firebase';
import { Session, SystemSettings, RepairItem, SessionAnalytics } from '../types';
import { cafeConfig } from '../config/cafe.config';
import { isAuthorizedOrganizer } from '../utils/authUtils';

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
 * Creates and starts a new Repair Café session
 */
export async function createSession(params: {
  id: string;
  name: string;
  date: string;
  volunteerPin: string;
  cardRangeStart: number;
  cardRangeEnd: number;
}): Promise<Session> {
  const volunteerPinHash = await hashPin(params.volunteerPin);

  const sessionData: Session = {
    id: params.id,
    name: params.name,
    date: params.date,
    status: 'ACTIVE',
    volunteerPinHash,
    cardRangeStart: params.cardRangeStart,
    cardRangeEnd: params.cardRangeEnd,
    createdAt: Date.now()
  };

  // 1. Create session document
  const sessionRef = doc(db, 'sessions', params.id);
  await setDoc(sessionRef, sessionData);

  // 2. Set as active in settings and sync organizer config
  const settingsRef = doc(db, 'settings', 'system');
  await setDoc(settingsRef, {
    activeSessionId: params.id,
    allowRegistration: true,
    cafeName: cafeConfig.cafeName,
    organizerEmails: cafeConfig.organizerEmails
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
  now: number = Date.now()
): SessionAnalytics {
  let totalItems = 0;
  let repairedCount = 0;
  let partialCount = 0;
  let unfixableCount = 0;
  let adviceCount = 0;
  let takenHomeCount = 0;
  let totalRepairTimeMinutes = 0;
  let totalWeightKg = 0;
  let mainsCount = 0;
  let patTestedCount = 0;
  let patFailedCount = 0;
  const categoryBreakdown: Record<string, number> = {};

  for (const item of repairs) {
    totalItems++;
    const cat = item.item?.category || 'OTHER';
    categoryBreakdown[cat] = (categoryBreakdown[cat] || 0) + 1;

    if (item.item?.powerType === 'MAINS_240V') {
      mainsCount++;
    }

    if (item.item?.weightKg && typeof item.item.weightKg === 'number' && !Number.isNaN(item.item.weightKg)) {
      totalWeightKg += item.item.weightKg;
    }

    if (item.repair) {
      if (item.repair.repairTimeMinutes && typeof item.repair.repairTimeMinutes === 'number') {
        totalRepairTimeMinutes += item.repair.repairTimeMinutes;
      }

      switch (item.repair.outcome) {
        case 'FIXED':
          repairedCount++;
          break;
        case 'PARTIAL':
          partialCount++;
          break;
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
      unfixableCount++;
    }

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

  const successRatePercent = totalItems > 0
    ? Math.round(((repairedCount + partialCount) / totalItems) * 100)
    : 0;

  const totalAssessedItems = repairedCount + partialCount + unfixableCount + adviceCount;
  const averageRepairTimeMinutes = totalAssessedItems > 0
    ? Math.round(totalRepairTimeMinutes / totalAssessedItems)
    : 0;

  const patFailureRatePercent = patTestedCount > 0
    ? Math.round((patFailedCount / patTestedCount) * 100)
    : 0;

  return {
    sessionId,
    sessionName,
    date: sessionDate,
    totalItems,
    repairedCount,
    partialCount,
    unfixableCount,
    adviceCount,
    takenHomeCount,
    totalRepairTimeMinutes,
    averageRepairTimeMinutes,
    successRatePercent,
    totalWeightDivertedKg: Math.round(totalWeightKg * 10) / 10,
    categoryBreakdown,
    mainsItemsCount: mainsCount,
    patTestedCount,
    patFailureRatePercent,
    finalizedAt: now
  };
}

/**
 * Direct client-side finalization fallback:
 * Gathers repairs, redacts customer PII in private/customer subcollections,
 * computes analytics, and marks the session FINALIZED in Firestore.
 */
export async function finalizeSessionDirectly(sessionId: string): Promise<void> {
  const currentUser = auth.currentUser;
  if (currentUser?.email && !isAuthorizedOrganizer(currentUser.email, cafeConfig.organizerEmails)) {
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

  // 2. Compute Analytics
  const analyticsDoc = calculateSessionAnalytics(
    sessionId,
    sessionData.name,
    sessionData.date,
    repairs,
    now
  );

  // 3. Chunked GDPR Redaction of customer PII in private/customer subcollections
  const CHUNK_SIZE = 400;
  for (let i = 0; i < repairsSnap.docs.length; i += CHUNK_SIZE) {
    const chunk = repairsSnap.docs.slice(i, i + CHUNK_SIZE);
    const batch = writeBatch(db);
    for (const repairDoc of chunk) {
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

  // 4. Save Analytics and Finalize Session Status
  const finalBatch = writeBatch(db);
  finalBatch.set(doc(db, 'analytics', sessionId), analyticsDoc);
  finalBatch.update(sessionRef, {
    status: 'FINALIZED',
    finalizedAt: now
  });
  finalBatch.update(doc(db, 'settings', 'system'), {
    activeSessionId: null,
    allowRegistration: false,
    organizerEmails: cafeConfig.organizerEmails
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
  // 1. Sync organizerEmails to settings/system before finalization
  try {
    const settingsRef = doc(db, 'settings', 'system');
    await setDoc(settingsRef, {
      organizerEmails: cafeConfig.organizerEmails
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
        organizerEmails: cafeConfig.organizerEmails
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
