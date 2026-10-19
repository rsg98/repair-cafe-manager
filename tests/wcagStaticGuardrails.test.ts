import { describe, it, expect } from 'vitest';
import { parsePolicyMarkdown, getPolicyById } from '../src/services/policyService';

/**
 * Eagerly load project source files as raw strings via Vite's native glob import
 * so static WCAG guardrails work identically in Vitest and strict browser TypeScript (`tsc`).
 */
const rawHtmlFiles = import.meta.glob<string>('../index.html', {
  query: '?raw',
  import: 'default',
  eager: true,
});

const rawCssFiles = import.meta.glob<string>('../src/index.css', {
  query: '?raw',
  import: 'default',
  eager: true,
});

const rawPolicyFiles = import.meta.glob<string>('../src/policies/POL04-AccessibilityVPAT.md', {
  query: '?raw',
  import: 'default',
  eager: true,
});

const rawAppFiles = import.meta.glob<string>('../src/App.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
});

const rawViewAndComponentFiles = import.meta.glob<string>(
  ['../src/views/**/*.tsx', '../src/components/**/*.tsx'],
  {
    query: '?raw',
    import: 'default',
    eager: true,
  }
);

describe('WCAG 2.2 Level AA — Layer 1 Static Source Guardrails', () => {
  it('allows pinch-to-zoom in index.html without user-scalable=no or maximum-scale=1 (WCAG 1.4.4)', () => {
    const indexHtml = rawHtmlFiles['../index.html'];
    expect(indexHtml).toBeDefined();
    expect(indexHtml).toContain('name="viewport"');
    expect(indexHtml).toContain('width=device-width, initial-scale=1.0');
    expect(indexHtml).not.toMatch(/user-scalable\s*=\s*no/i);
    expect(indexHtml).not.toMatch(/maximum-scale\s*=\s*1(\.0)?(\s|,|"|$)/i);
  });

  it('enforces touch-action: manipulation, :focus-visible outline, and prefers-reduced-motion in src/index.css (WCAG 2.4.7, 2.3.3)', () => {
    const indexCss = rawCssFiles['../src/index.css'];
    expect(indexCss).toBeDefined();
    expect(indexCss).toContain('touch-action: manipulation');
    expect(indexCss).toContain(':focus-visible');
    expect(indexCss).toContain('outline: 2px solid var(--color-brand-600)');
    expect(indexCss).toContain('prefers-reduced-motion: reduce');
  });

  it('ensures every modal with role="dialog" declares aria-modal="true" and aria-labelledby (WCAG 4.1.2)', () => {
    const tsxEntries = Object.entries(rawViewAndComponentFiles);
    expect(tsxEntries.length).toBeGreaterThan(0);
    let totalDialogsChecked = 0;

    for (const [relPath, content] of tsxEntries) {
      const dialogMatches = [...content.matchAll(/role="dialog"/g)];
      for (const match of dialogMatches) {
        totalDialogsChecked++;
        const startIdx = Math.max(0, (match.index ?? 0) - 350);
        const endIdx = Math.min(content.length, (match.index ?? 0) + 350);
        const surroundingTagWindow = content.slice(startIdx, endIdx);

        expect(
          surroundingTagWindow,
          `${relPath} has role="dialog" without aria-modal="true"`
        ).toContain('aria-modal="true"');
        expect(
          surroundingTagWindow,
          `${relPath} has role="dialog" without aria-labelledby`
        ).toContain('aria-labelledby=');
      }
    }

    expect(totalDialogsChecked).toBeGreaterThanOrEqual(14);
  });

  it('verifies POL04-AccessibilityVPAT.md exists with valid frontmatter and VPAT 2.5 Tables 1, 2, and 3', () => {
    const raw = rawPolicyFiles['../src/policies/POL04-AccessibilityVPAT.md'];
    expect(raw).toBeDefined();

    const parsed = parsePolicyMarkdown('../src/policies/POL04-AccessibilityVPAT.md', raw);
    expect(parsed.id).toBe('POL04');
    expect(parsed.title).toContain('Accessibility Conformance Report');
    expect(parsed.version).toBe('2.5');
    expect(parsed.category).toBe('Accessibility');

    // Verify all three VPAT 2.5 tables are present
    expect(parsed.content).toContain('Table 1: Success Criteria, Level A');
    expect(parsed.content).toContain('Table 2: Success Criteria, Level AA');
    expect(parsed.content).toContain('Table 3: Success Criteria, Level AAA');

    // Verify key WCAG 2.2 criteria are documented in the report
    expect(parsed.content).toContain('2.4.11 Focus Not Obscured (Minimum)');
    expect(parsed.content).toContain('2.5.7 Dragging Movements');
    expect(parsed.content).toContain('2.5.8 Target Size (Minimum)');
    expect(parsed.content).toContain('3.2.6 Consistent Help');
    expect(parsed.content).toContain('3.3.7 Redundant Entry');
    expect(parsed.content).toContain('3.3.8 Accessible Authentication (Minimum)');

    // Verify policyService exposes POL04
    const bundled = getPolicyById('POL04');
    expect(bundled).toBeDefined();
    expect(bundled?.id).toBe('POL04');
  });

  it('ensures no orphaned <label> elements exist without htmlFor or a nested form control (WCAG 1.3.1, 4.1.2)', () => {
    const tsxEntries = Object.entries(rawViewAndComponentFiles);
    const orphanedLabels: string[] = [];

    for (const [relPath, content] of tsxEntries) {
      // Match all <label ...>...</label> blocks across lines
      const labelRegex = /<label\b([^>]*)>([\s\S]*?)<\/label>/g;
      let match: RegExpExecArray | null;
      while ((match = labelRegex.exec(content)) !== null) {
        const attrs = match[1];
        const inner = match[2];
        const hasHtmlFor = /\bhtmlFor\s*=/.test(attrs);
        const wrapsControl = /<(input|select|textarea)\b/.test(inner);
        if (!hasHtmlFor && !wrapsControl) {
          const lineNum = content.slice(0, match.index).split('\n').length;
          orphanedLabels.push(`${relPath}:${lineNum}`);
        }
      }
    }

    expect(orphanedLabels).toEqual([]);
  });

  it('preserves Issue #28 credit card autofill prevention attributes on repair item lookup inputs', () => {
    const frontDesk = rawViewAndComponentFiles['../src/views/FrontDeskView.tsx'];
    const patStation = rawViewAndComponentFiles['../src/views/PatStationView.tsx'];
    const fixerStation = rawViewAndComponentFiles['../src/views/FixerStationView.tsx'];

    expect(frontDesk).toContain('id="frontdesk-assign-item-token"');
    expect(frontDesk).toContain('{...REPAIR_ITEM_LOOKUP_INPUT_PROPS}');
    expect(patStation).toContain('id="pat-repair-item-lookup"');
    expect(patStation).toContain('{...REPAIR_ITEM_LOOKUP_INPUT_PROPS}');
    expect(fixerStation).toContain('id="fixer-repair-item-lookup"');
    expect(fixerStation).toContain('{...REPAIR_ITEM_LOOKUP_INPUT_PROPS}');
  });

  it('ensures MarkdownViewer renders semantic <table>, <thead>, <th scope="col">, and <tbody> elements (WCAG 1.3.1)', () => {
    const markdownViewer = rawViewAndComponentFiles['../src/components/common/MarkdownViewer.tsx'];
    expect(markdownViewer).toContain('<table');
    expect(markdownViewer).toContain('<thead');
    expect(markdownViewer).toContain('scope="col"');
    expect(markdownViewer).toContain('<tbody');
  });

  it('ensures App.tsx includes a skip-to-main-content link, <main id="main-content">, and RouteTitleSynchronizer (WCAG 2.4.1, 2.4.2)', () => {
    const appTsx = rawAppFiles['../src/App.tsx'];
    expect(appTsx).toContain('href="#main-content"');
    expect(appTsx).toContain('Skip to main content');
    expect(appTsx).toContain('<main id="main-content"');
    expect(appTsx).toContain('RouteTitleSynchronizer');
  });
});
