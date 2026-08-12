#!/usr/bin/env node
'use strict';
/*
 * build-web.js - assemble the web-only publish directory (web chunk 2).
 *
 * Fail-closed by construction: NOTHING is published unless it is named on the
 * ALLOW list below. No wildcards over the repo root. The script:
 *   1. fails loudly if any allow-listed file is MISSING (a rename must never
 *      silently drop the sitemap or an article);
 *   2. copies only the allow-listed files into the publish directory;
 *   3. fails if any file lands in the publish directory that is NOT on the
 *      allow-list (integrity net), or if any allow-listed file failed to copy;
 *   4. prints the full manifest of what it copied;
 *   5. warns (without failing) about web-type files present in the repo but not
 *      on the allow-list, so a newly added page/asset is never silently dropped.
 *
 * This is intentionally SEPARATE from the native build (scripts/build.js), which
 * is left untouched. Node standard library only - no third-party dependencies,
 * so the deploy needs no npm packages.
 *
 * Env overrides (used by tests; unset in normal/Netlify runs):
 *   WEB_SRC_ROOT     - source root to read from      (default: repo root)
 *   WEB_PUBLISH_DIR  - output directory name          (default: dist-web)
 */

const fs = require('fs');
const path = require('path');

const SRC = process.env.WEB_SRC_ROOT
  ? path.resolve(process.env.WEB_SRC_ROOT)
  : path.resolve(__dirname, '..');
const OUT_DIR = process.env.WEB_PUBLISH_DIR || 'dist-web';
const OUT = path.join(SRC, OUT_DIR);

// ---------------------------------------------------------------------------
// ALLOW-LIST - every publishable file, named explicitly.
// ---------------------------------------------------------------------------
const ALLOW = [
  // The app
  'index.html',
  // Marketing + legal pages
  'welcome.html',
  'how-it-works.html',
  'articles.html',
  'privacy.html',
  's.html',
  // Reference page (chunk 5): unlinked, kept out of the sitemap and the articles index, pending review.
  'apa-rates.html',
  // Homepage preview (chunk 12): noindex meta + X-Robots-Tag header (netlify.toml), kept out of the sitemap. Becomes the homepage at the /app move.
  'home-preview.html',
  // Articles (all ten)
  'articles/apa-mileage-what-you-can-claim.html',
  'articles/breaks-and-penalties.html',
  'articles/continuous-working-day.html',
  'articles/how-apa-overtime-works.html',
  'articles/how-apa-rates-work.html',
  'articles/late-payment-what-youre-owed.html',
  'articles/night-shoots-what-youre-owed.html',
  'articles/prep-recce-and-pre-light-days.html',
  'articles/shoot-cancelled-what-are-you-owed.html',
  'articles/time-off-the-clock.html',
  'articles/apa-rates-2026.html',
  'articles/how-to-invoice-an-apa-job.html',
  // PWA / crawl metadata
  'manifest.json',
  'robots.txt',
  'sitemap.xml',
  // Netlify per-directory headers (sets the AASA content type in the publish dir)
  '_headers',
  // Icons / favicons / apple-touch
  'icon.svg',
  'icon-180.png',
  'icon-192.png',
  'icon-512.png',
  'icon-512-maskable.png',
  'favicon-16.png',
  'favicon-32.png',
  // Social / OG images
  'og-image.png',
  'og-shoot-share.png',
  // Static asset + deep-link association (named explicitly, not by wildcard)
  'assets/logo.png',
  '.well-known/apple-app-site-association',
];

// Web-facing directories to scan for "present but not published" files (warn only).
// '' means the repo root, scanned non-recursively.
const WATCH_DIRS = ['', 'articles', 'assets', '.well-known'];
const WEB_EXT = /\.(html|json|txt|xml|png|svg|ico|webmanifest|webp|jpg|jpeg|avif|gif)$/i;

// ---------------------------------------------------------------------------
const problems = [];
const warnings = [];
const fail = (m) => problems.push(m);
const toPosix = (p) => p.split(path.sep).join('/');
const ALLOW_SET = new Set(ALLOW.map(toPosix));

function walk(dir) {
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}
function rmrf(p) { if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true }); }

function finish(code) {
  if (problems.length) {
    console.error(`\n[build-web] FAILED (${problems.length} problem(s)):`);
    for (const p of problems) console.error(`  x ${p}`);
    console.error('');
  }
  process.exit(code);
}

// 1. Presence - every allow-listed file must exist as a file.
for (const rel of ALLOW) {
  const src = path.join(SRC, rel);
  if (!fs.existsSync(src) || !fs.statSync(src).isFile()) fail(`MISSING allow-listed file: ${rel}`);
}
if (problems.length) finish(1);

// 2. Warn about web-type files that exist in the repo but are NOT published.
for (const d of WATCH_DIRS) {
  const abs = path.join(SRC, d);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) continue;
  for (const name of fs.readdirSync(abs)) {
    const full = path.join(abs, name);
    if (fs.statSync(full).isDirectory()) continue;
    const rel = toPosix(d ? `${d}/${name}` : name);
    if (ALLOW_SET.has(rel)) continue;
    if (d === '' && !WEB_EXT.test(name)) continue; // ignore non-web root files (docs, source, config)
    warnings.push(rel);
  }
}

// 3. Copy - allow-list only.
rmrf(OUT);
for (const rel of ALLOW) {
  const dst = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(path.join(SRC, rel), dst);
}

// 4. Verify the publish dir contains EXACTLY the allow-list.
const landed = walk(OUT).map((f) => toPosix(path.relative(OUT, f)));
for (const rel of landed) if (!ALLOW_SET.has(rel)) fail(`UNLISTED file in ${OUT_DIR}/: ${rel}`);
for (const rel of ALLOW) if (!landed.includes(rel)) fail(`allow-listed file failed to copy: ${rel}`);
if (landed.length !== ALLOW.length) fail(`count mismatch: expected ${ALLOW.length}, found ${landed.length}`);
if (problems.length) finish(1);

// 5. Manifest.
console.log(`\n[build-web] source : ${SRC}`);
console.log(`[build-web] publish: ${OUT_DIR}/  (${landed.length} files, allow-list only)\n`);
let total = 0;
for (const rel of ALLOW.slice().sort()) {
  const size = fs.statSync(path.join(OUT, rel)).size;
  total += size;
  console.log(`  ${String(size).padStart(9)}  ${rel}`);
}
console.log(`\n  ${String(total).padStart(9)}  (total bytes)`);
if (warnings.length) {
  console.log(`\n[build-web] WARNING - web-type files in the repo NOT on the allow-list (deliberately unpublished):`);
  for (const w of warnings.slice().sort()) console.log(`  ! ${w}`);
}
console.log(`\n[build-web] OK - fail-closed publish set assembled.\n`);
finish(0);
