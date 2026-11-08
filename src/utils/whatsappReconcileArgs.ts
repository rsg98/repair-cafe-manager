/**
 * @file src/utils/whatsappReconcileArgs.ts
 *
 * Pure CLI argument parser, WhatsApp participant list parser (supporting plain text,
 * CSV, copied WhatsApp Web participant strings, vCard .vcf, and WhatsApp _chat.txt exports),
 * and reconciliation plan builder for `npm run whatsapp-reconcile` (Issue #43).
 */

import type { Volunteer, WhatsAppSyncStatus } from '../types';
import {
  normalizeUkPhoneNumber,
  sha256Hex,
  hashNormalizedPhone,
} from '../services/volunteerService';
import { removeUndefined } from './historicalIngestParser';

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
  /** Group members who do NOT match any active or archived volunteer record. */
  unrecognisedGroupMembers: ParsedWhatsAppParticipant[];
  /** Archived volunteers matched in the group (e.g. remaining socially; not flagged as unknown). */
  matchedArchivedMembers: Array<{
    participant: ParsedWhatsAppParticipant;
    volunteer: Volunteer;
  }>;
  /** Opted-in active volunteers already marked ADDED and confirmed in the group. */
  alreadyInSync: Volunteer[];
  /** Opted-in active volunteers (PENDING_ADD) found in the group -> updated to ADDED. */
  pendingAdditionsConfirmed: Volunteer[];
  /** Unmigrated/opted-out active volunteers found in the group and opted-in via `--opt-in-matched`. */
  newlyOptedInMatches: Volunteer[];
  /** Opted-in active volunteers missing from the WhatsApp group (ADDED records reset to PENDING_ADD). */
  missingFromGroup: Volunteer[];
  /** Active volunteers who have NOT opted in (or are PENDING_REMOVAL) but are still in the group. */
  optedOutStillInGroup: Volunteer[];
  /** Exact Volunteer documents to write to Firestore when `--confirm` is passed. */
  firestoreUpdates: Volunteer[];
}

/**
 * Validates that a required CLI flag value is present and not another flag.
 */
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

/**
 * Parses CLI arguments for the `whatsapp-reconcile` administrative utility.
 */
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

/**
 * Cleans a raw display name token from WhatsApp Web or chat exports
 * (stripping leading `~`, quotes, and role labels).
 */
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

/**
 * Parses a raw WhatsApp participant export string into deduplicated {@link ParsedWhatsAppParticipant} items.
 * Supports:
 * 1. vCard (`.vcf`) contact files (`BEGIN:VCARD ... END:VCARD`)
 * 2. WhatsApp exported chat logs (`[DD/MM/YYYY, HH:MM:SS] Sender: message` or `DD/MM/YYYY, HH:MM - Sender: message`)
 * 3. Plain-text / CSV / copied WhatsApp Web group participant lists
 */
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

  // 1. Handle vCard (.vcf) format if present
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

  // 2. Detect WhatsApp Chat Export lines (`[12/10/2026, 09:15:00] Sender: Message` or `12/10/2026, 09:15 - Sender: Message`)
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

  // 3. Plain-text, CSV, or copied WhatsApp Web header / participant list
  const phoneRegex = /(?:\+|00)?\d[\d\s\-().]{6,18}\d/g;
  for (const rawLine of lines) {
    const line = rawLine
      .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069\u00a0]/g, ' ')
      .trim();
    if (!line || line.startsWith('#')) continue;

    // Extract any phone numbers on the line first
    const phoneMatches = Array.from(line.matchAll(phoneRegex));
    if (phoneMatches.length > 0) {
      // If a line has a single phone number and a name (e.g. "Alice Smith, 07700 900123"), capture the name too
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

    // No phone number on this line: split by comma if it looks like a comma-separated participant header
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

/**
 * Reconciles a parsed list of WhatsApp group participants against the Firestore `volunteers`
 * collection, respecting archived social members via `phoneHash` and computing any required updates.
 */
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

  // Build lookup indexes for active and archived volunteers
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
    // 1. Try matching an active volunteer by normalised phone or display name
    const activeMatch =
      (p.normalizedPhone ? activeByPhone.get(p.normalizedPhone) : undefined) ||
      (p.displayName
        ? activeByName.get(p.displayName.trim().toLowerCase())
        : undefined);

    if (activeMatch) {
      matchedActiveIds.add(activeMatch.id);
      continue;
    }

    // 2. Try matching an archived volunteer by SHA-256 phoneHash or shortened/full name
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

    // 3. Neither active nor archived volunteer record exists for this group participant
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
          // Was PENDING_ADD (or other status) and is now confirmed in the WhatsApp group
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
        // Initial setup mode (`--opt-in-matched`): opt in matched active volunteer
        const updated: Volunteer = removeUndefined({
          ...v,
          whatsappOptIn: true,
          whatsappStatus: 'ADDED',
          updatedAt: now,
        });
        newlyOptedInMatches.push(updated);
        firestoreUpdates.push(updated);
      } else {
        // Volunteer has not opted in (or is PENDING_REMOVAL) but is still in the group
        optedOutStillInGroup.push(v);
      }
    } else if (isOptedIn) {
      // Volunteer opted into WhatsApp but is NOT in the WhatsApp group export
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
