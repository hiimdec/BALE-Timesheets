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
// collapse slice runs. Since Phase 8 Part 1 noOT is INSIDE the contract: all
// three editors carry it now (set for Director/Producer, deleted when the role
// is re-picked away), so the equivalence covers the whole money quadruple.
function runS1(label, eng, srcHtml) {
  // Phase 8 collapse: the OT profile is ONE helper, so asserting that the
  // three editors agree about it would be definitional. What CAN still fail
  // is a call site that stops routing through the helper — these pins name
  // exactly which surface dropped it — plus the count, so a fifth hand-rolled
  // copy appearing elsewhere goes RED too.
  const callSites = (srcHtml.match(/applyRoleOtProfile\(/g) || []).length;
  const pins = {
    'S1 call site: CrewManager onRoleChange routes the OT profile through the helper (rate from the card, graded card-less fallback)':
      /setForm\(\(f\) => applyRoleOtProfile\(\{ \.\.\.f, role, bdr: d\.bdr \?\? f\.bdr \}, d, autoOtCoef\(d\.bdr \?\? f\.bdr, cardOtGrades\)\)\)/.test(srcHtml),
    'S1 call site: CrewManager rate input still writes the rate ONLY (the Phase 6 crux, untouched by the collapse)':
      /onChange=\{\(e\) => setForm\(\{ \.\.\.form, bdr: Number\(e\.target\.value\) \}\)\}/.test(srcHtml),
    'S1 call site: solo job-settings editor routes through the helper (keep-existing card-less fallback)':
      /crew: p\.crew\.map\(\(c, i\) => i === 0 \? applyRoleOtProfile\(\{ \.\.\.c, role, bdr: d\.bdr \?\? c\.bdr \}, d, c\.otCoef\) : c\)/.test(srcHtml),
    'S1 call site: AddCrewPage submit routes through the helper with the TYPED rate':
      /onSubmit\(applyRoleOtProfile\(\{\s*name: name\.trim\(\),\s*role,\s*bdr: Number\(bdr\) \|\| 0,\s*email: '',\s*\}, roleDefaults, 1\.5\)\)/.test(srcHtml),
    'S1 call site: QuickAddCrewSheet edit branch re-derives ONLY on a real role change, through the helper':
      /onSubmit\(role !== crewMember\.role \? applyRoleOtProfile\(updated, roleDefaults, 1\.5\) : updated\)/.test(srcHtml),
    'S1 call site: QuickAddCrewSheet add branch routes through the helper':
      /onSubmit\(applyRoleOtProfile\(\{\s*name: name\.trim\(\),\s*role,\s*bdr: Number\(bdr\) \|\| 0,\s*email: email\.trim\(\),\s*\}, roleDefaults, 1\.5\)\)/.test(srcHtml),
    'S1 exactly FIVE call sites + the definition — a sixth hand-rolled copy of the OT profile write goes RED here':
      callSites === 6,
    'S1 the hand-rolled patterns are GONE from every editor (no surviving inline otCoef/noOT copy)':
      !/otCoef: roleDefaults\.otCoef \?\? 1\.5,\s*otRate: roleDefaults\.otRate \?\? null,\s*\.\.\.\(roleDefaults\.noOT/.test(srcHtml) &&
      !/if \(roleDefaults\.noOT\) updated\.noOT = true; else delete updated\.noOT;/.test(srcHtml) &&
      (srcHtml.match(/if \(d\.noOT\) next\.noOT = true; else delete next\.noOT;/g) || []).length === 1,
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

  // ── The OT profile itself: EXECUTED, not mirrored (Phase 8 collapse) ──
  // The rule is one function now, so run it. The calc reads
  // `crew.noOT ? 0 : (Number(crew.otCoef) || 1)`, so the card's stored 0 alone
  // bills 1.0 — NOOT1-4 in calc-boundary put £192.20 on that.
  const applyProfile = eng.applyRoleOtProfile;
  const DIR = 'Director';
  const dd = flat[DIR];
  const g = flat['Gaffer'];
  const quad = (r) => JSON.stringify({ bdr: r.bdr, otCoef: r.otCoef, otRate: r.otRate, noOT: r.noOT });
  const start = { role: 'Best Boy', bdr: 0, otCoef: 1, otRate: null };
  const asDir = applyProfile({ ...start, role: DIR, bdr: dd.bdr }, dd, 1.5);
  check(label, 'S1-profile the helper carries noOT:true AND the card coefficient 0 for Director (the over-claim two editors used to ship)',
    asDir.noOT === true && asDir.otCoef === 0 && asDir.otRate === null, quad(asDir));
  const awayFromDir = applyProfile({ ...asDir, role: 'Gaffer', bdr: g.bdr }, g, 1.5);
  check(label, 'S1-profile re-picking AWAY from Director DELETES the flag (a stale true would zero the OT the new role IS owed) — Gaffer 1.25, no noOT key at all',
    !('noOT' in awayFromDir) && awayFromDir.otCoef === 1.25, quad(awayFromDir));
  check(label, 'S1-profile the fallback is used ONLY when the card row lacks a coefficient, and it is per-surface (the same card-less role takes 1.5 here and the graded answer there)',
    applyProfile({ role: 'X' }, {}, 1.5).otCoef === 1.5 &&
    applyProfile({ role: 'X' }, {}, autoOtCoef(475, cardOtGrades)).otCoef === autoOtCoef(475, cardOtGrades) &&
    applyProfile({ role: 'X' }, g, 1.5).otCoef === g.otCoef,
    JSON.stringify({ flat15: applyProfile({ role: 'X' }, {}, 1.5).otCoef, graded: applyProfile({ role: 'X' }, {}, autoOtCoef(475, cardOtGrades)).otCoef }));

  // End-to-end: the helper is WIRED, not merely present. Each editor's own bdr
  // step feeds the shared profile, so the full record still has to agree.
  const w1 = applyProfile({ ...start, role: DIR, bdr: dd.bdr ?? start.bdr }, dd, autoOtCoef(dd.bdr, cardOtGrades)); // CrewManager
  const w2 = applyProfile({ ...start, role: DIR, bdr: dd.bdr ?? start.bdr }, dd, start.otCoef);                     // solo
  const w3 = applyProfile({ role: DIR, bdr: Number(dd.bdr) || 0, email: '' }, dd, 1.5);                             // the add sheets
  check(label, 'S1-noOT selecting Director through all three editors still yields the same money quadruple end to end (differing card-less fallbacks cannot diverge on a role the card DOES cover)',
    quad(w1) === quad(w2) && quad(w2) === quad(w3) && w1.noOT === true && w1.otCoef === 0,
    `${quad(w1)} | ${quad(w2)} | ${quad(w3)}`);
}

// ── S6: the step-up write (ONE helper since Phase 8) ───────────────────────
// Three hand-maintained copies collapsed into stepUpPatch — the fourth
// duplicated-gate instance in PACT_BECTU_PLAN.md, closed by DELETING the
// copies rather than pinning them into agreement. So "the three surfaces
// agree" is now definitional and gone. What can still fail: a call site that
// stops routing through the helper, the call-site count, and the helper's own
// behaviour. The pay-inertness proof SURVIVES unchanged, because it is about
// the engine's stepUpRole guard, not about the copies.
function runS6(label, eng, srcHtml) {
  const callSites = (srcHtml.match(/stepUpPatch\(/g) || []).length;
  const pins = {
    'S6 call site: solo day form role select routes through the helper':
      /set\(stepUpPatch\(v, role, d, v\.stepUpOTCoef\)\)/.test(srcHtml),
    'S6 call site: solo day form CLEAR button routes through the helper (canonical reset)':
      /set\(stepUpPatch\(v, '', null, 1\)\)/.test(srcHtml),
    'S6 call site: bulk date edit routes through the helper':
      /setDateEdit\(p => \(\{ \.\.\.p, \.\.\.stepUpPatch\(p, role, d, 1\) \}\)\)/.test(srcHtml),
    'S6 call site: CrewMemberDayView role select routes through the helper':
      /\{ \.\.\.rec, \.\.\.stepUpPatch\(rec, role, d, rec\.stepUpOTCoef\) \}/.test(srcHtml),
    'S6 call site: CrewMemberDayView CLEAR button routes through the helper (canonical reset)':
      /\{ \.\.\.d, \.\.\.stepUpPatch\(d, '', null, 1\) \}/.test(srcHtml),
    'S6 exactly FIVE call sites + the definition — a sixth hand-rolled stepUp write goes RED here':
      callSites === 6,
    // The quadruple must exist EXACTLY ONCE — in the helper's own body. Zero
    // would be wrong (the helper would be gone); two means a caller kept a
    // hand-rolled copy. The clear-button literal must be gone outright.
    'S6 the stepUp quadruple is written in exactly ONE place (the helper body) and the hand-rolled clear literal is gone':
      (srcHtml.match(/stepUpBDR: role \? \(d\.bdr \?\? prev\.stepUpBDR\) : 0/g) || []).length === 1 &&
      (srcHtml.match(/stepUpBDR: role \? \(d\.bdr/g) || []).length === 1 &&
      !/stepUpRole: '', stepUpBDR: 0, stepUpOTCoef: 1, stepUpOTRate: null/.test(srcHtml),
  };
  for (const [name, ok] of Object.entries(pins)) {
    check(label, name, ok, 'a step-up call site stopped routing through the shared helper');
  }
  if (!Object.values(pins).every(Boolean)) return;

  // The rule itself, EXECUTED.
  const patch = eng.stepUpPatch;
  const flat = eng.flattenRateCard(eng.resolveRateCard('2026-09-15'));
  const d = flat['Gaffer'];
  const prev = { stepUpRole: 'DoP', stepUpBDR: 111, stepUpOTCoef: 1.25, stepUpOTRate: 9 };
  const quad = (w) => JSON.stringify(w);
  const selected = patch(prev, 'Gaffer', d, prev.stepUpOTCoef);
  check(label, 'S6 a SELECTED card role snapshots the card row onto the day (Gaffer 585 / 1.25 / null), replacing whatever the day carried',
    selected.stepUpRole === 'Gaffer' && selected.stepUpBDR === 585 && selected.stepUpOTCoef === 1.25 && selected.stepUpOTRate === null,
    quad(selected));
  const cleared = patch(prev, '', null, 1);
  check(label, 'S6 CLEARING the role resets the residue to 0 / 1 / null — canonical since Phase 8 (the solo form used to keep the prior numbers); no stale figures survive on the record',
    cleared.stepUpRole === '' && cleared.stepUpBDR === 0 && cleared.stepUpOTCoef === 1 && cleared.stepUpOTRate === null,
    quad(cleared));
  check(label, 'S6 the fallback applies only when the card row lacks a coefficient, and stays per-surface',
    patch(prev, 'X', {}, 1).stepUpOTCoef === 1 && patch(prev, 'X', {}, prev.stepUpOTCoef).stepUpOTCoef === 1.25 &&
    patch(prev, 'X', {}, 1).stepUpBDR === prev.stepUpBDR,
    JSON.stringify({ flat1: patch(prev, 'X', {}, 1), keep: patch(prev, 'X', {}, prev.stepUpOTCoef) }));

  // The pay-inertness proof survives the collapse unchanged: it is about the
  // ENGINE's guard, not about the copies. resolveCrewForDay ignores the whole
  // overlay unless stepUpRole is set — so the canonical residue (and any
  // legacy keep-prior residue still stored on old day records) is inert.
  const crewMember = { role: 'Lighting Technician', bdr: 457, otCoef: 1.5, otRate: null };
  const legacyResidue = { stepUpRole: '', stepUpBDR: 111, stepUpOTCoef: 1.25, stepUpOTRate: 9 };
  const resCanonical = eng.resolveCrewForDay({ ...cleared }, crewMember);
  const resLegacy = eng.resolveCrewForDay({ ...legacyResidue }, crewMember);
  check(label, 'S6 the residue is pay-inert BOTH ways: resolveCrewForDay returns the crew member untouched for the canonical reset AND for a legacy keep-prior record (stepUpRole guard) — which is why the canonicalisation cannot move money, and why old records keeping the legacy residue is safe',
    resCanonical === crewMember && resLegacy === crewMember,
    JSON.stringify({ canonical: resCanonical === crewMember, legacy: resLegacy === crewMember }));
  const applied = eng.resolveCrewForDay({ ...selected }, crewMember);
  check(label, 'S6 vacuity guard: with a role SET the overlay does reach the crew record (585 / 1.25), so the inertness assertions above are not passing because the guard never fires',
    applied !== crewMember && applied.bdr === 585 && applied.otCoef === 1.25,
    JSON.stringify(applied));
}

// ── TR3 / TR4: the APA trainee grade is a LITERAL, not derived ───────────────
//
// Ruling (founder, 2026-08-27): the trainee OT grade is Grade I (coef 1.5) as
// a property of the ROLE. It is NOT derived from the rate and must not move
// when a rate card version changes the grade boundaries.
//
// £250 is a VACUOUS fixture for the VALUE. autoOtCoef(250) returns 1.5 on the
// Sept 2026 card (otGrades Grade I ceiling £458, and the comparison is `n <=`
// so £458 itself is Grade I) AND on the Sept 2025 card (no otGrades, legacy
// 445/677 thresholds). So "the trainee's coefficient is 1.5" passes identically
// whether the grade is a stored literal or derived from the rate, and would
// keep passing if the literal were deleted tomorrow — the exact false-green
// shape HANDOVER records ("ask which input would distinguish correct from
// broken, and if the default cannot, the default is the one case not worth
// checking").
//
// These pins therefore hold the MECHANISM, not the value: applyRoleOtProfile is
// handed a fallbackCoef of 1.0, which the derived path could never produce at
// £250, so a row that lost its otCoef reads 1.0 and the pin reddens.
//
// Precedent: the S1 vacuity guard above, which picks Lighting Technician at
// £475 precisely because derived and card grades disagree there. Same
// discipline, different technique — S1 could move the fixture off the default;
// here the ruled rate IS £250, so the contrast has to come from the fallback.
const TRAINEE_ROLES = [
  'Script Supervisor Trainee', 'Locations Trainee', 'Camera Trainee', 'Grip Trainee',
  'SFX Trainee', 'Art Dept Trainee', 'Construction Trainee', 'Sound Trainee',
  'Costume Trainee', 'Hair & Makeup Trainee', 'Other Trainee',
];

function runTR(label, eng) {
  const applyProfile = eng.applyRoleOtProfile;
  const autoOtCoef = eng.autoOtCoef;
  const card25 = eng.resolveRateCard('2026-08-31');   // Sept 2025 card
  const card26 = eng.resolveRateCard('2026-09-15');   // Sept 2026 card
  const f25 = eng.flattenRateCard(card25);
  const f26 = eng.flattenRateCard(card26);

  // The vacuity is ASSERTED, not merely claimed in the comment above — so if a
  // future card ever moves Grade I below £250, this line goes red and whoever
  // reads it learns that TR3's fallback contrast is no longer the only thing
  // holding the mechanism.
  check(label, 'TR3 vacuity declaration: autoOtCoef(250) === 1.5 on BOTH cards, so the VALUE cannot discriminate literal from derived — TR3/TR4 hold the MECHANISM instead, via a fallbackCoef the derived path could never produce (cf. the S1 vacuity guard at £475)',
    autoOtCoef(250, card26.otGrades) === 1.5 && autoOtCoef(250, card25.otGrades) === 1.5,
    JSON.stringify({ on2026: autoOtCoef(250, card26.otGrades), on2025: autoOtCoef(250, card25.otGrades) }));

  // TR3 — the literal is what gets read. fallbackCoef 1.0 is unreachable for a
  // row that carries its own otCoef; strip that otCoef and every row reads 1.0.
  const FALLBACK = 1.0;
  check(label, 'TR3 the trainee grade is read LITERALLY from the card row: all eleven roles resolve to otCoef 1.5 through applyRoleOtProfile even when handed a contrasting fallbackCoef of 1.0 — delete a row\'s otCoef and it reads 1.0 instead',
    TRAINEE_ROLES.every(r => {
      const row = f26[r];
      return !!row && applyProfile({ role: r }, row, FALLBACK).otCoef === 1.5 && applyProfile({ role: r }, row, FALLBACK).otRate === null;
    }),
    JSON.stringify(TRAINEE_ROLES.map(r => [r, f26[r] ? applyProfile({ role: r }, f26[r], FALLBACK).otCoef : 'NO ROW'])));

  // TR4a — the same literal on both cards. This is what "must not move when a
  // card version changes the grade boundaries" means at rest: the 2026 card
  // introduced otGrades and the trainee's coefficient did not notice.
  check(label, 'TR4a card-version invariance at rest: every trainee resolves to 250 / 1.5 on the Sept 2025 card AND the Sept 2026 card — the 2026 card is the one that introduced otGrades, and the grade did not follow it',
    TRAINEE_ROLES.every(r => f25[r] && f26[r] &&
      f25[r].bdr === 250 && f25[r].otCoef === 1.5 && f26[r].bdr === 250 && f26[r].otCoef === 1.5),
    JSON.stringify(TRAINEE_ROLES.map(r => [r, f25[r], f26[r]])));

  // TR4b — and in motion. A trainee sitting on the 2025 defaults crosses the
  // card boundary through the real refresh rule; rate and grade both unmoved.
  const crew = TRAINEE_ROLES.map((r, i) => ({ id: 'tr' + i, role: r, bdr: f25[r].bdr, otCoef: f25[r].otCoef, otRate: null }));
  const after = eng.applyRateCardToCrew({ crew }, card25, card26);
  check(label, 'TR4b card-version invariance in motion: all eleven trainees cross the Sept 2025 → Sept 2026 boundary through applyRateCardToCrew with rate AND grade unmoved (250 / 1.5 / null), while every other role on the card is uplifted around them',
    after.crew.length === TRAINEE_ROLES.length &&
    after.crew.every(c => c.bdr === 250 && c.otCoef === 1.5 && c.otRate === null),
    JSON.stringify(after.crew.map(c => [c.role, c.bdr, c.otCoef])));

  // Vacuity guard for TR4b: the refresh rule must actually be capable of moving
  // a role across this boundary, or "unmoved" means "the function did nothing".
  const lt = { id: 'lt', role: 'Lighting Technician', bdr: f25['Lighting Technician'].bdr, otCoef: 1.5, otRate: null };
  const ltAfter = eng.applyRateCardToCrew({ crew: [lt] }, card25, card26);
  check(label, 'TR4b vacuity guard: the SAME refresh call does move a default-sitting Lighting Technician 444 → 457, so the trainees staying at 250 is the rule holding, not the refresh no-opping',
    ltAfter.crew[0].bdr === 457 && lt.bdr === 444,
    JSON.stringify({ before: lt.bdr, after: ltAfter.crew[0].bdr }));
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
  runTR('src', src);
  runTR('built', built);

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
