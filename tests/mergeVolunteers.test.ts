/**
 * @file tests/mergeVolunteers.test.ts
 *
 * Unit tests for `src/utils/mergeVolunteersArgs.ts` covering CLI flag parsing,
 * volunteer resolution (exact ID, case-insensitive full name, ambiguity rejection,
 * self-merge guard), profile field merging, session attendance deduplication,
 * analytics `volunteerCount` updates, and compound fixer/tester credit rewriting.
 */

import { describe, expect, it } from 'vitest';
import {
  buildVolunteerMergePlan,
  findVolunteerByIdOrName,
  parseMergeVolunteersArgs,
  rewriteVolunteerNameInField,
} from '../src/utils/mergeVolunteersArgs';
import type { RepairItem, Session, SessionAnalytics, Volunteer } from '../src/types';

const sampleVolunteers: Volunteer[] = [
  {
    id: 'vol-hist-rae-martin',
    name: 'Rae Martin',
    emergencyContactName: 'Pending (Historical Import)',
    emergencyContactPhone: '00000000000',
    isOrganiser: false,
    isPatTrained: true,
    inducted: true,
    createdAt: 1000,
    updatedAt: 1000,
  },
  {
    id: 'vol-real-rae',
    name: 'Rachel Martin',
    email: 'rae@example.org',
    phone: '07700900123',
    emergencyContactName: 'John Martin',
    emergencyContactPhone: '07700900456',
    isOrganiser: true,
    isPatTrained: false,
    inducted: true,
    createdAt: 2000,
    updatedAt: 2000,
  },
  {
    id: 'vol-rich-1',
    name: 'Richard Grime',
    emergencyContactName: 'Contact 1',
    emergencyContactPhone: '07000000001',
    isOrganiser: true,
    isPatTrained: true,
    inducted: true,
    createdAt: 1000,
    updatedAt: 1000,
  },
  {
    id: 'vol-rich-2',
    name: 'Richard M',
    emergencyContactName: 'Contact 2',
    emergencyContactPhone: '07000000002',
    isOrganiser: false,
    isPatTrained: false,
    inducted: true,
    createdAt: 1500,
    updatedAt: 1500,
  },
];

describe('mergeVolunteersArgs — CLI Argument Parsing & Volunteer Resolution', () => {
  it('parses --list and --from / --into CLI options', () => {
    expect(parseMergeVolunteersArgs([])).toEqual({
      command: 'help',
      dryRun: false,
      confirm: false,
    });
    expect(parseMergeVolunteersArgs(['--list'])).toEqual({
      command: 'list',
      dryRun: false,
      confirm: false,
    });
    expect(
      parseMergeVolunteersArgs([
        '--from',
        'vol-hist-rae-martin',
        '--into',
        'Rachel Martin',
        '--confirm',
        '--project',
        'sutton-repair-cafe',
      ])
    ).toEqual({
      command: 'merge',
      from: 'vol-hist-rae-martin',
      into: 'Rachel Martin',
      dryRun: false,
      confirm: true,
      projectId: 'sutton-repair-cafe',
    });
  });

  it('resolves volunteers by exact ID or unique case-insensitive name and rejects ambiguous queries', () => {
    expect(findVolunteerByIdOrName('vol-hist-rae-martin', sampleVolunteers).id).toBe(
      'vol-hist-rae-martin'
    );
    expect(findVolunteerByIdOrName('rachel martin', sampleVolunteers).id).toBe(
      'vol-real-rae'
    );

    const duplicateNamed: Volunteer[] = [
      ...sampleVolunteers,
      {
        ...sampleVolunteers[0],
        id: 'vol-dup-rae',
      },
    ];
    expect(() => findVolunteerByIdOrName('Rae Martin', duplicateNamed)).toThrow(
      /Ambiguous volunteer name/
    );
    expect(() => findVolunteerByIdOrName('Nonexistent Person', sampleVolunteers)).toThrow(
      /Volunteer not found/
    );
  });
});

describe('mergeVolunteersArgs — Credit Rewriting & Full Merge Plan', () => {
  it('rewrites single and compound volunteer credit strings and deduplicates co-credits', () => {
    expect(rewriteVolunteerNameInField('Rae Martin', 'Rae Martin', 'Rachel Martin')).toBe(
      'Rachel Martin'
    );
    expect(
      rewriteVolunteerNameInField(
        'Luke Colbert & Rae Martin',
        'Rae Martin',
        'Rachel Martin'
      )
    ).toBe('Luke Colbert & Rachel Martin');
    // Deduplicates when both source and target were credited on the same item
    expect(
      rewriteVolunteerNameInField(
        'Rae Martin & Rachel Martin',
        'Rae Martin',
        'Rachel Martin'
      )
    ).toBe('Rachel Martin');
    // Returns undefined when rawField does not reference sourceName
    expect(
      rewriteVolunteerNameInField('Richard Grime', 'Rae Martin', 'Rachel Martin')
    ).toBeUndefined();
  });

  it('merges volunteer capabilities, deduplicates session rosters, updates analytics, and rewrites repairs', () => {
    const source = sampleVolunteers[0]; // Rae Martin (isPatTrained: true, Pending emergency contact)
    const target = sampleVolunteers[1]; // Rachel Martin (isOrganiser: true, isPatTrained: false, real contact)

    const sessions: Session[] = [
      {
        id: '20241109-yourspace',
        name: 'November 2024 - YourSpace',
        date: '2024-11-09',
        status: 'FINALIZED',
        volunteerPinHash: 'hash',
        cardRangeStart: 101,
        cardRangeEnd: 110,
        attendingVolunteerIds: ['vol-hist-rae-martin', 'vol-real-rae', 'vol-rich-1'],
        attendingVolunteers: [
          {
            id: 'vol-hist-rae-martin',
            name: 'Rae Martin',
            isOrganiser: false,
            isPatTrained: true,
            inducted: true,
          },
          {
            id: 'vol-real-rae',
            name: 'Rachel Martin',
            isOrganiser: true,
            isPatTrained: false,
            inducted: true,
          },
          {
            id: 'vol-rich-1',
            name: 'Richard Grime',
            isOrganiser: true,
            isPatTrained: true,
            inducted: true,
          },
        ],
        createdAt: 1000,
        finalizedAt: 2000,
      },
    ];

    const analytics: SessionAnalytics[] = [
      {
        sessionId: '20241109-yourspace',
        sessionName: 'November 2024 - YourSpace',
        date: '2024-11-09',
        isTest: false,
        totalItems: 1,
        repairedCount: 1,
        partialCount: 0,
        unfixableCount: 0,
        adviceCount: 0,
        takenHomeCount: 0,
        totalRepairTimeMinutes: 15,
        averageRepairTimeMinutes: 15,
        successRatePercent: 100,
        totalWeightDivertedKg: 1.5,
        categoryBreakdown: { ELECTRICAL: 1 },
        mainsItemsCount: 1,
        patTestedCount: 1,
        patFailureRatePercent: 0,
        volunteerCount: 3,
        finalizedAt: 2000,
      },
    ];

    const repairsBySession: Record<string, RepairItem[]> = {
      '20241109-yourspace': [
        {
          id: 'hist-20241109-card-101',
          sessionId: '20241109-yourspace',
          registrationId: 'reg-hist-20241109-card-101',
          referenceToken: 'REF-H101',
          cardNumber: 101,
          customerName: '[REDACTED]',
          item: {
            category: 'ELECTRICAL',
            brandModel: 'Russell Hobbs - Kettle',
            faultDescription: 'No power',
            powerType: 'MAINS_240V',
          },
          status: 'COMPLETED',
          patInitial: {
            testedAt: 1100,
            testerName: 'Rae Martin',
            instrumentSerial: 'HISTORICAL-PAT',
            visualPass: true,
            fuseRatingAmps: 13,
            testVoltageVolts: 500,
            insulationResistanceMOhms: 200,
            outcome: 'PASS',
          },
          repair: {
            fixerName: 'Rae Martin & Richard Grime',
            repairTimeMinutes: 15,
            outcome: 'FIXED',
            repairedAt: 1500,
          },
        },
      ],
    };

    const plan = buildVolunteerMergePlan({
      source,
      target,
      sessions,
      analytics,
      repairsBySession,
      now: 3000,
    });

    // Target inherits isPatTrained: true from source while keeping real emergency contact
    expect(plan.updatedTarget.isPatTrained).toBe(true);
    expect(plan.updatedTarget.isOrganiser).toBe(true);
    expect(plan.updatedTarget.emergencyContactName).toBe('John Martin');
    expect(plan.deletedSourceId).toBe('vol-hist-rae-martin');

    // Session attendance deduplicated from 3 -> 2
    expect(plan.updatedSessions).toHaveLength(1);
    expect(plan.updatedSessions[0].attendingVolunteerIds).toEqual([
      'vol-real-rae',
      'vol-rich-1',
    ]);
    expect(plan.updatedAnalytics).toEqual([
      {
        sessionId: '20241109-yourspace',
        volunteerCount: 2,
      },
    ]);

    // Repair item credits rewritten to Rachel Martin
    expect(plan.updatedRepairs).toHaveLength(1);
    expect(plan.updatedRepairs[0].updates['repair.fixerName']).toBe(
      'Rachel Martin & Richard Grime'
    );
    expect(plan.updatedRepairs[0].updates['patInitial.testerName']).toBe('Rachel Martin');

    // Self-merge throws an error
    expect(() =>
      buildVolunteerMergePlan({
        source,
        target: source,
        sessions: [],
        analytics: [],
        repairsBySession: {},
      })
    ).toThrow(/Cannot merge a volunteer into itself/);
  });
});
