import { SystemSettings } from '../types';

// Resolve compile-time version string injected by vite.config.ts (with safe test/dev fallback)
export const APP_VERSION: string =
  typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0-dev';

// Resolve compile-time epoch timestamp (ms) injected by vite.config.ts
export const APP_BUILD_TIMESTAMP: number =
  typeof __APP_BUILD_TIMESTAMP__ !== 'undefined'
    ? Number(__APP_BUILD_TIMESTAMP__)
    : 0;

// Minimum interval (60 seconds) between visibility/focus-triggered Service Worker update checks
export const UPDATE_CHECK_THROTTLE_MS = 60_000;

// Periodic background polling interval (15 minutes) for long-running station kiosk tablets
export const UPDATE_POLL_INTERVAL_MS = 15 * 60_000;

// Minimum cooldown (30 seconds) between automatic page reloads to prevent reload loops
export const RELOAD_LOOP_GUARD_MS = 30_000;

// Tolerance window (60 seconds) for build-time vs publish-time clock skew
export const BUILD_TIMESTAMP_TOLERANCE_MS = 60_000;

// sessionStorage key used to track the last automatic reload timestamp across page loads
export const RELOAD_STORAGE_KEY = 'rcm_last_auto_reload_ts';

export interface RemoteVersionCheckResult {
  // True when Firestore settings/system advertises a newer deployed build than the running client
  isNewer: boolean;
  // True when the running client's semantic version is strictly below settings/system.minSupportedVersion
  isBelowMinVersion: boolean;
  // Remote version string reported in settings/system
  remoteVersion?: string;
  // Remote build timestamp (ms) reported in settings/system
  remoteBuildTimestamp?: number;
}

/**
 * Strip build metadata (`+sha`) and prerelease suffixes (`-dev`) to extract `[major, minor, patch]`.
 */
function parseBaseSemver(versionStr: string): [number, number, number] {
  // Remove leading 'v', build metadata (+...), and pre-release tags (-...)
  const cleaned = versionStr
    .trim()
    .replace(/^v/i, '')
    .split('+')[0]
    .split('-')[0];
  const parts = cleaned.split('.');

  // Parse each numeric segment with a fallback to 0 for malformed inputs
  const major = Number.parseInt(parts[0] ?? '0', 10);
  const minor = Number.parseInt(parts[1] ?? '0', 10);
  const patch = Number.parseInt(parts[2] ?? '0', 10);

  return [
    Number.isNaN(major) ? 0 : major,
    Number.isNaN(minor) ? 0 : minor,
    Number.isNaN(patch) ? 0 : patch,
  ];
}

/**
 * Compare two semantic version strings (`a` vs `b`), ignoring `+gitsha` build metadata.
 * Returns `-1` if `a < b`, `1` if `a > b`, and `0` if equal.
 */
export function compareSemver(a: string, b: string): number {
  const [aMaj, aMin, aPatch] = parseBaseSemver(a);
  const [bMaj, bMin, bPatch] = parseBaseSemver(b);

  // Compare major version first, then minor, then patch
  if (aMaj !== bMaj) return aMaj < bMaj ? -1 : 1;
  if (aMin !== bMin) return aMin < bMin ? -1 : 1;
  if (aPatch !== bPatch) return aPatch < bPatch ? -1 : 1;
  return 0;
}

/**
 * Determine whether a visibility/focus Service Worker update check should be throttled.
 * Always returns `false` (do not throttle) when `force === true` or on the very first check (`lastCheckMs <= 0`).
 */
export function shouldThrottleUpdateCheck(
  lastCheckMs: number,
  nowMs: number,
  force = false
): boolean {
  // Bypass throttling when forced (e.g. Firestore version skew signal) or never checked yet
  if (force || lastCheckMs <= 0) {
    return false;
  }

  // Throttle if fewer than UPDATE_CHECK_THROTTLE_MS (60s) have elapsed since last check
  const elapsed = nowMs - lastCheckMs;
  return elapsed >= 0 && elapsed < UPDATE_CHECK_THROTTLE_MS;
}

/**
 * Evaluate whether Firestore `settings/system` advertises a newer deployed build
 * or a mandatory `minSupportedVersion` floor higher than the local client's build.
 */
export function isRemoteVersionNewer(
  localVersion: string,
  localBuildTimestamp: number,
  remoteSettings?: SystemSettings | null
): RemoteVersionCheckResult {
  // If remote settings have not loaded yet, no remote skew can be inferred
  if (!remoteSettings) {
    return { isNewer: false, isBelowMinVersion: false };
  }

  const remoteVersion = remoteSettings.deployedVersion?.trim() || undefined;
  const remoteBuildTimestamp =
    typeof remoteSettings.deployedBuildTimestamp === 'number' &&
    Number.isFinite(remoteSettings.deployedBuildTimestamp)
      ? remoteSettings.deployedBuildTimestamp
      : undefined;

  // Check if the running client falls below a mandatory minimum semantic version floor
  const isBelowMinVersion = Boolean(
    remoteSettings.minSupportedVersion &&
      compareSemver(localVersion, remoteSettings.minSupportedVersion) < 0
  );

  // Check if the remote build timestamp is strictly newer (beyond clock-skew tolerance)
  const hasNewerTimestamp =
    remoteBuildTimestamp !== undefined &&
    localBuildTimestamp > 0 &&
    remoteBuildTimestamp > localBuildTimestamp + BUILD_TIMESTAMP_TOLERANCE_MS;

  // Check if the version string (including git SHA) differs and the remote timestamp is not older
  const hasDifferentVersionNotOlder =
    Boolean(remoteVersion && remoteVersion !== localVersion) &&
    (remoteBuildTimestamp === undefined ||
      localBuildTimestamp <= 0 ||
      remoteBuildTimestamp + BUILD_TIMESTAMP_TOLERANCE_MS >= localBuildTimestamp);

  return {
    isNewer: isBelowMinVersion || hasNewerTimestamp || hasDifferentVersionNotOlder,
    isBelowMinVersion,
    remoteVersion,
    remoteBuildTimestamp,
  };
}

/**
 * Determine whether an authenticated organiser client should publish its compile-time
 * `deployedVersion` and `deployedBuildTimestamp` to `settings/system`.
 */
export function shouldPublishAppVersion(
  localVersion: string,
  localBuildTimestamp: number,
  remoteSettings?: SystemSettings | null,
  isDev: boolean = Boolean(import.meta.env?.DEV)
): boolean {
  // Never publish local development builds (`vite dev` or `-dev` version strings) to shared Firestore settings/system
  if (
    isDev ||
    !localVersion ||
    localVersion === '0.0.0-dev' ||
    localVersion.endsWith('-dev') ||
    localBuildTimestamp <= 0
  ) {
    return false;
  }

  // Publish immediately if settings/system has no version metadata recorded yet
  if (
    !remoteSettings ||
    !remoteSettings.deployedVersion ||
    typeof remoteSettings.deployedBuildTimestamp !== 'number'
  ) {
    return true;
  }

  // Publish if the admin client's build timestamp is newer than what is recorded in Firestore
  if (
    localBuildTimestamp >
    remoteSettings.deployedBuildTimestamp + BUILD_TIMESTAMP_TOLERANCE_MS
  ) {
    return true;
  }

  // Also publish if the version string (git SHA) differs and the local build is at least as recent
  if (
    remoteSettings.deployedVersion !== localVersion &&
    localBuildTimestamp + BUILD_TIMESTAMP_TOLERANCE_MS >=
      remoteSettings.deployedBuildTimestamp
  ) {
    return true;
  }

  return false;
}

/**
 * Guard automatic page reloads with a cooldown window (`RELOAD_LOOP_GUARD_MS` = 30s)
 * so the application can never enter an infinite reload loop.
 */
export function canAttemptSafeReload(
  lastReloadTimestampRaw: string | null | undefined,
  nowMs: number,
  cooldownMs: number = RELOAD_LOOP_GUARD_MS
): boolean {
  // Allow reload if no prior automatic reload timestamp exists in sessionStorage
  if (!lastReloadTimestampRaw) {
    return true;
  }

  // Parse the stored timestamp and allow reload if invalid or outside the cooldown window
  const lastReloadMs = Number.parseInt(lastReloadTimestampRaw, 10);
  if (Number.isNaN(lastReloadMs) || lastReloadMs <= 0) {
    return true;
  }

  // Block reload if we already reloaded within the last `cooldownMs` milliseconds
  return nowMs - lastReloadMs >= cooldownMs;
}
