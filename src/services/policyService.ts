import { PolicyDocument } from '../types';

/**
 * Eagerly bundle all Markdown files in `src/policies/` at build time using Vite's native glob import.
 * Adding or editing a `.md` file in `src/policies/` automatically updates the policy collection on build.
 */
const rawPolicyModules = import.meta.glob<string>('../policies/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
});

/**
 * Extracts key-value pairs from an optional leading YAML frontmatter block (`--- ... ---`)
 * and returns the parsed metadata alongside the full Markdown content.
 */
export function parsePolicyMarkdown(filePath: string, rawMarkdown: string): PolicyDocument {
  // Derive a clean filename stem (e.g., "POL01-HealthAndSafety") from the module path
  const fileNameWithExt = filePath.split('/').pop() || filePath;
  const fileStem = fileNameWithExt.replace(/\.md$/i, '');

  // Match a YAML frontmatter block strictly anchored at the start of the file
  const frontmatterMatch = rawMarkdown.match(
    /^(\uFEFF)?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/
  );
  const metadata: Record<string, string> = {};

  if (frontmatterMatch) {
    // Parse each line inside the YAML frontmatter block as a simple key: value pair
    const frontmatterLines = frontmatterMatch[2].split(/\r?\n/);
    for (const line of frontmatterLines) {
      const colonIdx = line.indexOf(':');
      if (colonIdx !== -1) {
        // Normalize key and strip optional surrounding single or double quotes from value
        const key = line.slice(0, colonIdx).trim();
        const rawVal = line.slice(colonIdx + 1).trim();
        const cleanVal = rawVal.replace(/^['"]|['"]$/g, '');
        if (key) {
          metadata[key] = cleanVal;
        }
      }
    }
  }

  // Fallback to the first level-1 Markdown heading (`# Heading`) if no frontmatter title exists
  const bodyWithoutFrontmatter = frontmatterMatch
    ? rawMarkdown.slice(frontmatterMatch[0].length)
    : rawMarkdown;
  const headingMatch = bodyWithoutFrontmatter.match(/^\s*#\s+(.+)$/m);

  // Derive stable policy ID from frontmatter `id` or fallback to the filename stem
  const derivedId = metadata.id || fileStem;
  // Derive human-readable title from frontmatter `title`/`name`, first H1 heading, or filename stem
  const derivedTitle =
    metadata.title ||
    metadata.name ||
    (headingMatch ? headingMatch[1].trim() : fileStem.replace(/[-_]+/g, ' '));

  // Construct the normalized PolicyDocument object with stripped frontmatter content
  return {
    id: derivedId,
    title: derivedTitle,
    filePath,
    version: metadata.version || '1.0',
    lastUpdated: metadata.lastUpdated || undefined,
    category: metadata.category || 'General',
    summary: metadata.summary || undefined,
    content: bodyWithoutFrontmatter.trimStart(),
  };
}

/**
 * Returns true if a policy document has a frontmatter category of "Template" (case-insensitive).
 * Template documents live in `src/policies/` for authors to copy but are excluded from the app UI.
 */
export function isTemplatePolicy(
  policy: Pick<PolicyDocument, 'category'>
): boolean {
  return (policy.category || '').trim().toLowerCase() === 'template';
}

/**
 * Filters out template policies and sorts active policies deterministically by ID.
 */
export function filterActivePolicies<
  T extends Pick<PolicyDocument, 'id' | 'category'>
>(policies: T[]): T[] {
  // Exclude any policy marked as a template and sort alphabetically by ID
  return policies
    .filter((policy) => !isTemplatePolicy(policy))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Cached array of active (non-template) policy documents parsed at module initialization.
 */
const BUNDLED_POLICIES: PolicyDocument[] = filterActivePolicies(
  Object.entries(rawPolicyModules).map(([filePath, rawContent]) =>
    parsePolicyMarkdown(filePath, rawContent)
  )
);

/**
 * Returns all active Repair Café policy documents bundled into the application.
 */
export function getPolicies(): PolicyDocument[] {
  return BUNDLED_POLICIES;
}

/**
 * Finds a specific active policy document by its ID (e.g. "POL01").
 */
export function getPolicyById(id: string): PolicyDocument | undefined {
  const normalizedTarget = id.trim().toLowerCase();
  return BUNDLED_POLICIES.find((p) => p.id.toLowerCase() === normalizedTarget);
}
