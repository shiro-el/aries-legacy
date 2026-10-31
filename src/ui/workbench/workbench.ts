import { browserOmniboxAddress } from '../../browser/address';
import { DEFAULT_BROWSER_SEARCH_ENGINE } from '../../browser/search';
import type { RemotePreviewKind } from '../../lib/remoteFiles';
import { terminalWebLinkTarget } from '../../lib/terminalLinks';

export type WorkbenchMode = 'files' | 'changes' | 'browser';

/** How a file is shown once opened. */
export type PreviewMode =
  /** Read as text and shown with line numbers. */
  | 'text'
  /** Read as text and rendered as Markdown. */
  | 'markdown'
  /** Read as text and drawn as an image document. */
  | 'svg'
  /** Served from the host through a tunnel and loaded in a web view. */
  | 'html'
  /** Streamed over SFTP and loaded in a web view. */
  | 'media'
  /** Streamed over SFTP and drawn by pdf.js, since the web view has no PDF renderer. */
  | 'pdf'
  | 'none';

export function previewMode(kind: RemotePreviewKind): PreviewMode {
  switch (kind) {
    case 'code':
    case 'text':
    case 'paged-text':
    case 'mermaid':
      return 'text';
    case 'markdown':
      return 'markdown';
    case 'svg':
      return 'svg';
    case 'html':
      return 'html';
    case 'image':
    case 'video':
    case 'audio':
      return 'media';
    case 'pdf':
      return 'pdf';
    case 'unsupported':
      return 'none';
  }
}

export type Crumb = { label: string; path: string };

/**
 * Path segments from the filesystem root to `path`, with the home folder
 * collapsed to `~` so a deep project path stays readable on a phone.
 */
export function crumbs(path: string, home: string | null): Crumb[] {
  const trimmed = path.length > 1 ? path.replace(/\/+$/, '') : path;
  const homeRoot = home && home !== '/' ? home.replace(/\/+$/, '') : null;
  if (homeRoot && (trimmed === homeRoot || trimmed.startsWith(`${homeRoot}/`))) {
    const rest = trimmed.slice(homeRoot.length).split('/').filter(Boolean);
    return [{ label: '~', path: homeRoot }, ...segments(homeRoot, rest)];
  }
  return [{ label: '/', path: '/' }, ...segments('', trimmed.split('/').filter(Boolean))];
}

function segments(base: string, names: string[]): Crumb[] {
  let at = base;
  return names.map(name => {
    at = `${at}/${name}`;
    return { label: name, path: at };
  });
}

export type BrowserTarget = {
  /** The address as the user means it, shown in the address bar. */
  url: string;
  /** Loopback and private addresses live on the host and need an SSH tunnel. */
  tunnel: boolean;
};

/** Turns address-bar input into a URL. Bare ports mean a dev server on the host. */
export function browserTarget(input: string): BrowserTarget {
  const value = input.trim();
  const address = /^:?\d{2,5}(?:[/?#].*)?$/.test(value)
    ? `http://localhost:${value.replace(/^:/, '')}`
    : value;
  const url = browserOmniboxAddress(address, DEFAULT_BROWSER_SEARCH_ENGINE);
  return { url, tunnel: terminalWebLinkTarget(url).requiresSshTunnel };
}

/** Only web pages load inside the browser; other schemes are refused. */
export function loadsInBrowser(url: string): boolean {
  return /^(?:https?:|about:blank|data:)/i.test(url);
}

/** Spaces a tab expands to in code views. */
export const TAB_COLUMNS = 4;

/** Code text with tabs expanded, so its width can be counted in columns. */
export function codeText(text: string): string {
  return text.replace(/\t/g, ' '.repeat(TAB_COLUMNS));
}

/**
 * Monospace columns a line takes. Hangul, CJK and other wide glyphs fall back
 * to a font about twice as wide as JetBrains Mono's cells, so they count as two.
 */
export function codeColumns(text: string): number {
  let columns = 0;
  for (const char of codeText(text)) {
    const code = char.codePointAt(0) ?? 0;
    columns += code >= 0x1100 && (code <= 0x115f || code >= 0x2e80) ? 2 : 1;
  }
  return columns;
}
