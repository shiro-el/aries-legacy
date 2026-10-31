/** A file an agent named in its reply, with the line it pointed at. */
export type FileLink = { path: string; line?: number };

export type LinkedText = string | { text: string; link: FileLink };

/**
 * Extensions a bare name like `App.tsx` must carry to count as a file.
 * Names with a folder in them need only some extension, but without one
 * `this.state` or `e.g` would read as files.
 */
const BARE_EXTENSIONS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'json', 'jsonc', 'md', 'mdx', 'txt', 'py', 'rs', 'go', 'java', 'kt', 'kts',
  'swift', 'c', 'h', 'cc', 'cpp', 'hpp', 'cs', 'rb', 'php', 'lua', 'dart', 'sh', 'bash', 'zsh', 'fish', 'nix',
  'yml', 'yaml', 'toml', 'ini', 'cfg', 'conf', 'lock', 'env', 'html', 'htm', 'css', 'scss', 'sass', 'less', 'sql',
  'xml', 'svg', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'pdf', 'gradle', 'properties', 'vue', 'svelte', 'astro',
  'graphql', 'proto', 'csv', 'tsv', 'log', 'diff', 'patch',
]);

const SEGMENT = String.raw`[\w@+-](?:[\w.@+-]*[\w+-])?`;
const PATH = String.raw`(?:~\/|\.{1,2}\/|\/)?(?:${SEGMENT}\/)*${SEGMENT}`;
const LOCATION = String.raw`(?::(\d+)(?::\d+)?|#L(\d+))?`;
const WHOLE = new RegExp(String.raw`^(${PATH})${LOCATION}$`);
/** Inside prose a path must have a folder, so ordinary words never match. */
const IN_PROSE = new RegExp(String.raw`(?<![\w/.~@:-])((?:~\/|\.{1,2}\/|\/)?(?:${SEGMENT}\/)+${SEGMENT})${LOCATION}`, 'g');

/** The file a code span such as `src/App.tsx:12` names, or null if it names none. */
export function fileLink(token: string): FileLink | null {
  const match = WHOLE.exec(token.trim());
  if (!match) return null;
  return linkFor(match[1], match[2] ?? match[3]);
}

/** Splits prose into plain runs and the file paths written in it. */
export function linkFiles(text: string): LinkedText[] {
  const out: LinkedText[] = [];
  let last = 0;
  for (const match of text.matchAll(IN_PROSE)) {
    const link = linkFor(match[1], match[2] ?? match[3]);
    if (!link) continue;
    const start = match.index;
    if (start > last) out.push(text.slice(last, start));
    out.push({ text: match[0], link });
    last = start + match[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function linkFor(path: string, line: string | undefined): FileLink | null {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  const extension = dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
  // An extension with a letter, so versions like 1.2.3 stay text.
  if (!/^[a-z0-9]*[a-z][a-z0-9]*$/.test(extension)) return null;
  if (!path.includes('/') && !BARE_EXTENSIONS.has(extension)) return null;
  // Package names and decorators, not files.
  if (path.startsWith('@') && !path.includes('/', path.indexOf('/') + 1)) return null;
  const number = line === undefined ? undefined : Number(line);
  return number !== undefined && number > 0 ? { path, line: number } : { path };
}

/**
 * The absolute path a link names, read against the pane's folder. Returns
 * null when it climbs above the filesystem root.
 */
export function resolveFilePath(path: string, cwd: string, home: string): string | null {
  const base = path.startsWith('/') ? '' : path.startsWith('~/') ? home : cwd;
  const rest = path.startsWith('~/') ? path.slice(2) : path;
  const parts: string[] = [];
  for (const part of `${base}/${rest}`.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (parts.length === 0) return null;
      parts.pop();
    } else parts.push(part);
  }
  return `/${parts.join('/')}`;
}
