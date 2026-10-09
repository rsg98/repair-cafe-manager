import { describe, it, expect } from 'vitest';
import { 
  calculateNextStatusOnCardAssign, 
  calculateNextStatusOnPatInitial, 
  calculateNextStatusOnRepair, 
  calculateNextStatusOnPatFinal 
} from '../src/services/repairService';

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

    it('routes mechanical / textile items directly to the repair queue', () => {
      expect(calculateNextStatusOnCardAssign('MECHANICAL')).toBe('WAITING_REPAIR');
      expect(calculateNextStatusOnCardAssign('TEXTILE')).toBe('WAITING_REPAIR');
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
});
