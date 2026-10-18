/**
 * @file tests/repairService.test.ts
 * @description Unit test suite for pure helper functions, state machine transitions,
 * card token conflict detection, wait time formatting, take-home confirmation gating,
 * and photo metadata sanitization in `src/services/repairService.ts`.
 */

import { describe, it, expect } from 'vitest';
import { SessionAnalytics, ItemStatus, RepairItem, RepairOutcome } from '../src/types';
import { exportAnalyticsToCsv } from '../src/services/analyticsService';
import { 
  removeUndefined, 
  checkCardConflict, 
  filterRepairs, 
  isTerminalStatus, 
  canAssignCard,
  getDefaultPowerTypeForCategory,
  WAIT_TIME_REFRESH_INTERVAL_MS,
  getRegistrationTimestamp,
  sortRepairsByRegistration,
  getWaitTimeMinutes,
  formatWaitTime,
  requiresTakeHomeConfirmation,
  calculateNextStatusOnRepair
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
    expect(csv).toContain('Attending Volunteers');
    expect(csv).toContain('"202610-seears","October 2026 - Seears Park","2026-10-09",42,31,5,4,2,0,74%,68.4,1140,32,22,22,9%,0');
  });

  it('exports non-zero volunteerCount in the 17th CSV column', () => {
    const csv = exportAnalyticsToCsv([
      {
        ...sampleAnalytics[0],
        volunteerCount: 11,
      },
    ]);
    expect(csv).toContain('"202610-seears","October 2026 - Seears Park","2026-10-09",42,31,5,4,2,0,74%,68.4,1140,32,22,22,9%,11');
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
        category: 'TEXTILES',
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

    const hashPrefixedResults = filterRepairs(sampleRepairs, '#5', 'ALL');
    expect(hashPrefixedResults.length).toBe(1);
    expect(hashPrefixedResults[0].id).toBe('rep-5');
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
    it('defaults non-powered categories (TEXTILES, WOODWORK, MECHANICAL) to NOT_APPLICABLE', () => {
      expect(getDefaultPowerTypeForCategory('TEXTILES')).toBe('NOT_APPLICABLE');
      expect(getDefaultPowerTypeForCategory('WOODWORK')).toBe('NOT_APPLICABLE');
      expect(getDefaultPowerTypeForCategory('MECHANICAL')).toBe('NOT_APPLICABLE');
    });

    it('checks that TEXTILE and WOOD return NOT_APPLICABLE as well', () => {
      expect(getDefaultPowerTypeForCategory('TEXTILE' as any)).toBe('NOT_APPLICABLE');
      expect(getDefaultPowerTypeForCategory('textile' as any)).toBe('NOT_APPLICABLE');
      expect(getDefaultPowerTypeForCategory('WOOD' as any)).toBe('NOT_APPLICABLE');
      expect(getDefaultPowerTypeForCategory('wood' as any)).toBe('NOT_APPLICABLE');
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

  describe('Front Desk First-Come-First-Served Queue Order & Wait Time (Issue #21)', () => {
    it('defines a 5-minute refresh interval constant (300,000 ms)', () => {
      expect(WAIT_TIME_REFRESH_INTERVAL_MS).toBe(5 * 60 * 1000);
      expect(WAIT_TIME_REFRESH_INTERVAL_MS).toBe(300000);
    });

    it('extracts registration timestamp from createdAt or falls back to REG-<timestamp>', () => {
      expect(getRegistrationTimestamp({ createdAt: 1729166400000 })).toBe(1729166400000);
      expect(
        getRegistrationTimestamp({
          createdAt: undefined,
          registrationId: 'REG-1729166460000'
        })
      ).toBe(1729166460000);
      expect(
        getRegistrationTimestamp({
          createdAt: undefined,
          id: 'REG-1729166520000_1'
        })
      ).toBe(1729166520000);
      expect(
        getRegistrationTimestamp({
          createdAt: undefined,
          registrationId: 'reg-legacy',
          id: 'rep-1'
        })
      ).toBeNull();
    });

    it('orders repairs strictly on a first-come, first-served basis regardless of referenceToken or cardNumber', () => {
      const baseTime = 1729166400000; // 10:00:00
      const unsortedQueue: RepairItem[] = [
        {
          id: 'REG-1729167000000_1',
          sessionId: 'sess-1',
          registrationId: 'REG-1729167000000',
          referenceToken: 'REF-AAAA', // alphabetically first token, but registered 3rd (10:10)
          cardNumber: 1, // lowest card number, but registered 3rd
          customerName: 'Third Customer',
          status: 'WAITING_REPAIR',
          item: {
            category: 'ELECTRICAL',
            brandModel: 'Lamp',
            faultDescription: 'Flickering',
            powerType: 'MAINS_240V'
          },
          createdAt: baseTime + 10 * 60 * 1000
        },
        {
          id: 'REG-1729166400000_1',
          sessionId: 'sess-1',
          registrationId: 'REG-1729166400000',
          referenceToken: 'REF-ZZZZ', // alphabetically last token, unassigned card, but registered 1st (10:00)
          cardNumber: null,
          customerName: 'First Customer',
          status: 'REGISTERED',
          item: {
            category: 'TEXTILES',
            brandModel: 'Jacket',
            faultDescription: 'Torn sleeve',
            powerType: 'NOT_APPLICABLE'
          },
          createdAt: baseTime
        },
        {
          id: 'REG-1729166700000_1',
          sessionId: 'sess-1',
          registrationId: 'REG-1729166700000',
          referenceToken: 'REF-MMMM', // registered 2nd (10:05) with Tablet B card #51
          cardNumber: 51,
          customerName: 'Second Customer',
          status: 'WAITING_PAT1',
          item: {
            category: 'ELECTRICAL',
            brandModel: 'Toaster',
            faultDescription: 'Trips RCD',
            powerType: 'MAINS_240V'
          },
          createdAt: baseTime + 5 * 60 * 1000
        }
      ];

      const sorted = sortRepairsByRegistration(unsortedQueue);
      expect(sorted.map((r) => r.customerName)).toEqual([
        'First Customer',
        'Second Customer',
        'Third Customer'
      ]);

      // Also verify filterRepairs preserves first-come, first-served ordering
      const filtered = filterRepairs(unsortedQueue, '', 'ALL');
      expect(filtered.map((r) => r.customerName)).toEqual([
        'First Customer',
        'Second Customer',
        'Third Customer'
      ]);
    });

    it('calculates and formats wait time accurately as the 5-minute refresh clock advances', () => {
      const registeredAt = 1729166400000;
      const item = {
        id: 'REG-1729166400000_1',
        registrationId: 'REG-1729166400000',
        createdAt: registeredAt
      };

      // At registration time (0m)
      expect(getWaitTimeMinutes(item, registeredAt)).toBe(0);
      expect(formatWaitTime(item, registeredAt)).toBe('0m');

      // After 1st 5-minute refresh (5m)
      const after5Min = registeredAt + WAIT_TIME_REFRESH_INTERVAL_MS;
      expect(getWaitTimeMinutes(item, after5Min)).toBe(5);
      expect(formatWaitTime(item, after5Min)).toBe('5m');

      // After 9 refreshes (45m)
      const after45Min = registeredAt + 9 * WAIT_TIME_REFRESH_INTERVAL_MS;
      expect(getWaitTimeMinutes(item, after45Min)).toBe(45);
      expect(formatWaitTime(item, after45Min)).toBe('45m');

      // After 12 refreshes (1h)
      const after60Min = registeredAt + 12 * WAIT_TIME_REFRESH_INTERVAL_MS;
      expect(getWaitTimeMinutes(item, after60Min)).toBe(60);
      expect(formatWaitTime(item, after60Min)).toBe('1h');

      // After 17 refreshes (1h 25m)
      const after85Min = registeredAt + 17 * WAIT_TIME_REFRESH_INTERVAL_MS;
      expect(getWaitTimeMinutes(item, after85Min)).toBe(85);
      expect(formatWaitTime(item, after85Min)).toBe('1h 25m');

      // Clamps slightly future timestamps to 0m
      expect(getWaitTimeMinutes(item, registeredAt - 30000)).toBe(0);
      expect(formatWaitTime(item, registeredAt - 30000)).toBe('0m');

      // Returns em-dash when no registration timestamp exists
      expect(getWaitTimeMinutes({ createdAt: undefined })).toBeNull();
      expect(formatWaitTime({ createdAt: undefined })).toBe('—');
      expect(formatWaitTime(null)).toBe('—');
    });
  });

  describe('Fixer Take-Home Confirmation & Photo Metadata (Issue #4)', () => {
    it('requires confirmation modal ONLY when outcome is TAKEN_HOME and routes both mains and non-mains items to TAKEN_HOME', () => {
      // Enumerate all standard in-hall repair outcomes that should bypass the take-home confirmation modal.
      const nonTakeHomeOutcomes: RepairOutcome[] = [
        'FIXED',
        'PARTIAL',
        'UNFIXABLE',
        'ADVICE_GIVEN',
      ];

      // Verify that selecting TAKEN_HOME triggers the confirmation modal gate while all other outcomes do not.
      expect(requiresTakeHomeConfirmation('TAKEN_HOME')).toBe(true);
      for (const outcome of nonTakeHomeOutcomes) {
        expect(requiresTakeHomeConfirmation(outcome)).toBe(false);
      }

      // Confirm that TAKEN_HOME transitions directly to TAKEN_HOME terminal custody status regardless of mains vs battery power.
      expect(calculateNextStatusOnRepair('TAKEN_HOME', true)).toBe('TAKEN_HOME');
      expect(calculateNextStatusOnRepair('TAKEN_HOME', false)).toBe('TAKEN_HOME');
    });

    it('preserves photoCount: 0 and photoCount: 2 while stripping undefined photoCount', () => {
      // Verify that an explicit zero photo count is preserved so Firestore reflects that all photos were deleted or none were attached.
      const zeroPhotos = removeUndefined({
        fixerName: 'Alice',
        outcome: 'FIXED',
        photoCount: 0,
      });
      expect(zeroPhotos).toEqual({
        fixerName: 'Alice',
        outcome: 'FIXED',
        photoCount: 0,
      });

      // Verify that a positive photoCount (such as the 2-photo maximum) survives undefined key stripping intact.
      const twoPhotos = removeUndefined({
        fixerName: 'Alice',
        outcome: 'FIXED',
        photoCount: 2,
      });
      expect(twoPhotos).toEqual({
        fixerName: 'Alice',
        outcome: 'FIXED',
        photoCount: 2,
      });

      // Verify that an omitted/undefined photoCount is stripped cleanly so Firestore never throws an unsupported undefined value error.
      const undefinedPhotos = removeUndefined({
        fixerName: 'Alice',
        outcome: 'FIXED',
        photoCount: undefined,
      });
      expect(undefinedPhotos).toEqual({
        fixerName: 'Alice',
        outcome: 'FIXED',
      });
      expect('photoCount' in undefinedPhotos).toBe(false);
    });
  });
});



