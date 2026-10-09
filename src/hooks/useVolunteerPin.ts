import { useState, useEffect, useCallback } from 'react';
import { httpsCallable } from 'firebase/functions';
import { signInWithCustomToken } from 'firebase/auth';
import { functions, auth } from '../services/firebase';
import { Session } from '../types';
import { hashPin } from '../services/sessionService';

export function useVolunteerPin(session: Session | null) {
  const [isUnlocked, setIsUnlocked] = useState<boolean>(() => {
    if (!session) return false;
    return sessionStorage.getItem(`volunteer_unlocked_${session.id}`) === 'true';
  });
  const [error, setError] = useState<string | null>(null);

  // Sync state if session changes
  useEffect(() => {
    if (session) {
      const stored = sessionStorage.getItem(`volunteer_unlocked_${session.id}`) === 'true';
      setIsUnlocked(stored);
    } else {
      setIsUnlocked(false);
    }
  }, [session]);

  const unlock = useCallback(async (pin: string): Promise<boolean> => {
    if (!session) {
      setError("No active session running.");
      return false;
    }

    setError(null);

    // 1. Try Cloud Function call to mint custom token and sign in with Firebase Auth
    if (navigator.onLine) {
      try {
        const verifyPinCallable = httpsCallable<{ sessionId: string; pin: string }, { token: string }>(
          functions,
          'verifyVolunteerPin'
        );
        const res = await verifyPinCallable({
          sessionId: session.id,
          pin: pin.trim()
        });

        if (res.data?.token) {
          // Sign in with volunteer custom token (role: 'volunteer')
          await signInWithCustomToken(auth, res.data.token);
          sessionStorage.setItem(`volunteer_unlocked_${session.id}`, 'true');
          sessionStorage.setItem(`volunteer_token_${session.id}`, res.data.token);
          setIsUnlocked(true);
          return true;
        }
      } catch (err: unknown) {
        console.warn("Cloud function PIN verification failed, falling back to local hash:", err);
      }
    }

    // 2. Offline Fallback: Verify against session SHA-256 hash locally
    try {
      const enteredHash = await hashPin(pin);
      if (enteredHash === session.volunteerPinHash) {
        sessionStorage.setItem(`volunteer_unlocked_${session.id}`, 'true');
        setIsUnlocked(true);
        return true;
      } else {
        setError("Invalid PIN. Please check with the Front Desk.");
        return false;
      }
    } catch {
      setError("PIN validation failed. Please try again.");
      return false;
    }
  }, [session]);

  const lock = useCallback(() => {
    if (session) {
      sessionStorage.removeItem(`volunteer_unlocked_${session.id}`);
      sessionStorage.removeItem(`volunteer_token_${session.id}`);
    }
    setIsUnlocked(false);
  }, [session]);

  return { isUnlocked, unlock, lock, error };
}
