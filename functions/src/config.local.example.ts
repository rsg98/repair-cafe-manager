import type { FunctionsUserConfig } from "./config.schema";

/**
 * Optional starter template for local Cloud Functions configuration.
 *
 * Copy to `functions/src/config.local.ts` (gitignored) if you wish to compile
 * initial bootstrap organiser emails into Cloud Functions before `settings/system.organizerEmails`
 * is populated by the Volunteer Register (`isOrganiser` flag).
 * You can alternatively supply `ORGANIZER_EMAILS` as a comma-separated environment variable.
 */
export const functionsUserConfig = {
  organizerEmails: [
    // "organiser@repaircafe.example.org",
  ],
  defaultSessionDurationHours: 3,
} satisfies FunctionsUserConfig;
