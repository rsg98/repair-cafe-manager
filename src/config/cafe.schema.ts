export type StationViewId = 'register' | 'frontdesk' | 'pat' | 'fixer' | 'reports';

/**
 * Instance-specific configuration properties that have no valid universal default
 * and MUST be explicitly defined in `src/config/cafe.local.ts`.
 */
export interface CafeRequiredConfig {
  /** Primary display name of the Repair Café shown in headers, legal consent, and exported reports. */
  cafeName: string;
  /** Physical venue name displayed on customer registration and session screens. */
  venueName: string;
  /** Public contact email displayed in visitor enquiries and UK GDPR privacy notices. */
  contactEmail: string;
  /**
   * Bootstrap list of Google email accounts or domain groups (e.g. "@suttonrepaircafe.org.uk")
   * authorised to access Front Desk organiser operations before `settings/system.organizerEmails`
   * is populated by the Volunteer Register `isOrganiser` flag.
   *
   * Must contain at least one valid email or domain pattern; empty lists fail closed.
   */
  organizerEmails: string[];
  /**
   * Maps each allowed hostname to the ordered list of station views enabled on that host.
   * - The first view in the array becomes the default "/" landing route.
   * - Any production hostname not listed here displays an unconfigured hostname error.
   * - In local development, `<prefix>.localhost` matches `<prefix>.*` keys here.
   */
  hostnameViews: Record<string, StationViewId[]>;
}

/**
 * Operational and presentation properties that provide sensible defaults in
 * `DEFAULT_CAFE_CONFIG` and may be omitted or selectively overridden in `src/config/cafe.local.ts`.
 */
export interface CafeDefaultedConfig {
  /** Optional subtitle displayed in the application header on desktop viewports. */
  tagline: string;
  /** Path (inside `public/`) or external URL to the Repair Café logo icon. */
  logoUrl: string;
  /** Optional external URL to the Repair Café's main community website. */
  websiteUrl: string;
  /** Default reusable physical card token range (#1..#100) issued at the Front Desk. */
  defaultCardRange: {
    start: number;
    end: number;
  };
  /**
   * Default Repair Café session length in hours pre-populated when starting a new session
   * and used as the fallback duration for legacy sessions without an explicit length (Issue #42).
   */
  defaultSessionDurationHours: number;
  /** Controls whether a visitor can register multiple items (up to 4) in a single check-in. */
  allowMultiItemRegistration: boolean;
  /**
   * List of item type labels (matching `ITEM_TYPE_SUGGESTIONS` labels or custom terms)
   * that the Repair Café does not generally repair. Entering or selecting one of these
   * displays an advisory warning on the Customer Registration form (`/register`).
   */
  excludedItems: string[];
  /**
   * Service/calibration interval in calendar months for PAT testing instruments (Issue #27).
   * Instruments with `lastCalibratedDate` older than this interval display a non-blocking warning.
   */
  patTesterServiceIntervalMonths: number;
  /** Version identifier recorded alongside visitor T&C consent in `private/customer.termsVersion`. */
  termsVersion: string;
  /**
   * Relative path (e.g. "/terms.md") or external URL to a Markdown document
   * containing the café's detailed Terms & Conditions and House Rules.
   */
  termsAndConditions: string;
  /**
   * Optional WhatsApp group invite URL (e.g. "https://chat.whatsapp.com/...")
   * included in pre-filled 1-to-1 `wa.me` welcome messages when onboarding opted-in volunteers (Issue #43).
   */
  whatsappGroupInviteUrl?: string;
}

/**
 * Input shape authored in `src/config/cafe.local.ts`:
 * requires all instance-specific fields while making operational defaults optional.
 */
export type CafeUserConfig = CafeRequiredConfig & Partial<CafeDefaultedConfig>;

/**
 * Fully resolved configuration object consumed across the application.
 */
export type CafeConfig = CafeRequiredConfig & CafeDefaultedConfig;

/**
 * Validation status exposed to the root UI shell and build-time guardrails.
 */
export interface CafeConfigValidationStatus {
  valid: boolean;
  missingLocalConfig: boolean;
  errors: string[];
}
