/* eslint-disable */
// One-shot generator for the Capacitor source assets (icon + splash).
// Re-runnable: dumps PNGs into ./assets/ at the sizes @capacitor/assets
// expects. The visual style matches the sidebar brand mark in
// shell.component.ts so the launcher icon, splash, and in-app header all
// share one identity.
//
// Run via:  node scripts/generate-mobile-assets.mjs
// Then:     npx @capacitor/assets generate
//           npx cap sync

import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const OUT = resolve(import.meta.dirname, '..', 'assets');

const ICON_SIZE   = 1024;
const SPLASH_SIZE = 2732;

const ACCENT      = '#6366f1';
const ACCENT_DEEP = '#4f46e5';
const WHITE       = '#ffffff';

function iconSvg(size) {
  // Letter "A" rendered at ~55% of the canvas so iOS' rounded-corner
  // masking + the Android adaptive-icon safe zone don't clip it.
  const fontSize = Math.round(size * 0.55);
  const center = size / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%"   stop-color="${ACCENT}"/>
        <stop offset="100%" stop-color="${ACCENT_DEEP}"/>
      </linearGradient>
    </defs>
    <rect width="${size}" height="${size}" fill="url(#g)"/>
    <text x="${center}" y="${center}" fill="${WHITE}"
          font-family="-apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', system-ui, sans-serif"
          font-size="${fontSize}" font-weight="700"
          text-anchor="middle" dominant-baseline="central"
          letter-spacing="-0.04em">A</text>
  </svg>`;
}

function splashSvg(size) {
  // Splash: same gradient, larger "A" mark roughly centred.
  const fontSize = Math.round(size * 0.18);
  const center = size / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%"   stop-color="${ACCENT}"/>
        <stop offset="100%" stop-color="${ACCENT_DEEP}"/>
      </linearGradient>
    </defs>
    <rect width="${size}" height="${size}" fill="url(#g)"/>
    <text x="${center}" y="${center}" fill="${WHITE}"
          font-family="-apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', system-ui, sans-serif"
          font-size="${fontSize}" font-weight="700"
          text-anchor="middle" dominant-baseline="central"
          letter-spacing="-0.04em">Artha</text>
  </svg>`;
}

async function writePng(svg, file) {
  const path = resolve(OUT, file);
  await sharp(Buffer.from(svg)).png().toFile(path);
  console.log(`wrote ${file}`);
}

await mkdir(OUT, { recursive: true });
await writePng(iconSvg(ICON_SIZE),         'icon.png');
await writePng(iconSvg(ICON_SIZE),         'icon-foreground.png');
// Solid background for the Android adaptive icon — keep it simple
// indigo so the mark still reads when the OS scales/crops it.
await sharp({ create: { width: ICON_SIZE, height: ICON_SIZE, channels: 3, background: ACCENT } })
  .png()
  .toFile(resolve(OUT, 'icon-background.png'));
console.log('wrote icon-background.png');
await writePng(splashSvg(SPLASH_SIZE),      'splash.png');
await writePng(splashSvg(SPLASH_SIZE),      'splash-dark.png');
