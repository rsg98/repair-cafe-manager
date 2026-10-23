export type StationViewId = 'register' | 'frontdesk' | 'pat' | 'fixer' | 'reports';

export interface CafeConfig {
  // Core single-tenant Repair Café branding and venue metadata
  cafeName: string;
  tagline: string;
  logoUrl: string;
  contactEmail: string;
  websiteUrl: string;
  venueName: string;
  // Default reusable physical card token range (#1..#100)
  defaultCardRange: {
    start: number;
    end: number;
  };
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
  termsVersion: string;
  /**
   * Relative path (e.g. "/terms.md") or external URL to a Markdown document
   * containing the café's detailed Terms & Conditions and House Rules.
   */
  termsAndConditions: string;
  /**
   * List of named Google email accounts or domain groups (e.g. "@suttonrepaircafe.org.uk")
   * authorized to access Front Desk organizer operations and close/finalize sessions.
   * If empty, any authenticated Google account is permitted.
   */
  organizerEmails: string[];
  /**
   * Maps each allowed hostname to the ordered list of station views enabled on that host.
   * - The first view in the array becomes the default "/" landing route.
   * - Any production hostname not listed here will display an unconfigured hostname error.
   * - In local development, `<prefix>.localhost` matches `<prefix>.*` keys here.
   */
  hostnameViews: Record<string, StationViewId[]>;
}

export const cafeConfig: CafeConfig = {
  // Sutton Repair Café reference instance branding and contact details
  cafeName: "Sutton Repair Café",
  tagline: "Fixing things together in Seears Park",
  logoUrl: "/logo.svg",
  contactEmail: "info@suttonrepaircafe.org.uk",
  websiteUrl: "https://suttonrepaircafe.org.uk",
  venueName: "Seears Park Community Hall",
  // Reusable physical card numbers issued at the Front Desk
  defaultCardRange: {
    start: 1,
    end: 100
  },
  // Set to false for Sutton Repair Cafe to ensure equitable queuing across visitors.
  // Other repair cafes deploying this software can set this to true if multi-item check-in is permitted.
  allowMultiItemRegistration: false,
  // Item types that the Repair Café does not generally repair (triggers an advisory warning on registration)
  excludedItems: [
    "Microwave",
    "Petrol-Driven Item",
    "Electric Bike",
    "Electric Scooter"
  ],
  // Flag PAT testing instruments whose calibration date is older than 12 months (Issue #27)
  patTesterServiceIntervalMonths: 12,
  termsVersion: "2026.1",
  termsAndConditions: "/terms.md",
  // Authorised Google accounts and Google Workspace domain groups for Front Desk admin
  organizerEmails: [
    "info@suttonrepaircafe.org.uk",
    "@suttonrepaircafe.org.uk"
  ],
  // Per-subdomain view routing for public registration, volunteer stations, and manager views
  hostnameViews: {
    "register.suttonrepaircafe.app": ["register"],
    "fixer.suttonrepaircafe.app": ["fixer", "pat"],
    "manager.suttonrepaircafe.app": ["register", "frontdesk", "pat", "fixer", "reports"]
  }
};


