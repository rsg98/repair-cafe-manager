import { useState, useEffect, useCallback } from 'react';
import { httpsCallable } from 'firebase/functions';
import { signInWithCustomToken } from 'firebase/auth';
import { functions, auth } from '../services/firebase';
import { Session } from '../types';
import { hashPin } from '../services/sessionService';
import { useAuth } from './useAuth';
import { isStationUnlocked } from '../utils/authUtils';

export function useVolunteerPin(session: Session | null) {
  // Check whether the user is already authenticated via Google as an organiser
  const { isAdmin, loading: authLoading } = useAuth();

  // Track whether the 4-digit session PIN has been entered in this browser tab
  const [isPinUnlocked, setIsPinUnlocked] = useState<boolean>(() => {
    if (!session) return false;
    return sessionStorage.getItem(`volunteer_unlocked_${session.id}`) === 'true';
  });
  const [error, setError] = useState<string | null>(null);

  // Sync PIN unlock state if the active session changes or PIN state is toggled elsewhere
  useEffect(() => {
    const syncPinState = () => {
      if (session) {
        const stored = sessionStorage.getItem(`volunteer_unlocked_${session.id}`) === 'true';
        setIsPinUnlocked(stored);
      } else {
        setIsPinUnlocked(false);
      }
    };

    syncPinState();
    window.addEventListener('volunteer-pin-change', syncPinState);
    return () => {
      window.removeEventListener('volunteer-pin-change', syncPinState);
    };
  }, [session]);

  const unlock = useCallback(async (pin: string): Promise<boolean> => {
    // If already authenticated as an organiser with Google, never overwrite their session with a custom token
    if (isAdmin) {
      setError(null);
      setIsPinUnlocked(true);
      return true;
    }

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
          // Only sign in with custom volunteer token when not already signed in as an organiser
          await signInWithCustomToken(auth, res.data.token);
          sessionStorage.setItem(`volunteer_unlocked_${session.id}`, 'true');
          sessionStorage.setItem(`volunteer_token_${session.id}`, res.data.token);
          setIsPinUnlocked(true);
          window.dispatchEvent(new Event('volunteer-pin-change'));
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
        setIsPinUnlocked(true);
        window.dispatchEvent(new Event('volunteer-pin-change'));
        return true;
      } else {
        setError("Invalid PIN. Please check with the Front Desk.");
        return false;
      }
    } catch {
      setError("PIN validation failed. Please try again.");
      return false;
    }
  }, [session, isAdmin]);

  const lock = useCallback(() => {
    if (session) {
      sessionStorage.removeItem(`volunteer_unlocked_${session.id}`);
      sessionStorage.removeItem(`volunteer_token_${session.id}`);
    }
    setIsPinUnlocked(false);
    window.dispatchEvent(new Event('volunteer-pin-change'));
  }, [session]);

  // Compute effective unlock state: organisers bypass PIN without losing their Google Auth session
  const isUnlocked = isStationUnlocked({
    hasActiveSession: Boolean(session),
    isPinUnlocked,
    isAdmin,
    authLoading,
  });

  return { isUnlocked, isPinUnlocked, isAdmin, unlock, lock, error };
}

