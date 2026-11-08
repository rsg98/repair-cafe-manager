import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
} from 'firebase/firestore';
import { db } from './firebase';
import {
  Volunteer,
  SessionVolunteerSummary,
  Session,
  WhatsAppSyncStatus,
} from '../types';
import { cafeConfig } from '../config/cafe.config';
import { removeUndefined } from './repairService';
import {
  APP_BUILD_TIMESTAMP,
  APP_VERSION,
  shouldPublishAppVersion,
} from './pwaUpdateService';

/**
 * Input payload for creating or validating a Volunteer Register entry.
 */
export interface VolunteerInput {
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
  // WhatsApp group opt-in consent and optional immediate status override (Issue #43)
  whatsappOptIn?: boolean;
  whatsappStatus?: WhatsAppSyncStatus;
  markWhatsAppAddedImmediately?: boolean;
}

/**
 * Disposition choice when archiving a volunteer who was opted into or added to WhatsApp (Issue #43).
 * - 'REMOVED': Volunteer has been removed from the WhatsApp group (status reset to NOT_APPLICABLE)
 * - 'KEEP_SOCIAL': Volunteer remains in the WhatsApp group for social reasons (status stays ADDED)
 */
export type ArchiveWhatsAppDisposition = 'REMOVED' | 'KEEP_SOCIAL';

/**
 * Standard FIPS 180-4 SHA-256 round constants.
 */
const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/**
 * Pure, synchronous FIPS 180-4 SHA-256 hex digest helper for hashing normalised phone numbers.
 */
export function sha256Hex(input: string): string {
  const utf8 = new TextEncoder().encode(input);
  const bitLen = utf8.length * 8;
  const totalBytes = (((utf8.length + 8) >> 6) + 1) * 64;
  const padded = new Uint8Array(totalBytes);
  padded.set(utf8);
  padded[utf8.length] = 0x80;

  const view = new DataView(padded.buffer);
  view.setUint32(totalBytes - 8, Math.floor(bitLen / 0x100000000), false);
  view.setUint32(totalBytes - 4, bitLen >>> 0, false);

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;

  const w = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));

  for (let offset = 0; offset < totalBytes; offset += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = view.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;

    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  return [h0, h1, h2, h3, h4, h5, h6, h7]
    .map((v) => v.toString(16).padStart(8, '0'))
    .join('');
}

/**
 * Normalises a UK or international telephone number into canonical E.164 format (`+447...`).
 * Returns `null` if the string does not contain a valid 7-15 digit phone number.
 */
export function normalizeUkPhoneNumber(rawPhone?: string | null): string | null {
  if (!rawPhone) return null;

  // Strip directional unicode markers, whitespace, hyphens, dots, and parentheses
  let cleaned = rawPhone
    .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069\u00a0\s\-().]/g, '')
    .trim();
  if (!cleaned) return null;

  // Handle "+44(0)7..." -> "+447..."
  if (cleaned.startsWith('+440') && cleaned.length >= 13) {
    cleaned = '+44' + cleaned.slice(4);
  } else if (cleaned.startsWith('00440') && cleaned.length >= 14) {
    cleaned = '+44' + cleaned.slice(5);
  } else if (cleaned.startsWith('00')) {
    cleaned = '+' + cleaned.slice(2);
  } else if (cleaned.startsWith('0') && /^0\d{9,10}$/.test(cleaned)) {
    // Standard UK domestic number (e.g. 07700900123 -> +447700900123)
    cleaned = '+44' + cleaned.slice(1);
  } else if (/^44\d{10}$/.test(cleaned)) {
    cleaned = '+' + cleaned;
  } else if (/^\d{7,15}$/.test(cleaned)) {
    cleaned = '+' + cleaned;
  }

  if (!/^\+\d{7,15}$/.test(cleaned)) {
    return null;
  }
  return cleaned;
}

/**
 * Computes a one-way SHA-256 hash of a normalised E.164 phone number so archived
 * volunteer records can be matched during CLI WhatsApp reconciliation without storing plaintext PII.
 */
export function hashNormalizedPhone(rawPhone?: string | null): string | undefined {
  const normalized = normalizeUkPhoneNumber(rawPhone);
  if (!normalized) return undefined;
  return sha256Hex(normalized);
}

/**
 * Pure state machine transition helper for a volunteer's WhatsApp group membership status.
 */
export function resolveWhatsAppStatusOnSave(params: {
  whatsappOptIn?: boolean;
  currentStatus?: WhatsAppSyncStatus;
  markAddedImmediately?: boolean;
}): WhatsAppSyncStatus {
  const optIn = Boolean(params.whatsappOptIn);
  const current = params.currentStatus ?? 'NOT_APPLICABLE';

  if (optIn) {
    if (params.markAddedImmediately || current === 'ADDED') {
      return 'ADDED';
    }
    return 'PENDING_ADD';
  }

  // Volunteer is NOT opted in: if they were previously in the group, flag for removal
  if (current === 'ADDED' || current === 'PENDING_REMOVAL') {
    return 'PENDING_REMOVAL';
  }
  return 'NOT_APPLICABLE';
}

/**
 * Builds a 1-to-1 `https://wa.me/<number>?text=...` deep link with a friendly welcome greeting
 * and optional WhatsApp group invite URL.
 */
export function formatWhatsAppDeepLink(params: {
  phone?: string | null;
  volunteerName: string;
  cafeName?: string;
  groupInviteUrl?: string;
}): string | null {
  const normalized = normalizeUkPhoneNumber(params.phone);
  if (!normalized) return null;

  const digitsOnly = normalized.replace(/^\+/, '');
  const firstName =
    (params.volunteerName || '').trim().split(/\s+/)[0] || 'there';
  const cafeLabel = (params.cafeName || cafeConfig.cafeName || 'Repair Café').trim();
  const inviteUrl = (
    params.groupInviteUrl ?? cafeConfig.whatsappGroupInviteUrl ?? ''
  ).trim();

  const message = inviteUrl
    ? `Hi ${firstName}, welcome to ${cafeLabel}! You opted into our volunteer WhatsApp group — you can join using this link: ${inviteUrl}`
    : `Hi ${firstName}, welcome to ${cafeLabel}! I am getting in touch to add you to our volunteer WhatsApp group.`;

  return `https://wa.me/${digitsOnly}?text=${encodeURIComponent(message)}`;
}

/**
 * Returns true if archiving this volunteer requires the organiser to specify whether
 * they were removed from the WhatsApp group or are remaining in the group socially.
 */
export function requiresWhatsAppArchiveDecision(
  volunteer: Pick<Volunteer, 'whatsappOptIn' | 'whatsappStatus'>
): boolean {
  return (
    Boolean(volunteer.whatsappOptIn) ||
    volunteer.whatsappStatus === 'ADDED' ||
    volunteer.whatsappStatus === 'PENDING_REMOVAL'
  );
}

/**
 * Validates mandatory fields for a volunteer record, including the rule that
 * any volunteer flagged as an Organiser (`isOrganiser: true`) must supply a valid email,
 * and any volunteer opting into WhatsApp (`whatsappOptIn: true`) must supply a valid phone number.
 */
export function validateVolunteerInput(input: VolunteerInput): {
  valid: boolean;
  error?: string;
} {
  // Ensure volunteer full name is present
  if (!input.name || !input.name.trim()) {
    return { valid: false, error: 'Volunteer name is required.' };
  }

  // Ensure emergency contact name and phone number are provided for safety compliance
  if (!input.emergencyContactName || !input.emergencyContactName.trim()) {
    return { valid: false, error: 'Emergency contact name is required.' };
  }
  if (!input.emergencyContactPhone || !input.emergencyContactPhone.trim()) {
    return { valid: false, error: 'Emergency contact phone number is required.' };
  }

  // Ensure emergency contact is another person, not the volunteer themselves
  if (
    input.emergencyContactName.trim().toLowerCase() ===
    input.name.trim().toLowerCase()
  ) {
    return {
      valid: false,
      error: 'Emergency contact must be another person, not the volunteer themselves.',
    };
  }

  // Require a valid contact phone number when opting into the WhatsApp group (Issue #43)
  if (input.whatsappOptIn) {
    if (!input.phone || !input.phone.trim() || !normalizeUkPhoneNumber(input.phone)) {
      return {
        valid: false,
        error:
          'A valid contact phone number is required when opting into the WhatsApp group.',
      };
    }
  }

  // Normalize phone strings to ensure the emergency phone differs from the volunteer's own phone
  const normalizedVolunteerPhone =
    normalizeUkPhoneNumber(input.phone) ||
    (input.phone || '').replace(/[\s\-()]/g, '');
  const normalizedEmergencyPhone =
    normalizeUkPhoneNumber(input.emergencyContactPhone) ||
    input.emergencyContactPhone.replace(/[\s\-()]/g, '');
  if (
    normalizedVolunteerPhone &&
    normalizedVolunteerPhone === normalizedEmergencyPhone
  ) {
    return {
      valid: false,
      error:
        'Emergency contact phone number must be different from the volunteer phone number.',
    };
  }

  // Organisers require a Google-compatible email address for Front Desk sign-in authorization
  const trimmedEmail = (input.email || '').trim();
  if (input.isOrganiser) {
    if (!trimmedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      return {
        valid: false,
        error:
          'Email address is required when marking a volunteer as an Organiser.',
      };
    }
  } else if (trimmedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
    // If an optional email is supplied for a non-organiser, verify basic format
    return { valid: false, error: 'Please enter a valid email address.' };
  }

  return { valid: true };
}

/**
 * Checks whether a volunteer name already exists in the register (case-insensitive),
 * ignoring archived records and optionally excluding a specific volunteer ID when editing.
 */
export function hasDuplicateVolunteerName(
  name: string,
  existingVolunteers: ReadonlyArray<Pick<Volunteer, 'id' | 'name'> & { archived?: boolean }>,
  excludeId?: string
): boolean {
  const normalized = name.trim().toLowerCase();
  if (!normalized) return false;

  // Match against active volunteers while ignoring archived records and the record being updated
  return existingVolunteers.some(
    (v) =>
      v.id !== excludeId &&
      !v.archived &&
      v.name.trim().toLowerCase() === normalized
  );
}

/**
 * Formats a volunteer's full name to First-name and Initial of Surname only
 * (e.g. "Alice Smith" -> "Alice S") for UK GDPR compliance when archiving.
 */
export function formatArchivedVolunteerName(fullName: string): string {
  const parts = (fullName || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0];

  const firstName = parts[0];
  const surname = parts[parts.length - 1];
  const letterMatch = surname.match(/[A-Za-zÀ-ÖØ-öø-ÿ]/);
  const surnameInitial = (
    letterMatch ? letterMatch[0] : surname.charAt(0)
  ).toUpperCase();

  return surnameInitial ? `${firstName} ${surnameInitial}` : firstName;
}

/**
 * Evaluates whether a volunteer record is eligible to be archived.
 * Volunteers enabled as an organiser (`isOrganiser: true`) cannot be archived
 * until their organiser flag has been removed.
 */
export function canArchiveVolunteer(
  volunteer: Pick<Volunteer, 'isOrganiser' | 'archived'>
): { allowed: boolean; reason?: string } {
  if (volunteer.archived) {
    return {
      allowed: false,
      reason: 'This volunteer is already archived.',
    };
  }
  if (volunteer.isOrganiser) {
    return {
      allowed: false,
      reason:
        'Cannot archive a volunteer who is enabled as an organiser. Please remove the Organiser role from this volunteer before archiving.',
    };
  }
  return { allowed: true };
}

/**
 * Verifies that the confirmation text entered by the Front Desk organiser matches
 * the volunteer's full name (case-insensitive, whitespace-normalised).
 */
export function validateArchiveConfirmationName(
  expectedFullName: string,
  confirmationInput: string
): boolean {
  const expected = (expectedFullName || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
  const actual = (confirmationInput || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
  if (!expected || !actual) return false;
  return expected === actual;
}

/**
 * Pure helper that transforms a `Volunteer` record into its GDPR-archived form:
 * - Alters `name` to First-name and Initial of Surname only
 * - Removes `phone`, `email`, and all emergency contact details
 * - Retains a one-way SHA-256 `phoneHash` so CLI WhatsApp reconciliation can identify archived members
 * - Sets `whatsappOptIn` / `whatsappStatus` according to `options.whatsappDisposition`
 * - Sets `archived: true` and `archivedAt` while preserving `id` and historical metadata
 */
export function buildArchivedVolunteerRecord(
  volunteer: Volunteer,
  now: number = Date.now(),
  options?: { whatsappDisposition?: ArchiveWhatsAppDisposition }
): Volunteer {
  const check = canArchiveVolunteer(volunteer);
  if (!check.allowed) {
    throw new Error(check.reason);
  }

  const keepSocial = options?.whatsappDisposition === 'KEEP_SOCIAL';
  const phoneHash = hashNormalizedPhone(volunteer.phone) || volunteer.phoneHash;

  return removeUndefined({
    id: volunteer.id,
    name: formatArchivedVolunteerName(volunteer.name),
    emergencyContactName: '',
    emergencyContactPhone: '',
    isOrganiser: false,
    isPatTrained: Boolean(volunteer.isPatTrained),
    inducted: Boolean(volunteer.inducted),
    inductedAt: volunteer.inductedAt,
    inductedBy: volunteer.inductedBy,
    whatsappOptIn: keepSocial ? true : false,
    whatsappStatus: (keepSocial ? 'ADDED' : 'NOT_APPLICABLE') as WhatsAppSyncStatus,
    phoneHash,
    archived: true,
    archivedAt: now,
    createdAt: volunteer.createdAt,
    updatedAt: now,
  });
}

/**
 * Filters a list of volunteers to only active (non-archived) records.
 * Used by default in the Volunteer Register and when starting or editing a live session.
 */
export function filterActiveVolunteers<T extends { archived?: boolean }>(
  volunteers: ReadonlyArray<T>
): T[] {
  return volunteers.filter((v) => !v.archived);
}

/**
 * Projects a full `Volunteer` document down to a non-PII `SessionVolunteerSummary`
 * safe for embedding on public/volunteer-readable `Session` documents.
 */
export function toSessionVolunteerSummary(
  volunteer: Pick<
    Volunteer,
    'id' | 'name' | 'isOrganiser' | 'isPatTrained' | 'inducted'
  >
): SessionVolunteerSummary {
  // Strip contact phone, email, and emergency contact details before storing on Session
  return {
    id: volunteer.id,
    name: volunteer.name.trim(),
    isOrganiser: Boolean(volunteer.isOrganiser),
    isPatTrained: Boolean(volunteer.isPatTrained),
    inducted: Boolean(volunteer.inducted),
  };
}

/**
 * Merges static `cafeConfig.organizerEmails` with the email addresses of all active volunteers
 * who have `isOrganiser: true`, returning a deduplicated, normalized array.
 */
export function mergeOrganiserEmails(
  staticEmails: string[],
  volunteers: Array<Pick<Volunteer, 'isOrganiser' | 'email'> & { archived?: boolean }>
): string[] {
  const emailSet = new Set<string>();

  // Seed with static bootstrap organiser emails and domain rules from cafeConfig
  for (const entry of staticEmails) {
    const cleaned = entry.trim().toLowerCase();
    if (cleaned) {
      emailSet.add(cleaned);
    }
  }

  // Add normalized emails for all active volunteers currently marked as organisers
  for (const volunteer of volunteers) {
    if (volunteer.isOrganiser && !volunteer.archived && volunteer.email) {
      const cleaned = volunteer.email.trim().toLowerCase();
      if (cleaned) {
        emailSet.add(cleaned);
      }
    }
  }

  return Array.from(emailSet);
}

/**
 * Filters a session's attending volunteers to only those who are PAT trained (`isPatTrained: true`),
 * sorted alphabetically by name for the PAT Station dropdown.
 */
export function getQualifiedPatTesters(
  attendingVolunteers: SessionVolunteerSummary[] = []
): SessionVolunteerSummary[] {
  // Clone, filter to PAT-qualified attendees, and sort alphabetically
  return [...attendingVolunteers]
    .filter((v) => v.isPatTrained === true)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Normalises a raw Firestore document from `volunteers/{volunteerId}` into a typed `Volunteer`
 * object, defaulting omitted emergency contact fields (e.g. on archived records) to empty strings
 * and unmigrated WhatsApp fields to `whatsappOptIn: false` / `whatsappStatus: 'NOT_APPLICABLE'`.
 */
function normalizeVolunteerDoc(
  id: string,
  raw: Partial<Volunteer>
): Volunteer {
  const whatsappOptIn = Boolean(raw.whatsappOptIn);
  const whatsappStatus: WhatsAppSyncStatus =
    raw.whatsappStatus || (whatsappOptIn ? 'PENDING_ADD' : 'NOT_APPLICABLE');

  return {
    ...(raw as Omit<Volunteer, 'id'>),
    id,
    name: raw.name || '',
    emergencyContactName: raw.emergencyContactName ?? '',
    emergencyContactPhone: raw.emergencyContactPhone ?? '',
    isOrganiser: Boolean(raw.isOrganiser),
    isPatTrained: Boolean(raw.isPatTrained),
    inducted: Boolean(raw.inducted),
    whatsappOptIn,
    whatsappStatus,
    createdAt: raw.createdAt ?? 0,
    updatedAt: raw.updatedAt ?? 0,
  };
}

/**
 * Fetches all volunteers from the `volunteers` collection, sorted alphabetically by name.
 */
export async function listVolunteers(): Promise<Volunteer[]> {
  const volunteersRef = collection(db, 'volunteers');
  const snap = await getDocs(volunteersRef);

  // Map Firestore documents to typed Volunteer objects and sort by name
  const volunteers = snap.docs.map((d) =>
    normalizeVolunteerDoc(d.id, d.data() as Partial<Volunteer>)
  );
  return volunteers.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Point-reads a single volunteer document from `volunteers/{volunteerId}`
 * (used when opening an emergency contact card from the active session banner).
 */
export async function getVolunteerById(
  volunteerId: string
): Promise<Volunteer | null> {
  const volunteerRef = doc(db, 'volunteers', volunteerId);
  const snap = await getDoc(volunteerRef);
  if (!snap.exists()) return null;

  // Return the hydrated Volunteer record with its document ID
  return normalizeVolunteerDoc(snap.id, snap.data() as Partial<Volunteer>);
}

/**
 * Computes the merged list of static + dynamic organiser emails and persists it
 * to `settings/system.organizerEmails` so newly designated organisers can sign in.
 */
export async function syncOrganiserEmailsToSystemSettings(
  providedVolunteers?: Volunteer[]
): Promise<string[]> {
  // Load current volunteers from Firestore if not already provided by the caller
  const volunteers = providedVolunteers ?? (await listVolunteers());
  const mergedEmails = mergeOrganiserEmails(cafeConfig.organizerEmails, volunteers);

  // Persist merged organiser email list (and production build version metadata) to settings/system with merge: true
  const settingsRef = doc(db, 'settings', 'system');
  const includeVersionStamp = shouldPublishAppVersion(
    APP_VERSION,
    APP_BUILD_TIMESTAMP,
    null
  );
  await setDoc(
    settingsRef,
    {
      organizerEmails: mergedEmails,
      updatedAt: Date.now(),
      ...(includeVersionStamp
        ? {
            deployedVersion: APP_VERSION,
            deployedBuildTimestamp: APP_BUILD_TIMESTAMP,
          }
        : {}),
    },
    { merge: true }
  );

  return mergedEmails;
}

/**
 * Creates a new volunteer in `volunteers/{volunteerId}` after validating inputs and duplicate names,
 * then synchronizes `settings/system.organizerEmails`.
 */
export async function createVolunteer(input: VolunteerInput): Promise<Volunteer> {
  // Validate mandatory fields and organiser email requirement
  const validation = validateVolunteerInput(input);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  // Enforce unique case-insensitive volunteer names across the register
  const existing = await listVolunteers();
  if (hasDuplicateVolunteerName(input.name, existing)) {
    throw new Error(`A volunteer named "${input.name.trim()}" is already on the register.`);
  }

  // Generate timestamp and target document reference in `volunteers` collection
  const now = Date.now();
  const volunteerRef = doc(collection(db, 'volunteers'));
  const whatsappOptIn = Boolean(input.whatsappOptIn);
  const whatsappStatus =
    input.whatsappStatus ??
    resolveWhatsAppStatusOnSave({
      whatsappOptIn,
      markAddedImmediately: input.markWhatsAppAddedImmediately,
    });

  // Build sanitized volunteer document payload with contact, role, and WhatsApp sync flags
  const newVolunteer: Volunteer = removeUndefined({
    id: volunteerRef.id,
    name: input.name.trim(),
    phone: input.phone?.trim() || undefined,
    email: input.email?.trim().toLowerCase() || undefined,
    emergencyContactName: input.emergencyContactName.trim(),
    emergencyContactPhone: input.emergencyContactPhone.trim(),
    emergencyContactRelationship:
      input.emergencyContactRelationship?.trim() || undefined,
    // Populate role flags, induction metadata, and WhatsApp group state
    isOrganiser: Boolean(input.isOrganiser),
    isPatTrained: Boolean(input.isPatTrained),
    inducted: Boolean(input.inducted),
    inductedAt: input.inducted ? input.inductedAt || now : undefined,
    inductedBy: input.inducted ? input.inductedBy?.trim() || undefined : undefined,
    whatsappOptIn,
    whatsappStatus,
    createdAt: now,
    updatedAt: now,
  });

  // Save document and update dynamic organiser emails if needed
  await setDoc(volunteerRef, newVolunteer);
  await syncOrganiserEmailsToSystemSettings([...existing, newVolunteer]);

  return newVolunteer;
}

/**
 * Updates an existing volunteer record in `volunteers/{volunteerId}`, synchronizes
 * `settings/system.organizerEmails`, and refreshes the active session's `attendingVolunteers`
 * summary if the volunteer is currently marked as attending.
 */
export async function updateVolunteer(
  volunteerId: string,
  input: VolunteerInput,
  activeSessionId?: string | null
): Promise<Volunteer> {
  // Validate mandatory fields and organiser email requirement
  const validation = validateVolunteerInput(input);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  // Verify the volunteer exists and check for duplicate names against other records
  const existing = await listVolunteers();
  const currentRecord = existing.find((v) => v.id === volunteerId);
  if (!currentRecord) {
    throw new Error('Volunteer record not found.');
  }
  if (hasDuplicateVolunteerName(input.name, existing, volunteerId)) {
    throw new Error(`A volunteer named "${input.name.trim()}" is already on the register.`);
  }

  // Build updated volunteer payload preserving original creation and induction timestamps
  const now = Date.now();
  const whatsappOptIn = Boolean(input.whatsappOptIn);
  const whatsappStatus =
    input.whatsappStatus ??
    resolveWhatsAppStatusOnSave({
      whatsappOptIn,
      currentStatus: currentRecord.whatsappStatus,
      markAddedImmediately: input.markWhatsAppAddedImmediately,
    });

  const updatedVolunteer: Volunteer = removeUndefined({
    id: volunteerId,
    name: input.name.trim(),
    phone: input.phone?.trim() || undefined,
    email: input.email?.trim().toLowerCase() || undefined,
    emergencyContactName: input.emergencyContactName.trim(),
    emergencyContactPhone: input.emergencyContactPhone.trim(),
    emergencyContactRelationship:
      input.emergencyContactRelationship?.trim() || undefined,
    // Update role flags, WhatsApp state, and preserve prior induction metadata when remaining inducted
    isOrganiser: Boolean(input.isOrganiser),
    isPatTrained: Boolean(input.isPatTrained),
    inducted: Boolean(input.inducted),
    inductedAt: input.inducted
      ? currentRecord.inductedAt || input.inductedAt || now
      : undefined,
    inductedBy: input.inducted
      ? input.inductedBy?.trim() || currentRecord.inductedBy || undefined
      : undefined,
    whatsappOptIn,
    whatsappStatus,
    createdAt: currentRecord.createdAt,
    updatedAt: now,
  });

  // Overwrite document cleanly so cleared optional fields are removed
  const volunteerRef = doc(db, 'volunteers', volunteerId);
  await setDoc(volunteerRef, updatedVolunteer);

  // Sync updated organiser email list to settings/system
  const updatedList = existing.map((v) =>
    v.id === volunteerId ? updatedVolunteer : v
  );
  await syncOrganiserEmailsToSystemSettings(updatedList);

  // If there is an active session where this volunteer is attending, keep summary in sync
  if (activeSessionId) {
    await refreshVolunteerInActiveSession(activeSessionId, updatedVolunteer);
  }

  return updatedVolunteer;
}

/**
 * Archives a volunteer in `volunteers/{volunteerId}` in compliance with UK GDPR:
 * - Prevents archival if `isOrganiser` is true until the organiser flag is removed
 * - Requires the organiser to confirm by entering the volunteer's full name
 * - Alters `name` to First-name and Initial of Surname only
 * - Removes emergency contact information, email address, and phone number from the database
 * - Preserves the document ID so completed repairs and historical session volunteer counts remain accurate
 * - Removes the volunteer from any currently active live session attendance
 */
export async function archiveVolunteer(
  volunteerId: string,
  confirmationName: string,
  activeSessionId?: string | null,
  options?: { whatsappDisposition?: ArchiveWhatsAppDisposition }
): Promise<Volunteer> {
  const currentRecord = await getVolunteerById(volunteerId);
  if (!currentRecord) {
    throw new Error('Volunteer record not found.');
  }

  // Enforce organiser archival guard
  const eligibility = canArchiveVolunteer(currentRecord);
  if (!eligibility.allowed) {
    throw new Error(eligibility.reason);
  }

  // Verify full-name confirmation matches before redacting PII
  if (!validateArchiveConfirmationName(currentRecord.name, confirmationName)) {
    throw new Error(
      `Confirmation name does not match "${currentRecord.name}". Please enter the volunteer's full name.`
    );
  }

  // Enforce WhatsApp group disposition confirmation when the volunteer is in or opted into WhatsApp
  if (
    requiresWhatsAppArchiveDecision(currentRecord) &&
    !options?.whatsappDisposition
  ) {
    throw new Error(
      'Please confirm whether this volunteer was removed from the WhatsApp group or is remaining in the group socially.'
    );
  }

  const archivedRecord = buildArchivedVolunteerRecord(
    currentRecord,
    Date.now(),
    options
  );

  // Build Firestore document omitting emergency contact, email, and phone fields entirely
  const {
    emergencyContactName: _omitEmergencyName,
    emergencyContactPhone: _omitEmergencyPhone,
    emergencyContactRelationship: _omitEmergencyRel,
    phone: _omitPhone,
    email: _omitEmail,
    ...firestorePayload
  } = archivedRecord;
  void _omitEmergencyName;
  void _omitEmergencyPhone;
  void _omitEmergencyRel;
  void _omitPhone;
  void _omitEmail;

  const volunteerRef = doc(db, 'volunteers', volunteerId);
  await setDoc(volunteerRef, removeUndefined(firestorePayload));

  // Remove the archived volunteer from the active live session's attendance roster if present
  if (activeSessionId) {
    const sessionRef = doc(db, 'sessions', activeSessionId);
    const sessionSnap = await getDoc(sessionRef);
    if (sessionSnap.exists()) {
      const sessionData = sessionSnap.data() as Session;
      const currentSummaries = sessionData.attendingVolunteers || [];
      if (currentSummaries.some((s) => s.id === volunteerId)) {
        const nextSummaries = currentSummaries.filter((s) => s.id !== volunteerId);
        await updateDoc(sessionRef, {
          attendingVolunteerIds: nextSummaries.map((s) => s.id),
          attendingVolunteers: nextSummaries,
        });
      }
    }
  }

  return archivedRecord;
}

/**
 * Updates a volunteer's WhatsApp group membership status directly from a register quick-action
 * (e.g. "Mark Added" -> `ADDED`, or "Confirm Removed" -> `NOT_APPLICABLE`).
 */
export async function updateVolunteerWhatsAppStatus(
  volunteerId: string,
  nextStatus: WhatsAppSyncStatus
): Promise<void> {
  const now = Date.now();
  const volunteerRef = doc(db, 'volunteers', volunteerId);
  const nextOptIn = nextStatus === 'ADDED' || nextStatus === 'PENDING_ADD';

  await updateDoc(volunteerRef, {
    whatsappOptIn: nextOptIn,
    whatsappStatus: nextStatus,
    updatedAt: now,
  });
}

/**
 * Restores an archived volunteer record to active status once their full name and
 * mandatory emergency contact details have been re-entered by an organiser.
 */
export async function restoreVolunteer(
  volunteerId: string,
  input: VolunteerInput,
  activeSessionId?: string | null
): Promise<Volunteer> {
  return updateVolunteer(volunteerId, input, activeSessionId);
}

/**
 * Deletes a volunteer from `volunteers/{volunteerId}`, re-syncs `settings/system.organizerEmails`,
 * and removes them from the active session's attendance roster if currently checked in.
 */
export async function deleteVolunteer(
  volunteerId: string,
  activeSessionId?: string | null
): Promise<void> {
  // Delete the volunteer document from Firestore
  const volunteerRef = doc(db, 'volunteers', volunteerId);
  await deleteDoc(volunteerRef);

  // Re-sync system organiser emails so removed organiser emails are revoked
  await syncOrganiserEmailsToSystemSettings();

  // Remove the deleted volunteer from the active session's attendance arrays if present
  if (activeSessionId) {
    const sessionRef = doc(db, 'sessions', activeSessionId);
    const sessionSnap = await getDoc(sessionRef);
    if (sessionSnap.exists()) {
      const sessionData = sessionSnap.data() as Session;
      const currentSummaries = sessionData.attendingVolunteers || [];
      // Only write to the session document if the deleted volunteer was listed as attending
      if (currentSummaries.some((s) => s.id === volunteerId)) {
        const nextSummaries = currentSummaries.filter((s) => s.id !== volunteerId);
        await updateDoc(sessionRef, {
          attendingVolunteerIds: nextSummaries.map((s) => s.id),
          attendingVolunteers: nextSummaries,
        });
      }
    }
  }
}

/**
 * Marks a volunteer as inducted (`inducted: true`, `inductedAt`, `inductedBy`) and
 * updates their summary inside the active session's `attendingVolunteers` array if present.
 */
export async function markVolunteerInducted(
  volunteerId: string,
  inductedBy: string,
  activeSessionId?: string | null
): Promise<void> {
  const now = Date.now();
  const volunteerRef = doc(db, 'volunteers', volunteerId);

  // Update induction fields on the Volunteer Register record
  await updateDoc(
    volunteerRef,
    removeUndefined({
      inducted: true,
      inductedAt: now,
      inductedBy: inductedBy.trim() || 'Organiser',
      updatedAt: now,
    })
  );

  // Also update the embedded summary on the active session without an extra volunteer read
  if (activeSessionId) {
    const sessionRef = doc(db, 'sessions', activeSessionId);
    const sessionSnap = await getDoc(sessionRef);
    if (sessionSnap.exists()) {
      const sessionData = sessionSnap.data() as Session;
      const currentSummaries = sessionData.attendingVolunteers || [];
      // Flip `inducted: true` on the matching attending volunteer entry if present
      if (currentSummaries.some((s) => s.id === volunteerId)) {
        const nextSummaries = currentSummaries.map((s) =>
          s.id === volunteerId ? { ...s, inducted: true } : s
        );
        await updateDoc(sessionRef, {
          attendingVolunteers: nextSummaries,
        });
      }
    }
  }
}

/**
 * Updates the list of attending volunteers on a running or newly created session.
 */
export async function updateSessionAttendance(
  sessionId: string,
  selectedVolunteers: Array<
    Pick<Volunteer, 'id' | 'name' | 'isOrganiser' | 'isPatTrained' | 'inducted'>
  >
): Promise<SessionVolunteerSummary[]> {
  // Project selected volunteers to non-PII summaries sorted alphabetically
  const summaries = selectedVolunteers
    .map((v) => toSessionVolunteerSummary(v))
    .sort((a, b) => a.name.localeCompare(b.name));
  const ids = summaries.map((s) => s.id);

  // Persist both ID list and summary objects on the Session document
  const sessionRef = doc(db, 'sessions', sessionId);
  await updateDoc(sessionRef, {
    attendingVolunteerIds: ids,
    attendingVolunteers: summaries,
  });

  return summaries;
}

/**
 * Internal helper that updates a single volunteer's summary entry inside an active session
 * if they are currently listed in `session.attendingVolunteers`.
 */
async function refreshVolunteerInActiveSession(
  sessionId: string,
  updatedVolunteer: Volunteer
): Promise<void> {
  const sessionRef = doc(db, 'sessions', sessionId);
  const sessionSnap = await getDoc(sessionRef);
  if (!sessionSnap.exists()) return;

  // Check if the modified volunteer is currently attending the session
  const sessionData = sessionSnap.data() as Session;
  const currentSummaries = sessionData.attendingVolunteers || [];
  if (!currentSummaries.some((s) => s.id === updatedVolunteer.id)) {
    return;
  }

  // Replace the stale summary entry and sort alphabetically
  const nextSummaries = currentSummaries
    .map((s) =>
      s.id === updatedVolunteer.id ? toSessionVolunteerSummary(updatedVolunteer) : s
    )
    .sort((a, b) => a.name.localeCompare(b.name));

  // Persist refreshed summaries and IDs to the active session document
  await updateDoc(sessionRef, {
    attendingVolunteerIds: nextSummaries.map((s) => s.id),
    attendingVolunteers: nextSummaries,
  });
}
