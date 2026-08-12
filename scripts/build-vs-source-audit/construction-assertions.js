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

// ── S1: cross-editor crew equivalence (mirrors, source-pinned) ──────────────
// The three crew editors are React closures, so their write expressions are
// MIRRORED here and each mirror is pinned to the exact source expression it
// reproduces (the OTG3/OTG4 pairing) — an unpinned mirror could drift on its
// own. The contract: the same logical action (pick role R, type rate X)
// through the CrewManager editor, the solo job-settings editor and
// QuickAddCrewSheet yields the same { bdr, otCoef, otRate }. crew.otCoef has
// six hand-maintained writers; the seventh (the rate input) is the one that
// drifted — this equivalence is the standing alarm for the other six until a
// collapse slice runs. (noOT is deliberately OUTSIDE the triple: QuickAdd
// carries it, the other two do not — the tracked Director/Producer phantom-OT
// item in MAINTENANCE.md. Pinning that asymmetry would bless it.)
function runS1(label, eng, srcHtml) {
  const pins = {
    'S1 source: CrewManager onRoleChange expression':
      /setForm\(\(f\) => \(\{ \.\.\.f, role, bdr: d\.bdr \?\? f\.bdr, otCoef: d\.otCoef \?\? autoOtCoef\(d\.bdr \?\? f\.bdr, cardOtGrades\), otRate: d\.otRate \?\? null \}\)\)/.test(srcHtml),
    'S1 source: CrewManager rate input writes the rate only':
      /onChange=\{\(e\) => setForm\(\{ \.\.\.form, bdr: Number\(e\.target\.value\) \}\)\}/.test(srcHtml),
    'S1 source: solo editor role-change expression':
      /crew: p\.crew\.map\(\(c, i\) => i === 0 \? \{ \.\.\.c, role, bdr: d\.bdr \?\? c\.bdr, otCoef: d\.otCoef \?\? c\.otCoef, otRate: d\.otRate \?\? null \} : c\)/.test(srcHtml),
    'S1 source: QuickAddCrewSheet submit shape (card coefficient at submit time, noOT rides)':
      /otCoef: roleDefaults\.otCoef \?\? 1\.5,\s*otRate: roleDefaults\.otRate \?\? null,\s*\.\.\.\(roleDefaults\.noOT \? \{ noOT: true \} : \{\}\),/.test(srcHtml),
  };
  for (const [name, ok] of Object.entries(pins)) {
    check(label, name, ok, 'the mirrored editor expression changed — update the mirror WITH the source');
  }
  if (!Object.values(pins).every(Boolean)) return;

  const card = eng.resolveRateCard('2026-09-15');
  const cardOtGrades = card.otGrades;
  const flat = eng.flattenRateCard(card);
  const autoOtCoef = eng.autoOtCoef;
  const ROLE = 'Lighting Technician';   // 1.5 — a grade the rate-derived path would get WRONG at £475
  const d = flat[ROLE];
  const X = 475;

  // Vacuity guard: at this fixture a regression to rate-derived grading would
  // produce a DIFFERENT coefficient, so triple-equality below is discriminating,
  // not agreeing-at-default.
  check(label, 'S1 vacuity guard: the rate-derived grade at £475 differs from the card grade (1.25 vs 1.5) — the equivalence can actually fail',
    autoOtCoef(X, cardOtGrades) !== d.otCoef, JSON.stringify({ derived: autoOtCoef(X, cardOtGrades), card: d.otCoef }));

  // E1 CrewManager: role select, then the rate edit (writes the rate only).
  let f = { role: 'Best Boy', bdr: 0, otCoef: 1, otRate: null };
  const e1sel = { ...f, role: ROLE, bdr: d.bdr ?? f.bdr, otCoef: d.otCoef ?? autoOtCoef(d.bdr ?? f.bdr, cardOtGrades), otRate: d.otRate ?? null };
  const e1 = { ...e1sel, bdr: Number(String(X)) };
  // E2 solo editor: role select, then setSoloNum("bdr").
  let c = { role: 'Best Boy', bdr: 0, otCoef: 1, otRate: null };
  const e2sel = { ...c, role: ROLE, bdr: d.bdr ?? c.bdr, otCoef: d.otCoef ?? c.otCoef, otRate: d.otRate ?? null };
  const e2 = { ...e2sel, bdr: Number(String(X)) };
  // E3 QuickAddCrewSheet: the typed rate submits with the CURRENT role's card
  // coefficient resolved at submit time.
  const roleDefaults = flat[ROLE] || {};
  const e3 = { role: ROLE, bdr: Number(String(X)) || 0, otCoef: roleDefaults.otCoef ?? 1.5, otRate: roleDefaults.otRate ?? null };

  const triple = (r) => JSON.stringify({ bdr: r.bdr, otCoef: r.otCoef, otRate: r.otRate });
  check(label, 'S1 the same action through all three editors yields the same {bdr, otCoef, otRate} — LT at a typed £475 keeps the card 1.5 everywhere',
    triple(e1) === triple(e2) && triple(e2) === triple(e3) &&
    e1.bdr === 475 && e1.otCoef === 1.5 && e1.otRate === null,
    `${triple(e1)} | ${triple(e2)} | ${triple(e3)}`);
}

// ── S6: step-up picker equivalence (mirrors, source-pinned) ─────────────────
// THREE hand-maintained copies of the same stepUp write (the solo day form,
// the bulk date edit, CrewMemberDayView) — the fourth duplicated-gate
// instance in PACT_BECTU_PLAN.md, where the ruled fix is removing the copies,
// not pinning them into agreement. Until that slice runs, this is the drift
// alarm the plan file's cheapness clause allows: the SELECTED-role writes must
// agree, and the one divergence that exists today (clear-role residue) must
// stay pay-inert through resolveCrewForDay's stepUpRole guard.
function runS6(label, eng, srcHtml) {
  const pins = {
    'S6 source: solo day form step-up write':
      /set\(\{ stepUpRole: role, stepUpBDR: d\.bdr \?\? v\.stepUpBDR, stepUpOTCoef: d\.otCoef \?\? v\.stepUpOTCoef, stepUpOTRate: d\.otRate \?\? null \}\);/.test(srcHtml),
    'S6 source: bulk date-edit step-up write':
      /stepUpRole: role,\s*stepUpBDR: role \? \(d\.bdr \?\? p\.stepUpBDR\) : 0,\s*stepUpOTCoef: role \? \(d\.otCoef \?\? 1\) : 1,\s*stepUpOTRate: role \? \(d\.otRate \?\? null\) : null,/.test(srcHtml),
    'S6 source: CrewMemberDayView step-up write':
      /stepUpRole: role,\s*stepUpBDR: role \? \(d\.bdr \?\? rec\.stepUpBDR\) : 0,\s*stepUpOTCoef: role \? \(d\.otCoef \?\? rec\.stepUpOTCoef\) : 1,\s*stepUpOTRate: role \? \(d\.otRate \?\? null\) : null,/.test(srcHtml),
  };
  for (const [name, ok] of Object.entries(pins)) {
    check(label, name, ok, 'the mirrored picker expression changed — update the mirror WITH the source');
  }
  if (!Object.values(pins).every(Boolean)) return;

  const flat = eng.flattenRateCard(eng.resolveRateCard('2026-09-15'));
  const role = 'Gaffer';
  const d = flat[role];
  const prev = { stepUpBDR: 111, stepUpOTCoef: 1.25 };
  // The three writes with a role SELECTED:
  const w1 = { stepUpRole: role, stepUpBDR: d.bdr ?? prev.stepUpBDR, stepUpOTCoef: d.otCoef ?? prev.stepUpOTCoef, stepUpOTRate: d.otRate ?? null };
  const w2 = { stepUpRole: role, stepUpBDR: role ? (d.bdr ?? prev.stepUpBDR) : 0, stepUpOTCoef: role ? (d.otCoef ?? 1) : 1, stepUpOTRate: role ? (d.otRate ?? null) : null };
  const w3 = { stepUpRole: role, stepUpBDR: role ? (d.bdr ?? prev.stepUpBDR) : 0, stepUpOTCoef: role ? (d.otCoef ?? prev.stepUpOTCoef) : 1, stepUpOTRate: role ? (d.otRate ?? null) : null };
  const quad = (w) => JSON.stringify(w);
  check(label, 'S6 a SELECTED card role writes the identical stepUp quadruple on all three surfaces (Gaffer 585/1.25/null)',
    quad(w1) === quad(w2) && quad(w2) === quad(w3) && w1.stepUpBDR === 585 && w1.stepUpOTCoef === 1.25,
    `${quad(w1)} | ${quad(w2)} | ${quad(w3)}`);

  // The KNOWN divergence: clearing the role leaves different residue (the solo
  // form keeps old BDR/coef and nulls the rate; the other two reset to 0/1).
  // Prove it stays pay-inert: resolveCrewForDay ignores the whole overlay when
  // stepUpRole is empty — both residue shapes resolve to the crew member
  // UNCHANGED (the identical object), so no divergent number can reach money.
  const noRole = '';
  const dEmpty = flat[noRole] || {};
  const r1 = { stepUpRole: noRole, stepUpBDR: dEmpty.bdr ?? prev.stepUpBDR, stepUpOTCoef: dEmpty.otCoef ?? prev.stepUpOTCoef, stepUpOTRate: dEmpty.otRate ?? null };
  const r2 = { stepUpRole: noRole, stepUpBDR: noRole ? (dEmpty.bdr ?? prev.stepUpBDR) : 0, stepUpOTCoef: noRole ? (dEmpty.otCoef ?? 1) : 1, stepUpOTRate: noRole ? (dEmpty.otRate ?? null) : null };
  const crewMember = { role: 'Lighting Technician', bdr: 457, otCoef: 1.5, otRate: null };
  const res1 = eng.resolveCrewForDay({ ...r1 }, crewMember);
  const res2 = eng.resolveCrewForDay({ ...r2 }, crewMember);
  check(label, 'S6 the clear-role residue DIVERGES across surfaces (solo keeps 111/1.25, the others reset 0/1) but is pay-inert: resolveCrewForDay returns the crew member untouched for BOTH shapes (stepUpRole guard)',
    quad(r1) !== quad(r2) && res1 === crewMember && res2 === crewMember,
    JSON.stringify({ r1, r2, inert: res1 === crewMember && res2 === crewMember }));
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
  runS1('src', src, srcHtml);
  runS1('built', built, srcHtml);
  runS6('src', src, srcHtml);
  runS6('built', built, srcHtml);

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
