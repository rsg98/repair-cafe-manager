/**
 * Backend configuration for Firebase Cloud Functions.
 */

/**
 * Default authorized organizer email accounts or domain groups.
 * These can be augmented by the ORGANIZER_EMAILS environment variable
 * or dynamically from the settings/system Firestore document (organizerEmails array).
 */
export const defaultOrganizerEmails: string[] = [
  "info@suttonrepaircafe.org.uk",
  "@suttonrepaircafe.org.uk"
];
