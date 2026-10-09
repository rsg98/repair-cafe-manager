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
  termsAndConditions: string;
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
  termsAndConditions: `### Terms & Conditions & House Rules

1. **Volunteer Best-Effort Basis:** All repair activities are carried out by volunteer repairers ("fixers") on a best-effort basis. The Repair Café does not offer any professional guarantee, warranty of merchantability, or promise of successful repair.
2. **Safety Testing (PAT):** All mains-powered (240V) electrical appliances must undergo safety inspection before and after repair. Devices deemed inherently unsafe or presenting unacceptable shock/fire hazards will not be energized or repaired.
3. **Limitation of Liability:** Visitors bring items entirely at their own risk. To the maximum extent permitted by UK law, the Repair Café organizers and volunteers accept no liability for any direct or indirect damage or loss to items during transit, diagnosis, or repair.
4. **Spare Parts & Materials:** Visitors are responsible for providing or purchasing necessary replacement parts (e.g. zips, specific fuses, power leads, drive belts).
5. **Custody & Collection:** All items must be collected before the close of the event session. Where a volunteer informally agrees to take an item home to finish a repair, this is a private agreement directly between the volunteer and the visitor; the Repair Café ceases to hold custody or responsibility for the item.
6. **Data Protection:** Personal details (first name, phone number) are collected solely for on-day queue management and will be redacted following the session.`
};
