import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// Read semantic version from package.json for compile-time version stamping
const pkgJson = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf-8')
) as { version?: string };

// Resolve short git commit SHA so every deployment has a deterministic build identifier
function resolveGitShortSha(): string {
  try {
    return execSync('git rev-parse --short HEAD', {
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
  } catch {
    // Fallback when building outside a git checkout
    return 'local';
  }
}

// Construct full semantic + git build version and numeric epoch timestamp
const appVersion = `${pkgJson.version ?? '0.1.0'}+${resolveGitShortSha()}`;
const appBuildTimestamp = Date.now();

// Shared HTTP response headers allowing Firebase Auth Google OAuth popups to check window.closed
const coopHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
};

export default defineConfig({
  // Inject compile-time version and timestamp constants for cross-device version checks
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
    __APP_BUILD_TIMESTAMP__: JSON.stringify(appBuildTimestamp),
  },
  // Apply COOP header in local development and preview servers to prevent browser COOP warnings
  server: {
    headers: coopHeaders,
  },
  preview: {
    headers: coopHeaders,
  },
  build: {
    rollupOptions: {
      output: {
        // Split large third-party vendor dependencies into isolated chunks below the 500 kB limit
        manualChunks(id: string) {
          if (id.includes('node_modules')) {
            // Isolate Firestore SDK into its own chunk (~380 kB minified)
            if (id.includes('@firebase/firestore') || id.includes('firebase/firestore')) {
              return 'firebase-firestore';
            }
            // Group remaining Firebase core, Auth, and Functions modules together
            if (id.includes('firebase') || id.includes('@firebase')) {
              return 'firebase-core';
            }
            // Isolate Chart.js and react-chartjs-2 for the Reports station
            if (
              id.includes('chart.js') ||
              id.includes('react-chartjs-2') ||
              id.includes('@kurkle/color')
            ) {
              return 'charts';
            }
            // Isolate Lucide icon components into a shared icon chunk
            if (id.includes('lucide-react')) {
              return 'icons';
            }
            // Group React runtime and React Router into a core framework vendor chunk
            if (
              id.includes('/react/') ||
              id.includes('/react-dom/') ||
              id.includes('/scheduler/') ||
              id.includes('react-router') ||
              id.includes('@remix-run/router')
            ) {
              return 'react-vendor';
            }
          }
          return undefined;
        },
      },
    },
  },
  plugins: [
    tailwindcss(),
    react(),
    // Configure Progressive Web App service worker and manifest for offline community hall usage
    VitePWA({
      // Use prompt mode so waiting Service Workers only activate when the station has no unsaved form inputs
      registerType: 'prompt',
      // Register explicitly via virtual:pwa-register inside usePwaUpdate hook
      injectRegister: null,
      includeAssets: [
        'logo.svg',
        'apple-touch-icon.png',
        'pwa-192x192.png',
        'pwa-512x512.png',
      ],
      manifest: {
        name: 'Repair Cafe Session Manager',
        short_name: 'RepairCafe',
        description: 'Offline-first Session and Repair Queue Management for Community Repair Cafes',
        theme_color: '#15803d',
        background_color: '#f8fafc',
        display: 'standalone',
        orientation: 'portrait',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
          {
            src: 'logo.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any',
          },
        ],
      },
      // Precache all split JS, CSS, HTML, SVG, PNG, and Markdown assets for full offline operation.
      // Note: Do NOT set clientsClaim or skipWaiting here so vite-plugin-pwa injects the SKIP_WAITING message listener.
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,md}'],
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-cache',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365, // 1 year
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
        ],
      },
    }),
  ],
});


