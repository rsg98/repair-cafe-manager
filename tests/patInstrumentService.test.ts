/**
 * @file tests/patInstrumentService.test.ts
 * @description Unit test suite for PAT Instrument validation, duplicate serial detection,
 * 12-month calibration expiry calculation, and dropdown option label formatting.
 */

import { describe, it, expect } from 'vitest';
import { PAT_TESTER_SERVICE_INTERVAL } from '../src/config/cafe.config';
import { PatInstrument } from '../src/types';
import {
  validatePatInstrumentInput,
  hasDuplicatePatInstrumentSerial,
  isPatInstrumentCalibrationOverdue,
  formatPatInstrumentOptionLabel,
} from '../src/services/patInstrumentService';

// Verify the configured PAT instrument service interval constant matches the 12-month baseline
describe('PAT Instrument Service Helpers', () => {
  it('defines PAT_TESTER_SERVICE_INTERVAL as 12 months', () => {
    expect(PAT_TESTER_SERVICE_INTERVAL).toBe(12);
  });

  // Test input validation for PAT instrument display name, manufacturer, serial number, and calibration date
  describe('validatePatInstrumentInput', () => {
    it('accepts a valid instrument record with or without optional model', () => {
      // Full instrument payload including optional model and notes
      const fullResult = validatePatInstrumentInput({
        displayName: "Richard's Seaward PrimeTest 100",
        manufacturer: 'Seaward',
        model: 'PrimeTest 100',
        serialNumber: 'SW-994821',
        lastCalibratedDate: '2025-10-15',
        notes: 'Annual calibration by Lab',
      });
      // Valid inputs return { valid: true }
      expect(fullResult).toEqual({ valid: true });

      // Omitting optional model is also valid
      const withoutModel = validatePatInstrumentInput({
        displayName: 'Cafe Backup Tester',
        manufacturer: 'Kewtech',
        serialNumber: 'KT-100200',
        lastCalibratedDate: '2025-10-15',
      });
      expect(withoutModel).toEqual({ valid: true });
    });

    it('rejects empty display name, manufacturer, or serial number', () => {
      // Missing displayName should fail validation
      const missingDisplay = validatePatInstrumentInput({
        displayName: '   ',
        manufacturer: 'Seaward',
        serialNumber: 'SW-1',
        lastCalibratedDate: '2025-10-15',
      });
      expect(missingDisplay.valid).toBe(false);
      expect(missingDisplay.error).toContain('Display name is required');

      // Missing manufacturer should fail validation
      const missingMfr = validatePatInstrumentInput({
        displayName: 'Tester 1',
        manufacturer: ' ',
        serialNumber: 'SW-1',
        lastCalibratedDate: '2025-10-15',
      });
      expect(missingMfr.valid).toBe(false);
      expect(missingMfr.error).toContain('Manufacturer is required');

      // Missing serialNumber should fail validation
      const missingSerial = validatePatInstrumentInput({
        displayName: 'Tester 1',
        manufacturer: 'Seaward',
        serialNumber: '  ',
        lastCalibratedDate: '2025-10-15',
      });
      expect(missingSerial.valid).toBe(false);
      expect(missingSerial.error).toContain('Serial number is required');
    });

    it('rejects inputs exceeding Firestore rule character length limits', () => {
      // Display Name over 100 characters should be rejected
      const longDisplay = validatePatInstrumentInput({
        displayName: 'A'.repeat(101),
        manufacturer: 'Seaward',
        serialNumber: 'SW-1',
        lastCalibratedDate: '2025-10-15',
      });
      expect(longDisplay.valid).toBe(false);
      expect(longDisplay.error).toContain('100 characters');

      // Serial Number over 100 characters should be rejected
      const longSerial = validatePatInstrumentInput({
        displayName: 'Tester 1',
        manufacturer: 'Seaward',
        serialNumber: 'S'.repeat(101),
        lastCalibratedDate: '2025-10-15',
      });
      expect(longSerial.valid).toBe(false);
      expect(longSerial.error).toContain('100 characters');

      // Optional model over 100 characters should be rejected
      const longModel = validatePatInstrumentInput({
        displayName: 'Tester 1',
        manufacturer: 'Seaward',
        model: 'M'.repeat(101),
        serialNumber: 'SW-1',
        lastCalibratedDate: '2025-10-15',
      });
      expect(longModel.valid).toBe(false);
      expect(longModel.error).toContain('100 characters');
    });

    it('rejects malformed, impossible, or future calibration dates', () => {
      // Non-ISO date strings must be rejected
      const badFormat = validatePatInstrumentInput({
        displayName: 'Tester 1',
        manufacturer: 'Seaward',
        serialNumber: 'SW-1',
        lastCalibratedDate: '15/10/2025',
      });
      expect(badFormat.valid).toBe(false);
      expect(badFormat.error).toContain('YYYY-MM-DD');

      // Impossible calendar dates like February 31st must be rejected
      const impossibleDate = validatePatInstrumentInput({
        displayName: 'Tester 1',
        manufacturer: 'Seaward',
        serialNumber: 'SW-1',
        lastCalibratedDate: '2026-02-31',
      });
      expect(impossibleDate.valid).toBe(false);
      expect(impossibleDate.error).toContain('valid service/calibration date (YYYY-MM-DD)');

      // Future calibration dates relative to referenceDate must be rejected
      const refNow = new Date('2026-10-18T12:00:00Z');
      const futureDate = validatePatInstrumentInput(
        {
          displayName: 'Tester 1',
          manufacturer: 'Seaward',
          serialNumber: 'SW-1',
          lastCalibratedDate: '2026-10-19',
        },
        refNow
      );
      expect(futureDate.valid).toBe(false);
      expect(futureDate.error).toContain('future');
    });
  });

  // Test case-insensitive duplicate serial number detection across registered instruments
  describe('hasDuplicatePatInstrumentSerial', () => {
    // Sample registry containing one existing Seaward PAT instrument
    const existingInstruments: PatInstrument[] = [
      {
        id: 'inst-1',
        displayName: 'Tester 1',
        manufacturer: 'Seaward',
        model: 'PrimeTest 100',
        // Canonical hardware serial number and epoch ms timestamps
        serialNumber: 'SW-994821',
        lastCalibratedDate: '2025-11-01',
        createdAt: 1730419200000,
        updatedAt: 1730419200000,
      },
    ];

    it('detects duplicate serial numbers case-insensitively and ignores whitespace', () => {
      // Lowercase and padded serial number still collides with SW-994821
      expect(hasDuplicatePatInstrumentSerial('  sw-994821 ', existingInstruments)).toBe(true);
      // Distinct serial number does not collide
      expect(hasDuplicatePatInstrumentSerial('SW-111111', existingInstruments)).toBe(false);
    });

    it('allows keeping the same serial number when editing the same instrument id', () => {
      // Passing excludeId='inst-1' ignores self-match during edits
      expect(hasDuplicatePatInstrumentSerial('SW-994821', existingInstruments, 'inst-1')).toBe(false);
    });
  });

  // Test 12-month calibration expiry calculation including boundary and leap-year edge cases
  describe('isPatInstrumentCalibrationOverdue', () => {
    it('returns false when calibration is within 12 months and true once past 12 months', () => {
      const refDate = new Date('2026-10-18T12:00:00Z');
      // Exactly 12 months ago (2025-10-18) is NOT overdue on 2026-10-18
      expect(isPatInstrumentCalibrationOverdue('2025-10-18', 12, refDate)).toBe(false);
      // 12 months + 1 day ago (2025-10-17) IS overdue on 2026-10-18
      expect(isPatInstrumentCalibrationOverdue('2025-10-17', 12, refDate)).toBe(true);
    });

    it('clamps leap-year Feb 29 calibration dates to Feb 28 in non-leap years', () => {
      // Calibrated on 2024-02-29: 12-month expiry clamps to 2025-02-28
      expect(
        isPatInstrumentCalibrationOverdue('2024-02-29', 12, new Date('2025-02-28T10:00:00Z'))
      ).toBe(false);
      // One day later on 2025-03-01, it is overdue
      expect(
        isPatInstrumentCalibrationOverdue('2024-02-29', 12, new Date('2025-03-01T10:00:00Z'))
      ).toBe(true);
    });

    it('treats missing or unparseable dates as overdue for safety', () => {
      expect(isPatInstrumentCalibrationOverdue('', 12)).toBe(true);
      expect(isPatInstrumentCalibrationOverdue('invalid-date', 12)).toBe(true);
    });
  });

  // Test dropdown label formatting for current vs overdue PAT instruments
  describe('formatPatInstrumentOptionLabel', () => {
    // Baseline Seaward instrument fixture with both manufacturer and model populated
    const baseInstrument: PatInstrument = {
      id: 'inst-1',
      displayName: "Richard's Seaward",
      manufacturer: 'Seaward',
      model: 'PrimeTest 100',
      // Hardware serial number and calibration date for label tests
      serialNumber: 'SW-994821',
      lastCalibratedDate: '2025-06-01',
      createdAt: 1717200000000,
      updatedAt: 1717200000000,
    };

    it('formats a clean label when calibration is current (with or without optional model)', () => {
      // With model present
      const label = formatPatInstrumentOptionLabel(
        baseInstrument,
        12,
        new Date('2026-01-15T12:00:00Z')
      );
      expect(label).toBe("Richard's Seaward — Seaward PrimeTest 100 (S/N: SW-994821)");

      // Without optional model
      const noModelLabel = formatPatInstrumentOptionLabel(
        { ...baseInstrument, model: undefined },
        12,
        new Date('2026-01-15T12:00:00Z')
      );
      expect(noModelLabel).toBe("Richard's Seaward — Seaward (S/N: SW-994821)");
    });

    it('adds a warning icon and [Service Overdue] suffix when calibration is overdue', () => {
      // Overdue calibration date triggers warning prefix and suffix
      const label = formatPatInstrumentOptionLabel(
        baseInstrument,
        12,
        new Date('2026-10-18T12:00:00Z')
      );
      expect(label).toBe(
        "⚠️ Richard's Seaward — Seaward PrimeTest 100 (S/N: SW-994821) [Service Overdue]"
      );
    });
  });
});
