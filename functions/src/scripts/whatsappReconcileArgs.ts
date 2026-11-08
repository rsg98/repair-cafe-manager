/**
 * @file functions/src/scripts/whatsappReconcileArgs.ts
 *
 * Pure CLI argument parser, WhatsApp participant list parser, and reconciliation plan
 * builder for `npm run whatsapp-reconcile` (Issue #43).
 *
 * NOTE: Imports types and `removeUndefined` from `./historicalIngestParser` so
 * `functions/tsconfig.json` compiles `functions/src` cleanly without crossing the
 * root `src/` directory boundary.
 */

import {
  removeUndefined,
  type Volunteer,
  type WhatsAppSyncStatus,
} from './historicalIngestParser';

/** Supported commands for the `whatsapp-reconcile` CLI. */
export type WhatsAppReconcileCommand = 'reconcile' | 'help';

/** Parsed CLI flags for `npm run whatsapp-reconcile`. */
export interface WhatsAppReconcileCliOptions {
  command: WhatsAppReconcileCommand;
  filePath?: string;
  optInMatched: boolean;
  dryRun: boolean;
  confirm: boolean;
  projectId?: string;
}

/** A single normalised participant extracted from a WhatsApp group export. */
export interface ParsedWhatsAppParticipant {
  rawEntry: string;
  normalizedPhone?: string;
  phoneHash?: string;
  displayName?: string;
}

/** Complete deterministic reconciliation result and Firestore update plan. */
export interface WhatsAppReconciliationPlan {
  unrecognisedGroupMembers: ParsedWhatsAppParticipant[];
  matchedArchivedMembers: Array<{
    participant: ParsedWhatsAppParticipant;
    volunteer: Volunteer;
  }>;
  alreadyInSync: Volunteer[];
  pendingAdditionsConfirmed: Volunteer[];
  newlyOptedInMatches: Volunteer[];
  missingFromGroup: Volunteer[];
  optedOutStillInGroup: Volunteer[];
  firestoreUpdates: Volunteer[];
}

/** Standard FIPS 180-4 SHA-256 round constants. */
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
 * Pure, synchronous FIPS 180-4 SHA-256 hex digest helper.
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
 */
export function normalizeUkPhoneNumber(rawPhone?: string | null): string | null {
  if (!rawPhone) return null;

  let cleaned = rawPhone
    .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069\u00a0\s\-().]/g, '')
    .trim();
  if (!cleaned) return null;

  if (cleaned.startsWith('+440') && cleaned.length >= 13) {
    cleaned = '+44' + cleaned.slice(4);
  } else if (cleaned.startsWith('00440') && cleaned.length >= 14) {
    cleaned = '+44' + cleaned.slice(5);
  } else if (cleaned.startsWith('00')) {
    cleaned = '+' + cleaned.slice(2);
  } else if (cleaned.startsWith('0') && /^0\d{9,10}$/.test(cleaned)) {
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
 * Computes a one-way SHA-256 hash of a normalised E.164 phone number.
 */
export function hashNormalizedPhone(rawPhone?: string | null): string | undefined {
  const normalized = normalizeUkPhoneNumber(rawPhone);
  if (!normalized) return undefined;
  return sha256Hex(normalized);
}

function requireCliValue(
  value: string | undefined,
  flagName: string,
  placeholder: string
): string {
  if (!value || !value.trim() || value.trim().startsWith('-')) {
    throw new Error(
      `Missing required ${placeholder} argument after "${flagName}".`
    );
  }
  return value.trim();
}

export function parseWhatsAppReconcileArgs(
  argv: string[]
): WhatsAppReconcileCliOptions {
  const tokens = argv.map((arg) => arg.trim()).filter((arg) => arg.length > 0);
  if (tokens.length === 0) {
    return {
      command: 'help',
      optInMatched: false,
      dryRun: false,
      confirm: false,
    };
  }

  let filePath: string | undefined;
  let optInMatched = false;
  let dryRun = false;
  let confirm = false;
  let projectId: string | undefined;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === '--help' || token === '-h' || token === 'help') {
      return {
        command: 'help',
        optInMatched: false,
        dryRun: false,
        confirm: false,
      };
    } else if (token === '--file' || token === '-f') {
      filePath = requireCliValue(tokens[i + 1], token, '<path>');
      i++;
    } else if (token === '--opt-in-matched') {
      optInMatched = true;
    } else if (token === '--dry-run') {
      dryRun = true;
    } else if (token === '--confirm') {
      confirm = true;
    } else if (token === '--project') {
      const pid = requireCliValue(tokens[i + 1], '--project', '<projectId>');
      if (pid.includes('/') || /\s/.test(pid)) {
        throw new Error(
          `Invalid <projectId> "${pid}" for "--project": must not contain "/" or whitespace.`
        );
      }
      projectId = pid;
      i++;
    } else {
      throw new Error(`Unknown or unexpected CLI argument: "${token}".`);
    }
  }

  if (!filePath) {
    throw new Error(
      'Missing required "--file <path>" argument specifying the WhatsApp participant list.'
    );
  }

  return {
    command: 'reconcile',
    filePath,
    optInMatched,
    dryRun,
    confirm,
    projectId,
  };
}

function cleanParticipantName(raw: string): string | undefined {
  const cleaned = raw
    .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069\u00a0]/g, ' ')
    .replace(/^~+\s*/, '')
    .replace(/^["']+|["']+$/g, '')
    .trim();

  if (!cleaned) return undefined;
  const lower = cleaned.toLowerCase();
  if (
    lower === 'you' ||
    lower === 'group admin' ||
    lower === 'admin' ||
    lower === 'phone' ||
    lower === 'name' ||
    lower === 'participant' ||
    lower === 'participants'
  ) {
    return undefined;
  }
  return cleaned;
}

export function parseWhatsAppParticipantsText(
  rawText: string
): ParsedWhatsAppParticipant[] {
  const results: ParsedWhatsAppParticipant[] = [];
  const seenPhones = new Set<string>();
  const seenNamesOnly = new Set<string>();

  const addParticipant = (
    rawEntry: string,
    rawPhone?: string,
    rawName?: string
  ) => {
    const normalizedPhone = normalizeUkPhoneNumber(rawPhone);
    const displayName = rawName ? cleanParticipantName(rawName) : undefined;

    if (normalizedPhone) {
      if (seenPhones.has(normalizedPhone)) return;
      seenPhones.add(normalizedPhone);
      results.push({
        rawEntry: rawEntry.trim(),
        normalizedPhone,
        phoneHash: sha256Hex(normalizedPhone),
        displayName,
      });
      return;
    }

    if (displayName) {
      const nameKey = displayName.toLowerCase();
      if (seenNamesOnly.has(nameKey)) return;
      seenNamesOnly.add(nameKey);
      results.push({
        rawEntry: rawEntry.trim(),
        displayName,
      });
    }
  };

  if (/BEGIN:VCARD/i.test(rawText)) {
    const blocks = rawText.split(/BEGIN:VCARD/i).slice(1);
    for (const block of blocks) {
      const endIdx = block.search(/END:VCARD/i);
      const body = endIdx >= 0 ? block.slice(0, endIdx) : block;
      const fnMatch = body.match(/^\s*FN(?:;[^:]*)?:(.+)$/im);
      const telMatches = Array.from(
        body.matchAll(/^\s*TEL(?:;[^:]*)?:(.+)$/gim)
      );
      const fn = fnMatch ? fnMatch[1].trim() : undefined;
      if (telMatches.length > 0) {
        for (const tm of telMatches) {
          addParticipant(tm[1].trim(), tm[1].trim(), fn);
        }
      } else if (fn) {
        addParticipant(fn, undefined, fn);
      }
    }
    return results;
  }

  const lines = rawText.split(/\r?\n/);

  const chatSenders: string[] = [];
  const chatRegexBracket =
    /^\[?\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4},\s+\d{1,2}:\d{2}(?::\d{2})?(?:\s*[APMapm]{2})?\]?\s*(?:-\s*)?([^:]+):\s+/;
  for (const line of lines) {
    const cleanedLine = line.replace(
      /[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g,
      ''
    );
    const match = cleanedLine.match(chatRegexBracket);
    if (match) {
      chatSenders.push(match[1].trim());
    }
  }
  if (chatSenders.length > 0) {
    for (const sender of chatSenders) {
      const maybePhone = normalizeUkPhoneNumber(sender);
      if (maybePhone) {
        addParticipant(sender, sender, undefined);
      } else {
        addParticipant(sender, undefined, sender);
      }
    }
    return results;
  }

  const phoneRegex = /(?:\+|00)?\d[\d\s\-().]{6,18}\d/g;
  for (const rawLine of lines) {
    const line = rawLine
      .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069\u00a0]/g, ' ')
      .trim();
    if (!line || line.startsWith('#')) continue;

    const phoneMatches = Array.from(line.matchAll(phoneRegex));
    if (phoneMatches.length > 0) {
      if (phoneMatches.length === 1) {
        const matchedPhoneStr = phoneMatches[0][0];
        const remainder = line
          .replace(matchedPhoneStr, '')
          .replace(/[,;\t|()-]/g, ' ')
          .trim();
        addParticipant(line, matchedPhoneStr, remainder || undefined);
      } else {
        for (const pm of phoneMatches) {
          addParticipant(pm[0], pm[0], undefined);
        }
      }
      continue;
    }

    const tokens = line.includes(',') ? line.split(',') : [line];
    for (const token of tokens) {
      const maybePhone = normalizeUkPhoneNumber(token);
      if (maybePhone) {
        addParticipant(token, token, undefined);
      } else {
        addParticipant(token, undefined, token);
      }
    }
  }

  return results;
}

export function buildWhatsAppReconciliationPlan(params: {
  participants: ParsedWhatsAppParticipant[];
  volunteers: Volunteer[];
  optInMatched?: boolean;
  now?: number;
}): WhatsAppReconciliationPlan {
  const {
    participants,
    volunteers,
    optInMatched = false,
    now = Date.now(),
  } = params;

  const activeVolunteers = volunteers.filter((v) => !v.archived);
  const archivedVolunteers = volunteers.filter((v) => Boolean(v.archived));

  const activeByPhone = new Map<string, Volunteer>();
  const activeByName = new Map<string, Volunteer>();
  for (const v of activeVolunteers) {
    const normPhone = normalizeUkPhoneNumber(v.phone);
    if (normPhone) {
      activeByPhone.set(normPhone, v);
    }
    const nameKey = v.name.trim().toLowerCase();
    if (nameKey) {
      activeByName.set(nameKey, v);
    }
  }

  const archivedByPhoneHash = new Map<string, Volunteer>();
  const archivedByName = new Map<string, Volunteer>();
  for (const v of archivedVolunteers) {
    const hash = v.phoneHash || hashNormalizedPhone(v.phone);
    if (hash) {
      archivedByPhoneHash.set(hash, v);
    }
    const nameKey = v.name.trim().toLowerCase();
    if (nameKey) {
      archivedByName.set(nameKey, v);
    }
  }

  const matchedActiveIds = new Set<string>();
  const matchedArchivedMembers: WhatsAppReconciliationPlan['matchedArchivedMembers'] =
    [];
  const unrecognisedGroupMembers: ParsedWhatsAppParticipant[] = [];

  for (const p of participants) {
    const activeMatch =
      (p.normalizedPhone ? activeByPhone.get(p.normalizedPhone) : undefined) ||
      (p.displayName
        ? activeByName.get(p.displayName.trim().toLowerCase())
        : undefined);

    if (activeMatch) {
      matchedActiveIds.add(activeMatch.id);
      continue;
    }

    const archivedMatch =
      (p.phoneHash ? archivedByPhoneHash.get(p.phoneHash) : undefined) ||
      (p.displayName
        ? archivedByName.get(p.displayName.trim().toLowerCase())
        : undefined);

    if (archivedMatch) {
      matchedArchivedMembers.push({
        participant: p,
        volunteer: archivedMatch,
      });
      continue;
    }

    unrecognisedGroupMembers.push(p);
  }

  const alreadyInSync: Volunteer[] = [];
  const pendingAdditionsConfirmed: Volunteer[] = [];
  const newlyOptedInMatches: Volunteer[] = [];
  const missingFromGroup: Volunteer[] = [];
  const optedOutStillInGroup: Volunteer[] = [];
  const firestoreUpdates: Volunteer[] = [];

  for (const v of activeVolunteers) {
    const inGroup = matchedActiveIds.has(v.id);
    const isOptedIn = Boolean(v.whatsappOptIn);
    const currentStatus: WhatsAppSyncStatus =
      v.whatsappStatus || (isOptedIn ? 'PENDING_ADD' : 'NOT_APPLICABLE');

    if (inGroup) {
      if (isOptedIn) {
        if (currentStatus === 'ADDED') {
          alreadyInSync.push(v);
        } else {
          const updated: Volunteer = removeUndefined({
            ...v,
            whatsappOptIn: true,
            whatsappStatus: 'ADDED',
            updatedAt: now,
          });
          pendingAdditionsConfirmed.push(updated);
          firestoreUpdates.push(updated);
        }
      } else if (optInMatched && currentStatus !== 'PENDING_REMOVAL') {
        const updated: Volunteer = removeUndefined({
          ...v,
          whatsappOptIn: true,
          whatsappStatus: 'ADDED',
          updatedAt: now,
        });
        newlyOptedInMatches.push(updated);
        firestoreUpdates.push(updated);
      } else {
        optedOutStillInGroup.push(v);
      }
    } else if (isOptedIn) {
      if (currentStatus === 'ADDED') {
        const updated: Volunteer = removeUndefined({
          ...v,
          whatsappOptIn: true,
          whatsappStatus: 'PENDING_ADD',
          updatedAt: now,
        });
        missingFromGroup.push(updated);
        firestoreUpdates.push(updated);
      } else {
        missingFromGroup.push(v);
      }
    }
  }

  return {
    unrecognisedGroupMembers,
    matchedArchivedMembers,
    alreadyInSync,
    pendingAdditionsConfirmed,
    newlyOptedInMatches,
    missingFromGroup,
    optedOutStillInGroup,
    firestoreUpdates,
  };
}
