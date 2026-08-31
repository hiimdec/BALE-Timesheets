#!/usr/bin/env node
'use strict';
/*
 * audit:callsheets — phase one: extraction + convention coverage over REAL
 * call sheets (founder-ruled, 2026-08-31).
 *
 * The sheets live OUTSIDE the repo at ~/Developer/tm-callsheets/ (override:
 * TM_CALLSHEET_DIR) and are NEVER committed — this repo is public on GitHub
 * and history is permanent. The phase-two expectations file lives beside
 * them, outside the repo, for the same reason (it holds real invoicing
 * emails and companies).
 *
 * ABSENCE IS LOUD, NEVER SILENT: no folder / no sheets → a clearly-printed
 * SKIPPED banner and exit 0 (a machine without the sheets stays green, and
 * its green is visibly different from a with-sheets green). A stage that
 * quietly skips is worse than no stage.
 *
 * THE COVERAGE REPORT IS THE POINT. The pattern-primary reader design
 * (CALC_DECISIONS / the 2026-08-31 investigation) flagged every lexicon as
 * a convention-GUESS: the "invoic" page-selection token, the email intent
 * keywords, the title labels, the job-reference labels, the company
 * suffixes, the postcode anchor. This report measures each against the
 * real corpus — per convention: how many sheets carry it AND WHICH SHEETS
 * DO NOT, by name, so a miss is inspectable rather than a percentage.
 *
 * Phase-one assertions (approved): every text-layer sheet yields > 200
 * chars, and the corpus contains at least one "invoic" sheet. A sheet with
 * NO text layer (a scan/photo exported to PDF) fails the first assertion by
 * name — move it to photos/ (out of phase-one scope) or re-export.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const DIR = process.env.TM_CALLSHEET_DIR || path.join(os.homedir(), 'Developer', 'tm-callsheets');

function main() {
  let entries = [];
  try {
    entries = fs.readdirSync(DIR).filter(f => /\.pdf$/i.test(f)).sort();
  } catch (_) {
    console.log('⚠ CALL-SHEET FIXTURES NOT PRESENT at ' + DIR);
    console.log('⚠ stage SKIPPED - 0 sheets, 0 assertions run');
    process.exit(0);
  }
  if (!entries.length) {
    console.log('⚠ CALL-SHEET FIXTURES NOT PRESENT at ' + DIR + ' (folder exists, no PDFs)');
    console.log('⚠ stage SKIPPED - 0 sheets, 0 assertions run');
    process.exit(0);
  }
  run(entries).then(ok => process.exit(ok ? 0 : 1))
    .catch(e => { console.error('❌ call-sheet stage failed:', (e && e.stack) || e); process.exit(1); });
}

async function extractSheet(pdfjs, file) {
  const data = new Uint8Array(fs.readFileSync(path.join(DIR, file)));
  const doc = await pdfjs.getDocument({ data, useSystemFonts: true, isEvalSupported: false }).promise;
  const pages = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    // Group items into lines by y (transform[5]) within a small tolerance,
    // left-to-right within a line — the same reading-order idea the app's
    // Vision path uses, so phase-two harvests see comparable line text.
    const items = tc.items
      .filter(it => it.str && it.str.trim())
      .map(it => ({ str: it.str, x: it.transform[4], y: it.transform[5] }));
    items.sort((a, b) => (Math.abs(a.y - b.y) > 2 ? b.y - a.y : a.x - b.x));
    const lines = [];
    for (const it of items) {
      const last = lines[lines.length - 1];
      if (last && Math.abs(last.y - it.y) <= 2) last.text += ' ' + it.str;
      else lines.push({ y: it.y, text: it.str });
    }
    pages.push(lines.map(l => l.text).join('\n'));
  }
  const text = pages.join('\n');
  return { file, pages, text, chars: text.replace(/\s/g, '').length };
}

// ── The conventions under measurement — each one is a lexicon the
//    pattern-primary design GUESSED from convention. Sources: the Swift
//    harvests in CallSheetPlugin.swift (title labels, email intent, page
//    selection, postcode) and the proposed job-ref / company-suffix /
//    address lexicons from the 2026-08-31 design round. ──
const CONVENTIONS = [
  { id: 'page selection: "invoic" appears', test: t => /invoic/.test(t) },
  { id: 'accounts/billing wording WITHOUT "invoic" (selection blind spot)', test: t => !/invoic/.test(t) && /(accounts|billing)/.test(t) },
  { id: 'email intent keyword near-verbatim (invoice/invoicing/account/billing/please email/send to/remittance/pay to)', test: t => /(invoice|invoicing|account|billing|please email|send to|remittance|pay to)/.test(t) },
  { id: 'any email address present', test: t => /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/.test(t) },
  { id: 'title label (production:/production title:/client:/title:/project:/job name:/campaign:)', test: t => /(production|production title|client|title|project|job name|campaign)\s*:/.test(t) },
  { id: 'job-ref label (job no/job number/job ref/job code/ref:/po number/purchase order/quote)', test: t => /(job\s*(no|number|ref|reference|code)|\bref\s*:|po\s*number|purchase\s*order|quote)/.test(t) },
  { id: 'UK postcode shape (the address anchor)', test: t => /[a-z]{1,2}[0-9][0-9a-z]?\s*[0-9][a-z]{2}/.test(t) },
  { id: 'company suffix (ltd/limited/llp/productions/films/pictures/studio/media)', test: t => /\b(ltd|limited|llp|productions|films|pictures|studios?|media)\b/.test(t) },
  { id: 'invoicing-address label (address invoices/invoice to/invoicing address)', test: t => /(address\s+invoices|invoice\s+to|invoicing\s+address)/.test(t) },
];

async function run(files) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const sheets = [];
  const unreadable = [];
  for (const f of files) {
    try { sheets.push(await extractSheet(pdfjs, f)); }
    catch (e) { unreadable.push({ file: f, why: (e && e.message) || 'unreadable' }); }
  }
  console.log(`call-sheet fixtures: ${files.length} sheet${files.length === 1 ? '' : 's'} at ${DIR}`);
  console.log('');

  // Per-sheet extraction summary.
  for (const s of sheets) {
    const invPages = s.pages.map((p, i) => (/invoic/i.test(p) ? i + 1 : 0)).filter(Boolean);
    console.log(`  ${s.file}: ${s.pages.length} page(s), ${s.chars} chars${invPages.length ? `, "invoic" on p.${invPages.join(',')}` : ''}`);
  }
  for (const u of unreadable) console.log(`  ${u.file}: UNREADABLE (${u.why})`);
  console.log('');

  // ── CONVENTION COVERAGE — counts AND the named misses. ──
  console.log('CONVENTION COVERAGE (misses named, not percentaged):');
  for (const c of CONVENTIONS) {
    const hits = sheets.filter(s => c.test(s.text.toLowerCase()));
    const misses = sheets.filter(s => !c.test(s.text.toLowerCase()));
    console.log(`  ${String(hits.length).padStart(2)}/${sheets.length}  ${c.id}`);
    if (misses.length && misses.length < sheets.length) {
      console.log(`         not on: ${misses.map(m => m.file).join(', ')}`);
    }
  }
  console.log('');

  // ── Phase-one assertions (approved): named failures, honest exit code. ──
  let failures = 0;
  const thin = sheets.filter(s => s.chars <= 200);
  for (const s of thin) {
    failures++;
    console.log(`❌ ${s.file}: only ${s.chars} chars of text layer - a scan/photo PDF? Move it to photos/ (phase-one reads text layers only) or re-export.`);
  }
  for (const u of unreadable) { failures++; console.log(`❌ ${u.file}: could not be parsed as a PDF.`); }
  if (!sheets.some(s => /invoic/i.test(s.text))) {
    failures++;
    console.log('❌ corpus check: NO sheet contains "invoic" - the app\'s page selection would fall back to sequential on every one of these. Worth a ruling if real.');
  }
  const asserted = sheets.length + unreadable.length + 1;
  console.log('');
  console.log(failures === 0
    ? `✅ call-sheet stage: ${sheets.length} sheet(s), ${asserted} assertions, coverage reported above`
    : `❌ call-sheet stage: ${failures} failure(s) across ${asserted} assertions`);
  return failures === 0;
}

main();
