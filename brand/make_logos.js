#!/usr/bin/env node
// Brand logo export — the single source for off-app TimeMachine marks.
// Reuses the repo's real icon toolchain: SVG with Inter ExtraBold (800)
// embedded as a base64 data URL, rasterised via sharp (same as
// scripts/generate-icons.js). Run from repo root: node brand/make_logos.js
//
// Emits into brand/:
//   mark.svg / mark-1024.png            three-bar mark, TRANSPARENT
//   app-icon.svg / app-icon-1024.png    mark on the dark rounded square (the App icon)
//   wordmark.svg / wordmark-1024.png    "TIMEMACHINE" sky wordmark, TRANSPARENT
//
// Colours and geometry are copied verbatim from the shipped icon.svg and the
// app's design tokens — see BRAND.md. Do not hand-edit the PNGs; regenerate.
'use strict';

const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const OUT = __dirname;
const ROOT = path.resolve(__dirname, '..');
const FONT_PATH = path.resolve(ROOT, 'node_modules/@fontsource/inter/files/inter-latin-800-normal.woff');
const fontDataURL = `data:font/woff;base64,${fs.readFileSync(FONT_PATH).toString('base64')}`;

// Brand palette (from icon.svg + app tokens).
const BG = '#0a0a0a';       // neutral-950
const SKY = '#0ea5e9';      // sky-500 — brand
const ORANGE = '#ff8a3d';   // tm-warn — OT
const ROSE = '#f43f5e';     // tm-pen — penalty

// ── Three-bar mark geometry, verbatim from the shipped icon.svg ──
// Descending widths (full / 64% / 32%), sky / orange / rose.
const BARS = [
  { x: 128, y: 168, w: 768, h: 180, rx: 90, fill: SKY },
  { x: 128, y: 422, w: 490, h: 180, rx: 90, fill: ORANGE },
  { x: 128, y: 676, w: 245, h: 180, rx: 90, fill: ROSE },
];
const barsSvg = BARS.map(b =>
  `  <rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="${b.rx}" fill="${b.fill}"/>`
).join('\n');

const markSvg =
`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
${barsSvg}
</svg>`;

const appIconSvg =
`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  <rect width="1024" height="1024" rx="230.4" fill="${BG}"/>
${barsSvg}
</svg>`;

// ── Wordmark: TIMEMACHINE, Inter 800, sky, uppercase, -0.02em tracking ──
// Rendered on a wide transparent canvas, then trimmed to a tight box.
const REF = 400;                 // font-size for the master render
const CANVAS_W = 6000, CANVAS_H = 1200;
function wordmarkMasterSvg(fontSize) {
  const ls = -(fontSize * 0.02).toFixed(2);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS_W}" height="${CANVAS_H}" viewBox="0 0 ${CANVAS_W} ${CANVAS_H}">
  <defs><style>
    @font-face { font-family: 'Inter'; src: url('${fontDataURL}') format('woff'); font-weight: 800; }
  </style></defs>
  <text x="40" y="${CANVAS_H / 2}" font-family="'Inter', sans-serif" font-weight="800"
        font-size="${fontSize}" letter-spacing="${ls}" fill="${SKY}"
        dominant-baseline="central">TIMEMACHINE</text>
</svg>`;
}

async function main() {
  fs.writeFileSync(path.join(OUT, 'mark.svg'), markSvg + '\n');
  fs.writeFileSync(path.join(OUT, 'app-icon.svg'), appIconSvg + '\n');

  // mark: transparent 1024×1024
  await sharp(Buffer.from(markSvg)).resize(1024, 1024)
    .png().toFile(path.join(OUT, 'mark-1024.png'));
  // app-icon: 1024×1024 on the dark square
  await sharp(Buffer.from(appIconSvg)).resize(1024, 1024)
    .png().toFile(path.join(OUT, 'app-icon-1024.png'));

  // wordmark: render master, trim to tight transparent box, read its size.
  const master = await sharp(Buffer.from(wordmarkMasterSvg(REF)))
    .trim().png().toBuffer({ resolveWithObject: true });
  const { width: tw, height: th } = master.info;

  // A tight, self-contained vector wordmark (font embedded → renders anywhere).
  const ls = -(REF * 0.02).toFixed(2);
  const wordmarkSvg =
`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${tw} ${th}">
  <defs><style>
    @font-face { font-family: 'Inter'; src: url('${fontDataURL}') format('woff'); font-weight: 800; }
  </style></defs>
  <text x="0" y="${Math.round(th * 0.80)}" font-family="'Inter', sans-serif" font-weight="800"
        font-size="${REF}" letter-spacing="${ls}" fill="${SKY}">TIMEMACHINE</text>
</svg>`;
  fs.writeFileSync(path.join(OUT, 'wordmark.svg'), wordmarkSvg + '\n');

  // Transparent PNG, 1024px on the long edge.
  await sharp(master.data).resize({ width: 1024 })
    .png().toFile(path.join(OUT, 'wordmark-1024.png'));

  console.log(`wordmark tight box: ${tw}x${th} (aspect ${(tw / th).toFixed(2)})`);
  console.log('brand assets written to', OUT);
}

main().catch(e => { console.error(e); process.exit(1); });
