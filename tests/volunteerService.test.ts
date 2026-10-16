import { describe, it, expect } from 'vitest';
import {
  validateVolunteerInput,
  hasDuplicateVolunteerName,
  toSessionVolunteerSummary,
  mergeOrganiserEmails,
  getQualifiedPatTesters,
} from '../src/services/volunteerService';
import { Volunteer, SessionVolunteerSummary } from '../src/types';

describe('Volunteer Service Validation & Pure Helpers', () => {
  // Base valid volunteer fixture for testing
  const validInput = {
    name: 'Alice Smith',
    phone: '07700 900123',
    email: 'alice@example.com',
    emergencyContactName: 'Bob Smith',
    emergencyContactPhone: '07700 900456',
    emergencyContactRelationship: 'Spouse',
    isOrganiser: false,
    isPatTrained: true,
    inducted: true,
  };

  describe('validateVolunteerInput', () => {
    it('accepts a valid volunteer input record', () => {
      // Check valid regular volunteer
      const result = validateVolunteerInput(validInput);
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('rejects missing mandatory fields (name, emergencyContactName, emergencyContactPhone)', () => {
      // Missing volunteer name
      expect(validateVolunteerInput({ ...validInput, name: '   ' }).valid).toBe(false);
      // Missing emergency contact name
      expect(
        validateVolunteerInput({ ...validInput, emergencyContactName: '' }).valid
      ).toBe(false);
      // Missing emergency contact phone
      expect(
        validateVolunteerInput({ ...validInput, emergencyContactPhone: '  ' }).valid
      ).toBe(false);
    });

    it('enforces that emergencyContactName is another person (cannot match volunteer name)', () => {
      // Case-insensitive match against volunteer's own name
      const samePerson = validateVolunteerInput({
        ...validInput,
        name: 'Alice Smith',
        emergencyContactName: '  alice smith ',
      });
      expect(samePerson.valid).toBe(false);
      expect(samePerson.error).toContain('another person');
    });

    it('enforces that emergencyContactPhone does not match the volunteer phone number', () => {
      // Matching phone numbers with different spacing
      const samePhone = validateVolunteerInput({
        ...validInput,
        phone: '07700 900123',
        emergencyContactPhone: '07700900123',
      });
      expect(samePhone.valid).toBe(false);
      expect(samePhone.error).toContain('different from the volunteer');
    });

    it('requires a valid email address when isOrganiser is true', () => {
      // Organiser without email fails validation
      const missingEmail = validateVolunteerInput({
        ...validInput,
        isOrganiser: true,
        email: '',
      });
      expect(missingEmail.valid).toBe(false);
      expect(missingEmail.error).toContain('Email address is required');

      // Organiser with valid email passes validation
      const withEmail = validateVolunteerInput({
        ...validInput,
        isOrganiser: true,
        email: 'organiser@suttonrepaircafe.org.uk',
      });
      expect(withEmail.valid).toBe(true);
    });
  });

  describe('hasDuplicateVolunteerName', () => {
    // Sample existing register
    const existing: Array<Pick<Volunteer, 'id' | 'name'>> = [
      { id: 'vol-1', name: 'Alice Smith' },
      { id: 'vol-2', name: 'Dave Fixer' },
    ];

    it('detects case-insensitive and whitespace-padded duplicate names', () => {
      expect(hasDuplicateVolunteerName('  alice smith ', existing)).toBe(true);
      expect(hasDuplicateVolunteerName('Charlie Brown', existing)).toBe(false);
    });

    it('allows editing an existing volunteer when excludeId matches their own id', () => {
      expect(hasDuplicateVolunteerName('Alice Smith', existing, 'vol-1')).toBe(false);
      expect(hasDuplicateVolunteerName('Dave Fixer', existing, 'vol-1')).toBe(true);
    });
  });

  describe('toSessionVolunteerSummary (PII Stripping)', () => {
    it('projects only non-PII operational fields and strips phone, email, and emergency contacts', () => {
      // Full Volunteer record containing sensitive contact fields
      const fullVolunteer: Volunteer = {
        id: 'vol-1',
        name: 'Alice Smith',
        phone: '07700 900123',
        email: 'alice@example.com',
        emergencyContactName: 'Bob Smith',
        emergencyContactPhone: '07700 900456',
        emergencyContactRelationship: 'Spouse',
        isOrganiser: true,
        isPatTrained: true,
        inducted: true,
        inductedAt: 1700000000000,
        inductedBy: 'admin@example.com',
        createdAt: 1700000000000,
        updatedAt: 1700000000000,
      };

      // Convert to session summary
      const summary = toSessionVolunteerSummary(fullVolunteer);
      expect(summary).toEqual({
        id: 'vol-1',
        name: 'Alice Smith',
        isPatTrained: true,
        isOrganiser: true,
        inducted: true,
      });

      // Verify zero PII leakage onto public Session document summary
      expect('phone' in summary).toBe(false);
      expect('email' in summary).toBe(false);
      expect('emergencyContactName' in summary).toBe(false);
      expect('emergencyContactPhone' in summary).toBe(false);
      expect('emergencyContactRelationship' in summary).toBe(false);
    });
  });

  describe('mergeOrganiserEmails', () => {
    it('merges static config emails with active organiser volunteer emails and deduplicates', () => {
      // Static config entries and volunteer records
      const staticEmails = ['Admin@Example.com', '@suttonrepaircafe.org.uk'];
      const volunteers: Array<Pick<Volunteer, 'isOrganiser' | 'email'>> = [
        { isOrganiser: true, email: 'NewOrg@gmail.com ' },
        { isOrganiser: true, email: 'admin@example.com' },
        { isOrganiser: false, email: 'regular.fixer@gmail.com' },
      ];

      // Merge and normalize
      const merged = mergeOrganiserEmails(staticEmails, volunteers);
      expect(merged).toEqual([
        'admin@example.com',
        '@suttonrepaircafe.org.uk',
        'neworg@gmail.com',
      ]);
      expect(merged).not.toContain('regular.fixer@gmail.com');
    });
  });

  describe('getQualifiedPatTesters', () => {
    it('filters attending volunteers to isPatTrained: true and sorts alphabetically', () => {
      // Mixed attending volunteers
      const attending: SessionVolunteerSummary[] = [
        { id: '1', name: 'Zoe Tester', isPatTrained: true, isOrganiser: false, inducted: true },
        { id: '2', name: 'Bob Fixer', isPatTrained: false, isOrganiser: false, inducted: true },
        { id: '3', name: 'Alan Tester', isPatTrained: true, isOrganiser: true, inducted: false },
      ];

      // Filter and sort
      const testers = getQualifiedPatTesters(attending);
      expect(testers.map((t) => t.name)).toEqual(['Alan Tester', 'Zoe Tester']);
      expect(getQualifiedPatTesters(undefined)).toEqual([]);
    });
  });
});
