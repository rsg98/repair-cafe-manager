import { describe, it, expect } from 'vitest';

async function readRepoFile(relativePath: string): Promise<string> {
  const fsModule: string = 'node:fs';
  const fs = (await import(/* @vite-ignore */ fsModule)) as {
    readFileSync: (fileUrl: URL, encoding: string) => string;
  };
  return fs.readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8');
}

const tsxModules = import.meta.glob('../src/{views,components}/**/*.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

function getTsxFiles(): Array<{ path: string; content: string }> {
  return Object.entries(tsxModules).map(([path, content]) => ({
    path: path.replace(/^\.\.\//, ''),
    content,
  }));
}

describe('WCAG 2.2 AA Static Guardrails (Layer 1)', () => {
  it('1. index.html viewport meta allows pinch-to-zoom and text scaling (WCAG 1.4.4)', async () => {
    const html = await readRepoFile('index.html');
    const viewportMatch = html.match(/<meta[^>]*name=["']viewport["'][^>]*>/i);
    expect(viewportMatch).not.toBeNull();
    const viewportTag = viewportMatch![0];
    expect(viewportTag).not.toMatch(/user-scalable\s*=\s*no/i);
    expect(viewportTag).not.toMatch(/maximum-scale\s*=\s*1(\.0)?([^\d]|$)/i);
  });

  it('2. src/index.css defines touch-action: manipulation on interactive controls', async () => {
    const css = await readRepoFile('src/index.css');
    expect(css).toContain('touch-action: manipulation');
  });

  it('3. src/index.css defines global :focus-visible outline ring (WCAG 2.4.7 / 2.4.11)', async () => {
    const css = await readRepoFile('src/index.css');
    expect(css).toContain(':focus-visible');
    expect(css).toMatch(/outline:\s*2px\s+solid\s+var\(--color-brand-600\)/);
  });

  it('4. src/index.css respects prefers-reduced-motion: reduce (WCAG 2.3.3)', async () => {
    const css = await readRepoFile('src/index.css');
    expect(css).toContain('prefers-reduced-motion: reduce');
    expect(css).toContain('animation-duration: 0.01ms !important');
    expect(css).toContain('transition-duration: 0.01ms !important');
  });

  it('5. every role="dialog" across src/views/ and src/components/ has aria-modal="true" and aria-labelledby (WCAG 4.1.2)', () => {
    const files = getTsxFiles();
    expect(files.length).toBeGreaterThan(0);

    let dialogCount = 0;
    const violations: string[] = [];

    for (const file of files) {
      const dialogRegex = /<[a-zA-Z0-9]+[^>]*role=["']dialog["'][^>]*>/g;
      let match: RegExpExecArray | null;
      while ((match = dialogRegex.exec(file.content)) !== null) {
        dialogCount++;
        const openingTag = match[0];
        if (!/aria-modal=["']true["']/.test(openingTag)) {
          violations.push(`${file.path}: role="dialog" missing aria-modal="true" -> ${openingTag}`);
        }
        if (!/aria-labelledby=/.test(openingTag)) {
          violations.push(`${file.path}: role="dialog" missing aria-labelledby -> ${openingTag}`);
        }
      }
    }

    expect(dialogCount).toBeGreaterThanOrEqual(11);
    expect(violations).toEqual([]);
  });

  it('6. POL04-AccessibilityVPAT.md exists with valid frontmatter and ITI VPAT 2.5 Tables 1, 2, and 3', async () => {
    const vpat = await readRepoFile('src/policies/POL04-AccessibilityVPAT.md');

    expect(vpat).toMatch(/^---\s*\n[\s\S]*?id:\s*POL04[\s\S]*?\n---/);
    expect(vpat).toContain('Table 1: Success Criteria, Level A');
    expect(vpat).toContain('Table 2: Success Criteria, Level AA');
    expect(vpat).toContain('Table 3: Success Criteria, Level AAA');
    expect(vpat).toContain('2.4.11 Focus Not Obscured (Minimum)');
    expect(vpat).toContain('2.5.7 Dragging Movements');
    expect(vpat).toContain('2.5.8 Target Size (Minimum)');
    expect(vpat).toContain('3.2.6 Consistent Help');
    expect(vpat).toContain('3.3.7 Redundant Entry');
    expect(vpat).toContain('3.3.8 Accessible Authentication (Minimum)');
  });

  it('7. no orphaned <label> elements exist without htmlFor or wrapped form control (WCAG 1.3.1 / 4.1.2)', () => {
    const files = getTsxFiles();
    const violations: string[] = [];

    for (const file of files) {
      const labelRegex = /<label\b([^>]*)>([\s\S]*?)<\/label>/g;
      let match: RegExpExecArray | null;
      while ((match = labelRegex.exec(file.content)) !== null) {
        const attrs = match[1];
        const inner = match[2];
        const hasHtmlFor = /\bhtmlFor=/.test(attrs);
        const wrapsControl = /<(input|select|textarea)\b/.test(inner);
        if (!hasHtmlFor && !wrapsControl) {
          violations.push(
            `${file.path}: orphaned <label> without htmlFor or nested control: <label${attrs}>`
          );
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it('8. no readable text uses low-contrast text-slate-400 across views and components (WCAG 1.4.3)', () => {
    const files = getTsxFiles();
    const violations: string[] = [];

    for (const file of files) {
      const lines = file.content.split('\n');
      lines.forEach((line, idx) => {
        if (/\btext-slate-400\b/.test(line) && !/placeholder:text-slate-400/.test(line)) {
          violations.push(`${file.path}:${idx + 1}: ${line.trim()}`);
        }
      });
    }

    expect(violations).toEqual([]);
  });
});
