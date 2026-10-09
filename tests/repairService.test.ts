import { describe, it, expect } from 'vitest';
import { SessionAnalytics } from '../src/types';
import { exportAnalyticsToCsv } from '../src/services/analyticsService';
import { removeUndefined } from '../src/services/repairService';

describe('Analytics and CSV Export Utilities', () => {
  const sampleAnalytics: SessionAnalytics[] = [
    {
      sessionId: '202610-seears',
      sessionName: 'October 2026 - Seears Park',
      date: '2026-10-09',
      totalItems: 42,
      repairedCount: 31,
      partialCount: 5,
      unfixableCount: 4,
      adviceCount: 2,
      takenHomeCount: 0,
      totalRepairTimeMinutes: 1140, // 19 hours
      averageRepairTimeMinutes: 32,
      successRatePercent: 74,
      totalWeightDivertedKg: 68.4,
      categoryBreakdown: { ELECTRICAL: 25, MECHANICAL: 10, TEXTILE: 7 },
      mainsItemsCount: 22,
      patTestedCount: 22,
      patFailureRatePercent: 9
    }
  ];

  it('correctly generates CSV impact reports with all required fields', () => {
    const csv = exportAnalyticsToCsv(sampleAnalytics);
    expect(csv).toContain('Session ID,Session Name,Date,Total Items');
    expect(csv).toContain('"202610-seears","October 2026 - Seears Park","2026-10-09",42,31,5,4,2,0,74%,68.4,1140,32,22,22,9%');
  });

  it('handles empty analytics lists gracefully', () => {
    const csv = exportAnalyticsToCsv([]);
    expect(csv.split('\n')).toHaveLength(1); // Only header row
  });
});

describe('Firestore Data Sanitization (removeUndefined)', () => {
  it('strips undefined and NaN fields from PAT submission objects (Issue #3)', () => {
    const patPayload = {
      status: 'WAITING_REPAIR',
      patInitial: {
        testerName: 'Bob Builder',
        instrumentSerial: 'PAT-42',
        visualPass: true,
        fuseRatingAmps: 13,
        testVoltageVolts: 500,
        earthContinuityOhms: undefined, // Class II has no earth continuity
        insulationResistanceMOhms: 99.9,
        outcome: 'PASS',
        cautionNotes: undefined, // Blank notes left undefined
        testedAt: 123456789
      },
      updatedAt: 123456789
    };

    const cleaned = removeUndefined(patPayload);
    expect(cleaned).toEqual({
      status: 'WAITING_REPAIR',
      patInitial: {
        testerName: 'Bob Builder',
        instrumentSerial: 'PAT-42',
        visualPass: true,
        fuseRatingAmps: 13,
        testVoltageVolts: 500,
        insulationResistanceMOhms: 99.9,
        outcome: 'PASS',
        testedAt: 123456789
      },
      updatedAt: 123456789
    });

    expect('cautionNotes' in (cleaned.patInitial as Record<string, unknown>)).toBe(false);
    expect('earthContinuityOhms' in (cleaned.patInitial as Record<string, unknown>)).toBe(false);
  });

  it('preserves valid values including false, 0, null, and empty string', () => {
    const data = {
      active: false,
      count: 0,
      notes: '',
      releasedTo: null,
      badVal: undefined,
      nanVal: NaN
    };

    const cleaned = removeUndefined(data);
    expect(cleaned).toEqual({
      active: false,
      count: 0,
      notes: '',
      releasedTo: null
    });
    expect('badVal' in cleaned).toBe(false);
    expect('nanVal' in cleaned).toBe(false);
  });

  it('recursively cleans objects within arrays', () => {
    const data = [
      { id: 1, name: 'Alice', extra: undefined },
      { id: 2, name: 'Bob', score: NaN }
    ];

    const cleaned = removeUndefined(data);
    expect(cleaned).toEqual([
      { id: 1, name: 'Alice' },
      { id: 2, name: 'Bob' }
    ]);
  });
});
