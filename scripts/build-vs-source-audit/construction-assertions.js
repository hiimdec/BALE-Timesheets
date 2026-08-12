/*
 * construction-assertions.js
 *
 *   $ node scripts/build-vs-source-audit/construction-assertions.js
 *
 * The record-construction contract suite (S4, ruled). Two bugs were invisible
 * to the calc audit for the same structural reason — the engine was correct
 * given its inputs and the suites hand it finished records (defaultMileageRate:
 * a preference the engine never read; the OT coefficient misgrade: written
 * wrong at crew-edit time). This file covers a construction path the storage
 * suite cannot execute: applyRateCardToCrew, the card-boundary crew refresh,
 * which lives inside the App component closure.
 *
 * Mechanism — plain execution since Phase 7: applyRateCardToCrew moved from
 * the App closure to module scope, so the suite runs the real function
 * through the engine loader (both source and built). The extract-and-evaluate
 * era (and its extraction-drift category) is over. The C0 source pins remain
 * as shape guards on the exact expressions, so a rewrite of the rule still
 * fails loudly even though execution is the primary proof.
 *
 * The rule under test (TT20d's safety rule): on a rate-card boundary, rewrite
 * ONLY crew whose bdr + otCoef + otRate exactly match the PREVIOUS card for
 * their role — negotiated, hand-edited and custom-role crew are never
 * touched.
 *
 *   C0  source pins: module-scope declaration (single copy) + the exact
 *       expressions (the two guards, the exact-match triple, the rewrite
 *       line, the identity return)
 *   C1  crew at the previous card's defaults MOVE to the new card
 *   C2  a negotiated rate never moves
 *   C3  a custom otRate breaks the exact match — never moves
 *   C4  a role on neither card never moves
 *   C5  nothing matching → the SAME production object returns (identity —
 *       no phantom "changed" write)
 *   C6  a noOT role (otCoef 0) exact-matches and moves like any other
 *   C7  mixed crew: the default-sitter moves, the negotiated one stays
 *
 * Cards are the engine's own (resolveRateCard/flattenRateCard via
 * load-engines), never fixture copies. Runs against source AND built.
 *
 * Wiring: audit:build (after day-presence) · standalone: node this file.
 * Exit code: 0 all pass, 1 any fail, 2 harness error.
 */

const fs = require('fs');
const path = require('path');
const { loadSourceEngine, loadBuiltEngine } = require('./load-engines');

const ROOT = path.resolve(__dirname, '..', '..');
const SRC_HTML = path.join(ROOT, 'index.html');

const results = [];
function check(engine, id, pass, detail) {
  results.push({ engine, id, pass, detail: pass ? undefined : detail });
  console.log(`  ${pass ? '✓' : '✗'} [${engine}] ${id}${pass ? '' : ' — ' + detail}`);
}

// ── C0 source pins ──────────────────────────────────────────────────────────
// applyRateCardToCrew is MODULE SCOPE since Phase 7, so the fixtures below
// execute the real function through the engine loader — no extraction, no
// mirror, no drift category. C0 survives as plain source pins on the exact
// expressions: a rewrite of the rule's shape fails loudly here even though
// execution is now the primary proof.
function runC0(src) {
  const pins = {
    'module-scope declaration (the App closure copy is gone)':
      /const applyRateCardToCrew = \(production, fromCard, toCard\) => \{/.test(src) &&
      (src.match(/const applyRateCardToCrew = /g) || []).length === 1,
    'guard: custom role (on neither card) returns untouched':
      /if \(!oldD \|\| !newD\) return c;\s+\/\/ custom role — never touched/.test(src),
    'the exact-match triple (bdr + otCoef + otRate, null-normalised)':
      /const matchesOldCard = Number\(c\.bdr\) === Number\(oldD\.bdr\)\s*&& Number\(c\.otCoef\) === Number\(oldD\.otCoef\)\s*&& \(\(c\.otRate \?\? null\) === \(oldD\.otRate \?\? null\)\);/.test(src),
    'guard: negotiated / hand-edited returns untouched':
      /if \(!matchesOldCard\) return c;/.test(src),
    'the rewrite: new card values, otRate null-normalised':
      /return \{ \.\.\.c, bdr: newD\.bdr, otCoef: newD\.otCoef, otRate: newD\.otRate \?\? null \};/.test(src),
    'identity return when nothing changed':
      /return changed \? \{ \.\.\.production, crew \} : production;/.test(src),
  };
  for (const [name, ok] of Object.entries(pins)) {
    check('src', `C0 ${name}`, ok, 'source expression no longer matches the pinned rule shape');
  }
  return Object.values(pins).every(Boolean);
}

// ── The fixture suite (per engine) ──────────────────────────────────────────
function runSuite(label, eng) {
  const apply = eng.applyRateCardToCrew;
  const from = eng.resolveRateCard('2025-09-15');   // Sept 2025
  const to = eng.resolveRateCard('2026-09-15');     // Sept 2026
  const fromFlat = eng.flattenRateCard(from);
  const toFlat = eng.flattenRateCard(to);

  // C1: sitting on the previous card's defaults → moves.
  const lt25 = { id: 'a', role: 'Lighting Technician', bdr: fromFlat['Lighting Technician'].bdr, otCoef: fromFlat['Lighting Technician'].otCoef, otRate: null };
  const p1 = apply({ crew: [lt25] }, from, to);
  check(label, 'C1 default-sitter moves: LT 444/1.5 (2025) → 457/1.5 (2026), otRate null',
    p1.crew[0].bdr === toFlat['Lighting Technician'].bdr && p1.crew[0].bdr === 457 &&
    p1.crew[0].otCoef === 1.5 && p1.crew[0].otRate === null,
    JSON.stringify(p1.crew[0]));

  // C2: negotiated bdr → never moves (same object reference).
  const neg = { id: 'b', role: 'Lighting Technician', bdr: 470, otCoef: 1.5, otRate: null };
  const p2 = apply({ crew: [neg] }, from, to);
  check(label, 'C2 negotiated rate never moves (470/1.5 untouched, same object)',
    p2.crew[0] === neg && p2.crew[0].bdr === 470,
    JSON.stringify(p2.crew[0]));

  // C3: card-default bdr+coef but a custom otRate → exact match breaks → stays.
  const customOt = { id: 'c', role: 'Lighting Technician', bdr: 444, otCoef: 1.5, otRate: 70 };
  const p3 = apply({ crew: [customOt] }, from, to);
  check(label, 'C3 a custom otRate breaks the exact match — 444/1.5/£70 stays on £70 and 444',
    p3.crew[0] === customOt && p3.crew[0].otRate === 70 && p3.crew[0].bdr === 444,
    JSON.stringify(p3.crew[0]));

  // C4: a role on neither card → untouched.
  const custom = { id: 'd', role: 'Roving Fixer', bdr: 400, otCoef: 1.5, otRate: null };
  const p4 = apply({ crew: [custom] }, from, to);
  check(label, 'C4 a custom role (on neither card) never moves',
    p4.crew[0] === custom && p4.crew[0].bdr === 400,
    JSON.stringify(p4.crew[0]));

  // C5: nothing matches → the SAME production object (identity return).
  const pIn = { crew: [neg, custom] };
  const p5 = apply(pIn, from, to);
  check(label, 'C5 nothing matching returns the identical production object (no phantom change)',
    p5 === pIn, 'returned a new object for a no-op');

  // C6: a noOT role (otCoef 0) exact-matches and moves: Director 933 → 961.
  const dir = { id: 'e', role: 'Director', bdr: fromFlat['Director'].bdr, otCoef: 0, otRate: null, noOT: true };
  const p6 = apply({ crew: [dir] }, from, to);
  check(label, 'C6 a noOT role exact-matches on otCoef 0 and moves (Director 933 → 961), noOT flag survives the rewrite',
    p6.crew[0].bdr === 961 && p6.crew[0].otCoef === 0 && p6.crew[0].noOT === true,
    JSON.stringify(p6.crew[0]));

  // C7: mixed crew — the default-sitter moves, the negotiated one stays.
  const sitter = { id: 'f', role: 'Gaffer', bdr: fromFlat['Gaffer'].bdr, otCoef: fromFlat['Gaffer'].otCoef, otRate: null };
  const p7 = apply({ crew: [sitter, neg] }, from, to);
  check(label, 'C7 mixed crew: the Gaffer default-sitter moves (568 → 585) while the negotiated LT stays 470 (same object)',
    p7.crew[0].bdr === 585 && p7.crew[1] === neg,
    JSON.stringify(p7.crew.map(c => c.bdr)));
}

async function main() {
  const srcHtml = fs.readFileSync(SRC_HTML, 'utf8');
  const c0ok = runC0(srcHtml);
  if (!c0ok) {
    // The pins name exactly which expression drifted; the execution below
    // would still run, but a shape change deserves review before green.
    console.log('  ✗ C0 failed — fixtures skipped until the rule shape is re-reviewed');
    process.exit(1);
  }

  const src = await loadSourceEngine();
  const built = loadBuiltEngine();
  if (typeof src.applyRateCardToCrew !== 'function' || typeof built.applyRateCardToCrew !== 'function') {
    console.log('      ✗ applyRateCardToCrew missing from an engine (src=' +
      typeof src.applyRateCardToCrew + ', built=' + typeof built.applyRateCardToCrew + ')');
    process.exit(1);
  }
  runSuite('src', src);
  runSuite('built', built);

  const pass = results.every((r) => r.pass);
  console.log('');
  console.log('============================================================');
  console.log(pass
    ? ` ✅ PASS — ${results.length} checks: the card-refresh rule holds`
    : ` ❌ FAIL — see details above.`);
  if (pass) console.log('    (exact-match crew move, everything negotiated stays), both engines.');
  console.log('============================================================');

  fs.writeFileSync(
    path.join(__dirname, 'last-construction.json'),
    JSON.stringify({ when: new Date().toISOString(), results, pass }, null, 2),
  );

  process.exit(pass ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(2); });
