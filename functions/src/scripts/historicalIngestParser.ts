/**
 * @file functions/src/scripts/historicalIngestParser.ts
 *
 * Pure, zero-dependency CSV parser, normaliser, record matcher, and GDPR scrubber
 * for ingesting historical Sutton Repair Café Google Forms exports (`Registration Responses`,
 * `Repair Outcomes`, and `PAT Tests`) into finalized `YYYYMMDD-yourspace` sessions.
 *
 * NOTE: Keeps domain types inline so `functions/tsconfig.json` compiles `functions/src`
 * cleanly without crossing the root `src/` directory boundary.
 */

export type ItemCategory =
  | 'ELECTRICAL'
  | 'MECHANICAL'
  | 'TEXTILES'
  | 'WOODWORK'
  | 'TOY'
  | 'OTHER';

export type PowerType =
  | 'MAINS_240V'
  | 'BATTERY_LOW_VOLTAGE'
  | 'MECHANICAL'
  | 'NOT_APPLICABLE'
  | 'OTHER';

export type ApplianceClass =
  | 'CLASS_I'
  | 'CLASS_II'
  | 'CLASS_III'
  | 'LEADS_ADAPTER'
  | 'NOT_APPLICABLE';

export type ItemStatus =
  | 'REGISTERED'
  | 'WAITING_PAT1'
  | 'IN_PAT1'
  | 'WAITING_REPAIR'
  | 'IN_REPAIR'
  | 'WAITING_PAT2'
  | 'IN_PAT2'
  | 'READY_FOR_COLLECTION'
  | 'COMPLETED'
  | 'TAKEN_HOME'
  | 'UNFIXABLE';

export type PatInitialOutcome =
  | 'PASS'
  | 'FAIL_REPAIRABLE_CORD'
  | 'DANGER_DO_NOT_ENERGIZE'
  | 'UNTESTABLE';

export type PatFinalOutcome = 'PASS' | 'FAIL';

export type RepairOutcome =
  | 'FIXED'
  | 'PARTIAL'
  | 'UNFIXABLE'
  | 'ADVICE_GIVEN'
  | 'TAKEN_HOME';

export interface SessionVolunteerSummary {
  id: string;
  name: string;
  isOrganiser: boolean;
  isPatTrained: boolean;
  inducted: boolean;
}

export interface Volunteer {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  emergencyContactRelationship?: string;
  isOrganiser: boolean;
  isPatTrained: boolean;
  inducted: boolean;
  inductedAt?: number;
  inductedBy?: string;
  createdAt: number;
  updatedAt: number;
}

export interface Session {
  id: string;
  name: string;
  date: string;
  status: 'ACTIVE' | 'FINALIZED';
  isTest?: boolean;
  volunteerPinHash: string;
  cardRangeStart: number;
  cardRangeEnd: number;
  attendingVolunteerIds?: string[];
  attendingVolunteers?: SessionVolunteerSummary[];
  createdAt: number;
  finalizedAt?: number;
}

export interface RepairItem {
  id: string;
  sessionId: string;
  registrationId: string;
  referenceToken: string;
  cardNumber?: number | null;
  customerName?: string;
  item: {
    category: ItemCategory;
    brandModel: string;
    faultDescription: string;
    powerType: PowerType;
    applianceClass?: ApplianceClass;
    weightKg?: number;
  };
  status: ItemStatus;
  patInitial?: {
    testedAt: number;
    testerName: string;
    instrumentSerial: string;
    visualPass: boolean;
    fuseRatingAmps: 3 | 5 | 13 | 'OTHER';
    testVoltageVolts: 250 | 500;
    earthContinuityOhms?: number;
    insulationResistanceMOhms: number;
    outcome: PatInitialOutcome;
    cautionNotes?: string;
  };
  repair?: {
    repairTimeMinutes?: number;
    fixerName: string;
    diagnosis?: string;
    repairNotes?: string;
    partsUsed?: string;
    outcome: RepairOutcome;
    photoCount?: number;
    repairedAt?: number;
  };
  patFinal?: {
    testedAt: number;
    testerName: string;
    instrumentSerial: string;
    visualPass: boolean;
    fuseRatingAmps: 3 | 5 | 13 | 'OTHER';
    testVoltageVolts?: 250 | 500;
    earthContinuityOhms?: number;
    insulationResistanceMOhms: number;
    outcome: PatFinalOutcome;
    certificateNotes?: string;
  };
  createdAt?: number;
  updatedAt?: number;
}

export interface PrivateCustomerData {
  firstName: string;
  contactPhone?: string;
  agreedToTerms: boolean;
  termsVersion: string;
  submittedAt?: number;
  registeredAt?: number;
  redactedAt?: number;
}

export interface SessionAnalytics {
  sessionId: string;
  sessionName: string;
  date: string;
  isTest?: boolean;
  totalItems: number;
  repairedCount: number;
  partialCount: number;
  unfixableCount: number;
  adviceCount: number;
  takenHomeCount: number;
  totalRepairTimeMinutes: number;
  averageRepairTimeMinutes: number;
  successRatePercent: number;
  totalWeightDivertedKg: number;
  categoryBreakdown: Record<string, number>;
  mainsItemsCount: number;
  patTestedCount: number;
  patFailureRatePercent: number;
  volunteerCount?: number;
  finalizedAt?: number;
}

/** Default SHA-256 hash of '0000' used for historical finalized sessions. */
export const HISTORICAL_DEFAULT_PIN_HASH =
  '9af15b336e6a9619928537df30b2e6a2376569fcf9d7e773eccede65606529a0';

/** Parsed CLI options for the `ingest-history` utility. */
export interface IngestHistoricalCliOptions {
  command: 'ingest' | 'help';
  registrationsPath?: string;
  outcomesPath?: string;
  patPath?: string;
  dryRun: boolean;
  confirm: boolean;
  force: boolean;
  overwrite: boolean;
  projectId?: string;
}

/** Details of a same-session duplicate card number collision in Registrations or Outcomes. */
export interface CardCollisionRecord {
  sessionDate: string;
  source: 'registration' | 'outcome';
  cardNumber: number;
  keptRowSummary: string;
  conflictingRowSummary: string;
}

/** Fully assembled session, redacted repair items, and analytics ready for Firestore batch commit. */
export interface PlannedHistoricalSession {
  session: Session;
  repairs: Array<{
    repairItem: RepairItem;
    privateCustomer: PrivateCustomerData;
  }>;
  analytics: SessionAnalytics;
}

/** Complete deterministic execution plan produced by {@link buildHistoricalIngestionPlan}. */
export interface HistoricalIngestionPlan {
  sessions: PlannedHistoricalSession[];
  newVolunteers: Volunteer[];
  upgradedPatVolunteerIds: string[];
  collisions: CardCollisionRecord[];
  droppedDuplicates: CardCollisionRecord[];
}

/** Internal parsed representation of a sanitized `Registration Responses` row. */
interface ParsedRegistrationRow {
  sessionDate: string;
  timestampMs: number;
  cardNumber: number | null;
  itemType: string;
  itemBrand: string;
  problemDescription: string;
  weightKg?: number;
  assignedRaw: string;
  organizerNotes: string[];
}

/** Internal parsed representation of a sanitized `Repair Outcomes` row. */
interface ParsedOutcomeRow {
  sessionDate: string;
  timestampMs: number;
  cardNumber: number | null;
  repairerRaw: string;
  defectFound: string;
  repairedRaw: string;
  repairNotes: string;
  durationRaw: string;
}

/** Internal parsed representation of a sanitized `PAT Tests` row. */
interface ParsedPatRow {
  sessionDate: string;
  timestampMs: number;
  cardNumber: number | null;
  stageRaw: string;
  testerRaw: string;
  itemDescription: string;
  applianceClass?: ApplianceClass;
  fuseRatingAmps: 3 | 5 | 13 | 'OTHER';
  visualPass: boolean;
  earthContinuityOhms?: number;
  insulationResistanceMOhms: number;
  resultPass: boolean;
  comments?: string;
}

/** Month names indexed 0..11 for deterministic session display names. */
const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** Placeholder brand strings treated as unknown/blank during brand normalisation. */
const BRAND_PLACEHOLDERS = new Set([
  '',
  '-',
  '?',
  '???',
  ',?',
  'n/a',
  'na',
  'nil',
  'none',
  'no',
  'not',
  'not known',
  'unknown',
  'unkniwn',
  "don't know",
  'dont know',
  'do not know',
  'domnt know',
  'dot know',
  'not sure',
  'unsure',
  'no idea',
  'no brand',
  'unbranded',
  'as above',
  'various',
  'mix',
  'mix of brands',
  'not branded',
  'homemade',
  'home made',
  'vintage',
  'generic',
  'own brand',
]);

/** Canonical lookup dictionary mapping normalized lowercase brand strings to display names. */
const CANONICAL_BRAND_MAP: Record<string, string> = {
  'russell hobbs': 'Russell Hobbs',
  'russel hobbs': 'Russell Hobbs',
  'russell hobs': 'Russell Hobbs',
  'russel hobs': 'Russell Hobbs',
  'morphy richards': 'Morphy Richards',
  'delonghi': "De'Longhi",
  "de'longhi": "De'Longhi",
  'de longhi': "De'Longhi",
  'philips': 'Philips',
  'phillips': 'Philips',
  'philps': 'Philips',
  'black & decker': 'Black & Decker',
  'black and decker': 'Black & Decker',
  'black + decker': 'Black & Decker',
  'dyson': 'Dyson',
  'henry': 'Numatic Henry',
  'numatic': 'Numatic Henry',
  'numatic henry': 'Numatic Henry',
  'm&s': 'Marks & Spencer',
  'marks and spencer': 'Marks & Spencer',
  'marks & spencer': 'Marks & Spencer',
  'macallister': 'Mac Allister',
  'mac allister': 'Mac Allister',
  'kitchenaid': 'KitchenAid',
  'kitchen aid': 'KitchenAid',
  'nutribullet': 'NutriBullet',
  'nutri bullet': 'NutriBullet',
  'gtech': 'Gtech',
  'g tech': 'Gtech',
  'g-tech': 'Gtech',
  'hp': 'HP',
  'hewlett packard': 'HP',
  'levis': "Levi's",
  "levi's": "Levi's",
  'levi': "Levi's",
  'adidas': 'Adidas',
  'addidas': 'Adidas',
  'epson': 'Epson',
  'epsom': 'Epson',
  'bissell': 'Bissell',
  'bissel': 'Bissell',
  'sebo': 'Sebo',
  'ambiano': 'Ambiano',
  'roberts': 'Roberts',
  'dualit': 'Dualit',
  'karcher': 'Kärcher',
  'kärcher': 'Kärcher',
  'ghd': 'GHD',
  'jvc': 'JVC',
  'lg': 'LG',
  'ikea': 'IKEA',
  'spear & jackson': 'Spear & Jackson',
  'spear and jackson': 'Spear & Jackson',
  'silvercrest': 'SilverCrest',
  'silver crest': 'SilverCrest',
  'andrew james': 'Andrew James',
  'john lewis': 'John Lewis',
  'babyliss': 'BaByliss',
  'dewalt': 'DeWalt',
  'cricut': 'Cricut',
  'crosley': 'Crosley',
  'magimix': 'Magimix',
  'kenwood': 'Kenwood',
  'panasonic': 'Panasonic',
  'sony': 'Sony',
  'bosch': 'Bosch',
  'tefal': 'Tefal',
  'breville': 'Breville',
  'vax': 'Vax',
  'shark': 'Shark',
  'miele': 'Miele',
  'flymo': 'Flymo',
  'ryobi': 'Ryobi',
  'makita': 'Makita',
  'casio': 'Casio',
  'seiko': 'Seiko',
  'apple': 'Apple',
  'samsung': 'Samsung',
  'nintendo': 'Nintendo',
  'samson': 'Samson',
  'hotel chocolat': 'Hotel Chocolat',
  'lakeland': 'Lakeland',
};

/** Whole-cell non-person strings in the Repairer Name column that represent defect notes or placeholders. */
const WHOLE_CELL_NON_PERSON_DEFECTS = new Set([
  'back pack buckle repair',
  'clock mechanism faulty',
  'blanket no go , electronic faulty customer will try manufacture',
  'yellow hoodie',
  'hose broken in hosing',
  'hum on both loadspeakers',
  'bad zip, came open',
  'jeans pocket',
  'left for home repair',
]);

/** Whole-cell placeholder values in the Repairer Name column that map to Unknown with no defect note. */
const WHOLE_CELL_UNKNOWN_PLACEHOLDERS = new Set([
  '',
  'unknown',
  "can't remember",
  'cant remember',
  '102',
  '106',
  '?',
  'n/a',
  'na',
]);

/** Canonical lookup dictionary mapping lowercase volunteer name variants/initials to canonical names. */
const CANONICAL_VOLUNTEER_MAP: Record<string, string> = {
  'rae': 'Rae Martin',
  'rae martin': 'Rae Martin',
  'richard': 'Richard Grime',
  'richard g': 'Richard Grime',
  'richard grime': 'Richard Grime',
  'rg': 'Richard Grime',
  'richard m': 'Richard M',
  'luke': 'Luke Colbert',
  'luke colbert': 'Luke Colbert',
  'mary': 'Mary Warren',
  'mary warren': 'Mary Warren',
  'marion': 'Marion Pereira',
  'marion pereira': 'Marion Pereira',
  'marion periera': 'Marion Pereira',
  'marian': 'Marion Pereira',
  'sue': 'Sue Spenceley-Burch',
  'sue spenceley-burch': 'Sue Spenceley-Burch',
  'sue spenceley burch': 'Sue Spenceley-Burch',
  'alex': 'Alex Rocha',
  'alex rocha': 'Alex Rocha',
  'tom': 'Tom Brzezinski',
  'tom b': 'Tom Brzezinski',
  'tb': 'Tom Brzezinski',
  'tom brzezinski': 'Tom Brzezinski',
  'dominic': 'Dominic Brzezinski',
  'dominic b': 'Dominic Brzezinski',
  'dom': 'Dominic Brzezinski',
  'dominic brzezinski': 'Dominic Brzezinski',
  'stuart': 'Stuart Russell',
  'stuart r': 'Stuart Russell',
  'stuart russell': 'Stuart Russell',
  'stuart russel': 'Stuart Russell',
  'garreth': 'Garreth',
  'gareth': 'Garreth',
  'charles': 'Charles Barraball',
  'charles barraball': 'Charles Barraball',
  'frank': 'Frank Scott',
  'frank scott': 'Frank Scott',
  'ranji': 'Ranji',
  'ranj': 'Ranji',
  'pradeep': 'Pradeep',
  'jessica': 'Jessica',
  'jes': 'Jessica',
  'jess': 'Jessica',
  'ian': 'Ian',
  'alice': 'Alice',
  'mel': 'Mel',
  'vaskor': 'Vaskor',
  'libby': 'Libby',
  'phil': 'Phil',
  'helen': 'Helen',
  'martin': 'Martin',
  'grace': 'Grace',
  'andrew': 'Andrew',
  'keith': 'Keith',
  'trevor': 'Trevor',
};

/**
 * Recursively removes keys with `undefined` values or `NaN` numbers from an object
 * before writing to Cloud Firestore.
 */
export function removeUndefined<T>(obj: T): T {
  // Pass primitives and null through unchanged
  if (obj === null || obj === undefined || typeof obj !== 'object') {
    return obj;
  }

  // Recursively sanitize array elements
  if (Array.isArray(obj)) {
    return obj.map((item) => removeUndefined(item)) as unknown as T;
  }

  // Copy only defined, non-NaN entries into a clean plain object
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined && !(typeof value === 'number' && Number.isNaN(value))) {
      result[key] =
        typeof value === 'object' && value !== null ? removeUndefined(value) : value;
    }
  }
  return result as T;
}

/**
 * Validates that a required CLI flag value is present and not another flag.
 */
function requireCliValue(
  value: string | undefined,
  flagName: string,
  placeholder: string
): string {
  // Reject missing or flag-prefixed values with a clear error message
  if (!value || !value.trim() || value.trim().startsWith('-')) {
    throw new Error(`Missing required ${placeholder} argument after "${flagName}".`);
  }
  return value.trim();
}

/**
 * Parses CLI arguments for the `ingestHistoricalData` script.
 */
export function parseIngestHistoricalArgs(argv: string[]): IngestHistoricalCliOptions {
  // Trim tokens and default empty invocations to help
  const tokens = argv.map((arg) => arg.trim()).filter((arg) => arg.length > 0);
  if (tokens.length === 0) {
    return {
      command: 'help',
      dryRun: false,
      confirm: false,
      force: false,
      overwrite: false,
    };
  }

  let registrationsPath: string | undefined;
  let outcomesPath: string | undefined;
  let patPath: string | undefined;
  let projectId: string | undefined;
  let dryRun = false;
  let confirm = false;
  let force = false;
  let overwrite = false;

  // Iterate through CLI tokens and extract file paths and safety flags
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === '--help' || token === '-h' || token === 'help') {
      return {
        command: 'help',
        dryRun: false,
        confirm: false,
        force: false,
        overwrite: false,
      };
    } else if (token === '--registrations') {
      registrationsPath = requireCliValue(tokens[i + 1], '--registrations', '<path>');
      i++;
    } else if (token === '--outcomes') {
      outcomesPath = requireCliValue(tokens[i + 1], '--outcomes', '<path>');
      i++;
    } else if (token === '--pat') {
      patPath = requireCliValue(tokens[i + 1], '--pat', '<path>');
      i++;
    } else if (token === '--project') {
      const pid = requireCliValue(tokens[i + 1], '--project', '<projectId>');
      if (pid.includes('/') || /\s/.test(pid)) {
        throw new Error(`Invalid <projectId> "${pid}" for "--project": must not contain "/" or whitespace.`);
      }
      projectId = pid;
      i++;
    } else if (token === '--dry-run') {
      dryRun = true;
    } else if (token === '--confirm') {
      confirm = true;
    } else if (token === '--force') {
      force = true;
    } else if (token === '--overwrite') {
      overwrite = true;
    } else {
      throw new Error(`Unknown or unexpected CLI argument: "${token}".`);
    }
  }

  // Ensure all three CSV paths are supplied when running ingestion
  if (!registrationsPath || !outcomesPath || !patPath) {
    throw new Error(
      'Missing required CSV paths. Expected --registrations <path> --outcomes <path> --pat <path>.'
    );
  }

  return {
    command: 'ingest',
    registrationsPath,
    outcomesPath,
    patPath,
    dryRun,
    confirm,
    force,
    overwrite,
    projectId,
  };
}

/**
 * Parses an RFC 4180 CSV string into a 2D array of rows and cells, preserving
 * embedded newlines inside double-quoted fields and handling escaped `""` quotes.
 */
export function parseCsvRecords(csvContent: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = '';
  let inQuotes = false;

  // Strip optional UTF-8 BOM at the start of the file
  const content = csvContent.startsWith('\uFEFF') ? csvContent.slice(1) : csvContent;

  // Step character-by-character through the RFC 4180 state machine
  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    const nextCh = content[i + 1];

    if (inQuotes) {
      if (ch === '"') {
        if (nextCh === '"') {
          currentCell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        currentCell += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      currentRow.push(currentCell);
      currentCell = '';
    } else if (ch === '\r' && nextCh === '\n') {
      currentRow.push(currentCell);
      rows.push(currentRow);
      currentRow = [];
      currentCell = '';
      i++;
    } else if (ch === '\n' || ch === '\r') {
      currentRow.push(currentCell);
      rows.push(currentRow);
      currentRow = [];
      currentCell = '';
    } else {
      currentCell += ch;
    }
  }

  // Flush final cell/row if non-empty
  if (currentCell.length > 0 || currentRow.length > 0) {
    currentRow.push(currentCell);
    rows.push(currentRow);
  }

  return rows;
}

/**
 * Parses a UK Google Forms timestamp (`DD/MM/YYYY HH:mm:ss` or `DD/MM/YYYY`)
 * into an ISO `YYYY-MM-DD` date string and UTC epoch milliseconds.
 * Returns `null` for header rows, blank rows, `#VALUE!` rows, or malformed dates.
 */
export function parseUkTimestamp(
  raw: string
): { rawDate: string; timestampMs: number } | null {
  const trimmed = (raw || '').trim();
  const match = trimmed.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/
  );
  if (!match) {
    return null;
  }

  const day = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const year = parseInt(match[3], 10);
  const hour = match[4] !== undefined ? parseInt(match[4], 10) : 11;
  const minute = match[5] !== undefined ? parseInt(match[5], 10) : 0;
  const second = match[6] !== undefined ? parseInt(match[6], 10) : 0;

  // Validate calendar bounds
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 2000 || year > 2100) {
    return null;
  }

  const rawDate = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const timestampMs = Date.UTC(year, month - 1, day, hour, minute, second);
  return { rawDate, timestampMs };
}

/**
 * Snaps off-Saturday historical form timestamps to their true Saturday Repair Café
 * session date and handles the `14/06/2024` card collision override.
 */
export function resolveHistoricalSessionDate(
  source: 'registration' | 'outcome' | 'pat',
  rawDate: string,
  cardNumber: number | null
): { sessionDate: string; cardNumberOverride?: number | null; noteOverride?: string } {
  // Snap Friday 13/12/2024 22:30:28 registration to Saturday 14/12/2024 session
  if (rawDate === '2024-12-13') {
    return { sessionDate: '2024-12-14' };
  }

  // Handle Friday 14/06/2024 late-logged entries
  if (rawDate === '2024-06-14') {
    if (
      source === 'outcome' &&
      cardNumber !== null &&
      [131, 130, 116, 137].includes(cardNumber)
    ) {
      return { sessionDate: '2024-05-11' };
    }
    if (source === 'registration' && cardNumber === 127) {
      return {
        sessionDate: '2024-06-08',
        cardNumberOverride: null,
        noteOverride: 'Original card #127 on 14/06/2024 - Waiting at clothes swap',
      };
    }
    return { sessionDate: '2024-06-08' };
  }

  return { sessionDate: rawDate };
}

/**
 * Extracts a positive integer physical card number from the `Repair Number` column,
 * or returns `cardNumber: null` with an optional `organizerNote` for free-text notes.
 */
export function parseHistoricalCardNumber(
  raw: string
): { cardNumber: number | null; organizerNote?: string } {
  const trimmed = (raw || '').trim();
  if (!trimmed) {
    return { cardNumber: null };
  }

  // Ignore placeholder tokens ("0", "PAPER", "?") without creating an organiser note
  if (trimmed === '0' || /^(?:paper|\?+)$/i.test(trimmed)) {
    return { cardNumber: null };
  }

  // Extract leading positive integer for card tokens like "102", "114rae", "122f", "102a"
  const leadingNumMatch = trimmed.match(/^(\d+)(.*)$/);
  if (leadingNumMatch) {
    const num = parseInt(leadingNumMatch[1], 10);
    const suffix = leadingNumMatch[2].trim();
    if (num > 0) {
      // Short alphanumeric card suffixes ("a", "f", "rae") are ignored; longer text becomes a note
      const organizerNote = suffix.length > 5 ? suffix : undefined;
      return { cardNumber: num, organizerNote };
    }
  }

  return { cardNumber: null, organizerNote: trimmed };
}

/**
 * Parses an item weight in kilograms from the `Item Weight` column (or an embedded
 * weight suffix in `Type of Item` such as `"Bike - 20kg"`), returning any non-weight
 * text in `Item Weight` as an `organizerNote`.
 */
export function parseHistoricalWeightKg(
  weightCell: string,
  itemTypeCell = ''
): { weightKg?: number; cleanedItemType: string; organizerNote?: string } {
  let cleanedItemType = itemTypeCell.trim();
  const trimmedWeight = (weightCell || '').trim();
  let weightKg: number | undefined;
  let organizerNote: string | undefined;

  // Check if the dedicated Item Weight cell contains a numeric g/kg measurement
  if (trimmedWeight) {
    const weightMatch = trimmedWeight.match(
      /^(\d+(?:\.\d+)?)\s*(kg|kgs|kilograms?|g|gm|gms|grams?)?$/i
    );
    if (weightMatch) {
      const value = parseFloat(weightMatch[1]);
      const unit = (weightMatch[2] || '').toLowerCase();
      if (value > 0) {
        if (unit.startsWith('g')) {
          weightKg = Math.round((value / 1000) * 1000) / 1000;
        } else if (unit.startsWith('k')) {
          weightKg = Math.round(value * 1000) / 1000;
        } else {
          // Unlabelled numbers > 30 in historical sheets are grams (e.g. 200 -> 0.2kg)
          weightKg =
            value > 30
              ? Math.round((value / 1000) * 1000) / 1000
              : Math.round(value * 1000) / 1000;
        }
      }
    } else {
      organizerNote = trimmedWeight;
    }
  }

  // Check Type of Item for embedded weight suffixes such as "Bike - 20kg" or "Kettle 1.2kg"
  if (weightKg === undefined && cleanedItemType) {
    const embeddedMatch = cleanedItemType.match(
      /(?:\s*[-–—]\s*|\s+)(\d+(?:\.\d+)?)\s*(kg|g)\b/i
    );
    if (embeddedMatch) {
      const val = parseFloat(embeddedMatch[1]);
      const unit = embeddedMatch[2].toLowerCase();
      weightKg =
        unit === 'g'
          ? Math.round((val / 1000) * 1000) / 1000
          : Math.round(val * 1000) / 1000;
      cleanedItemType = cleanedItemType.replace(embeddedMatch[0], '').trim();
    }
  }

  return { weightKg, cleanedItemType, organizerNote };
}

/**
 * Maps the `Time Taken to Repair` Google Form bucket to integer minutes.
 */
export function parseHistoricalDurationMinutes(raw: string): number {
  const norm = (raw || '').trim().toLowerCase();
  if (norm === 'less than 10 minutes' || norm === '10 minutes') {
    return 10;
  }
  if (norm === '10 - 20 minutes') {
    return 15;
  }
  if (norm === '20 - 30 minutes') {
    return 25;
  }
  if (norm === 'more than 20 minutes') {
    return 30;
  }
  if (norm === 'over 30 minutes') {
    return 45;
  }
  return 15;
}

/**
 * Maps the `Repaired?` column and fixer notes from `Repair Outcomes` to the
 * canonical `RepairOutcome` and finalized `ItemStatus`.
 */
export function mapHistoricalOutcomeAndStatus(
  repairedCell: string,
  notesCell: string
): { outcome: RepairOutcome; status: ItemStatus } {
  const repairedNorm = (repairedCell || '').trim().toLowerCase();
  const notesNorm = (notesCell || '').trim().toLowerCase();

  if (repairedNorm === 'yes') {
    return { outcome: 'FIXED', status: 'COMPLETED' };
  }
  if (repairedNorm.startsWith('no')) {
    return { outcome: 'UNFIXABLE', status: 'UNFIXABLE' };
  }
  if (repairedNorm.startsWith('partial')) {
    if (/advi[cs]/i.test(notesNorm)) {
      return { outcome: 'ADVICE_GIVEN', status: 'COMPLETED' };
    }
    return { outcome: 'PARTIAL', status: 'COMPLETED' };
  }
  if (repairedNorm.startsWith('second visit')) {
    if (/\b(?:taking|taken|take)\s+home\b/i.test(notesNorm)) {
      return { outcome: 'TAKEN_HOME', status: 'TAKEN_HOME' };
    }
    return { outcome: 'PARTIAL', status: 'COMPLETED' };
  }

  return { outcome: 'FIXED', status: 'COMPLETED' };
}

/**
 * Infers a `RepairOutcome` and `ItemStatus` for an orphan registration row using
 * any organiser notes on the row, defaulting to `'FIXED'` / `'COMPLETED'`.
 */
export function inferOrphanRegistrationOutcome(
  combinedOrgNotes: string
): { outcome: RepairOutcome; status: ItemStatus } {
  const norm = (combinedOrgNotes || '').trim();
  if (!norm) {
    return { outcome: 'FIXED', status: 'COMPLETED' };
  }

  // Check for explicit unfixable / dangerous / unrepairable organiser notes
  if (
    /\b(?:not\s+repai?rable|unable\s+to\s+(?:repair|fix|be\s+fixed)|can'?t\s+(?:repair|do)|couldn'?t\s+fix|dangerous\s+to\s+fix|don'?t\s+repair|non\s+repai?rable|not\s+fixed|motor\s+burnt\s+out)\b/i.test(
      norm
    )
  ) {
    return { outcome: 'UNFIXABLE', status: 'UNFIXABLE' };
  }

  // Check for explicit taken-home organiser notes
  if (
    /\b(?:taken?\s+home|taking\s+home|taken?\s+for\s+home\s+repair|left\s+for\s+home\s+repair)\b/i.test(
      norm
    )
  ) {
    return { outcome: 'TAKEN_HOME', status: 'TAKEN_HOME' };
  }

  // Check for explicit advice-given organiser notes
  if (/\b(?:advi[cs]e\s+(?:given|offered)|advised)\b/i.test(norm)) {
    return { outcome: 'ADVICE_GIVEN', status: 'COMPLETED' };
  }

  return { outcome: 'FIXED', status: 'COMPLETED' };
}

/**
 * Normalizes a single raw brand token to its canonical display brand or empty string.
 */
function normalizeSingleBrandToken(rawToken: string): string {
  const trimmedBrand = (rawToken || '')
    .trim()
    .replace(/^[?.,\-/]+|[?.,\-/]+$/g, '')
    .trim();
  const lowerBrand = trimmedBrand.toLowerCase().replace(/\s+/g, ' ');

  if (
    !lowerBrand ||
    BRAND_PLACEHOLDERS.has(lowerBrand) ||
    /^(?:not\s+sure|don'?t\s+know|unknown|no\s+brand|unbranded|n\/?a)\b/i.test(lowerBrand)
  ) {
    return '';
  }

  if (CANONICAL_BRAND_MAP[lowerBrand]) {
    return CANONICAL_BRAND_MAP[lowerBrand];
  }

  // Title-case each word while preserving short uppercase acronyms (e.g. "JVC", "B&Q")
  return trimmedBrand
    .split(/\s+/)
    .map((word) => {
      if (word.length <= 3 && word === word.toUpperCase() && /[A-Z]/.test(word)) {
        return word;
      }
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ');
}

/**
 * Normalizes a raw brand string and combines it with the cleaned item type
 * into `item.brandModel` without duplicating the brand name.
 */
export function normalizeBrandName(
  rawBrand: string,
  rawItemType: string
): { canonicalBrand: string; brandModel: string } {
  const cleanItemType = (rawItemType || '').trim();

  // Support semicolon-delimited multi-brand cells (e.g. "DeLonghi;Kenwood" -> "De'Longhi / Kenwood")
  const brandParts = (rawBrand || '')
    .split(';')
    .map((part) => normalizeSingleBrandToken(part))
    .filter((part) => part.length > 0);
  const canonicalBrand = brandParts.join(' / ');

  // Combine canonicalBrand and cleanItemType without duplicating the brand prefix
  if (!canonicalBrand) {
    return {
      canonicalBrand: '',
      brandModel: cleanItemType || 'Household Item',
    };
  }
  if (!cleanItemType) {
    return {
      canonicalBrand,
      brandModel: canonicalBrand,
    };
  }
  if (cleanItemType.toLowerCase().includes(canonicalBrand.toLowerCase())) {
    return {
      canonicalBrand,
      brandModel: cleanItemType,
    };
  }
  return {
    canonicalBrand,
    brandModel: `${canonicalBrand} - ${cleanItemType}`,
  };
}

/**
 * Classifies an item into `ItemCategory` and `PowerType` using strict word-boundary
 * precedence rules so substrings like `"Laptop"` never match `"top"` (`TEXTILES`).
 */
export function classifyItemCategoryAndPower(
  itemType: string,
  faultDesc: string,
  hasPatRecord: boolean
): { category: ItemCategory; powerType: PowerType } {
  // 1. PAT Override: any item with a PAT test record is a 240V mains electrical item
  if (hasPatRecord) {
    return { category: 'ELECTRICAL', powerType: 'MAINS_240V' };
  }

  const combined = `${itemType || ''} ${faultDesc || ''}`.trim();

  // 2. Explicit multi-word electrical overrides before textile/furniture/mechanical checks
  if (
    /\b(?:electric\s+blanket|under\s*blanket|heated\s+(?:airer|drier)|drysoon|sewing\s+machine|record\s+(?:player|deck)|turntable|vinyl\s+player|carpet\s+(?:cleaner|vleaner)|pressure\s+washer|jet\s+wash|steam\s+(?:iron|cleaner|cooker|oven)|lawn\s*mower|hedge\s*trimmer|strimmer|food\s+(?:processor|mixer|chopper|blender|dehydrator)|stand\s+mixer|hand\s+(?:blender|mixer|vac)|hair\s*(?:dryer|straightener|straighteners|straighters)|air\s*fryer|coffee\s+(?:machine|mashine|maker|grinder)|bread\s*maker|slow\s+cooker|rice\s+cooker|multi\s+cooker|pressure\s+cooker|water\s+heater|electric\s+fire|sound\s*(?:bar|box)|cd\s+player|dvd|blu\s*ray|blue\s*ray|vhs|vcr|hi\s*fi|av\s+amp|minidisc|minodisc|tape\s+(?:deck|recorder)|cassette|casette|velvetiser|nutri\s*bullet)\b/i.test(
      combined
    )
  ) {
    return { category: 'ELECTRICAL', powerType: 'MAINS_240V' };
  }

  // 3. Battery / low-voltage electronic toys
  if (
    /\b(?:gameboy|nintendo|2ds|wii|duplo\s+train|play\s*mobile|electronic\s+toy|battery\s+toy|toy\s+(?:train|sink|guitar|disco)|remote\s+control\s+car|whistling\s+marmot|busy\s+board)\b/i.test(
      combined
    )
  ) {
    return { category: 'TOY', powerType: 'BATTERY_LOW_VOLTAGE' };
  }

  // 4. Non-powered plush / wooden / mechanical toys
  if (
    /\b(?:teddy|doll|squishmallow|soft\s+(?:toy|monkey|you)|hand\s+knitted\s+toy|toy\s+gun|wooden\s+wheeled\s+toy|dog\s+toy|toy)\b/i.test(
      combined
    )
  ) {
    return { category: 'TOY', powerType: 'NOT_APPLICABLE' };
  }

  // 5. Textiles, clothing, bags, straps, and soft furnishings
  if (
    /\b(?:strap|shirt|t-?shirt|trousers?|jeans|coat|jacket|blazer|dress|skirt|jumper|hoodie|hoody|cardigan|zip|zipper|hem|seam|pocket|curtains?|duvet|towel|towelling|robe|blanket|bag|rucksack|backpack|handbag|holdall|purse|wallet|shoes?|trainers?|gloves?|scarf|hat|cap|bra|tights|leggings|shorts|fleece|vest|dungarees|cushion|dog\s+bed|tent|umbrella|parasol|belt|swim(?:ming)?\s+trunks|pyjama|pjs|garments?|clothes|clothing|velcro|darning|sewing|stitching|alteration)\b/i.test(
      combined
    )
  ) {
    return { category: 'TEXTILES', powerType: 'NOT_APPLICABLE' };
  }

  // 6. Woodwork & furniture
  if (/\b(?:wooden|stool|chair|table|drawers?|cupboard|chest|carving\s+tray)\b/i.test(combined)) {
    return { category: 'WOODWORK', powerType: 'NOT_APPLICABLE' };
  }

  // 7. Mechanical items (bikes, prams, garden hand tools, sharpening, luggage)
  if (
    /\b(?:bike|bicycle|cycle|pram|buggy|rollator|walker|secateurs?|secatures|secretaries|shears|loppers?|scissors?|suitcase|luggage|trolley|litter\s+picker|glasses|spectacles|saucepan|pan|pot|blind|walking\s+stick|washing\s+airer|drying\s+rack)\b/i.test(
      combined
    )
  ) {
    return { category: 'MECHANICAL', powerType: 'MECHANICAL' };
  }

  // 8. Battery / low-voltage electronics
  if (
    /\b(?:laptop|macbook|chromebook|ipad|tablet|phone|iphone|headphones?|earphones?|headset|bluetooth|walkie\s+talkie|watch|watches|clock|car\s+key|remote|camera|kindle|shaver|toothbrush|scales|blood\s+pressure|thermostat|light\s+box|usb|solar|battery|cordless|dyson\s+v\d+|dyson\s+dc\d+|halo)\b/i.test(
      combined
    )
  ) {
    return { category: 'ELECTRICAL', powerType: 'BATTERY_LOW_VOLTAGE' };
  }

  // 9. General mains electrical appliances
  if (
    /\b(?:lamp|light|lights|kettle|toaster|hoover|hoovet|vacuum|vaccum|iron|steamer|blender|mixer|microwave|dehumidifiers?|fan|heater|radio|stereo|amplifier|speaker|printer|shredder|mower|karcher|drill|sander|grinder|rotovator|rotorvator|scarifier|chainsaw|brush\s+cutter|concrete\s+breaker|charger|extension|plug|fuseboard|diffuser|purifier|television|tv|projector|cricut|synthesiser|electrical)\b/i.test(
      combined
    )
  ) {
    return { category: 'ELECTRICAL', powerType: 'MAINS_240V' };
  }

  return { category: 'OTHER', powerType: 'NOT_APPLICABLE' };
}

/**
 * Cleans and normalizes a raw volunteer/repairer/tester field into canonical
 * volunteer names and an optional extracted `defectNote`.
 */
export function normalizeVolunteerNames(
  rawField: string
): { canonicalNames: string[]; defectNote?: string } {
  const trimmed = (rawField || '').trim();
  const lower = trimmed.toLowerCase().replace(/\s+/g, ' ');

  // Step A: Check whole-cell placeholders and non-person defect strings BEFORE splitting
  if (WHOLE_CELL_UNKNOWN_PLACEHOLDERS.has(lower) || /^\d+$/.test(lower)) {
    return { canonicalNames: [] };
  }
  if (WHOLE_CELL_NON_PERSON_DEFECTS.has(lower)) {
    return { canonicalNames: [], defectNote: trimmed };
  }

  // Step B: Handle combined volunteer + defect entry ("Rae Martin both elements low insulation")
  if (lower === 'rae martin both elements low insulation') {
    return {
      canonicalNames: ['Rae Martin'],
      defectNote: 'Both elements low insulation',
    };
  }

  // Step C: Split compound volunteer credits on "&", "/", ",", or "and"
  const rawTokens = trimmed
    .split(/\s*(?:&|\/|,|\band\b)\s*/i)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);

  // Step D: Map each token to its canonical volunteer name and deduplicate case-insensitively
  const canonicalNames: string[] = [];
  const seenLower = new Set<string>();

  for (const token of rawTokens) {
    const cleanedToken = token.replace(/^[?.,\-/]+|[?.,\-/]+$/g, '').trim();
    const tokenLower = cleanedToken.toLowerCase().replace(/\s+/g, ' ');
    if (
      !tokenLower ||
      WHOLE_CELL_UNKNOWN_PLACEHOLDERS.has(tokenLower) ||
      WHOLE_CELL_NON_PERSON_DEFECTS.has(tokenLower) ||
      /^\d+$/.test(tokenLower)
    ) {
      continue;
    }

    const mapped =
      CANONICAL_VOLUNTEER_MAP[tokenLower] ||
      cleanedToken
        .split(/\s+/)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join(' ');

    const mappedLower = mapped.toLowerCase();
    if (!seenLower.has(mappedLower)) {
      seenLower.add(mappedLower);
      canonicalNames.push(mapped);
    }
  }

  return { canonicalNames };
}

/**
 * Pure zero-dependency implementation of session analytics calculation matching
 * `calculateSessionAnalytics` in `src/services/sessionService.ts`.
 */
export function computeHistoricalSessionAnalytics(
  sessionId: string,
  sessionName: string,
  sessionDate: string,
  repairs: RepairItem[],
  finalizedAt: number,
  volunteerCount: number,
  isTest = false
): SessionAnalytics {
  let totalItems = 0;
  let repairedCount = 0;
  let partialCount = 0;
  let unfixableCount = 0;
  let adviceCount = 0;
  let takenHomeCount = 0;
  let totalRepairTimeMinutes = 0;
  let totalWeightKg = 0;
  let mainsCount = 0;
  let patTestedCount = 0;
  let patFailedCount = 0;
  const categoryBreakdown: Record<string, number> = {};

  // Tally outcomes, durations, weights, categories, and PAT metrics across all session items
  for (const item of repairs) {
    totalItems++;
    const cat = item.item?.category || 'OTHER';
    categoryBreakdown[cat] = (categoryBreakdown[cat] || 0) + 1;

    if (item.item?.powerType === 'MAINS_240V') {
      mainsCount++;
    }
    if (item.item?.weightKg && typeof item.item.weightKg === 'number') {
      totalWeightKg += item.item.weightKg;
    }

    if (item.repair) {
      if (
        item.repair.repairTimeMinutes &&
        typeof item.repair.repairTimeMinutes === 'number'
      ) {
        totalRepairTimeMinutes += item.repair.repairTimeMinutes;
      }
      if (item.repair.outcome === 'FIXED') repairedCount++;
      else if (item.repair.outcome === 'PARTIAL') partialCount++;
      else if (item.repair.outcome === 'UNFIXABLE') unfixableCount++;
      else if (item.repair.outcome === 'ADVICE_GIVEN') adviceCount++;
      else if (item.repair.outcome === 'TAKEN_HOME') takenHomeCount++;
    } else if (item.status === 'UNFIXABLE') {
      unfixableCount++;
    }

    if (item.patInitial || item.patFinal) {
      patTestedCount++;
      if (
        item.patInitial?.outcome === 'FAIL_REPAIRABLE_CORD' ||
        item.patInitial?.outcome === 'DANGER_DO_NOT_ENERGIZE' ||
        item.patFinal?.outcome === 'FAIL'
      ) {
        patFailedCount++;
      }
    }
  }

  const successRatePercent =
    totalItems > 0 ? Math.round(((repairedCount + partialCount) / totalItems) * 100) : 0;
  const totalAssessed = repairedCount + partialCount + unfixableCount + adviceCount;
  const averageRepairTimeMinutes =
    totalAssessed > 0 ? Math.round(totalRepairTimeMinutes / totalAssessed) : 0;
  const patFailureRatePercent =
    patTestedCount > 0 ? Math.round((patFailedCount / patTestedCount) * 100) : 0;

  return {
    sessionId,
    sessionName,
    date: sessionDate,
    isTest: Boolean(isTest),
    totalItems,
    repairedCount,
    partialCount,
    unfixableCount,
    adviceCount,
    takenHomeCount,
    totalRepairTimeMinutes,
    averageRepairTimeMinutes,
    successRatePercent,
    totalWeightDivertedKg: Math.round(totalWeightKg * 10) / 10,
    categoryBreakdown,
    mainsItemsCount: mainsCount,
    patTestedCount,
    patFailureRatePercent,
    volunteerCount,
    finalizedAt,
  };
}

/**
 * Extracts a floating-point measurement (handling leading decimals like `">.08"`)
 * from a PAT Earth Continuity or Insulation Resistance cell.
 */
export function parsePatNumericMeasurement(raw: string): number | undefined {
  const trimmed = (raw || '').trim();
  if (!trimmed) {
    return undefined;
  }
  const match = trimmed.match(/(?:\d+(?:\.\d+)?|\.\d+)/);
  if (!match) {
    return undefined;
  }
  const parsed = parseFloat(match[0]);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/**
 * Parses a single sanitized `PAT Tests` CSV row into a structured {@link ParsedPatRow}.
 */
function parseSinglePatRow(row: string[]): ParsedPatRow | null {
  const ts = parseUkTimestamp(row[0] || '');
  if (!ts) {
    return null;
  }

  const { cardNumber } = parseHistoricalCardNumber(row[1] || '');
  const { sessionDate } = resolveHistoricalSessionDate('pat', ts.rawDate, cardNumber);
  const classCell = (row[5] || '').trim().toLowerCase();
  const applianceClass: ApplianceClass | undefined =
    classCell === 'class i'
      ? 'CLASS_I'
      : classCell === 'class ii'
        ? 'CLASS_II'
        : classCell === 'class iii'
          ? 'CLASS_III'
          : undefined;

  const fuseCell = (row[6] || '').trim().toLowerCase();
  const fuseRatingAmps: 3 | 5 | 13 | 'OTHER' = fuseCell.includes('3 amp')
    ? 3
    : fuseCell.includes('5 amp')
      ? 5
      : fuseCell.includes('13 amp')
        ? 13
        : 'OTHER';

  const resultCell = (row[10] || '').trim().toLowerCase();
  const resultPass = resultCell !== 'fail';
  const visualCell = (row[7] || '').trim().toLowerCase();
  const visualPass = visualCell === 'pass' || (visualCell === '' && resultPass);

  // Parse Earth Continuity (Ohms), ignoring MOhm entries or N/A placeholders
  const earthRaw = (row[8] || '').trim();
  const earthContinuityOhms =
    !earthRaw || /^(?:n\/?a|pass)$/i.test(earthRaw) || /mohm/i.test(earthRaw)
      ? undefined
      : parsePatNumericMeasurement(earthRaw);

  // Parse Insulation Resistance (MOhms), defaulting Pass/empty to 200 and Fail/empty to 0
  const insRaw = (row[9] || '').trim();
  const parsedIns =
    !insRaw || /^(?:n\/?a|pass)$/i.test(insRaw)
      ? undefined
      : parsePatNumericMeasurement(insRaw);
  const insulationResistanceMOhms =
    parsedIns !== undefined ? parsedIns : resultPass ? 200 : 0;

  const rawComments = (row[11] || '').trim();
  const comments =
    rawComments && !/^(?:n\/?a|none|-)$/i.test(rawComments) ? rawComments : undefined;

  return {
    sessionDate,
    timestampMs: ts.timestampMs,
    cardNumber,
    stageRaw: (row[2] || '').trim(),
    testerRaw: (row[3] || '').trim(),
    itemDescription: (row[4] || '').trim(),
    applianceClass,
    fuseRatingAmps,
    visualPass,
    earthContinuityOhms,
    insulationResistanceMOhms,
    resultPass,
    comments,
  };
}

/**
 * Parses all valid rows from `Registration Responses`, `Repair Outcomes`, and `PAT Tests`.
 */
function parseAllCsvSheets(
  registrationsCsv: string,
  outcomesCsv: string,
  patCsv: string
): {
  regRows: ParsedRegistrationRow[];
  outcomeRows: ParsedOutcomeRow[];
  patRows: ParsedPatRow[];
} {
  const regRawRows = parseCsvRecords(registrationsCsv).slice(1);
  const outcomeRawRows = parseCsvRecords(outcomesCsv).slice(1);
  const patRawRows = parseCsvRecords(patCsv).slice(1);

  const regRows: ParsedRegistrationRow[] = [];
  for (const row of regRawRows) {
    const ts = parseUkTimestamp(row[0] || '');
    if (!ts) continue;

    const cardParsed = parseHistoricalCardNumber(row[8] || '');
    const resolved = resolveHistoricalSessionDate(
      'registration',
      ts.rawDate,
      cardParsed.cardNumber
    );
    const finalCard =
      resolved.cardNumberOverride !== undefined
        ? resolved.cardNumberOverride
        : cardParsed.cardNumber;
    const weightParsed = parseHistoricalWeightKg(row[9] || '', row[3] || '');

    // Collect any non-empty organiser notes from card, weight, or trailing columns [10..12]
    const organizerNotes: string[] = [];
    if (resolved.noteOverride) organizerNotes.push(resolved.noteOverride);
    if (cardParsed.organizerNote) organizerNotes.push(cardParsed.organizerNote);
    if (weightParsed.organizerNote) organizerNotes.push(weightParsed.organizerNote);

    const assignedRaw = (row[10] || '').trim();
    const assignedNorm = normalizeVolunteerNames(assignedRaw);
    if (assignedRaw && assignedNorm.canonicalNames.length === 0) {
      organizerNotes.push(assignedRaw);
    }
    for (const colIdx of [11, 12]) {
      const extraNote = (row[colIdx] || '').trim();
      if (extraNote && !/^#value!?$/i.test(extraNote)) {
        organizerNotes.push(extraNote);
      }
    }

    regRows.push({
      sessionDate: resolved.sessionDate,
      timestampMs: ts.timestampMs,
      cardNumber: finalCard,
      itemType: weightParsed.cleanedItemType,
      itemBrand: (row[4] || '').trim(),
      problemDescription: (row[5] || '').trim(),
      weightKg: weightParsed.weightKg,
      assignedRaw,
      organizerNotes,
    });
  }

  const outcomeRows: ParsedOutcomeRow[] = [];
  for (const row of outcomeRawRows) {
    const ts = parseUkTimestamp(row[0] || '');
    if (!ts) continue;
    const { cardNumber } = parseHistoricalCardNumber(row[1] || '');
    const { sessionDate } = resolveHistoricalSessionDate('outcome', ts.rawDate, cardNumber);
    outcomeRows.push({
      sessionDate,
      timestampMs: ts.timestampMs,
      cardNumber,
      repairerRaw: (row[2] || '').trim(),
      defectFound: (row[3] || '').trim(),
      repairedRaw: (row[4] || '').trim(),
      repairNotes: (row[5] || '').trim(),
      durationRaw: (row[6] || '').trim(),
    });
  }

  const patRows: ParsedPatRow[] = [];
  for (const row of patRawRows) {
    const parsed = parseSinglePatRow(row);
    if (parsed) {
      patRows.push(parsed);
    }
  }

  return { regRows, outcomeRows, patRows };
}

/**
 * Resolves all canonical volunteer names across the entire dataset against
 * `existingVolunteers`, auto-enrolling missing volunteers and upgrading `isPatTrained`
 * when a volunteer appears in `PAT Tests`.
 */
function resolveGlobalVolunteers(
  regRows: ParsedRegistrationRow[],
  outcomeRows: ParsedOutcomeRow[],
  patRows: ParsedPatRow[],
  existingVolunteers: Volunteer[],
  now: number
): {
  volunteerByCanonicalName: Map<string, Volunteer>;
  newVolunteers: Volunteer[];
  upgradedPatVolunteerIds: string[];
} {
  // Pass 1: Collect all canonical names and track whether each appeared in PAT Tests
  const patCanonicalLower = new Set<string>();
  const allCanonicalNames: string[] = [];
  const seenCanonicalLower = new Set<string>();

  const recordName = (name: string, isPat: boolean): void => {
    const lower = name.toLowerCase();
    if (isPat) {
      patCanonicalLower.add(lower);
    }
    if (!seenCanonicalLower.has(lower)) {
      seenCanonicalLower.add(lower);
      allCanonicalNames.push(name);
    }
  };

  for (const r of regRows) {
    const { canonicalNames } = normalizeVolunteerNames(r.assignedRaw);
    canonicalNames.forEach((n) => recordName(n, false));
  }
  for (const o of outcomeRows) {
    const { canonicalNames } = normalizeVolunteerNames(o.repairerRaw);
    canonicalNames.forEach((n) => recordName(n, false));
  }
  for (const p of patRows) {
    const { canonicalNames } = normalizeVolunteerNames(p.testerRaw);
    canonicalNames.forEach((n) => recordName(n, true));
  }

  const volunteerByCanonicalName = new Map<string, Volunteer>();
  const newVolunteers: Volunteer[] = [];
  const upgradedPatVolunteerIds: string[] = [];
  const upgradedIdSet = new Set<string>();

  // Match each canonical volunteer against existingVolunteers (exact full name, then unique first name)
  for (const canonical of allCanonicalNames) {
    const lower = canonical.toLowerCase();
    const appearedInPat = patCanonicalLower.has(lower);

    let matched = existingVolunteers.find(
      (v) => v.name.trim().toLowerCase() === lower
    );
    if (!matched && !canonical.includes(' ')) {
      const firstMatches = existingVolunteers.filter(
        (v) => v.name.trim().split(/\s+/)[0].toLowerCase() === lower
      );
      if (firstMatches.length === 1) {
        matched = firstMatches[0];
      }
    }

    if (matched) {
      if (appearedInPat && !matched.isPatTrained && !upgradedIdSet.has(matched.id)) {
        upgradedIdSet.add(matched.id);
        upgradedPatVolunteerIds.push(matched.id);
      }
      const resolvedRecord: Volunteer = {
        ...matched,
        isPatTrained: Boolean(matched.isPatTrained || appearedInPat),
      };
      volunteerByCanonicalName.set(lower, resolvedRecord);
    } else {
      const slug = lower.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const created: Volunteer = {
        id: `vol-hist-${slug}`,
        name: canonical,
        emergencyContactName: 'Pending (Historical Import)',
        emergencyContactPhone: '00000000000',
        isOrganiser: false,
        isPatTrained: appearedInPat,
        inducted: true,
        inductedAt: now,
        inductedBy: 'Historical Import',
        createdAt: now,
        updatedAt: now,
      };
      newVolunteers.push(created);
      volunteerByCanonicalName.set(lower, created);
    }
  }

  return { volunteerByCanonicalName, newVolunteers, upgradedPatVolunteerIds };
}

/**
 * Formats a `YYYY-MM-DD` date string into `"<MonthName> <YYYY> - YourSpace"`.
 */
function formatYourSpaceSessionName(sessionDate: string): string {
  const [yearStr, monthStr] = sessionDate.split('-');
  const monthIdx = parseInt(monthStr, 10) - 1;
  const monthName = MONTH_NAMES[monthIdx] || 'Session';
  return `${monthName} ${yearStr} - YourSpace`;
}

/**
 * Builds `patInitial` and optional `patFinal` payloads from chronologically sorted PAT rows.
 */
function buildPatRecordsForItem(
  sortedPatRows: ParsedPatRow[],
  finalStatus: ItemStatus,
  recordAttendeeName: (canonicalName: string) => void
): {
  patInitial?: RepairItem['patInitial'];
  patFinal?: RepairItem['patFinal'];
  primaryTesterDisplay: string;
  firstApplianceClass?: ApplianceClass;
} {
  if (sortedPatRows.length === 0) {
    return { primaryTesterDisplay: 'Unknown' };
  }

  const resolveTesterDisplay = (rawTester: string): string => {
    const { canonicalNames } = normalizeVolunteerNames(rawTester);
    canonicalNames.forEach((n) => recordAttendeeName(n));
    return canonicalNames.length > 0 ? canonicalNames.join(' & ') : 'Unknown';
  };

  const firstPat = sortedPatRows[0];
  const firstTester = resolveTesterDisplay(firstPat.testerRaw);
  const initialOutcome: PatInitialOutcome = firstPat.resultPass
    ? 'PASS'
    : finalStatus === 'UNFIXABLE'
      ? 'DANGER_DO_NOT_ENERGIZE'
      : 'FAIL_REPAIRABLE_CORD';

  const patInitial: RepairItem['patInitial'] = removeUndefined({
    testedAt: firstPat.timestampMs,
    testerName: firstTester,
    instrumentSerial: 'HISTORICAL-PAT',
    visualPass: firstPat.visualPass,
    fuseRatingAmps: firstPat.fuseRatingAmps,
    testVoltageVolts: 500,
    earthContinuityOhms: firstPat.earthContinuityOhms,
    insulationResistanceMOhms: firstPat.insulationResistanceMOhms,
    outcome: initialOutcome,
    cautionNotes: firstPat.comments,
  });

  let patFinal: RepairItem['patFinal'] | undefined;
  if (sortedPatRows.length >= 2) {
    const lastPat = sortedPatRows[sortedPatRows.length - 1];
    const lastTester = resolveTesterDisplay(lastPat.testerRaw);
    const finalOutcome: PatFinalOutcome = lastPat.resultPass ? 'PASS' : 'FAIL';
    patFinal = removeUndefined({
      testedAt: lastPat.timestampMs,
      testerName: lastTester,
      instrumentSerial: 'HISTORICAL-PAT',
      visualPass: lastPat.visualPass,
      fuseRatingAmps: lastPat.fuseRatingAmps,
      testVoltageVolts: 500,
      earthContinuityOhms: lastPat.earthContinuityOhms,
      insulationResistanceMOhms: lastPat.insulationResistanceMOhms,
      outcome: finalOutcome,
      certificateNotes: lastPat.comments,
    });
  }

  const firstApplianceClass = sortedPatRows.find((p) => p.applianceClass)?.applianceClass;
  return {
    patInitial,
    patFinal,
    primaryTesterDisplay: firstTester,
    firstApplianceClass,
  };
}

/**
 * Synthesizes a single `RepairItem` and redacted `PrivateCustomerData` from
 * matched or orphan Registration, Outcome, and PAT rows.
 */
function buildSingleHistoricalRepairItem(params: {
  sessionId: string;
  sessionDateCompact: string;
  cardNumber: number | null;
  uncardedIndex?: number;
  reg?: ParsedRegistrationRow;
  outcome?: ParsedOutcomeRow;
  patList: ParsedPatRow[];
  now: number;
  recordAttendeeName: (canonicalName: string) => void;
}): { repairItem: RepairItem; privateCustomer: PrivateCustomerData; timestampMs: number } {
  const {
    sessionId,
    sessionDateCompact,
    cardNumber,
    uncardedIndex,
    reg,
    outcome,
    patList,
    now,
    recordAttendeeName,
  } = params;

  // Sort PAT records chronologically by timestampMs ascending
  const sortedPats = [...patList].sort((a, b) => a.timestampMs - b.timestampMs);
  const hasPat = sortedPats.length > 0;
  const lastPatFailed =
    hasPat && !sortedPats[sortedPats.length - 1].resultPass;

  // Determine deterministic IDs and reference token
  const repairId =
    cardNumber !== null
      ? `hist-${sessionDateCompact}-card-${cardNumber}`
      : `hist-${sessionDateCompact}-uncarded-${uncardedIndex}`;
  const registrationId = `reg-${repairId}`;
  const referenceToken =
    cardNumber !== null
      ? `REF-H${String(cardNumber).padStart(3, '0')}`
      : `REF-U${String(uncardedIndex || 1).padStart(3, '0')}`;

  // Determine outcome and status from Outcome row, or infer for orphan Registration / PAT
  const combinedOrgNotes = reg ? reg.organizerNotes.join('; ') : '';
  let mappedOutcome: RepairOutcome;
  let mappedStatus: ItemStatus;

  if (outcome) {
    const combinedOutcomeNotes = `${outcome.repairNotes} ${outcome.defectFound}`.trim();
    const mapped = mapHistoricalOutcomeAndStatus(outcome.repairedRaw, combinedOutcomeNotes);
    mappedOutcome = mapped.outcome;
    mappedStatus = mapped.status;
  } else if (reg) {
    const inferred = inferOrphanRegistrationOutcome(combinedOrgNotes);
    mappedOutcome = lastPatFailed ? 'UNFIXABLE' : inferred.outcome;
    mappedStatus = lastPatFailed ? 'UNFIXABLE' : inferred.status;
  } else {
    mappedOutcome = lastPatFailed ? 'UNFIXABLE' : 'FIXED';
    mappedStatus = lastPatFailed ? 'UNFIXABLE' : 'COMPLETED';
  }

  // Build PAT 1 and PAT 2 records
  const patBuilt = buildPatRecordsForItem(sortedPats, mappedStatus, recordAttendeeName);

  // Resolve fixer name and optional defectNote from Repairer Name or Assigned column
  let fixerDisplay = 'Unknown';
  let extractedDefectNote: string | undefined;

  if (outcome) {
    const normFixer = normalizeVolunteerNames(outcome.repairerRaw);
    normFixer.canonicalNames.forEach((n) => recordAttendeeName(n));
    extractedDefectNote = normFixer.defectNote;
    if (normFixer.canonicalNames.length > 0) {
      fixerDisplay = normFixer.canonicalNames.join(' & ');
    }
  }
  if (fixerDisplay === 'Unknown' && reg?.assignedRaw) {
    const normAssigned = normalizeVolunteerNames(reg.assignedRaw);
    normAssigned.canonicalNames.forEach((n) => recordAttendeeName(n));
    if (normAssigned.canonicalNames.length > 0) {
      fixerDisplay = normAssigned.canonicalNames.join(' & ');
    }
  }
  if (fixerDisplay === 'Unknown' && hasPat) {
    fixerDisplay = patBuilt.primaryTesterDisplay;
  }

  // Synthesize item type, brandModel, faultDescription, category, and powerType
  const rawItemType =
    reg?.itemType ||
    sortedPats[0]?.itemDescription ||
    outcome?.defectFound ||
    outcome?.repairNotes ||
    'Household Item';
  const rawBrand = reg?.itemBrand || '';
  const { brandModel } = normalizeBrandName(rawBrand, rawItemType);
  const faultDescription =
    reg?.problemDescription ||
    outcome?.defectFound ||
    sortedPats[0]?.comments ||
    'Historical repair entry';
  const { category, powerType } = classifyItemCategoryAndPower(
    rawItemType,
    faultDescription,
    hasPat
  );

  // Combine diagnosis and repair notes cleanly
  const diagnosisParts: string[] = [];
  if (extractedDefectNote) diagnosisParts.push(extractedDefectNote);
  if (outcome?.defectFound) diagnosisParts.push(outcome.defectFound);
  const diagnosis = diagnosisParts.length > 0 ? diagnosisParts.join(' — ') : undefined;

  const notesParts: string[] = [];
  if (outcome?.repairNotes) notesParts.push(outcome.repairNotes);
  if (combinedOrgNotes) notesParts.push(combinedOrgNotes);
  const repairNotes = notesParts.length > 0 ? notesParts.join(' | ') : undefined;

  const timestampMs =
    reg?.timestampMs ??
    outcome?.timestampMs ??
    sortedPats[0]?.timestampMs ??
    Date.UTC(2024, 0, 1, 11, 0, 0);
  const repairedAt =
    outcome?.timestampMs ?? sortedPats[sortedPats.length - 1]?.timestampMs ?? timestampMs;
  const repairTimeMinutes = outcome
    ? parseHistoricalDurationMinutes(outcome.durationRaw)
    : 15;

  const repairItem: RepairItem = removeUndefined({
    id: repairId,
    sessionId,
    registrationId,
    referenceToken,
    cardNumber,
    customerName: '[REDACTED]',
    item: {
      category,
      brandModel,
      faultDescription,
      powerType,
      applianceClass: patBuilt.firstApplianceClass,
      weightKg: reg?.weightKg,
    },
    status: mappedStatus,
    patInitial: patBuilt.patInitial,
    repair: {
      repairTimeMinutes,
      fixerName: fixerDisplay,
      diagnosis,
      repairNotes,
      outcome: mappedOutcome,
      repairedAt,
    },
    patFinal: patBuilt.patFinal,
    createdAt: timestampMs,
    updatedAt: repairedAt,
  });

  const privateCustomer: PrivateCustomerData = removeUndefined({
    firstName: '[REDACTED]',
    agreedToTerms: true,
    termsVersion: 'historical-google-form',
    registeredAt: timestampMs,
    submittedAt: timestampMs,
    redactedAt: now,
  });

  return { repairItem, privateCustomer, timestampMs };
}

/**
 * Builds the complete deterministic {@link HistoricalIngestionPlan} from the three
 * CSV strings and the current Firestore `volunteers` list.
 */
export function buildHistoricalIngestionPlan(params: {
  registrationsCsv: string;
  outcomesCsv: string;
  patCsv: string;
  existingVolunteers: Volunteer[];
  force?: boolean;
  now?: number;
}): HistoricalIngestionPlan {
  const {
    registrationsCsv,
    outcomesCsv,
    patCsv,
    existingVolunteers,
    force = false,
    now = Date.now(),
  } = params;

  const { regRows, outcomeRows, patRows } = parseAllCsvSheets(
    registrationsCsv,
    outcomesCsv,
    patCsv
  );

  // Resolve global volunteers (Pass 1) across all sheets
  const {
    volunteerByCanonicalName,
    newVolunteers,
    upgradedPatVolunteerIds,
  } = resolveGlobalVolunteers(regRows, outcomeRows, patRows, existingVolunteers, now);

  // Collect all unique session dates in chronological order
  const allDates = Array.from(
    new Set([
      ...regRows.map((r) => r.sessionDate),
      ...outcomeRows.map((o) => o.sessionDate),
      ...patRows.map((p) => p.sessionDate),
    ])
  ).sort();

  const collisions: CardCollisionRecord[] = [];
  const droppedDuplicates: CardCollisionRecord[] = [];
  const sessions: PlannedHistoricalSession[] = [];

  // Process each session date (Pass 2)
  for (const sessionDate of allDates) {
    const sessionDateCompact = sessionDate.replace(/-/g, '');
    const sessionId = `${sessionDateCompact}-yourspace`;
    const sessionName = formatYourSpaceSessionName(sessionDate);

    const sessionRegs = regRows.filter((r) => r.sessionDate === sessionDate);
    const sessionOutcomes = outcomeRows.filter((o) => o.sessionDate === sessionDate);
    const sessionPats = patRows.filter((p) => p.sessionDate === sessionDate);

    // Index carded rows and detect duplicate card collisions within the session
    const regByCard = new Map<number, ParsedRegistrationRow>();
    const uncardedRegs: ParsedRegistrationRow[] = [];
    for (const r of sessionRegs) {
      if (r.cardNumber === null) {
        uncardedRegs.push(r);
        continue;
      }
      const existing = regByCard.get(r.cardNumber);
      if (existing) {
        const record: CardCollisionRecord = {
          sessionDate,
          source: 'registration',
          cardNumber: r.cardNumber,
          keptRowSummary: `${existing.itemBrand} ${existing.itemType} (${existing.problemDescription})`.trim(),
          conflictingRowSummary: `${r.itemBrand} ${r.itemType} (${r.problemDescription})`.trim(),
        };
        if (force) {
          droppedDuplicates.push(record);
        } else {
          collisions.push(record);
        }
      } else {
        regByCard.set(r.cardNumber, r);
      }
    }

    const outcomeByCard = new Map<number, ParsedOutcomeRow>();
    const uncardedOutcomes: ParsedOutcomeRow[] = [];
    for (const o of sessionOutcomes) {
      if (o.cardNumber === null) {
        uncardedOutcomes.push(o);
        continue;
      }
      const existing = outcomeByCard.get(o.cardNumber);
      if (existing) {
        const record: CardCollisionRecord = {
          sessionDate,
          source: 'outcome',
          cardNumber: o.cardNumber,
          keptRowSummary: `${existing.repairerRaw}: ${existing.defectFound} (${existing.repairedRaw})`.trim(),
          conflictingRowSummary: `${o.repairerRaw}: ${o.defectFound} (${o.repairedRaw})`.trim(),
        };
        if (force) {
          droppedDuplicates.push(record);
        } else {
          collisions.push(record);
        }
      } else {
        outcomeByCard.set(o.cardNumber, o);
      }
    }

    const patsByCard = new Map<number, ParsedPatRow[]>();
    const uncardedPats: ParsedPatRow[] = [];
    for (const p of sessionPats) {
      if (p.cardNumber === null) {
        uncardedPats.push(p);
        continue;
      }
      const list = patsByCard.get(p.cardNumber) || [];
      list.push(p);
      patsByCard.set(p.cardNumber, list);
    }

    // Track attending volunteers for this session
    const sessionVolunteerMap = new Map<string, Volunteer>();
    const recordAttendeeName = (canonicalName: string): void => {
      const vol = volunteerByCanonicalName.get(canonicalName.toLowerCase());
      if (vol) {
        sessionVolunteerMap.set(vol.id, vol);
      }
    };

    const allCardNumbers = Array.from(
      new Set([
        ...regByCard.keys(),
        ...outcomeByCard.keys(),
        ...patsByCard.keys(),
      ])
    ).sort((a, b) => a - b);

    const plannedRepairs: Array<{
      repairItem: RepairItem;
      privateCustomer: PrivateCustomerData;
    }> = [];
    const itemTimestamps: number[] = [];

    // 1. Build carded items
    for (const cardNumber of allCardNumbers) {
      const built = buildSingleHistoricalRepairItem({
        sessionId,
        sessionDateCompact,
        cardNumber,
        reg: regByCard.get(cardNumber),
        outcome: outcomeByCard.get(cardNumber),
        patList: patsByCard.get(cardNumber) || [],
        now,
        recordAttendeeName,
      });
      plannedRepairs.push({
        repairItem: built.repairItem,
        privateCustomer: built.privateCustomer,
      });
      itemTimestamps.push(built.timestampMs);
    }

    // 2. Build uncarded items with a single monotonic session-wide counter
    let uncardedIndex = 1;
    for (const reg of uncardedRegs) {
      const built = buildSingleHistoricalRepairItem({
        sessionId,
        sessionDateCompact,
        cardNumber: null,
        uncardedIndex: uncardedIndex++,
        reg,
        patList: [],
        now,
        recordAttendeeName,
      });
      plannedRepairs.push({
        repairItem: built.repairItem,
        privateCustomer: built.privateCustomer,
      });
      itemTimestamps.push(built.timestampMs);
    }
    for (const outcome of uncardedOutcomes) {
      const built = buildSingleHistoricalRepairItem({
        sessionId,
        sessionDateCompact,
        cardNumber: null,
        uncardedIndex: uncardedIndex++,
        outcome,
        patList: [],
        now,
        recordAttendeeName,
      });
      plannedRepairs.push({
        repairItem: built.repairItem,
        privateCustomer: built.privateCustomer,
      });
      itemTimestamps.push(built.timestampMs);
    }
    for (const pat of uncardedPats) {
      const built = buildSingleHistoricalRepairItem({
        sessionId,
        sessionDateCompact,
        cardNumber: null,
        uncardedIndex: uncardedIndex++,
        patList: [pat],
        now,
        recordAttendeeName,
      });
      plannedRepairs.push({
        repairItem: built.repairItem,
        privateCustomer: built.privateCustomer,
      });
      itemTimestamps.push(built.timestampMs);
    }

    // Project attending volunteers to sorted SessionVolunteerSummary array
    const attendingVolunteers: SessionVolunteerSummary[] = Array.from(
      sessionVolunteerMap.values()
    )
      .map((v) => ({
        id: v.id,
        name: v.name.trim(),
        isOrganiser: Boolean(v.isOrganiser),
        isPatTrained: Boolean(v.isPatTrained),
        inducted: Boolean(v.inducted),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const attendingVolunteerIds = attendingVolunteers.map((v) => v.id);

    const cardRangeStart = allCardNumbers.length > 0 ? Math.min(...allCardNumbers) : 100;
    const cardRangeEnd = allCardNumbers.length > 0 ? Math.max(...allCardNumbers) : 150;
    const createdAt =
      itemTimestamps.length > 0
        ? Math.min(...itemTimestamps)
        : Date.parse(`${sessionDate}T10:00:00.000Z`);
    const finalizedAt =
      itemTimestamps.length > 0
        ? Math.max(...itemTimestamps)
        : Date.parse(`${sessionDate}T13:30:00.000Z`);

    const sessionDoc: Session = removeUndefined({
      id: sessionId,
      name: sessionName,
      date: sessionDate,
      status: 'FINALIZED',
      isTest: false,
      volunteerPinHash: HISTORICAL_DEFAULT_PIN_HASH,
      cardRangeStart,
      cardRangeEnd,
      attendingVolunteerIds,
      attendingVolunteers,
      createdAt,
      finalizedAt,
    });

    const analyticsDoc = removeUndefined(
      computeHistoricalSessionAnalytics(
        sessionId,
        sessionName,
        sessionDate,
        plannedRepairs.map((r) => r.repairItem),
        finalizedAt,
        attendingVolunteers.length,
        false
      )
    );

    sessions.push({
      session: sessionDoc,
      repairs: plannedRepairs,
      analytics: analyticsDoc,
    });
  }

  return {
    sessions,
    newVolunteers,
    upgradedPatVolunteerIds,
    collisions,
    droppedDuplicates,
  };
}
