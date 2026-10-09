import { collection, getDocs, doc, getDoc, query, orderBy } from 'firebase/firestore';
import { db } from './firebase';
import { SessionAnalytics } from '../types';

/**
 * Fetch all session analytics summaries ordered by date descending.
 */
export async function listAllAnalytics(): Promise<SessionAnalytics[]> {
  const q = query(collection(db, 'analytics'), orderBy('date', 'desc'));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ sessionId: d.id, ...d.data() } as SessionAnalytics));
}

/**
 * Fetch a specific session analytics document.
 */
export async function getSessionAnalytics(sessionId: string): Promise<SessionAnalytics | null> {
  const snap = await getDoc(doc(db, 'analytics', sessionId));
  if (!snap.exists()) return null;
  return snap.data() as SessionAnalytics;
}

/**
 * Converts analytics records into a downloadable CSV string.
 */
export function exportAnalyticsToCsv(analyticsList: SessionAnalytics[]): string {
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
    'Success Rate (%)',
    'Total Weight Diverted (kg)',
    'Total Repair Time (mins)',
    'Average Repair Time (mins)',
    'Mains Powered Count',
    'PAT Tested Count',
    'PAT Failure Rate (%)'
  ];

  const rows = analyticsList.map(a => [
    `"${a.sessionId}"`,
    `"${a.sessionName}"`,
    `"${a.date}"`,
    a.totalItems,
    a.repairedCount,
    a.partialCount,
    a.unfixableCount,
    a.adviceCount,
    a.takenHomeCount,
    `${a.successRatePercent}%`,
    a.totalWeightDivertedKg,
    a.totalRepairTimeMinutes || 0,
    a.averageRepairTimeMinutes || 0,
    a.mainsItemsCount,
    a.patTestedCount,
    `${a.patFailureRatePercent}%`
  ]);

  return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
}

/**
 * Triggers a browser download of the CSV data.
 */
export function triggerCsvDownload(csvContent: string, filename = 'repair-cafe-impact-report.csv'): void {
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
