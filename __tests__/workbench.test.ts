import { browserTarget, codeColumns, codeText, crumbs, loadsInBrowser, previewMode } from '../src/ui/workbench/workbench';

describe('crumbs', () => {
  it('collapses the home folder to ~', () => {
    expect(crumbs('/home/shiro/src/aries', '/home/shiro')).toEqual([
      { label: '~', path: '/home/shiro' },
      { label: 'src', path: '/home/shiro/src' },
      { label: 'aries', path: '/home/shiro/src/aries' },
    ]);
  });

  it('starts at / outside the home folder', () => {
    expect(crumbs('/etc/nginx/', '/home/shiro')).toEqual([
      { label: '/', path: '/' },
      { label: 'etc', path: '/etc' },
      { label: 'nginx', path: '/etc/nginx' },
    ]);
  });

  it('does not treat a sibling with the same prefix as home', () => {
    expect(crumbs('/home/shirox', '/home/shiro')[0]).toEqual({ label: '/', path: '/' });
  });

  it('shows the root alone', () => {
    expect(crumbs('/', null)).toEqual([{ label: '/', path: '/' }]);
  });
});

describe('previewMode', () => {
  it('reads source and plain text as text', () => {
    expect(previewMode('code')).toBe('text');
    expect(previewMode('paged-text')).toBe('text');
  });

  it('streams images and video into the web view', () => {
    expect(previewMode('image')).toBe('media');
    expect(previewMode('video')).toBe('media');
  });

  it('draws PDFs with pdf.js', () => {
    expect(previewMode('pdf')).toBe('pdf');
  });
});

describe('browserTarget', () => {
  it('reads a bare port as a dev server on the host', () => {
    expect(browserTarget('5173')).toEqual({ url: 'http://localhost:5173/', tunnel: true });
    expect(browserTarget(':3000/docs')).toEqual({ url: 'http://localhost:3000/docs', tunnel: true });
  });

  it('tunnels loopback addresses', () => {
    expect(browserTarget('localhost:8080')).toEqual({ url: 'http://localhost:8080/', tunnel: true });
    expect(browserTarget('http://127.0.0.1:8000').tunnel).toBe(true);
  });

  it('opens public sites directly', () => {
    expect(browserTarget('example.com')).toEqual({ url: 'https://example.com/', tunnel: false });
  });

  it('searches for text that is not an address', () => {
    expect(browserTarget('herdr docs').url).toBe('https://www.google.com/search?q=herdr%20docs');
  });
});

describe('loadsInBrowser', () => {
  it('refuses schemes other than the web', () => {
    expect(loadsInBrowser('https://example.com')).toBe(true);
    expect(loadsInBrowser('intent://scan#Intent;end')).toBe(false);
    expect(loadsInBrowser(['javascript', 'alert(1)'].join(':'))).toBe(false);
  });
});

describe('codeColumns', () => {
  it('counts tabs as four columns', () => {
    expect(codeText('\tx')).toBe('    x');
    expect(codeColumns('\tx')).toBe(5);
  });

  it('counts Hangul as two columns', () => {
    expect(codeColumns('ab한글')).toBe(6);
  });
});
