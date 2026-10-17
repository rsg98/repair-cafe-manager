import { useState, useEffect } from 'react';
import { collection, onSnapshot, query } from 'firebase/firestore';
import { db } from '../services/firebase';
import { sortRepairsByRegistration } from '../services/repairService';
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

        // Sort items in first-come, first-served order (earliest customer registration at the top)
        setRepairs(sortRepairsByRegistration(items));
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
