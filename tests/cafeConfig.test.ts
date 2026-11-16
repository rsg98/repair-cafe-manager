import { describe, it, expect } from 'vitest';
import {
  cafeConfig,
  cafeConfigStatus,
  DEFAULT_CAFE_CONFIG,
  resolveCafeConfig,
  validateCafeConfig,
  CafeUserConfig,
} from '../src/config/cafe.config';
import { cafeUserConfig as exampleCafeUserConfig } from '../src/config/cafe.local.example';
import {
  DEFAULT_FUNCTIONS_CONFIG,
  resolveFunctionsConfig,
} from '../functions/src/config';
import {
  isAuthorizedOrganizer as isBackendAuthorizedOrganizer,
  resolveEffectiveOrganizerEmails as resolveBackendEffectiveOrganizerEmails,
} from '../functions/src/authUtils';

describe('Split Café Configuration Schema, Defaults & Validation', () => {
  const minimalValidUserConfig: CafeUserConfig = {
    cafeName: 'Bristol Repair Café',
    venueName: 'St Werburghs Community Centre',
    contactEmail: 'hello@bristolrepaircafe.org.uk',
    organizerEmails: ['founder@bristolrepaircafe.org.uk'],
    hostnameViews: {
      'bristolrepaircafe.web.app': ['register', 'frontdesk', 'pat', 'fixer', 'reports'],
    },
  };

  it('populates sensible operational defaults when optional properties are omitted', () => {
    const resolved = resolveCafeConfig(minimalValidUserConfig);

    expect(resolved.cafeName).toBe('Bristol Repair Café');
    expect(resolved.venueName).toBe('St Werburghs Community Centre');
    expect(resolved.tagline).toBe(DEFAULT_CAFE_CONFIG.tagline);
    expect(resolved.logoUrl).toBe('/logo.svg');
    expect(resolved.websiteUrl).toBe('');
    expect(resolved.defaultCardRange).toEqual({ start: 1, end: 100 });
    expect(resolved.defaultSessionDurationHours).toBe(3);
    expect(resolved.allowMultiItemRegistration).toBe(false);
    expect(resolved.patTesterServiceIntervalMonths).toBe(12);
    expect(resolved.termsVersion).toBe('1.0');
    expect(resolved.termsAndConditions).toBe('/terms.md');
    expect(resolved.excludedItems).toEqual(DEFAULT_CAFE_CONFIG.excludedItems);
    expect(resolved.whatsappGroupInviteUrl).toBeUndefined();

    expect(validateCafeConfig(resolved, { rejectExamplePlaceholders: true })).toEqual([]);
  });

  it('blocks missing or empty mandatory fields including empty organizerEmails (fail-closed)', () => {
    const emptyResolved = resolveCafeConfig({});
    const errors = validateCafeConfig(emptyResolved);

    expect(errors.some((e) => e.includes('`cafeName`'))).toBe(true);
    expect(errors.some((e) => e.includes('`venueName`'))).toBe(true);
    expect(errors.some((e) => e.includes('`contactEmail`'))).toBe(true);
    expect(errors.some((e) => e.includes('`organizerEmails`'))).toBe(true);
    expect(errors.some((e) => e.includes('`hostnameViews`'))).toBe(true);
  });

  it('rejects malformed organizerEmails entries and empty arrays', () => {
    const withEmptyOrganisers = resolveCafeConfig({
      ...minimalValidUserConfig,
      organizerEmails: [],
    });
    expect(validateCafeConfig(withEmptyOrganisers).some((e) => e.includes('`organizerEmails`'))).toBe(
      true
    );

    const withInvalidPattern = resolveCafeConfig({
      ...minimalValidUserConfig,
      organizerEmails: ['not-an-email-or-domain'],
    });
    expect(validateCafeConfig(withInvalidPattern).some((e) => e.includes('`organizerEmails`'))).toBe(
      true
    );
  });

  it('accepts cafe.local.example.ts in test/CI mode but blocks reserved example domains in production mode', () => {
    const resolvedExample = resolveCafeConfig(exampleCafeUserConfig);

    // Valid for CI / unit tests
    expect(validateCafeConfig(resolvedExample, { rejectExamplePlaceholders: false })).toEqual([]);

    // Blocked if copied verbatim into cafe.local.ts without replacing example domains
    const prodErrors = validateCafeConfig(resolvedExample, { rejectExamplePlaceholders: true });
    expect(prodErrors.length).toBeGreaterThanOrEqual(3);
    expect(prodErrors.some((e) => e.includes('`cafeName`'))).toBe(true);
    expect(prodErrors.some((e) => e.includes('`contactEmail`'))).toBe(true);
    expect(prodErrors.some((e) => e.includes('`organizerEmails`'))).toBe(true);
    expect(prodErrors.some((e) => e.includes('`hostnameViews['))).toBe(true);
  });

  it('validates operational overrides for ranges, durations, intervals, and URLs', () => {
    const invalidOverrides = resolveCafeConfig({
      ...minimalValidUserConfig,
      defaultCardRange: { start: 50, end: 10 },
      defaultSessionDurationHours: 0,
      patTesterServiceIntervalMonths: 0,
      websiteUrl: 'ftp://invalid-scheme',
      whatsappGroupInviteUrl: 'https://example.com/not-whatsapp',
    });

    const errors = validateCafeConfig(invalidOverrides);
    expect(errors.some((e) => e.includes('`defaultCardRange`'))).toBe(true);
    expect(errors.some((e) => e.includes('`defaultSessionDurationHours`'))).toBe(true);
    expect(errors.some((e) => e.includes('`patTesterServiceIntervalMonths`'))).toBe(true);
    expect(errors.some((e) => e.includes('`websiteUrl`'))).toBe(true);
    expect(errors.some((e) => e.includes('`whatsappGroupInviteUrl`'))).toBe(true);
  });

  it('resolves the active cafeConfig cleanly with valid status', () => {
    expect(cafeConfigStatus.valid).toBe(true);
    expect(cafeConfigStatus.errors).toEqual([]);
    expect(cafeConfig.cafeName.length).toBeGreaterThan(0);
    expect(cafeConfig.organizerEmails.length).toBeGreaterThan(0);
  });
});

describe('Cloud Functions Split Config & Fail-Closed Bootstrap Consistency', () => {
  it('defaults backend organizerEmails to empty array (fail-closed) and session duration to 3 hours', () => {
    expect(DEFAULT_FUNCTIONS_CONFIG).toEqual({
      organizerEmails: [],
      defaultSessionDurationHours: 3,
    });

    const resolvedDefault = resolveFunctionsConfig({});
    expect(resolvedDefault.organizerEmails).toEqual([]);
    expect(resolvedDefault.defaultSessionDurationHours).toBe(3);

    // Backend authUtils fails closed when both Firestore and bootstrap organizerEmails are empty
    expect(isBackendAuthorizedOrganizer('someone@gmail.com', resolvedDefault.organizerEmails)).toBe(
      false
    );
  });

  it('uses backend bootstrap emails until Firestore settings/system.organizerEmails is populated', () => {
    const resolvedBootstrap = resolveFunctionsConfig({
      organizerEmails: ['Bootstrap@RepairCafe.org '],
      defaultSessionDurationHours: 4,
    });
    expect(resolvedBootstrap.defaultSessionDurationHours).toBe(4);

    // Day-1 bootstrap before Volunteer Register syncs settings/system.organizerEmails
    const dayOneAllowed = resolveBackendEffectiveOrganizerEmails(
      resolvedBootstrap.organizerEmails,
      []
    );
    expect(isBackendAuthorizedOrganizer('bootstrap@repaircafe.org', dayOneAllowed)).toBe(true);

    // Once Volunteer Register syncs active isOrganiser emails to Firestore, bootstrap is overwritten
    const postSyncAllowed = resolveBackendEffectiveOrganizerEmails(
      resolvedBootstrap.organizerEmails,
      ['active.organiser@gmail.com']
    );
    expect(isBackendAuthorizedOrganizer('active.organiser@gmail.com', postSyncAllowed)).toBe(true);
    expect(isBackendAuthorizedOrganizer('bootstrap@repaircafe.org', postSyncAllowed)).toBe(false);
  });
});
