import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

const ROOT_DIR = path.resolve(__dirname, '..');

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

/**
 * Computes WCAG 2.x relative luminance for a 6-digit hex colour (#RRGGBB).
 */
function relativeLuminance(hex: string): number {
  const clean = hex.replace(/^#/, '');
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;

  const toLinear = (c: number): number =>
    c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);

  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/**
 * Computes the WCAG 2.x contrast ratio between two hex colours (1.0 to 21.0).
 */
function contrastRatio(foregroundHex: string, backgroundHex: string): number {
  const l1 = relativeLuminance(foregroundHex);
  const l2 = relativeLuminance(backgroundHex);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

describe('WCAG 2.2 Level AA Static Source Guardrails', () => {
  it('enforces document language and unrestricted pinch-to-zoom in index.html (WCAG 3.1.1, 1.4.4, 1.4.10)', () => {
    const html = readRepoFile('index.html');
    expect(html).toMatch(/<html\s+lang="en(-GB)?"/i);
    expect(html).toMatch(/<meta\s+name="viewport"\s+content="width=device-width,\s*initial-scale=1\.0"\s*\/>/);
    expect(html).not.toMatch(/user-scalable\s*=\s*no/i);
    expect(html).not.toMatch(/maximum-scale\s*=\s*1(\.0)?\b/i);
  });

  it('defines prefers-reduced-motion and :focus-visible rules in src/index.css (WCAG 2.3.3, 2.4.7)', () => {
    const css = readRepoFile('src/index.css');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toContain('animation-duration: 0.01ms !important');
    expect(css).toContain('transition-duration: 0.01ms !important');
    expect(css).toContain(':focus-visible');
    expect(css).toContain('outline: 2px solid var(--color-brand-600)');
  });

  it('includes skip-to-main-content link, focusable main landmark, and RouteTitleSynchronizer in src/App.tsx (WCAG 2.4.1, 2.4.2)', () => {
    const appSource = readRepoFile('src/App.tsx');
    expect(appSource).toContain('export const RouteTitleSynchronizer');
    expect(appSource).toContain('<RouteTitleSynchronizer />');
    expect(appSource).toContain('href="#main-content"');
    expect(appSource).toContain('Skip to main content');
    expect(appSource).toMatch(/<main\s+id="main-content"\s+tabIndex=\{-1\}/);
  });

  it('ensures every <label> across all views and components has an explicit htmlFor attribute (WCAG 1.3.1, 3.3.2, 4.1.2)', () => {
    const filesToCheck = [
      'src/views/CustomerRegisterView.tsx',
      'src/views/FrontDeskView.tsx',
      'src/views/PatStationView.tsx',
      'src/views/FixerStationView.tsx',
      'src/views/ReportsView.tsx',
      'src/components/frontdesk/VolunteerRegisterPanel.tsx',
      'src/components/frontdesk/SessionAttendanceBar.tsx',
      'src/components/pat/PatInstrumentModal.tsx',
      'src/components/common/PinModal.tsx',
      'src/components/common/PoliciesModal.tsx',
      'src/components/common/TermsModal.tsx',
      'src/components/common/PhotoViewerModal.tsx',
    ];

    for (const file of filesToCheck) {
      const source = readRepoFile(file);
      const labelMatches = source.match(/<label\b[^>]*>/g) || [];
      for (const labelTag of labelMatches) {
        expect(
          labelTag,
          `Expected <label> in ${file} to include htmlFor attribute, found: ${labelTag}`
        ).toMatch(/\bhtmlFor=/);
      }
    }
  });

  it('ensures every <th> in data tables declares scope="col" (WCAG 1.3.1)', () => {
    const tableFiles = [
      'src/views/ReportsView.tsx',
      'src/views/FrontDeskView.tsx',
      'src/components/frontdesk/VolunteerRegisterPanel.tsx',
    ];

    for (const file of tableFiles) {
      const source = readRepoFile(file);
      const thMatches = source.match(/<th\b[^>]*>/g) || [];
      expect(thMatches.length).toBeGreaterThan(0);
      for (const thTag of thMatches) {
        expect(
          thTag,
          `Expected <th> in ${file} to include scope="col", found: ${thTag}`
        ).toContain('scope="col"');
      }
    }
  });

  it('ensures all modal dialogs wire useDialogFocusTrap and declare role="dialog", aria-modal, and aria-labelledby (WCAG 2.1.2, 2.4.3, 4.1.2)', () => {
    const modalFiles = [
      'src/components/common/PinModal.tsx',
      'src/components/common/TermsModal.tsx',
      'src/components/common/PoliciesModal.tsx',
      'src/components/common/PhotoViewerModal.tsx',
      'src/components/pat/PatInstrumentModal.tsx',
      'src/components/frontdesk/VolunteerRegisterPanel.tsx',
      'src/components/frontdesk/SessionAttendanceBar.tsx',
      'src/views/FrontDeskView.tsx',
      'src/views/FixerStationView.tsx',
    ];

    for (const file of modalFiles) {
      const source = readRepoFile(file);
      expect(source, `${file} must import useDialogFocusTrap`).toContain('useDialogFocusTrap');
      expect(source, `${file} must declare dialog role`).toMatch(
        /role="dialog"|role=\{inline \? undefined : 'dialog'\}/
      );
      expect(source, `${file} must declare aria-modal`).toMatch(
        /aria-modal="true"|aria-modal=\{inline \? undefined : true\}/
      );
      expect(source, `${file} must declare aria-labelledby`).toContain('aria-labelledby=');
    }
  });

  it('verifies colour token pairs meet WCAG 1.4.3 minimum 4.5:1 normal text contrast ratio', () => {
    // slate-600 (#475569) on white (#ffffff) and slate-50 (#f8fafc)
    expect(contrastRatio('#475569', '#ffffff')).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio('#475569', '#f8fafc')).toBeGreaterThanOrEqual(4.5);
    // slate-700 (#334155) on slate-100 (#f1f5f9)
    expect(contrastRatio('#334155', '#f1f5f9')).toBeGreaterThanOrEqual(4.5);
    // amber-800 (#92400e) on amber-100 (#fef3c7) and amber-900 (#78350f) on amber-200 (#fde68a)
    expect(contrastRatio('#92400e', '#fef3c7')).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio('#78350f', '#fde68a')).toBeGreaterThanOrEqual(4.5);
    // emerald-900 (#064e3b) on emerald-100 (#d1fae5)
    expect(contrastRatio('#064e3b', '#d1fae5')).toBeGreaterThanOrEqual(4.5);
    // brand-800 (#166534) on brand-50 (#f0fdf4)
    expect(contrastRatio('#166534', '#f0fdf4')).toBeGreaterThanOrEqual(4.5);

    const statusBadgeSource = readRepoFile('src/components/common/StatusBadge.tsx');
    expect(statusBadgeSource).not.toContain('text-slate-500');
    expect(statusBadgeSource).not.toContain('text-amber-700');
  });

  it('verifies POL04-AccessibilityVPAT.md exists and includes ITI VPAT 2.5 Tables 1, 2, and 3', () => {
    const vpatSource = readRepoFile('src/policies/POL04-AccessibilityVPAT.md');
    expect(vpatSource).toContain('id: POL04');
    expect(vpatSource).toContain('Table 1: Success Criteria, Level A');
    expect(vpatSource).toContain('Table 2: Success Criteria, Level AA');
    expect(vpatSource).toContain('Table 3: Success Criteria, Level AAA');
  });
});
