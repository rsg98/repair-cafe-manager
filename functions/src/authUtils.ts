/**
 * Utility functions for backend organizer authorization.
 */

/**
 * Checks whether a given email address matches the authorized organizer list or domain groups.
 *
 * Patterns support:
 * - Exact email match (case-insensitive): "admin@example.com"
 * - Domain wildcard group (case-insensitive): "@example.com" or "example.com"
 *
 * Fails closed: if `allowedPatterns` is empty, returns `false`.
 *
 * @param email The user's email address from Google Auth.
 * @param allowedPatterns Array of allowed emails or domain groups.
 * @returns boolean True if authorized, false otherwise.
 */
export function isAuthorizedOrganizer(
  email: string | null | undefined,
  allowedPatterns: string[] = []
): boolean {
  if (!email || typeof email !== 'string') {
    return false;
  }

  const normalizedEmail = email.toLowerCase().trim();
  if (!normalizedEmail) {
    return false;
  }

  // Fail closed when no organiser email patterns are configured
  if (!allowedPatterns || allowedPatterns.length === 0) {
    return false;
  }

  return allowedPatterns.some((pattern) => {
    if (!pattern || typeof pattern !== 'string') {
      return false;
    }

    const norm = pattern.toLowerCase().trim();
    if (!norm) {
      return false;
    }

    if (norm.startsWith('@')) {
      return normalizedEmail.endsWith(norm);
    }

    // Also support naked domain format "suttonrepaircafe.org.uk" by prefixing "@"
    if (!norm.includes('@')) {
      return normalizedEmail.endsWith(`@${norm}`);
    }

    return normalizedEmail === norm;
  });
}

/**
 * Resolves the effective organiser email/domain list for Cloud Functions:
 * - Once `dynamicEmails` (`settings/system.organizerEmails`, synced from the Volunteer Register
 *   `isOrganiser` flag) contains at least one entry, it overwrites `bootstrapEmails`.
 * - Before `settings/system.organizerEmails` is populated, falls back to `bootstrapEmails`.
 */
export function resolveEffectiveOrganizerEmails(
  bootstrapEmails: string[] = [],
  dynamicEmails?: string[] | null
): string[] {
  const normalizedDynamic = Array.isArray(dynamicEmails)
    ? Array.from(
        new Set(
          dynamicEmails
            .filter((entry): entry is string => typeof entry === 'string')
            .map((entry) => entry.trim().toLowerCase())
            .filter(Boolean)
        )
      )
    : [];

  if (normalizedDynamic.length > 0) {
    return normalizedDynamic;
  }

  return Array.from(
    new Set(
      bootstrapEmails
        .filter((entry): entry is string => typeof entry === 'string')
        .map((entry) => entry.trim().toLowerCase())
        .filter(Boolean)
    )
  );
}
