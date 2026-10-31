import { fileLink, linkFiles, resolveFilePath } from '../src/ui/chat/fileLinks';

describe('fileLink', () => {
  it('reads paths with folders and their lines', () => {
    expect(fileLink('src/ui/App.tsx')).toEqual({ path: 'src/ui/App.tsx' });
    expect(fileLink('src/ui/App.tsx:42')).toEqual({ path: 'src/ui/App.tsx', line: 42 });
    expect(fileLink('src/ui/App.tsx:42:7')).toEqual({ path: 'src/ui/App.tsx', line: 42 });
    expect(fileLink('lib/x.rs#L9')).toEqual({ path: 'lib/x.rs', line: 9 });
    expect(fileLink('~/notes/todo.md')).toEqual({ path: '~/notes/todo.md' });
    expect(fileLink('../shared/a.config')).toEqual({ path: '../shared/a.config' });
    expect(fileLink('/etc/hosts.allow')).toEqual({ path: '/etc/hosts.allow' });
  });

  it('accepts bare names only with a known extension', () => {
    expect(fileLink('package.json')).toEqual({ path: 'package.json' });
    expect(fileLink('App.tsx:3')).toEqual({ path: 'App.tsx', line: 3 });
    expect(fileLink('this.state')).toBeNull();
    expect(fileLink('e.g')).toBeNull();
  });

  it('leaves code, versions, URLs and packages alone', () => {
    expect(fileLink('foo.bar()')).toBeNull();
    expect(fileLink('v1.2.3')).toBeNull();
    expect(fileLink('0.9.5')).toBeNull();
    expect(fileLink('https://example.com/a.html')).toBeNull();
    expect(fileLink('@types/node')).toBeNull();
    expect(fileLink('npm run build')).toBeNull();
    expect(fileLink('src/ui/')).toBeNull();
  });
});

describe('linkFiles', () => {
  it('links paths in prose and keeps trailing punctuation as text', () => {
    expect(linkFiles('Edited src/a.ts:3, then docs/b.md.')).toEqual([
      'Edited ',
      { text: 'src/a.ts:3', link: { path: 'src/a.ts', line: 3 } },
      ', then ',
      { text: 'docs/b.md', link: { path: 'docs/b.md' } },
      '.',
    ]);
  });

  it('ignores bare names and URLs in prose', () => {
    expect(linkFiles('see README.md and https://x.dev/a/b.html')).toEqual(['see README.md and https://x.dev/a/b.html']);
  });
});

describe('resolveFilePath', () => {
  it('reads relative, home and absolute paths', () => {
    expect(resolveFilePath('src/a.ts', '/repo', '/home/me')).toBe('/repo/src/a.ts');
    expect(resolveFilePath('./src/../b.ts', '/repo/', '/home/me')).toBe('/repo/b.ts');
    expect(resolveFilePath('~/x.md', '/repo', '/home/me')).toBe('/home/me/x.md');
    expect(resolveFilePath('/etc/hosts', '/repo', '/home/me')).toBe('/etc/hosts');
    expect(resolveFilePath('../../../x', '/a', '/home/me')).toBeNull();
  });
});
