/**
 * Schema for Firebase Cloud Functions configuration.
 *
 * Unlike the frontend (`src/config/cafe.local.ts`), all backend properties have safe
 * defaults because `organizerEmails` is only used as a Day-1 bootstrap fallback before
 * `settings/system.organizerEmails` in Firestore is populated by the Volunteer Register
 * (`isOrganiser` flag). If both Firestore and bootstrap config are empty, organiser
 * authorisation fails closed.
 */
export interface FunctionsDefaultedConfig {
  /**
   * Bootstrap organiser email addresses or domain suffixes (e.g. "@suttonrepaircafe.org.uk").
   * Overridden automatically once `settings/system.organizerEmails` is populated from
   * the Volunteer Register (`isOrganiser` flag). Empty lists fail closed.
   */
  organizerEmails: string[];
  /**
   * Default Repair Café session length in hours used when a session document
   * does not explicitly specify `sessionDurationHours` (Issue #42).
   */
  defaultSessionDurationHours: number;
}

export type FunctionsUserConfig = Partial<FunctionsDefaultedConfig>;
export type FunctionsConfig = FunctionsDefaultedConfig;
