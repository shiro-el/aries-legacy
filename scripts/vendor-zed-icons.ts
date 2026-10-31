// Copies Zed's file icons and its file name → icon rules into
// src/ui/workbench/zedIcons.generated.ts.
//
//   git clone --depth 1 --filter=blob:none --sparse https://github.com/zed-industries/zed.git
//   git -C zed sparse-checkout set assets/icons crates/theme/src
//   node scripts/vendor-zed-icons.ts path/to/zed
//
// Zed draws an icon as an alpha mask tinted with one color, so every painted
// color here becomes `currentColor`; mask and clip contents keep theirs,
// because a luminance mask reads them.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const zed = process.argv[2];
if (!zed) throw new Error('Usage: node scripts/vendor-zed-icons.ts <zed checkout>');

const projectRoot = resolve(import.meta.dirname, '..');
const output = resolve(projectRoot, 'src/ui/workbench/zedIcons.generated.ts');
const iconTheme = readFileSync(resolve(zed, 'crates/theme/src/icon_theme.rs'), 'utf8');
const lucideLicense = readFileSync(resolve(zed, 'assets/icons/LICENSES'), 'utf8').trim();
const commit = execFileSync('git', ['-C', zed, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();

/** Glyphs drawn inside folders and on the parent row, beyond what files use. */
const EXTRA_ICONS = ['folder', 'chevron_up', 'code', 'book', 'settings', 'image', 'package', 'archive', 'terminal', 'git', 'lock', 'database', 'audio', 'video', 'project', 'diff'];

function constBody(name: string): string {
  const start = iconTheme.indexOf(`const ${name}:`);
  if (start < 0) throw new Error(`${name} is missing from icon_theme.rs`);
  const open = iconTheme.indexOf('= &[', start);
  const close = iconTheme.indexOf('\n];', open);
  if (open < 0 || close < 0) throw new Error(`${name} has an unexpected shape`);
  return iconTheme.slice(open + 4, close);
}

function associations(name: string): [string, string][] {
  const body = constBody(name);
  const pairs: [string, string][] = [];
  let matched = 0;
  for (const entry of body.matchAll(/\(\s*"([^"]+)",\s*&\[([^\]]*)\],?\s*\)/g)) {
    matched += entry[0].length;
    for (const value of entry[2].matchAll(/"([^"]*)"/g)) pairs.push([value[1], entry[1]]);
  }
  // Everything else in the block must be commas and whitespace, or the parse missed an entry.
  if (body.replace(/\(\s*"([^"]+)",\s*&\[([^\]]*)\],?\s*\)/g, '').replace(/[\s,]/g, '') !== '') {
    throw new Error(`${name} has entries this script cannot read`);
  }
  if (matched === 0) throw new Error(`${name} is empty`);
  return pairs;
}

const stems = associations('FILE_STEMS_BY_ICON_KEY');
const suffixes = associations('FILE_SUFFIXES_BY_ICON_KEY');
const typeIcons: [string, string][] = [];
const iconsBody = constBody('FILE_ICONS');
for (const entry of iconsBody.matchAll(/\("([^"]+)",\s*"icons\/file_icons\/([a-z0-9_]+)\.svg"\)/g)) typeIcons.push([entry[1], entry[2]]);
if (iconsBody.replace(/\("([^"]+)",\s*"icons\/file_icons\/([a-z0-9_]+)\.svg"\)/g, '').replace(/[\s,]/g, '') !== '') {
  throw new Error('FILE_ICONS has entries this script cannot read');
}
if (!typeIcons.some(([type]) => type === 'default')) throw new Error('FILE_ICONS has no default');

const ALLOWED_ELEMENTS = new Set(['svg', 'path', 'rect', 'circle', 'g', 'defs', 'clipPath', 'mask']);

function normalize(name: string): string {
  const source = readFileSync(resolve(zed, 'assets/icons/file_icons', `${name}.svg`), 'utf8').trim();
  for (const element of source.matchAll(/<([a-zA-Z]+)/g)) {
    if (!ALLOWED_ELEMENTS.has(element[1])) throw new Error(`${name}.svg uses <${element[1]}>`);
  }
  const root = /^<svg\b[^>]*>/.exec(source)?.[0];
  // A few icons are 17 wide; drawn into a square box they keep their shape and shrink slightly.
  const width = root && /\bwidth="(1[67])"/.exec(root)?.[1];
  if (!root || !width || !/\bheight="16"/.test(root)) throw new Error(`${name}.svg is not 16 or 17 by 16`);
  const viewBox = `0 0 ${width} 16`;
  const declared = /\bviewBox="([^"]*)"/.exec(root)?.[1];
  if (declared !== undefined && declared !== viewBox) throw new Error(`${name}.svg has viewBox ${declared}, expected ${viewBox}`);
  const withViewBox = declared !== undefined ? source : source.replace(/^<svg\b/, `<svg viewBox="${viewBox}"`);
  // Recolor painted shapes only; mask and clip contents are read for luminance or shape.
  const recolored = withViewBox
    .split(/(<(mask|clipPath)\b[\s\S]*?<\/\2>)/)
    .map((part, index) => {
      if (index % 3 === 1) return part;
      if (index % 3 === 2) return '';
      return part.replace(/\b(stroke|fill)="(?!none")[^"]*"/g, '$1="currentColor"');
    })
    .join('');
  return recolored.replace(/>\s+</g, '><').replace(/\s*\n\s*/g, ' ');
}

const iconNames = [...new Set([...typeIcons.map(([, icon]) => icon), ...EXTRA_ICONS])].sort();
const types = [...new Set([...stems.map(([, type]) => type), ...suffixes.map(([, type]) => type), ...typeIcons.map(([type]) => type)])].sort();
const quote = (value: string) => JSON.stringify(value);
const union = (values: string[]) => values.map(value => `  | ${quote(value)}`).join('\n');
const mapEntries = (pairs: [string, string][]) => pairs.map(([key, value]) => `  [${quote(key)}, ${quote(value)}],`).join('\n');

const text = `// Generated by scripts/vendor-zed-icons.ts from zed-industries/zed@${commit}.
// Do not edit manually; rerun the script against a newer Zed checkout instead.
//
// Icons and rules: Zed (crates/theme, GPL-3.0-or-later; assets/icons).
// Portions of the icons come from Lucide, under this license:
//
${lucideLicense.split('\n').map(line => (line ? `// ${line}` : '//')).join('\n')}

/** An icon from Zed's file icon set. */
export type ZedIcon =
${union(iconNames)};

/** A file type key in Zed's icon theme, such as \`typescript\` or \`docker\`. */
export type ZedFileType =
${union(types)};

/** SVG source for each icon. Painted colors are \`currentColor\`. */
export const ZED_ICON_XML: Readonly<Record<ZedIcon, string>> = {
${iconNames.map(name => `  ${/^[a-z_][a-z0-9_]*$/.test(name) ? name : quote(name)}: ${quote(normalize(name))},`).join('\n')}
};

/** Zed's FILE_STEMS_BY_ICON_KEY, keyed by the stem or file name. Case-sensitive. */
export const ZED_FILE_STEMS: ReadonlyMap<string, ZedFileType> = new Map<string, ZedFileType>([
${mapEntries(stems)}
]);

/** Zed's FILE_SUFFIXES_BY_ICON_KEY, keyed by the suffix after a dot. Case-sensitive. */
export const ZED_FILE_SUFFIXES: ReadonlyMap<string, ZedFileType> = new Map<string, ZedFileType>([
${mapEntries(suffixes)}
]);

/** Zed's FILE_ICONS. Types without an entry here have no icon of their own. */
export const ZED_FILE_TYPE_ICONS: ReadonlyMap<ZedFileType, ZedIcon> = new Map<ZedFileType, ZedIcon>([
${mapEntries(typeIcons)}
]);
`;

writeFileSync(output, text);
console.log(`Wrote ${output} with ${iconNames.length} icons from zed@${commit.slice(0, 12)}.`);
