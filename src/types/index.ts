/**
 * @file src/types/index.ts
 *
 * Core TypeScript domain models, state machine enums, and Cloud Firestore document
 * schemas for the Repair Café Session Management System.
 *
 * Includes single-tenant configuration types, dual-phase PAT electrical safety records,
 * volunteer fixer diagnostics, compressed item photo subcollection records (Issue #4),
 * segregated UK GDPR customer PII, and aggregated impact analytics.
 */

/**
 * Supported household item categories for Repair Café triage and impact reporting.
 */
export type ItemCategory =
  | 'ELECTRICAL'
  | 'MECHANICAL'
  | 'TEXTILES'
  | 'WOODWORK'
  | 'TOY'
  | 'OTHER';

/**
 * Power source classification used to route 240V mains items through mandatory PAT safety gates.
 */
export type PowerType =
  | 'MAINS_240V'
  | 'BATTERY_LOW_VOLTAGE'
  | 'MECHANICAL'
  | 'NOT_APPLICABLE'
  | 'OTHER';

/**
 * BS 1363 & IET Code of Practice electrical appliance insulation classes.
 */
export type ApplianceClass =
  | 'CLASS_I'
  | 'CLASS_II'
  | 'CLASS_III'
  | 'LEADS_ADAPTER'
  | 'NOT_APPLICABLE';

/**
 * Lifecycle state machine statuses for an item progressing through the 5 physical stations.
 */
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

/**
 * Pre-repair (PAT 1) safety inspection outcomes determining whether an item may be energized.
 */
export type PatInitialOutcome =
  | 'PASS'
  | 'FAIL_REPAIRABLE_CORD'
  | 'DANGER_DO_NOT_ENERGIZE'
  | 'UNTESTABLE';

/**
 * Post-repair (PAT 2) electrical safety certification outcomes before customer collection.
 */
export type PatFinalOutcome =
  | 'PASS'
  | 'FAIL';

/**
 * Volunteer fixer diagnostic and repair outcomes logged at Station 4.
 */
export type RepairOutcome =
  | 'FIXED'
  | 'PARTIAL'
  | 'UNFIXABLE'
  | 'ADVICE_GIVEN'
  | 'TAKEN_HOME';

/**
 * Global system settings stored at `settings/system` in Cloud Firestore.
 * Subscribed to by all connected clients via `useActiveSession`.
 */
export interface SystemSettings {
  // Currently active monthly session ID (or null when no session is open)
  activeSessionId: string | null;
  // Epoch timestamp (ms) when settings/system was last updated
  updatedAt?: number;
  // Whether public customer self-registration is currently enabled
  allowRegistration?: boolean;
  // Optional override for the Repair Café display name
  cafeName?: string;
  // Dynamic list of authorised organiser Google email addresses synced from the Volunteer Register
  organizerEmails?: string[];
  // Latest deployed application version (e.g. "0.1.0+3a5f2b1") for cross-device update signalling
  deployedVersion?: string;
  // Numeric epoch timestamp (ms) of the latest deployed build
  deployedBuildTimestamp?: number;
  // Optional minimum required semver string (e.g. "0.1.0") for mandatory upgrades
  minSupportedVersion?: string;
}

/**
 * Summary of an attending volunteer embedded on a Session document.
 * Intentionally excludes contact and emergency PII so volunteer tablets never receive PII.
 */
export interface SessionVolunteerSummary {
  id: string;
  name: string;
  // Role and safety induction flags visible to station dropdowns
  isOrganiser: boolean;
  isPatTrained: boolean;
  inducted: boolean;
}

/**
 * Full Volunteer Register record stored in `volunteers/{volunteerId}`.
 * Accessible only to authenticated organisers (`isAdmin()`).
 */
export interface Volunteer {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  // Emergency contact details restricted to Front Desk organiser lookup
  emergencyContactName: string;
  emergencyContactPhone: string;
  emergencyContactRelationship?: string;
  // Role and safety qualification flags
  isOrganiser: boolean;
  isPatTrained: boolean;
  inducted: boolean;
  inductedAt?: number;
  inductedBy?: string;
  // Audit timestamps for register maintenance
  createdAt: number;
  updatedAt: number;
}

/**
 * Metadata and content for a bundled Repair Café policy Markdown document.
 */
export interface PolicyDocument {
  id: string;
  title: string;
  filePath: string;
  // Optional frontmatter metadata parsed from public/*.md
  version?: string;
  lastUpdated?: string;
  category?: string;
  summary?: string;
  content: string;
}

/**
 * Monthly Repair Café event session document stored at `sessions/{sessionId}`.
 */
export interface Session {
  id: string; // e.g., "2026-10-seears" or "2026-10-seears-test"
  name: string; // "October 2026 - Seears Park"
  date: string; // ISO 8601 YYYY-MM-DD
  status: 'ACTIVE' | 'FINALIZED';
  // Optional flag indicating a rehearsal/training session excluded from public impact reports (Issue #24)
  isTest?: boolean;
  // SHA-256 hash of daily 4-digit volunteer PIN and physical card range
  volunteerPinHash: string;
  cardRangeStart: number;
  cardRangeEnd: number;
  // Roster of volunteer IDs and non-PII summaries attending today's session
  attendingVolunteerIds?: string[];
  attendingVolunteers?: SessionVolunteerSummary[];
  createdAt: number;
  finalizedAt?: number;
}

/**
 * Payload submitted by Station 1 (`CustomerRegisterView`) when checking in a visitor.
 */
export interface CustomerRegistrationSubmission {
  registrationId: string;
  referenceToken: string; // e.g., "REF-A38F"
  // Visitor identity and consent fields routed to the restricted private/customer doc
  customer: {
    firstName: string;
    contactPhone?: string;
    agreedToTerms: boolean;
    termsVersion: string;
  };
  // Broken household item(s) declared during registration
  items: Array<{
    category: ItemCategory;
    brandModel: string;
    faultDescription: string;
    powerType: PowerType;
    applianceClass?: ApplianceClass;
  }>;
}

/**
 * Repair item document stored at `sessions/{sessionId}/repairs/{repairId}`.
 */
export interface RepairItem {
  id: string; // Firestore auto-ID or deterministic REG-<ts>_1 ID
  sessionId: string;
  registrationId: string;
  referenceToken: string;
  cardNumber?: number | null; // Physical token #1..#N assigned by front desk
  customerName?: string; // Visitor first name for Front Desk display & search (scrubbed on finalize)

  // Core item metadata and landfill diversion weight
  item: {
    category: ItemCategory;
    brandModel: string;
    faultDescription: string;
    powerType: PowerType;
    applianceClass?: ApplianceClass;
    weightKg?: number;
  };

  status: ItemStatus;

  // PAT 1 (Pre-repair safety inspection)
  patInitial?: {
    testedAt: number;
    testerName: string;
    instrumentSerial: string;
    visualPass: boolean;
    fuseRatingAmps: 3 | 5 | 13 | 'OTHER';
    // Electrical insulation and earth continuity measurements
    testVoltageVolts: 250 | 500;
    earthContinuityOhms?: number; // Required for Class I
    insulationResistanceMOhms: number; // Required for Class I & II
    outcome: PatInitialOutcome;
    cautionNotes?: string;
  };

  // Volunteer Repair Record
  repair?: {
    repairTimeMinutes?: number; // Total duration in minutes (e.g. 15, 30, 45, 60)
    fixerName: string;
    diagnosis?: string;
    repairNotes?: string;
    partsUsed?: string;
    // Outcome and count of compressed photos stored in repairs/{repairId}/photos
    outcome: RepairOutcome;
    photoCount?: number;
    repairedAt?: number;
  };

  // PAT 2 (Post-repair safety certification for mains items)
  patFinal?: {
    testedAt: number;
    testerName: string;
    instrumentSerial: string;
    visualPass: boolean;
    fuseRatingAmps: 3 | 5 | 13 | 'OTHER';
    // Post-repair DC test voltage, earth continuity, insulation resistance, and certification outcome
    testVoltageVolts?: 250 | 500;
    earthContinuityOhms?: number;
    insulationResistanceMOhms: number;
    outcome: PatFinalOutcome;
    certificateNotes?: string;
  };

  createdAt?: number;
  updatedAt?: number;
}

/**
 * Registered PAT testing instrument stored at `patInstruments/{instrumentId}` (Issue #27).
 * Note: `RepairItem.patInitial.instrumentSerial` and `RepairItem.patFinal.instrumentSerial`
 * store `serialNumber` (constant hardware identifier) rather than `displayName` (mutable).
 */
export interface PatInstrument {
  id: string;
  // Friendly mutable owner/display label (e.g. "Richard's Tester")
  displayName: string;
  manufacturer: string; // e.g., "Seaward", "Kewtech", "Martindale"
  model?: string; // Optional model name, e.g., "PrimeTest 100"
  // Constant unique manufacturer serial number stored on RepairItem PAT records
  serialNumber: string;
  lastCalibratedDate: string; // ISO 8601 calendar date "YYYY-MM-DD"
  notes?: string; // Optional service/adapter notes
  // Audit timestamps (Unix epoch ms)
  createdAt: number;
  updatedAt: number;
}

/**
 * Form input payload for creating or updating a PAT testing instrument (Issue #27).
 */
export interface PatInstrumentInput {
  displayName: string;
  manufacturer: string;
  model?: string;
  // Constant hardware serial number and ISO calibration date
  serialNumber: string;
  lastCalibratedDate: string; // "YYYY-MM-DD"
  notes?: string;
}

/**
 * Maximum number of compressed item photos allowed per repair item (Issue #4).
 */
export const MAX_PHOTOS_PER_REPAIR = 2;

/**
 * Maximum base64 data URL character length per photo (~52 KB raw binary, ~68 KB base64 string).
 * Enforced both client-side and in firestore.rules to protect the 1 GiB Firebase Free Tier.
 */
export const MAX_PHOTO_DATA_URL_LENGTH = 70_000;

/**
 * Compressed, EXIF-stripped item photo stored at
 * `sessions/{sessionId}/repairs/{repairId}/photos/{photoId}` (Issue #4).
 */
export interface RepairPhoto {
  id: string;
  dataUrl: string; // Compressed data:image/webp;base64,... or data:image/jpeg;base64,...
  mimeType: 'image/webp' | 'image/jpeg';
  // Scaled dimensions and character byte budget
  width: number; // Scaled pixel width (1..800)
  height: number; // Scaled pixel height (1..800)
  sizeBytes: number; // Character length of dataUrl (<= 70,000)
  capturedAt: number; // Unix epoch ms
  uploadedBy: string; // Volunteer fixer name at time of capture (<= 200 chars)
}

/**
 * Segregated UK GDPR visitor PII stored at `sessions/{sessionId}/repairs/{repairId}/private/customer`.
 * Readable only by authenticated organisers and scrubbed on session finalisation.
 */
export interface PrivateCustomerData {
  firstName: string; // Scrubbed to "[REDACTED]" on finalize
  contactPhone?: string; // Scrubbed to "[REDACTED]" on finalize
  agreedToTerms: boolean;
  termsVersion: string;
  // Registration and GDPR redaction audit timestamps
  submittedAt?: number;
  registeredAt?: number;
  redactedAt?: number;
}

/**
 * Aggregated anonymous session impact metrics stored at `analytics/{sessionId}`.
 */
export interface SessionAnalytics {
  sessionId: string;
  sessionName: string;
  date: string;
  // Optional flag indicating a rehearsal/training session excluded from public impact reports (Issue #24)
  isTest?: boolean;
  totalItems: number;
  // Breakdown of repair outcomes across the session
  repairedCount: number;
  partialCount: number;
  unfixableCount: number;
  adviceCount: number;
  takenHomeCount: number;
  // Volunteer time investment and waste diversion metrics
  totalRepairTimeMinutes: number;
  averageRepairTimeMinutes: number;
  successRatePercent: number;
  totalWeightDivertedKg: number;
  categoryBreakdown: Record<string, number>;
  // Electrical PAT safety metrics
  mainsItemsCount: number;
  patTestedCount: number;
  patFailureRatePercent: number;
  volunteerCount?: number;
  finalizedAt?: number;
}
