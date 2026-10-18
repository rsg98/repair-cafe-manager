import { describe, it, expect } from 'vitest';
import { 
  calculateNextStatusOnCardAssign, 
  calculateNextStatusOnPatInitial, 
  calculateNextStatusOnRepair, 
  calculateNextStatusOnPatFinal,
  calculateNextStatusOnPowerTypeOverride,
  isPat2StageForItem
} from '../src/services/repairService';
import { RepairItem } from '../src/types';

describe('Repair Item Lifecycle State Machine (Production Service Tests)', () => {
  describe('Card Token Assignment & Routing', () => {
    it('routes 240V mains-powered items to initial PAT testing', () => {
      const nextStatus = calculateNextStatusOnCardAssign('MAINS_240V');
      expect(nextStatus).toBe('WAITING_PAT1');
    });

    it('routes battery / low-voltage items directly to the repair queue', () => {
      const nextStatus = calculateNextStatusOnCardAssign('BATTERY_LOW_VOLTAGE');
      expect(nextStatus).toBe('WAITING_REPAIR');
    });

    it('routes mechanical / not applicable items directly to the repair queue', () => {
      expect(calculateNextStatusOnCardAssign('MECHANICAL')).toBe('WAITING_REPAIR');
      expect(calculateNextStatusOnCardAssign('NOT_APPLICABLE')).toBe('WAITING_REPAIR');
    });
  });

  describe('PAT 1 (Pre-Repair Safety Screening)', () => {
    it('routes passed items to repair queue', () => {
      expect(calculateNextStatusOnPatInitial('PASS')).toBe('WAITING_REPAIR');
    });

    it('routes repairable cord/plug faults to repair queue for fixer attention', () => {
      expect(calculateNextStatusOnPatInitial('FAIL_REPAIRABLE_CORD')).toBe('WAITING_REPAIR');
    });

    it('quarantines catastrophic hazards immediately as UNFIXABLE', () => {
      expect(calculateNextStatusOnPatInitial('DANGER_DO_NOT_ENERGIZE')).toBe('UNFIXABLE');
    });

    it('routes untestable items to repair queue with inspection flag', () => {
      expect(calculateNextStatusOnPatInitial('UNTESTABLE')).toBe('WAITING_REPAIR');
    });
  });

  describe('Volunteer Fixer Outcomes', () => {
    it('requires post-repair PAT 2 for repaired mains items', () => {
      const nextStatus = calculateNextStatusOnRepair('FIXED', true);
      expect(nextStatus).toBe('WAITING_PAT2');
    });

    it('routes repaired non-mains items straight to customer collection', () => {
      const nextStatus = calculateNextStatusOnRepair('FIXED', false);
      expect(nextStatus).toBe('READY_FOR_COLLECTION');
    });

    it('requires post-repair PAT 2 for partially repaired mains items', () => {
      const nextStatus = calculateNextStatusOnRepair('PARTIAL', true);
      expect(nextStatus).toBe('WAITING_PAT2');
    });

    it('routes advice-given items to collection', () => {
      expect(calculateNextStatusOnRepair('ADVICE_GIVEN', true)).toBe('READY_FOR_COLLECTION');
      expect(calculateNextStatusOnRepair('ADVICE_GIVEN', false)).toBe('READY_FOR_COLLECTION');
    });

    it('marks unfixable items as UNFIXABLE', () => {
      expect(calculateNextStatusOnRepair('UNFIXABLE', false)).toBe('UNFIXABLE');
    });

    it('records TAKEN_HOME to release cafe custody under private informal contract', () => {
      expect(calculateNextStatusOnRepair('TAKEN_HOME', true)).toBe('TAKEN_HOME');
      expect(calculateNextStatusOnRepair('TAKEN_HOME', false)).toBe('TAKEN_HOME');
    });
  });

  describe('PAT 2 (Post-Repair Safety Certification)', () => {
    it('routes passed appliances to customer collection', () => {
      expect(calculateNextStatusOnPatFinal('PASS')).toBe('READY_FOR_COLLECTION');
    });

    it('returns failed appliances to repair queue for remediation', () => {
      expect(calculateNextStatusOnPatFinal('FAIL')).toBe('WAITING_REPAIR');
    });
  });

  // Verify forward and reverse power-type overrides at both PAT 1 and PAT 2 stages
  describe('PAT Power Type Override Routing (Issue #23)', () => {
    it('routes non-mains override at PAT 1 directly to WAITING_REPAIR', () => {
      // Every non-mains PowerType at PAT 1 routes directly to WAITING_REPAIR
      expect(calculateNextStatusOnPowerTypeOverride('BATTERY_LOW_VOLTAGE', false)).toBe('WAITING_REPAIR');
      expect(calculateNextStatusOnPowerTypeOverride('MECHANICAL', false)).toBe('WAITING_REPAIR');
      expect(calculateNextStatusOnPowerTypeOverride('NOT_APPLICABLE', false)).toBe('WAITING_REPAIR');
      expect(calculateNextStatusOnPowerTypeOverride('OTHER', false)).toBe('WAITING_REPAIR');
    });

    it('routes non-mains override at PAT 2 directly to READY_FOR_COLLECTION', () => {
      // Every non-mains PowerType at PAT 2 routes directly to READY_FOR_COLLECTION
      expect(calculateNextStatusOnPowerTypeOverride('BATTERY_LOW_VOLTAGE', true)).toBe('READY_FOR_COLLECTION');
      expect(calculateNextStatusOnPowerTypeOverride('MECHANICAL', true)).toBe('READY_FOR_COLLECTION');
      expect(calculateNextStatusOnPowerTypeOverride('NOT_APPLICABLE', true)).toBe('READY_FOR_COLLECTION');
      expect(calculateNextStatusOnPowerTypeOverride('OTHER', true)).toBe('READY_FOR_COLLECTION');
    });

    it('routes MAINS_240V override to WAITING_PAT1 or WAITING_PAT2 based on stage', () => {
      // Upgrading to MAINS_240V preserves the appropriate pre- or post-repair PAT stage
      expect(calculateNextStatusOnPowerTypeOverride('MAINS_240V', false)).toBe('WAITING_PAT1');
      expect(calculateNextStatusOnPowerTypeOverride('MAINS_240V', true)).toBe('WAITING_PAT2');
    });
  });

  // Verify stage detection for PAT 2 including post-repair reverse overrides
  describe('PAT 2 Stage Detection (isPat2StageForItem)', () => {
    // Baseline RepairItem fixture with numeric epoch timestamps
    const baseRepairItem: RepairItem = {
      id: 'item-1',
      sessionId: 'sess-1',
      registrationId: 'reg-1',
      referenceToken: 'REF-2327',
      // Card #7 waiting for initial PAT 1 inspection
      cardNumber: 7,
      status: 'WAITING_PAT1',
      createdAt: 1760781600000,
      updatedAt: 1760781600000,
      // Default item descriptor before any repair or PAT 2 record
      item: {
        category: 'ELECTRICAL',
        brandModel: 'Dyson Vacuum',
        faultDescription: 'Cuts out',
        powerType: 'MAINS_240V',
      },
    };

    it('returns true for items in WAITING_PAT2, IN_PAT2, or with existing patFinal', () => {
      // Standard PAT 2 queue states return true
      expect(isPat2StageForItem({ ...baseRepairItem, status: 'WAITING_PAT2' })).toBe(true);
      expect(isPat2StageForItem({ ...baseRepairItem, status: 'IN_PAT2' })).toBe(true);

      // Re-testing an item that already has a patFinal record also resolves as PAT 2
      expect(
        isPat2StageForItem({
          ...baseRepairItem,
          status: 'READY_FOR_COLLECTION',
          patFinal: {
            testerName: 'Bob',
            instrumentSerial: 'SW-994821',
            visualPass: true,
            fuseRatingAmps: 13,
            // Complete BS 1363 PAT 2 fields with numeric testedAt timestamp
            insulationResistanceMOhms: 199.9,
            outcome: 'PASS',
            testedAt: 1760785200000,
          },
        })
      ).toBe(true);
    });

    it('returns true for reverse-override items at READY_FOR_COLLECTION after FIXED or PARTIAL repair', () => {
      // Non-mains item repaired as FIXED went straight to READY_FOR_COLLECTION; bringing to PAT is PAT 2
      expect(
        isPat2StageForItem({
          ...baseRepairItem,
          status: 'READY_FOR_COLLECTION',
          repair: {
            fixerName: 'Alice',
            repairTimeMinutes: 30,
            // Completed FIXED outcome with numeric repairedAt timestamp
            outcome: 'FIXED',
            diagnosis: 'Replaced cord',
            repairNotes: 'Tested ok',
            repairedAt: 1760784300000,
          },
        })
      ).toBe(true);

      // ADVICE_GIVEN at READY_FOR_COLLECTION is not a post-repair PAT 2 candidate
      expect(
        isPat2StageForItem({
          ...baseRepairItem,
          status: 'READY_FOR_COLLECTION',
          repair: {
            fixerName: 'Alice',
            repairTimeMinutes: 15,
            // Advice-only outcome does not trigger post-repair PAT 2 certification
            outcome: 'ADVICE_GIVEN',
            diagnosis: 'Needs part',
            repairNotes: 'Ordered',
            repairedAt: 1760784300000,
          },
        })
      ).toBe(false);
    });
  });
});

