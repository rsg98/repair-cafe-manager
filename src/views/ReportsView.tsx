import React, { useState, useEffect } from 'react';
import { 
  BarChart3, 
  Download, 
  Leaf, 
  Clock, 
  CheckCircle2, 
  Zap, 
  Calendar,
  Layers,
  PieChart
} from 'lucide-react';
import { SessionAnalytics } from '../types';
import { 
  listAllAnalytics, 
  exportAnalyticsToCsv, 
  triggerCsvDownload 
} from '../services/analyticsService';
import { cafeConfig } from '../config/cafe.config';

export const ReportsView: React.FC = () => {
  const [analyticsList, setAnalyticsList] = useState<SessionAnalytics[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadData() {
      try {
        const data = await listAllAnalytics();
        setAnalyticsList(data);
      } catch (err) {
        console.error("Error loading analytics:", err);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

  // Compute cumulative community impact metrics across all sessions
  const totals = analyticsList.reduce(
    (acc, curr) => {
      acc.totalItems += curr.totalItems || 0;
      acc.repairedCount += curr.repairedCount || 0;
      acc.weightKg += curr.totalWeightDivertedKg || 0;
      acc.repairMinutes += curr.totalRepairTimeMinutes || 0;
      acc.patTested += curr.patTestedCount || 0;

      if (curr.categoryBreakdown) {
        for (const [cat, count] of Object.entries(curr.categoryBreakdown)) {
          acc.categories[cat] = (acc.categories[cat] || 0) + count;
        }
      }
      return acc;
    },
    { 
      totalItems: 0, 
      repairedCount: 0, 
      weightKg: 0, 
      repairMinutes: 0, 
      patTested: 0,
      categories: {} as Record<string, number>
    }
  );

  const overallSuccessRate = totals.totalItems > 0 
    ? Math.round((totals.repairedCount / totals.totalItems) * 100) 
    : 0;

  const handleExportCsv = () => {
    const csv = exportAnalyticsToCsv(analyticsList);
    triggerCsvDownload(csv, `${cafeConfig.cafeName.toLowerCase().replace(/\s+/g, '-')}-impact-report.csv`);
  };

  const categoryEntries = Object.entries(totals.categories).sort((a, b) => b[1] - a[1]);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 my-6 space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-slate-200">
        <div>
          <h2 className="text-2xl font-black text-slate-900 flex items-center gap-2">
            <BarChart3 className="h-7 w-7 text-emerald-700" />
            Community Impact & Repair Reports
          </h2>
          <p className="text-xs sm:text-sm text-slate-500">
            Real-time reporting and environmental metrics for {cafeConfig.cafeName}
          </p>
        </div>

        <button
          onClick={handleExportCsv}
          disabled={analyticsList.length === 0}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-700 text-white font-bold text-sm hover:bg-emerald-800 active:bg-emerald-900 transition-colors shadow-sm disabled:opacity-40"
        >
          <Download className="h-4 w-4" /> Export CSV for Grants
        </button>
      </div>

      {/* Cumulative Impact Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Landfill Diversion */}
        <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-emerald-800 uppercase tracking-wider">
              Landfill Diverted
            </span>
            <div className="p-2 rounded-xl bg-emerald-50 text-emerald-700">
              <Leaf className="h-5 w-5" />
            </div>
          </div>
          <div className="mt-4 flex items-baseline gap-2">
            <span className="text-3xl font-black text-slate-900 font-mono">
              {Math.round(totals.weightKg * 10) / 10}
            </span>
            <span className="text-sm font-bold text-slate-500">kg e-waste</span>
          </div>
          <p className="text-xs text-slate-400 mt-2">
            Estimated electronic & mechanical waste saved from landfill
          </p>
        </div>

        {/* Repair Success Rate */}
        <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-blue-800 uppercase tracking-wider">
              Success Rate
            </span>
            <div className="p-2 rounded-xl bg-blue-50 text-blue-700">
              <CheckCircle2 className="h-5 w-5" />
            </div>
          </div>
          <div className="mt-4 flex items-baseline gap-2">
            <span className="text-3xl font-black text-slate-900 font-mono">
              {overallSuccessRate}%
            </span>
            <span className="text-sm font-bold text-slate-500">
              ({totals.repairedCount} / {totals.totalItems} items)
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-2">
            Items restored to working order or given partial repair
          </p>
        </div>

        {/* Volunteer Time Invested */}
        <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-purple-800 uppercase tracking-wider">
              Volunteer Effort
            </span>
            <div className="p-2 rounded-xl bg-purple-50 text-purple-700">
              <Clock className="h-5 w-5" />
            </div>
          </div>
          <div className="mt-4 flex items-baseline gap-2">
            <span className="text-3xl font-black text-slate-900 font-mono">
              {Math.round((totals.repairMinutes / 60) * 10) / 10}
            </span>
            <span className="text-sm font-bold text-slate-500">hours</span>
          </div>
          <p className="text-xs text-slate-400 mt-2">
            Dedicated by volunteer fixers across {analyticsList.length} sessions
          </p>
        </div>

        {/* Electrical Safety Screenings */}
        <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-amber-800 uppercase tracking-wider">
              PAT Screenings
            </span>
            <div className="p-2 rounded-xl bg-amber-50 text-amber-700">
              <Zap className="h-5 w-5" />
            </div>
          </div>
          <div className="mt-4 flex items-baseline gap-2">
            <span className="text-3xl font-black text-slate-900 font-mono">
              {totals.patTested}
            </span>
            <span className="text-sm font-bold text-slate-500">appliances</span>
          </div>
          <p className="text-xs text-slate-400 mt-2">
            Class I & II 240V mains safety checks completed
          </p>
        </div>
      </div>

      {/* Category Breakdown Chart Card */}
      {categoryEntries.length > 0 && (
        <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-6">
          <h3 className="text-lg font-black text-slate-900 mb-4 flex items-center gap-2">
            <PieChart className="h-5 w-5 text-slate-600" />
            Repairs by Item Category
          </h3>
          <div className="space-y-3">
            {categoryEntries.map(([cat, count]) => {
              const pct = totals.totalItems > 0 ? Math.round((count / totals.totalItems) * 100) : 0;
              return (
                <div key={cat} className="space-y-1">
                  <div className="flex justify-between text-xs font-bold text-slate-700">
                    <span>{cat}</span>
                    <span>{count} items ({pct}%)</span>
                  </div>
                  <div className="h-3 w-full bg-slate-100 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-emerald-600 rounded-full transition-all duration-500" 
                      style={{ width: `${pct}%` }} 
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Historical Sessions Archive Table */}
      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden p-6">
        <h3 className="text-lg font-black text-slate-900 mb-4 flex items-center gap-2">
          <Calendar className="h-5 w-5 text-slate-500" />
          Monthly Session Archive
        </h3>

        {loading ? (
          <div className="py-8 text-center text-slate-500 text-sm">
            Loading session impact reports...
          </div>
        ) : analyticsList.length === 0 ? (
          <div className="py-12 text-center text-slate-500 text-sm">
            <Layers className="h-10 w-10 text-slate-300 mx-auto mb-3" />
            No finalized sessions found yet. Once a session is closed and finalized at the Front Desk, 
            its aggregated metrics and environmental savings will appear here.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-500 uppercase tracking-wider">
                <tr>
                  <th className="py-3 px-4">Session Date</th>
                  <th className="py-3 px-4">Session Name</th>
                  <th className="py-3 px-4">Total Items</th>
                  <th className="py-3 px-4">Repaired</th>
                  <th className="py-3 px-4">Success Rate</th>
                  <th className="py-3 px-4">Weight Diverted</th>
                  <th className="py-3 px-4">Volunteer Hours</th>
                  <th className="py-3 px-4">PAT Fail Rate</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium">
                {analyticsList.map((a) => (
                  <tr key={a.sessionId} className="hover:bg-slate-50">
                    <td className="py-3.5 px-4 font-mono text-xs text-slate-600">{a.date}</td>
                    <td className="py-3.5 px-4 font-bold text-slate-900">{a.sessionName}</td>
                    <td className="py-3.5 px-4">{a.totalItems}</td>
                    <td className="py-3.5 px-4 text-emerald-700 font-bold">{a.repairedCount}</td>
                    <td className="py-3.5 px-4 font-bold">{a.successRatePercent}%</td>
                    <td className="py-3.5 px-4 font-mono">{a.totalWeightDivertedKg} kg</td>
                    <td className="py-3.5 px-4 font-mono">
                      {Math.round(((a.totalRepairTimeMinutes || 0) / 60) * 10) / 10} hrs
                    </td>
                    <td className="py-3.5 px-4 text-xs font-mono">
                      {a.patFailureRatePercent ? `${a.patFailureRatePercent}%` : '0%'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
