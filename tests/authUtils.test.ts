import { describe, it, expect } from 'vitest';
import {
  isAuthorizedOrganizer,
  isStationUnlocked,
  shouldFallbackToRedirect,
  isBenignPopupCancel,
  isPinVolunteerUser,
  getAuthBannerState,
} from '../src/utils/authUtils';

describe('Organizer Authentication & Group Authorization (isAuthorizedOrganizer)', () => {
  const allowedList = [
    'info@suttonrepaircafe.org.uk',
    'admin@example.com',
    'organizer@gmail.com',
    '@suttonrepaircafe.org.uk',
    'volunteers.suttonrepaircafe.org.uk'
  ];

  it('authorizes exact named Google email addresses', () => {
    expect(isAuthorizedOrganizer('info@suttonrepaircafe.org.uk', allowedList)).toBe(true);
    expect(isAuthorizedOrganizer('admin@example.com', allowedList)).toBe(true);
    expect(isAuthorizedOrganizer('organizer@gmail.com', allowedList)).toBe(true);
  });

  it('handles case-insensitivity and whitespace gracefully', () => {
    expect(isAuthorizedOrganizer('  ADMIN@EXAMPLE.COM  ', allowedList)).toBe(true);
    expect(isAuthorizedOrganizer('Organizer@Gmail.Com', allowedList)).toBe(true);
    expect(isAuthorizedOrganizer('INFO@SUTTONREPAIRCAFE.ORG.UK', allowedList)).toBe(true);
  });

  it('authorizes accounts belonging to configured domain groups with @ prefix', () => {
    expect(isAuthorizedOrganizer('sarah@suttonrepaircafe.org.uk', allowedList)).toBe(true);
    expect(isAuthorizedOrganizer('dave.organizer@suttonrepaircafe.org.uk', allowedList)).toBe(true);
  });

  it('authorizes accounts belonging to configured naked domain groups', () => {
    expect(isAuthorizedOrganizer('team@volunteers.suttonrepaircafe.org.uk', allowedList)).toBe(true);
  });

  it('rejects unauthorized Google accounts', () => {
    expect(isAuthorizedOrganizer('random.stranger@gmail.com', allowedList)).toBe(false);
    expect(isAuthorizedOrganizer('hacker@evil.com', allowedList)).toBe(false);
    expect(isAuthorizedOrganizer('fake@otherrepaircafe.org.uk', allowedList)).toBe(false);
  });

  it('rejects partial domain spoofing', () => {
    // Should NOT match if domain is merely a substring but not ending with @domain
    expect(isAuthorizedOrganizer('attacker@notsuttonrepaircafe.org.uk', allowedList)).toBe(false);
  });

  it('permits all authenticated emails when allowed list is empty (default open policy)', () => {
    expect(isAuthorizedOrganizer('anyuser@example.com', [])).toBe(true);
    expect(isAuthorizedOrganizer('anyuser@example.com', undefined)).toBe(true);
  });

  it('rejects null, undefined, or empty email addresses', () => {
    expect(isAuthorizedOrganizer(null, allowedList)).toBe(false);
    expect(isAuthorizedOrganizer(undefined, allowedList)).toBe(false);
    expect(isAuthorizedOrganizer('', allowedList)).toBe(false);
    expect(isAuthorizedOrganizer('   ', allowedList)).toBe(false);
  });
});

describe('Station Unlock Gate for Authenticated Organisers (isStationUnlocked - Issue #17)', () => {
  it('unlocks PAT and Fixer stations automatically when authenticated as a Google organiser (isAdmin)', () => {
    expect(
      isStationUnlocked({
        hasActiveSession: true,
        isPinUnlocked: false,
        isAdmin: true,
        authLoading: false,
      })
    ).toBe(true);

    // Also unlocked for organisers even when no session is currently active
    expect(
      isStationUnlocked({
        hasActiveSession: false,
        isPinUnlocked: false,
        isAdmin: true,
        authLoading: false,
      })
    ).toBe(true);
  });

  it('suppresses the PIN modal while Firebase Auth / organiser status is still loading', () => {
    expect(
      isStationUnlocked({
        hasActiveSession: true,
        isPinUnlocked: false,
        isAdmin: false,
        authLoading: true,
      })
    ).toBe(true);
  });

  it('requires the 4-digit session PIN for non-organiser volunteer stations', () => {
    expect(
      isStationUnlocked({
        hasActiveSession: true,
        isPinUnlocked: false,
        isAdmin: false,
        authLoading: false,
      })
    ).toBe(false);

    expect(
      isStationUnlocked({
        hasActiveSession: true,
        isPinUnlocked: true,
        isAdmin: false,
        authLoading: false,
      })
    ).toBe(true);
  });
});

describe('Google OAuth Popup & Redirect Error Handling (Issue #15)', () => {
  it('identifies popup-blocked and unsupported environment errors for redirect fallback', () => {
    expect(shouldFallbackToRedirect({ code: 'auth/popup-blocked' })).toBe(true);
    expect(
      shouldFallbackToRedirect({ code: 'auth/operation-not-supported-in-this-environment' })
    ).toBe(true);
    expect(shouldFallbackToRedirect({ code: 'auth/internal-error' })).toBe(false);
    expect(shouldFallbackToRedirect(null)).toBe(false);
  });

  it('identifies benign popup cancellation errors so they do not throw unhandled rejections', () => {
    expect(isBenignPopupCancel({ code: 'auth/popup-closed-by-user' })).toBe(true);
    expect(isBenignPopupCancel({ code: 'auth/cancelled-popup-request' })).toBe(true);
    expect(isBenignPopupCancel({ code: 'auth/unauthorized-domain' })).toBe(false);
    expect(isBenignPopupCancel(undefined)).toBe(false);
  });
});

describe('Header Banner Authentication Role & Label (Issue #14)', () => {
  it('detects PIN-authenticated custom token volunteer users', () => {
    expect(isPinVolunteerUser({ uid: 'volunteer-20261016-sutton', email: null })).toBe(true);
    expect(isPinVolunteerUser({ uid: 'google-123', email: 'organizer@example.com' })).toBe(false);
    expect(isPinVolunteerUser(null)).toBe(false);
  });

  it('displays "Volunteer" in the banner when authenticated via PIN custom token or offline PIN', () => {
    // Online PIN custom token user (no email, uid starts with volunteer-)
    expect(
      getAuthBannerState({
        user: { uid: 'volunteer-20261016-sutton', email: null, displayName: null },
        isAdmin: false,
        isPinUnlocked: true,
      })
    ).toEqual({
      role: 'VOLUNTEER',
      label: 'Volunteer',
    });

    // Offline PIN fallback where Firebase user is null but session PIN is unlocked
    expect(
      getAuthBannerState({
        user: null,
        isAdmin: false,
        isPinUnlocked: true,
      })
    ).toEqual({
      role: 'VOLUNTEER',
      label: 'Volunteer',
    });
  });

  it('displays Organizer name or email when authenticated via an authorized Google Account', () => {
    expect(
      getAuthBannerState({
        user: { uid: 'google-1', email: 'info@suttonrepaircafe.org.uk', displayName: 'Sarah Fixer' },
        isAdmin: true,
        isPinUnlocked: false,
      })
    ).toEqual({
      role: 'ORGANIZER',
      label: 'Sarah Fixer',
    });

    expect(
      getAuthBannerState({
        user: { uid: 'google-2', email: 'info@suttonrepaircafe.org.uk', displayName: null },
        isAdmin: true,
        isPinUnlocked: false,
      })
    ).toEqual({
      role: 'ORGANIZER',
      label: 'info@suttonrepaircafe.org.uk',
    });
  });

  it('displays Non-Organizer warning only for unauthorized Google accounts with an email address', () => {
    expect(
      getAuthBannerState({
        user: { uid: 'google-3', email: 'visitor@gmail.com', displayName: 'Visitor' },
        isAdmin: false,
        isPinUnlocked: false,
      })
    ).toEqual({
      role: 'NON_ORGANIZER',
      label: 'Visitor (Non-Organizer)',
    });
  });

  it('returns UNAUTHENTICATED when neither Google Account nor PIN session is active', () => {
    expect(
      getAuthBannerState({
        user: null,
        isAdmin: false,
        isPinUnlocked: false,
      })
    ).toEqual({
      role: 'UNAUTHENTICATED',
      label: '',
    });
  });
});


