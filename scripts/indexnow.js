#!/usr/bin/env node
// IndexNow ping (chunk 29). Tells Bing/Yandex-class engines that specific URLs
// changed, so they recrawl without waiting for the sitemap cycle. Google does
// not use IndexNow; this complements Search Console, it does not replace it.
//
// Usage, after a deploy has LANDED (ping only URLs that already serve the new
// content):
//
//   node scripts/indexnow.js /apa-rates /welcome /articles/apa-rates-2026
//
// Paths start with "/". "/" alone pings the homepage. The key file this script
// names is served at the site root and is on the build allow-list; the key is
// an ownership token the protocol requires to be public - it grants no access.
//
// This script runs from a shell, never from a page: no site page makes any
// outbound request, so the privacy page's devtools claim stays true.

const https = require('https');

const HOST = 'timemachineapp.co.uk';
const KEY = 'd263510123ec0559d8221266b85ea084f85f86c9a89c767f49b1a8180443b9d1';

const paths = process.argv.slice(2);
if (!paths.length) {
  console.error('usage: node scripts/indexnow.js /path [/path ...]');
  process.exit(1);
}
const bad = paths.filter(p => !p.startsWith('/'));
if (bad.length) {
  console.error('paths must start with "/":', bad.join(' '));
  process.exit(1);
}

const body = JSON.stringify({
  host: HOST,
  key: KEY,
  keyLocation: `https://${HOST}/${KEY}.txt`,
  urlList: paths.map(p => `https://${HOST}${p}`),
});

const req = https.request({
  hostname: 'api.indexnow.org',
  path: '/indexnow',
  method: 'POST',
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) },
}, res => {
  // 200 = submitted; 202 = accepted, key validation pending. Both are success.
  const ok = res.statusCode === 200 || res.statusCode === 202;
  console.log(`indexnow: HTTP ${res.statusCode} ${ok ? '(ok)' : '(FAILED)'} for ${paths.length} URL(s)`);
  paths.forEach(p => console.log(`  https://${HOST}${p}`));
  process.exit(ok ? 0 : 1);
});
req.on('error', e => { console.error('indexnow: request failed:', e.message); process.exit(1); });
req.write(body);
req.end();
