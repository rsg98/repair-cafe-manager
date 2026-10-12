import { describe, it, expect } from 'vitest';
import { SessionAnalytics, ItemStatus, RepairItem } from '../src/types';
import { exportAnalyticsToCsv } from '../src/services/analyticsService';
import { 
  removeUndefined, 
  checkCardConflict, 
  filterRepairs, 
  isTerminalStatus, 
  canAssignCard,
  getDefaultPowerTypeForCategory
} from '../src/services/repairService';

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

describe('Front Desk Repairs Filtering and Search (filterRepairs - Issue #12)', () => {
  const sampleRepairs: RepairItem[] = [
    {
      id: 'rep-1',
      sessionId: 'sess-1',
      registrationId: 'reg-1',
      referenceToken: 'REF-A38F',
      cardNumber: 1,
      customerName: 'Sarah Jenkins',
      status: 'WAITING_PAT1',
      item: {
        category: 'ELECTRICAL',
        brandModel: 'Russell Hobbs Toaster',
        faultDescription: 'No power',
        powerType: 'MAINS_240V'
      }
    },
    {
      id: 'rep-2',
      sessionId: 'sess-1',
      registrationId: 'reg-2',
      referenceToken: 'REF-B42C',
      cardNumber: 2,
      customerName: 'Gordon Freeman',
      status: 'IN_PAT1',
      item: {
        category: 'ELECTRICAL',
        brandModel: 'Dyson Vacuum',
        faultDescription: 'Cord frayed',
        powerType: 'MAINS_240V'
      }
    },
    {
      id: 'rep-3',
      sessionId: 'sess-1',
      registrationId: 'reg-3',
      referenceToken: 'REF-C99D',
      cardNumber: 3,
      customerName: 'David Miller',
      status: 'WAITING_REPAIR',
      item: {
        category: 'MECHANICAL',
        brandModel: 'Bicycle Gear Cable',
        faultDescription: 'Slipping chain',
        powerType: 'MECHANICAL'
      }
    },
    {
      id: 'rep-4',
      sessionId: 'sess-1',
      registrationId: 'reg-4',
      referenceToken: 'REF-E55K',
      cardNumber: 4,
      customerName: 'Alice Wong',
      status: 'IN_REPAIR',
      item: {
        category: 'TEXTILE',
        brandModel: 'Winter Coat',
        faultDescription: 'Broken zipper',
        powerType: 'OTHER'
      }
    },
    {
      id: 'rep-5',
      sessionId: 'sess-1',
      registrationId: 'reg-5',
      referenceToken: 'REF-F12M',
      cardNumber: 5,
      customerName: 'Bob Clark',
      status: 'WAITING_PAT2',
      item: {
        category: 'ELECTRICAL',
        brandModel: 'Sony Amplifier',
        faultDescription: 'Volume pot scratchy',
        powerType: 'MAINS_240V'
      }
    },
    {
      id: 'rep-6',
      sessionId: 'sess-1',
      registrationId: 'reg-6',
      referenceToken: 'REF-G77P',
      cardNumber: 6,
      customerName: 'Carol Danvers',
      status: 'READY_FOR_COLLECTION',
      item: {
        category: 'MECHANICAL',
        brandModel: 'Seiko Wall Clock',
        faultDescription: 'Stopped ticking',
        powerType: 'BATTERY_LOW_VOLTAGE'
      }
    },
    {
      id: 'rep-7',
      sessionId: 'sess-1',
      registrationId: 'reg-7',
      referenceToken: 'REF-H88Q',
      cardNumber: 7,
      customerName: 'Sarah Connor',
      status: 'COMPLETED',
      item: {
        category: 'ELECTRICAL',
        brandModel: 'Kettle',
        faultDescription: 'Lid latch stuck',
        powerType: 'MAINS_240V'
      }
    }
  ];

  it('searches by customer name (direct customerName on repair item)', () => {
    const results = filterRepairs(sampleRepairs, 'Sarah', 'ALL');
    expect(results.length).toBe(2);
    expect(results.map(r => r.id)).toEqual(['rep-1', 'rep-7']);
  });

  it('searches case-insensitively by partial customer name', () => {
    const results = filterRepairs(sampleRepairs, 'david', 'ALL');
    expect(results.length).toBe(1);
    expect(results[0].id).toBe('rep-3');
    expect(results[0].customerName).toBe('David Miller');
  });

  it('searches case-insensitively for full or partial customer names', () => {
    const results = filterRepairs(sampleRepairs, 'Gordon', 'ALL');
    expect(results.length).toBe(1);
    expect(results[0].id).toBe('rep-2');
    expect(results[0].referenceToken).toBe('REF-B42C');
  });

  it('searches by reference token', () => {
    const results = filterRepairs(sampleRepairs, 'REF-C99D', 'ALL');
    expect(results.length).toBe(1);
    expect(results[0].id).toBe('rep-3');
  });

  it('searches by brand/model', () => {
    const results = filterRepairs(sampleRepairs, 'dyson', 'ALL');
    expect(results.length).toBe(1);
    expect(results[0].id).toBe('rep-2');
  });

  it('searches by card number', () => {
    const results = filterRepairs(sampleRepairs, '5', 'ALL');
    expect(results.length).toBe(1);
    expect(results[0].id).toBe('rep-5');
  });

  it('filters WAITING_PAT1 including both WAITING_PAT1 and IN_PAT1 items', () => {
    const results = filterRepairs(sampleRepairs, '', 'WAITING_PAT1');
    expect(results.length).toBe(2);
    expect(results.map(r => r.id)).toEqual(['rep-1', 'rep-2']);
  });

  it('filters WAITING_REPAIR including both WAITING_REPAIR and IN_REPAIR items', () => {
    const results = filterRepairs(sampleRepairs, '', 'WAITING_REPAIR');
    expect(results.length).toBe(2);
    expect(results.map(r => r.id)).toEqual(['rep-3', 'rep-4']);
  });

  it('filters WAITING_PAT2 including both WAITING_PAT2 and IN_PAT2 items', () => {
    const results = filterRepairs(sampleRepairs, '', 'WAITING_PAT2');
    expect(results.length).toBe(1);
    expect(results[0].id).toBe('rep-5');
  });

  it('filters READY_FOR_COLLECTION accurately', () => {
    const results = filterRepairs(sampleRepairs, '', 'READY_FOR_COLLECTION');
    expect(results.length).toBe(1);
    expect(results[0].id).toBe('rep-6');
  });

  it('filters COMPLETED accurately', () => {
    const results = filterRepairs(sampleRepairs, '', 'COMPLETED');
    expect(results.length).toBe(1);
    expect(results[0].id).toBe('rep-7');
  });

  it('combines customer name search with status filtering', () => {
    // Both rep-1 and rep-7 are named Sarah, but only rep-1 is in WAITING_PAT1
    const results = filterRepairs(sampleRepairs, 'Sarah', 'WAITING_PAT1');
    expect(results.length).toBe(1);
    expect(results[0].id).toBe('rep-1');
  });

  it('handles items with missing or empty customerName gracefully', () => {
    const repairsWithMissingName: RepairItem[] = [
      {
        id: 'rep-no-name',
        sessionId: 'sess-1',
        registrationId: 'reg-none',
        referenceToken: 'REF-NONE',
        status: 'REGISTERED',
        item: {
          category: 'ELECTRICAL',
          brandModel: 'Lamp',
          faultDescription: 'No power',
          powerType: 'MAINS_240V'
        }
      }
    ];

    const results = filterRepairs(repairsWithMissingName, 'Lamp', 'ALL');
    expect(results.length).toBe(1);
    expect(results[0].id).toBe('rep-no-name');

    const noResults = filterRepairs(repairsWithMissingName, 'Alice', 'ALL');
    expect(noResults.length).toBe(0);
  });
});

describe('Terminal Status and Card Assignment Rules (Issue #5 & Issue #12)', () => {
  it('identifies terminal / completed lifecycle states accurately', () => {
    expect(isTerminalStatus('COMPLETED')).toBe(true);
    expect(isTerminalStatus('TAKEN_HOME')).toBe(true);
    expect(isTerminalStatus('UNFIXABLE')).toBe(true);

    expect(isTerminalStatus('REGISTERED')).toBe(false);
    expect(isTerminalStatus('WAITING_PAT1')).toBe(false);
    expect(isTerminalStatus('IN_PAT1')).toBe(false);
    expect(isTerminalStatus('WAITING_REPAIR')).toBe(false);
    expect(isTerminalStatus('IN_REPAIR')).toBe(false);
    expect(isTerminalStatus('WAITING_PAT2')).toBe(false);
    expect(isTerminalStatus('IN_PAT2')).toBe(false);
    expect(isTerminalStatus('READY_FOR_COLLECTION')).toBe(false);
  });

  it('permits assigning card ONLY to newly registered items awaiting a card', () => {
    // Unassigned registered items can have cards assigned
    expect(canAssignCard({ status: 'REGISTERED', cardNumber: null })).toBe(true);
    expect(canAssignCard({ status: 'REGISTERED', cardNumber: undefined })).toBe(true);

    // Registered items with a card already assigned cannot
    expect(canAssignCard({ status: 'REGISTERED', cardNumber: 4 })).toBe(false);

    // Terminal / completed items CAN NEVER have cards assigned, even without a card number
    expect(canAssignCard({ status: 'COMPLETED', cardNumber: null })).toBe(false);
    expect(canAssignCard({ status: 'COMPLETED', cardNumber: 10 })).toBe(false);
    expect(canAssignCard({ status: 'TAKEN_HOME', cardNumber: null })).toBe(false);
    expect(canAssignCard({ status: 'TAKEN_HOME', cardNumber: 12 })).toBe(false);
    expect(canAssignCard({ status: 'UNFIXABLE', cardNumber: null })).toBe(false);
    expect(canAssignCard({ status: 'UNFIXABLE', cardNumber: 14 })).toBe(false);

    // Items progressing in the active queue cannot have cards assigned
    expect(canAssignCard({ status: 'WAITING_PAT1', cardNumber: 1 })).toBe(false);
    expect(canAssignCard({ status: 'WAITING_REPAIR', cardNumber: 2 })).toBe(false);
    expect(canAssignCard({ status: 'WAITING_PAT2', cardNumber: 3 })).toBe(false);
    expect(canAssignCard({ status: 'READY_FOR_COLLECTION', cardNumber: 4 })).toBe(false);
    expect(canAssignCard({ status: 'READY_FOR_COLLECTION', cardNumber: null })).toBe(false);
  });

  it('detects card conflict with an UNFIXABLE item that used the card', () => {
    const listWithUnfixable: Array<{
      id: string;
      cardNumber?: number | null;
      status: ItemStatus;
      item?: { brandModel: string };
    }> = [
      {
        id: 'rep-unfixable',
        cardNumber: 8,
        status: 'UNFIXABLE',
        item: { brandModel: 'Dead Kettle' }
      }
    ];

    const result = checkCardConflict(8, listWithUnfixable, 'rep-other');
    expect(result.hasConflict).toBe(true);
    expect(result.conflictItem?.brandModel).toBe('Dead Kettle');
    expect(result.conflictItem?.status).toBe('UNFIXABLE');
  });

  describe('getDefaultPowerTypeForCategory', () => {
    it('defaults non-powered categories (TEXTILE, WOODWORK, MECHANICAL) to NOT_APPLICABLE', () => {
      expect(getDefaultPowerTypeForCategory('TEXTILE')).toBe('NOT_APPLICABLE');
      expect(getDefaultPowerTypeForCategory('WOODWORK')).toBe('NOT_APPLICABLE');
      expect(getDefaultPowerTypeForCategory('MECHANICAL')).toBe('NOT_APPLICABLE');
    });

    it('handles lowercase, mixed case, and common aliases', () => {
      expect(getDefaultPowerTypeForCategory('textile' as any)).toBe('NOT_APPLICABLE');
      expect(getDefaultPowerTypeForCategory('Textile' as any)).toBe('NOT_APPLICABLE');
      expect(getDefaultPowerTypeForCategory('textiles' as any)).toBe('NOT_APPLICABLE');
      expect(getDefaultPowerTypeForCategory('woodwork' as any)).toBe('NOT_APPLICABLE');
      expect(getDefaultPowerTypeForCategory('Woodwork' as any)).toBe('NOT_APPLICABLE');
      expect(getDefaultPowerTypeForCategory('wood' as any)).toBe('NOT_APPLICABLE');
      expect(getDefaultPowerTypeForCategory('mechanical' as any)).toBe('NOT_APPLICABLE');
    });

    it('defaults electrical category to MAINS_240V', () => {
      expect(getDefaultPowerTypeForCategory('ELECTRICAL')).toBe('MAINS_240V');
      expect(getDefaultPowerTypeForCategory('electrical' as any)).toBe('MAINS_240V');
    });

    it('defaults unclear categories (TOY, OTHER) to MAINS_240V as a PAT safety failsafe', () => {
      expect(getDefaultPowerTypeForCategory('TOY')).toBe('MAINS_240V');
      expect(getDefaultPowerTypeForCategory('OTHER')).toBe('MAINS_240V');
      expect(getDefaultPowerTypeForCategory('' as any)).toBe('MAINS_240V');
      expect(getDefaultPowerTypeForCategory(undefined as any)).toBe('MAINS_240V');
    });
  });
});

