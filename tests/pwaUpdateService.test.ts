import { describe, it, expect, vi } from 'vitest';
import {
  compareSemver,
  shouldThrottleUpdateCheck,
  isRemoteVersionNewer,
  shouldPublishAppVersion,
  canAttemptSafeReload,
  UPDATE_CHECK_THROTTLE_MS,
  RELOAD_LOOP_GUARD_MS,
  RELOAD_STORAGE_KEY,
} from '../src/services/pwaUpdateService';
import {
  isChunkLoadError,
  loadChunkWithRetry,
} from '../src/utils/lazyWithRetry';
import { SystemSettings } from '../src/types';

// Unit test suite for cross-platform PWA update evaluation and resilient chunk loading
describe('PWA Update Mechanism & Resilient Lazy Chunk Loading', () => {
  // Verify semantic version parsing and comparison across build metadata suffixes
  describe('compareSemver', () => {
    it('returns 0 when versions have identical major.minor.patch core numbers', () => {
      // Build metadata (+sha) should be ignored when comparing semver core tuples
      expect(compareSemver('1.2.3+abc1234', '1.2.3+def5678')).toBe(0);
      expect(compareSemver('v1.0.0', '1.0.0-dev')).toBe(0);
    });

    it('returns -1 when the first version is older than the second version', () => {
      // Compare major, minor, and patch increments
      expect(compareSemver('1.0.0', '2.0.0')).toBe(-1);
      expect(compareSemver('1.0.0', '1.1.0')).toBe(-1);
      expect(compareSemver('1.0.0', '1.0.1')).toBe(-1);
    });

    it('returns 1 when the first version is newer than the second version', () => {
      // Verify positive comparison across major, minor, and patch increments
      expect(compareSemver('2.0.0', '1.9.9')).toBe(1);
      expect(compareSemver('1.3.0', '1.2.9')).toBe(1);
      expect(compareSemver('1.0.2', '1.0.1')).toBe(1);
    });
  });

  // Verify 60-second throttling for foreground/visibility Service Worker update checks
  describe('shouldThrottleUpdateCheck', () => {
    it('does not throttle when force is true or when no check has occurred yet', () => {
      // Initial check (lastCheckMs <= 0) and explicit force=true must always run
      expect(shouldThrottleUpdateCheck(0, 100_000, false)).toBe(false);
      expect(shouldThrottleUpdateCheck(90_000, 100_000, true)).toBe(false);
    });

    it('throttles checks within the 60-second window and allows checks after 60 seconds', () => {
      const lastCheck = 1_000_000;
      // 30 seconds elapsed -> throttled
      expect(
        shouldThrottleUpdateCheck(lastCheck, lastCheck + 30_000, false)
      ).toBe(true);
      // Exactly 60 seconds elapsed -> allowed
      expect(
        shouldThrottleUpdateCheck(
          lastCheck,
          lastCheck + UPDATE_CHECK_THROTTLE_MS,
          false
        )
      ).toBe(false);
    });
  });

  // Verify remote Firestore settings/system version skew detection
  describe('isRemoteVersionNewer', () => {
    it('returns false when remote settings are null or lack version fields', () => {
      // Unstamped settings/system docs must not trigger false update alarms
      expect(isRemoteVersionNewer('1.0.0+aaa1111', 1_700_000_000_000, null)).toEqual({
        isNewer: false,
        isBelowMinVersion: false,
      });
      const baseSettings: SystemSettings = {
        activeSessionId: null,
        allowRegistration: true,
      };
      expect(
        isRemoteVersionNewer('1.0.0+aaa1111', 1_700_000_000_000, baseSettings)
      ).toEqual({
        isNewer: false,
        isBelowMinVersion: false,
        remoteVersion: undefined,
        remoteBuildTimestamp: undefined,
      });
    });

    it('detects when remote deployedBuildTimestamp is newer beyond the 60s skew tolerance', () => {
      const localTs = 1_700_000_000_000;
      // Remote build is 5 minutes newer with a new git SHA
      const remoteSettings: SystemSettings = {
        activeSessionId: 'sess-1',
        allowRegistration: true,
        deployedVersion: '1.0.0+bbb2222',
        deployedBuildTimestamp: localTs + 5 * 60_000,
      };
      expect(
        isRemoteVersionNewer('1.0.0+aaa1111', localTs, remoteSettings)
      ).toEqual({
        isNewer: true,
        isBelowMinVersion: false,
        remoteVersion: '1.0.0+bbb2222',
        remoteBuildTimestamp: localTs + 5 * 60_000,
      });
    });

    it('ignores minor timestamp differences within the 60s tolerance when version string matches', () => {
      const localTs = 1_700_000_000_000;
      // Same version string and within 30s tolerance -> not newer
      const remoteSettings: SystemSettings = {
        activeSessionId: 'sess-1',
        allowRegistration: true,
        deployedVersion: '1.0.0+aaa1111',
        deployedBuildTimestamp: localTs + 30_000,
      };
      expect(
        isRemoteVersionNewer('1.0.0+aaa1111', localTs, remoteSettings)
      ).toEqual({
        isNewer: false,
        isBelowMinVersion: false,
        remoteVersion: '1.0.0+aaa1111',
        remoteBuildTimestamp: localTs + 30_000,
      });
    });

    it('flags isBelowMinVersion when local semver is older than minSupportedVersion', () => {
      const localTs = 1_700_000_000_000;
      // Remote specifies minSupportedVersion: '1.2.0' while client is on '1.1.0+aaa1111'
      const remoteSettings: SystemSettings = {
        activeSessionId: 'sess-1',
        allowRegistration: true,
        deployedVersion: '1.2.0+ccc3333',
        deployedBuildTimestamp: localTs + 120_000,
        minSupportedVersion: '1.2.0',
      };
      expect(
        isRemoteVersionNewer('1.1.0+aaa1111', localTs, remoteSettings)
      ).toEqual({
        isNewer: true,
        isBelowMinVersion: true,
        remoteVersion: '1.2.0+ccc3333',
        remoteBuildTimestamp: localTs + 120_000,
      });
    });
  });

  // Verify organiser auto-publish eligibility for settings/system version metadata
  describe('shouldPublishAppVersion', () => {
    it('suppresses publishing in development mode or when local version is 0.0.0-dev', () => {
      // Never pollute production Firestore with local dev server build stamps
      expect(shouldPublishAppVersion('1.0.0+abc', 1_700_000_000_000, null, true)).toBe(
        false
      );
      expect(
        shouldPublishAppVersion('0.0.0-dev', 1_700_000_000_000, null, false)
      ).toBe(false);
    });

    it('returns true when remote settings have no version stamp or an older build timestamp', () => {
      const localTs = 1_700_000_500_000;
      // Missing remote settings -> publish
      expect(
        shouldPublishAppVersion('1.0.0+new1234', localTs, null, false)
      ).toBe(true);
      // Older remote build -> publish
      const olderRemote: SystemSettings = {
        activeSessionId: 'sess-1',
        allowRegistration: true,
        deployedVersion: '1.0.0+old0000',
        deployedBuildTimestamp: localTs - 300_000,
      };
      expect(
        shouldPublishAppVersion('1.0.0+new1234', localTs, olderRemote, false)
      ).toBe(true);
    });

    it('returns false when remote settings already match the local build or are newer', () => {
      const localTs = 1_700_000_500_000;
      // Matching remote build -> no redundant Firestore write
      const matchingRemote: SystemSettings = {
        activeSessionId: 'sess-1',
        allowRegistration: true,
        deployedVersion: '1.0.0+new1234',
        deployedBuildTimestamp: localTs,
      };
      expect(
        shouldPublishAppVersion('1.0.0+new1234', localTs, matchingRemote, false)
      ).toBe(false);
    });
  });

  // Verify 30-second reload loop guard
  describe('canAttemptSafeReload', () => {
    it('allows reload when no previous reload timestamp exists or when cooldown has expired', () => {
      const now = 1_700_000_100_000;
      // Empty storage or invalid string -> allowed
      expect(canAttemptSafeReload(null, now)).toBe(true);
      expect(canAttemptSafeReload('invalid', now)).toBe(true);
      // Cooldown expired -> allowed
      expect(
        canAttemptSafeReload(String(now - RELOAD_LOOP_GUARD_MS - 1), now)
      ).toBe(true);
    });

    it('blocks reload when a reload occurred within the 30-second cooldown window', () => {
      const now = 1_700_000_100_000;
      // Reloaded 5 seconds ago -> blocked to prevent infinite loop
      expect(canAttemptSafeReload(String(now - 5_000), now)).toBe(false);
    });
  });

  // Verify cross-browser dynamic import and CSS preload error detection
  describe('isChunkLoadError', () => {
    it('identifies Chrome, iOS WebKit/Safari, Firefox, and Vite CSS preload chunk errors', () => {
      // Chromium dynamic import failure
      expect(
        isChunkLoadError(
          new TypeError(
            'Failed to fetch dynamically imported module: https://app/assets/Fixer-a1b2.js'
          )
        )
      ).toBe(true);
      // iOS Safari / WebKit dynamic import failure
      expect(
        isChunkLoadError(new TypeError('Importing a module script failed.'))
      ).toBe(true);
      // Firefox dynamic import failure
      expect(
        isChunkLoadError(
          new TypeError('error loading dynamically imported module')
        )
      ).toBe(true);
      // Vite CSS preload failure
      expect(
        isChunkLoadError(
          new Error('Unable to preload CSS for /assets/index-99f1.css')
        )
      ).toBe(true);
    });

    it('returns false for unrelated application runtime errors', () => {
      // Standard logic errors must not be misclassified as chunk network errors
      expect(isChunkLoadError(new Error('Invalid card number'))).toBe(false);
      expect(isChunkLoadError(null)).toBe(false);
    });
  });

  // Verify resilient lazy-chunk loader retry, safe reload, and offline fallback
  describe('loadChunkWithRetry', () => {
    it('retries once in memory and succeeds when a transient network hiccup resolves', async () => {
      let attempts = 0;
      // Fail on first call with a chunk error, succeed on second call
      const importer = vi.fn(async () => {
        attempts += 1;
        if (attempts === 1) {
          throw new TypeError('Failed to fetch dynamically imported module');
        }
        return { default: 'LoadedComponent' };
      });

      const result = await loadChunkWithRetry(importer, 'FixerStationView', {
        isOnline: () => true,
        getStorageItem: () => null,
        setStorageItem: () => {},
        reload: () => {},
        now: () => 1_000_000,
        retryDelayMs: 1,
      });

      expect(result).toEqual({ default: 'LoadedComponent' });
      expect(importer).toHaveBeenCalledTimes(2);
    });

    it('triggers a safe reload and records timestamp when retry fails while online', async () => {
      // Importer persistently fails because a new deploy removed the old chunk hash
      const importer = vi.fn(async () => {
        throw new TypeError('Importing a module script failed.');
      });
      const storage = new Map<string, string>();
      const reloadSpy = vi.fn();

      // Race loadChunkWithRetry against a short timer since it returns a pending promise during reload
      const raceResult = await Promise.race([
        loadChunkWithRetry(importer, 'PatStationView', {
          isOnline: () => true,
          getStorageItem: (k) => storage.get(k) ?? null,
          setStorageItem: (k, v) => storage.set(k, v),
          reload: reloadSpy,
          now: () => 2_000_000,
          retryDelayMs: 1,
        }).then(() => 'resolved'),
        new Promise<string>((resolve) =>
          setTimeout(() => resolve('pending_during_reload'), 20)
        ),
      ]);

      expect(raceResult).toBe('pending_during_reload');
      expect(reloadSpy).toHaveBeenCalledTimes(1);
      expect(storage.get(RELOAD_STORAGE_KEY)).toBe('2000000');
    });

    it('rethrows the error to ChunkErrorBoundary when offline or inside the 30s reload cooldown', async () => {
      // Persistent chunk failure while device is offline
      const importer = vi.fn(async () => {
        throw new TypeError('Failed to fetch dynamically imported module');
      });
      const reloadSpy = vi.fn();

      // Offline case -> rethrows without reloading
      await expect(
        loadChunkWithRetry(importer, 'ReportsView', {
          isOnline: () => false,
          getStorageItem: () => null,
          setStorageItem: () => {},
          reload: reloadSpy,
          now: () => 3_000_000,
          retryDelayMs: 1,
        })
      ).rejects.toThrow('Failed to fetch dynamically imported module');
      expect(reloadSpy).not.toHaveBeenCalled();

      // Cooldown active case -> rethrows without reloading a second time within 30s
      await expect(
        loadChunkWithRetry(importer, 'ReportsView', {
          isOnline: () => true,
          getStorageItem: () => String(3_000_000 - 5_000),
          setStorageItem: () => {},
          reload: reloadSpy,
          now: () => 3_000_000,
          retryDelayMs: 1,
        })
      ).rejects.toThrow('Failed to fetch dynamically imported module');
      expect(reloadSpy).not.toHaveBeenCalled();
    });
  });
});
