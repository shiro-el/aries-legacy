import type { Palette } from '../theme/tokens';

/**
 * Android's web view has no PDF renderer, so PDFs are drawn by pdf.js. It is
 * fetched from jsDelivr at a pinned version and checked against these hashes;
 * the PDF itself comes from the host over the SFTP preview tunnel and never
 * leaves the phone.
 */
export const PDFJS_VERSION = '6.4.299';
const PDFJS_ROOT = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}`;
const PDFJS_INTEGRITY = {
  main: 'sha384-QCvhu/UPp22U/TNLVbQNONL82ES2yY717GAiqP9VVu37Y7+m9VPKvadGx9XlFvcp',
  worker: 'sha384-NfW/OTMWezITv4oaALvfH7MFLwzPxEvpySmDpoALa1mtTY8MC200l0ZNFD+SOlrM',
} as const;

/** A page that shows every page of the PDF at `url`, each drawn when it nears the screen. */
export function pdfPreviewHtml(url: string, palette: Palette): string {
  const config = JSON.stringify({
    url,
    root: PDFJS_ROOT,
    integrity: PDFJS_INTEGRITY,
  }).replace(/</g, '\\u003c');
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=6,user-scalable=yes">
<style>
html,body{margin:0;background:${palette.surface};color:${palette.muted};font:14px sans-serif}
#pages{display:flex;flex-direction:column;align-items:center;gap:8px;padding:8px 0}
.page{background:#fff;width:calc(100vw - 16px);box-shadow:0 0 0 1px ${palette.seam}}
.page canvas{display:block;width:100%;height:100%}
#state{padding:32px 16px;text-align:center}
</style></head><body>
<div id="state">Opening the PDF</div><div id="pages"></div>
<script type="module">
const config = ${config};
const state = document.getElementById('state');
const fail = reason => { state.textContent = "Can't show this PDF. " + (reason && reason.message ? reason.message : String(reason)); };
try {
  // Both scripts run from checked copies; a worker cannot start from another origin anyway.
  const checked = async (name, integrity) => {
    const response = await fetch(config.root + '/build/' + name, { integrity });
    if (!response.ok) throw new Error('pdf.js did not load.');
    return URL.createObjectURL(new Blob([await response.text()], { type: 'text/javascript' }));
  };
  const [main, worker] = await Promise.all([
    checked('pdf.min.mjs', config.integrity.main),
    checked('pdf.worker.min.mjs', config.integrity.worker),
  ]);
  const lib = await import(main);
  lib.GlobalWorkerOptions.workerPort = new Worker(worker, { type: 'module' });
  const pdf = await lib.getDocument({
    url: config.url,
    cMapUrl: config.root + '/cmaps/',
    cMapPacked: true,
    standardFontDataUrl: config.root + '/standard_fonts/',
    wasmUrl: config.root + '/wasm/',
    iccUrl: config.root + '/iccs/',
  }).promise;
  state.remove();
  const pages = document.getElementById('pages');
  const drawn = new Set();
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      const number = Number(entry.target.dataset.page);
      if (!entry.isIntersecting || drawn.has(number)) continue;
      drawn.add(number);
      void draw(entry.target, number);
    }
  }, { rootMargin: '200% 0px' });
  const first = await pdf.getPage(1);
  const base = first.getViewport({ scale: 1 });
  for (let number = 1; number <= pdf.numPages; number++) {
    const box = document.createElement('div');
    box.className = 'page';
    box.dataset.page = String(number);
    box.style.aspectRatio = base.width + ' / ' + base.height;
    pages.appendChild(box);
    observer.observe(box);
  }
  async function draw(box, number) {
    const page = number === 1 ? first : await pdf.getPage(number);
    const unit = page.getViewport({ scale: 1 });
    box.style.aspectRatio = unit.width + ' / ' + unit.height;
    // Drawn sharper than the screen so pinch zoom stays readable.
    const scale = (box.clientWidth / unit.width) * Math.min(4, (window.devicePixelRatio || 1) * 1.5);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    await page.render({ canvas, viewport }).promise;
    box.replaceChildren(canvas);
  }
} catch (reason) {
  fail(reason);
}
</script></body></html>`;
}
