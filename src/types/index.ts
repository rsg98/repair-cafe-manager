export type ItemCategory =
  | 'ELECTRICAL'
  | 'ELECTRONIC'
  | 'MECHANICAL'
  | 'TEXTILE'
  | 'WOODWORK'
  | 'TOY'
  | 'OTHER';

export type PowerType =
  | 'MAINS_240V'
  | 'BATTERY_LOW_VOLTAGE'
  | 'MECHANICAL'
  | 'TEXTILE'
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

export type PatFinalOutcome =
  | 'PASS'
  | 'FAIL';

export type RepairOutcome =
  | 'FIXED'
  | 'PARTIAL'
  | 'UNFIXABLE'
  | 'ADVICE_GIVEN'
  | 'TAKEN_HOME';

export interface SystemSettings {
  activeSessionId: string | null;
  updatedAt: number;
}

export interface Session {
  id: string; // e.g., "2026-10-seears"
  name: string; // "October 2026 - Seears Park"
  date: string; // ISO 8601 YYYY-MM-DD
  status: 'ACTIVE' | 'FINALIZED';
  volunteerPinHash: string; // SHA-256 hash of daily 4-digit PIN
  cardRangeStart: number;
  cardRangeEnd: number;
  createdAt: number;
  finalizedAt?: number;
}

export interface CustomerRegistrationSubmission {
  registrationId: string;
  referenceToken: string; // e.g., "REF-A38F"
  customer: {
    firstName: string;
    contactPhone?: string;
    agreedToTerms: boolean;
    termsVersion: string;
  };
  items: Array<{
    category: ItemCategory;
    brandModel: string;
    faultDescription: string;
    powerType: PowerType;
    applianceClass?: ApplianceClass;
  }>;
}

export interface RepairItem {
  id: string; // Firestore auto-ID
  sessionId: string;
  registrationId: string;
  referenceToken: string;
  cardNumber?: number; // Physical token #1..#N assigned by front desk

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
    outcome: RepairOutcome;
    repairedAt?: number;
  };

  // PAT 2 (Post-repair safety certification for mains items)
  patFinal?: {
    testedAt: number;
    testerName: string;
    instrumentSerial: string;
    visualPass: boolean;
    fuseRatingAmps: 3 | 5 | 13 | 'OTHER';
    earthContinuityOhms?: number;
    insulationResistanceMOhms: number;
    outcome: PatFinalOutcome;
    certificateNotes?: string;
  };

  createdAt?: number;
  updatedAt?: number;
}

export interface PrivateCustomerData {
  firstName: string; // Scrubbed to "[REDACTED]" on finalize
  contactPhone?: string; // Scrubbed to "[REDACTED]" on finalize
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
}
