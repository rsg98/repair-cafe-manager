import React, { Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useActiveSession } from './hooks/useActiveSession';
import { Header } from './components/layout/Header';
import { Navigation } from './components/layout/Navigation';
import { OfflineNotice } from './components/common/OfflineNotice';
import { cafeConfig } from './config/cafe.config';

// Lazy-load each physical station route to split application code into smaller on-demand chunks
const CustomerRegisterView = React.lazy(() =>
  import('./views/CustomerRegisterView').then((m) => ({ default: m.CustomerRegisterView }))
);
const FrontDeskView = React.lazy(() =>
  import('./views/FrontDeskView').then((m) => ({ default: m.FrontDeskView }))
);
const PatStationView = React.lazy(() =>
  import('./views/PatStationView').then((m) => ({ default: m.PatStationView }))
);
const FixerStationView = React.lazy(() =>
  import('./views/FixerStationView').then((m) => ({ default: m.FixerStationView }))
);
const ReportsView = React.lazy(() =>
  import('./views/ReportsView').then((m) => ({ default: m.ReportsView }))
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

export const App: React.FC = () => {
  const { session, loading } = useActiveSession();

  // Render outer shell with offline banner, top header, station navigation, and lazy route outlet
  return (
    <BrowserRouter>
      <div className="min-h-screen flex flex-col bg-slate-50 text-slate-800">
        <OfflineNotice />
        <Header session={session} />
        <Navigation />

        <main className="flex-1 pb-16">
          {loading ? (
            <StationLoadingFallback label="Connecting to Repair Café..." />
          ) : (
            // Suspense boundary handles asynchronous loading of code-split station views
            <Suspense fallback={<StationLoadingFallback />}>
              <Routes>
                <Route path="/" element={<Navigate to="/register" replace />} />
                <Route path="/register" element={<CustomerRegisterView session={session} />} />
                <Route path="/frontdesk" element={<FrontDeskView session={session} />} />
                <Route path="/desk" element={<Navigate to="/frontdesk" replace />} />
                <Route path="/pat" element={<PatStationView session={session} />} />
                <Route path="/fixer" element={<FixerStationView session={session} />} />
                <Route path="/reports" element={<ReportsView />} />
                <Route path="*" element={<Navigate to="/register" replace />} />
              </Routes>
            </Suspense>
          )}
        </main>

        {/* Global footer displaying configured Repair Café and venue identity */}
        <footer className="bg-white border-t border-slate-200 py-6 text-center text-xs text-slate-400">
          <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2">
            <span>
              {cafeConfig.cafeName} • {cafeConfig.venueName}
            </span>
            <span>
              Powered by Open Source Repair Café Session Manager
            </span>
          </div>
        </footer>
      </div>
    </BrowserRouter>
  );
};

export default App;

