/**
 * @file src/services/repairService.ts
 *
 * Domain State Machine, Firestore Persistence, and Offline-Safe Batch Operations
 * for Repair Café Items (Stations 1–4).
 *
 * Implements pure lifecycle transition calculators, customer registration,
 * physical card assignment, PAT 1 & PAT 2 electrical safety logging, volunteer fixer
 * repair submission, and atomic item photo subcollection operations (Issue #4)
 * while strictly adhering to the $0.00/month Firebase Free Tier guardrails.
 */

import { 
  collection, 
  doc, 
  getDoc, 
  getDocs, 
  setDoc, 
  updateDoc, 
  writeBatch,
  deleteField,
  query, 
  where
} from 'firebase/firestore';
import { db } from './firebase';
import { 
  RepairItem, 
  RepairPhoto,
  MAX_PHOTOS_PER_REPAIR,
  PrivateCustomerData, 
  CustomerRegistrationSubmission, 
  ItemStatus, 
  PatInitialOutcome, 
  PatFinalOutcome, 
  RepairOutcome,
  PowerType,
  ApplianceClass,
  ItemCategory
} from '../types';
import { cafeConfig } from '../config/cafe.config';
import { ITEM_TYPE_SUGGESTIONS, type ItemTypeSuggestion } from '../config/itemTypeSuggestions';
import { validatePhotoDataUrl } from '../utils/imageCompression';

export { ITEM_TYPE_SUGGESTIONS, type ItemTypeSuggestion };

/**
 * Generates a customer-facing 4-character uppercase alphanumeric reference token
 * (e.g. "REF-A38F"), omitting visually ambiguous characters (0, O, 1, I).
 */
export function generateReferenceToken(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // omits confusing 0, O, 1, I
  let token = 'REF-';
  // Append 4 random unambiguous characters
  for (let i = 0; i < 4; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return token;
}

/**
 * Recursively removes keys with undefined values or NaN numbers from an object.
 * Cloud Firestore throws an error if undefined or NaN is passed to updateDoc or setDoc.
 */
export function removeUndefined<T>(obj: T): T {
  // Base case: primitives and null pass through unchanged
  if (obj === null || obj === undefined || typeof obj !== 'object') {
    return obj;
  }

  // Recursively sanitise array elements
  if (Array.isArray(obj)) {
    return obj.map(item => removeUndefined(item)) as unknown as T;
  }

  // Copy only defined, non-NaN entries into a clean plain object
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

/**
 * Calculates the next item status when the Front Desk assigns a physical card token.
 * Mains 240V appliances are routed to `WAITING_PAT1`; all others go to `WAITING_REPAIR`.
 */
export function calculateNextStatusOnCardAssign(powerType: PowerType): ItemStatus {
  return powerType === 'MAINS_240V' ? 'WAITING_PAT1' : 'WAITING_REPAIR';
}

/**
 * Automatically maps an ItemCategory to its default PowerType on registration.
 * Non-powered categories (Textiles, Woodwork, Mechanical) default to NOT_APPLICABLE.
 * Unclear categories (Toy, Other) or Electrical default to MAINS_240V
 * to ensure they are routed to PAT testing as a safety failsafe.
 */
export function getDefaultPowerTypeForCategory(category?: ItemCategory | string | null): PowerType {
  // Normalise category string for case-insensitive matching
  const norm = (category || '').toUpperCase().trim();
  switch (norm) {
    // Non-powered categories bypass electrical PAT testing
    case 'TEXTILE':
    case 'TEXTILES':
      return 'NOT_APPLICABLE';
    case 'WOODWORK':
    case 'WOOD':
      return 'NOT_APPLICABLE';
    case 'MECHANICAL':
      return 'NOT_APPLICABLE';
    // Electrical and ambiguous categories default to 240V Mains for safety
    case 'ELECTRICAL':
      return 'MAINS_240V';
    case 'TOY':
      return 'MAINS_240V';
    case 'OTHER':
      return 'MAINS_240V';
    default:
      return 'MAINS_240V';
  }
}

/**
 * Canonical human-readable Power Type options shared between Customer Registration (`/register`)
 * and the PAT Electrical Safety Station (`/pat`) (Issue #23).
 */
export const POWER_TYPE_OPTIONS: ReadonlyArray<{ value: PowerType; label: string }> = [
  // Mains 240V appliances require BS 1363 pre-repair (PAT 1) and post-repair (PAT 2) testing
  { value: 'MAINS_240V', label: 'Mains 240V Plug-in (Requires PAT Test)' },
  // Non-mains power categories bypass 240V electrical testing
  { value: 'BATTERY_LOW_VOLTAGE', label: 'Battery / USB / Low Voltage DC' },
  { value: 'NOT_APPLICABLE', label: 'Not Applicable (Non-powered)' },
  { value: 'MECHANICAL', label: 'Mechanical' },
  { value: 'OTHER', label: 'Other' }
];

/**
 * Returns the human-readable label for a given `PowerType` code (Issue #23).
 */
export function getPowerTypeLabel(powerType: PowerType): string {
  // Match against the shared POWER_TYPE_OPTIONS table or fall back to the raw enum string
  const found = POWER_TYPE_OPTIONS.find((opt) => opt.value === powerType);
  return found ? found.label : powerType;
}

/**
 * Returns ranked autocomplete suggestions for a partial item type query
 * (e.g. `"Toas"` -> `[{ label: "Toaster", category: "ELECTRICAL", powerType: "MAINS_240V" }]`).
 */
export function getItemTypeSuggestions(
  rawQuery: string,
  limit = 6
): ItemTypeSuggestion[] {
  const queryText = (rawQuery || '').trim().toLowerCase();
  if (!queryText || limit <= 0) {
    return [];
  }

  // Partition matching suggestions into priority tiers so prefix matches rank first
  const tier1LabelPrefix: ItemTypeSuggestion[] = [];
  const tier2WordPrefix: ItemTypeSuggestion[] = [];
  const tier3KeywordPrefix: ItemTypeSuggestion[] = [];
  const tier4Substring: ItemTypeSuggestion[] = [];

  for (const suggestion of ITEM_TYPE_SUGGESTIONS) {
    const lowerLabel = suggestion.label.toLowerCase();
    const labelWords = lowerLabel.split(/[\s/()-]+/).filter(Boolean);
    const keywords = suggestion.keywords ?? [];

    if (lowerLabel.startsWith(queryText)) {
      tier1LabelPrefix.push(suggestion);
    } else if (labelWords.some((word) => word.startsWith(queryText))) {
      tier2WordPrefix.push(suggestion);
    } else if (keywords.some((kw) => kw.toLowerCase().startsWith(queryText))) {
      tier3KeywordPrefix.push(suggestion);
    } else if (
      lowerLabel.includes(queryText) ||
      keywords.some((kw) => kw.toLowerCase().includes(queryText))
    ) {
      tier4Substring.push(suggestion);
    }
  }

  return [
    ...tier1LabelPrefix,
    ...tier2WordPrefix,
    ...tier3KeywordPrefix,
    ...tier4Substring,
  ].slice(0, limit);
}

/**
 * Resolves the appropriate `ItemCategory` and `PowerType` for a typed or selected
 * item type string (e.g. `"Toas"` or `"Toaster"` -> `{ category: 'ELECTRICAL', powerType: 'MAINS_240V' }`).
 * Returns `null` when no recognised item type prefix or keyword matches.
 */
export function resolveItemTypeClassification(
  rawItemType: string
): { category: ItemCategory; powerType: PowerType } | null {
  const queryText = (rawItemType || '').trim().toLowerCase();
  if (!queryText) {
    return null;
  }

  // 1. Exact match on a suggestion label or keyword
  for (const suggestion of ITEM_TYPE_SUGGESTIONS) {
    if (suggestion.label.toLowerCase() === queryText) {
      return { category: suggestion.category, powerType: suggestion.powerType };
    }
    if ((suggestion.keywords ?? []).some((kw) => kw.toLowerCase() === queryText)) {
      return { category: suggestion.category, powerType: suggestion.powerType };
    }
  }

  // 2. Prefix match once the customer has typed at least 2 characters (e.g. "Toas" -> "Toaster")
  if (queryText.length >= 2) {
    const matches = getItemTypeSuggestions(queryText, 1);
    if (matches.length > 0) {
      const top = matches[0];
      const lowerLabel = top.label.toLowerCase();
      const labelWords = lowerLabel.split(/[\s/()-]+/).filter(Boolean);
      const keywords = top.keywords ?? [];
      const isPrefixMatch =
        lowerLabel.startsWith(queryText) ||
        labelWords.some((word) => word.startsWith(queryText)) ||
        keywords.some((kw) => kw.toLowerCase().startsWith(queryText));
      if (isPrefixMatch) {
        return { category: top.category, powerType: top.powerType };
      }
    }
  }

  return null;
}

/**
 * Checks whether a customer-entered `itemType` matches any label in `cafeConfig.excludedItems`
 * (either directly by label/plural/substring or via its associated `ITEM_TYPE_SUGGESTIONS` keywords).
 * Returns the matched canonical excluded item label (e.g. `"Microwave"`) when excluded, or `null` otherwise.
 */
export function findExcludedItemMatch(
  rawItemType: string,
  excludedItems: readonly string[] = cafeConfig.excludedItems
): string | null {
  const queryText = (rawItemType || '').trim().toLowerCase();
  if (!queryText || !excludedItems || excludedItems.length === 0) {
    return null;
  }

  // Map normalised lowercase excluded label -> canonical configured display label
  const canonicalByLower = new Map<string, string>();
  for (const rawLabel of excludedItems) {
    const clean = (rawLabel || '').trim();
    if (clean) {
      canonicalByLower.set(clean.toLowerCase(), clean);
    }
  }
  if (canonicalByLower.size === 0) {
    return null;
  }

  // 1. Direct exact, plural, or phrase-inclusion match against configured excludedItems labels
  for (const [excludedLower, canonicalLabel] of canonicalByLower.entries()) {
    if (
      queryText === excludedLower ||
      queryText === `${excludedLower}s` ||
      `${queryText}s` === excludedLower ||
      (excludedLower.length >= 3 && queryText.includes(excludedLower))
    ) {
      return canonicalLabel;
    }
  }

  // 2. Match against ITEM_TYPE_SUGGESTIONS entries whose label is in excludedItems
  for (const suggestion of ITEM_TYPE_SUGGESTIONS) {
    const canonicalLabel = canonicalByLower.get(suggestion.label.toLowerCase());
    if (!canonicalLabel) continue;

    const keywords = suggestion.keywords ?? [];
    for (const kw of keywords) {
      const kwLower = kw.toLowerCase();
      if (
        queryText === kwLower ||
        queryText === `${kwLower}s` ||
        `${queryText}s` === kwLower ||
        (kwLower.length >= 4 && queryText.includes(kwLower))
      ) {
        return canonicalLabel;
      }
    }
  }

  // 3. Unambiguous autocomplete prefix match (when typing >= 3 characters and all matching suggestions are excluded)
  if (queryText.length >= 3) {
    const suggestions = getItemTypeSuggestions(queryText);
    if (
      suggestions.length > 0 &&
      suggestions.every((s) => canonicalByLower.has(s.label.toLowerCase()))
    ) {
      const topCanonical = canonicalByLower.get(suggestions[0].label.toLowerCase());
      if (topCanonical) {
        return topCanonical;
      }
    }
  }

  return null;
}

/**
 * Concatenates separate `brand`, `model`, and `itemType` inputs from the Customer
 * Registration View into the single persisted `item.brandModel` string without
 * duplicating words when a customer repeats the brand or item type across boxes.
 */
export function formatItemBrandModel(params: {
  itemType?: string;
  brand?: string;
  model?: string;
  fallbackBrandModel?: string;
}): string {
  const itemType = (params.itemType ?? '').trim();
  const brand = (params.brand ?? '').trim();
  const model = (params.model ?? '').trim();

  // Combine brand and model while avoiding duplicate prefix (e.g. Brand: "Dualit", Model: "Dualit 4-Slice")
  let brandAndModel = '';
  if (brand && model) {
    const lowerBrand = brand.toLowerCase();
    const lowerModel = model.toLowerCase();
    if (lowerModel.startsWith(lowerBrand)) {
      brandAndModel = model;
    } else if (lowerBrand.includes(lowerModel)) {
      brandAndModel = brand;
    } else {
      brandAndModel = `${brand} ${model}`;
    }
  } else {
    brandAndModel = brand || model;
  }

  // Append itemType unless brandAndModel already contains it (or vice versa)
  if (brandAndModel && itemType) {
    const lowerCombined = brandAndModel.toLowerCase();
    const lowerType = itemType.toLowerCase();
    if (lowerCombined.includes(lowerType)) {
      return brandAndModel;
    }
    if (lowerType.includes(lowerCombined)) {
      return itemType;
    }
    return `${brandAndModel} ${itemType}`;
  }

  if (brandAndModel) {
    return brandAndModel;
  }
  if (itemType) {
    return itemType;
  }

  return (params.fallbackBrandModel ?? '').trim();
}

/**
 * Determines whether a repair item looked up at the PAT Station (`/pat`) is in the
 * post-repair PAT 2 certification stage (including reverse-override items that were
 * already repaired as non-mains and are now being upgraded to `MAINS_240V`) (Issue #23).
 */
export function isPat2StageForItem(
  item: Pick<RepairItem, 'status' | 'repair' | 'patFinal'> | null | undefined
): boolean {
  if (!item) return false;
  // Check whether a volunteer fixer has already recorded a FIXED or PARTIAL repair outcome
  const hasCompletedRepair =
    item.repair?.outcome === 'FIXED' ||
    item.repair?.outcome === 'PARTIAL';
  // Treat WAITING_PAT2, IN_PAT2, items with patFinal, or repaired READY_FOR_COLLECTION items as PAT 2
  return (
    item.status === 'WAITING_PAT2' ||
    item.status === 'IN_PAT2' ||
    Boolean(item.patFinal) ||
    (hasCompletedRepair && item.status === 'READY_FOR_COLLECTION')
  );
}

/**
 * Calculates the next item status when a PAT tester overrides an item's `PowerType`
 * at the PAT Electrical Safety Station (Issue #23).
 */
export function calculateNextStatusOnPowerTypeOverride(
  newPowerType: PowerType,
  isPat2Stage: boolean
): ItemStatus {
  // Upgrading to Mains 240V places the item into the appropriate PAT stage queue
  if (newPowerType === 'MAINS_240V') {
    return isPat2Stage ? 'WAITING_PAT2' : 'WAITING_PAT1';
  }
  // Downgrading to non-mains bypasses PAT 1 -> WAITING_REPAIR or PAT 2 -> READY_FOR_COLLECTION
  return isPat2Stage ? 'READY_FOR_COLLECTION' : 'WAITING_REPAIR';
}

/**
 * Calculates the next item status after Pre-Repair PAT 1 inspection.
 * Dangerous items (`DANGER_DO_NOT_ENERGIZE`) are immediately quarantined as `UNFIXABLE`.
 */
export function calculateNextStatusOnPatInitial(outcome: PatInitialOutcome): ItemStatus {
  if (outcome === 'DANGER_DO_NOT_ENERGIZE') return 'UNFIXABLE';
  return 'WAITING_REPAIR';
}

/**
 * Calculates the next item status after a Volunteer Fixer submits a repair record.
 * Repaired (`FIXED` / `PARTIAL`) Mains 240V appliances must pass `WAITING_PAT2` before collection.
 */
export function calculateNextStatusOnRepair(outcome: RepairOutcome, isMainsPower: boolean): ItemStatus {
  switch (outcome) {
    // Fixed or partially fixed mains appliances require post-repair PAT 2 certification
    case 'FIXED':
    case 'PARTIAL':
      return isMainsPower ? 'WAITING_PAT2' : 'READY_FOR_COLLECTION';
    // Advice-only, unfixable, and taken-home items do not require PAT 2
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

/**
 * Returns true when the selected fixer outcome requires the pre-submit
 * custody & customer contact confirmation modal (Issue #4).
 */
export function requiresTakeHomeConfirmation(outcome: RepairOutcome): boolean {
  return outcome === 'TAKEN_HOME';
}

/**
 * Calculates the next item status after Post-Repair PAT 2 safety certification.
 * Passing items move to `READY_FOR_COLLECTION`; failing items return to `WAITING_REPAIR`.
 */
export function calculateNextStatusOnPatFinal(outcome: PatFinalOutcome): ItemStatus {
  return outcome === 'PASS' ? 'READY_FOR_COLLECTION' : 'WAITING_REPAIR';
}

/**
 * Submits a new customer registration with one or multiple items, writing the public
 * repair record and the segregated UK GDPR `private/customer` record.
 *
 * Architectural Note: Kept as a single cohesive function (>50 lines) so public
 * repair creation and GDPR PII segregation execute in lockstep per registered item.
 */
export async function submitRegistration(params: {
  sessionId: string;
  submission: CustomerRegistrationSubmission;
}): Promise<string[]> {
  const { sessionId, submission } = params;

  // Enforce fair queue rule when single-item registration is configured
  if (!cafeConfig.allowMultiItemRegistration && submission.items.length > 1) {
    throw new Error(`${cafeConfig.cafeName} allows only one item per customer registration to maintain fair queues.`);
  }

  const repairIds: string[] = [];
  const now = Date.now();

  // Persist each registered item and its restricted customer contact subdocument
  for (let i = 0; i < submission.items.length; i++) {
    const itemInput = submission.items[i];
    const repairId = `${submission.registrationId}_${i + 1}`;
    repairIds.push(repairId);

    // 1. Construct the public RepairItem document for station queues
    const repairData: RepairItem = {
      id: repairId,
      sessionId,
      registrationId: submission.registrationId,
      referenceToken: submission.referenceToken,
      customerName: submission.customer.firstName.trim(),
      status: 'REGISTERED',
      // Populate item category, description, and failsafe powerType
      item: {
        category: itemInput.category,
        brandModel: itemInput.brandModel,
        faultDescription: itemInput.faultDescription,
        powerType: itemInput.powerType || getDefaultPowerTypeForCategory(itemInput.category)
      },
      createdAt: now,
      updatedAt: now
    };

    // Write the public repair document
    const repairRef = doc(db, 'sessions', sessionId, 'repairs', repairId);
    await setDoc(repairRef, removeUndefined(repairData));

    // 2. Construct the segregated UK GDPR private customer contact document
    const customerData: PrivateCustomerData = {
      firstName: submission.customer.firstName,
      contactPhone: submission.customer.contactPhone,
      agreedToTerms: submission.customer.agreedToTerms,
      termsVersion: submission.customer.termsVersion,
      registeredAt: now,
      submittedAt: now
    };

    // Write the restricted private/customer subcollection document
    const privateRef = doc(db, 'sessions', sessionId, 'repairs', repairId, 'private', 'customer');
    await setDoc(privateRef, removeUndefined(customerData));
  }

  return repairIds;
}

/**
 * Result of checking whether a physical card number is already assigned in the session.
 */
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
  // Find any other repair item in the session holding the same physical card number
  const conflict = repairs.find(
    r => r.cardNumber === cardNumber && r.id !== currentRepairId
  );
  if (!conflict) {
    return { hasConflict: false };
  }

  // Return details of the conflicting item for Front Desk error reporting
  return {
    hasConflict: true,
    conflictItem: {
      brandModel: conflict.item?.brandModel,
      status: conflict.status
    }
  };
}

/**
 * Interval (in milliseconds) at which the Front Desk queue wait time is refreshed (5 minutes).
 */
export const WAIT_TIME_REFRESH_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Extracts the registration epoch timestamp (ms) from a repair item.
 * Uses `createdAt` when present, falling back to a numeric timestamp embedded in
 * `registrationId` or `id` (e.g. `REG-1729166400000`), or `null` if unavailable.
 */
export function getRegistrationTimestamp(
  item: Pick<RepairItem, 'createdAt'> & Partial<Pick<RepairItem, 'registrationId' | 'id'>>
): number | null {
  // Prefer explicit numeric createdAt timestamp
  if (typeof item.createdAt === 'number' && Number.isFinite(item.createdAt) && item.createdAt > 0) {
    return item.createdAt;
  }

  // Fall back to parsing epoch ms embedded in deterministic REG-<timestamp> identifiers
  const candidates = [item.registrationId, item.id];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const match = candidate.match(/^REG-(\d{10,})/i);
    // Validate parsed timestamp before returning
    if (match) {
      const parsed = Number(match[1]);
      if (Number.isFinite(parsed) && parsed > 0) {
        return parsed;
      }
    }
  }

  return null;
}

/**
 * Sorts repair items in strict first-come, first-served order (earliest registration at the top).
 * Items in a terminal state (`COMPLETED`, `UNFIXABLE`, `TAKEN_HOME`) are moved below active items
 * while preserving registration timestamp order within each group.
 * Falls back to card number and ID/reference token when registration timestamps are equal or absent.
 */
export function sortRepairsByRegistration<
  T extends Pick<RepairItem, 'createdAt'> &
    Partial<Pick<RepairItem, 'id' | 'registrationId' | 'cardNumber' | 'referenceToken' | 'status'>>
>(repairs: T[]): T[] {
  return [...repairs].sort((a, b) => {
    // Move terminal items below active items so the Front Desk focuses on items needing action
    const terminalA = a.status ? isTerminalStatus(a.status) : false;
    const terminalB = b.status ? isTerminalStatus(b.status) : false;
    if (terminalA !== terminalB) {
      return terminalA ? 1 : -1;
    }

    // Compare registration timestamps first (earliest customer first)
    const timeA = getRegistrationTimestamp(a);
    const timeB = getRegistrationTimestamp(b);

    if (timeA !== null && timeB !== null && timeA !== timeB) {
      return timeA - timeB;
    }
    if (timeA !== null && timeB === null) return -1;
    if (timeA === null && timeB !== null) return 1;

    // Tie-break by assigned physical card number
    if (typeof a.cardNumber === 'number' && typeof b.cardNumber === 'number' && a.cardNumber !== b.cardNumber) {
      return a.cardNumber - b.cardNumber;
    }
    if (typeof a.cardNumber === 'number' && typeof b.cardNumber !== 'number') return -1;
    if (typeof a.cardNumber !== 'number' && typeof b.cardNumber === 'number') return 1;

    // Final deterministic tie-breaker by document ID and referenceToken
    const idCompare = (a.id || '').localeCompare(b.id || '');
    if (idCompare !== 0) return idCompare;

    return (a.referenceToken || '').localeCompare(b.referenceToken || '');
  });
}

/**
 * Calculates the elapsed wait time in whole minutes since a customer registered an item.
 * Returns `null` if the item has no valid registration timestamp.
 */
export function getWaitTimeMinutes(
  item: Pick<RepairItem, 'createdAt'> & Partial<Pick<RepairItem, 'registrationId' | 'id'>>,
  now: number = Date.now()
): number | null {
  const registeredAt = getRegistrationTimestamp(item);
  if (registeredAt === null) {
    return null;
  }
  // Clamp elapsed wait time to >= 0 minutes
  return Math.max(0, Math.floor((now - registeredAt) / 60000));
}

/**
 * Formats a repair item's queue wait time (or a raw duration in minutes) for display
 * in the Front Desk queue (e.g. "0m", "15m", "1h", "1h 25m", or "—" when unavailable).
 */
export function formatWaitTime(
  itemOrMinutes:
    | (Pick<RepairItem, 'createdAt'> & Partial<Pick<RepairItem, 'registrationId' | 'id'>>)
    | number
    | null
    | undefined,
  now: number = Date.now()
): string {
  // Resolve whole minutes from either a numeric input or a RepairItem timestamp
  const minutes =
    typeof itemOrMinutes === 'number'
      ? Number.isFinite(itemOrMinutes)
        ? Math.max(0, Math.floor(itemOrMinutes))
        : null
      : itemOrMinutes
        ? getWaitTimeMinutes(itemOrMinutes, now)
        : null;

  // Return em-dash when no registration timestamp is available
  if (minutes === null) {
    return '—';
  }

  // Format durations under 1 hour as "<N>m"
  if (minutes < 60) {
    return `${minutes}m`;
  }

  // Format durations >= 1 hour as "<H>h" or "<H>h <M>m"
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes === 0 ? `${hours}h` : `${hours}h ${remainingMinutes}m`;
}

/**
 * Filters repairs by search term (matching customer first name, token, brand/model, or card number)
 * and status filter (handling queue groupings like WAITING_PAT1, WAITING_REPAIR, WAITING_PAT2),
 * ordered on a first-come, first-served basis by registration time.
 */
export function filterRepairs(
  repairs: RepairItem[],
  searchTerm: string,
  statusFilter: string
): RepairItem[] {
  // Normalise search query and detect numeric/#N card queries
  const term = searchTerm.trim().toLowerCase();
  const isCardNumberQuery = /^#?\d+$/.test(term);
  const cardNumberTerm = term.replace(/^#/, '');

  const filtered = repairs.filter((r) => {
    // Check if the item's assigned card number matches a numeric search term
    const customerName = (r.customerName || '').toLowerCase();
    const matchesCardNumber =
      r.cardNumber !== undefined &&
      r.cardNumber !== null &&
      String(r.cardNumber) === cardNumberTerm;

    // Match against card number, customer name, reference token, or brand/model
    const matchesSearch =
      !term ||
      (isCardNumberQuery
        ? matchesCardNumber || (!term.startsWith('#') && r.item.brandModel.toLowerCase().includes(term))
        : customerName.includes(term) ||
          r.referenceToken.toLowerCase().includes(term) ||
          r.item.brandModel.toLowerCase().includes(term));

    if (!matchesSearch) return false;
    if (statusFilter === 'ALL') return true;
    // Match grouped station queue filters
    if (statusFilter === 'WAITING_PAT1') return r.status === 'WAITING_PAT1' || r.status === 'IN_PAT1';
    if (statusFilter === 'WAITING_REPAIR') return r.status === 'WAITING_REPAIR' || r.status === 'IN_REPAIR';
    if (statusFilter === 'WAITING_PAT2') return r.status === 'WAITING_PAT2' || r.status === 'IN_PAT2';
    return r.status === statusFilter;
  });

  // Preserve strict first-come, first-served ordering
  return sortRepairsByRegistration(filtered);
}

/**
 * Determines whether a repair item has reached a terminal / completed lifecycle state.
 * Terminal states include COMPLETED (collected), TAKEN_HOME (released to fixer),
 * and UNFIXABLE (quarantined or unrepairable).
 */
export function isTerminalStatus(status: ItemStatus): boolean {
  return status === 'COMPLETED' || status === 'TAKEN_HOME' || status === 'UNFIXABLE';
}

/**
 * Determines whether a card token can be assigned to a repair item.
 * Strictly only allowable for items in REGISTERED status that do not currently have a card assigned.
 */
export function canAssignCard(item: { status: ItemStatus; cardNumber?: number | null }): boolean {
  return item.status === 'REGISTERED' && (item.cardNumber === null || item.cardNumber === undefined);
}

/**
 * Assigns a physical reusable card number to a repair item and routes it
 * to either `WAITING_PAT1` (Mains 240V) or `WAITING_REPAIR`. Works both online and offline.
 *
 * Architectural Note: Kept as a single cohesive function (>50 lines) so duplicate
 * card conflict checks, status eligibility validation, and routing execute together.
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

    // Verify no other active or completed item in this session used the same card number
    const { hasConflict, conflictItem } = checkCardConflict(cardNumber, existingList, repairId);
    if (hasConflict && conflictItem) {
      const isCompletedOrCollected = isTerminalStatus(conflictItem.status);
      const statusNote = isCompletedOrCollected 
        ? 'already used by a completed/collected item' 
        : 'currently in use by another active item';
      throw new Error(`Card #${cardNumber} has already been assigned in this session (${statusNote}: ${conflictItem.brandModel || 'Item'}).`);
    }
  } catch (err: unknown) {
    // Re-throw duplicate card conflicts; allow offline query errors to fall through
    if (err instanceof Error && (err.message.includes('currently in use') || err.message.includes('already been assigned'))) {
      throw err;
    }
  }

  // Fetch target repair item and verify it is eligible for card assignment
  const repairRef = doc(db, 'sessions', sessionId, 'repairs', repairId);
  const snap = await getDoc(repairRef);
  if (!snap.exists()) {
    throw new Error("Repair record not found.");
  }

  const data = snap.data() as RepairItem;
  if (!canAssignCard(data)) {
    // Reject terminal items or items that already have a card number
    if (isTerminalStatus(data.status)) {
      throw new Error(`Cannot assign a card to an item that is already ${data.status.toLowerCase().replace('_', ' ')}.`);
    }
    if (data.cardNumber) {
      throw new Error(`Item already has card #${data.cardNumber} assigned.`);
    }
    throw new Error(`Cannot assign a card to an item in status ${data.status}.`);
  }

  // Route Mains 240V items to WAITING_PAT1 and non-mains items to WAITING_REPAIR
  const nextStatus = calculateNextStatusOnCardAssign(data.item.powerType);
  await updateDoc(repairRef, {
    cardNumber,
    status: nextStatus,
    updatedAt: Date.now()
  });
}

/**
 * Searches for a repair record by its assigned physical card number.
 * Prefers non-terminal items, falling back to non-COMPLETED items (such as
 * UNFIXABLE or TAKEN_HOME) or the first matching card document so fixers can
 * re-lookup a card during the active session to attach photos or amend notes (Issue #4).
 */
export async function getRepairByCardNumber(
  sessionId: string,
  cardNumber: number
): Promise<RepairItem | null> {
  // Query repairs in the active session matching the physical card number
  const repairsCol = collection(db, 'sessions', sessionId, 'repairs');
  const q = query(
    repairsCol,
    where('cardNumber', '==', cardNumber)
  );

  const snap = await getDocs(q);
  if (snap.empty) return null;

  // 1. Prefer an active (non-terminal) item
  const activeDoc = snap.docs.find(d => {
    const data = d.data() as RepairItem;
    return !isTerminalStatus(data.status);
  });

  if (activeDoc) {
    return { ...(activeDoc.data() as RepairItem), id: activeDoc.id };
  }

  // 2. Fallback to any item not yet checked out at Front Desk (e.g. UNFIXABLE or TAKEN_HOME)
  const reeditableDoc = snap.docs.find(d => {
    const data = d.data() as RepairItem;
    return data.status !== 'COMPLETED';
  });

  if (reeditableDoc) {
    return { ...(reeditableDoc.data() as RepairItem), id: reeditableDoc.id };
  }

  // 3. Final fallback to the first matching card document in the session
  return { ...(snap.docs[0].data() as RepairItem), id: snap.docs[0].id };
}

/**
 * Performs a point read of compressed item photos for a specific repair item,
 * ordered client-side by `capturedAt` ascending to avoid composite index overhead (Issue #4).
 */
export async function fetchRepairPhotos(
  sessionId: string,
  repairId: string
): Promise<RepairPhoto[]> {
  // Point-read all photo documents in the item's photos subcollection (max 2 docs)
  const photosCol = collection(db, 'sessions', sessionId, 'repairs', repairId, 'photos');
  const snap = await getDocs(photosCol);
  const photos = snap.docs.map(d => ({
    ...(d.data() as RepairPhoto),
    id: d.id
  }));
  // Sort chronologically by capture timestamp on the client
  return photos.sort((a, b) => (a.capturedAt || 0) - (b.capturedAt || 0));
}

/**
 * Atomically deletes a single item photo document and decrements `repair.photoCount`
 * on the parent repair document in a single `writeBatch` so offline IndexedDB queueing
 * never hangs or desynchronises the parent photo counter (Issue #4).
 */
export async function deleteRepairPhoto(
  sessionId: string,
  repairId: string,
  photoId: string,
  currentPhotoCount: number
): Promise<number> {
  // Calculate the decremented photo count, clamped to >= 0
  const nextCount = Math.max(0, Math.floor(currentPhotoCount) - 1);
  const batch = writeBatch(db);
  const photoRef = doc(db, 'sessions', sessionId, 'repairs', repairId, 'photos', photoId);
  const repairRef = doc(db, 'sessions', sessionId, 'repairs', repairId);

  // Queue both the subcollection delete and parent counter update in a single atomic batch
  batch.delete(photoRef);
  batch.update(repairRef, {
    'repair.photoCount': nextCount,
    updatedAt: Date.now()
  });

  await batch.commit();
  return nextCount;
}

/**
 * Awaits a Firestore write Promise (`updateDoc`) while ensuring offline community venue
 * resilience: when `navigator.onLine === false`, Firestore queues the mutation into IndexedDB
 * (`persistentLocalCache`) immediately, so we race against a short timeout to avoid hanging `/pat`.
 */
async function commitPatFirestoreWrite(
  writePromise: Promise<void>,
  timeoutMs: number = 1500
): Promise<void> {
  // Online path: await server acknowledgement normally
  const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
  if (!isOffline) {
    await writePromise;
    return;
  }

  // Offline path: resolve once local IndexedDB queueing completes without hanging the PAT UI
  await Promise.race([
    writePromise,
    new Promise<void>((resolve) => setTimeout(resolve, timeoutMs))
  ]);
}

/**
 * Pure helper that builds the Firestore update payload when a PAT tester overrides
 * an item's `PowerType` to a non-mains category at the PAT Station (Issue #23).
 */
export function buildPowerTypeOverrideUpdate(params: {
  newPowerType: Exclude<PowerType, 'MAINS_240V'>;
  isPat2Stage: boolean;
  now?: number;
}): { nextStatus: ItemStatus; updatePayload: Record<string, unknown> } {
  // Reject MAINS_240V here because mains items must complete a PAT inspection via submitPatInitial/submitPatFinal
  if ((params.newPowerType as PowerType) === 'MAINS_240V') {
    throw new Error('Mains 240V items must complete a PAT inspection via submitPatInitial or submitPatFinal.');
  }

  // Compute target status (WAITING_REPAIR for PAT 1, READY_FOR_COLLECTION for PAT 2)
  const timestamp = params.now ?? Date.now();
  const nextStatus = calculateNextStatusOnPowerTypeOverride(params.newPowerType, params.isPat2Stage);

  // Assemble the sanitised update payload resetting applianceClass to NOT_APPLICABLE
  const updatePayload: Record<string, unknown> = {
    status: nextStatus,
    'item.powerType': params.newPowerType,
    'item.applianceClass': 'NOT_APPLICABLE',
    updatedAt: timestamp
  };

  return { nextStatus, updatePayload };
}

/**
 * Overrides a misclassified item's `PowerType` to a non-mains category at the PAT Station
 * and routes it directly to `WAITING_REPAIR` (PAT 1) or `READY_FOR_COLLECTION` (PAT 2)
 * without fabricating electrical PAT test records (Issue #23).
 */
export async function overrideItemPowerTypeFromPat(params: {
  sessionId: string;
  repairId: string;
  newPowerType: Exclude<PowerType, 'MAINS_240V'>;
  isPat2Stage: boolean;
}): Promise<ItemStatus> {
  // Build the base status and powerType update payload
  const { nextStatus, updatePayload } = buildPowerTypeOverrideUpdate({
    newPowerType: params.newPowerType,
    isPat2Stage: params.isPat2Stage
  });

  // Remove any accidental PAT record for the current stage so PAT analytics are not polluted
  if (params.isPat2Stage) {
    updatePayload.patFinal = deleteField();
  } else {
    updatePayload.patInitial = deleteField();
  }

  // Commit the power type override and status transition with offline-safe fallback
  const repairRef = doc(db, 'sessions', params.sessionId, 'repairs', params.repairId);
  await commitPatFirestoreWrite(updateDoc(repairRef, updatePayload));
  return nextStatus;
}

/**
 * Pure helper that builds the Firestore update payload for Initial PAT Safety Inspection (PAT 1),
 * including atomic `item.powerType` and `item.applianceClass` persistence (Issues #23 & #27).
 */
export function buildPatInitialUpdate(params: {
  testerName: string;
  instrumentSerial: string;
  visualPass: boolean;
  fuseRatingAmps: 3 | 5 | 13 | 'OTHER';
  testVoltageVolts: 250 | 500;
  earthContinuityOhms?: number;
  insulationResistanceMOhms: number;
  outcome: PatInitialOutcome;
  cautionNotes?: string;
  powerType?: PowerType;
  applianceClass?: ApplianceClass;
  now?: number;
}): { nextStatus: ItemStatus; updatePayload: Record<string, unknown> } {
  // Separate item-level fields from the patInitial sub-object fields
  const { powerType, applianceClass, now, ...patData } = params;
  const timestamp = now ?? Date.now();
  const nextStatus = calculateNextStatusOnPatInitial(params.outcome);

  // Assemble the atomic repair document update payload
  const rawPayload: Record<string, unknown> = {
    status: nextStatus,
    'item.powerType': powerType ?? 'MAINS_240V',
    patInitial: {
      ...patData,
      testedAt: timestamp
    },
    updatedAt: timestamp
  };

  // Persist applianceClass on the item if specified by the PAT tester
  if (applianceClass !== undefined) {
    rawPayload['item.applianceClass'] = applianceClass;
  }

  return {
    nextStatus,
    updatePayload: removeUndefined(rawPayload)
  };
}

/**
 * Submits Initial PAT Safety Inspection (PAT 1) and transitions the item to
 * either `WAITING_REPAIR` or `UNFIXABLE` (if `DANGER_DO_NOT_ENERGIZE`).
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
  powerType?: PowerType;
  applianceClass?: ApplianceClass;
}): Promise<ItemStatus> {
  // Extract document identifiers and build the sanitised PAT 1 update payload
  const { sessionId, repairId, ...patParams } = params;
  const { nextStatus, updatePayload } = buildPatInitialUpdate(patParams);

  // Persist sanitised PAT 1 record, powerType, applianceClass, and updated status with offline fallback
  const repairRef = doc(db, 'sessions', sessionId, 'repairs', repairId);
  await commitPatFirestoreWrite(updateDoc(repairRef, updatePayload));

  return nextStatus;
}

/**
 * Submits Volunteer Fixer Record and optional compressed item photos atomically (Issue #4).
 *
 * Architectural Note: Kept as a single cohesive function (>50 lines) so photo validation,
 * capacity enforcement, and atomic `writeBatch` persistence of both `repairs/{repairId}`
 * and `repairs/{repairId}/photos/{photoId}` cannot be partially applied.
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
  newPhotos?: Array<Omit<RepairPhoto, 'id'>>;
  existingPhotoCount?: number;
}): Promise<ItemStatus> {
  // Unpack repair fields, weight, and optional photo attachments
  const {
    sessionId,
    repairId,
    isMainsPower,
    weightKg,
    newPhotos = [],
    existingPhotoCount = 0,
    ...repairData
  } = params;

  // Enforce the maximum per-item photo limit (MAX_PHOTOS_PER_REPAIR = 2)
  const baseCount = Math.max(0, existingPhotoCount);
  const totalPhotoCount = baseCount + newPhotos.length;
  if (totalPhotoCount > MAX_PHOTOS_PER_REPAIR) {
    throw new Error(`A maximum of ${MAX_PHOTOS_PER_REPAIR} photos can be attached to a repair item.`);
  }

  // Validate every newly staged photo against MIME type and 70,000-character Free Tier rules
  for (const photo of newPhotos) {
    const validation = validatePhotoDataUrl(photo.dataUrl);
    if (!validation.valid) {
      throw new Error(validation.error || 'Invalid compressed photo data.');
    }
  }

  // Calculate next lifecycle state (e.g. WAITING_PAT2 for repaired Mains 240V items)
  const now = Date.now();
  const nextStatus = calculateNextStatusOnRepair(params.outcome, isMainsPower);

  // Build parent repair record payload including deterministic photoCount (0..2)
  const repairRef = doc(db, 'sessions', sessionId, 'repairs', repairId);
  const repairPayload: Record<string, unknown> = {
    ...repairData,
    photoCount: totalPhotoCount,
    repairedAt: now
  };

  // Assemble document updates including optional landfill diversion weight
  const updates: Record<string, unknown> = {
    status: nextStatus,
    repair: repairPayload,
    updatedAt: now
  };
  if (weightKg !== undefined && !Number.isNaN(weightKg)) {
    updates['item.weightKg'] = weightKg;
  }

  if (newPhotos.length > 0) {
    // Commit new photo subcollection docs and parent repair record in a single atomic batch
    const batch = writeBatch(db);
    const photosCol = collection(db, 'sessions', sessionId, 'repairs', repairId, 'photos');

    // Add each compressed, EXIF-stripped photo to the atomic write batch
    for (const photo of newPhotos) {
      const photoDocRef = doc(photosCol);
      const photoDoc: RepairPhoto = {
        id: photoDocRef.id,
        dataUrl: photo.dataUrl,
        mimeType: photo.mimeType,
        width: Math.round(photo.width),
        height: Math.round(photo.height),
        sizeBytes: photo.dataUrl.length,
        capturedAt: photo.capturedAt || now,
        uploadedBy: (photo.uploadedBy || params.fixerName || 'Volunteer Fixer').trim().slice(0, 200)
      };
      batch.set(photoDocRef, removeUndefined(photoDoc));
    }

    // Update parent repair document in the same atomic batch
    batch.update(repairRef, removeUndefined(updates));
    await batch.commit();
  } else {
    // Fast-path single document update when no new photos were staged
    await updateDoc(repairRef, removeUndefined(updates));
  }

  return nextStatus;
}

/**
 * Pure helper that builds the Firestore update payload for Final Post-Repair PAT Safety
 * Certification (PAT 2), preserving `patInitial` untouched so PAT 1 and PAT 2 can record
 * independent operators (`testerName`) and instruments (`instrumentSerial`) (Issues #23 & #27).
 */
export function buildPatFinalUpdate(params: {
  testerName: string;
  instrumentSerial: string;
  visualPass: boolean;
  fuseRatingAmps: 3 | 5 | 13 | 'OTHER';
  testVoltageVolts?: 250 | 500;
  earthContinuityOhms?: number;
  insulationResistanceMOhms: number;
  outcome: PatFinalOutcome;
  certificateNotes?: string;
  powerType?: PowerType;
  applianceClass?: ApplianceClass;
  now?: number;
}): { nextStatus: ItemStatus; updatePayload: Record<string, unknown> } {
  // Separate item-level fields from the patFinal sub-object fields
  const { powerType, applianceClass, now, ...patData } = params;
  const timestamp = now ?? Date.now();
  const nextStatus = calculateNextStatusOnPatFinal(params.outcome);

  // Assemble the atomic repair document update payload without modifying patInitial
  const rawPayload: Record<string, unknown> = {
    status: nextStatus,
    'item.powerType': powerType ?? 'MAINS_240V',
    patFinal: {
      ...patData,
      testedAt: timestamp
    },
    updatedAt: timestamp
  };

  // Persist applianceClass on the item if specified by the PAT tester
  if (applianceClass !== undefined) {
    rawPayload['item.applianceClass'] = applianceClass;
  }

  return {
    nextStatus,
    updatePayload: removeUndefined(rawPayload)
  };
}

/**
 * Submits Final Post-Repair PAT Safety Certification (PAT 2) and routes passing
 * items to `READY_FOR_COLLECTION` or failing items back to `WAITING_REPAIR`.
 */
export async function submitPatFinal(params: {
  sessionId: string;
  repairId: string;
  testerName: string;
  instrumentSerial: string;
  visualPass: boolean;
  fuseRatingAmps: 3 | 5 | 13 | 'OTHER';
  testVoltageVolts?: 250 | 500;
  earthContinuityOhms?: number;
  insulationResistanceMOhms: number;
  outcome: PatFinalOutcome;
  certificateNotes?: string;
  powerType?: PowerType;
  applianceClass?: ApplianceClass;
}): Promise<ItemStatus> {
  // Extract document identifiers and build the sanitised PAT 2 update payload
  const { sessionId, repairId, ...patParams } = params;
  const { nextStatus, updatePayload } = buildPatFinalUpdate(patParams);

  // Persist sanitised PAT 2 certification record on the repair document with offline fallback
  const repairRef = doc(db, 'sessions', sessionId, 'repairs', repairId);
  await commitPatFirestoreWrite(updateDoc(repairRef, updatePayload));

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
 * Reads private customer PII (Only accessible by Google Auth organizers).
 */
export async function getPrivateCustomerData(
  sessionId: string,
  repairId: string
): Promise<PrivateCustomerData | null> {
  try {
    // Point-read segregated customer contact details from private/customer
    const privateRef = doc(db, 'sessions', sessionId, 'repairs', repairId, 'private', 'customer');
    const snap = await getDoc(privateRef);
    if (!snap.exists()) return null;
    return snap.data() as PrivateCustomerData;
  } catch (err) {
    // Return null if unauthorized or offline cache miss
    console.error(`[getPrivateCustomerData] Failed to read private customer data for repair ${repairId}:`, err);
    return null;
  }
}

/**
 * Standard HTML input attributes applied to repair item lookup and token inputs
 * on the PAT Station, Volunteer Fixer Station, and Front Desk views (Issue #28).
 *
 * Prevents iOS Safari (WebKit CreditCardAutoFill), Chrome Autofill, and third-party
 * password managers from misclassifying numeric repair item lookup inputs as
 * payment credit card number (`cc-number`) fields.
 */
export const REPAIR_ITEM_LOOKUP_INPUT_PROPS = {
  type: 'number' as const,
  inputMode: 'numeric' as const,
  pattern: '[0-9]*',
  min: 1,
  max: 200,
  name: 'repair-item-lookup',
  autoComplete: 'off',
  autoCorrect: 'off',
  autoCapitalize: 'off',
  spellCheck: false,
  'aria-label': 'Repair item lookup',
  placeholder: 'Enter Repair Item # (1–100)...',
  'data-1p-ignore': true,
  'data-lpignore': 'true',
  'data-bwignore': 'true',
  'data-form-type': 'other',
} as const;

/**
 * Regular expression matching credit-card autofill heuristic trigger terms
 * in input attributes (`placeholder`, `name`, `id`, `aria-label`).
 * Used by unit tests to guard against regressions of Issue #28 on iOS Safari.
 */
export const CREDIT_CARD_AUTOFILL_TRIGGER_REGEX =
  /\b(?:credit\s*card|card\s*(?:number|no|num|#)|cc[-_\s]?(?:number|num|no)|pan)\b|\bcard\b/i;

/**
 * Validates that a set of input attributes for repair item lookup is safe from
 * iOS Safari / WebKit credit-card autofill heuristics (Issue #28).
 */
export function isSafeFromCreditCardAutofill(attrs: {
  name?: string;
  id?: string;
  placeholder?: string;
  'aria-label'?: string;
  autoComplete?: string;
  'data-form-type'?: string;
}): boolean {
  // Require explicit autofill suppression attributes
  if (attrs.autoComplete !== 'off') return false;
  if (attrs['data-form-type'] !== 'other') return false;
  if (!attrs.name || !attrs.placeholder) return false;

  // Inspect all attributes scanned by WebKit / Chromium credit-card heuristics
  const inspectableFields = [
    attrs.name,
    attrs.id ?? '',
    attrs.placeholder,
    attrs['aria-label'] ?? '',
  ];

  return inspectableFields.every(
    (value) => !CREDIT_CARD_AUTOFILL_TRIGGER_REGEX.test(value)
  );
}

