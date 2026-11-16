import type { CafeDefaultedConfig } from './cafe.schema';

/**
 * Sensible operational defaults applied whenever an optional property is omitted
 * from `src/config/cafe.local.ts`. Adding new optional properties here allows
 * downstream Repair Cafés to pull upstream updates without editing local config.
 */
export const DEFAULT_CAFE_CONFIG: CafeDefaultedConfig = {
  tagline: '',
  logoUrl: '/logo.svg',
  websiteUrl: '',
  defaultCardRange: {
    start: 1,
    end: 100,
  },
  defaultSessionDurationHours: 3,
  allowMultiItemRegistration: false,
  excludedItems: [
    'Microwave',
    'Petrol-Driven Item',
    'Electric Bike',
    'Electric Scooter',
  ],
  patTesterServiceIntervalMonths: 12,
  termsVersion: '1.0',
  termsAndConditions: '/terms.md',
  whatsappGroupInviteUrl: undefined,
};
