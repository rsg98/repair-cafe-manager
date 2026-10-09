/**
 * Utility functions for organizer authentication and role authorization.
 */

/**
 * Checks whether a given email address matches the authorized organizer list or domain groups.
 *
 * Patterns support:
 * - Exact email match (case-insensitive): "admin@example.com"
 * - Domain wildcard group (case-insensitive): "@example.com" or "example.com"
 *
 * If allowedPatterns is empty, it returns true for any valid email (default open policy).
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

  // If no restrictions are configured, any authenticated email is allowed
  if (!allowedPatterns || allowedPatterns.length === 0) {
    return true;
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
