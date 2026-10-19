/**
 * @file src/views/ReportsView.tsx
 *
 * Station 5: Community Impact & Repair Reports View.
 * Displays cumulative environmental and repair metrics across official finalized
 * sessions, category breakdown charts, grant-ready CSV exports, and an organiser
 * Monthly Session Archive with retroactive Test/Official classification controls.
 */

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
  PieChart,
  FlaskConical
} from 'lucide-react';
import { SessionAnalytics } from '../types';
import {
  listAllAnalytics,
  filterAnalyticsForReporting,
  exportAnalyticsToCsv,
  triggerCsvDownload
} from '../services/analyticsService';
import { setSessionTestStatus } from '../services/sessionService';
import { useAuth } from '../hooks/useAuth';
import { cafeConfig } from '../config/cafe.config';

/** Aggregated totals computed across official finalized sessions. */
interface OfficialImpactTotals {
  totalItems: number;
  repairedCount: number;
  weightKg: number;
  repairMinutes: number;
  patTested: number;
  totalVolunteers: number;
  categories: Record<string, number>;
}

/**
 * Pure helper that aggregates cumulative community impact metrics across official sessions.
 */
function computeOfficialTotals(officialAnalytics: SessionAnalytics[]): OfficialImpactTotals {
  // Sum item counts, weights, durations, PAT checks, and categories across official sessions
  return officialAnalytics.reduce<OfficialImpactTotals>(
    (acc, curr) => {
      acc.totalItems += curr.totalItems || 0;
      acc.repairedCount += curr.repairedCount || 0;
      acc.weightKg += curr.totalWeightDivertedKg || 0;
      acc.repairMinutes += curr.totalRepairTimeMinutes || 0;
      acc.patTested += curr.patTestedCount || 0;
      acc.totalVolunteers += curr.volunteerCount || 0;

      // Aggregate item counts by category across all official finalized sessions
      if (curr.categoryBreakdown) {
        for (const [cat, count] of Object.entries(curr.categoryBreakdown)) {
          acc.categories[cat] = (acc.categories[cat] || 0) + count;
        }
      }
      return acc;
    },
    {
      // Initial accumulator values for official community impact metrics
      totalItems: 0,
      repairedCount: 0,
      weightKg: 0,
      repairMinutes: 0,
      patTested: 0,
      totalVolunteers: 0,
      categories: {}
    }
  );
}

/** Props for a single metric card in the cumulative impact summary grid. */
interface KpiMetricCardProps {
  label: string;
  labelColorClass: string;
  iconBgClass: string;
  icon: React.ReactNode;
  primaryValue: string | number;
  unitLabel: string;
  caption: string;
}

/**
 * Renders a single KPI metric card in the top 4-card summary grid.
 */
const KpiMetricCard: React.FC<KpiMetricCardProps> = ({
  label,
  labelColorClass,
  iconBgClass,
  icon,
  primaryValue,
  unitLabel,
  caption
}) => (
  // Card container with rounded border and subtle shadow
  <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm relative overflow-hidden">
    <div className="flex items-center justify-between">
      <span className={`text-xs font-bold uppercase tracking-wider ${labelColorClass}`}>
        {label}
      </span>
      {/* Icon badge */}
      <div className={`p-2 rounded-xl ${iconBgClass}`}>{icon}</div>
    </div>
    {/* Primary metric value and unit label */}
    <div className="mt-4 flex items-baseline gap-2">
      <span className="text-3xl font-black text-slate-900 font-mono">{primaryValue}</span>
      <span className="text-sm font-bold text-slate-500">{unitLabel}</span>
    </div>
    <p className="text-xs text-slate-400 mt-2">{caption}</p>
  </div>
);

/** Props for a single row in the Monthly Session Archive table. */
interface SessionArchiveRowProps {
  item: SessionAnalytics;
  isAdmin: boolean;
  isUpdating: boolean;
  onToggleTestStatus: (item: SessionAnalytics) => void;
}

/**
 * Renders a single session row in the Monthly Session Archive table.
 */
const SessionArchiveRow: React.FC<SessionArchiveRowProps> = ({
  item,
  isAdmin,
  isUpdating,
  onToggleTestStatus
}) => (
  // Highlight test session rows with a soft amber tint
  <tr
    className={`transition-colors ${
      item.isTest
        ? 'bg-amber-50/40 text-slate-500 hover:bg-amber-50/70'
        : 'hover:bg-slate-50'
    }`}
  >
    {/* Session date, name, and optional TEST session badge */}
    <td className="py-3.5 px-4 font-mono text-xs text-slate-600">{item.date}</td>
    <td className="py-3.5 px-4 font-bold text-slate-900">
      <span>{item.sessionName}</span>
      {item.isTest && (
        <span className="ml-2 px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-300 font-black text-[10px] uppercase tracking-wider">
          TEST
        </span>
      )}
    </td>
    {/* Item counts, success rate, and weight diverted */}
    <td className="py-3.5 px-4">{item.totalItems}</td>
    <td className="py-3.5 px-4 text-emerald-700 font-bold">{item.repairedCount}</td>
    <td className="py-3.5 px-4 font-bold">{item.successRatePercent}%</td>
    <td className="py-3.5 px-4 font-mono">{item.totalWeightDivertedKg} kg</td>
    {/* Volunteer hours, attending volunteer count, and PAT failure rate */}
    <td className="py-3.5 px-4 font-mono">
      {Math.round(((item.totalRepairTimeMinutes || 0) / 60) * 10) / 10} hrs
    </td>
    <td className="py-3.5 px-4 font-mono">{item.volunteerCount ?? 0}</td>
    <td className="py-3.5 px-4 text-xs font-mono">
      {item.patFailureRatePercent ? `${item.patFailureRatePercent}%` : '0%'}
    </td>
    {/* Organiser action to retroactively mark session as Test or Official */}
    {isAdmin && (
      <td className="py-3.5 px-4 text-right whitespace-nowrap">
        <button
          type="button"
          disabled={isUpdating}
          onClick={() => onToggleTestStatus(item)}
          className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition-colors disabled:opacity-50 ${
            item.isTest
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800 hover:bg-emerald-100'
              : 'bg-amber-50 border-amber-200 text-amber-800 hover:bg-amber-100'
          }`}
        >
          {item.isTest ? 'Mark as Official' : 'Mark as Test'}
        </button>
      </td>
    )}
  </tr>
);

/**
 * Station 5: Community Impact & Repair Reports View.
 * Coordinates cumulative official KPI cards, category breakdown bars, and the
 * Monthly Session Archive table with organiser test-session filtering.
 */
export const ReportsView: React.FC = () => {
  // Check organiser status to enable retroactive test/official session classification
  const { isAdmin } = useAuth();
  const [analyticsList, setAnalyticsList] = useState<SessionAnalytics[]>([]);
  const [loading, setLoading] = useState(true);
  // Toggle whether test sessions are shown in the Monthly Session Archive table
  const [showTestSessions, setShowTestSessions] = useState(false);
  const [updatingSessionId, setUpdatingSessionId] = useState<string | null>(null);

  useEffect(() => {
    // Load all finalized session analytics snapshots on mount
    async function loadData() {
      try {
        const data = await listAllAnalytics();
        setAnalyticsList(data);
      } catch (err) {
        // Log analytics fetch error without crashing the dashboard
        console.error('Error loading analytics:', err);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

  // Official analytics strictly exclude test/rehearsal sessions from KPIs and grant exports
  const officialAnalytics = filterAnalyticsForReporting(analyticsList, false);
  // Archive table rows respect the "Show Test Sessions" toggle
  const visibleAnalytics = filterAnalyticsForReporting(analyticsList, showTestSessions);
  const testSessionCount = analyticsList.filter((a) => Boolean(a.isTest)).length;

  // Compute cumulative community impact metrics strictly across official sessions
  const totals = computeOfficialTotals(officialAnalytics);
  const overallSuccessRate =
    totals.totalItems > 0 ? Math.round((totals.repairedCount / totals.totalItems) * 100) : 0;

  // Export strictly official session analytics to a grant-ready CSV download
  const handleExportCsv = () => {
    const csv = exportAnalyticsToCsv(officialAnalytics);
    triggerCsvDownload(
      csv,
      `${cafeConfig.cafeName.toLowerCase().replace(/\s+/g, '-')}-impact-report.csv`
    );
  };

  // Allow an authenticated organiser to retroactively mark a session as Test or Official
  const handleToggleTestStatus = async (item: SessionAnalytics) => {
    const nextIsTest = !item.isTest;
    const promptMsg = nextIsTest
      ? `Mark "${item.sessionName}" as a TEST session? It will be excluded from cumulative impact totals and grant CSV exports.`
      : `Mark "${item.sessionName}" as an OFFICIAL session? Its metrics will be included in cumulative impact totals and grant CSV exports.`;
    if (!confirm(promptMsg)) return;

    // Persist the updated isTest flag to both sessions/{id} and analytics/{id}
    setUpdatingSessionId(item.sessionId);
    try {
      await setSessionTestStatus(item.sessionId, nextIsTest);
      setAnalyticsList((prev) =>
        prev.map((a) => (a.sessionId === item.sessionId ? { ...a, isTest: nextIsTest } : a))
      );
      // Automatically keep test sessions visible when an organiser marks an official session as test
      if (nextIsTest) {
        setShowTestSessions(true);
      }
    } catch (err: unknown) {
      // Display error alert if updating test status fails
      const message = err instanceof Error ? err.message : 'Failed to update session test status';
      alert(message);
    } finally {
      setUpdatingSessionId(null);
    }
  };

  // Sort categories by highest item volume first
  const categoryEntries = Object.entries(totals.categories).sort((a, b) => b[1] - a[1]);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 my-6 space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-slate-200">
        <div>
          {/* Page title and icon */}
          <h2 className="text-2xl font-black text-slate-900 flex items-center gap-2">
            <BarChart3 className="h-7 w-7 text-emerald-700" />
            Community Impact &amp; Repair Reports
          </h2>
          <p className="text-xs sm:text-sm text-slate-500">
            Real-time reporting and environmental metrics for {cafeConfig.cafeName}
          </p>
        </div>

        {/* Grant reporting CSV export button (exports official sessions only) */}
        <button
          onClick={handleExportCsv}
          disabled={officialAnalytics.length === 0}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-700 text-white font-bold text-sm hover:bg-emerald-800 active:bg-emerald-900 transition-colors shadow-sm disabled:opacity-40"
        >
          <Download className="h-4 w-4" /> Export CSV for Grants
        </button>
      </div>

      {/* Cumulative Impact Cards (strictly official sessions) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiMetricCard
          label="Landfill Diverted"
          labelColorClass="text-emerald-800"
          iconBgClass="bg-emerald-50 text-emerald-700"
          icon={<Leaf className="h-5 w-5" />}
          primaryValue={Math.round(totals.weightKg * 10) / 10}
          unitLabel="kg e-waste"
          caption="Estimated electronic & mechanical waste saved from landfill"
        />
        {/* Repair Success Rate Card */}
        <KpiMetricCard
          label="Success Rate"
          labelColorClass="text-blue-800"
          iconBgClass="bg-blue-50 text-blue-700"
          icon={<CheckCircle2 className="h-5 w-5" />}
          primaryValue={`${overallSuccessRate}%`}
          unitLabel={`(${totals.repairedCount} / ${totals.totalItems} items)`}
          caption="Items restored to working order or given partial repair"
        />
        {/* Volunteer Time Invested Card */}
        <KpiMetricCard
          label="Volunteer Effort"
          labelColorClass="text-purple-800"
          iconBgClass="bg-purple-50 text-purple-700"
          icon={<Clock className="h-5 w-5" />}
          primaryValue={Math.round((totals.repairMinutes / 60) * 10) / 10}
          unitLabel="hours"
          caption={`Dedicated by volunteer fixers across ${officialAnalytics.length} sessions`}
        />
        {/* Electrical Safety Screenings Card */}
        <KpiMetricCard
          label="PAT Screenings"
          labelColorClass="text-amber-800"
          iconBgClass="bg-amber-50 text-amber-700"
          icon={<Zap className="h-5 w-5" />}
          primaryValue={totals.patTested}
          unitLabel="appliances"
          caption="Class I & II 240V mains safety checks completed"
        />
      </div>

      {/* Category Breakdown Chart Card */}
      {categoryEntries.length > 0 && (
        <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-6">
          <h3 className="text-lg font-black text-slate-900 mb-4 flex items-center gap-2">
            <PieChart className="h-5 w-5 text-slate-600" />
            Repairs by Item Category
          </h3>
          {/* Horizontal progress bars for each item category */}
          <div className="space-y-3">
            {categoryEntries.map(([cat, count]) => {
              const pct = totals.totalItems > 0 ? Math.round((count / totals.totalItems) * 100) : 0;
              return (
                <div key={cat} className="space-y-1">
                  {/* Category name and item count label */}
                  <div className="flex justify-between text-xs font-bold text-slate-700">
                    <span>{cat}</span>
                    <span>
                      {count} items ({pct}%)
                    </span>
                  </div>
                  {/* Proportional progress bar */}
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
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          {/* Archive table title */}
          <h3 className="text-lg font-black text-slate-900 flex items-center gap-2">
            <Calendar className="h-5 w-5 text-slate-500" />
            Monthly Session Archive
          </h3>

          {/* Organiser toggle button to reveal or hide test sessions in the archive table */}
          {isAdmin && (testSessionCount > 0 || showTestSessions) && (
            <button
              type="button"
              onClick={() => setShowTestSessions((prev) => !prev)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border transition-colors ${
                showTestSessions
                  ? 'bg-amber-100 border-amber-300 text-amber-900'
                  : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
              }`}
            >
              {/* Amber flask icon and live test session count */}
              <FlaskConical className="h-3.5 w-3.5 text-amber-700" />
              {showTestSessions
                ? `Hide Test Sessions (${testSessionCount})`
                : `Show Test Sessions (${testSessionCount})`}
            </button>
          )}
        </div>

        {loading ? (
          <div className="py-8 text-center text-slate-500 text-sm">
            Loading session impact reports...
          </div>
        ) : visibleAnalytics.length === 0 ? (
          <div className="py-12 text-center text-slate-500 text-sm">
            {/* Empty state icon and helper text */}
            <Layers className="h-10 w-10 text-slate-300 mx-auto mb-3" />
            {analyticsList.length === 0
              ? 'No finalized sessions found yet. Once a session is closed and finalized at the Front Desk, its aggregated metrics and environmental savings will appear here.'
              : `No official finalized sessions found yet (${testSessionCount} test session${testSessionCount === 1 ? ' is' : 's are'} hidden from official impact metrics).`}
          </div>
        ) : (
          <div className="overflow-x-auto">
            {/* Archived sessions table */}
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-500 uppercase tracking-wider">
                <tr>
                  {/* Column headers for session metrics */}
                  <th className="py-3 px-4">Session Date</th>
                  <th className="py-3 px-4">Session Name</th>
                  <th className="py-3 px-4">Total Items</th>
                  <th className="py-3 px-4">Repaired</th>
                  <th className="py-3 px-4">Success Rate</th>
                  <th className="py-3 px-4">Weight Diverted</th>
                  <th className="py-3 px-4">Volunteer Hours</th>
                  {/* Additional column headers for attendance, PAT failure rate, and admin actions */}
                  <th className="py-3 px-4">Attending Volunteers</th>
                  <th className="py-3 px-4">PAT Fail Rate</th>
                  {isAdmin && <th className="py-3 px-4 text-right">Actions</th>}
                </tr>
              </thead>
              {/* Archived session rows */}
              <tbody className="divide-y divide-slate-100 font-medium">
                {visibleAnalytics.map((a) => (
                  <SessionArchiveRow
                    key={a.sessionId}
                    item={a}
                    isAdmin={isAdmin}
                    isUpdating={updatingSessionId === a.sessionId}
                    onToggleTestStatus={handleToggleTestStatus}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

