import { describe, it, expect } from 'vitest';
import { cafeConfig } from '../src/config/cafe.config';
import { resolveHostnameViews, ALL_STATION_VIEWS } from '../src/utils/hostnameViews';

describe('Hostname-to-Views Routing & Layout Resolution', () => {
  describe('Production Configured Hostnames (cafeConfig.hostnameViews)', () => {
    it('configures register.suttonrepaircafe.app with only the Register view and hides nav/auth chrome', () => {
      const result = resolveHostnameViews('register.suttonrepaircafe.app');

      expect(result.isConfigured).toBe(true);
      expect(result.allowedViews).toEqual(['register']);
      expect(result.defaultRoute).toBe('/register');
      expect(result.showNavigation).toBe(false);
      expect(result.showAuthControls).toBe(false);
    });

    it('configures fixer.suttonrepaircafe.app with only Fixer and PAT views, defaulting to /fixer', () => {
      const result = resolveHostnameViews('fixer.suttonrepaircafe.app');

      expect(result.isConfigured).toBe(true);
      expect(result.allowedViews).toEqual(['fixer', 'pat']);
      expect(result.defaultRoute).toBe('/fixer');
      expect(result.showNavigation).toBe(true);
      expect(result.showAuthControls).toBe(true);
    });

    it('configures manager.suttonrepaircafe.app with all five views', () => {
      const result = resolveHostnameViews('manager.suttonrepaircafe.app');

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
      const result = resolveHostnameViews('FIXER.SuttonRepairCafe.App');

      expect(result.isConfigured).toBe(true);
      expect(result.allowedViews).toEqual(['fixer', 'pat']);
      expect(result.defaultRoute).toBe('/fixer');
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
        'suttonrepaircafe.app',
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

    it('verifies cafeConfig.hostnameViews contains the three expected subdomains', () => {
      expect(Object.keys(cafeConfig.hostnameViews)).toEqual([
        'register.suttonrepaircafe.app',
        'fixer.suttonrepaircafe.app',
        'manager.suttonrepaircafe.app',
      ]);
    });
  });
});
