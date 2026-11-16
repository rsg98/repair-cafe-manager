/**
 * @file src/services/analyticsService.ts
 *
 * Historical analytics queries, test-session filtering (`filterAnalyticsForReporting`),
 * and CSV impact report generation (`exportAnalyticsToCsv`) for council and grant reporting.
 */

import { collection, getDocs, doc, getDoc, query, orderBy } from 'firebase/firestore';
import { db } from './firebase';
import { SessionAnalytics } from '../types';
import { cafeConfig } from '../config/cafe.config';

/** Aggregated totals computed across official finalised Repair Café sessions. */
export interface OfficialImpactTotals {
  totalItems: number;
  repairedCount: number;
  weightKg: number;
  repairMinutes: number;
  repairHours: number;
  patTested: number;
  totalVolunteers: number;
  totalVolunteerHours: number;
  categories: Record<string, number>;
}

/**
 * Resolves the effective session length in hours for an analytics or session record,
 * falling back to `cafeConfig.defaultSessionDurationHours` for legacy sessions (Issue #42).
 */
export function resolveSessionDurationHours(
  durationHours?: number,
  fallbackHours: number = cafeConfig.defaultSessionDurationHours
): number {
  if (typeof durationHours === 'number' && Number.isFinite(durationHours) && durationHours > 0) {
    return Math.round(durationHours * 100) / 100;
  }
  return Math.round(fallbackHours * 100) / 100;
}

/**
 * Resolves the total attendee volunteer hours (`volunteerCount × sessionDurationHours`)
 * for a single session analytics record, computing the fallback product when legacy
 * finalized sessions omit `totalVolunteerHours` (Issue #42).
 */
export function resolveSessionVolunteerHours(
  analytics: Pick<SessionAnalytics, 'volunteerCount' | 'sessionDurationHours' | 'totalVolunteerHours'>,
  fallbackHours: number = cafeConfig.defaultSessionDurationHours
): number {
  if (
    typeof analytics.totalVolunteerHours === 'number' &&
    Number.isFinite(analytics.totalVolunteerHours) &&
    analytics.totalVolunteerHours >= 0
  ) {
    return Math.round(analytics.totalVolunteerHours * 10) / 10;
  }
  const count = Math.max(0, analytics.volunteerCount ?? 0);
  const duration = resolveSessionDurationHours(analytics.sessionDurationHours, fallbackHours);
  return Math.round(count * duration * 10) / 10;
}

/**
 * Pure helper that aggregates cumulative community impact metrics — including both
 * active bench `repairHours` and attendee `totalVolunteerHours` — across official sessions.
 */
export function computeOfficialImpactTotals(
  officialAnalytics: SessionAnalytics[],
  fallbackHours: number = cafeConfig.defaultSessionDurationHours
): OfficialImpactTotals {
  // Sum item counts, weights, bench repair minutes, attendee volunteer hours, and categories
  const raw = officialAnalytics.reduce<OfficialImpactTotals>(
    (acc, curr) => {
      acc.totalItems += curr.totalItems || 0;
      acc.repairedCount += curr.repairedCount || 0;
      acc.weightKg += curr.totalWeightDivertedKg || 0;
      acc.repairMinutes += curr.totalRepairTimeMinutes || 0;
      acc.patTested += curr.patTestedCount || 0;
      acc.totalVolunteers += curr.volunteerCount || 0;
      acc.totalVolunteerHours += resolveSessionVolunteerHours(curr, fallbackHours);

      // Aggregate item counts by category across all official finalised sessions
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
      repairHours: 0,
      patTested: 0,
      totalVolunteers: 0,
      totalVolunteerHours: 0,
      categories: {},
    }
  );

  // Round floating-point sums cleanly to 1 decimal place
  return {
    ...raw,
    weightKg: Math.round(raw.weightKg * 10) / 10,
    repairHours: Math.round((raw.repairMinutes / 60) * 10) / 10,
    totalVolunteerHours: Math.round(raw.totalVolunteerHours * 10) / 10,
  };
}

/**
 * Fetch all session analytics summaries ordered by date descending.
 */
export async function listAllAnalytics(): Promise<SessionAnalytics[]> {
  // Query top-level analytics documents sorted newest first
  const q = query(collection(db, 'analytics'), orderBy('date', 'desc'));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ sessionId: d.id, ...d.data() } as SessionAnalytics));
}

/**
 * Fetch a specific session analytics document.
 */
export async function getSessionAnalytics(sessionId: string): Promise<SessionAnalytics | null> {
  // Perform a single point read against analytics/{sessionId}
  const snap = await getDoc(doc(db, 'analytics', sessionId));
  if (!snap.exists()) return null;
  return snap.data() as SessionAnalytics;
}

/**
 * Filters session analytics records, excluding test sessions (`isTest === true`)
 * unless `includeTestSessions` is explicitly true (Issue #24).
 */
export function filterAnalyticsForReporting(
  analyticsList: SessionAnalytics[],
  includeTestSessions = false
): SessionAnalytics[] {
  // Return all sessions when an organiser explicitly toggles test session visibility
  if (includeTestSessions) {
    return analyticsList;
  }
  // Exclude test sessions by default while retaining legacy records where isTest is undefined
  return analyticsList.filter((a) => !a.isTest);
}

/**
 * Converts analytics records into a downloadable CSV string.
 */
export function exportAnalyticsToCsv(analyticsList: SessionAnalytics[]): string {
  // Define identity and repair outcome count columns
  const headers = [
    'Session ID',
    'Session Name',
    'Date',
    'Total Items',
    'Repaired Count',
    'Partial Count',
    'Unfixable Count',
    'Advice Count',
    'Taken Home Count',
    // Define diversion weight, duration, electrical PAT safety, and volunteer columns
    'Success Rate (%)',
    'Total Weight Diverted (kg)',
    'Total Repair Time (mins)',
    'Average Repair Time (mins)',
    'Mains Powered Count',
    'PAT Tested Count',
    'PAT Failure Rate (%)',
    'Attending Volunteers',
    'Session Length (hrs)',
    'Total Volunteer Hours',
  ];

  // Format each session analytics summary into a comma-separated row
  const rows = analyticsList.map((a) => [
    `"${a.sessionId}"`,
    `"${a.sessionName}"`,
    `"${a.date}"`,
    a.totalItems,
    a.repairedCount,
    a.partialCount,
    a.unfixableCount,
    a.adviceCount,
    a.takenHomeCount,
    // Format percentage, weight, duration, PAT safety, and volunteer columns matching headers
    `${a.successRatePercent}%`,
    a.totalWeightDivertedKg,
    a.totalRepairTimeMinutes || 0,
    a.averageRepairTimeMinutes || 0,
    a.mainsItemsCount,
    a.patTestedCount,
    `${a.patFailureRatePercent}%`,
    a.volunteerCount ?? 0,
    resolveSessionDurationHours(a.sessionDurationHours),
    resolveSessionVolunteerHours(a),
  ]);

  // Join header row and data rows with newlines
  return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
}

/**
 * Triggers a browser download of the CSV data.
 */
export function triggerCsvDownload(
  csvContent: string,
  filename = 'repair-cafe-impact-report.csv'
): void {
  // Create a UTF-8 CSV Blob and temporary object URL
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  // Append temporary anchor, trigger browser download, and revoke the object URL
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
