import { describe, it, expect } from 'vitest';
import { generateReferenceToken } from '../src/services/repairService';
import { calculateSessionAnalytics } from '../src/services/sessionService';
import { RepairItem } from '../src/types';

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
  const sampleRepairs: RepairItem[] = [
    {
      id: 'rep-1',
      sessionId: 'sess-100',
      registrationId: 'reg-1',
      referenceToken: 'REF-A38F',
      cardNumber: 1,
      status: 'COMPLETED',
      item: {
        category: 'ELECTRICAL',
        brandModel: 'Russell Hobbs Toaster',
        faultDescription: 'Will not stay down',
        powerType: 'MAINS_240V',
        weightKg: 1.5
      },
      patInitial: {
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
        fixerName: 'Fixer Dave',
        repairTimeMinutes: 30,
        outcome: 'FIXED'
      }
    },
    {
      id: 'rep-2',
      sessionId: 'sess-100',
      registrationId: 'reg-2',
      referenceToken: 'REF-B49C',
      cardNumber: 2,
      status: 'COMPLETED',
      item: {
        category: 'ELECTRICAL',
        brandModel: 'Morphy Richards Kettle',
        powerType: 'MAINS_240V',
        faultDescription: 'Dead',
        weightKg: 1.2
      },
      patInitial: {
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
        fixerName: 'Fixer Alice',
        repairTimeMinutes: 45,
        outcome: 'PARTIAL'
      }
    },
    {
      id: 'rep-3',
      sessionId: 'sess-100',
      registrationId: 'reg-3',
      referenceToken: 'REF-C50D',
      cardNumber: 3,
      status: 'UNFIXABLE',
      item: {
        category: 'MECHANICAL',
        brandModel: 'Clock',
        powerType: 'OTHER',
        faultDescription: 'Broken cog',
        weightKg: 0.8
      },
      repair: {
        fixerName: 'Fixer Bob',
        repairTimeMinutes: 15,
        outcome: 'UNFIXABLE'
      }
    },
    {
      id: 'rep-4',
      sessionId: 'sess-100',
      registrationId: 'reg-4',
      referenceToken: 'REF-D61E',
      cardNumber: 4,
      status: 'COMPLETED',
      item: {
        category: 'TEXTILES',
        brandModel: 'Winter Coat',
        powerType: 'NOT_APPLICABLE',
        faultDescription: 'Torn seam',
        weightKg: 1.0
      },
      repair: {
        fixerName: 'Fixer Sarah',
        repairTimeMinutes: 30,
        outcome: 'ADVICE_GIVEN'
      }
    }
  ];

  it('aggregates counts, success rates, durations, and weights accurately', () => {
    const analytics = calculateSessionAnalytics(
      'sess-100',
      'Test Session',
      '2026-10-09',
      sampleRepairs,
      123456
    );

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
    const emptyAnalytics = calculateSessionAnalytics(
      'sess-empty',
      'Empty Session',
      '2026-10-09',
      [],
      123456
    );

    expect(emptyAnalytics.totalItems).toBe(0);
    expect(emptyAnalytics.successRatePercent).toBe(0);
    expect(emptyAnalytics.averageRepairTimeMinutes).toBe(0);
    expect(emptyAnalytics.patFailureRatePercent).toBe(0);
    expect(emptyAnalytics.totalWeightDivertedKg).toBe(0);
    expect(emptyAnalytics.volunteerCount).toBe(0);
  });
});
