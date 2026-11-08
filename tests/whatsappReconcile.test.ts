/**
 * @file tests/whatsappReconcile.test.ts
 *
 * Unit tests for `src/utils/whatsappReconcileArgs.ts` covering CLI flag parsing,
 * multi-format WhatsApp participant parsing (plain text, CSV, WhatsApp Web header copy,
 * vCard .vcf, and WhatsApp _chat.txt exports), archived volunteer social recognition via
 * `phoneHash`, unrecognised group member reporting, and Firestore reconciliation updates.
 */

import { describe, expect, it } from 'vitest';
import {
  buildWhatsAppReconciliationPlan,
  parseWhatsAppParticipantsText,
  parseWhatsAppReconcileArgs,
} from '../src/utils/whatsappReconcileArgs';
import { hashNormalizedPhone } from '../src/services/volunteerService';
import type { Volunteer } from '../src/types';

describe('whatsappReconcileArgs — CLI Argument Parsing', () => {
  it('parses --help, --file, --opt-in-matched, --dry-run, --confirm, and --project', () => {
    expect(parseWhatsAppReconcileArgs([])).toEqual({
      command: 'help',
      optInMatched: false,
      dryRun: false,
      confirm: false,
    });

    expect(
      parseWhatsAppReconcileArgs([
        '--file',
        'participants.txt',
        '--opt-in-matched',
        '--confirm',
        '--project',
        'sutton-repair-cafe',
      ])
    ).toEqual({
      command: 'reconcile',
      filePath: 'participants.txt',
      optInMatched: true,
      dryRun: false,
      confirm: true,
      projectId: 'sutton-repair-cafe',
    });

    expect(() => parseWhatsAppReconcileArgs(['--confirm'])).toThrow(
      /Missing required "--file <path>"/
    );
  });
});

describe('whatsappReconcileArgs — Multi-Format Participant Parsing', () => {
  it('parses plain text, CSV, and copied WhatsApp Web group header strings', () => {
    const raw = `
      # Copied from WhatsApp Web
      Alice Smith, 07700 900111
      +44 7700 900222, +44 7700 900333, You
      ~ Bob Fixer
    `;
    const parsed = parseWhatsAppParticipantsText(raw);
    expect(parsed.map((p) => p.normalizedPhone || p.displayName)).toEqual([
      '+447700900111',
      '+447700900222',
      '+447700900333',
      'Bob Fixer',
    ]);
    expect(parsed[0].displayName).toBe('Alice Smith');
  });

  it('parses vCard (.vcf) contact exports', () => {
    const vcf = [
      'BEGIN:VCARD',
      'VERSION:3.0',
      'FN:Alice Smith',
      'TEL;TYPE=CELL:07700 900111',
      'END:VCARD',
      'BEGIN:VCARD',
      'VERSION:3.0',
      'FN:Dave Fixer',
      'TEL;TYPE=CELL:+44 7700 900444',
      'END:VCARD',
    ].join('\n');

    const parsed = parseWhatsAppParticipantsText(vcf);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].normalizedPhone).toBe('+447700900111');
    expect(parsed[0].displayName).toBe('Alice Smith');
    expect(parsed[1].normalizedPhone).toBe('+447700900444');
  });

  it('parses WhatsApp exported _chat.txt logs', () => {
    const chat = [
      '[12/10/2026, 09:14:22] +44 7700 900111: Morning everyone!',
      '[12/10/2026, 09:15:05] Alice Smith: See you at the hall at 10am',
      '[12/10/2026, 09:15:10] +44 7700 900111: Bringing my PAT tester',
    ].join('\n');

    const parsed = parseWhatsAppParticipantsText(chat);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].normalizedPhone).toBe('+447700900111');
    expect(parsed[1].displayName).toBe('Alice Smith');
  });
});

describe('whatsappReconcileArgs — Reconciliation Plan & Social Archived Members', () => {
  const sampleVolunteers: Volunteer[] = [
    // 1. Opted-in, PENDING_ADD -> found in group -> should become ADDED
    {
      id: 'vol-pending-alice',
      name: 'Alice Smith',
      phone: '07700 900111',
      emergencyContactName: 'Bob Smith',
      emergencyContactPhone: '07700 900999',
      isOrganiser: false,
      isPatTrained: true,
      inducted: true,
      whatsappOptIn: true,
      whatsappStatus: 'PENDING_ADD',
      createdAt: 1000,
      updatedAt: 1000,
    },
    // 2. Opted-in, ADDED -> missing from group -> should reset to PENDING_ADD
    {
      id: 'vol-missing-bob',
      name: 'Bob Leaver',
      phone: '07700 900222',
      emergencyContactName: 'Jane Leaver',
      emergencyContactPhone: '07700 900888',
      isOrganiser: false,
      isPatTrained: false,
      inducted: true,
      whatsappOptIn: true,
      whatsappStatus: 'ADDED',
      createdAt: 1000,
      updatedAt: 1000,
    },
    // 3. Unmigrated / not opted-in active volunteer -> in group
    {
      id: 'vol-unmigrated-charlie',
      name: 'Charlie Fixer',
      phone: '07700 900333',
      emergencyContactName: 'Mary Fixer',
      emergencyContactPhone: '07700 900777',
      isOrganiser: false,
      isPatTrained: false,
      inducted: true,
      whatsappOptIn: false,
      whatsappStatus: 'NOT_APPLICABLE',
      createdAt: 1000,
      updatedAt: 1000,
    },
    // 4. Archived volunteer who remained in the WhatsApp group socially (matched via phoneHash)
    {
      id: 'vol-archived-social',
      name: 'Diana P',
      emergencyContactName: '',
      emergencyContactPhone: '',
      isOrganiser: false,
      isPatTrained: false,
      inducted: true,
      whatsappOptIn: true,
      whatsappStatus: 'ADDED',
      phoneHash: hashNormalizedPhone('07700 900444'),
      archived: true,
      archivedAt: 1500,
      createdAt: 1000,
      updatedAt: 1500,
    },
  ];

  const groupText = [
    '+44 7700 900111', // Alice (PENDING_ADD)
    '+44 7700 900333', // Charlie (not opted in yet)
    '+44 7700 900444', // Diana P (archived social member via phoneHash)
    '+44 7700 999000', // Unknown stranger with NO volunteer record
  ].join('\n');

  it('recognises archived social members via phoneHash, flags only numbers with no volunteer record, and updates opted-in statuses', () => {
    const participants = parseWhatsAppParticipantsText(groupText);
    const plan = buildWhatsAppReconciliationPlan({
      participants,
      volunteers: sampleVolunteers,
      optInMatched: false,
      now: 5000,
    });

    // Only +447700999000 has no volunteer record; archived Diana P is recognised via phoneHash!
    expect(plan.unrecognisedGroupMembers).toHaveLength(1);
    expect(plan.unrecognisedGroupMembers[0].normalizedPhone).toBe(
      '+447700999000'
    );
    expect(plan.matchedArchivedMembers).toHaveLength(1);
    expect(plan.matchedArchivedMembers[0].volunteer.id).toBe(
      'vol-archived-social'
    );

    // Alice transitions PENDING_ADD -> ADDED
    expect(plan.pendingAdditionsConfirmed).toHaveLength(1);
    expect(plan.pendingAdditionsConfirmed[0].id).toBe('vol-pending-alice');
    expect(plan.pendingAdditionsConfirmed[0].whatsappStatus).toBe('ADDED');

    // Bob was ADDED in register but missing from group -> reset to PENDING_ADD
    expect(plan.missingFromGroup).toHaveLength(1);
    expect(plan.missingFromGroup[0].id).toBe('vol-missing-bob');
    expect(plan.missingFromGroup[0].whatsappStatus).toBe('PENDING_ADD');

    // Charlie is reported in optedOutStillInGroup when --opt-in-matched is false
    expect(plan.optedOutStillInGroup.map((v) => v.id)).toEqual([
      'vol-unmigrated-charlie',
    ]);
  });

  it('opts in matched unmigrated active volunteers when --opt-in-matched is enabled', () => {
    const participants = parseWhatsAppParticipantsText(groupText);
    const plan = buildWhatsAppReconciliationPlan({
      participants,
      volunteers: sampleVolunteers,
      optInMatched: true,
      now: 5000,
    });

    expect(plan.newlyOptedInMatches).toHaveLength(1);
    expect(plan.newlyOptedInMatches[0].id).toBe('vol-unmigrated-charlie');
    expect(plan.newlyOptedInMatches[0].whatsappOptIn).toBe(true);
    expect(plan.newlyOptedInMatches[0].whatsappStatus).toBe('ADDED');
    expect(plan.optedOutStillInGroup).toHaveLength(0);
  });
});
