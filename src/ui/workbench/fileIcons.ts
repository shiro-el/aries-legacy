import type { FolderTint } from '../theme/tokens';
import {
  ZED_FILE_STEMS,
  ZED_FILE_SUFFIXES,
  ZED_FILE_TYPE_ICONS,
  ZED_ICON_XML,
  type ZedIcon,
} from './zedIcons.generated';

function iconForAssociation(association: string): ZedIcon | undefined {
  // Zed checks stems first and only then suffixes; a type without an icon matches nothing.
  const type = ZED_FILE_STEMS.get(association) ?? ZED_FILE_SUFFIXES.get(association);
  return type === undefined ? undefined : ZED_FILE_TYPE_ICONS.get(type);
}

/**
 * The icon Zed shows for a file name, following `FileIcons::get_icon` in
 * crates/file_icons: the whole name, then each suffix after a dot from the
 * longest down, then the stem before the first dot, then the default. Zed's
 * later checks (joined extensions, the extension, a hidden file's name) only
 * look up suffixes that the loop below has already tried.
 */
export function zedFileIcon(fileName: string): ZedIcon {
  const whole = iconForAssociation(fileName);
  if (whole) return whole;
  let rest = fileName;
  let firstPrefix: string | undefined;
  for (let dot = rest.indexOf('.'); dot >= 0; dot = rest.indexOf('.')) {
    firstPrefix ??= rest.slice(0, dot);
    rest = rest.slice(dot + 1);
    const icon = iconForAssociation(rest);
    if (icon) return icon;
  }
  const stem = firstPrefix === undefined ? undefined : iconForAssociation(firstPrefix);
  return stem ?? ZED_FILE_TYPE_ICONS.get('default') ?? 'file';
}

/** Zed glyphs that can sit inside a folder. Each is drawn from plain shapes only; see `folderXml`. */
export type FolderBadge = Extract<
  ZedIcon,
  'code' | 'book' | 'settings' | 'image' | 'package' | 'archive' | 'terminal' | 'git' | 'lock' | 'database' | 'audio' | 'video' | 'project' | 'chevron_up'
>;

export type FolderLook = { badge: FolderBadge | null; tint: FolderTint };

const FOLDER_LOOKS: [names: string[], look: FolderLook][] = [
  [['src', 'source', 'lib', 'app', 'core', 'internal', 'pkg'], { badge: 'code', tint: 'green' }],
  [['test', 'tests', '__tests__', 'spec', 'specs', 'e2e', '__mocks__', 'fixtures'], { badge: null, tint: 'teal' }],
  [['docs', 'doc', 'documentation', 'wiki', 'notes', 'adr'], { badge: 'book', tint: 'blue' }],
  [['config', 'configs', '.config', '.vscode', '.idea', '.github', '.husky', '.circleci', 'settings', 'etc'], { badge: 'settings', tint: 'slate' }],
  [['assets', 'images', 'img', 'icons', 'public', 'static', 'res', 'media', 'fonts'], { badge: 'image', tint: 'violet' }],
  [['node_modules', 'vendor', '.venv', 'venv', 'pods', 'third_party', '.cargo', '.npm', '.cache'], { badge: 'package', tint: 'slate' }],
  [['packages', 'apps', 'modules', 'components', 'crates', 'plugins', 'extensions'], { badge: 'project', tint: 'blue' }],
  [['dist', 'build', 'out', 'output', 'target', 'release', '.next', '.expo', 'coverage'], { badge: 'archive', tint: 'violet' }],
  [['scripts', 'bin', 'tools', 'cmd', 'hooks'], { badge: 'terminal', tint: 'green' }],
  [['.git'], { badge: 'git', tint: 'rose' }],
  [['.ssh', '.gnupg', 'keys', 'secrets', 'certs', 'credentials'], { badge: 'lock', tint: 'rose' }],
  [['data', 'db', 'database', 'migrations', 'seeds'], { badge: 'database', tint: 'blue' }],
  [['music', 'audio', 'sounds'], { badge: 'audio', tint: 'violet' }],
  [['videos', 'video', 'movies'], { badge: 'video', tint: 'violet' }],
];

const FOLDER_LOOK_BY_NAME: ReadonlyMap<string, FolderLook> = new Map(
  FOLDER_LOOKS.flatMap(([names, look]) => names.map(name => [name, look] as const)),
);

/** How a folder is drawn in file lists: a tinted folder, often with a badge. */
export function folderLook(name: string): FolderLook {
  return FOLDER_LOOK_BY_NAME.get(name.toLowerCase())
    ?? (name.startsWith('.') ? { badge: null, tint: 'slate' } : { badge: null, tint: 'blue' });
}

/** The parent row: a muted folder with an up chevron. */
export const PARENT_FOLDER_LOOK = { badge: 'chevron_up', tint: 'slate' } as const satisfies FolderLook;

/** Badge size and centre on the 16-unit grid; the folder body spans y 5.3–12.5. */
const BADGE_SCALE = 0.42;
const BADGE_CENTER = { x: 8, y: 9 } as const;
/** Strokes thicken so they still read once the badge is scaled down. */
const BADGE_STROKE = 1.9;

function svgBody(xml: string): string {
  const open = /^<svg\b[^>]*>/.exec(xml);
  if (!open || !xml.endsWith('</svg>')) throw new Error('Expected a single <svg> element');
  return xml.slice(open[0].length, -'</svg>'.length);
}

/**
 * Zed's folder filled with `currentColor`, with the badge cut out of it in
 * `cutout`. Badges must use only path, rect and circle, so each stroke's own
 * width is the one being thickened rather than an inherited one.
 */
export function folderXml(badge: FolderBadge | null, cutout: string): string {
  const folder = ZED_ICON_XML.folder.replace('<path ', '<path fill="currentColor" ');
  if (folder === ZED_ICON_XML.folder) throw new Error('Zed folder icon has no path');
  if (!badge) return folder;
  const body = svgBody(ZED_ICON_XML[badge]);
  const elements = [...body.matchAll(/<([a-zA-Z]+)/g)].map(match => match[1]);
  if (elements.some(element => element !== 'path' && element !== 'rect' && element !== 'circle')) {
    throw new Error(`Folder badge ${badge} uses ${elements.join(', ')}`);
  }
  const thick = body
    .replace(/<(path|rect|circle)\b([^>]*?)(\/?)>/g, (_tag, name: string, attributes: string, close: string) => {
      if (!/\bstroke="currentColor"/.test(attributes)) return `<${name}${attributes}${close}>`;
      const width = /\bstroke-width="([\d.]+)"/.exec(attributes);
      const scaled = (width ? Number(width[1]) : 1) * BADGE_STROKE;
      const rest = width ? attributes.replace(width[0], '') : attributes;
      return `<${name}${rest} stroke-width="${scaled.toFixed(2)}"${close}>`;
    })
    .replace(/currentColor/g, cutout);
  const size = 16 * BADGE_SCALE;
  const x = BADGE_CENTER.x - size / 2;
  const y = BADGE_CENTER.y - size / 2;
  const group = `<g fill="none" transform="translate(${x.toFixed(2)} ${y.toFixed(2)}) scale(${BADGE_SCALE})">${thick}</g>`;
  return folder.replace(/<\/svg>$/, `${group}</svg>`);
}
