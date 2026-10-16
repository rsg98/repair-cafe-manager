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

/**
 * Determines whether a volunteer station (PAT Station or Fixer Station) is unlocked
 * without requiring the 4-digit session PIN.
 *
 * A station is considered unlocked if:
 * 1. Auth state is currently loading (prevents flashing the PIN modal before Google Auth resolves), OR
 * 2. The user is already authenticated with a Google account as an authorized organiser (`isAdmin`), OR
 * 3. There is an active session and the 4-digit volunteer PIN has been verified (`isPinUnlocked`).
 */
export function isStationUnlocked(params: {
  hasActiveSession: boolean;
  isPinUnlocked: boolean;
  isAdmin: boolean;
  authLoading?: boolean;
}): boolean {
  // Hold the PIN modal closed while Firebase Auth / organiser settings are resolving
  if (params.authLoading) {
    return true;
  }

  // Authenticated organisers bypass the volunteer PIN gate directly
  if (params.isAdmin) {
    return true;
  }

  // Standard volunteer tablets require an active session and a verified session PIN
  return params.hasActiveSession && params.isPinUnlocked;
}

/**
 * Extracts the Firebase Auth error code from an unknown caught error value.
 */
function getFirebaseAuthErrorCode(error: unknown): string | null {
  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    typeof (error as { code: unknown }).code === 'string'
  ) {
    return (error as { code: string }).code;
  }
  return null;
}

/**
 * Determines whether a failed `signInWithPopup` attempt should automatically fall back
 * to `signInWithRedirect` (e.g. when a browser blocks popups or restricts popup opener access).
 */
export function shouldFallbackToRedirect(error: unknown): boolean {
  const code = getFirebaseAuthErrorCode(error);
  return (
    code === 'auth/popup-blocked' ||
    code === 'auth/operation-not-supported-in-this-environment'
  );
}

/**
 * Determines whether a `signInWithPopup` error is a benign user/duplicate-popup cancellation
 * that should be ignored rather than surfaced as an unhandled failure.
 */
export function isBenignPopupCancel(error: unknown): boolean {
  const code = getFirebaseAuthErrorCode(error);
  return (
    code === 'auth/popup-closed-by-user' ||
    code === 'auth/cancelled-popup-request'
  );
}

/**
 * Distinct authentication states displayed in the top application banner.
 */
export type AuthBannerRole =
  | 'ORGANIZER'
  | 'VOLUNTEER'
  | 'NON_ORGANIZER'
  | 'UNAUTHENTICATED';

/**
 * Resolved role and display text for the top application banner.
 */
export interface AuthBannerState {
  role: AuthBannerRole;
  label: string;
}

/**
 * Determines whether a Firebase Auth user represents a PIN-authenticated volunteer
 * (signed in via custom token with a `volunteer-*` UID and no email address).
 */
export function isPinVolunteerUser(
  user: { uid?: string; email?: string | null } | null | undefined
): boolean {
  if (!user) {
    return false;
  }
  // Custom tokens minted by verifyVolunteerPin have uid `volunteer-${sessionId}` and no email
  return !user.email || Boolean(user.uid && user.uid.startsWith('volunteer-'));
}

/**
 * Computes the header banner authentication role and display label.
 *
 * Distinguishes between the two primary authenticated states:
 * - `ORGANIZER`: Authenticated via an authorized Google Account (`isAdmin === true`)
 * - `VOLUNTEER`: Authenticated via the 4-digit session PIN (custom token or local PIN unlock)
 * Plus fallback states for unauthorized Google accounts (`NON_ORGANIZER`) and signed-out users (`UNAUTHENTICATED`).
 */
export function getAuthBannerState(params: {
  user: { uid?: string; email?: string | null; displayName?: string | null } | null | undefined;
  isAdmin: boolean;
  isPinUnlocked?: boolean;
}): AuthBannerState {
  const { user, isAdmin, isPinUnlocked = false } = params;

  // 1. Authorized Google Account organiser
  if (isAdmin && user) {
    return {
      role: 'ORGANIZER',
      label: user.displayName || user.email || 'Organizer',
    };
  }

  // 2. PIN-authenticated volunteer (via Firebase Custom Token or offline session PIN unlock)
  if (isPinVolunteerUser(user) || isPinUnlocked) {
    return {
      role: 'VOLUNTEER',
      label: 'Volunteer',
    };
  }

  // 3. Google Account that is not in the authorized organiser list
  if (user && user.email) {
    return {
      role: 'NON_ORGANIZER',
      label: `${user.displayName || user.email} (Non-Organizer)`,
    };
  }

  // 4. Unauthenticated visitor / station
  return {
    role: 'UNAUTHENTICATED',
    label: '',
  };
}


