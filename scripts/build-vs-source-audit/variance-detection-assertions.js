/*
 * variance-detection-assertions.js
 *
 *   $ node scripts/build-vs-source-audit/variance-detection-assertions.js
 *
 * The BB per-day variance detection contract (the fuchsia-highlight fix).
 * The bug: the crew-list feed handed getCrewVariances the RAW date-level
 * dayDefaults[currentDate] record; days created via next-day/bulk-add never
 * have one, so the detector's !defaults bail returned [] for everyone and
 * the fuchsia name + VARIANCES accordion silently died on exactly those
 * days — while the detail view's own presence-based checks kept working.
 * No audit watched variance detection, which is why it survived; this suite
 * is that guard. The fix feeds the detector the SAME resolved cascade the
 * dept card uses: DEFAULT_PRODUCTION_DAY ← production.defaultDay ←
 * dayDefaults[date]. getCrewVariances itself is UNTOUCHED.
 *
 * Two layers, both run against the SOURCE engine and the BUILT bundle:
 *
 *   EXECUTED FIXTURES (the shipped detector, cascade-fed):
 *     V0  detector bail contract: defaults undefined → [] (unchanged, on record)
 *     V1  THE BUG CASE: explicit override, NO date-level record → cascade
 *         feed must flag it (Declan wrap 19:45 vs defaultDay 19:00 → WRAP)
 *     V2  lean record, no override → [] (no false positives — Al stays clean)
 *     V3  date-level record WINS over the production default: a record equal
 *         to the date-level value must NOT flag even when it differs from
 *         defaultDay; a record equal to defaultDay but differing from the
 *         date-level value MUST flag (the day's authority is the date record)
 *
 *   STATIC DRIFT PINS:
 *     F1  the cascaded feed line present exactly once        (source only)
 *     F2  the old raw-only feed line is GONE                 (source only)
 *     F3  the memo's dependency array includes production.defaultDay
 *                                                            (source only)
 *     F4  the crew-list name still gates text-fuchsia-400 on hasVariance
 *                                                            (source + built)
 *     F1-F3 run against the SOURCE only: the feed line uses `??` and `?.`,
 *     which esbuild's es2017 target down-levels, so its literal cannot exist
 *     in dist. The built bundle is covered transitively — textual-diff check 1
 *     proves dist is byte-reproducible from this source — and directly by the
 *     executed V-fixtures, which run against BOTH engines.
 *
 * Wiring: audit:build (after la-ordering) · standalone audit:variance.
 * Exit code: 0 all pass, 1 any fail, 2 harness error.
 */

const fs = require('fs');
const path = require('path');
const { loadSourceEngine, loadBuiltEngine } = require('./load-engines');

const ROOT = path.resolve(__dirname, '..', '..');
const SRC_HTML = path.join(ROOT, 'index.html');
const BUILT_JS = path.join(ROOT, 'dist', 'assets', 'app.js');

const results = [];
function check(id, desc, pass, detail) {
  results.push({ id, desc, pass, detail: detail || '' });
  console.log(`      ${pass ? '✓' : '✗'} ${id}  ${desc}${pass || !detail ? '' : `\n           ${detail}`}`);
}

// The cascade feed EXACTLY as the fixed memo builds it (index.html) — the
// fixtures assert the detector's behaviour when fed this shape.
const DPD = { dayType: 'Shoot', callTime: '08:00', wrapTime: '19:00', lunchStartTime: '13:30', lunchDurationMins: 60 };
const cascade = (defaultDay, dateRecord) => ({ ...DPD, ...(defaultDay ?? {}), ...(dateRecord ?? {}) });

const labels = (v) => v.map(x => x.label).join(',');

function runFixtures(engineLabel, getCrewVariances) {
  // V0 — the detector's own bail contract, unchanged and on record: the fix
  // moved to a feed that is never undefined, but the bail must stay intact
  // for direct callers.
  {
    const out = getCrewVariances({ dayRecord: { crewId: 'x', date: '2026-07-30', wrapTime: '19:45' }, defaults: undefined });
    check(`V0/${engineLabel}`, 'bail contract: defaults undefined → []',
      Array.isArray(out) && out.length === 0, `got [${labels(out)}]`);
  }
  // V1 — THE BUG CASE (Derrick's fixture): Declan wrap 19:45 explicit, dept
  // default 19:00 via production.defaultDay, NO dayDefaults[date] record.
  {
    const declan = { crewId: 'declan', date: '2026-07-30', wrapTime: '19:45' };
    const out = getCrewVariances({ dayRecord: declan, defaults: cascade({ callTime: '08:00', wrapTime: '19:00' }, undefined) });
    check(`V1/${engineLabel}`, 'explicit override, no date-level record: cascade feed flags WRAP',
      labels(out) === 'WRAP', `got [${labels(out)}]`);
  }
  // V2 — no false positives: fully lean record (Al) through the same feed.
  {
    const al = { crewId: 'al', date: '2026-07-30' };
    const out = getCrewVariances({ dayRecord: al, defaults: cascade({ callTime: '08:00', wrapTime: '19:00' }, undefined) });
    check(`V2/${engineLabel}`, 'lean record, no override: no false positives',
      out.length === 0, `got [${labels(out)}]`);
  }
  // V3 — the date-level record wins over the production default.
  {
    const feed = cascade({ wrapTime: '19:00' }, { wrapTime: '20:00' });
    const matchesDate = getCrewVariances({ dayRecord: { crewId: 'x', date: '2026-07-30', wrapTime: '20:00' }, defaults: feed });
    const matchesProd = getCrewVariances({ dayRecord: { crewId: 'x', date: '2026-07-30', wrapTime: '19:00' }, defaults: feed });
    check(`V3/${engineLabel}`, 'date-level wins: =date-level → no flag; =defaultDay but ≠date-level → WRAP',
      matchesDate.length === 0 && labels(matchesProd) === 'WRAP',
      `=date-level [${labels(matchesDate)}] · =defaultDay [${labels(matchesProd)}]`);
  }
}

// ---------------------------------------------------------------------------
// Static drift pins. Tolerant token regexes (whitespace-insensitive between
// tokens) so the same pins hold on the source and on esbuild's print of it.
// ---------------------------------------------------------------------------

function flex(literal) {
  return new RegExp(
    literal
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\s+/g, '\\s*'),
    'g');
}

function countMatches(text, re) {
  const m = text.match(re);
  return m ? m.length : 0;
}

function runSourcePins(label, text) {
  const feed = flex('const defaults = { ...DEFAULT_PRODUCTION_DAY, ...(production.defaultDay ?? {}), ...(production.dayDefaults?.[currentDate] ?? {}) }');
  check(`F1/${label}`, 'cascaded feed line present exactly once',
    countMatches(text, feed) === 1, `found ${countMatches(text, feed)}`);

  const rawFeed = flex('const defaults = production.dayDefaults?.[currentDate];');
  check(`F2/${label}`, 'old raw-only feed line gone',
    countMatches(text, rawFeed) === 0, `found ${countMatches(text, rawFeed)}`);

  const deps = flex('[crewWithCalcs, production.defaultDay, production.dayDefaults, currentDate]');
  check(`F3/${label}`, 'memo deps include production.defaultDay',
    countMatches(text, deps) === 1, `found ${countMatches(text, deps)}`);
}

function runRenderGatePin(label, text) {
  // Quote-agnostic: esbuild's printer emits double quotes for the same string.
  check(`F4/${label}`, 'crew-list name still gates text-fuchsia-400 on hasVariance',
    /hasVariance \? ['"]text-fuchsia-400['"]/.test(text),
    'render gate literal missing');
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

async function main() {
  console.log('');
  console.log('============================================================');
  console.log(' BB variance detection (fuchsia highlight) — cascade feed');
  console.log('============================================================');

  console.log('');
  console.log('[1/2] Executed fixtures — source engine, then built bundle');
  const src = await loadSourceEngine();
  const built = loadBuiltEngine();
  if (typeof src.getCrewVariances !== 'function' || typeof built.getCrewVariances !== 'function') {
    console.log('      ✗ getCrewVariances missing from an engine (src=' +
      typeof src.getCrewVariances + ', built=' + typeof built.getCrewVariances + ')');
    process.exit(1);
  }
  runFixtures('src', src.getCrewVariances);
  runFixtures('built', built.getCrewVariances);

  console.log('');
  console.log('[2/2] Static drift pins — F1-F3 source (dist covered transitively), F4 both');
  const srcText = fs.readFileSync(SRC_HTML, 'utf8');
  const builtText = fs.readFileSync(BUILT_JS, 'utf8');
  runSourcePins('src', srcText);
  runRenderGatePin('src', srcText);
  runRenderGatePin('built', builtText);

  const pass = results.every((r) => r.pass);
  console.log('');
  console.log('============================================================');
  console.log(pass
    ? ` ✅ PASS — ${results.length} checks: the crew-list variance feed resolves`
    : ` ❌ FAIL — see details above.`);
  if (pass) {
    console.log('    the cascade and the detector behaves as ruled in both engines.');
  }
  console.log('============================================================');

  fs.writeFileSync(
    path.join(__dirname, 'last-variance-detection.json'),
    JSON.stringify({ when: new Date().toISOString(), results, pass }, null, 2),
  );

  process.exit(pass ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(2); });
