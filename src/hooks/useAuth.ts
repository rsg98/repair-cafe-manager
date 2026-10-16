import { useState, useEffect } from 'react';
import { 
  User, 
  onAuthStateChanged, 
  signInWithPopup, 
  signInWithRedirect,
  getRedirectResult,
  signOut as firebaseSignOut 
} from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { auth, db, googleAuthProvider } from '../services/firebase';
import { cafeConfig } from '../config/cafe.config';
import { 
  isAuthorizedOrganizer, 
  shouldFallbackToRedirect, 
  isBenignPopupCancel 
} from '../utils/authUtils';
import { SystemSettings } from '../types';

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  // Track both Firebase Auth and Firestore settings/system readiness to prevent premature unauthorized screen flashes
  const [authResolved, setAuthResolved] = useState<boolean>(false);
  const [settingsResolved, setSettingsResolved] = useState<boolean>(false);
  const [dynamicOrganizerEmails, setDynamicOrganizerEmails] = useState<string[]>([]);

  useEffect(() => {
    // Complete any pending OAuth redirect sign-in initiated when popups were blocked
    getRedirectResult(auth).catch((err) => {
      console.warn('Google redirect sign-in check warning:', err);
    });

    // Subscribe to Firebase Authentication state changes
    const unsubscribeAuth = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setAuthResolved(true);
    });

    // Subscribe to settings/system so dynamically added volunteer organisers are recognized
    const settingsRef = doc(db, 'settings', 'system');
    const unsubscribeSettings = onSnapshot(
      settingsRef,
      (snap) => {
        if (snap.exists()) {
          const data = snap.data() as SystemSettings;
          if (Array.isArray(data.organizerEmails)) {
            setDynamicOrganizerEmails(data.organizerEmails);
          }
        }
        setSettingsResolved(true);
      },
      (err) => {
        // Fallback gracefully to static cafeConfig.organizerEmails if snapshot fails
        console.warn('Could not subscribe to settings/system for organizerEmails:', err);
        setSettingsResolved(true);
      }
    );

    return () => {
      unsubscribeAuth();
      unsubscribeSettings();
    };
  }, []);

  // Initiate Google Sign-In via popup with automatic redirect fallback if blocked by browser/COOP
  const signInWithGoogle = async () => {
    try {
      await signInWithPopup(auth, googleAuthProvider);
    } catch (err) {
      // Automatically fall back to full-page OAuth redirect if the popup was blocked by browser policy
      if (shouldFallbackToRedirect(err)) {
        await signInWithRedirect(auth, googleAuthProvider);
        return;
      }
      // Ignore benign user popup closures or duplicate popup cancellations
      if (isBenignPopupCancel(err)) {
        return;
      }
      console.error('Google sign-in error:', err);
      throw err;
    }
  };

  // Sign out the current Firebase Auth session
  const signOut = async () => {
    try {
      await firebaseSignOut(auth);
    } catch (err) {
      console.error('Sign out error:', err);
      throw err;
    }
  };

  // Combine static config emails with dynamic organiser emails stored in settings/system
  const allowedOrganizers = Array.from(
    new Set([...cafeConfig.organizerEmails, ...dynamicOrganizerEmails])
  );
  const isAdmin = !!(user && user.email && isAuthorizedOrganizer(user.email, allowedOrganizers));
  const loading = !authResolved || !settingsResolved;

  return {
    user,
    isAdmin,
    loading,
    signInWithGoogle,
    signOut
  };
}

