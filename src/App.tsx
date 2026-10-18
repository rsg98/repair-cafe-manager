import React, { Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { useActiveSession } from './hooks/useActiveSession';
import { usePwaUpdate } from './hooks/usePwaUpdate';
import { UnsavedWorkProvider } from './context/UnsavedWorkContext';
import { Header } from './components/layout/Header';
import { Navigation } from './components/layout/Navigation';
import { OfflineNotice } from './components/common/OfflineNotice';
import { UpdateBanner } from './components/common/UpdateBanner';
import { ChunkErrorBoundary } from './components/common/ChunkErrorBoundary';
import { cafeConfig } from './config/cafe.config';
import { resolveHostnameViews } from './utils/hostnameViews';
import { lazyWithRetry } from './utils/lazyWithRetry';

// Lazy-load each physical station route with automatic retry and stale-chunk recovery
const CustomerRegisterView = lazyWithRetry(
  () => import('./views/CustomerRegisterView').then((m) => ({ default: m.CustomerRegisterView })),
  'CustomerRegisterView'
);
const FrontDeskView = lazyWithRetry(
  () => import('./views/FrontDeskView').then((m) => ({ default: m.FrontDeskView })),
  'FrontDeskView'
);
const PatStationView = lazyWithRetry(
  () => import('./views/PatStationView').then((m) => ({ default: m.PatStationView })),
  'PatStationView'
);
const FixerStationView = lazyWithRetry(
  () => import('./views/FixerStationView').then((m) => ({ default: m.FixerStationView })),
  'FixerStationView'
);
const ReportsView = lazyWithRetry(
  () => import('./views/ReportsView').then((m) => ({ default: m.ReportsView })),
  'ReportsView'
);

// Shared loading spinner displayed while session state or lazy route chunks resolve
const StationLoadingFallback: React.FC<{ label?: string }> = ({
  label = 'Loading station...',
}) => (
  <div className="max-w-md mx-auto my-20 p-8 text-center text-slate-500">
    <div className="h-8 w-8 border-4 border-emerald-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
    <p className="text-sm font-semibold">{label}</p>
  </div>
);

// Error screen displayed when the current hostname is not mapped in cafeConfig.hostnameViews
const UnconfiguredHostnameNotice: React.FC<{ hostname: string }> = ({ hostname }) => (
  <div className="max-w-xl mx-auto my-16 px-4">
    <div className="p-8 bg-white rounded-2xl shadow-sm border border-rose-200 text-center">
      <div className="h-14 w-14 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center mx-auto mb-4">
        <AlertTriangle className="h-8 w-8" />
      </div>
      <h2 className="text-2xl font-bold text-slate-900">
        Hostname Not Configured
      </h2>
      <p className="mt-2 text-sm text-slate-600">
        This hostname (<code className="px-1.5 py-0.5 rounded bg-slate-100 font-mono text-slate-800">{hostname || 'unknown'}</code>) has not been configured for {cafeConfig.cafeName}.
      </p>
      <p className="mt-2 text-xs text-slate-500">
        Please check the URL or add this hostname to <code className="font-mono">cafeConfig.hostnameViews</code>.
      </p>
    </div>
  </div>
);

/**
 * Inner application shell mounted inside UnsavedWorkProvider so that
 * `usePwaUpdate` can inspect whether any active station view has unsaved work.
 */
const AppShell: React.FC = () => {
  // Subscribe to the active Repair Café session and global settings/system document
  const { session, systemSettings, loading } = useActiveSession();

  // Coordinate cross-platform Service Worker updates, wakeup checks, and safe reloads
  const {
    updateAvailable,
    isMandatoryUpdate,
    isDirty,
    appVersion,
    applyUpdateNow,
    dismissBanner,
    bannerDismissed,
  } = usePwaUpdate(systemSettings);

  // Resolve allowed station views and default route for the current browser hostname
  const hostConfig = resolveHostnameViews(
    typeof window !== 'undefined' ? window.location.hostname : '',
    cafeConfig.hostnameViews
  );
  const { allowedViews, defaultRoute } = hostConfig;

  // Render outer shell with offline banner, update banner, top header, navigation, and lazy route outlet
  return (
    <BrowserRouter>
      <div className="min-h-screen flex flex-col bg-slate-50 text-slate-800">
        <OfflineNotice />
        <UpdateBanner
          updateAvailable={updateAvailable}
          isMandatoryUpdate={isMandatoryUpdate}
          isDirty={isDirty}
          bannerDismissed={bannerDismissed}
          onUpdateNow={() => {
            void applyUpdateNow();
          }}
          onDismiss={dismissBanner}
        />
        <Header session={session} showAuthControls={hostConfig.showAuthControls} />
        {hostConfig.showNavigation && <Navigation allowedViews={allowedViews} />}

        <main className="flex-1 pb-16">
          {!hostConfig.isConfigured || !defaultRoute ? (
            <UnconfiguredHostnameNotice hostname={hostConfig.hostname} />
          ) : loading ? (
            <StationLoadingFallback label="Connecting to Repair Café..." />
          ) : (
            // Error boundary and Suspense boundary handle lazy loading of code-split station views
            <ChunkErrorBoundary>
              <Suspense fallback={<StationLoadingFallback />}>
                <Routes>
                  <Route path="/" element={<Navigate to={defaultRoute} replace />} />
                  {allowedViews.includes('register') && (
                    <Route path="/register" element={<CustomerRegisterView session={session} />} />
                  )}
                  {allowedViews.includes('frontdesk') && (
                    <>
                      <Route
                        path="/frontdesk"
                        element={
                          <FrontDeskView
                            session={session}
                            systemSettings={systemSettings}
                          />
                        }
                      />
                      <Route path="/desk" element={<Navigate to="/frontdesk" replace />} />
                    </>
                  )}
                  {allowedViews.includes('pat') && (
                    <Route path="/pat" element={<PatStationView session={session} />} />
                  )}
                  {allowedViews.includes('fixer') && (
                    <Route path="/fixer" element={<FixerStationView session={session} />} />
                  )}
                  {allowedViews.includes('reports') && (
                    <Route path="/reports" element={<ReportsView />} />
                  )}
                  <Route path="*" element={<Navigate to={defaultRoute} replace />} />
                </Routes>
              </Suspense>
            </ChunkErrorBoundary>
          )}
        </main>

        {/* Global footer displaying configured Repair Café identity and active build version */}
        <footer className="bg-white border-t border-slate-200 py-6 text-center text-xs text-slate-400">
          <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2">
            <span>
              {cafeConfig.cafeName} • {cafeConfig.venueName}
            </span>
            <span className="inline-flex items-center gap-2">
              <a
                href="https://github.com/rsg98/repair-cafe-manager/blob/main/README.md"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-slate-600 underline underline-offset-2 transition-colors"
              >
                RCM
              </a>
              <span className="font-mono text-[11px] text-slate-400">
                v{appVersion}
              </span>
              {updateAvailable && (
                <button
                  type="button"
                  onClick={() => {
                    void applyUpdateNow();
                  }}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-semibold hover:bg-emerald-200 transition-colors cursor-pointer"
                >
                  <RefreshCw className="h-3 w-3" />
                  <span>Update ready</span>
                </button>
              )}
            </span>
          </div>
        </footer>
      </div>
    </BrowserRouter>
  );
};

/**
 * Root application component wrapping AppShell with UnsavedWorkProvider.
 */
export const App: React.FC = () => (
  <UnsavedWorkProvider>
    <AppShell />
  </UnsavedWorkProvider>
);

export default App;
