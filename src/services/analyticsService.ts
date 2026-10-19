/**
 * @file src/services/analyticsService.ts
 *
 * Historical analytics queries, test-session filtering (`filterAnalyticsForReporting`),
 * and CSV impact report generation (`exportAnalyticsToCsv`) for council and grant reporting.
 */

import { collection, getDocs, doc, getDoc, query, orderBy } from 'firebase/firestore';
import { db } from './firebase';
import { SessionAnalytics } from '../types';

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
