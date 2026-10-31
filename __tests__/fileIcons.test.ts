import { PARENT_FOLDER_LOOK, folderLook, folderXml, zedFileIcon, type FolderBadge } from '../src/ui/workbench/fileIcons';
import { ZED_ICON_XML } from '../src/ui/workbench/zedIcons.generated';

describe('zedFileIcon', () => {
  // The cases from Zed's own test_suffix_matches_take_precedence_over_prefixes.
  it('lets a suffix win over a stem, as Zed does', () => {
    expect(zedFileIcon('mod.rs')).toBe('rust');
    expect(zedFileIcon('Dockerfile.rs')).toBe('rust');
    expect(zedFileIcon('go.mod')).toBe('go');
  });

  it('matches whole names, joined suffixes and stems', () => {
    expect(zedFileIcon('eslint.config.js')).toBe('eslint');
    expect(zedFileIcon('docker-compose.yml')).toBe('docker');
    expect(zedFileIcon('Dockerfile')).toBe('docker');
    expect(zedFileIcon('Dockerfile.prod')).toBe('docker');
    expect(zedFileIcon('Component.tsx')).toBe('react');
  });

  it('reads hidden files by the name after the dot', () => {
    expect(zedFileIcon('.gitignore')).toBe('git');
    expect(zedFileIcon('.zshrc')).toBe('terminal');
    expect(zedFileIcon('.data.json')).toBe('code');
  });

  it('is case-sensitive like Zed', () => {
    expect(zedFileIcon('App.ts')).toBe('typescript');
    expect(zedFileIcon('App.TS')).toBe('file');
  });

  it('falls back to the plain file icon', () => {
    expect(zedFileIcon('README')).toBe('file');
    expect(zedFileIcon('archive.bak')).toBe('file');
    expect(zedFileIcon('constructor')).toBe('file');
  });
});

describe('folderLook', () => {
  it('badges folders by what they usually hold', () => {
    expect(folderLook('src')).toEqual({ badge: 'code', tint: 'green' });
    expect(folderLook('Docs').badge).toBe('book');
    expect(folderLook('node_modules').badge).toBe('package');
    expect(folderLook('.git')).toEqual({ badge: 'git', tint: 'rose' });
  });

  it('leaves other folders plain, with hidden ones muted', () => {
    expect(folderLook('aries')).toEqual({ badge: null, tint: 'blue' });
    expect(folderLook('.local')).toEqual({ badge: null, tint: 'slate' });
  });
});

describe('folderXml', () => {
  const badges: FolderBadge[] = ['code', 'book', 'settings', 'image', 'package', 'archive', 'terminal', 'git', 'lock', 'database', 'audio', 'video', 'project', 'chevron_up'];

  it('builds every badge, cut out in the given color', () => {
    for (const badge of badges) {
      const xml = folderXml(badge, '#1E1B19');
      expect(xml.startsWith('<svg')).toBe(true);
      expect(xml.endsWith('</g></svg>')).toBe(true);
      // The folder keeps currentColor; the badge carries only the cutout color.
      expect(xml.split('<g ')[1]).not.toContain('currentColor');
      expect(xml.split('<g ')[1]).toContain('#1E1B19');
    }
  });

  it('thickens badge strokes, including ones that relied on the default width', () => {
    const xml = folderXml('code', '#000');
    expect(xml).toContain('stroke-width="2.28"');
    expect(xml.split('<g ')[1]).not.toMatch(/stroke-width="1\.2"/);
  });

  it('draws a plain folder without a badge', () => {
    expect(folderXml(null, '#000')).toBe(ZED_ICON_XML.folder.replace('<path ', '<path fill="currentColor" '));
  });

  it('gives the parent row an up chevron', () => {
    expect(PARENT_FOLDER_LOOK.badge).toBe('chevron_up');
  });
});
