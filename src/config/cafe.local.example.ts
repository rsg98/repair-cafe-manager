import type { CafeUserConfig } from './cafe.schema';

/**
 * Starter template for local Repair Café instance configuration.
 *
 * Setup for a local deployment:
 *   1. Copy this file to `src/config/cafe.local.ts` (gitignored so `git pull` never overwrites it).
 *   2. Replace the mandatory fields below with your Repair Café's real details.
 *   3. Optionally override any defaulted operational properties from `src/config/cafe.defaults.ts`.
 */
export const cafeUserConfig = {
  // Mandatory instance identity & contact details
  cafeName: 'Example Repair Café',
  tagline: 'Fixing things together in our community',
  venueName: 'Community Hall',
  contactEmail: 'info@repaircafe.example.org',
  websiteUrl: 'https://repaircafe.example.org',

  // Mandatory bootstrap organiser email(s) or @domain suffix(es).
  // Used for initial Front Desk sign-in until `settings/system.organizerEmails` is populated
  // from the Volunteer Register (`isOrganiser` flag). Empty lists fail closed.
  organizerEmails: [
    'organiser@repaircafe.example.org',
    '@repaircafe.example.org',
  ],

  // Mandatory per-hostname station view allowlist
  hostnameViews: {
    'register.repaircafe.example.org': ['register'],
    'fixer.repaircafe.example.org': ['fixer', 'pat'],
    'manager.repaircafe.example.org': ['register', 'frontdesk', 'pat', 'fixer', 'reports'],
  },

  // Optional operational overrides (omit any property below to inherit DEFAULT_CAFE_CONFIG):
  // logoUrl: '/logo.svg',
  // defaultCardRange: { start: 1, end: 100 },
  // defaultSessionDurationHours: 3,
  // allowMultiItemRegistration: false,
  // excludedItems: ['Microwave', 'Petrol-Driven Item', 'Electric Bike', 'Electric Scooter'],
  // patTesterServiceIntervalMonths: 12,
  // termsVersion: '1.0',
  // termsAndConditions: '/terms.md',
  // whatsappGroupInviteUrl: 'https://chat.whatsapp.com/yourInviteCode',
} satisfies CafeUserConfig;
