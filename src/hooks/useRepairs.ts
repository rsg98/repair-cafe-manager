import { useState, useEffect } from 'react';
import { collection, onSnapshot, query } from 'firebase/firestore';
import { db } from '../services/firebase';
import { RepairItem } from '../types';

export function useRepairs(sessionId: string | null | undefined) {
  const [repairs, setRepairs] = useState<RepairItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId) {
      setRepairs([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const repairsRef = collection(db, 'sessions', sessionId, 'repairs');
    const q = query(repairsRef);

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const items: RepairItem[] = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        } as RepairItem));

        // Sort items: assigned cards by card number ascending, unassigned by creation
        items.sort((a, b) => {
          if (a.cardNumber && b.cardNumber) return a.cardNumber - b.cardNumber;
          if (a.cardNumber) return -1;
          if (b.cardNumber) return 1;
          return a.referenceToken.localeCompare(b.referenceToken);
        });

        setRepairs(items);
        setLoading(false);
      },
      (err) => {
        console.error("Firestore repairs subscription error:", err);
        setError(err.message);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [sessionId]);

  return { repairs, loading, error };
}
