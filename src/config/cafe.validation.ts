import { DEFAULT_CAFE_CONFIG } from './cafe.defaults';
import type { CafeConfig, StationViewId } from './cafe.schema';

export const VALID_STATION_VIEWS: readonly StationViewId[] = [
  'register',
  'frontdesk',
  'pat',
  'fixer',
  'reports',
];

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DOMAIN_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i;

/**
 * Checks whether a string is a syntactically valid email address.
 */
export function isValidEmailAddress(value: string): boolean {
  return EMAIL_PATTERN.test(value.trim());
}

/**
 * Checks whether a string is a valid organiser authorisation pattern:
 * either an exact email (`user@domain.org`) or a domain group (`@domain.org` / `domain.org`).
 */
export function isValidOrganizerPattern(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }
  if (trimmed.startsWith('@')) {
    return DOMAIN_PATTERN.test(trimmed.slice(1));
  }
  if (!trimmed.includes('@')) {
    return DOMAIN_PATTERN.test(trimmed);
  }
  return EMAIL_PATTERN.test(trimmed);
}

/**
 * Detects RFC 2606 reserved example domains (`example.com`, `example.org`, `example.net`
 * and subdomains thereof) so unedited starter templates are blocked in production builds.
 */
export function usesReservedExampleDomain(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  const hostPart = normalized.includes('@')
    ? normalized.split('@').pop() ?? ''
    : normalized.replace(/^https?:\/\//, '').split('/')[0] ?? '';

  return (
    hostPart === 'example.com' ||
    hostPart === 'example.org' ||
    hostPart === 'example.net' ||
    hostPart.endsWith('.example.com') ||
    hostPart.endsWith('.example.org') ||
    hostPart.endsWith('.example.net')
  );
}

/**
 * Merges a partial user configuration over `DEFAULT_CAFE_CONFIG`, ensuring all fields
 * have deterministic runtime types before running `validateCafeConfig`.
 */
export function resolveCafeConfig(userConfig?: Partial<CafeConfig> | null): CafeConfig {
  const raw = userConfig ?? {};
  const rawRange = raw.defaultCardRange;

  return {
    cafeName: typeof raw.cafeName === 'string' ? raw.cafeName.trim() : '',
    venueName: typeof raw.venueName === 'string' ? raw.venueName.trim() : '',
    contactEmail: typeof raw.contactEmail === 'string' ? raw.contactEmail.trim() : '',
    organizerEmails: Array.isArray(raw.organizerEmails) ? [...raw.organizerEmails] : [],
    hostnameViews:
      raw.hostnameViews && typeof raw.hostnameViews === 'object' && !Array.isArray(raw.hostnameViews)
        ? { ...raw.hostnameViews }
        : {},
    tagline:
      typeof raw.tagline === 'string' ? raw.tagline : DEFAULT_CAFE_CONFIG.tagline,
    logoUrl:
      typeof raw.logoUrl === 'string' ? raw.logoUrl.trim() : DEFAULT_CAFE_CONFIG.logoUrl,
    websiteUrl:
      typeof raw.websiteUrl === 'string' ? raw.websiteUrl.trim() : DEFAULT_CAFE_CONFIG.websiteUrl,
    defaultCardRange: {
      start:
        rawRange && typeof rawRange.start === 'number'
          ? rawRange.start
          : DEFAULT_CAFE_CONFIG.defaultCardRange.start,
      end:
        rawRange && typeof rawRange.end === 'number'
          ? rawRange.end
          : DEFAULT_CAFE_CONFIG.defaultCardRange.end,
    },
    defaultSessionDurationHours:
      typeof raw.defaultSessionDurationHours === 'number'
        ? raw.defaultSessionDurationHours
        : DEFAULT_CAFE_CONFIG.defaultSessionDurationHours,
    allowMultiItemRegistration:
      typeof raw.allowMultiItemRegistration === 'boolean'
        ? raw.allowMultiItemRegistration
        : DEFAULT_CAFE_CONFIG.allowMultiItemRegistration,
    excludedItems: Array.isArray(raw.excludedItems)
      ? [...raw.excludedItems]
      : [...DEFAULT_CAFE_CONFIG.excludedItems],
    patTesterServiceIntervalMonths:
      typeof raw.patTesterServiceIntervalMonths === 'number'
        ? raw.patTesterServiceIntervalMonths
        : DEFAULT_CAFE_CONFIG.patTesterServiceIntervalMonths,
    termsVersion:
      typeof raw.termsVersion === 'string'
        ? raw.termsVersion.trim()
        : DEFAULT_CAFE_CONFIG.termsVersion,
    termsAndConditions:
      typeof raw.termsAndConditions === 'string'
        ? raw.termsAndConditions.trim()
        : DEFAULT_CAFE_CONFIG.termsAndConditions,
    whatsappGroupInviteUrl:
      typeof raw.whatsappGroupInviteUrl === 'string' && raw.whatsappGroupInviteUrl.trim().length > 0
        ? raw.whatsappGroupInviteUrl.trim()
        : DEFAULT_CAFE_CONFIG.whatsappGroupInviteUrl,
  };
}

export interface ValidateCafeConfigOptions {
  /**
   * When true, rejects RFC 2606 reserved example domains (`*.example.org`, `*.example.com`)
   * in mandatory fields so unedited `cafe.local.example.ts` copies cannot be built for production.
   */
  rejectExamplePlaceholders?: boolean;
}

/**
 * Validates a resolved `CafeConfig` and returns a list of human-readable configuration errors.
 * Returns an empty array when the configuration is completely valid.
 */
export function validateCafeConfig(
  config: Partial<CafeConfig> | null | undefined,
  options: ValidateCafeConfigOptions = {}
): string[] {
  if (!config || typeof config !== 'object') {
    return ['Configuration object is missing or invalid.'];
  }

  const { rejectExamplePlaceholders = false } = options;
  const errors: string[] = [];

  // 1. Mandatory identity & venue fields
  if (typeof config.cafeName !== 'string' || config.cafeName.trim().length === 0) {
    errors.push('`cafeName` is required and cannot be empty.');
  } else if (
    rejectExamplePlaceholders &&
    config.cafeName.trim().toLowerCase() === 'example repair café'
  ) {
    errors.push('`cafeName` still uses the starter placeholder "Example Repair Café".');
  }

  if (typeof config.venueName !== 'string' || config.venueName.trim().length === 0) {
    errors.push('`venueName` is required and cannot be empty.');
  }

  if (typeof config.contactEmail !== 'string' || !isValidEmailAddress(config.contactEmail)) {
    errors.push('`contactEmail` is required and must be a valid email address.');
  } else if (rejectExamplePlaceholders && usesReservedExampleDomain(config.contactEmail)) {
    errors.push(
      '`contactEmail` uses a reserved example domain; set your Repair Café contact address.'
    );
  }

  // 2. Mandatory fail-closed bootstrap organiser emails
  if (!Array.isArray(config.organizerEmails) || config.organizerEmails.length === 0) {
    errors.push(
      '`organizerEmails` is required and must contain at least one organiser email or @domain pattern (empty lists fail closed).'
    );
  } else {
    const invalidPatterns = config.organizerEmails.filter(
      (entry) => typeof entry !== 'string' || !isValidOrganizerPattern(entry)
    );
    if (invalidPatterns.length > 0) {
      errors.push(
        `\`organizerEmails\` contains invalid email/domain pattern(s): ${invalidPatterns.map((p) => JSON.stringify(p)).join(', ')}.`
      );
    } else if (
      rejectExamplePlaceholders &&
      config.organizerEmails.some((entry) => usesReservedExampleDomain(entry))
    ) {
      errors.push(
        '`organizerEmails` uses a reserved example domain; configure your real bootstrap organiser email(s).'
      );
    }
  }

  // 3. Mandatory hostname-to-station routing map
  if (
    !config.hostnameViews ||
    typeof config.hostnameViews !== 'object' ||
    Array.isArray(config.hostnameViews)
  ) {
    errors.push('`hostnameViews` is required and must map at least one hostname to station views.');
  } else {
    const hostEntries = Object.entries(config.hostnameViews);
    if (hostEntries.length === 0) {
      errors.push('`hostnameViews` must configure at least one production hostname.');
    }
    for (const [hostname, views] of hostEntries) {
      const cleanHost = hostname.trim();
      if (!cleanHost) {
        errors.push('`hostnameViews` contains an empty hostname key.');
        continue;
      }
      if (rejectExamplePlaceholders && usesReservedExampleDomain(cleanHost)) {
        errors.push(
          `\`hostnameViews["${cleanHost}"]\` uses a reserved example domain; configure your Firebase or custom domain(s).`
        );
      }
      if (!Array.isArray(views) || views.length === 0) {
        errors.push(
          `\`hostnameViews["${cleanHost}"]\` must assign at least one station view.`
        );
        continue;
      }
      const invalidViews = views.filter(
        (v) => !VALID_STATION_VIEWS.includes(v as StationViewId)
      );
      if (invalidViews.length > 0) {
        errors.push(
          `\`hostnameViews["${cleanHost}"]\` contains unsupported station view(s): ${invalidViews.join(', ')}.`
        );
      }
    }
  }

  // 4. Defaulted operational properties (validate overrides when supplied)
  const cardRange = config.defaultCardRange;
  if (
    !cardRange ||
    !Number.isInteger(cardRange.start) ||
    !Number.isInteger(cardRange.end) ||
    cardRange.start < 1 ||
    cardRange.end < cardRange.start
  ) {
    errors.push(
      '`defaultCardRange` must specify positive integers with `start >= 1` and `end >= start`.'
    );
  }

  if (
    typeof config.defaultSessionDurationHours !== 'number' ||
    !Number.isFinite(config.defaultSessionDurationHours) ||
    config.defaultSessionDurationHours < 0.5 ||
    config.defaultSessionDurationHours > 24
  ) {
    errors.push('`defaultSessionDurationHours` must be a number between 0.5 and 24 hours.');
  }

  if (
    typeof config.patTesterServiceIntervalMonths !== 'number' ||
    !Number.isInteger(config.patTesterServiceIntervalMonths) ||
    config.patTesterServiceIntervalMonths < 1
  ) {
    errors.push('`patTesterServiceIntervalMonths` must be an integer of at least 1 month.');
  }

  if (typeof config.logoUrl !== 'string' || config.logoUrl.trim().length === 0) {
    errors.push('`logoUrl` cannot be empty.');
  }

  if (typeof config.termsVersion !== 'string' || config.termsVersion.trim().length === 0) {
    errors.push('`termsVersion` cannot be empty.');
  }

  if (
    typeof config.termsAndConditions !== 'string' ||
    config.termsAndConditions.trim().length === 0
  ) {
    errors.push('`termsAndConditions` cannot be empty.');
  }

  if (
    typeof config.websiteUrl === 'string' &&
    config.websiteUrl.trim().length > 0 &&
    !/^https?:\/\/[^\s/$.?#].[^\s]*$/i.test(config.websiteUrl.trim())
  ) {
    errors.push('`websiteUrl` must be empty or a valid http(s) URL.');
  }

  if (
    config.whatsappGroupInviteUrl !== undefined &&
    (typeof config.whatsappGroupInviteUrl !== 'string' ||
      !/^https:\/\/chat\.whatsapp\.com\/[A-Za-z0-9_-]+/.test(
        config.whatsappGroupInviteUrl.trim()
      ))
  ) {
    errors.push(
      '`whatsappGroupInviteUrl` must be omitted or a valid https://chat.whatsapp.com/... invite URL.'
    );
  }

  if (
    !Array.isArray(config.excludedItems) ||
    config.excludedItems.some((item) => typeof item !== 'string')
  ) {
    errors.push('`excludedItems` must be an array of item type strings.');
  }

  return errors;
}
