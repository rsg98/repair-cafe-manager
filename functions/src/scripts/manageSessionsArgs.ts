/**
 * @file functions/src/scripts/manageSessionsArgs.ts
 *
 * Pure CLI argument parser for the `manage-sessions` administration utility.
 * Validates commands (`--list`, `--mark-test`, `--unmark-test`, `--purge`,
 * `--purge-all-test`, `--help`), session IDs, project IDs, and safety flags.
 */

/** Supported primary commands for the `manage-sessions` CLI utility. */
export type ManageSessionsCommand =
  | 'list'
  | 'mark-test'
  | 'unmark-test'
  | 'purge'
  | 'purge-all-test'
  | 'help';

/** Parsed options structure returned by {@link parseManageSessionsArgs}. */
export interface ManageSessionsCliOptions {
  command: ManageSessionsCommand;
  sessionId?: string;
  dryRun: boolean;
  confirm: boolean;
  force: boolean;
  projectId?: string;
}

/**
 * Validates that a required CLI value (such as `<sessionId>` or `<projectId>`)
 * is non-empty, not another flag, and free of path separators or whitespace.
 */
export function validateCliSessionId(
  value: string | undefined,
  flagName: string,
  placeholder = '<sessionId>'
): string {
  // Reject missing or flag-prefixed values immediately with the specific placeholder name
  if (!value || !value.trim() || value.trim().startsWith('-')) {
    throw new Error(`Missing required ${placeholder} argument after "${flagName}".`);
  }
  const trimmed = value.trim();
  // Reject path separators or whitespace to prevent malformed Firestore document paths
  if (trimmed.includes('/') || /\s/.test(trimmed)) {
    throw new Error(`Invalid ${placeholder} "${trimmed}" for "${flagName}": must not contain "/" or whitespace.`);
  }
  return trimmed;
}

/**
 * Normalizes a CLI token to a canonical `ManageSessionsCommand` if it matches
 * a supported command flag or subcommand name.
 */
function matchCommandToken(token: string): ManageSessionsCommand | null {
  // Map both "--flag" and positional subcommand forms to canonical command names
  switch (token) {
    case '--list':
    case 'list':
      return 'list';
    case '--mark-test':
    case 'mark-test':
      return 'mark-test';
    case '--unmark-test':
    case 'unmark-test':
      return 'unmark-test';
    // Map purge, purge-all-test, and help command tokens
    case '--purge':
    case 'purge':
      return 'purge';
    case '--purge-all-test':
    case 'purge-all-test':
      return 'purge-all-test';
    case '--help':
    case '-h':
    case 'help':
      return 'help';
    default:
      return null;
  }
}

/**
 * Parses CLI arguments (excluding `node` and script path) into a strongly-typed
 * {@link ManageSessionsCliOptions} object.
 */
export function parseManageSessionsArgs(argv: string[]): ManageSessionsCliOptions {
  // Normalize tokens and default empty invocations to the help command
  const tokens = argv.map((arg) => arg.trim()).filter((arg) => arg.length > 0);
  if (tokens.length === 0) {
    return { command: 'help', dryRun: false, confirm: false, force: false };
  }

  // Track parsed state across token iteration
  let command: ManageSessionsCommand | null = null;
  let sessionId: string | undefined;
  let projectId: string | undefined;
  let dryRun = false;
  let confirm = false;
  let force = false;

  // Iterate through tokens and consume value arguments where required
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const matchedCmd = matchCommandToken(token);

    // Handle primary command tokens and guard against duplicate or conflicting commands
    if (matchedCmd) {
      if (command !== null) {
        throw new Error(`Conflicting commands: cannot combine "${command}" and "${matchedCmd}".`);
      }
      command = matchedCmd;
      // Consume required <sessionId> argument for session-targeted commands
      if (matchedCmd === 'mark-test' || matchedCmd === 'unmark-test' || matchedCmd === 'purge') {
        sessionId = validateCliSessionId(tokens[i + 1], token, '<sessionId>');
        i++;
      }
      continue;
    }

    // Handle modifier flags (--dry-run, --confirm, --force, --project)
    if (token === '--dry-run') {
      dryRun = true;
    } else if (token === '--confirm') {
      confirm = true;
    } else if (token === '--force') {
      force = true;
    } else if (token === '--project') {
      projectId = validateCliSessionId(tokens[i + 1], '--project', '<projectId>');
      i++;
    } else {
      throw new Error(`Unknown or unexpected CLI argument: "${token}".`);
    }
  }

  // Require at least one primary command to have been specified
  if (!command) {
    throw new Error('No command specified. Expected --list, --mark-test, --unmark-test, --purge, or --purge-all-test.');
  }

  // Return the validated options structure
  return { command, sessionId, dryRun, confirm, force, projectId };
}
