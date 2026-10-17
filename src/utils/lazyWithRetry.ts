import React from 'react';
import {
  canAttemptSafeReload,
  RELOAD_LOOP_GUARD_MS,
  RELOAD_STORAGE_KEY,
} from '../services/pwaUpdateService';

// Wait time (ms) before retrying a failed dynamic chunk import in memory
const IN_MEMORY_RETRY_DELAY_MS = 300;

export interface ChunkRetryEnv {
  // Whether the browser currently has network connectivity (boolean or getter function)
  isOnline?: boolean | (() => boolean);
  // Optional direct storage getter for unit tests
  getStorageItem?: (key: string) => string | null;
  // Optional direct storage setter for unit tests
  setStorageItem?: (key: string, value: string) => void;
  // sessionStorage-compatible interface for recording the reload loop guard timestamp
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
  // Function that triggers a hard browser reload (defaults to window.location.reload)
  reload?: () => void;
  // Current timestamp in milliseconds (number or getter function, defaults to Date.now())
  now?: number | (() => number);
  // Delay in milliseconds before the in-memory retry (defaults to 300ms)
  retryDelayMs?: number;
}

/**
 * Inspect an unknown thrown error to determine whether it was caused by a failed
 * dynamic module import or missing Vite CSS/JS chunk after a new deployment.
 */
export function isChunkLoadError(error: unknown): boolean {
  if (!error) return false;

  // Extract name and message from Error instances or stringified rejections
  const name =
    typeof error === 'object' && 'name' in error
      ? String((error as { name?: unknown }).name ?? '')
      : '';
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'object' && 'message' in error
        ? String((error as { message?: unknown }).message ?? '')
        : String(error);

  const combined = `${name} ${message}`.toLowerCase();

  // Match Chromium, WebKit (iOS/macOS Safari), and Firefox dynamic import failure signatures
  return (
    combined.includes('chunkloaderror') ||
    combined.includes('failed to fetch dynamically imported module') ||
    combined.includes('importing a module script failed') ||
    combined.includes('error loading dynamically imported module') ||
    combined.includes('unable to preload css') ||
    combined.includes('failed to load module script')
  );
}

/**
 * Pause execution for `ms` milliseconds before retrying a transient chunk fetch.
 */
function delay(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute a dynamic module `importer` with one in-memory retry and a loop-guarded
 * hard reload fallback when online. Accepts an optional `env` override for unit testing in Node.
 */
export async function loadChunkWithRetry<T>(
  importer: () => Promise<T>,
  _chunkKey?: string,
  env?: ChunkRetryEnv
): Promise<T> {
  try {
    // Attempt initial dynamic import
    return await importer();
  } catch (firstError: unknown) {
    // Immediately rethrow non-chunk errors so application bugs are not masked
    if (!isChunkLoadError(firstError)) {
      throw firstError;
    }

    // Wait briefly and retry once in memory in case of a brief Wi-Fi hiccup in the hall
    const retryDelay = env?.retryDelayMs ?? IN_MEMORY_RETRY_DELAY_MS;
    await delay(retryDelay);

    try {
      return await importer();
    } catch (secondError: unknown) {
      // Resolve runtime environment defaults safely across both Browser and Node (Vitest)
      const isOnline =
        typeof env?.isOnline === 'function'
          ? env.isOnline()
          : (env?.isOnline ??
            (typeof navigator !== 'undefined' &&
            typeof navigator.onLine === 'boolean'
              ? navigator.onLine
              : true));
      const storage =
        env?.storage !== undefined
          ? env.storage
          : typeof sessionStorage !== 'undefined'
            ? sessionStorage
            : null;
      const now =
        typeof env?.now === 'function' ? env.now() : (env?.now ?? Date.now());
      const reload =
        env?.reload ??
        (() => {
          if (typeof window !== 'undefined' && window.location) {
            window.location.reload();
          }
        });

      // Read prior reload timestamp from injected getter or sessionStorage (ignoring storage quota/security errors)
      let lastReloadRaw: string | null = null;
      try {
        if (env?.getStorageItem) {
          lastReloadRaw = env.getStorageItem(RELOAD_STORAGE_KEY);
        } else if (storage) {
          lastReloadRaw = storage.getItem(RELOAD_STORAGE_KEY);
        }
      } catch {
        lastReloadRaw = null;
      }

      // If the device is online and has not auto-reloaded in the last 30s, reload to fetch the new index.html
      if (
        isOnline &&
        canAttemptSafeReload(lastReloadRaw, now, RELOAD_LOOP_GUARD_MS)
      ) {
        try {
          if (env?.setStorageItem) {
            env.setStorageItem(RELOAD_STORAGE_KEY, String(now));
          } else {
            storage?.setItem(RELOAD_STORAGE_KEY, String(now));
          }
        } catch {
          // Ignore storage write errors in private browsing mode
        }

        // Trigger full page reload and return a pending promise while the browser navigates
        reload();
        return new Promise<T>(() => {
          // Intentionally never settles while window.location.reload() is in flight
        });
      }

      // If offline or already reloaded within the 30s cooldown, surface to ChunkErrorBoundary
      throw secondError;
    }
  }
}

/**
 * Drop-in replacement for `React.lazy()` that wraps dynamic route imports with
 * `loadChunkWithRetry` to recover gracefully when an updated deployment replaces hashed chunks.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyWithRetry<T extends React.ComponentType<any>>(
  importer: () => Promise<{ default: T }>,
  chunkKey?: string
): React.LazyExoticComponent<T> {
  return React.lazy(() => loadChunkWithRetry(importer, chunkKey));
}

/**
 * Attach a listener for Vite's `vite:preloadError` window event, which fires when a
 * `<link rel="modulepreload">` or lazy CSS chunk returns 404 after a new deployment.
 */
export function registerVitePreloadErrorHandler(
  onPreloadError: (event: Event) => void
): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }

  // Forward Vite preload errors to the caller's safe reload / update handler
  const handler = (event: Event) => {
    onPreloadError(event);
  };

  window.addEventListener('vite:preloadError', handler);
  return () => {
    window.removeEventListener('vite:preloadError', handler);
  };
}
