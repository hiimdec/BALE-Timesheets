#!/usr/bin/env node
// Generates PWA icon PNGs using Inter ExtraBold (800) embedded in SVG, rasterised via sharp.
// TIME is scaled so its rendered pixel width matches MACHINE's rendered pixel width.
// Run from repo root: node scripts/generate-icons.js
'use strict';

const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const FONT_PATH = path.resolve(__dirname, '../node_modules/@fontsource/inter/files/inter-latin-800-normal.woff');
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

// Build an SVG containing a single word at a given font-size for measurement.
function buildMeasureSVG(word, fontSize, canvasSize) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${canvasSize}" height="${canvasSize}" viewBox="0 0 ${canvasSize} ${canvasSize}">
  <defs>
    <style>
      @font-face {
        font-family: 'IconFont';
        src: url('${fontDataURL}') format('woff');
        font-weight: 800;
      }
    </style>
  </defs>
  <rect width="${canvasSize}" height="${canvasSize}" fill="#000000"/>
  <text
    x="${canvasSize / 2}" y="${canvasSize / 2}"
    font-family="'IconFont', sans-serif"
    font-weight="800"
    font-size="${fontSize}"
    fill="#ffffff"
    text-anchor="middle"
    dominant-baseline="middle"
    letter-spacing="${-(fontSize * 0.02).toFixed(2)}">${word}</text>
</svg>`;
}

// Rasterise SVG and scan pixel columns to find the leftmost and rightmost non-black column.
// Returns the pixel width of the rendered text.
async function measureWordWidth(word, fontSize, canvasSize) {
  const svg = buildMeasureSVG(word, fontSize, canvasSize);
  const { data, info } = await sharp(Buffer.from(svg))
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height } = info;
  let left = width;
  let right = -1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[y * width + x] > 10) {
        if (x < left) left = x;
        if (x > right) right = x;
      }
    }
  }

  if (right < left) return 0; // no pixels found
  return right - left + 1;
}

// Compute the TIME font-size multiplier relative to MACHINE.
// We render both at the same reference size, measure their pixel widths,
// then scale TIME so its width equals MACHINE's width.
async function computeTimeFontScale(refFontSize, canvasSize) {
  const machWidth = await measureWordWidth('MACHINE', refFontSize, canvasSize);
  const timeWidth = await measureWordWidth('TIME', refFontSize, canvasSize);
  if (timeWidth === 0 || machWidth === 0) {
    console.warn('Warning: measurement returned 0 — falling back to ratio 1.75');
    return 1.75;
  }
  const ratio = machWidth / timeWidth;
  console.log(`  Measured at ${refFontSize}px: MACHINE=${machWidth}px TIME=${timeWidth}px → TIME scale ×${ratio.toFixed(4)}`);
  return ratio;
}

function buildSVG(size, timeFontSize, machFontSize) {
  const timeY    = Math.round(size * 0.420);
  const divY     = Math.round(size * 0.486);
  const machY    = Math.round(size * 0.652);

  const divX     = Math.round(size * 0.168);
  const divW     = Math.round(size * 0.664);
  const divH     = Math.max(1, Math.round(size * 0.003));

  // letter-spacing: -0.02em expressed in px
  const timeLs   = -(timeFontSize * 0.02).toFixed(2);
  const machLs   = -(machFontSize * 0.02).toFixed(2);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <style>
      @font-face {
        font-family: 'IconFont';
        src: url('${fontDataURL}') format('woff');
        font-weight: 800;
      }
    </style>
  </defs>
  <rect width="${size}" height="${size}" fill="#0e1729"/>
  <text
    x="${size / 2}" y="${timeY}"
    font-family="'IconFont', sans-serif"
    font-weight="800"
    font-size="${timeFontSize}"
    fill="#38bdf8"
    text-anchor="middle"
    dominant-baseline="auto"
    letter-spacing="${timeLs}">TIME</text>
  <rect x="${divX}" y="${divY}" width="${divW}" height="${divH}" fill="#38bdf8" opacity="0.3"/>
  <text
    x="${size / 2}" y="${machY}"
    font-family="'IconFont', sans-serif"
    font-weight="800"
    font-size="${machFontSize}"
    fill="#38bdf8"
    text-anchor="middle"
    dominant-baseline="auto"
    letter-spacing="${machLs}">MACHINE</text>
</svg>`;
}

(async () => {
  // Measure at a comfortable reference size (256px canvas, 40px font)
  console.log('Measuring TIME vs MACHINE pixel widths...');
  const scale = await computeTimeFontScale(40, 256);

  for (const { size, file } of SIZES) {
    const machFontSize = Math.round(size * 0.165);
    const timeFontSize = Math.round(machFontSize * scale);

    const svg = buildSVG(size, timeFontSize, machFontSize);
    const outPath = path.join(OUT, file);
    await sharp(Buffer.from(svg)).png().toFile(outPath);
    const bytes = fs.statSync(outPath).size;
    console.log(`Generated: ${file}  (${size}×${size}, TIME=${timeFontSize}px MACH=${machFontSize}px, ${bytes} bytes)`);
  }
  console.log('Done.');
})().catch(e => { console.error(e); process.exit(1); });
