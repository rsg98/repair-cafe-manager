/**
 * @file functions/src/scripts/mergeVolunteersArgs.ts
 *
 * Pure CLI argument parser, volunteer lookup resolver, token-safe name rewriter,
 * and merge plan builder for the `mergeVolunteers` administrative utility.
 *
 * NOTE: Imports types and `removeUndefined` from `./historicalIngestParser` so
 * `functions/tsconfig.json` compiles `functions/src` cleanly without crossing the
 * root `src/` directory boundary.
 */

import {
  removeUndefined,
  type RepairItem,
  type Session,
  type SessionAnalytics,
  type SessionVolunteerSummary,
  type Volunteer,
} from './historicalIngestParser';

/** Supported subcommands for the `merge-volunteers` CLI. */
export type MergeVolunteersCommand = 'list' | 'merge' | 'help';

/** Parsed CLI flags for the `merge-volunteers` script. */
export interface MergeVolunteersCliOptions {
  command: MergeVolunteersCommand;
  from?: string;
  into?: string;
  dryRun: boolean;
  confirm: boolean;
  projectId?: string;
}

/** Deterministic set of Firestore document updates computed for a volunteer merge. */
export interface VolunteerMergePlan {
  updatedTarget: Volunteer;
  deletedSourceId: string;
  updatedSessions: Array<{
    sessionId: string;
    attendingVolunteerIds: string[];
    attendingVolunteers: SessionVolunteerSummary[];
  }>;
  updatedAnalytics: Array<{
    sessionId: string;
    volunteerCount: number;
  }>;
  updatedRepairs: Array<{
    sessionId: string;
    repairId: string;
    updates: {
      'repair.fixerName'?: string;
      'patInitial.testerName'?: string;
      'patFinal.testerName'?: string;
    };
  }>;
}

/**
 * Validates that a required CLI flag value is present and not another flag.
 */
function requireCliValue(
  value: string | undefined,
  flagName: string,
  placeholder: string
): string {
  // Reject missing or flag-prefixed values with a descriptive error
  if (!value || !value.trim() || value.trim().startsWith('-')) {
    throw new Error(`Missing required ${placeholder} argument after "${flagName}".`);
  }
  return value.trim();
}

/**
 * Parses CLI arguments for the `mergeVolunteers` administrative utility.
 */
export function parseMergeVolunteersArgs(argv: string[]): MergeVolunteersCliOptions {
  // Trim tokens and default empty invocations to help
  const tokens = argv.map((arg) => arg.trim()).filter((arg) => arg.length > 0);
  if (tokens.length === 0) {
    return {
      command: 'help',
      dryRun: false,
      confirm: false,
    };
  }

  let isList = false;
  let from: string | undefined;
  let into: string | undefined;
  let dryRun = false;
  let confirm = false;
  let projectId: string | undefined;

  // Step through CLI tokens
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === '--help' || token === '-h' || token === 'help') {
      return {
        command: 'help',
        dryRun: false,
        confirm: false,
      };
    } else if (token === '--list') {
      isList = true;
    } else if (token === '--from') {
      from = requireCliValue(tokens[i + 1], '--from', '<sourceIdOrName>');
      i++;
    } else if (token === '--into') {
      into = requireCliValue(tokens[i + 1], '--into', '<targetIdOrName>');
      i++;
    } else if (token === '--project') {
      const pid = requireCliValue(tokens[i + 1], '--project', '<projectId>');
      if (pid.includes('/') || /\s/.test(pid)) {
        throw new Error(
          `Invalid <projectId> "${pid}" for "--project": must not contain "/" or whitespace.`
        );
      }
      projectId = pid;
      i++;
    } else if (token === '--dry-run') {
      dryRun = true;
    } else if (token === '--confirm') {
      confirm = true;
    } else {
      throw new Error(`Unknown or unexpected CLI argument: "${token}".`);
    }
  }

  // Validate mutually exclusive modes and required --from / --into pair
  if (isList && (from || into)) {
    throw new Error('Cannot combine "--list" with "--from" or "--into".');
  }
  if (isList) {
    return {
      command: 'list',
      dryRun,
      confirm,
      projectId,
    };
  }
  if (!from || !into) {
    throw new Error(
      'Both "--from <sourceIdOrName>" and "--into <targetIdOrName>" are required when merging volunteers.'
    );
  }

  return {
    command: 'merge',
    from,
    into,
    dryRun,
    confirm,
    projectId,
  };
}

/**
 * Resolves a volunteer by exact Firestore document ID first, then by
 * case-insensitive trimmed display name. Throws if no match or if multiple
 * records share the same display name.
 */
export function findVolunteerByIdOrName(
  query: string,
  volunteers: Volunteer[]
): Volunteer {
  const trimmed = (query || '').trim();
  if (!trimmed) {
    throw new Error('Volunteer lookup query must not be empty.');
  }

  // 1. Exact ID match
  const exactId = volunteers.find((v) => v.id === trimmed);
  if (exactId) {
    return exactId;
  }

  // 2. Case-insensitive trimmed display name match
  const lower = trimmed.toLowerCase();
  const nameMatches = volunteers.filter((v) => v.name.trim().toLowerCase() === lower);
  if (nameMatches.length === 1) {
    return nameMatches[0];
  }
  if (nameMatches.length > 1) {
    const ids = nameMatches.map((v) => v.id).join(', ');
    throw new Error(
      `Ambiguous volunteer name "${trimmed}" matches multiple records (${ids}). Please specify the exact volunteer ID.`
    );
  }

  throw new Error(`Volunteer not found for "${trimmed}". Run with --list to view all volunteers.`);
}

/**
 * Rewrites a repairer or PAT tester credit string by splitting on compound
 * separators (`&`, `/`, `,`, `and`), replacing any token matching `sourceName`
 * (case-insensitively) with `targetName`, deduplicating tokens case-insensitively
 * while preserving order, and rejoining with `' & '`.
 *
 * Returns `undefined` when `rawField` does not reference `sourceName` or is unchanged.
 */
export function rewriteVolunteerNameInField(
  rawField: string | undefined,
  sourceName: string,
  targetName: string
): string | undefined {
  const trimmedField = (rawField || '').trim();
  const trimmedSource = (sourceName || '').trim();
  const trimmedTarget = (targetName || '').trim();
  if (!trimmedField || !trimmedSource || !trimmedTarget) {
    return undefined;
  }

  const sourceLower = trimmedSource.toLowerCase();
  const tokens = trimmedField
    .split(/\s*(?:&|\/|,|\band\b)\s*/i)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);

  let matchedSource = false;
  const replacedTokens = tokens.map((token) => {
    if (token.toLowerCase() === sourceLower) {
      matchedSource = true;
      return trimmedTarget;
    }
    return token;
  });

  if (!matchedSource) {
    return undefined;
  }

  // Deduplicate tokens case-insensitively while preserving order
  const deduped: string[] = [];
  const seenLower = new Set<string>();
  for (const token of replacedTokens) {
    const lower = token.toLowerCase();
    if (!seenLower.has(lower)) {
      seenLower.add(lower);
      deduped.push(token);
    }
  }

  const rewritten = deduped.join(' & ');
  return rewritten === trimmedField ? undefined : rewritten;
}

/**
 * Builds a complete, deterministic {@link VolunteerMergePlan} to consolidate
 * `source` into `target` across `volunteers`, `sessions`, `analytics`, and `repairs`.
 */
export function buildVolunteerMergePlan(params: {
  source: Volunteer;
  target: Volunteer;
  sessions: Session[];
  analytics: SessionAnalytics[];
  repairsBySession: Record<string, RepairItem[]>;
  now?: number;
}): VolunteerMergePlan {
  const {
    source,
    target,
    sessions,
    analytics,
    repairsBySession,
    now = Date.now(),
  } = params;

  if (source.id === target.id) {
    throw new Error(
      `Cannot merge a volunteer into itself (both --from and --into resolved to "${target.id}").`
    );
  }

  // Consolidate fields onto target, preferring real emergency contacts over historical placeholders
  const targetEmergencyPending = target.emergencyContactName
    .trim()
    .toLowerCase()
    .startsWith('pending');
  const sourceEmergencyPending = source.emergencyContactName
    .trim()
    .toLowerCase()
    .startsWith('pending');
  const useSourceEmergency = targetEmergencyPending && !sourceEmergencyPending;

  const consolidatedEmail = target.email?.trim() || source.email?.trim() || undefined;
  const consolidatedPhone = target.phone?.trim() || source.phone?.trim() || undefined;
  const consolidatedRelationship =
    target.emergencyContactRelationship?.trim() ||
    source.emergencyContactRelationship?.trim() ||
    undefined;

  const updatedTarget: Volunteer = removeUndefined({
    ...target,
    name: target.name.trim(),
    phone: consolidatedPhone,
    email: consolidatedEmail,
    emergencyContactName: useSourceEmergency
      ? source.emergencyContactName.trim()
      : target.emergencyContactName.trim(),
    emergencyContactPhone: useSourceEmergency
      ? source.emergencyContactPhone.trim()
      : target.emergencyContactPhone.trim(),
    emergencyContactRelationship: consolidatedRelationship,
    isOrganiser: Boolean((target.isOrganiser || source.isOrganiser) && consolidatedEmail),
    isPatTrained: Boolean(target.isPatTrained || source.isPatTrained),
    inducted: Boolean(target.inducted || source.inducted),
    inductedAt: target.inductedAt ?? source.inductedAt,
    inductedBy: target.inductedBy || source.inductedBy,
    updatedAt: now,
  });

  const targetSummary: SessionVolunteerSummary = {
    id: updatedTarget.id,
    name: updatedTarget.name,
    isOrganiser: updatedTarget.isOrganiser,
    isPatTrained: updatedTarget.isPatTrained,
    inducted: updatedTarget.inducted,
  };

  const analyticsBySessionId = new Map<string, SessionAnalytics>();
  for (const a of analytics) {
    analyticsBySessionId.set(a.sessionId, a);
  }

  const updatedSessions: VolunteerMergePlan['updatedSessions'] = [];
  const updatedAnalytics: VolunteerMergePlan['updatedAnalytics'] = [];
  const sourceNameLower = source.name.trim().toLowerCase();

  // Inspect each session for references to source (or target when source is merged)
  for (const session of sessions) {
    const ids = session.attendingVolunteerIds || [];
    const summaries = session.attendingVolunteers || [];

    const hasSourceId = ids.includes(source.id);
    const hasSourceSummary = summaries.some(
      (s) => s.id === source.id || s.name.trim().toLowerCase() === sourceNameLower
    );

    if (!hasSourceId && !hasSourceSummary) {
      continue;
    }

    // Rebuild attendingVolunteers replacing source with targetSummary and deduplicating by id
    const byId = new Map<string, SessionVolunteerSummary>();
    for (const s of summaries) {
      if (s.id === source.id || s.name.trim().toLowerCase() === sourceNameLower) {
        byId.set(targetSummary.id, targetSummary);
      } else if (s.id === targetSummary.id) {
        byId.set(targetSummary.id, targetSummary);
      } else {
        byId.set(s.id, s);
      }
    }
    if (!byId.has(targetSummary.id)) {
      byId.set(targetSummary.id, targetSummary);
    }

    // Preserve any extra IDs from attendingVolunteerIds that were not in attendingVolunteers
    const mergedSummaries = Array.from(byId.values()).sort((a, b) =>
      a.name.localeCompare(b.name)
    );
    const mergedIdsSet = new Set<string>(mergedSummaries.map((s) => s.id));
    for (const id of ids) {
      if (id !== source.id && !mergedIdsSet.has(id)) {
        mergedIdsSet.add(id);
      }
    }
    const mergedIds = Array.from(mergedIdsSet);

    updatedSessions.push({
      sessionId: session.id,
      attendingVolunteerIds: mergedIds,
      attendingVolunteers: mergedSummaries,
    });

    const newVolunteerCount = mergedSummaries.length;
    const existingAnalytics = analyticsBySessionId.get(session.id);
    if (existingAnalytics && existingAnalytics.volunteerCount !== newVolunteerCount) {
      updatedAnalytics.push({
        sessionId: session.id,
        volunteerCount: newVolunteerCount,
      });
    }
  }

  // Rewrite fixerName and testerName across all session repair items
  const updatedRepairs: VolunteerMergePlan['updatedRepairs'] = [];
  for (const [sessionId, items] of Object.entries(repairsBySession)) {
    for (const item of items) {
      const newFixer = rewriteVolunteerNameInField(
        item.repair?.fixerName,
        source.name,
        updatedTarget.name
      );
      const newPatInitial = rewriteVolunteerNameInField(
        item.patInitial?.testerName,
        source.name,
        updatedTarget.name
      );
      const newPatFinal = rewriteVolunteerNameInField(
        item.patFinal?.testerName,
        source.name,
        updatedTarget.name
      );

      if (newFixer || newPatInitial || newPatFinal) {
        const updates: VolunteerMergePlan['updatedRepairs'][number]['updates'] = {};
        if (newFixer) updates['repair.fixerName'] = newFixer;
        if (newPatInitial) updates['patInitial.testerName'] = newPatInitial;
        if (newPatFinal) updates['patFinal.testerName'] = newPatFinal;
        updatedRepairs.push({
          sessionId,
          repairId: item.id,
          updates,
        });
      }
    }
  }

  return {
    updatedTarget,
    deletedSourceId: source.id,
    updatedSessions,
    updatedAnalytics,
    updatedRepairs,
  };
}
