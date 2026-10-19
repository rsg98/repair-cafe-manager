import { describe, it, expect } from 'vitest';
import { generateReferenceToken } from '../src/services/repairService';
import {
  calculateSessionAnalytics,
  buildFinalizeSessionPrompt,
} from '../src/services/sessionService';
import { filterAnalyticsForReporting, exportAnalyticsToCsv } from '../src/services/analyticsService';
import { parseManageSessionsArgs } from '../src/utils/manageSessionsArgs';
import { RepairItem, SessionAnalytics } from '../src/types';

// Fallback SHA-256 implementation matching Web Crypto API logic in test environments
async function sha256Node(message: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(message.trim());
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

describe('Session Utilities and Token Generators', () => {
  it('generates well-formed 4-character alphanumeric reference tokens', () => {
    for (let i = 0; i < 20; i++) {
      const token = generateReferenceToken();
      expect(token).toMatch(/^REF-[A-Z2-9]{4}$/);
      // Ensure no easily confused characters (0, O, 1, I)
      expect(token).not.toMatch(/[0O1I]/);
    }
  });

  it('correctly hashes 4-digit PINs into 64-character SHA-256 hex strings', async () => {
    const pin = '4829';
    const hash = await sha256Node(pin);
    expect(hash).toHaveLength(64);
    // Deterministic verify
    const hash2 = await sha256Node(pin);
    expect(hash).toBe(hash2);
    // Distinct PIN gives distinct hash
    const hashOther = await sha256Node('1234');
    expect(hash).not.toBe(hashOther);
  });
});

describe('Session Analytics Aggregation (calculateSessionAnalytics)', () => {
  // Sample repair fixtures covering electrical, mechanical, and textile categories
  const sampleRepairs: RepairItem[] = [
    {
      // Item 1: Electrical mains toaster that passed PAT 1 and was fully fixed
      id: 'rep-1',
      sessionId: 'sess-100',
      registrationId: 'reg-1',
      referenceToken: 'REF-A38F',
      cardNumber: 1,
      status: 'COMPLETED',
      item: {
        // 1.5kg mains electrical item for diversion weight and PAT tallying
        category: 'ELECTRICAL',
        brandModel: 'Russell Hobbs Toaster',
        faultDescription: 'Will not stay down',
        powerType: 'MAINS_240V',
        weightKg: 1.5
      },
      patInitial: {
        // Passing initial PAT inspection record
        testedAt: 1000,
        testerName: 'PAT Tester',
        instrumentSerial: 'SER-1',
        visualPass: true,
        fuseRatingAmps: 13,
        testVoltageVolts: 500,
        insulationResistanceMOhms: 99.9,
        outcome: 'PASS'
      },
      repair: {
        // 30-minute successful repair outcome
        fixerName: 'Fixer Dave',
        repairTimeMinutes: 30,
        outcome: 'FIXED'
      }
    },
    {
      // Item 2: Electrical mains kettle with a repairable cord fault and partial repair
      id: 'rep-2',
      sessionId: 'sess-100',
      registrationId: 'reg-2',
      referenceToken: 'REF-B49C',
      cardNumber: 2,
      status: 'COMPLETED',
      item: {
        // 1.2kg mains electrical item
        category: 'ELECTRICAL',
        brandModel: 'Morphy Richards Kettle',
        powerType: 'MAINS_240V',
        faultDescription: 'Dead',
        weightKg: 1.2
      },
      patInitial: {
        // Failing PAT 1 inspection (repairable cord fault)
        testedAt: 1010,
        testerName: 'PAT Tester',
        instrumentSerial: 'SER-1',
        visualPass: false,
        fuseRatingAmps: 13,
        testVoltageVolts: 500,
        insulationResistanceMOhms: 0.1,
        outcome: 'FAIL_REPAIRABLE_CORD'
      },
      repair: {
        // 45-minute partial repair outcome
        fixerName: 'Fixer Alice',
        repairTimeMinutes: 45,
        outcome: 'PARTIAL'
      }
    },
    {
      // Item 3: Non-mains mechanical clock that was unfixable
      id: 'rep-3',
      sessionId: 'sess-100',
      registrationId: 'reg-3',
      referenceToken: 'REF-C50D',
      cardNumber: 3,
      status: 'UNFIXABLE',
      item: {
        // 0.8kg mechanical item (excluded from diversion weight since unfixable)
        category: 'MECHANICAL',
        brandModel: 'Clock',
        powerType: 'OTHER',
        faultDescription: 'Broken cog',
        weightKg: 0.8
      },
      repair: {
        // 15-minute unfixable diagnostic outcome
        fixerName: 'Fixer Bob',
        repairTimeMinutes: 15,
        outcome: 'UNFIXABLE'
      }
    },
    {
      // Item 4: Textile winter coat where repair advice was given
      id: 'rep-4',
      sessionId: 'sess-100',
      registrationId: 'reg-4',
      referenceToken: 'REF-D61E',
      cardNumber: 4,
      status: 'COMPLETED',
      item: {
        // 1.0kg textile item
        category: 'TEXTILES',
        brandModel: 'Winter Coat',
        powerType: 'NOT_APPLICABLE',
        faultDescription: 'Torn seam',
        weightKg: 1.0
      },
      repair: {
        // 30-minute advice-given outcome
        fixerName: 'Fixer Sarah',
        repairTimeMinutes: 30,
        outcome: 'ADVICE_GIVEN'
      }
    }
  ];

  it('aggregates counts, success rates, durations, and weights accurately', () => {
    // Compute session analytics across the 4 sample repair items
    const analytics = calculateSessionAnalytics(
      'sess-100',
      'Test Session',
      '2026-10-09',
      sampleRepairs,
      123456
    );

    // Verify outcome breakdown counts
    expect(analytics.sessionId).toBe('sess-100');
    expect(analytics.totalItems).toBe(4);
    expect(analytics.repairedCount).toBe(1);
    expect(analytics.partialCount).toBe(1);
    expect(analytics.unfixableCount).toBe(1);
    expect(analytics.adviceCount).toBe(1);
    expect(analytics.takenHomeCount).toBe(0);

    // Success rate: (1 fixed + 1 partial) / 4 = 50%
    expect(analytics.successRatePercent).toBe(50);

    // Total weight: 1.5 + 1.2 + 0.8 + 1.0 = 4.5kg
    expect(analytics.totalWeightDivertedKg).toBe(4.5);

    // Total time: 30 + 45 + 15 + 30 = 120 min; Average = 120 / 4 = 30 min
    expect(analytics.totalRepairTimeMinutes).toBe(120);
    expect(analytics.averageRepairTimeMinutes).toBe(30);

    // PAT metrics: 2 mains items tested, 1 failed (FAIL_REPAIRABLE_CORD) = 50% failure rate
    expect(analytics.mainsItemsCount).toBe(2);
    expect(analytics.patTestedCount).toBe(2);
    expect(analytics.patFailureRatePercent).toBe(50);

    // Category breakdown
    expect(analytics.categoryBreakdown).toEqual({
      ELECTRICAL: 2,
      MECHANICAL: 1,
      TEXTILES: 1
    });

    expect(analytics.finalizedAt).toBe(123456);
    // Default volunteerCount when omitted is 0
    expect(analytics.volunteerCount).toBe(0);
  });

  it('records volunteerCount when provided to calculateSessionAnalytics', () => {
    // Pass 9 attending volunteers as the 6th parameter
    const analyticsWithVolunteers = calculateSessionAnalytics(
      'sess-100',
      'Test Session',
      '2026-10-09',
      sampleRepairs,
      123456,
      9
    );

    expect(analyticsWithVolunteers.volunteerCount).toBe(9);
  });

  it('handles empty session repairs gracefully without division by zero', () => {
    // Compute analytics for an empty repair list
    const emptyAnalytics = calculateSessionAnalytics(
      'sess-empty',
      'Empty Session',
      '2026-10-09',
      [],
      123456
    );

    // Verify all numeric ratios and totals default to 0
    expect(emptyAnalytics.totalItems).toBe(0);
    expect(emptyAnalytics.successRatePercent).toBe(0);
    expect(emptyAnalytics.averageRepairTimeMinutes).toBe(0);
    expect(emptyAnalytics.patFailureRatePercent).toBe(0);
    expect(emptyAnalytics.totalWeightDivertedKg).toBe(0);
    expect(emptyAnalytics.volunteerCount).toBe(0);
    // Default isTest flag when 7th parameter is omitted is false
    expect(emptyAnalytics.isTest).toBe(false);
  });

  it('propagates isTest flag when passed as the 7th parameter to calculateSessionAnalytics', () => {
    // Verify isTest defaults to false when omitted
    const officialAnalytics = calculateSessionAnalytics(
      'sess-official',
      'October 2026 - Seears Park',
      '2026-10-18',
      sampleRepairs,
      123456,
      8
    );
    expect(officialAnalytics.isTest).toBe(false);

    // Verify isTest is set to true when passed as true
    const rehearsalAnalytics = calculateSessionAnalytics(
      'sess-rehearsal-test',
      'October Rehearsal',
      '2026-10-17',
      sampleRepairs,
      123456,
      4,
      true
    );
    expect(rehearsalAnalytics.isTest).toBe(true);
  });
});

describe('Test Session Filtering & CSV Export (Issue #24)', () => {
  // Build sample analytics records covering legacy (undefined), official (false), and test (true)
  const legacySession: SessionAnalytics = calculateSessionAnalytics(
    '2026-08-seears',
    'August 2026 - Seears Park',
    '2026-08-15',
    [],
    1000,
    10
  );
  delete legacySession.isTest;

  // Create explicit official and test session analytics fixtures
  const officialSession: SessionAnalytics = calculateSessionAnalytics(
    '2026-09-seears',
    'September 2026 - Seears Park',
    '2026-09-19',
    [],
    2000,
    12,
    false
  );
  // Create training/test session fixture with isTest: true
  const testSession: SessionAnalytics = calculateSessionAnalytics(
    '2026-10-seears-test',
    'October Training Session',
    '2026-10-10',
    [],
    3000,
    5,
    true
  );

  const allSessions: SessionAnalytics[] = [legacySession, officialSession, testSession];

  it('excludes isTest: true sessions by default while retaining legacy and official sessions', () => {
    // Default filter excludes test sessions for public KPIs and grant reporting
    const filtered = filterAnalyticsForReporting(allSessions);
    expect(filtered).toHaveLength(2);
    expect(filtered.map((s) => s.sessionId)).toEqual(['2026-08-seears', '2026-09-seears']);
  });

  it('returns all sessions including test sessions when includeTestSessions is true', () => {
    // Organiser archive toggle includes test sessions when explicitly requested
    const allVisible = filterAnalyticsForReporting(allSessions, true);
    expect(allVisible).toHaveLength(3);
    expect(allVisible.map((s) => s.sessionId)).toContain('2026-10-seears-test');
  });

  it('excludes test sessions from CSV grant export when filtered via filterAnalyticsForReporting', () => {
    // Generate CSV from filtered official analytics list
    const officialOnly = filterAnalyticsForReporting(allSessions, false);
    const csv = exportAnalyticsToCsv(officialOnly);

    // Verify official and legacy sessions are present and test session is absent
    expect(csv).toContain('2026-08-seears');
    expect(csv).toContain('2026-09-seears');
    expect(csv).not.toContain('2026-10-seears-test');
    expect(csv).not.toContain('October Training Session');
  });
});

describe('CLI Argument Parser (parseManageSessionsArgs)', () => {
  it('parses --list, --mark-test, --unmark-test, --purge, --purge-all-test, and --project flags', () => {
    // Verify --list with optional --project flag
    expect(parseManageSessionsArgs(['--list', '--project', 'my-cafe-proj'])).toEqual({
      command: 'list',
      sessionId: undefined,
      dryRun: false,
      confirm: false,
      force: false,
      projectId: 'my-cafe-proj',
    });

    // Verify --mark-test and --unmark-test session classification flags
    expect(parseManageSessionsArgs(['--mark-test', 'sess-123']).command).toBe('mark-test');
    expect(parseManageSessionsArgs(['--mark-test', 'sess-123']).sessionId).toBe('sess-123');
    expect(parseManageSessionsArgs(['--unmark-test', 'sess-123']).command).toBe('unmark-test');

    // Verify --purge with --dry-run, --confirm, and --force combinations
    expect(parseManageSessionsArgs(['--purge', 'sess-123', '--dry-run'])).toEqual({
      command: 'purge',
      sessionId: 'sess-123',
      dryRun: true,
      confirm: false,
      force: false,
      projectId: undefined,
    });
    // Verify --purge with both --force and --confirm flags enabled
    expect(parseManageSessionsArgs(['--purge', 'sess-123', '--force', '--confirm'])).toEqual({
      command: 'purge',
      sessionId: 'sess-123',
      dryRun: false,
      confirm: true,
      force: true,
      projectId: undefined,
    });

    // Verify --purge-all-test with --dry-run and --confirm
    expect(parseManageSessionsArgs(['--purge-all-test', '--dry-run']).command).toBe('purge-all-test');
    expect(parseManageSessionsArgs(['--purge-all-test', '--confirm']).confirm).toBe(true);
  });

  it('throws descriptive errors on missing arguments or conflicting commands', () => {
    // Missing <sessionId> after session-targeted commands
    expect(() => parseManageSessionsArgs(['--mark-test'])).toThrow(/Missing required <sessionId>/);
    expect(() => parseManageSessionsArgs(['--unmark-test', '--confirm'])).toThrow(
      /Missing required <sessionId>/
    );
    expect(() => parseManageSessionsArgs(['--purge'])).toThrow(/Missing required <sessionId>/);

    // Missing <projectId> after --project flag
    expect(() => parseManageSessionsArgs(['--list', '--project'])).toThrow(
      /Missing required <projectId>/
    );
    expect(() => parseManageSessionsArgs(['--project', '--list'])).toThrow(
      /Missing required <projectId>/
    );

    // Conflicting or duplicate primary commands in a single invocation
    expect(() => parseManageSessionsArgs(['--list', '--purge-all-test'])).toThrow(
      /Conflicting commands/
    );
    expect(() => parseManageSessionsArgs(['--purge', 'sess-a', '--purge', 'sess-b'])).toThrow(
      /Conflicting commands/
    );
  });
});

describe('Finalize Session Prompt Builder (buildFinalizeSessionPrompt — Issue #29)', () => {
  it('omits the photo note when the session has 0 attached item photos', () => {
    // Generate prompt for a session with zero repair photos
    const prompt = buildFinalizeSessionPrompt('October 2026 - Seears Park', 0);

    // Verify core finalization steps are present and photo note is absent
    expect(prompt).toContain('CLOSE and FINALISE "October 2026 - Seears Park"');
    expect(prompt).toContain('REDACT all visitor customer names and phone numbers');
    expect(prompt).not.toContain('item photo');
  });

  it('clarifies that item photos remain stored in Firebase (not lost) while noting UI access ends on close', () => {
    // Verify singular phrasing for 1 attached photo
    const singlePhotoPrompt = buildFinalizeSessionPrompt('October 2026 - Seears Park', 1);
    expect(singlePhotoPrompt).toContain('1 item photo is attached to this session.');
    expect(singlePhotoPrompt).toContain('remain safely stored in Firebase after closing');
    expect(singlePhotoPrompt).toContain('not currently accessible via the UI once the session is closed');
    // Ensure misleading "photos you wish to keep" wording is no longer present
    expect(singlePhotoPrompt).not.toContain('photos you wish to keep');

    // Verify plural phrasing for multiple attached photos
    const multiPhotoPrompt = buildFinalizeSessionPrompt('October 2026 - Seears Park', 4);
    expect(multiPhotoPrompt).toContain('4 item photos are attached to this session.');
    expect(multiPhotoPrompt).toContain('remain safely stored in Firebase after closing');
  });
});


