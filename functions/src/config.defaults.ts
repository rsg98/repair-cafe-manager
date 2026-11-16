import type { FunctionsDefaultedConfig } from "./config.schema";

/**
 * Default backend configuration values.
 * `organizerEmails` defaults to `[]` (fail-closed) so no deployment-specific
 * addresses are committed to version control.
 */
export const DEFAULT_FUNCTIONS_CONFIG: FunctionsDefaultedConfig = {
  organizerEmails: [],
  defaultSessionDurationHours: 3,
};
