import { useCallback, useEffect, useRef, useState } from 'react';
import { registerSW } from 'virtual:pwa-register';
import { SystemSettings } from '../types';
import { useUnsavedWork } from '../context/UnsavedWorkContext';
import {
  APP_BUILD_TIMESTAMP,
  APP_VERSION,
  canAttemptSafeReload,
  isRemoteVersionNewer,
  RELOAD_LOOP_GUARD_MS,
  RELOAD_STORAGE_KEY,
  shouldThrottleUpdateCheck,
  UPDATE_POLL_INTERVAL_MS,
} from '../services/pwaUpdateService';
import { registerVitePreloadErrorHandler } from '../utils/lazyWithRetry';

export interface UsePwaUpdateResult {
  // True when a new Service Worker is waiting in the background (or another tab activated it)
  updateAvailable: boolean;
  // True when the running build is below settings/system.minSupportedVersion
  isMandatoryUpdate: boolean;
  // True when any mounted station view or modal currently has unsaved work
  isDirty: boolean;
  // Compile-time semantic version + git commit SHA (e.g. "0.1.0+3a5f2b1")
  appVersion: string;
  // Immediately activate the waiting Service Worker and reload the page
  applyUpdateNow: () => Promise<void>;
  // Trigger a Service Worker update check (throttled to 60s unless force === true)
  checkForUpdate: (force?: boolean) => Promise<void>;
  // Temporarily hide the UpdateBanner while the user finishes a form
  dismissBanner: () => void;
  // Whether the user clicked "Later" on the current UpdateBanner
  bannerDismissed: boolean;
}

/**
 * Orchestrates cross-platform PWA updates across Web, iOS/iPadOS Safari & standalone Home Screen PWAs,
 * and Android Chrome & WebAPKs using the Smart Hybrid reload strategy:
 * - Checks for updates on startup, visibilitychange, pageshow, focus, online, 15-min interval, and Firestore version skew.
 * - Auto-applies immediately when the station is idle (`isDirty === false`).
 * - Holds the new Service Worker in `waiting` and displays `<UpdateBanner />` when `isDirty === true`,
 *   auto-applying the instant `isDirty` transitions back to `false`.
 */
export function usePwaUpdate(
  systemSettings?: SystemSettings | null
): UsePwaUpdateResult {
  const { isDirty } = useUnsavedWork();

  // State tracking whether a newly installed Service Worker is waiting to take control
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [isMandatoryUpdate, setIsMandatoryUpdate] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(false);

  // Refs to Service Worker registration, script URL, and vite-plugin-pwa's updateServiceWorker callback
  const registrationRef = useRef<ServiceWorkerRegistration | null>(null);
  const swScriptUrlRef = useRef<string>('/sw.js');
  const updateSwFnRef = useRef<((reloadPage?: boolean) => Promise<void>) | null>(
    null
  );

  // Refs for update check throttling, multi-tab controllerchange tracking, and reload deduplication
  const lastUpdateCheckMsRef = useRef<number>(0);
  const lastCheckedRemoteVersionRef = useRef<string | null>(null);
  const hadInitialControllerRef = useRef<boolean>(false);
  const hasControllerChangedRef = useRef<boolean>(false);
  const isApplyingUpdateRef = useRef<boolean>(false);
  const isDirtyRef = useRef<boolean>(isDirty);

  // Keep isDirtyRef synchronized so event listeners always read the freshest dirty state
  useEffect(() => {
    isDirtyRef.current = isDirty;
  }, [isDirty]);

  /**
   * Perform a loop-guarded hard reload of the current window.
   */
  const performSafeWindowReload = useCallback((bypassLoopGuard = false) => {
    if (typeof window === 'undefined' || !window.location) return;

    const now = Date.now();
    let lastReloadRaw: string | null = null;
    try {
      lastReloadRaw = sessionStorage.getItem(RELOAD_STORAGE_KEY);
    } catch {
      lastReloadRaw = null;
    }

    // Guard against back-to-back automatic reload loops within RELOAD_LOOP_GUARD_MS (30s)
    if (
      !bypassLoopGuard &&
      !canAttemptSafeReload(lastReloadRaw, now, RELOAD_LOOP_GUARD_MS)
    ) {
      return;
    }

    try {
      sessionStorage.setItem(RELOAD_STORAGE_KEY, String(now));
    } catch {
      // Ignore sessionStorage errors in restricted/private contexts
    }

    window.location.reload();
  }, []);

  /**
   * Activate the waiting Service Worker (`SKIP_WAITING`) and reload the application.
   * Handles the multi-tab case where another tab already activated the Service Worker
   * (causing `registration.waiting` to be `null`).
   */
  const applyUpdateNow = useCallback(
    async (isManualClick = false) => {
      if (isApplyingUpdateRef.current) return;

      // Guard automatic updates against reload loops within the 30-second cooldown window
      const now = Date.now();
      let lastReloadRaw: string | null = null;
      try {
        lastReloadRaw = sessionStorage.getItem(RELOAD_STORAGE_KEY);
      } catch {
        lastReloadRaw = null;
      }
      if (
        !isManualClick &&
        !canAttemptSafeReload(lastReloadRaw, now, RELOAD_LOOP_GUARD_MS)
      ) {
        return;
      }

      isApplyingUpdateRef.current = true;

      try {
        // Record the reload timestamp in sessionStorage before triggering SKIP_WAITING
        try {
          sessionStorage.setItem(RELOAD_STORAGE_KEY, String(now));
        } catch {
          // Ignore storage errors in restricted contexts
        }

        const reg = registrationRef.current;

        // If a waiting Service Worker exists, ask vite-plugin-pwa to post SKIP_WAITING
        if (reg?.waiting && updateSwFnRef.current) {
          // Fallback timer ensures the page reloads even if controllerchange does not fire within 1.5s
          setTimeout(() => {
            performSafeWindowReload(true);
          }, 1500);

          await updateSwFnRef.current(true);
          return;
        }

        // If another tab already activated the SW (`hasControllerChangedRef` or `reg.waiting === null`), reload directly
        performSafeWindowReload(true);
      } finally {
        // Reset guard after 2 seconds in case navigation was blocked in tests
        setTimeout(() => {
          isApplyingUpdateRef.current = false;
        }, 2000);
      }
    },
    [performSafeWindowReload]
  );

  /**
   * Query the server for an updated `/sw.js` with `cache: 'no-store'` and invoke `registration.update()`.
   * Respects the 60-second throttle window unless `force === true`.
   */
  const checkForUpdate = useCallback(async (force = false) => {
    // Skip network checks when offline
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      return;
    }

    const reg = registrationRef.current;
    if (!reg) return;

    // If a waiting worker is already staged, surface it immediately without another network round-trip
    if (reg.waiting) {
      setUpdateAvailable(true);
      return;
    }

    const now = Date.now();
    if (shouldThrottleUpdateCheck(lastUpdateCheckMsRef.current, now, force)) {
      return;
    }
    lastUpdateCheckMsRef.current = now;

    try {
      // Bypass browser HTTP cache on iOS WebKit and Android Chrome before calling reg.update()
      const swUrl = swScriptUrlRef.current || '/sw.js';
      const resp = await fetch(swUrl, {
        cache: 'no-store',
        headers: {
          cache: 'no-store',
          'cache-control': 'no-cache',
        },
      });

      if (resp?.status === 200) {
        await reg.update();
        if (reg.waiting) {
          setUpdateAvailable(true);
        }
      }
    } catch {
      // Silently ignore transient offline/network errors in community halls
    }
  }, []);

  // 1. Register the Service Worker via virtual:pwa-register and bind controllerchange + preloadError listeners
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
      return;
    }

    // Record whether a Service Worker already controlled this page on initial load
    hadInitialControllerRef.current = Boolean(
      navigator.serviceWorker.controller
    );

    const updateSw = registerSW({
      immediate: true,
      onNeedRefresh() {
        // New Service Worker has finished installing and is waiting in registration.waiting
        setBannerDismissed(false);
        setUpdateAvailable(true);
      },
      onRegisteredSW(swUrl, registration) {
        swScriptUrlRef.current = swUrl || '/sw.js';
        registrationRef.current = registration ?? null;

        // If a waiting Service Worker was already staged before mount, mark update available immediately
        if (registration?.waiting) {
          setUpdateAvailable(true);
        }
      },
      onRegisterError(err) {
        console.warn('Service Worker registration warning:', err);
      },
    });

    updateSwFnRef.current = updateSw;

    // Handle multi-tab controllerchange (when another clean tab triggers SKIP_WAITING)
    const handleControllerChange = () => {
      // Ignore the very first controller claim during initial PWA installation
      if (!hadInitialControllerRef.current) {
        hadInitialControllerRef.current = true;
        return;
      }

      hasControllerChangedRef.current = true;
      setUpdateAvailable(true);

      // If this tab has no unsaved work, reload immediately so its in-memory JS matches the new precache
      if (!isDirtyRef.current) {
        performSafeWindowReload(false);
      }
    };

    navigator.serviceWorker.addEventListener(
      'controllerchange',
      handleControllerChange
    );

    // Also listen for Vite CSS/sub-chunk preload errors after a new deployment
    const unsubPreloadError = registerVitePreloadErrorHandler(() => {
      setUpdateAvailable(true);
      if (!isDirtyRef.current) {
        performSafeWindowReload(false);
      }
    });

    return () => {
      navigator.serviceWorker.removeEventListener(
        'controllerchange',
        handleControllerChange
      );
      unsubPreloadError();
    };
  }, [performSafeWindowReload]);

  // 2. Attach cross-platform wakeup listeners (iOS/Android standalone resume, tab focus, reconnect) & 15-min poll
  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return;
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void checkForUpdate(false);
      }
    };

    const handlePageShow = () => {
      if (document.visibilityState === 'visible') {
        void checkForUpdate(false);
      }
    };

    const handleWindowFocus = () => {
      void checkForUpdate(false);
    };

    const handleOnline = () => {
      void checkForUpdate(true);
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pageshow', handlePageShow);
    window.addEventListener('focus', handleWindowFocus);
    window.addEventListener('online', handleOnline);

    // Periodic 15-minute check for kiosk tablets that stay awake on the table all afternoon
    const intervalId = window.setInterval(() => {
      if (
        document.visibilityState === 'visible' &&
        (typeof navigator === 'undefined' || navigator.onLine !== false)
      ) {
        void checkForUpdate(false);
      }
    }, UPDATE_POLL_INTERVAL_MS);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pageshow', handlePageShow);
      window.removeEventListener('focus', handleWindowFocus);
      window.removeEventListener('online', handleOnline);
      window.clearInterval(intervalId);
    };
  }, [checkForUpdate]);

  // 3. React to real-time version skew signals from Firestore `settings/system` (zero extra reads)
  useEffect(() => {
    if (!systemSettings) return;

    const versionCheck = isRemoteVersionNewer(
      APP_VERSION,
      APP_BUILD_TIMESTAMP,
      systemSettings
    );

    setIsMandatoryUpdate(versionCheck.isBelowMinVersion);

    if (!versionCheck.isNewer) {
      return;
    }

    // Deduplicate forced update checks per distinct remote version + timestamp combination
    const remoteKey = `${versionCheck.remoteVersion ?? ''}_${versionCheck.remoteBuildTimestamp ?? 0}`;
    if (
      lastCheckedRemoteVersionRef.current === remoteKey ||
      updateAvailable
    ) {
      return;
    }
    lastCheckedRemoteVersionRef.current = remoteKey;

    // If Service Workers are supported, trigger an unthrottled check so the new SW downloads & stages in waiting.
    // Note: We wait for onNeedRefresh (`updateAvailable === true`) before reloading so we never reload into a stale SW cache.
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      void checkForUpdate(true);
    } else if (!isDirtyRef.current) {
      // Fallback for browsers where Service Workers are disabled/unsupported
      performSafeWindowReload(false);
    } else {
      setUpdateAvailable(true);
    }
  }, [
    systemSettings,
    updateAvailable,
    checkForUpdate,
    performSafeWindowReload,
  ]);

  // 4. Smart Hybrid Coordinator: Auto-apply waiting update whenever `updateAvailable` is true AND `isDirty` is false
  useEffect(() => {
    if (updateAvailable && !isDirty) {
      void applyUpdateNow(false);
    }
  }, [updateAvailable, isDirty, applyUpdateNow]);

  const dismissBanner = useCallback(() => {
    setBannerDismissed(true);
  }, []);

  const handleManualApplyUpdate = useCallback(async () => {
    await applyUpdateNow(true);
  }, [applyUpdateNow]);

  return {
    updateAvailable,
    isMandatoryUpdate,
    isDirty,
    appVersion: APP_VERSION,
    applyUpdateNow: handleManualApplyUpdate,
    checkForUpdate,
    dismissBanner,
    bannerDismissed,
  };
}
