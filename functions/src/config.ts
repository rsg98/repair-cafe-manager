/**
 * Backend configuration resolver for Firebase Cloud Functions.
 * Merges optional gitignored `./config.local` over `DEFAULT_FUNCTIONS_CONFIG`.
 */
import { DEFAULT_FUNCTIONS_CONFIG } from "./config.defaults";
import type {
  FunctionsConfig,
  FunctionsDefaultedConfig,
  FunctionsUserConfig,
} from "./config.schema";

export type {
  FunctionsDefaultedConfig,
  FunctionsUserConfig,
  FunctionsConfig,
};
export { DEFAULT_FUNCTIONS_CONFIG };

declare const require: ((id: string) => unknown) | undefined;

/**
 * Merges optional local backend overrides over `DEFAULT_FUNCTIONS_CONFIG`.
 */
export function resolveFunctionsConfig(
  userConfig?: FunctionsUserConfig | null
): FunctionsConfig {
  const raw = userConfig ?? {};
  const rawDuration = raw.defaultSessionDurationHours;

  return {
    organizerEmails: Array.isArray(raw.organizerEmails)
      ? raw.organizerEmails
          .filter((entry): entry is string => typeof entry === "string")
          .map((entry) => entry.trim().toLowerCase())
          .filter(Boolean)
      : [...DEFAULT_FUNCTIONS_CONFIG.organizerEmails],
    defaultSessionDurationHours:
      typeof rawDuration === "number" &&
      Number.isFinite(rawDuration) &&
      rawDuration >= 0.5 &&
      rawDuration <= 24
        ? rawDuration
        : DEFAULT_FUNCTIONS_CONFIG.defaultSessionDurationHours,
  };
}

function loadLocalFunctionsConfig(): FunctionsUserConfig {
  try {
    if (typeof require === "function") {
      const localModuleId = "./config.local";
      const loaded = require(localModuleId) as {
        functionsUserConfig?: FunctionsUserConfig;
      } | null;
      if (loaded && typeof loaded === "object" && loaded.functionsUserConfig) {
        return loaded.functionsUserConfig;
      }
    }
  } catch {
    // Optional gitignored ./config.local not present; use defaults and ORGANIZER_EMAILS env
  }
  return {};
}

export const functionsConfig: FunctionsConfig = resolveFunctionsConfig(
  loadLocalFunctionsConfig()
);

/**
 * Bootstrap organiser email patterns (used only when `settings/system.organizerEmails`
 * has not yet been populated by the Volunteer Register `isOrganiser` flag).
 */
export const defaultOrganizerEmails: string[] = functionsConfig.organizerEmails;

/**
 * Default Repair Café session length in hours used when a session document
 * does not explicitly specify `sessionDurationHours` (Issue #42).
 */
export const defaultSessionDurationHours: number =
  functionsConfig.defaultSessionDurationHours;
