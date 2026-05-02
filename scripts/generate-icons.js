#!/usr/bin/env node
// Generates PWA icon PNGs using Inter Black (woff) embedded in SVG, rasterised via sharp.
// Run from repo root: node scripts/generate-icons.js
'use strict';

const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const FONT_PATH = path.resolve(__dirname, '../node_modules/@fontsource/inter/files/inter-latin-900-normal.woff');
const OUT = path.resolve(__dirname, '..');

const SIZES = [
  { size: 1024, file: 'icon-1024.png' },
  { size: 512,  file: 'icon-512.png'  },
  { size: 192,  file: 'icon-192.png'  },
  { size: 180,  file: 'icon-180.png'  },
  { size: 32,   file: 'favicon-32.png'},
  { size: 16,   file: 'favicon-16.png'},
];

// Embed font as base64 data URL (done once)
const fontB64 = fs.readFileSync(FONT_PATH).toString('base64');
const fontDataURL = `data:font/woff;base64,${fontB64}`;

function buildSVG(size) {
  // Proportional sizing — calibrated on 1024px master.
  // TIME: font-size≈30% of icon, MACHINE≈16.4%
  const timeFontSize  = Math.round(size * 0.302);
  const machFontSize  = Math.round(size * 0.164);

  // Vertical positioning (as % of icon height — matches original SVG):
  //   TIME baseline: 42%  |  divider: 48.6%  |  MACHINE baseline: 65.2%
  const timeY    = Math.round(size * 0.420);
  const divY     = Math.round(size * 0.486);
  const machY    = Math.round(size * 0.652);

  // Divider span: left edge 16.8%, right edge 83.2%
  const divX     = Math.round(size * 0.168);
  const divW     = Math.round(size * 0.664);
  const divH     = Math.max(1, Math.round(size * 0.003));

  // Letter spacing
  const timeLs   = -(size * 0.006).toFixed(2);  // slight optical tightening
  const machLs   = (size * 0.010).toFixed(2);   // slight track-out for MACHINE

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <style>
      @font-face {
        font-family: 'IconFont';
        src: url('${fontDataURL}') format('woff');
        font-weight: 900;
      }
    </style>
  </defs>
  <rect width="${size}" height="${size}" fill="#0e1729"/>
  <text
    x="${size / 2}" y="${timeY}"
    font-family="'IconFont', 'Arial Black', sans-serif"
    font-weight="900"
    font-size="${timeFontSize}"
    fill="#38bdf8"
    text-anchor="middle"
    dominant-baseline="auto"
    letter-spacing="${timeLs}">TIME</text>
  <rect x="${divX}" y="${divY}" width="${divW}" height="${divH}" fill="#38bdf8" opacity="0.3"/>
  <text
    x="${size / 2}" y="${machY}"
    font-family="'IconFont', 'Arial Black', sans-serif"
    font-weight="900"
    font-size="${machFontSize}"
    fill="#38bdf8"
    text-anchor="middle"
    dominant-baseline="auto"
    letter-spacing="${machLs}">MACHINE</text>
</svg>`;
}

(async () => {
  for (const { size, file } of SIZES) {
    const svg = buildSVG(size);
    const outPath = path.join(OUT, file);
    await sharp(Buffer.from(svg)).png().toFile(outPath);
    const bytes = fs.statSync(outPath).size;
    console.log(`Generated: ${file}  (${size}×${size}, ${bytes} bytes)`);
  }
  console.log('Done.');
})().catch(e => { console.error(e); process.exit(1); });
