import { 
  doc, 
  getDoc, 
  setDoc, 
  updateDoc, 
  collection, 
  getDocs, 
  terminate,
  clearIndexedDbPersistence
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from './firebase';
import { Session, SystemSettings } from '../types';

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

  // 2. Set as active in settings
  const settingsRef = doc(db, 'settings', 'system');
  await setDoc(settingsRef, {
    activeSessionId: params.id,
    allowRegistration: true,
    cafeName: "Sutton Repair Café"
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
 * Finalizes the session by calling the finalizeSession Cloud Function
 * to scrub customer PII (GDPR) and compile analytics.
 */
export async function finalizeSessionClient(sessionId: string): Promise<void> {
  // 1. Trigger the backend Cloud Function
  if (navigator.onLine) {
    const finalizeCallable = httpsCallable<{ sessionId: string }, { success: boolean; analyticsId: string }>(
      functions,
      'finalizeSession'
    );
    await finalizeCallable({ sessionId });
  } else {
    // Offline fallback: Mark status locally
    const sessionRef = doc(db, 'sessions', sessionId);
    await updateDoc(sessionRef, {
      status: 'FINALIZED',
      finalizedAt: Date.now()
    });

    const settingsRef = doc(db, 'settings', 'system');
    await updateDoc(settingsRef, {
      activeSessionId: null,
      allowRegistration: false
    });
  }

  // 2. Clear client IndexedDB cache to ensure no residual customer PII remains
  try {
    await terminate(db);
    await clearIndexedDbPersistence(db);
  } catch (err) {
    console.warn("Local IndexedDB persistence clear notice:", err);
  }
}
