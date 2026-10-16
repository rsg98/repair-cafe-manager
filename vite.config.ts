import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

// Shared HTTP response headers allowing Firebase Auth Google OAuth popups to check window.closed
const coopHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
};

export default defineConfig({
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
      registerType: 'autoUpdate',
      includeAssets: ['logo.svg'],
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
            src: 'logo.svg',
            sizes: 'any',
            type: 'image/svg+xml'
          }
        ]
      },
      // Precache all split JS, CSS, HTML, SVG, and Markdown assets for full offline operation
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,md}'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-cache',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365 // 1 year
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          }
        ]
      }
    })
  ]
});

