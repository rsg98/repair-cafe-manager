import { useState, useEffect } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../services/firebase';
import { Session, SystemSettings } from '../types';

export function useActiveSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [systemSettings, setSystemSettings] = useState<SystemSettings | null>(
    null
  );
  const [allowRegistration, setAllowRegistration] = useState<boolean>(true);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Track nested active session listener so it is properly cleaned up on session change or unmount
    let unsubSession: (() => void) | null = null;
    let subscribedSessionId: string | null = null;

    // Helper to tear down any active session document listener
    const cleanupSessionListener = () => {
      if (unsubSession) {
        unsubSession();
        unsubSession = null;
      }
      subscribedSessionId = null;
    };

    // Listen to settings/system document for activeSessionId and deployedVersion metadata
    const unsubSettings = onSnapshot(
      doc(db, 'settings', 'system'),
      (settingsSnap) => {
        if (!settingsSnap.exists()) {
          cleanupSessionListener();
          setSystemSettings(null);
          setAllowRegistration(false);
          setSession(null);
          setLoading(false);
          return;
        }

        // Hydrate system settings including deployedVersion & deployedBuildTimestamp
        const settings = settingsSnap.data() as SystemSettings;
        setSystemSettings(settings);
        setAllowRegistration(settings.allowRegistration !== false);

        if (!settings.activeSessionId) {
          cleanupSessionListener();
          setSession(null);
          setLoading(false);
          return;
        }

        // Avoid re-subscribing to the session document if activeSessionId has not changed
        if (
          subscribedSessionId === settings.activeSessionId &&
          unsubSession !== null
        ) {
          return;
        }

        cleanupSessionListener();
        subscribedSessionId = settings.activeSessionId;

        // Listen to the active session document
        unsubSession = onSnapshot(
          doc(db, 'sessions', settings.activeSessionId),
          (sessionSnap) => {
            if (
              sessionSnap.exists() &&
              sessionSnap.data()?.status === 'ACTIVE'
            ) {
              setSession({
                id: sessionSnap.id,
                ...sessionSnap.data(),
              } as Session);
            } else {
              setSession(null);
            }
            setLoading(false);
          },
          (err) => {
            console.error('Session subscription error:', err);
            setError(err.message);
            setLoading(false);
          }
        );
      },
      (err) => {
        console.error('System settings subscription error:', err);
        setError(err.message);
        setLoading(false);
      }
    );

    // Clean up both settings/system and active session listeners on unmount
    return () => {
      unsubSettings();
      cleanupSessionListener();
    };
  }, []);

  return { session, allowRegistration, systemSettings, loading, error };
}

