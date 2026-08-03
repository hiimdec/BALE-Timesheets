/*
 * la-ordering-assertions.js
 *
 *   $ node scripts/build-vs-source-audit/la-ordering-assertions.js
 *
 * The Live Activity drain→sweep ordering contract (the re-mint race fix).
 * The bug: at cold launch and every foreground, ingest() (drain queued card
 * events into the day record) and liveActivityReconcile() (the sweep that
 * re-mints husked cards FROM the day record) fired concurrently; when the
 * sweep won, it re-minted from a record that had not yet absorbed a queued
 * lunch press — a fresh card with a pressable Lunch button on a day already
 * lunched. The fix routes both entry points through laDrainThenSweep, which
 * does not try to win the race but removes it: nothing applied → sweep now
 * (nothing stale possible); events applied → skip the entry sweep and let
 * the post-commit change-sweep run reconcile from a provably-fresh ref.
 *
 * Two layers, both run against the SOURCE engine and the BUILT bundle:
 *
 *   EXECUTED CONTRACT (the race made deterministic — stubbed drain/sweep,
 *   real timers, parameterised bound):
 *     O1  drain resolves 0        → sweep exactly once, AFTER the drain settled
 *     O2  drain resolves 3        → sweep never called (deferred), timer cleaned
 *     O3  drain never resolves    → sweep fires at the bound, resolves -1
 *     O4  drain rejects           → sweep called, resolves 0
 *     O5  drain resolves undefined→ sweep called (the !(applied > 0) fail-safe:
 *         a miswired ingest return degrades to "sweep runs", never to no-sweep)
 *
 *   STATIC DRIFT PINS (source index.html + dist/assets/app.js):
 *     P1  the bare racy adjacency `ingest(); liveActivityReconcile();` is GONE
 *     P2  the wrapper binds laDrainThenSweep(ingest, liveActivityReconcile) once
 *     P3  drainThenSweep(); is called from exactly TWO sites (launch + foreground)
 *     P4  ingest's three numeric return sites are present
 *     P5  the !(applied > 0) fail-safe comparison is present
 *     P6  the sweep.deferred breadcrumb is present
 *
 * Wiring: audit:build (after share-link-assertions) · standalone audit:la.
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

const tick = (ms) => new Promise((res) => setTimeout(res, ms));

// ---------------------------------------------------------------------------
// Executed contract — one full pass per engine.
// ---------------------------------------------------------------------------

async function runExecCases(engineLabel, laDrainThenSweep) {
  // O1 — drain resolves 0 after a real delay: sweep exactly once, after it.
  {
    const log = [];
    const drain = () => new Promise((res) => setTimeout(() => { log.push('drain'); res(0); }, 20));
    const sweep = () => log.push('sweep');
    const out = await laDrainThenSweep(drain, sweep);
    await tick(30); // settle window: prove no second sweep arrives later
    check(`O1/${engineLabel}`, 'drain→0: sweep once, after the drain settled, returns 0',
      out === 0 && log.join(',') === 'drain,sweep',
      `returned ${JSON.stringify(out)}, order [${log.join(',')}]`);
  }
  // O2 — drain resolves 3: sweep never called; the bound timer is cleaned
  // (no late sweep after the resolution).
  {
    let sweeps = 0;
    const drain = () => new Promise((res) => setTimeout(() => res(3), 10));
    const out = await laDrainThenSweep(drain, () => { sweeps++; }, 50);
    await tick(80); // past the 50ms bound: a leaked timer would sweep here
    check(`O2/${engineLabel}`, 'drain→3: sweep NEVER (deferred to change-sweep), returns 3',
      out === 3 && sweeps === 0,
      `returned ${JSON.stringify(out)}, sweeps ${sweeps}`);
  }
  // O3 — drain never resolves: the bound fires the sweep; resolves -1.
  {
    let sweeps = 0;
    const t0 = Date.now();
    const drain = () => new Promise(() => {}); // never settles
    const out = await laDrainThenSweep(drain, () => { sweeps++; }, 50);
    const elapsed = Date.now() - t0;
    check(`O3/${engineLabel}`, 'drain stalls: sweep fires at the bound, returns -1',
      out === -1 && sweeps === 1 && elapsed >= 40 && elapsed < 2000,
      `returned ${JSON.stringify(out)}, sweeps ${sweeps}, elapsed ${elapsed}ms`);
  }
  // O4 — drain rejects: sweep runs (errors mean "sweep now", never "never").
  {
    let sweeps = 0;
    const drain = () => Promise.reject(new Error('bridge error'));
    const out = await laDrainThenSweep(drain, () => { sweeps++; });
    check(`O4/${engineLabel}`, 'drain rejects: sweep called, returns 0',
      out === 0 && sweeps === 1,
      `returned ${JSON.stringify(out)}, sweeps ${sweeps}`);
  }
  // O5 — the fail-safe executed: a miswired drain resolving undefined must
  // land in "sweep runs" (the old race), never in silent no-sweep.
  {
    let sweeps = 0;
    const drain = () => Promise.resolve(undefined);
    await laDrainThenSweep(drain, () => { sweeps++; });
    check(`O5/${engineLabel}`, 'drain→undefined (miswire): fail-safe sweeps',
      sweeps === 1, `sweeps ${sweeps}`);
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

function runStaticPins(label, text) {
  // P1 — the racy adjacency is gone: ingest(); followed (same line or next,
  // with or without a trailing comment) by liveActivityReconcile();
  const adjacency = /ingest\(\);[^\n]*\n?\s*liveActivityReconcile\(\)/g;
  check(`P1/${label}`, 'bare ingest(); liveActivityReconcile(); adjacency: 0 occurrences',
    countMatches(text, adjacency) === 0,
    `found ${countMatches(text, adjacency)}`);

  // P2 — the wrapper binds the helper to the real collaborators exactly once.
  const binding = flex('laDrainThenSweep(ingest, liveActivityReconcile)');
  check(`P2/${label}`, 'laDrainThenSweep(ingest, liveActivityReconcile) bound exactly once',
    countMatches(text, binding) === 1,
    `found ${countMatches(text, binding)}`);

  // P3 — both entry points call the ONE wrapper: exactly two call sites.
  const calls = /drainThenSweep\(\);/g;
  check(`P3/${label}`, 'drainThenSweep(); called from exactly two sites (launch + foreground)',
    countMatches(text, calls) === 2,
    `found ${countMatches(text, calls)}`);

  // P4 — ingest's three numeric return sites.
  const r1 = flex('if (!events || !events.length) return 0;');
  const r2 = flex('if (!toApply.length) return 0;');
  const r3 = flex('return toApply.length;');
  check(`P4/${label}`, "ingest's three numeric return sites present",
    countMatches(text, r1) === 1 && countMatches(text, r2) === 1 && countMatches(text, r3) === 1,
    `empty-drain ${countMatches(text, r1)}, none-applicable ${countMatches(text, r2)}, applied-count ${countMatches(text, r3)}`);

  // P5 — the fail-safe comparison, exactly as ruled.
  const failSafe = flex('if (!(applied > 0)) sweep();');
  check(`P5/${label}`, 'the !(applied > 0) fail-safe comparison present',
    countMatches(text, failSafe) === 1,
    `found ${countMatches(text, failSafe)}`);

  // P6 — the deferral breadcrumb (explicit in Diagnostics, not inferred).
  check(`P6/${label}`, 'sweep.deferred breadcrumb present',
    text.includes("sweep.deferred (drained="),
    'breadcrumb literal missing');
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

async function main() {
  console.log('');
  console.log('============================================================');
  console.log(' Live Activity drain→sweep ordering (re-mint race fix)');
  console.log('============================================================');

  console.log('');
  console.log('[1/2] Executed contract — source engine, then built bundle');
  const src = await loadSourceEngine();
  const built = loadBuiltEngine();
  if (typeof src.laDrainThenSweep !== 'function' || typeof built.laDrainThenSweep !== 'function') {
    console.log('      ✗ laDrainThenSweep missing from an engine (src=' +
      typeof src.laDrainThenSweep + ', built=' + typeof built.laDrainThenSweep + ')');
    process.exit(1);
  }
  await runExecCases('src', src.laDrainThenSweep);
  await runExecCases('built', built.laDrainThenSweep);

  console.log('');
  console.log('[2/2] Static drift pins — source, then built bundle');
  runStaticPins('src', fs.readFileSync(SRC_HTML, 'utf8'));
  runStaticPins('built', fs.readFileSync(BUILT_JS, 'utf8'));

  const pass = results.every((r) => r.pass);
  console.log('');
  console.log('============================================================');
  console.log(pass
    ? ` ✅ PASS — ${results.length} checks: the ordering contract executes as`
    : ` ❌ FAIL — see details above.`);
  if (pass) {
    console.log('    ruled in both engines, and the wiring cannot drift silently.');
  }
  console.log('============================================================');

  fs.writeFileSync(
    path.join(__dirname, 'last-la-ordering.json'),
    JSON.stringify({ when: new Date().toISOString(), results, pass }, null, 2),
  );

  process.exit(pass ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(2); });
