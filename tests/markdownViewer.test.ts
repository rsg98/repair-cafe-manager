import { describe, it, expect } from 'vitest';
import React from 'react';
import { parseInline, MarkdownViewer } from '../src/components/common/MarkdownViewer';
import { cafeConfig } from '../src/config/cafe.config';

describe('MarkdownViewer & Inline Parsing', () => {
  describe('parseInline', () => {
    it('returns raw text unchanged when no markdown tokens exist', () => {
      const result = parseInline('Plain text without formatting');
      expect(result).toHaveLength(1);
      expect(result[0]).toBe('Plain text without formatting');
    });

    it('parses bold tokens (**text**)', () => {
      const result = parseInline('This is **bold** text');
      expect(result).toHaveLength(3);
      expect(result[0]).toBe('This is ');
      expect(React.isValidElement(result[1])).toBe(true);
      const boldElem = result[1] as React.ReactElement<{ children: React.ReactNode }>;
      expect(boldElem.type).toBe('strong');
      expect(boldElem.props.children).toBe('bold');
      expect(result[2]).toBe(' text');
    });

    it('parses italic tokens (*text*)', () => {
      const result = parseInline('This is *italic* text');
      expect(result).toHaveLength(3);
      expect(result[0]).toBe('This is ');
      expect(React.isValidElement(result[1])).toBe(true);
      const italicElem = result[1] as React.ReactElement<{ children: React.ReactNode }>;
      expect(italicElem.type).toBe('em');
      expect(italicElem.props.children).toBe('italic');
      expect(result[2]).toBe(' text');
    });

    it('parses inline code tokens (`code`)', () => {
      const result = parseInline('Check `DANGER_DO_NOT_ENERGIZE` status');
      expect(result).toHaveLength(3);
      expect(result[0]).toBe('Check ');
      expect(React.isValidElement(result[1])).toBe(true);
      const codeElem = result[1] as React.ReactElement<{ children: React.ReactNode }>;
      expect(codeElem.type).toBe('code');
      expect(codeElem.props.children).toBe('DANGER_DO_NOT_ENERGIZE');
      expect(result[2]).toBe(' status');
    });

    it('parses markdown links ([text](url))', () => {
      const result = parseInline('Visit [Sutton Repair Café](https://suttonrepaircafe.org.uk) today');
      expect(result).toHaveLength(3);
      expect(result[0]).toBe('Visit ');
      expect(React.isValidElement(result[1])).toBe(true);
      const linkElem = result[1] as React.ReactElement<{ href: string; children: React.ReactNode }>;
      expect(linkElem.type).toBe('a');
      expect(linkElem.props.href).toBe('https://suttonrepaircafe.org.uk');
      expect(linkElem.props.children).toBe('Sutton Repair Café');
      expect(result[2]).toBe(' today');
    });
  });

  describe('MarkdownViewer rendering structure', () => {
    it('creates a valid React element tree for complex markdown', () => {
      const markdown = `
# Main Title
> Welcome to our community space.

---

## 1. Safety Rules
* **Class I:** Earth continuity required.
* **Class II:** Double insulated.

1. First step
2. Second step

Paragraph of terms with [link](https://example.com) and \`code\`.
`;

      const viewer = MarkdownViewer({ content: markdown });
      expect(React.isValidElement(viewer)).toBe(true);
      if (!React.isValidElement(viewer)) {
        throw new Error('Expected viewer to be a valid React element');
      }
      const viewerElem = viewer as React.ReactElement<{ className?: string; children?: React.ReactElement<{ type: string }>[] }>;
      expect(viewerElem.props.className).toContain('markdown-body');
      
      const children = viewerElem.props.children || [];
      expect(Array.isArray(children)).toBe(true);
      expect(children.length).toBeGreaterThan(0);

      // Verify that h1, blockquote, hr, h2, ul, ol, and p elements were generated
      const types = children.map((c) => c.type);
      expect(types).toContain('h1');
      expect(types).toContain('blockquote');
      expect(types).toContain('hr');
      expect(types).toContain('h2');
      expect(types).toContain('ul');
      expect(types).toContain('ol');
      expect(types).toContain('p');
    });
  });

  describe('Cafe Configuration termsAndConditions', () => {
    it('points to a markdown document path', () => {
      expect(cafeConfig.termsAndConditions).toBe('/terms.md');
      expect(cafeConfig.termsVersion).toBeDefined();
    });
  });
});
