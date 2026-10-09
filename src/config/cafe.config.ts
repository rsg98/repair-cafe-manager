export interface CafeConfig {
  cafeName: string;
  tagline: string;
  logoUrl: string;
  contactEmail: string;
  websiteUrl: string;
  venueName: string;
  defaultCardRange: {
    start: number;
    end: number;
  };
  allowMultiItemRegistration: boolean;
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
}

export const cafeConfig: CafeConfig = {
  cafeName: "Sutton Repair Café",
  tagline: "Fixing things together in Seears Park",
  logoUrl: "/logo.svg",
  contactEmail: "info@suttonrepaircafe.org.uk",
  websiteUrl: "https://suttonrepaircafe.org.uk",
  venueName: "Seears Park Community Hall",
  defaultCardRange: {
    start: 1,
    end: 100
  },
  // Set to false for Sutton Repair Cafe to ensure equitable queuing across visitors.
  // Other repair cafes deploying this software can set this to true if multi-item check-in is permitted.
  allowMultiItemRegistration: false,
  termsVersion: "2026.1",
  termsAndConditions: "/terms.md",
  organizerEmails: [
    "info@suttonrepaircafe.org.uk",
    "richardgrime@google.com",
    "richard.grime@gmail.com",
    "@suttonrepaircafe.org.uk"
  ]
};
