import { DEFAULT_CAFE_CONFIG } from './cafe.defaults';
import type {
  CafeConfig,
  CafeConfigValidationStatus,
  CafeDefaultedConfig,
  CafeRequiredConfig,
  CafeUserConfig,
  StationViewId,
} from './cafe.schema';
import { resolveCafeConfig, validateCafeConfig } from './cafe.validation';

export type {
  StationViewId,
  CafeRequiredConfig,
  CafeDefaultedConfig,
  CafeUserConfig,
  CafeConfig,
  CafeConfigValidationStatus,
};
export { DEFAULT_CAFE_CONFIG, resolveCafeConfig, validateCafeConfig };

interface LocalConfigModule {
  cafeUserConfig?: Partial<CafeConfig>;
}

/**
 * Eagerly discover `./cafe.local.ts` (gitignored deployment config) alongside
 * `./cafe.local.example.ts` (tracked template used only in automated tests/CI).
 */
const discoveredConfigModules = import.meta.glob<LocalConfigModule>(
  './cafe.local*.ts',
  { eager: true }
);

const localUserConfig = discoveredConfigModules['./cafe.local.ts']?.cafeUserConfig;
const exampleUserConfig = discoveredConfigModules['./cafe.local.example.ts']?.cafeUserConfig;

const isTestMode = import.meta.env.MODE === 'test';
const allowExampleFallback =
  isTestMode ||
  (typeof __ALLOW_EXAMPLE_CAFE_CONFIG__ !== 'undefined' &&
    __ALLOW_EXAMPLE_CAFE_CONFIG__ === true);

function buildActiveCafeConfig(): {
  config: CafeConfig;
  status: CafeConfigValidationStatus;
} {
  // 1. Prefer gitignored local deployment configuration when present on disk
  if (localUserConfig) {
    const resolved = resolveCafeConfig(localUserConfig);
    const errors = validateCafeConfig(resolved, {
      rejectExamplePlaceholders: !isTestMode,
    });
    return {
      config: resolved,
      status: {
        valid: errors.length === 0,
        missingLocalConfig: false,
        errors,
      },
    };
  }

  // 2. Fall back to tracked example template ONLY in Vitest and GitHub Actions CI builds
  if (allowExampleFallback && exampleUserConfig) {
    const resolved = resolveCafeConfig(exampleUserConfig);
    const errors = validateCafeConfig(resolved, {
      rejectExamplePlaceholders: false,
    });
    return {
      config: resolved,
      status: {
        valid: errors.length === 0,
        missingLocalConfig: false,
        errors,
      },
    };
  }

  // 3. Fail closed when local configuration is absent in local dev or non-CI runtime
  const emptyResolved = resolveCafeConfig(null);
  return {
    config: emptyResolved,
    status: {
      valid: false,
      missingLocalConfig: true,
      errors: [
        'Missing local configuration file `src/config/cafe.local.ts`. Copy `src/config/cafe.local.example.ts` to `src/config/cafe.local.ts` and configure mandatory Repair Café settings.',
      ],
    },
  };
}

const resolvedState = buildActiveCafeConfig();

export const cafeConfig: CafeConfig = resolvedState.config;
export const cafeConfigStatus: CafeConfigValidationStatus = resolvedState.status;
