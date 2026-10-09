import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useActiveSession } from './hooks/useActiveSession';
import { Header } from './components/layout/Header';
import { Navigation } from './components/layout/Navigation';
import { OfflineNotice } from './components/common/OfflineNotice';
import { CustomerRegisterView } from './views/CustomerRegisterView';
import { FrontDeskView } from './views/FrontDeskView';
import { PatStationView } from './views/PatStationView';
import { FixerStationView } from './views/FixerStationView';
import { ReportsView } from './views/ReportsView';
import { cafeConfig } from './config/cafe.config';

export const App: React.FC = () => {
  const { session, loading } = useActiveSession();

  return (
    <BrowserRouter>
      <div className="min-h-screen flex flex-col bg-slate-50 text-slate-800">
        <OfflineNotice />
        <Header session={session} />
        <Navigation />

        <main className="flex-1 pb-16">
          {loading ? (
            <div className="max-w-md mx-auto my-20 p-8 text-center text-slate-500">
              <div className="h-8 w-8 border-4 border-emerald-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
              <p className="text-sm font-semibold">Connecting to Repair Café...</p>
            </div>
          ) : (
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
          )}
        </main>

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
