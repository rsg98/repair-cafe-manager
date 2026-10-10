import { 
  collection, 
  doc, 
  getDoc, 
  getDocs, 
  setDoc, 
  updateDoc, 
  query, 
  where
} from 'firebase/firestore';
import { db } from './firebase';
import { 
  RepairItem, 
  PrivateCustomerData, 
  CustomerRegistrationSubmission, 
  ItemStatus, 
  PatInitialOutcome, 
  PatFinalOutcome, 
  RepairOutcome,
  PowerType
} from '../types';
import { cafeConfig } from '../config/cafe.config';

/**
 * Generates a customer-facing 4-character uppercase alphanumeric reference token
 */
export function generateReferenceToken(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // omits confusing 0, O, 1, I
  let token = 'REF-';
  for (let i = 0; i < 4; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return token;
}

// Pure state calculation helpers (exported for unit test coverage)
/**
 * Recursively removes keys with undefined values or NaN numbers from an object.
 * Cloud Firestore throws an error if undefined or NaN is passed to updateDoc or setDoc.
 */
export function removeUndefined<T>(obj: T): T {
  if (obj === null || obj === undefined || typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(item => removeUndefined(item)) as unknown as T;
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined && !(typeof value === 'number' && Number.isNaN(value))) {
      result[key] = typeof value === 'object' && value !== null
        ? removeUndefined(value)
        : value;
    }
  }
  return result as T;
}

export function calculateNextStatusOnCardAssign(powerType: PowerType): ItemStatus {
  return powerType === 'MAINS_240V' ? 'WAITING_PAT1' : 'WAITING_REPAIR';
}

export function calculateNextStatusOnPatInitial(outcome: PatInitialOutcome): ItemStatus {
  if (outcome === 'DANGER_DO_NOT_ENERGIZE') return 'UNFIXABLE';
  return 'WAITING_REPAIR';
}

export function calculateNextStatusOnRepair(outcome: RepairOutcome, isMainsPower: boolean): ItemStatus {
  switch (outcome) {
    case 'FIXED':
    case 'PARTIAL':
      return isMainsPower ? 'WAITING_PAT2' : 'READY_FOR_COLLECTION';
    case 'ADVICE_GIVEN':
      return 'READY_FOR_COLLECTION';
    case 'UNFIXABLE':
      return 'UNFIXABLE';
    case 'TAKEN_HOME':
      return 'TAKEN_HOME';
    default:
      return 'READY_FOR_COLLECTION';
  }
}

export function calculateNextStatusOnPatFinal(outcome: PatFinalOutcome): ItemStatus {
  return outcome === 'PASS' ? 'READY_FOR_COLLECTION' : 'WAITING_REPAIR';
}

/**
 * Submits a new customer registration with one or multiple items
 */
export async function submitRegistration(params: {
  sessionId: string;
  submission: CustomerRegistrationSubmission;
}): Promise<string[]> {
  const { sessionId, submission } = params;

  // Single-item enforcement
  if (!cafeConfig.allowMultiItemRegistration && submission.items.length > 1) {
    throw new Error(`${cafeConfig.cafeName} allows only one item per customer registration to maintain fair queues.`);
  }

  const repairIds: string[] = [];
  const now = Date.now();

  for (let i = 0; i < submission.items.length; i++) {
    const itemInput = submission.items[i];
    const repairId = `${submission.registrationId}_${i + 1}`;
    repairIds.push(repairId);

    // 1. Create Public Repair Record
    const repairData: RepairItem = {
      id: repairId,
      sessionId,
      registrationId: submission.registrationId,
      referenceToken: submission.referenceToken,
      status: 'REGISTERED',
      item: {
        category: itemInput.category,
        brandModel: itemInput.brandModel,
        faultDescription: itemInput.faultDescription,
        powerType: itemInput.powerType
      },
      createdAt: now,
      updatedAt: now
    };

    const repairRef = doc(db, 'sessions', sessionId, 'repairs', repairId);
    await setDoc(repairRef, removeUndefined(repairData));

    // 2. Create Segregated Private Customer Data Document
    const customerData: PrivateCustomerData = {
      firstName: submission.customer.firstName,
      contactPhone: submission.customer.contactPhone,
      agreedToTerms: submission.customer.agreedToTerms,
      termsVersion: submission.customer.termsVersion,
      registeredAt: now,
      submittedAt: now
    };

    const privateRef = doc(db, 'sessions', sessionId, 'repairs', repairId, 'private', 'customer');
    await setDoc(privateRef, removeUndefined(customerData));
  }

  return repairIds;
}

export interface CardConflictResult {
  hasConflict: boolean;
  conflictItem?: {
    brandModel?: string;
    status: ItemStatus;
  };
}

/**
 * Checks whether a card number is already assigned to another item in the session.
 * Since cards are not reused within the same session, any existing item (active,
 * completed, or taken home) with the same card number constitutes a conflict.
 */
export function checkCardConflict(
  cardNumber: number,
  repairs: Array<{ id: string; cardNumber?: number | null; status: ItemStatus; item?: { brandModel?: string } }>,
  currentRepairId?: string
): CardConflictResult {
  const conflict = repairs.find(
    r => r.cardNumber === cardNumber && r.id !== currentRepairId
  );
  if (!conflict) {
    return { hasConflict: false };
  }
  return {
    hasConflict: true,
    conflictItem: {
      brandModel: conflict.item?.brandModel,
      status: conflict.status
    }
  };
}

/**
 * Assigns a physical reusable card number to a repair item and routes it
 * Works both online and in offline mode.
 */
export async function assignCardToken(params: {
  sessionId: string;
  repairId: string;
  cardNumber: number;
}): Promise<void> {
  const { sessionId, repairId, cardNumber } = params;
  const repairsCol = collection(db, 'sessions', sessionId, 'repairs');

  // Check for duplicate card number in session items
  try {
    const existingQ = query(
      repairsCol,
      where('cardNumber', '==', cardNumber)
    );
    const existingSnap = await getDocs(existingQ);
    const existingList = existingSnap.docs.map(d => ({
      ...(d.data() as Omit<RepairItem, 'id'>),
      id: d.id
    }));
    const { hasConflict, conflictItem } = checkCardConflict(cardNumber, existingList, repairId);

    if (hasConflict && conflictItem) {
      const isCompletedOrCollected = conflictItem.status === 'COMPLETED' || conflictItem.status === 'TAKEN_HOME';
      const statusNote = isCompletedOrCollected 
        ? 'already used by a completed/collected item' 
        : 'currently in use by another active item';
      throw new Error(`Card #${cardNumber} has already been assigned in this session (${statusNote}: ${conflictItem.brandModel || 'Item'}).`);
    }
  } catch (err: unknown) {
    // If offline or query error, ignore unless it's the duplicate card error
    if (err instanceof Error && (err.message.includes('currently in use') || err.message.includes('already been assigned'))) {
      throw err;
    }
  }

  const repairRef = doc(db, 'sessions', sessionId, 'repairs', repairId);
  const snap = await getDoc(repairRef);
  if (!snap.exists()) {
    throw new Error("Repair record not found.");
  }

  const data = snap.data() as RepairItem;
  if (data.status === 'COMPLETED' || data.status === 'TAKEN_HOME') {
    throw new Error(`Cannot assign a card to an item that is already ${data.status === 'COMPLETED' ? 'completed' : 'taken home'}.`);
  }

  const nextStatus = calculateNextStatusOnCardAssign(data.item.powerType);

  await updateDoc(repairRef, {
    cardNumber,
    status: nextStatus,
    updatedAt: Date.now()
  });
}

/**
 * Searches for a repair record by its assigned physical card number
 */
export async function getRepairByCardNumber(
  sessionId: string,
  cardNumber: number
): Promise<RepairItem | null> {
  const repairsCol = collection(db, 'sessions', sessionId, 'repairs');
  const q = query(
    repairsCol,
    where('cardNumber', '==', cardNumber)
  );

  const snap = await getDocs(q);
  if (snap.empty) return null;

  const activeDoc = snap.docs.find(d => {
    const data = d.data() as RepairItem;
    return data.status !== 'COMPLETED' && data.status !== 'TAKEN_HOME';
  });

  return activeDoc ? (activeDoc.data() as RepairItem) : null;
}

/**
 * Submits Initial PAT Safety Inspection (PAT 1)
 */
export async function submitPatInitial(params: {
  sessionId: string;
  repairId: string;
  testerName: string;
  instrumentSerial: string;
  visualPass: boolean;
  fuseRatingAmps: 3 | 5 | 13 | 'OTHER';
  testVoltageVolts: 250 | 500;
  earthContinuityOhms?: number;
  insulationResistanceMOhms: number;
  outcome: PatInitialOutcome;
  cautionNotes?: string;
}): Promise<ItemStatus> {
  const { sessionId, repairId, ...patData } = params;
  const now = Date.now();
  const nextStatus = calculateNextStatusOnPatInitial(params.outcome);

  const repairRef = doc(db, 'sessions', sessionId, 'repairs', repairId);
  await updateDoc(repairRef, removeUndefined({
    status: nextStatus,
    patInitial: {
      ...patData,
      testedAt: now
    },
    updatedAt: now
  }));

  return nextStatus;
}

/**
 * Submits Volunteer Fixer Record
 */
export async function submitRepairRecord(params: {
  sessionId: string;
  repairId: string;
  fixerName: string;
  outcome: RepairOutcome;
  repairTimeMinutes: number;
  diagnosis: string;
  repairNotes: string;
  partsUsed?: string;
  weightKg?: number;
  isMainsPower: boolean;
}): Promise<ItemStatus> {
  const { sessionId, repairId, isMainsPower, weightKg, ...repairData } = params;
  const now = Date.now();
  const nextStatus = calculateNextStatusOnRepair(params.outcome, isMainsPower);

  const repairRef = doc(db, 'sessions', sessionId, 'repairs', repairId);
  const updates: Record<string, unknown> = {
    status: nextStatus,
    repair: {
      ...repairData,
      repairedAt: now
    },
    updatedAt: now
  };

  if (weightKg !== undefined && !Number.isNaN(weightKg)) {
    updates['item.weightKg'] = weightKg;
  }

  await updateDoc(repairRef, removeUndefined(updates));
  return nextStatus;
}

/**
 * Submits Final Post-Repair PAT Safety Certification (PAT 2)
 */
export async function submitPatFinal(params: {
  sessionId: string;
  repairId: string;
  testerName: string;
  instrumentSerial: string;
  visualPass: boolean;
  fuseRatingAmps: 3 | 5 | 13 | 'OTHER';
  earthContinuityOhms?: number;
  insulationResistanceMOhms: number;
  outcome: PatFinalOutcome;
  certificateNotes?: string;
}): Promise<ItemStatus> {
  const { sessionId, repairId, ...patData } = params;
  const now = Date.now();
  const nextStatus = calculateNextStatusOnPatFinal(params.outcome);

  const repairRef = doc(db, 'sessions', sessionId, 'repairs', repairId);
  await updateDoc(repairRef, removeUndefined({
    status: nextStatus,
    patFinal: {
      ...patData,
      testedAt: now
    },
    updatedAt: now
  }));

  return nextStatus;
}

/**
 * Marks item as completed upon customer pickup and card return.
 * Preserves the original card ID intact for session auditability (cards are not reused in the same session).
 */
export async function completeCollection(sessionId: string, repairId: string): Promise<void> {
  const repairRef = doc(db, 'sessions', sessionId, 'repairs', repairId);
  await updateDoc(repairRef, {
    status: 'COMPLETED',
    updatedAt: Date.now()
  });
}

/**
 * Reads private customer PII (Only accessible by Google Auth organizers)
 */
export async function getPrivateCustomerData(
  sessionId: string,
  repairId: string
): Promise<PrivateCustomerData | null> {
  const privateRef = doc(db, 'sessions', sessionId, 'repairs', repairId, 'private', 'customer');
  const snap = await getDoc(privateRef);
  if (!snap.exists()) return null;
  return snap.data() as PrivateCustomerData;
}
