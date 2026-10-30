import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { LAUNCH_LOGO_SIZE } from '../src/lib/launchScreen.cjs';

// Aries fork: every launcher, splash, notification and in-app logo is
// rasterized from the Aries artwork in assets/aries/. Its SVGs use masks and
// gradients, which Android VectorDrawable cannot express, so the launcher
// foreground is a per-density bitmap instead of a generated vector.
const projectRoot = resolve(import.meta.dirname, '..');
const art = (name: string) => readFileSync(resolve(projectRoot, 'assets/aries', name), 'utf8');
const res = (path: string) => resolve(projectRoot, 'android/app/src/main/res', path);

const icon = art('aries-icon.svg');
const markSmall = art('aries-mark-small.svg');

// Matches the icon tile's own fill, so the adaptive background and the
// foreground's bleed edge meet without a seam.
const ICON_BACKGROUND = '#2B2724';

const densities = [
  ['mdpi', 1],
  ['hdpi', 1.5],
  ['xhdpi', 2],
  ['xxhdpi', 3],
  ['xxxhdpi', 4],
] as const;

const png = (svg: string, size: number) =>
  sharp(Buffer.from(svg), { density: 384 })
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

const circle = (size: number) =>
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}"/></svg>`,
  );

// The adaptive foreground is the icon tile without its background and rounded
// clip. The 1024 design maps onto the 72dp visible viewport, centered in the
// 108dp layer, so the ram's bleed ends exactly at the launcher mask.
const foreground = icon
  .replace(/<rect width="1024" height="1024" rx="228" fill="[^"]+"\/>/, '')
  .replace(/<clipPath id="t"><rect width="1024" height="1024" rx="228"\/><\/clipPath>/,
    '<clipPath id="t"><rect width="1024" height="1024"/></clipPath>');
if (foreground === icon) throw new Error('aries-icon.svg no longer has the expected tile shape');

for (const [density, scale] of densities) {
  const layer = Math.round(108 * scale);
  const visible = Math.round(72 * scale);
  const inset = Math.round((layer - visible) / 2);
  mkdirSync(res(`mipmap-${density}`), { recursive: true });
  await sharp({ create: { width: layer, height: layer, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: await png(foreground, visible), left: inset, top: inset }])
    .png()
    .toFile(res(`mipmap-${density}/ic_launcher_whip_foreground.png`));

  // Pre-26 launchers and the adaptive fallbacks use the finished tile.
  const legacy = Math.round(48 * scale);
  const tile = await png(icon, legacy);
  const round = await sharp(tile).composite([{ input: circle(legacy), blend: 'dest-in' }]).png().toBuffer();
  for (const name of ['ic_launcher', 'ic_launcher_whip_adaptive']) {
    await sharp(tile).toFile(res(`mipmap-${density}/${name}.png`));
    await sharp(round).toFile(res(`mipmap-${density}/${name}_round.png`));
  }

  // Match Expo's splash layout: a 200dp logo centered on a 288dp transparent
  // canvas, which Android 12+ scales and masks as its system splash icon.
  const logoSize = LAUNCH_LOGO_SIZE * scale;
  const canvasSize = 288 * scale;
  mkdirSync(res(`drawable-${density}`), { recursive: true });
  await sharp({ create: { width: canvasSize, height: canvasSize, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: await png(icon, logoSize), left: (canvasSize - logoSize) / 2, top: (canvasSize - logoSize) / 2 }])
    .png()
    .toFile(res(`drawable-${density}/whip_launch_logo.png`));

  // Status-bar icons must be white on transparent. The ram's dark body becomes
  // the white silhouette; its light horn and prompt strokes and the gold stars
  // are cut out so the mark stays recognizable at 24dp.
  const notificationSize = Math.round(24 * scale);
  const { data, info } = await sharp(await png(markSmall, notificationSize * 4))
    .raw()
    .toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) {
    const luminance = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    const body = luminance < 96 ? data[i + 3] : 0;
    data[i] = data[i + 1] = data[i + 2] = 255;
    data[i + 3] = body;
  }
  await sharp(data, { raw: info })
    .resize(notificationSize, notificationSize)
    .png()
    .toFile(res(`drawable-${density}/ic_notification_whip.png`));
  console.log(`Generated ${density} launcher, splash and notification icons`);
}

// Bitmaps replace the upstream vector resources of the same names.
rmSync(res('drawable/ic_launcher_whip_foreground.xml'), { force: true });
rmSync(res('drawable/ic_notification_whip.xml'), { force: true });

for (const name of ['ic_launcher_whip_adaptive', 'ic_launcher_whip_adaptive_round']) {
  writeFileSync(
    res(`mipmap-anydpi-v26/${name}.xml`),
    `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_whip_background" />
    <foreground android:drawable="@mipmap/ic_launcher_whip_foreground" />
</adaptive-icon>
`,
  );
}
const colors = res('values/colors.xml');
writeFileSync(
  colors,
  readFileSync(colors, 'utf8').replace(
    /(<color name="ic_launcher_whip_background">)[^<]+(<\/color>)/,
    `$1${ICON_BACKGROUND}$2`,
  ),
);

// UI marks never exceed 82dp; the tile reads on both light and dark themes.
await sharp(await png(icon, 512)).toFile(resolve(projectRoot, 'assets/whip-mark.png'));
await sharp(await png(icon, 1024)).toFile(resolve(projectRoot, 'assets/icon.png'));
console.log('Generated Aries UI mark and Expo icon');
