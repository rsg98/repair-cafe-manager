import { useState, useEffect } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../services/firebase';
import { Session, SystemSettings } from '../types';

export function useActiveSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Listen to settings/system document for the activeSessionId pointer
    const unsubSettings = onSnapshot(
      doc(db, 'settings', 'system'),
      (settingsSnap) => {
        if (!settingsSnap.exists()) {
          setSession(null);
          setLoading(false);
          return;
        }

        const settings = settingsSnap.data() as SystemSettings;
        if (!settings.activeSessionId) {
          setSession(null);
          setLoading(false);
          return;
        }

        // Listen to the active session document
        const unsubSession = onSnapshot(
          doc(db, 'sessions', settings.activeSessionId),
          (sessionSnap) => {
            if (sessionSnap.exists() && sessionSnap.data()?.status === 'ACTIVE') {
              setSession({ id: sessionSnap.id, ...sessionSnap.data() } as Session);
            } else {
              setSession(null);
            }
            setLoading(false);
          },
          (err) => {
            console.error("Session subscription error:", err);
            setError(err.message);
            setLoading(false);
          }
        );

        return () => unsubSession();
      },
      (err) => {
        console.error("System settings subscription error:", err);
        setError(err.message);
        setLoading(false);
      }
    );

    return () => unsubSettings();
  }, []);

  return { session, loading, error };
}
