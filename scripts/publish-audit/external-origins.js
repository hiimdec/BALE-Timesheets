#!/usr/bin/env node
'use strict';
/*
 * audit:publish — no external origin in the PUBLISHED tree.
 *
 * WHY THIS IS ITS OWN STAGE, and not a clause in audit:web. audit:web is a
 * RUNTIME check: it loads dist/assets/app.js into a JS sandbox and watches what
 * the code does. A static `<script src="https://unpkg.com/…">` in an HTML head
 * is invisible to it, because the sandbox never parses HTML. That is exactly
 * how four CDN loads shipped to every web visitor while the app's own privacy
 * text claimed "there are no external CDNs and no third party ever sees your IP
 * address" — the gate was green the whole time, testing a file the site did not
 * serve.
 *
 * So this stage reads what is actually PUBLISHED (dist-web/, after
 * build-web.js) and fails on any SUBRESOURCE pointing at another origin — the
 * things a browser fetches automatically, without the user choosing to.
 *
 * SUBRESOURCES vs LINKS, the distinction that makes this usable: an
 * <a href="https://apps.apple.com/…"> is a link a person clicks; it leaks
 * nothing until they do, and the site legitimately carries several (App Store,
 * ICO, the APA terms, Instagram). A <script src>, <link rel=stylesheet|preload>,
 * <img src>, @import or url() is fetched by the browser on load, whether the
 * visitor wants it or not. Only the second class is a privacy claim's business,
 * so only the second class fails here.
 *
 * The failure names the FILE and the HOST, because "an external origin exists"
 * is not actionable and "app/index.html -> unpkg.com" is.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const DIR = process.env.WEB_PUBLISH_DIR
  ? path.resolve(ROOT, process.env.WEB_PUBLISH_DIR)
  : path.join(ROOT, 'dist-web');

// The site's own origin is not external. Protocol-relative (//host/…) counts as
// external: it inherits the page's scheme and still contacts another host.
const OWN_HOSTS = new Set(['timemachineapp.co.uk', 'www.timemachineapp.co.uk']);

// Subresource attributes only — see the header note on links vs subresources.
// <link> is filtered by rel: stylesheet/preload/prefetch/dns-prefetch/preconnect
// fetch or reach out; canonical/alternate/manifest/icon are references or
// same-origin by construction (an external icon would be caught by its own rel).
const PATTERNS = [
  { what: 'script src',       re: /<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi },
  { what: 'img src',          re: /<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi },
  { what: 'iframe src',       re: /<iframe\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi },
  { what: 'media src',        re: /<(?:source|track|embed|audio|video)\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi },
  { what: 'css @import',      re: /@import\s+(?:url\()?\s*["']?([^"')\s;]+)/gi },
  { what: 'css url()',        re: /url\(\s*["']?([^"')]+)["']?\s*\)/gi },
];
const LINK_RE = /<link\b[^>]*>/gi;
const FETCHING_RELS = /\b(stylesheet|preload|prefetch|dns-prefetch|preconnect|modulepreload)\b/i;
const SCANNED_EXT = /\.(html|css|js|json|webmanifest|svg|xml)$/i;

function hostOf(url) {
  const u = String(url).trim();
  if (u.startsWith('//')) return u.slice(2).split(/[/?#]/)[0].toLowerCase();
  const m = /^https?:\/\/([^/?#]+)/i.exec(u);
  return m ? m[1].toLowerCase() : null;   // relative / data: / mailto: → same-origin or not a fetch
}

function walk(dir) {
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

function main() {
  if (!fs.existsSync(DIR)) {
    console.error(`\n[audit:publish] FAILED: ${path.relative(ROOT, DIR)}/ does not exist.`);
    console.error('[audit:publish] Run `npm run build && node scripts/build-web.js` first.\n');
    process.exit(1);
  }
  const files = walk(DIR).filter((f) => SCANNED_EXT.test(f));
  if (files.length === 0) {
    console.error('\n[audit:publish] FAILED: nothing scannable in the publish tree — refusing to pass vacuously.\n');
    process.exit(1);
  }

  const findings = [];
  for (const abs of files) {
    const rel = path.relative(DIR, abs).split(path.sep).join('/');
    const text = fs.readFileSync(abs, 'utf8');

    for (const { what, re } of PATTERNS) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(text)) !== null) {
        const host = hostOf(m[1]);
        if (host && !OWN_HOSTS.has(host)) findings.push({ rel, what, host, url: m[1].slice(0, 90) });
      }
    }
    LINK_RE.lastIndex = 0;
    let lm;
    while ((lm = LINK_RE.exec(text)) !== null) {
      const tag = lm[0];
      const relAttr = /\brel\s*=\s*["']([^"']+)["']/i.exec(tag);
      if (!relAttr || !FETCHING_RELS.test(relAttr[1])) continue;
      const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(tag);
      if (!href) continue;
      const host = hostOf(href[1]);
      if (host && !OWN_HOSTS.has(host)) findings.push({ rel, what: `link rel=${relAttr[1]}`, host, url: href[1].slice(0, 90) });
    }
  }

  console.log(`\n[audit:publish] scanned ${files.length} file(s) in ${path.relative(ROOT, DIR)}/`);
  if (findings.length) {
    const hosts = [...new Set(findings.map((f) => f.host))].sort();
    console.error(`\n[audit:publish] FAILED — ${findings.length} external subresource(s) across ${hosts.length} host(s): ${hosts.join(', ')}`);
    for (const f of findings) console.error(`  x ${f.rel}  ->  ${f.host}   (${f.what}: ${f.url})`);
    console.error("\n[audit:publish] A published page must fetch nothing from another origin: the privacy text");
    console.error("[audit:publish] claims no external CDNs and no third party sees the visitor's IP address.\n");
    process.exit(1);
  }
  console.log('[audit:publish] OK — zero external subresources. Ordinary <a href> links are ignored by design.\n');
  process.exit(0);
}

main();
