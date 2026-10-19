/**
 * @file tests/historicalIngest.test.ts
 *
 * Unit tests for `src/utils/historicalIngestParser.ts` covering RFC 4180 CSV parsing,
 * UK timestamp parsing, off-Saturday date snapping, card number & weight extraction,
 * brand & category normalisation, volunteer name cleaning, PAT chronological ordering,
 * collision detection (`--force`), GDPR PII redaction, and CLI argument validation.
 */

import { describe, expect, it } from 'vitest';
import {
  buildHistoricalIngestionPlan,
  classifyItemCategoryAndPower,
  inferOrphanRegistrationOutcome,
  mapHistoricalOutcomeAndStatus,
  normalizeBrandName,
  normalizeVolunteerNames,
  parseCsvRecords,
  parseHistoricalCardNumber,
  parseHistoricalDurationMinutes,
  parseHistoricalWeightKg,
  parseIngestHistoricalArgs,
  parsePatNumericMeasurement,
  parseUkTimestamp,
  resolveHistoricalSessionDate,
} from '../src/utils/historicalIngestParser';
import type { Volunteer } from '../src/types';

/** Helper to format a 14-column Registration Responses CSV row. */
function makeRegCsvRow(cols: {
  timestamp: string;
  name?: string;
  itemType: string;
  brand?: string;
  fault: string;
  cardNumber?: string;
  weight?: string;
  assigned?: string;
  note1?: string;
  note2?: string;
}): string {
  const esc = (v = ''): string =>
    /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  return [
    esc(cols.timestamp),
    esc(cols.name ?? 'Jane Visitor'),
    '35-44',
    esc(cols.itemType),
    esc(cols.brand ?? ''),
    esc(cols.fault),
    'Word of mouth',
    'I agree',
    esc(cols.cardNumber ?? ''),
    esc(cols.weight ?? ''),
    esc(cols.assigned ?? ''),
    esc(cols.note1 ?? ''),
    esc(cols.note2 ?? ''),
    'uid-123',
  ].join(',');
}

/** Helper to format a 7-column Repair Outcomes CSV row. */
function makeOutcomeCsvRow(cols: {
  timestamp: string;
  cardNumber?: string;
  repairer: string;
  defect: string;
  repaired: string;
  notes?: string;
  duration?: string;
}): string {
  const esc = (v = ''): string =>
    /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  return [
    esc(cols.timestamp),
    esc(cols.cardNumber ?? ''),
    esc(cols.repairer),
    esc(cols.defect),
    esc(cols.repaired),
    esc(cols.notes ?? ''),
    esc(cols.duration ?? '10 - 20 minutes'),
  ].join(',');
}

/** Helper to format a 12-column PAT Tests CSV row. */
function makePatCsvRow(cols: {
  timestamp: string;
  cardNumber?: string;
  stage?: string;
  tester: string;
  itemDesc: string;
  applianceClass?: string;
  fuse?: string;
  visual?: string;
  earth?: string;
  insulation?: string;
  result: string;
  comments?: string;
}): string {
  const esc = (v = ''): string =>
    /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  return [
    esc(cols.timestamp),
    esc(cols.cardNumber ?? ''),
    esc(cols.stage ?? 'Before Repair'),
    esc(cols.tester),
    esc(cols.itemDesc),
    esc(cols.applianceClass ?? 'Class I'),
    esc(cols.fuse ?? '13 amp'),
    esc(cols.visual ?? 'Pass'),
    esc(cols.earth ?? '0.08'),
    esc(cols.insulation ?? '>199'),
    esc(cols.result),
    esc(cols.comments ?? ''),
  ].join(',');
}

const REG_HEADER =
  'Timestamp,Name,Age,Type of Item,Item Brand,Problem,Where Heard,Terms,Repair Number,Item Weight,Assigned,Note1,Note2,UID';
const OUTCOME_HEADER =
  'Timestamp,Repair Number,Repairer Name,Defect Found,Repaired?,How repaired,Time Taken';
const PAT_HEADER =
  'Timestamp,Repair Number,Stage,Tester,Item Description,Class,Fuse,Visual,Earth,Insulation,Result,Comments';

describe('historicalIngestParser — RFC 4180 CSV & UK Timestamp Parsing', () => {
  it('parses multi-line quoted CSV fields and escaped double-quotes', () => {
    const csv =
      'Col1,Col2,Col3\r\n"Line 1\nLine 2","Quoted ""Brand"" Name",105\r\nSimple,Row,106';
    const records = parseCsvRecords(csv);
    expect(records).toHaveLength(3);
    expect(records[1]).toEqual(['Line 1\nLine 2', 'Quoted "Brand" Name', '105']);
    expect(records[2]).toEqual(['Simple', 'Row', '106']);
  });

  it('parses UK DD/MM/YYYY HH:mm:ss and date-only DD/MM/YYYY timestamps and ignores #VALUE!', () => {
    const full = parseUkTimestamp('09/11/2024 10:15:30');
    expect(full).not.toBeNull();
    expect(full?.rawDate).toBe('2024-11-09');
    expect(full?.timestampMs).toBe(Date.UTC(2024, 10, 9, 10, 15, 30));

    const dateOnly = parseUkTimestamp('09/03/2024');
    expect(dateOnly).not.toBeNull();
    expect(dateOnly?.rawDate).toBe('2024-03-09');
    expect(dateOnly?.timestampMs).toBe(Date.UTC(2024, 2, 9, 11, 0, 0));

    expect(parseUkTimestamp('#VALUE!')).toBeNull();
    expect(parseUkTimestamp('')).toBeNull();
    expect(parseUkTimestamp('Timestamp')).toBeNull();
  });

  it('snaps off-Saturday historical dates to their true Saturday sessions', () => {
    // 13/12/2024 -> 2024-12-14
    expect(resolveHistoricalSessionDate('registration', '2024-12-13', 107)).toEqual({
      sessionDate: '2024-12-14',
    });

    // 14/06/2024 Outcomes for cards 131, 130, 116, 137 -> 2024-05-11
    expect(resolveHistoricalSessionDate('outcome', '2024-06-14', 131)).toEqual({
      sessionDate: '2024-05-11',
    });
    expect(resolveHistoricalSessionDate('outcome', '2024-06-14', 116)).toEqual({
      sessionDate: '2024-05-11',
    });

    // 14/06/2024 Registration for card 127 -> 2024-06-08 with cardNumberOverride: null
    expect(resolveHistoricalSessionDate('registration', '2024-06-14', 127)).toEqual({
      sessionDate: '2024-06-08',
      cardNumberOverride: null,
      noteOverride: 'Original card #127 on 14/06/2024 - Waiting at clothes swap',
    });

    // Other 14/06/2024 entries -> 2024-06-08
    expect(resolveHistoricalSessionDate('registration', '2024-06-14', 106)).toEqual({
      sessionDate: '2024-06-08',
    });
  });
});

describe('historicalIngestParser — Card Number, Weight, Outcome, Brand & Category Normalisation', () => {
  it('parses card numbers with suffixes and extracts free-text organiser notes', () => {
    expect(parseHistoricalCardNumber('102')).toEqual({
      cardNumber: 102,
      organizerNote: undefined,
    });
    expect(parseHistoricalCardNumber('114rae')).toEqual({
      cardNumber: 114,
      organizerNote: undefined,
    });
    expect(parseHistoricalCardNumber('122f')).toEqual({
      cardNumber: 122,
      organizerNote: undefined,
    });
    expect(parseHistoricalCardNumber('0')).toEqual({ cardNumber: null });
    expect(parseHistoricalCardNumber('PAPER')).toEqual({ cardNumber: null });
    expect(parseHistoricalCardNumber('?')).toEqual({ cardNumber: null });
    expect(parseHistoricalCardNumber('Non repairable')).toEqual({
      cardNumber: null,
      organizerNote: 'Non repairable',
    });
  });

  it('normalizes item weights in g/kg, extracts embedded weights, and preserves non-weight notes', () => {
    expect(parseHistoricalWeightKg('1.5kg', 'Toaster')).toEqual({
      weightKg: 1.5,
      cleanedItemType: 'Toaster',
      organizerNote: undefined,
    });
    expect(parseHistoricalWeightKg('660g', 'Dryer')).toEqual({
      weightKg: 0.66,
      cleanedItemType: 'Dryer',
      organizerNote: undefined,
    });
    // Unlabelled > 30 treated as grams
    expect(parseHistoricalWeightKg('200', 'Radio')).toEqual({
      weightKg: 0.2,
      cleanedItemType: 'Radio',
      organizerNote: undefined,
    });
    // Embedded weight in Type of Item with or without hyphen
    expect(parseHistoricalWeightKg('', 'Bike - 20kg')).toEqual({
      weightKg: 20,
      cleanedItemType: 'Bike',
      organizerNote: undefined,
    });
    expect(parseHistoricalWeightKg('', 'Kettle 1.2kg')).toEqual({
      weightKg: 1.2,
      cleanedItemType: 'Kettle',
      organizerNote: undefined,
    });
    // Non-numeric text in weight column becomes organizerNote
    expect(parseHistoricalWeightKg('Dangerous to fix', 'Heater')).toEqual({
      weightKg: undefined,
      cleanedItemType: 'Heater',
      organizerNote: 'Dangerous to fix',
    });
  });

  it('maps duration buckets, outcome rows, and orphan registration notes', () => {
    expect(parseHistoricalDurationMinutes('Less than 10 minutes')).toBe(10);
    expect(parseHistoricalDurationMinutes('10 - 20 minutes')).toBe(15);
    expect(parseHistoricalDurationMinutes('20 - 30 minutes')).toBe(25);
    expect(parseHistoricalDurationMinutes('More than 20 minutes')).toBe(30);
    expect(parseHistoricalDurationMinutes('Over 30 minutes')).toBe(45);
    expect(parseHistoricalDurationMinutes('')).toBe(15);

    expect(mapHistoricalOutcomeAndStatus('Yes', 'Soldered wire')).toEqual({
      outcome: 'FIXED',
      status: 'COMPLETED',
    });
    expect(mapHistoricalOutcomeAndStatus('No - Not possible to repair', '')).toEqual({
      outcome: 'UNFIXABLE',
      status: 'UNFIXABLE',
    });
    expect(mapHistoricalOutcomeAndStatus('Partial', 'Advised customer to order belt')).toEqual({
      outcome: 'ADVICE_GIVEN',
      status: 'COMPLETED',
    });
    expect(
      mapHistoricalOutcomeAndStatus('Second Visit required', 'Taking home to test transformer')
    ).toEqual({
      outcome: 'TAKEN_HOME',
      status: 'TAKEN_HOME',
    });

    expect(inferOrphanRegistrationOutcome('Dangerous to fix')).toEqual({
      outcome: 'UNFIXABLE',
      status: 'UNFIXABLE',
    });
    expect(inferOrphanRegistrationOutcome('Taken for home repair')).toEqual({
      outcome: 'TAKEN_HOME',
      status: 'TAKEN_HOME',
    });
    expect(inferOrphanRegistrationOutcome('')).toEqual({
      outcome: 'FIXED',
      status: 'COMPLETED',
    });
  });

  it('normalizes brands, strips placeholders, handles multi-brands, and avoids duplicate prefixes', () => {
    expect(normalizeBrandName('russel hobbs', 'Kettle')).toEqual({
      canonicalBrand: 'Russell Hobbs',
      brandModel: 'Russell Hobbs - Kettle',
    });
    expect(normalizeBrandName('Dyson', 'Dyson V8 Vacuum')).toEqual({
      canonicalBrand: 'Dyson',
      brandModel: 'Dyson V8 Vacuum',
    });
    expect(normalizeBrandName('DeLonghi;Kenwood', 'Coffee Machine')).toEqual({
      canonicalBrand: "De'Longhi / Kenwood",
      brandModel: "De'Longhi / Kenwood - Coffee Machine",
    });
    expect(normalizeBrandName("Don't know", 'Table Lamp')).toEqual({
      canonicalBrand: '',
      brandModel: 'Table Lamp',
    });
  });

  it('classifies item category and power type with strict word boundaries', () => {
    expect(classifyItemCategoryAndPower('Laptop', 'Screen flickering', false)).toEqual({
      category: 'ELECTRICAL',
      powerType: 'BATTERY_LOW_VOLTAGE',
    });
    expect(classifyItemCategoryAndPower('Electric blanket', 'Not heating', false)).toEqual({
      category: 'ELECTRICAL',
      powerType: 'MAINS_240V',
    });
    expect(classifyItemCategoryAndPower('Sewing machine', 'Timing off', false)).toEqual({
      category: 'ELECTRICAL',
      powerType: 'MAINS_240V',
    });
    expect(classifyItemCategoryAndPower('Watch strap', 'Broken buckle', false)).toEqual({
      category: 'TEXTILES',
      powerType: 'NOT_APPLICABLE',
    });
    expect(classifyItemCategoryAndPower('Wooden chair', 'Loose leg', false)).toEqual({
      category: 'WOODWORK',
      powerType: 'NOT_APPLICABLE',
    });
    expect(classifyItemCategoryAndPower('Mountain bike', 'Brakes rubbing', false)).toEqual({
      category: 'MECHANICAL',
      powerType: 'MECHANICAL',
    });
    // PAT override forces ELECTRICAL + MAINS_240V
    expect(classifyItemCategoryAndPower('Wooden lamp', 'Switch faulty', true)).toEqual({
      category: 'ELECTRICAL',
      powerType: 'MAINS_240V',
    });
  });

  it('cleans volunteer names and extracts non-person defect notes before splitting', () => {
    expect(
      normalizeVolunteerNames('blanket no go , electronic faulty customer will try manufacture')
    ).toEqual({
      canonicalNames: [],
      defectNote: 'blanket no go , electronic faulty customer will try manufacture',
    });
    expect(normalizeVolunteerNames('Rae Martin both elements low insulation')).toEqual({
      canonicalNames: ['Rae Martin'],
      defectNote: 'Both elements low insulation',
    });
    expect(normalizeVolunteerNames('Luke and Richard')).toEqual({
      canonicalNames: ['Luke Colbert', 'Richard Grime'],
    });
    expect(normalizeVolunteerNames('102')).toEqual({
      canonicalNames: [],
    });
    expect(parsePatNumericMeasurement('>.08')).toBe(0.08);
    expect(parsePatNumericMeasurement('>199')).toBe(199);
  });
});

describe('historicalIngestParser — End-to-End Ingestion Plan, Collisions, & GDPR Redaction', () => {
  const existingVolunteers: Volunteer[] = [
    {
      id: 'vol-existing-richard',
      name: 'Richard Grime',
      emergencyContactName: 'Contact',
      emergencyContactPhone: '07000000000',
      isOrganiser: true,
      isPatTrained: false,
      inducted: true,
      createdAt: 1000,
      updatedAt: 1000,
    },
  ];

  it('matches records, orders PAT1/PAT2 by timestamp, redacts PII, and upgrades PAT training', () => {
    const registrationsCsv = [
      REG_HEADER,
      makeRegCsvRow({
        timestamp: '09/11/2024 10:05:00',
        name: 'Alice SecretName',
        itemType: 'Toaster',
        brand: 'russel hobbs',
        fault: 'Does not stay down',
        cardNumber: '101',
        weight: '1.4kg',
      }),
      // Orphan registration with no outcome row -> defaults to FIXED / COMPLETED
      makeRegCsvRow({
        timestamp: '09/11/2024 10:20:00',
        name: 'Bob SecretName',
        itemType: 'Jeans',
        brand: 'levis',
        fault: 'Zip broken',
        cardNumber: '102',
        assigned: 'Marion',
      }),
    ].join('\n');

    const outcomesCsv = [
      OUTCOME_HEADER,
      makeOutcomeCsvRow({
        timestamp: '09/11/2024 11:00:00',
        cardNumber: '101',
        repairer: 'Luke & Richard',
        defect: 'Dirty latch contact',
        repaired: 'Yes',
        notes: 'Cleaned latch and tested',
        duration: '20 - 30 minutes',
      }),
    ].join('\n');

    // Out-of-order PAT rows for card 101: later timestamp listed first in CSV
    const patCsv = [
      PAT_HEADER,
      makePatCsvRow({
        timestamp: '09/11/2024 11:15:00',
        cardNumber: '101',
        stage: 'After Repair',
        tester: 'Richard',
        itemDesc: 'Toaster',
        earth: '0.07',
        insulation: '>199',
        result: 'Pass',
        comments: 'Post-repair pass',
      }),
      makePatCsvRow({
        timestamp: '09/11/2024 10:10:00',
        cardNumber: '101',
        stage: 'Before Repair',
        tester: 'Richard',
        itemDesc: 'Toaster',
        earth: '>.08',
        insulation: '150',
        result: 'Pass',
        comments: 'Pre-repair check',
      }),
    ].join('\n');

    const plan = buildHistoricalIngestionPlan({
      registrationsCsv,
      outcomesCsv,
      patCsv,
      existingVolunteers,
      force: false,
      now: 1700000000000,
    });

    expect(plan.collisions).toHaveLength(0);
    expect(plan.sessions).toHaveLength(1);
    // Existing volunteer Richard appeared in PAT Tests -> should be marked for isPatTrained upgrade
    expect(plan.upgradedPatVolunteerIds).toEqual(['vol-existing-richard']);
    // Luke Colbert and Marion Pereira should be auto-registered
    expect(plan.newVolunteers.map((v) => v.name).sort()).toEqual([
      'Luke Colbert',
      'Marion Pereira',
    ]);

    const sessionPlan = plan.sessions[0];
    expect(sessionPlan.session.id).toBe('20241109-yourspace');
    expect(sessionPlan.session.name).toBe('November 2024 - YourSpace');
    expect(sessionPlan.session.status).toBe('FINALIZED');
    expect(sessionPlan.repairs).toHaveLength(2);

    const card101 = sessionPlan.repairs.find((r) => r.repairItem.cardNumber === 101)!;
    expect(card101.repairItem.customerName).toBe('[REDACTED]');
    expect(card101.privateCustomer.firstName).toBe('[REDACTED]');
    expect(card101.repairItem.item.brandModel).toBe('Russell Hobbs - Toaster');
    expect(card101.repairItem.item.weightKg).toBe(1.4);
    expect(card101.repairItem.repair?.fixerName).toBe('Luke Colbert & Richard Grime');
    expect(card101.repairItem.repair?.repairTimeMinutes).toBe(25);
    // Chronological PAT ordering: 10:10 is patInitial, 11:15 is patFinal
    expect(card101.repairItem.patInitial?.earthContinuityOhms).toBe(0.08);
    expect(card101.repairItem.patInitial?.cautionNotes).toBe('Pre-repair check');
    expect(card101.repairItem.patFinal?.earthContinuityOhms).toBe(0.07);
    expect(card101.repairItem.patFinal?.certificateNotes).toBe('Post-repair pass');

    // Card 102 orphan registration defaults to FIXED / COMPLETED with Marion Pereira as fixer
    const card102 = sessionPlan.repairs.find((r) => r.repairItem.cardNumber === 102)!;
    expect(card102.repairItem.repair?.outcome).toBe('FIXED');
    expect(card102.repairItem.status).toBe('COMPLETED');
    expect(card102.repairItem.repair?.fixerName).toBe('Marion Pereira');

    // Verify no raw visitor names leak anywhere in serialized plan
    const serialized = JSON.stringify(plan);
    expect(serialized).not.toContain('Alice SecretName');
    expect(serialized).not.toContain('Bob SecretName');
  });

  it('flags duplicate same-session card numbers unless force=true is set', () => {
    const registrationsCsv = [
      REG_HEADER,
      makeRegCsvRow({
        timestamp: '10/08/2024 10:00:00',
        itemType: 'Kettle',
        brand: 'Bosch',
        fault: 'Leaking',
        cardNumber: '115',
      }),
      makeRegCsvRow({
        timestamp: '10/08/2024 11:00:00',
        itemType: 'Lamp',
        brand: 'IKEA',
        fault: 'Broken switch',
        cardNumber: '115',
      }),
    ].join('\n');

    const withoutForce = buildHistoricalIngestionPlan({
      registrationsCsv,
      outcomesCsv: OUTCOME_HEADER,
      patCsv: PAT_HEADER,
      existingVolunteers: [],
      force: false,
    });
    expect(withoutForce.collisions).toHaveLength(1);
    expect(withoutForce.collisions[0].cardNumber).toBe(115);

    const withForce = buildHistoricalIngestionPlan({
      registrationsCsv,
      outcomesCsv: OUTCOME_HEADER,
      patCsv: PAT_HEADER,
      existingVolunteers: [],
      force: true,
    });
    expect(withForce.collisions).toHaveLength(0);
    expect(withForce.droppedDuplicates).toHaveLength(1);
    expect(withForce.sessions[0].repairs).toHaveLength(1);
    expect(withForce.sessions[0].repairs[0].repairItem.item.brandModel).toBe(
      'Bosch - Kettle'
    );
  });

  it('validates CLI arguments for ingestHistoricalData', () => {
    expect(parseIngestHistoricalArgs([])).toEqual({
      command: 'help',
      dryRun: false,
      confirm: false,
      force: false,
      overwrite: false,
    });

    const parsed = parseIngestHistoricalArgs([
      '--registrations',
      'reg.csv',
      '--outcomes',
      'out.csv',
      '--pat',
      'pat.csv',
      '--force',
      '--confirm',
      '--project',
      'sutton-repair-cafe',
    ]);
    expect(parsed).toEqual({
      command: 'ingest',
      registrationsPath: 'reg.csv',
      outcomesPath: 'out.csv',
      patPath: 'pat.csv',
      dryRun: false,
      confirm: true,
      force: true,
      overwrite: false,
      projectId: 'sutton-repair-cafe',
    });

    expect(() =>
      parseIngestHistoricalArgs(['--registrations', 'reg.csv'])
    ).toThrow(/Missing required CSV paths/);
  });
});
