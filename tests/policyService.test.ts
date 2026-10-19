import { describe, it, expect } from 'vitest';
import {
  parsePolicyMarkdown,
  isTemplatePolicy,
  filterActivePolicies,
  getPolicies,
  getPolicyById,
} from '../src/services/policyService';

describe('Policy Service & Frontmatter Filtering', () => {
  it('parses frontmatter metadata and markdown body from raw policy markdown', () => {
    // Sample policy markdown with standard YAML frontmatter
    const raw = `---
id: POL01
title: Health & Safety Policy
version: "1.2"
lastUpdated: "2026-10-01"
category: Safety
---
# Health & Safety Policy

Always unplug appliances before opening casings.`;

    // Parse raw markdown via pure helper
    const parsed = parsePolicyMarkdown('../policies/POL01-HealthAndSafety.md', raw);
    expect(parsed.id).toBe('POL01');
    expect(parsed.title).toBe('Health & Safety Policy');
    expect(parsed.version).toBe('1.2');
    expect(parsed.lastUpdated).toBe('2026-10-01');
    expect(parsed.category).toBe('Safety');
    expect(parsed.content).toContain('# Health & Safety Policy');
    expect(parsed.content).not.toContain('lastUpdated:');
  });

  it('falls back to filename stem and H1 heading when YAML frontmatter is absent', () => {
    // Markdown without frontmatter block
    const raw = `# Safeguarding Policy

Treat all visitors with dignity and respect.`;

    // Parse fallback metadata from path and H1
    const parsed = parsePolicyMarkdown('../policies/POL99-Custom.md', raw);
    expect(parsed.id).toBe('POL99-Custom');
    expect(parsed.title).toBe('Safeguarding Policy');
    expect(parsed.version).toBe('1.0');
    expect(parsed.category).toBe('General');
  });

  it('identifies template policies case-insensitively via isTemplatePolicy', () => {
    // Verify template variations return true
    expect(isTemplatePolicy({ category: 'Template' })).toBe(true);
    expect(isTemplatePolicy({ category: 'template' })).toBe(true);
    expect(isTemplatePolicy({ category: '  TEMPLATE  ' })).toBe(true);

    // Verify active policy categories return false
    expect(isTemplatePolicy({ category: 'Safety' })).toBe(false);
    expect(isTemplatePolicy({ category: 'Governance' })).toBe(false);
    expect(isTemplatePolicy({ category: 'Privacy' })).toBe(false);
  });

  it('excludes template policies and sorts active policies by id in filterActivePolicies', () => {
    // Construct unsorted list including a Template policy
    const rawList = [
      {
        id: 'POL02',
        title: 'Safeguarding',
        version: '1.0',
        lastUpdated: '2026-10-01',
        category: 'Governance',
        content: '# Safeguarding',
      },
      {
        id: 'POL00',
        title: 'Template Policy',
        version: '1.0',
        lastUpdated: '2026-10-01',
        category: 'Template',
        content: '# Template',
      },
      {
        id: 'POL01',
        title: 'Health & Safety',
        version: '1.0',
        lastUpdated: '2026-10-01',
        category: 'Safety',
        content: '# Health & Safety',
      },
    ];

    // Filter out templates and sort by ID
    const active = filterActivePolicies(rawList);
    expect(active.map((p) => p.id)).toEqual(['POL01', 'POL02']);
  });

  it('loads bundled policies via getPolicies and automatically excludes POL00-Template.md', () => {
    // Load build-time enumerated policies
    const policies = getPolicies();
    const ids = policies.map((p) => p.id);

    // Verify POL00 template is always excluded from active policies
    expect(ids).not.toContain('POL00');
    expect(getPolicyById('POL00')).toBeUndefined();

    // Verify the tracked POL04 Accessibility VPAT 2.5 report is always present
    expect(ids).toContain('POL04');
    expect(getPolicyById('POL04')?.title).toContain('Accessibility Conformance Report');

    // When local operational policy files are present, verify their IDs and metadata
    if (ids.includes('POL01')) {
      expect(ids).toEqual(['POL01', 'POL02', 'POL03', 'POL04']);
      expect(getPolicyById('POL01')?.title).toContain('Health and Safety');
      expect(getPolicyById('POL02')?.title).toContain('Safeguarding');
      expect(getPolicyById('POL03')?.title).toContain('Whistleblowing');
    }
  });
});
