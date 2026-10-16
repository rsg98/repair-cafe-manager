import { cafeConfig, StationViewId } from '../config/cafe.config';

/**
 * Canonical ordered list of all 5 physical Repair Café stations.
 */
export const ALL_STATION_VIEWS: readonly StationViewId[] = [
  'register',
  'frontdesk',
  'pat',
  'fixer',
  'reports',
];

/**
 * Route path for each station view identifier.
 */
export const STATION_VIEW_PATHS: Record<StationViewId, string> = {
  register: '/register',
  frontdesk: '/frontdesk',
  pat: '/pat',
  fixer: '/fixer',
  reports: '/reports',
};

/**
 * Resolved view and layout permissions for a given request hostname.
 */
export interface HostnameResolution {
  /** True when the hostname matched a configured entry (or valid localhost dev host). */
  isConfigured: boolean;
  /** Normalized hostname that was evaluated. */
  hostname: string;
  /** Ordered list of station views permitted on this hostname. */
  allowedViews: StationViewId[];
  /** Default landing path ("/") for this hostname, or null when unconfigured. */
  defaultRoute: string | null;
  /** Whether the multi-station navigation bar should be rendered (`allowedViews.length > 1`). */
  showNavigation: boolean;
  /** Whether the header authentication controls (Organizer Login / Volunteer badge) should be shown. */
  showAuthControls: boolean;
}

/**
 * Type guard verifying whether a string is a valid StationViewId.
 */
export function isValidStationViewId(value: string): value is StationViewId {
  return (ALL_STATION_VIEWS as readonly string[]).includes(value);
}

/**
 * Builds a HostnameResolution object from a validated list of allowed views.
 */
function buildResolution(
  hostname: string,
  views: readonly StationViewId[]
): HostnameResolution {
  const uniqueValidViews = Array.from(
    new Set(views.filter((v) => isValidStationViewId(v)))
  );

  if (uniqueValidViews.length === 0) {
    return {
      isConfigured: false,
      hostname,
      allowedViews: [],
      defaultRoute: null,
      showNavigation: false,
      showAuthControls: false,
    };
  }

  const defaultRoute = STATION_VIEW_PATHS[uniqueValidViews[0]];
  // Only show navigation tabs when the hostname exposes more than one view
  const showNavigation = uniqueValidViews.length > 1;
  // Hide login controls on customer-only registration hosts to avoid distraction
  const showAuthControls = uniqueValidViews.some((view) => view !== 'register');

  return {
    isConfigured: true,
    hostname,
    allowedViews: uniqueValidViews,
    defaultRoute,
    showNavigation,
    showAuthControls,
  };
}

/**
 * Resolves which station views and UI chrome should be active for a given hostname.
 *
 * Matching rules:
 * 1. Exact hostname match against `hostnameViews` (case-insensitive), e.g.:
 *    - `register.suttonrepaircafe.app` -> `['register']`
 *    - `fixer.suttonrepaircafe.app`    -> `['fixer', 'pat']`
 *    - `manager.suttonrepaircafe.app`  -> `['register', 'frontdesk', 'pat', 'fixer', 'reports']`
 * 2. Localhost subdomain testing match (`<prefix>.localhost`):
 *    - Matches `<prefix>.` against configured keys in `hostnameViews` (e.g. `fixer.localhost` -> `['fixer', 'pat']`).
 *    - If `<prefix>.localhost` does not match any configured key prefix, returns `isConfigured: false`.
 * 3. Bare `localhost` / `127.0.0.1` / `[::1]`:
 *    - Enables all 5 views for convenient local development.
 * 4. Any other hostname not found in `hostnameViews`:
 *    - Returns `isConfigured: false` so the application displays an unconfigured hostname error.
 */
export function resolveHostnameViews(
  hostname: string | null | undefined,
  hostnameViews: Record<string, StationViewId[]> = cafeConfig.hostnameViews
): HostnameResolution {
  const normalizedHost = (hostname ?? '').toLowerCase().trim();

  if (!normalizedHost) {
    return buildResolution('', []);
  }

  // Normalize configured map keys for case-insensitive lookup
  const entries = Object.entries(hostnameViews ?? {}).map(([hostKey, views]) => [
    hostKey.toLowerCase().trim(),
    Array.isArray(views) ? views : [],
  ] as const);

  // 1. Exact hostname match in hostnameViews
  const exactMatch = entries.find(([hostKey]) => hostKey === normalizedHost);
  if (exactMatch) {
    return buildResolution(normalizedHost, exactMatch[1]);
  }

  // 2. Subdomain matching on *.localhost for local development testing (e.g. register.localhost, fixer.localhost)
  if (normalizedHost.endsWith('.localhost')) {
    const subdomainPrefix = normalizedHost.slice(0, -'.localhost'.length);
    if (subdomainPrefix) {
      const prefixMatch = entries.find(([hostKey]) =>
        hostKey.startsWith(`${subdomainPrefix}.`)
      );
      if (prefixMatch) {
        return buildResolution(normalizedHost, prefixMatch[1]);
      }
    }
    return buildResolution(normalizedHost, []);
  }

  // 3. Bare localhost / loopback addresses default to all 5 views for local dev workflow
  if (
    normalizedHost === 'localhost' ||
    normalizedHost === '127.0.0.1' ||
    normalizedHost === '[::1]'
  ) {
    return buildResolution(normalizedHost, ALL_STATION_VIEWS);
  }

  // 4. Default behaviour: unconfigured hostname error
  return buildResolution(normalizedHost, []);
}
