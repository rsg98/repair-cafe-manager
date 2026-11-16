import { describe, it, expect } from 'vitest';
import { cafeConfig } from '../src/config/cafe.config';
import { cafeUserConfig as exampleCafeUserConfig } from '../src/config/cafe.local.example';
import { resolveHostnameViews, ALL_STATION_VIEWS } from '../src/utils/hostnameViews';

describe('Hostname-to-Views Routing & Layout Resolution', () => {
  describe('Reference Template Hostnames (cafe.local.example.ts)', () => {
    const templateHostMap = exampleCafeUserConfig.hostnameViews;

    it('configures register subdomain with only the Register view and hides nav/auth chrome', () => {
      const result = resolveHostnameViews('register.repaircafe.example.org', templateHostMap);

      expect(result.isConfigured).toBe(true);
      expect(result.allowedViews).toEqual(['register']);
      expect(result.defaultRoute).toBe('/register');
      expect(result.showNavigation).toBe(false);
      expect(result.showAuthControls).toBe(false);
    });

    it('configures fixer subdomain with only Fixer and PAT views, defaulting to /fixer', () => {
      const result = resolveHostnameViews('fixer.repaircafe.example.org', templateHostMap);

      expect(result.isConfigured).toBe(true);
      expect(result.allowedViews).toEqual(['fixer', 'pat']);
      expect(result.defaultRoute).toBe('/fixer');
      expect(result.showNavigation).toBe(true);
      expect(result.showAuthControls).toBe(true);
    });

    it('configures manager subdomain with all five views', () => {
      const result = resolveHostnameViews('manager.repaircafe.example.org', templateHostMap);

      expect(result.isConfigured).toBe(true);
      expect(result.allowedViews).toEqual([
        'register',
        'frontdesk',
        'pat',
        'fixer',
        'reports',
      ]);
      expect(result.defaultRoute).toBe('/register');
      expect(result.showNavigation).toBe(true);
      expect(result.showAuthControls).toBe(true);
    });

    it('matches configured hostnames case-insensitively', () => {
      const result = resolveHostnameViews('FIXER.RepairCafe.Example.Org', templateHostMap);

      expect(result.isConfigured).toBe(true);
      expect(result.allowedViews).toEqual(['fixer', 'pat']);
      expect(result.defaultRoute).toBe('/fixer');
    });
  });

  describe('Active cafeConfig.hostnameViews Resolution', () => {
    it('resolves every hostname configured in the active cafeConfig cleanly', () => {
      const configuredHosts = Object.keys(cafeConfig.hostnameViews);
      expect(configuredHosts.length).toBeGreaterThanOrEqual(1);

      for (const host of configuredHosts) {
        const result = resolveHostnameViews(host);
        expect(result.isConfigured).toBe(true);
        expect(result.allowedViews.length).toBeGreaterThanOrEqual(1);
        expect(result.defaultRoute).toBe(`/${result.allowedViews[0]}`);
      }
    });
  });

  describe('Localhost Testing Behaviour', () => {
    it('matches register.localhost against register.* in hostnameViews', () => {
      const result = resolveHostnameViews('register.localhost');

      expect(result.isConfigured).toBe(true);
      expect(result.allowedViews).toEqual(['register']);
      expect(result.defaultRoute).toBe('/register');
      expect(result.showNavigation).toBe(false);
      expect(result.showAuthControls).toBe(false);
    });

    it('matches fixer.localhost against fixer.* in hostnameViews', () => {
      const result = resolveHostnameViews('fixer.localhost');

      expect(result.isConfigured).toBe(true);
      expect(result.allowedViews).toEqual(['fixer', 'pat']);
      expect(result.defaultRoute).toBe('/fixer');
      expect(result.showNavigation).toBe(true);
      expect(result.showAuthControls).toBe(true);
    });

    it('matches manager.localhost against manager.* in hostnameViews', () => {
      const result = resolveHostnameViews('manager.localhost');

      expect(result.isConfigured).toBe(true);
      expect(result.allowedViews).toEqual(ALL_STATION_VIEWS);
      expect(result.defaultRoute).toBe('/register');
      expect(result.showNavigation).toBe(true);
      expect(result.showAuthControls).toBe(true);
    });

    it('allows all 5 views on bare localhost and loopback addresses', () => {
      for (const host of ['localhost', '127.0.0.1', '[::1]']) {
        const result = resolveHostnameViews(host);
        expect(result.isConfigured).toBe(true);
        expect(result.allowedViews).toEqual(ALL_STATION_VIEWS);
        expect(result.defaultRoute).toBe('/register');
        expect(result.showNavigation).toBe(true);
        expect(result.showAuthControls).toBe(true);
      }
    });

    it('returns unconfigured error for unknown *.localhost subdomains', () => {
      const result = resolveHostnameViews('unconfigured.localhost');

      expect(result.isConfigured).toBe(false);
      expect(result.allowedViews).toEqual([]);
      expect(result.defaultRoute).toBeNull();
      expect(result.showNavigation).toBe(false);
      expect(result.showAuthControls).toBe(false);
    });
  });

  describe('Unconfigured Hostname Default Error Behaviour', () => {
    it('marks unknown hostnames as not configured with empty views and null defaultRoute', () => {
      for (const unknownHost of [
        'unmapped-domain.invalid',
        'unknown.suttonrepaircafe.app',
        'repair-cafe.web.app',
        'example.com',
        '',
      ]) {
        const result = resolveHostnameViews(unknownHost);
        expect(result.isConfigured).toBe(false);
        expect(result.allowedViews).toEqual([]);
        expect(result.defaultRoute).toBeNull();
        expect(result.showNavigation).toBe(false);
        expect(result.showAuthControls).toBe(false);
      }
    });

    it('supports custom hostnameViews maps and deduplicates views', () => {
      const customMap = {
        'pat.custom.org': ['pat', 'pat'] as ('pat')[],
      };

      const configured = resolveHostnameViews('pat.custom.org', customMap);
      expect(configured.isConfigured).toBe(true);
      expect(configured.allowedViews).toEqual(['pat']);
      expect(configured.defaultRoute).toBe('/pat');
      expect(configured.showNavigation).toBe(false);
      expect(configured.showAuthControls).toBe(true);

      const unconfigured = resolveHostnameViews('register.suttonrepaircafe.app', customMap);
      expect(unconfigured.isConfigured).toBe(false);
    });
  });
});
