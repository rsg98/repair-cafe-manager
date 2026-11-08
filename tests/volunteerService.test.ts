import { describe, it, expect } from 'vitest';
import {
  validateVolunteerInput,
  hasDuplicateVolunteerName,
  toSessionVolunteerSummary,
  mergeOrganiserEmails,
  getQualifiedPatTesters,
  formatArchivedVolunteerName,
  canArchiveVolunteer,
  validateArchiveConfirmationName,
  buildArchivedVolunteerRecord,
  filterActiveVolunteers,
  normalizeUkPhoneNumber,
  sha256Hex,
  hashNormalizedPhone,
  resolveWhatsAppStatusOnSave,
  formatWhatsAppDeepLink,
  requiresWhatsAppArchiveDecision,
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

    it('requires a valid phone number when whatsappOptIn is true, and allows missing phone/email when opted out (Issue #43)', () => {
      // Opted-in without phone fails validation
      const optedInNoPhone = validateVolunteerInput({
        ...validInput,
        phone: '',
        whatsappOptIn: true,
      });
      expect(optedInNoPhone.valid).toBe(false);
      expect(optedInNoPhone.error).toContain('WhatsApp');

      // Opted-in with valid phone succeeds
      const optedInWithPhone = validateVolunteerInput({
        ...validInput,
        phone: '07700 900123',
        whatsappOptIn: true,
      });
      expect(optedInWithPhone.valid).toBe(true);

      // Opted-out with neither phone nor email succeeds (flagged in UI as Alt Comms: No Contact Info)
      const optedOutNoContact = validateVolunteerInput({
        ...validInput,
        phone: '',
        email: '',
        whatsappOptIn: false,
      });
      expect(optedOutNoContact.valid).toBe(true);
    });
  });

  describe('hasDuplicateVolunteerName', () => {
    // Sample existing register
    const existing: Array<Pick<Volunteer, 'id' | 'name' | 'archived'>> = [
      { id: 'vol-1', name: 'Alice Smith' },
      { id: 'vol-2', name: 'Dave Fixer' },
      { id: 'vol-3', name: 'Bob R', archived: true },
    ];

    it('detects case-insensitive and whitespace-padded duplicate names', () => {
      expect(hasDuplicateVolunteerName('  alice smith ', existing)).toBe(true);
      expect(hasDuplicateVolunteerName('Charlie Brown', existing)).toBe(false);
    });

    it('allows editing an existing volunteer when excludeId matches their own id', () => {
      expect(hasDuplicateVolunteerName('Alice Smith', existing, 'vol-1')).toBe(false);
      expect(hasDuplicateVolunteerName('Dave Fixer', existing, 'vol-1')).toBe(true);
    });

    it('ignores archived volunteer records when checking for duplicate names', () => {
      expect(hasDuplicateVolunteerName('Bob R', existing)).toBe(false);
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
    it('merges static config emails with active organiser volunteer emails and deduplicates while ignoring archived volunteers', () => {
      // Static config entries and volunteer records
      const staticEmails = ['Admin@Example.com', '@suttonrepaircafe.org.uk'];
      const volunteers: Array<Pick<Volunteer, 'isOrganiser' | 'email' | 'archived'>> = [
        { isOrganiser: true, email: 'NewOrg@gmail.com ' },
        { isOrganiser: true, email: 'admin@example.com' },
        { isOrganiser: false, email: 'regular.fixer@gmail.com' },
        { isOrganiser: true, email: 'archived.org@gmail.com', archived: true },
      ];

      // Merge and normalize
      const merged = mergeOrganiserEmails(staticEmails, volunteers);
      expect(merged).toEqual([
        'admin@example.com',
        '@suttonrepaircafe.org.uk',
        'neworg@gmail.com',
      ]);
      expect(merged).not.toContain('regular.fixer@gmail.com');
      expect(merged).not.toContain('archived.org@gmail.com');
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

  describe('Volunteer Archival & GDPR Redaction (Issue #35)', () => {
    const sampleVolunteer: Volunteer = {
      id: 'vol-alice',
      name: 'Alice Smith',
      phone: '07700 900123',
      email: 'alice@example.com',
      emergencyContactName: 'Bob Smith',
      emergencyContactPhone: '07700 900456',
      emergencyContactRelationship: 'Spouse',
      isOrganiser: false,
      isPatTrained: true,
      inducted: true,
      inductedAt: 1700000000000,
      inductedBy: 'admin@example.com',
      createdAt: 1700000000000,
      updatedAt: 1700000000000,
    };

    describe('formatArchivedVolunteerName', () => {
      it('formats full names to First Name and Initial of Surname only', () => {
        expect(formatArchivedVolunteerName('Alice Smith')).toBe('Alice S');
        expect(formatArchivedVolunteerName('  Alice   Mary   Thompson  ')).toBe(
          'Alice T'
        );
        expect(formatArchivedVolunteerName('Sue Spenceley-Burch')).toBe('Sue S');
        expect(formatArchivedVolunteerName('Garreth')).toBe('Garreth');
        expect(formatArchivedVolunteerName('')).toBe('');
      });
    });

    describe('canArchiveVolunteer', () => {
      it('allows archiving a regular non-organiser active volunteer', () => {
        expect(
          canArchiveVolunteer({ isOrganiser: false, archived: false })
        ).toEqual({ allowed: true });
      });

      it('prevents archiving a volunteer who is enabled as an organiser', () => {
        const check = canArchiveVolunteer({
          isOrganiser: true,
          archived: false,
        });
        expect(check.allowed).toBe(false);
        expect(check.reason).toContain('organiser');
      });

      it('prevents archiving a volunteer who is already archived', () => {
        const check = canArchiveVolunteer({
          isOrganiser: false,
          archived: true,
        });
        expect(check.allowed).toBe(false);
        expect(check.reason).toContain('already archived');
      });
    });

    describe('validateArchiveConfirmationName', () => {
      it('requires the organiser to enter the volunteer full name (case-insensitive, normalised whitespace)', () => {
        expect(
          validateArchiveConfirmationName('Alice Smith', 'Alice Smith')
        ).toBe(true);
        expect(
          validateArchiveConfirmationName('Alice Smith', '  alice   smith ')
        ).toBe(true);
        expect(validateArchiveConfirmationName('Alice Smith', 'Alice S')).toBe(
          false
        );
        expect(validateArchiveConfirmationName('Alice Smith', 'Alice')).toBe(
          false
        );
        expect(validateArchiveConfirmationName('Alice Smith', '')).toBe(false);
      });
    });

    describe('buildArchivedVolunteerRecord', () => {
      it('retains volunteer ID and skills while redacting surname, phone, email, and emergency contacts', () => {
        const archivedAt = 1715000000000;
        const archived = buildArchivedVolunteerRecord(
          sampleVolunteer,
          archivedAt
        );

        expect(archived.id).toBe('vol-alice');
        expect(archived.name).toBe('Alice S');
        expect(archived.archived).toBe(true);
        expect(archived.archivedAt).toBe(archivedAt);
        expect(archived.updatedAt).toBe(archivedAt);
        expect(archived.isOrganiser).toBe(false);
        expect(archived.isPatTrained).toBe(true);
        expect(archived.inducted).toBe(true);

        // Verify GDPR removal of contact and emergency contact information
        expect(archived.phone).toBeUndefined();
        expect(archived.email).toBeUndefined();
        expect(archived.emergencyContactName).toBe('');
        expect(archived.emergencyContactPhone).toBe('');
        expect(archived.emergencyContactRelationship).toBeUndefined();
        // Verify one-way SHA-256 phoneHash is retained for CLI WhatsApp reconciliation
        expect(archived.phoneHash).toBe(hashNormalizedPhone('07700 900123'));
        expect(archived.whatsappOptIn).toBe(false);
        expect(archived.whatsappStatus).toBe('NOT_APPLICABLE');
      });

      it('preserves social WhatsApp membership (ADDED) and phoneHash when whatsappDisposition is KEEP_SOCIAL (Issue #43)', () => {
        const archivedSocial = buildArchivedVolunteerRecord(
          {
            ...sampleVolunteer,
            whatsappOptIn: true,
            whatsappStatus: 'ADDED',
          },
          1715000000000,
          { whatsappDisposition: 'KEEP_SOCIAL' }
        );

        expect(archivedSocial.phone).toBeUndefined();
        expect(archivedSocial.phoneHash).toBe(
          hashNormalizedPhone('+44 7700 900123')
        );
        expect(archivedSocial.whatsappOptIn).toBe(true);
        expect(archivedSocial.whatsappStatus).toBe('ADDED');
      });

      it('throws if attempting to archive a volunteer who still has the organiser flag enabled', () => {
        expect(() =>
          buildArchivedVolunteerRecord({
            ...sampleVolunteer,
            isOrganiser: true,
          })
        ).toThrow(/organiser/i);
      });
    });

    describe('filterActiveVolunteers', () => {
      it('excludes archived volunteers so they do not appear in live session or default register lists', () => {
        const list = [
          { ...sampleVolunteer, id: 'vol-1', name: 'Alice Smith' },
          {
            ...sampleVolunteer,
            id: 'vol-2',
            name: 'Bob R',
            archived: true,
            archivedAt: 1715000000000,
          },
          { ...sampleVolunteer, id: 'vol-3', name: 'Charlie Fixer', archived: false },
        ];

        const active = filterActiveVolunteers(list);
        expect(active.map((v) => v.id)).toEqual(['vol-1', 'vol-3']);
      });
    });

    describe('WhatsApp Phone Normalisation, Deep-Links & Sync State Machine (Issue #43)', () => {
      it('normalises UK domestic and international phone formats to E.164', () => {
        expect(normalizeUkPhoneNumber('07700 900123')).toBe('+447700900123');
        expect(normalizeUkPhoneNumber('+44 (0) 7700-900123')).toBe('+447700900123');
        expect(normalizeUkPhoneNumber('0044 7700 900123')).toBe('+447700900123');
        expect(normalizeUkPhoneNumber('447700900123')).toBe('+447700900123');
        expect(normalizeUkPhoneNumber('not-a-phone')).toBeNull();
      });

      it('computes deterministic FIPS 180-4 SHA-256 digests and phone hashes', () => {
        // Known NIST SHA-256 vector for "abc"
        expect(sha256Hex('abc')).toBe(
          'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
        );
        expect(hashNormalizedPhone('07700 900123')).toBe(
          hashNormalizedPhone('+44 7700 900123')
        );
      });

      it('transitions WhatsApp status accurately when opting in or out', () => {
        expect(resolveWhatsAppStatusOnSave({ whatsappOptIn: true })).toBe(
          'PENDING_ADD'
        );
        expect(
          resolveWhatsAppStatusOnSave({
            whatsappOptIn: true,
            markAddedImmediately: true,
          })
        ).toBe('ADDED');
        expect(
          resolveWhatsAppStatusOnSave({
            whatsappOptIn: true,
            currentStatus: 'ADDED',
          })
        ).toBe('ADDED');
        // Opting out after being ADDED flags PENDING_REMOVAL
        expect(
          resolveWhatsAppStatusOnSave({
            whatsappOptIn: false,
            currentStatus: 'ADDED',
          })
        ).toBe('PENDING_REMOVAL');
        // Opting out while still PENDING_ADD returns to NOT_APPLICABLE
        expect(
          resolveWhatsAppStatusOnSave({
            whatsappOptIn: false,
            currentStatus: 'PENDING_ADD',
          })
        ).toBe('NOT_APPLICABLE');
      });

      it('builds 1-to-1 wa.me deep-links with welcome message and optional group invite URL', () => {
        const link = formatWhatsAppDeepLink({
          phone: '07700 900123',
          volunteerName: 'Alice Smith',
          cafeName: 'Sutton Repair Café',
          groupInviteUrl: 'https://chat.whatsapp.com/ABC123XYZ',
        });
        expect(link).toContain('https://wa.me/447700900123?text=');
        expect(decodeURIComponent(link!)).toContain('Hi Alice');
        expect(decodeURIComponent(link!)).toContain(
          'https://chat.whatsapp.com/ABC123XYZ'
        );
      });

      it('identifies when archiving a volunteer requires a WhatsApp group disposition choice', () => {
        expect(
          requiresWhatsAppArchiveDecision({
            whatsappOptIn: false,
            whatsappStatus: 'NOT_APPLICABLE',
          })
        ).toBe(false);
        expect(
          requiresWhatsAppArchiveDecision({
            whatsappOptIn: true,
            whatsappStatus: 'ADDED',
          })
        ).toBe(true);
      });
    });
  });
});
