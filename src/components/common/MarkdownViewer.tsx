import React from 'react';

/**
 * Parses inline Markdown formatting:
 * - Links: [text](url)
 * - Bold: **text**
 * - Italic: *text*
 * - Inline Code: `code`
 */
export function parseInline(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  // Matches inline code, links, bold, and italic tokens
  const tokenRegex = /(`[^`]+`|\[[^\]]+\]\([^)]+\)|\*\*[^*]+\*\*|\*[^*]+\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = tokenRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }

    const token = match[0];

    if (token.startsWith('`') && token.endsWith('`')) {
      parts.push(
        <code
          key={`code-${key++}`}
          className="bg-slate-100 text-slate-800 px-1.5 py-0.5 rounded text-xs font-mono font-medium border border-slate-200"
        >
          {token.slice(1, -1)}
        </code>
      );
    } else if (token.startsWith('[') && token.includes('](') && token.endsWith(')')) {
      const splitIdx = token.indexOf('](');
      const label = token.slice(1, splitIdx);
      const url = token.slice(splitIdx + 2, -1);
      parts.push(
        <a
          key={`link-${key++}`}
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-brand-600 font-semibold underline hover:text-brand-800 transition-colors"
        >
          {label}
        </a>
      );
    } else if (token.startsWith('**') && token.endsWith('**')) {
      parts.push(
        <strong key={`bold-${key++}`} className="font-bold text-slate-900">
          {token.slice(2, -2)}
        </strong>
      );
    } else if (token.startsWith('*') && token.endsWith('*')) {
      parts.push(
        <em key={`italic-${key++}`} className="italic text-slate-700">
          {token.slice(1, -1)}
        </em>
      );
    } else {
      parts.push(token);
    }

    lastIndex = tokenRegex.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length > 0 ? parts : [text];
}

interface MarkdownViewerProps {
  content: string;
  className?: string;
}

/**
 * Strips an optional leading YAML frontmatter block (`--- ... ---`) anchored strictly
 * at line 1 of a Markdown document while preserving mid-document `---` horizontal rules.
 */
export function stripYamlFrontmatter(content: string): string {
  // Match optional BOM followed by opening --- on line 1, frontmatter body, and closing ---
  const frontmatterRegex = /^(\uFEFF)?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;
  return content.replace(frontmatterRegex, '');
}

const TABLE_DELIMITER_REGEX = /^\s*\|?(\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?\s*$/;

/**
 * Detects whether `lines[idx]` and `lines[idx + 1]` form the header and delimiter rows
 * of a GitHub Flavored Markdown (GFM) pipe table.
 */
function isTableStart(lines: string[], idx: number): boolean {
  if (idx + 1 >= lines.length) {
    return false;
  }
  return lines[idx].includes('|') && TABLE_DELIMITER_REGEX.test(lines[idx + 1]);
}

/**
 * Splits a single GFM pipe table row into trimmed cell strings while respecting escaped `\|`.
 */
function parseTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split(/(?<!\\)\|/).map((cell) => cell.replace(/\\\|/g, '|').trim());
}

/**
 * Lightweight, safe React Markdown Renderer for document viewing without external libraries
 */
export const MarkdownViewer: React.FC<MarkdownViewerProps> = ({ content, className = '' }) => {
  // Strip any leading YAML frontmatter block before splitting into lines
  const bodyContent = stripYamlFrontmatter(content);
  const lines = bodyContent.replace(/\r\n/g, '\n').split('\n');
  const elements: React.ReactNode[] = [];
  let i = 0;
  let elementKey = 0;

  while (i < lines.length) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();

    // 1. Skip blank lines
    if (!trimmed) {
      i++;
      continue;
    }

    // 2. Horizontal divider
    if (trimmed === '---' || trimmed === '***' || trimmed === '___') {
      elements.push(<hr key={`hr-${elementKey++}`} className="my-4 border-slate-200" />);
      i++;
      continue;
    }

    // 3. Headings
    if (trimmed.startsWith('# ')) {
      elements.push(
        <h1 key={`h1-${elementKey++}`} className="text-xl sm:text-2xl font-extrabold text-slate-900 mt-6 mb-3 tracking-tight">
          {parseInline(trimmed.slice(2).trim())}
        </h1>
      );
      i++;
      continue;
    }
    if (trimmed.startsWith('## ')) {
      elements.push(
        <h2 key={`h2-${elementKey++}`} className="text-lg sm:text-xl font-bold text-slate-900 mt-5 mb-2 pb-1 border-b border-slate-200">
          {parseInline(trimmed.slice(3).trim())}
        </h2>
      );
      i++;
      continue;
    }
    if (trimmed.startsWith('### ')) {
      elements.push(
        <h3 key={`h3-${elementKey++}`} className="text-base sm:text-lg font-bold text-slate-800 mt-4 mb-1.5">
          {parseInline(trimmed.slice(4).trim())}
        </h3>
      );
      i++;
      continue;
    }
    if (trimmed.startsWith('#### ')) {
      elements.push(
        <h4 key={`h4-${elementKey++}`} className="text-sm sm:text-base font-semibold text-slate-800 mt-3 mb-1">
          {parseInline(trimmed.slice(5).trim())}
        </h4>
      );
      i++;
      continue;
    }

    // 4. Blockquotes
    if (trimmed.startsWith('>')) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        const textInQuote = lines[i].trim().replace(/^>\s?/, '');
        quoteLines.push(textInQuote);
        i++;
      }
      elements.push(
        <blockquote
          key={`quote-${elementKey++}`}
          className="border-l-4 border-brand-500 bg-brand-50/60 p-3.5 rounded-r-lg my-3 text-slate-700 italic space-y-1.5 text-sm"
        >
          {quoteLines.map((line, qIdx) => (
            <p key={qIdx} className="leading-relaxed">
              {parseInline(line)}
            </p>
          ))}
        </blockquote>
      );
      continue;
    }

    // 5. Unordered List (* or -)
    if (trimmed.startsWith('* ') || trimmed.startsWith('- ')) {
      const listItems: { text: string; indent: number }[] = [];
      while (
        i < lines.length &&
        (lines[i].trim().startsWith('* ') || lines[i].trim().startsWith('- '))
      ) {
        const indent = lines[i].search(/\S/);
        const itemText = lines[i].trim().slice(2).trim();
        listItems.push({ text: itemText, indent });
        i++;
      }
      elements.push(
        <ul key={`ul-${elementKey++}`} className="list-disc pl-5 my-2.5 space-y-1.5 text-slate-700 text-sm">
          {listItems.map((item, lIdx) => (
            <li
              key={lIdx}
              className={`leading-relaxed ${item.indent >= 2 ? 'ml-4 list-[circle]' : ''}`}
            >
              {parseInline(item.text)}
            </li>
          ))}
        </ul>
      );
      continue;
    }

    // 6. Ordered List (1. , 2. )
    if (/^\d+\.\s+/.test(trimmed)) {
      const listItems: { text: string; indent: number }[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        const indent = lines[i].search(/\S/);
        const itemText = lines[i].trim().replace(/^\d+\.\s+/, '').trim();
        listItems.push({ text: itemText, indent });
        i++;
      }
      elements.push(
        <ol key={`ol-${elementKey++}`} className="list-decimal pl-5 my-2.5 space-y-1.5 text-slate-700 text-sm">
          {listItems.map((item, lIdx) => (
            <li
              key={lIdx}
              className={`leading-relaxed ${item.indent >= 2 ? 'ml-4' : ''}`}
            >
              {parseInline(item.text)}
            </li>
          ))}
        </ol>
      );
      continue;
    }

    // 7. GFM Pipe Tables
    if (isTableStart(lines, i)) {
      const headerCells = parseTableRow(lines[i]);
      i += 2; // Advance past header row and delimiter row
      const bodyRows: string[][] = [];
      while (i < lines.length && lines[i].trim().includes('|')) {
        if (!TABLE_DELIMITER_REGEX.test(lines[i])) {
          bodyRows.push(parseTableRow(lines[i]));
        }
        i++;
      }
      elements.push(
        <div
          key={`table-${elementKey++}`}
          className="my-4 overflow-x-auto rounded-xl border border-slate-200"
        >
          <table className="w-full text-left border-collapse text-xs sm:text-sm">
            <thead>
              <tr>
                {headerCells.map((cell, cIdx) => (
                  <th
                    key={cIdx}
                    scope="col"
                    className="px-3.5 py-2.5 bg-slate-100 text-slate-900 font-bold border-b border-slate-200"
                  >
                    {parseInline(cell)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {bodyRows.map((row, rIdx) => (
                <tr key={rIdx} className="even:bg-slate-50/50">
                  {headerCells.map((_, cIdx) => (
                    <td
                      key={cIdx}
                      className="px-3.5 py-2.5 text-slate-700 border-b border-slate-100 align-top"
                    >
                      {parseInline(row[cIdx] ?? '')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    // 8. Regular Paragraphs
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !lines[i].trim().startsWith('#') &&
      !lines[i].trim().startsWith('>') &&
      !lines[i].trim().startsWith('* ') &&
      !lines[i].trim().startsWith('- ') &&
      !/^\d+\.\s+/.test(lines[i].trim()) &&
      !isTableStart(lines, i) &&
      lines[i].trim() !== '---' &&
      lines[i].trim() !== '***' &&
      lines[i].trim() !== '___'
    ) {
      paraLines.push(lines[i].trim());
      i++;
    }

    if (paraLines.length > 0) {
      elements.push(
        <p key={`p-${elementKey++}`} className="my-2 leading-relaxed text-slate-700 text-sm">
          {parseInline(paraLines.join(' '))}
        </p>
      );
    }
  }

  return <div className={`markdown-body space-y-1 ${className}`}>{elements}</div>;
};
