import { describe, it, expect } from 'vitest';
import { SessionAnalytics } from '../src/types';
import { exportAnalyticsToCsv } from '../src/services/analyticsService';

describe('Analytics and CSV Export Utilities', () => {
  const sampleAnalytics: SessionAnalytics[] = [
    {
      sessionId: '202610-seears',
      sessionName: 'October 2026 - Seears Park',
      date: '2026-10-09',
      totalItems: 42,
      repairedCount: 31,
      partialCount: 5,
      unfixableCount: 4,
      adviceCount: 2,
      takenHomeCount: 0,
      totalRepairTimeMinutes: 1140, // 19 hours
      averageRepairTimeMinutes: 32,
      successRatePercent: 74,
      totalWeightDivertedKg: 68.4,
      categoryBreakdown: { ELECTRICAL: 25, MECHANICAL: 10, TEXTILE: 7 },
      mainsItemsCount: 22,
      patTestedCount: 22,
      patFailureRatePercent: 9
    }
  ];

  it('correctly generates CSV impact reports with all required fields', () => {
    const csv = exportAnalyticsToCsv(sampleAnalytics);
    expect(csv).toContain('Session ID,Session Name,Date,Total Items');
    expect(csv).toContain('"202610-seears","October 2026 - Seears Park","2026-10-09",42,31,5,4,2,0,74%,68.4,1140,32,22,22,9%');
  });

  it('handles empty analytics lists gracefully', () => {
    const csv = exportAnalyticsToCsv([]);
    expect(csv.split('\n')).toHaveLength(1); // Only header row
  });
});
