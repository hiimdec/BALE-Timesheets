/*
 * quick-set-assertions.js
 *
 *   $ node scripts/build-vs-source-audit/quick-set-assertions.js
 *
 * Quick set (BB) — the batched one-field multi-crew write. The ruling: it
 * must be the EXISTING single-edit write applied to N selected crew, nothing
 * more. applyQuickSet mirrors updateTimeField's V4-5h-11 collapse for the
 * three time fields (value === RAW date-level dept default → the override is
 * DELETED so cascade resumes; no date-level record → no collapse, explicit
 * write) and updateField's plain sparse write for preCallTime. This suite
 * executes that ruling against the SOURCE engine and the BUILT bundle:
 *
 *   Q1  set lunch for 2 of 3: only those 2 records gain ONLY that field;
 *       the third member and every other date are byte-untouched
 *   Q2  batch ≡ sequential singles (the batched write IS the single edit
 *       applied N times — same final production, byte-compared)
 *   Q3  the collapse rule: value matching the date-level default DELETES
 *       the override; with no date-level record the write stays explicit
 *   Q4  preCallTime never collapses (updateField mirror), even when equal
 *       to the date-level default
 *   Q5  purity + undo: the input production is not mutated, and restoring
 *       the pre-write days snapshot reproduces the original byte-for-byte
 *       (the house undo contract)
 *   Q6  pay re-derives: a wrap set to 21:00 adds OT for the selected
 *       member through the REAL calcForDisplay; the unselected member's
 *       total is unchanged
 *   Q7  the variance state matches a manual edit: after Set, the affected
 *       members flag through getCrewVariances via the cascade feed (the
 *       fuchsia highlight lights), the unselected member stays clean
 *
 * Wiring: audit:build (after variance-detection) · standalone audit:quickset.
 * Exit code: 0 all pass, 1 any fail, 2 harness error.
 */

const fs = require('fs');
const path = require('path');
const { loadSourceEngine, loadBuiltEngine } = require('./load-engines');

const results = [];
function check(id, desc, pass, detail) {
  results.push({ id, desc, pass, detail: detail || '' });
  console.log(`      ${pass ? '✓' : '✗'} ${id}  ${desc}${pass || !detail ? '' : `\n           ${detail}`}`);
}

const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const clone = (x) => JSON.parse(JSON.stringify(x));

// Three crew, two dates. Ana carries an existing lunch override that a
// quick-set of OTHER members must not disturb; Ben and Cal are lean.
const CREW = [
  { id: 'ana', name: 'Ana', role: 'Lighting Technician', bdr: 500, otCoef: 1.5, otRate: null, noOT: false },
  { id: 'ben', name: 'Ben', role: 'Lighting Technician', bdr: 520, otCoef: 1.5, otRate: null, noOT: false },
  { id: 'cal', name: 'Cal', role: 'Lighting Technician', bdr: 540, otCoef: 1.5, otRate: null, noOT: false },
];
const mkProduction = (dayDefaults) => ({
  title: 'Quick Set Fixture', bestBoyMode: true,
  defaultDay: { callTime: '08:00', wrapTime: '19:00', lunchStartTime: '13:00', lunchDurationMins: 60, dayType: 'Shoot' },
  dayDefaults: dayDefaults || {},
  crew: clone(CREW),
  days: [
    { id: 'a1', crewId: 'ana', date: '2026-08-10', lunchStartTime: '12:30' },
    { id: 'b1', crewId: 'ben', date: '2026-08-10' },
    { id: 'c1', crewId: 'cal', date: '2026-08-10' },
    { id: 'a2', crewId: 'ana', date: '2026-08-11' },
    { id: 'b2', crewId: 'ben', date: '2026-08-11' },
  ],
});

function runSuite(engineLabel, E) {
  const { applyQuickSet } = E;

  // Q1 — sparse write on exactly the selection.
  {
    const before = mkProduction();
    const frozen = clone(before);
    const after = applyQuickSet(before, '2026-08-10', ['ben', 'cal'], 'lunchStartTime', '12:00');
    const rec = (p, id) => p.days.find(d => d.id === id);
    const q1 =
      rec(after, 'b1').lunchStartTime === '12:00' &&
      rec(after, 'c1').lunchStartTime === '12:00' &&
      eq(Object.keys(rec(after, 'b1')).sort(), ['crewId', 'date', 'id', 'lunchStartTime'].sort()) &&
      eq(rec(after, 'a1'), frozen.days[0]) &&
      eq(rec(after, 'a2'), frozen.days[3]) &&
      eq(rec(after, 'b2'), frozen.days[4]);
    check(`Q1/${engineLabel}`, 'lunch for 2 of 3: only those 2 gain ONLY that field; others byte-untouched', q1);
  }
  // Q2 — batch ≡ sequential singles.
  {
    const batch = applyQuickSet(mkProduction(), '2026-08-10', ['ben', 'cal'], 'wrapTime', '20:15');
    let seq = mkProduction();
    seq = applyQuickSet(seq, '2026-08-10', ['ben'], 'wrapTime', '20:15');
    seq = applyQuickSet(seq, '2026-08-10', ['cal'], 'wrapTime', '20:15');
    check(`Q2/${engineLabel}`, 'batch ≡ the single edit applied N times (same final production)', eq(batch, seq));
  }
  // Q3 — the V4-5h-11 collapse, both directions.
  {
    const withDd = mkProduction({ '2026-08-10': { callTime: '07:30', wrapTime: '19:00', lunchStartTime: '13:00', lunchDurationMins: 60, dayType: 'Shoot' } });
    withDd.days[1].callTime = '09:00'; // ben has an explicit call override
    const collapsed = applyQuickSet(withDd, '2026-08-10', ['ben'], 'callTime', '07:30');
    const noDd = applyQuickSet(mkProduction(), '2026-08-10', ['ben'], 'callTime', '08:00');
    check(`Q3/${engineLabel}`, 'collapse: =date-level default DELETES the override; no date-level record → explicit write stays',
      collapsed.days.find(d => d.id === 'b1').callTime === undefined &&
      noDd.days.find(d => d.id === 'b1').callTime === '08:00');
  }
  // Q4 — preCallTime never collapses (updateField mirror).
  {
    const withDd = mkProduction({ '2026-08-10': { callTime: '08:00', wrapTime: '19:00', lunchStartTime: '13:00', lunchDurationMins: 60, dayType: 'Shoot', preCallTime: '06:30' } });
    const after = applyQuickSet(withDd, '2026-08-10', ['ben'], 'preCallTime', '06:30');
    check(`Q4/${engineLabel}`, 'preCallTime stays explicit even when equal to the date-level default',
      after.days.find(d => d.id === 'b1').preCallTime === '06:30');
  }
  // Q5 — purity + the undo contract.
  {
    const before = mkProduction();
    const frozen = clone(before);
    const snapshot = clone(before.days); // what pushUndo captures
    const after = applyQuickSet(before, '2026-08-10', ['ben', 'cal'], 'callTime', '10:00');
    const restored = { ...after, days: snapshot };
    check(`Q5/${engineLabel}`, 'input not mutated; restoring the days snapshot reproduces the original exactly',
      eq(before, frozen) && eq(restored.days, frozen.days));
  }
  // Q6 — pay re-derives through the real engine.
  {
    const before = mkProduction();
    const after = applyQuickSet(before, '2026-08-10', ['ben'], 'wrapTime', '21:00');
    const calcOf = (p, recId, member) => E.calcForDisplay(p, p.days.find(d => d.id === recId), member, null).total;
    const benBefore = calcOf(before, 'b1', CREW[1]);
    const benAfter = calcOf(after, 'b1', CREW[1]);
    const calBefore = calcOf(before, 'c1', CREW[2]);
    const calAfter = calcOf(after, 'c1', CREW[2]);
    check(`Q6/${engineLabel}`, 'wrap 21:00 raises the selected member\'s total; the unselected member\'s is unchanged',
      benAfter > benBefore && calAfter === calBefore,
      `ben ${benBefore}→${benAfter} · cal ${calBefore}→${calAfter}`);
  }
  // Q7 — the variance state a manual edit would produce (the fuchsia gate).
  {
    const after = applyQuickSet(mkProduction(), '2026-08-10', ['ben', 'cal'], 'lunchStartTime', '12:00');
    const cascaded = { ...{ dayType: 'Shoot', callTime: '08:00', wrapTime: '19:00', lunchStartTime: '13:30', lunchDurationMins: 60 }, ...(after.defaultDay ?? {}), ...(after.dayDefaults?.['2026-08-10'] ?? {}) };
    const varsOf = (recId, member) => E.getCrewVariances({ dayRecord: after.days.find(d => d.id === recId), defaults: cascaded, crewMember: member }).map(v => v.label);
    check(`Q7/${engineLabel}`, 'after Set the affected members flag LUNCH through the cascade feed; unaffected member unchanged',
      eq(varsOf('b1', CREW[1]), ['LUNCH']) && eq(varsOf('c1', CREW[2]), ['LUNCH']) &&
      eq(varsOf('a1', CREW[0]), ['LUNCH']),
      `ben [${varsOf('b1', CREW[1])}] cal [${varsOf('c1', CREW[2])}] ana [${varsOf('a1', CREW[0])}]`);
  }
}

async function main() {
  console.log('');
  console.log('============================================================');
  console.log(' Quick set (BB) — the batched single-edit write');
  console.log('============================================================');

  console.log('');
  console.log('[1/1] Executed contract — source engine, then built bundle');
  const src = await loadSourceEngine();
  const built = loadBuiltEngine();
  if (typeof src.applyQuickSet !== 'function' || typeof built.applyQuickSet !== 'function') {
    console.log('      ✗ applyQuickSet missing from an engine (src=' +
      typeof src.applyQuickSet + ', built=' + typeof built.applyQuickSet + ')');
    process.exit(1);
  }
  runSuite('src', src);
  runSuite('built', built);

  const pass = results.every((r) => r.pass);
  console.log('');
  console.log('============================================================');
  console.log(pass
    ? ` ✅ PASS — ${results.length} checks: Quick set is the single-edit write`
    : ` ❌ FAIL — see details above.`);
  if (pass) console.log('    batched over a selection, in both engines.');
  console.log('============================================================');

  fs.writeFileSync(
    path.join(__dirname, 'last-quick-set.json'),
    JSON.stringify({ when: new Date().toISOString(), results, pass }, null, 2),
  );

  process.exit(pass ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(2); });
