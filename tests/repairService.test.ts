import { describe, it, expect } from 'vitest';
import { SessionAnalytics, ItemStatus } from '../src/types';
import { exportAnalyticsToCsv } from '../src/services/analyticsService';
import { removeUndefined, checkCardConflict } from '../src/services/repairService';

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

describe('Card Assignment Conflict Check (checkCardConflict - Issue #5)', () => {
  const existingRepairs: Array<{
    id: string;
    cardNumber?: number | null;
    status: ItemStatus;
    item?: { brandModel: string };
  }> = [
    {
      id: 'rep-1',
      cardNumber: 1,
      status: 'WAITING_REPAIR',
      item: { brandModel: 'Sony Radio' }
    },
    {
      id: 'rep-2',
      cardNumber: 2,
      status: 'COMPLETED',
      item: { brandModel: 'Bosch Toaster' }
    },
    {
      id: 'rep-3',
      cardNumber: 3,
      status: 'TAKEN_HOME',
      item: { brandModel: 'Singer Sewing Machine' }
    },
    {
      id: 'rep-4',
      cardNumber: null,
      status: 'REGISTERED',
      item: { brandModel: 'Desk Fan' }
    }
  ];

  it('detects conflict with an active item using the same card number', () => {
    const result = checkCardConflict(1, existingRepairs, 'rep-new');
    expect(result.hasConflict).toBe(true);
    expect(result.conflictItem?.brandModel).toBe('Sony Radio');
    expect(result.conflictItem?.status).toBe('WAITING_REPAIR');
  });

  it('detects conflict with a COMPLETED item using the same card number (cards not reused in session)', () => {
    const result = checkCardConflict(2, existingRepairs, 'rep-new');
    expect(result.hasConflict).toBe(true);
    expect(result.conflictItem?.brandModel).toBe('Bosch Toaster');
    expect(result.conflictItem?.status).toBe('COMPLETED');
  });

  it('detects conflict with a TAKEN_HOME item using the same card number', () => {
    const result = checkCardConflict(3, existingRepairs, 'rep-new');
    expect(result.hasConflict).toBe(true);
    expect(result.conflictItem?.brandModel).toBe('Singer Sewing Machine');
    expect(result.conflictItem?.status).toBe('TAKEN_HOME');
  });

  it('allows the same item to retain its own card number without false conflict', () => {
    const result = checkCardConflict(1, existingRepairs, 'rep-1');
    expect(result.hasConflict).toBe(false);
  });

  it('allows an unused card number to be assigned', () => {
    const result = checkCardConflict(42, existingRepairs, 'rep-new');
    expect(result.hasConflict).toBe(false);
    expect(result.conflictItem).toBeUndefined();
  });
});
