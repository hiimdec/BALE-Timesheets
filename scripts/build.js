#!/usr/bin/env node
/*
 * Offline build for the App Store / GitHub Pages wrap.
 *
 * This is a PURELY MECHANICAL transform. It does not touch your app logic:
 *   1. Reads index.html (still your single editable source of truth).
 *   2. Pulls the JSX out of the <script type="text/babel"> block and runs it
 *      through esbuild — JSX -> plain JS, ahead of time. No in-browser Babel.
 *      React / ReactDOM stay as globals (esbuild only rewrites the JSX syntax;
 *      every other expression is left exactly as written), so the calculation
 *      engine is byte-for-byte the same behaviour.
 *   3. Builds a static Tailwind stylesheet (Tailwind CLI scans index.html).
 *   4. Vendors React + ReactDOM locally (copied from node_modules).
 *   5. Copies the static assets (icons, manifest, etc.).
 *   6. Writes dist/index.html that loads everything from ./vendor and ./assets
 *      using RELATIVE paths, so the SAME /dist folder works for both Capacitor
 *      (file://) and GitHub Pages (served from a sub-path).
 *
 * Output: everything lands in /dist. Nothing is fetched from the internet at
 * runtime.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const esbuild = require('esbuild');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const ASSETS = path.join(DIST, 'assets');
const VENDOR = path.join(DIST, 'vendor');

const SRC_HTML = path.join(ROOT, 'index.html');

// Static files that the app references by relative path. They must live next to
// dist/index.html so both Capacitor and GitHub Pages can find them offline.
const STATIC_ASSETS = [
  'manifest.json',
  'icon.svg',
  'favicon-16.png',
  'favicon-32.png',
  'icon-180.png',
  'icon-192.png',
  'icon-512.png',
  'icon-512-maskable.png',
];

const log = (msg) => console.log(`  ${msg}`);

function cleanDist() {
  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(ASSETS, { recursive: true });
  fs.mkdirSync(VENDOR, { recursive: true });
}

// Pull the JSX source out of the single <script type="text/babel"> block.
function extractAppSource(html) {
  const startMarker = '<script type="text/babel" data-type="module">';
  const startIdx = html.indexOf(startMarker);
  if (startIdx === -1) {
    throw new Error('Could not find the <script type="text/babel"> block in index.html');
  }
  const afterStart = startIdx + startMarker.length;
  // The app body contains no literal "</script>", so the next one closes it.
  const endIdx = html.indexOf('</script>', afterStart);
  if (endIdx === -1) {
    throw new Error('Could not find the closing </script> for the app block');
  }
  return html.slice(afterStart, endIdx);
}

// Build dist/index.html: drop the CDN tags + the inline tailwind.config script,
// link the static stylesheet, vendor React, and load the precompiled app.js.
function buildHtml(html) {
  // 1. Replace the whole CDN dependencies block (Tailwind CDN + inline config +
  //    React + ReactDOM + Babel) with local references.
  const cdnBlockStart = html.indexOf('<!-- CDN Dependencies -->');
  const babelTag = '<script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>';
  const cdnBlockEnd = html.indexOf(babelTag);
  if (cdnBlockStart === -1 || cdnBlockEnd === -1) {
    throw new Error('Could not locate the CDN dependencies block in index.html');
  }
  const replacement =
    '<!-- Vendored offline dependencies (precompiled, no network at runtime) -->\n' +
    '  <link rel="stylesheet" href="./assets/tailwind.css">\n' +
    '  <script src="./vendor/react.production.min.js"></script>\n' +
    '  <script src="./vendor/react-dom.production.min.js"></script>';
  html =
    html.slice(0, cdnBlockStart) +
    replacement +
    html.slice(cdnBlockEnd + babelTag.length);

  // 2. Replace the giant <script type="text/babel"> ... </script> with a single
  //    tag pointing at the precompiled bundle.
  const startMarker = '<script type="text/babel" data-type="module">';
  const startIdx = html.indexOf(startMarker);
  const endIdx = html.indexOf('</script>', startIdx + startMarker.length);
  html =
    html.slice(0, startIdx) +
    '<script src="./assets/app.js"></script>' +
    html.slice(endIdx + '</script>'.length);

  return html;
}

function copyVendor() {
  const files = [
    ['react', 'umd/react.production.min.js'],
    ['react-dom', 'umd/react-dom.production.min.js'],
  ];
  for (const [pkg, rel] of files) {
    const from = path.join(ROOT, 'node_modules', pkg, rel);
    const to = path.join(VENDOR, path.basename(rel));
    fs.copyFileSync(from, to);
    log(`vendored ${path.basename(rel)}`);
  }
}

function copyStaticAssets() {
  for (const name of STATIC_ASSETS) {
    const from = path.join(ROOT, name);
    if (fs.existsSync(from)) {
      fs.copyFileSync(from, path.join(DIST, name));
    } else {
      log(`(skipped missing asset: ${name})`);
    }
  }
}

async function main() {
  console.log('Building offline /dist …');
  cleanDist();

  const html = fs.readFileSync(SRC_HTML, 'utf8');

  // --- JSX -> JS, ahead of time (no minify: keeps the logic readable & 1:1) ---
  const appSource = extractAppSource(html);
  const result = await esbuild.transform(appSource, {
    loader: 'jsx',
    jsx: 'transform',
    jsxFactory: 'React.createElement',
    jsxFragment: 'React.Fragment',
    target: 'es2017',
    format: 'iife', // wrap so top-level declarations don't leak to window
  });
  fs.writeFileSync(path.join(ASSETS, 'app.js'), result.code);
  log('precompiled JSX -> assets/app.js');

  // --- Static Tailwind stylesheet (scans index.html for classes) ---
  execFileSync(
    process.execPath,
    [
      path.join(ROOT, 'node_modules', 'tailwindcss', 'lib', 'cli.js'),
      '-c', path.join(ROOT, 'tailwind.config.js'),
      '-i', path.join(ROOT, 'src', 'styles.css'),
      '-o', path.join(ASSETS, 'tailwind.css'),
      '--minify',
    ],
    { stdio: 'inherit' }
  );
  log('built assets/tailwind.css');

  copyVendor();
  copyStaticAssets();

  fs.writeFileSync(path.join(DIST, 'index.html'), buildHtml(html));
  log('wrote dist/index.html');

  console.log('Done. Offline build is in /dist');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
