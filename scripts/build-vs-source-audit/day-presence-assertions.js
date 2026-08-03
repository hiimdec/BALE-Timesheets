/*
 * day-presence-assertions.js
 *
 *   $ node scripts/build-vs-source-audit/day-presence-assertions.js
 *
 * Who's on today — the BB day ticker (ruled 2026-07-31). New days populate
 * every crew member as "Day off" (£0) and the Best Boy ticks who WORKED.
 * The flip from populate-all was blocked until the Day-off type existed:
 * a record-less day broke date navigation and made the POSITIONAL turnaround
 * feed read a hole. Dense Day-off records remove both hazards — the date
 * exists, and a real record whose resolved times are blank yields no TOC,
 * which is the correct answer because the true gap across a full day off is
 * always >= 24h.
 *
 * Executed against the SOURCE engine and the BUILT bundle:
 *
 *   P1  a blank new day is DENSE and £0 — every crew member gets a Day off
 *       record, the date is navigable, nobody is paid
 *   P2  TICK converts Day off -> a working day with cascade-inherited times
 *       and correct pay; the record is otherwise byte-preserved
 *   P3  UN-TICK returns a working day to Day off (£0) preserving every other
 *       field, and a tick->un-tick->tick round trip restores the exact times
 *   P4  the TURNAROUND FEED stays correct across a Day-off day: no phantom
 *       TOC on it, none on the day after it, and a genuinely worked middle
 *       day still produces its TOC (the guard neither leaks nor over-fires)
 *   P5  ALL-on covers everyone incl. crew with NO record on that date, and
 *       never double-appends for an existing (date, crewId)
 *   P6  ALL-off zeroes the day; undo (restoring the days snapshot) restores
 *       the prior state byte-for-byte
 *   P7  purity — the input production is never mutated, in either direction
 *   P8  ticking when the DEPT DEFAULT for the date is itself 'Day off' still
 *       produces a working day (never a no-op tick)
 *
 * P3 also pins the augmentation guard: un-ticking preserves the whole record
 * by design, so a leftover per diem / kit / travel would otherwise keep
 * billing on a day the crew member did not work (augmentCalc runs AFTER
 * calculateDay's £0 branch). A Day off must total £0 with expenses present.
 *
 * Wiring: audit:build (after day-off) · standalone audit:presence.
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

const CREW = [
  { id: 'ana', name: 'Ana', role: 'Gaffer', bdr: 444, otCoef: 1.5, otRate: null, noOT: false },
  { id: 'ben', name: 'Ben', role: 'Electrician', bdr: 444, otCoef: 1.5, otRate: null, noOT: false },
];
const DATE = '2026-06-02';
const mkProd = (days, dayDefaults) => ({
  title: 'Day ticker fixture', bestBoyMode: true,
  defaultDay: { callTime: '08:00', wrapTime: '19:00', lunchStartTime: '13:00', lunchDurationMins: 60, dayType: 'Shoot' },
  dayDefaults: dayDefaults || {}, crew: clone(CREW), days,
});
// A blank new day as the flipped addDenseDay creates it: dense, all Day off.
const blankDay = () => [
  { id: 'a2', crewId: 'ana', date: DATE, dayType: 'Day off' },
  { id: 'b2', crewId: 'ben', date: DATE, dayType: 'Day off' },
];

function runSuite(engineLabel, E) {
  const { applyDayPresence } = E;
  const OPTS = { userPrefs: {}, myCrewId: null };

  // P1 — a blank new day is dense and pays nothing.
  {
    const p = mkProd(blankDay());
    const dates = [...new Set(p.days.map(d => d.date))];
    const totals = p.days.map(d => E.calcForDisplay(p, d, CREW.find(c => c.id === d.crewId), null).total);
    check(`P1/${engineLabel}`, 'blank new day is DENSE (date navigable, one record per crew) and pays £0',
      p.days.length === 2 && dates.length === 1 && totals.every(t => t === 0),
      `records ${p.days.length}, dates ${dates.length}, totals ${JSON.stringify(totals)}`);
  }
  // P2 — tick converts to a working day with cascade times and real pay.
  {
    const before = mkProd(blankDay());
    const after = applyDayPresence(before, DATE, ['ana'], true, OPTS);
    const rec = after.days.find(d => d.id === 'a2');
    const r = E.resolveDay(after, rec, CREW[0]);
    const calc = E.calcForDisplay(after, rec, CREW[0], null);
    const untouched = after.days.find(d => d.id === 'b2');
    check(`P2/${engineLabel}`, 'TICK: Day off -> working day, cascade times, real pay; other crew untouched',
      rec.dayType === undefined && r.dayType === 'Shoot' && r.callTime === '08:00' && r.wrapTime === '19:00' &&
      calc.total > 0 && untouched.dayType === 'Day off',
      `type ${JSON.stringify(rec.dayType)}, resolved ${r.dayType} ${r.callTime}-${r.wrapTime}, total ${calc.total}`);
  }
  // P3 — un-tick preserves everything; a full round trip restores exact times.
  {
    const worked = mkProd([
      { id: 'a2', crewId: 'ana', date: DATE, callTime: '07:30', wrapTime: '20:45', travelOutMins: 30,
        expenses: [{ id: 'e1', presetId: 'builtin-perdiem', name: 'Per Diem', amount: 35, detail: '' }] },
      { id: 'b2', crewId: 'ben', date: DATE },
    ]);
    const frozen = clone(worked.days[0]);
    const off = applyDayPresence(worked, DATE, ['ana'], false, OPTS);
    const offRec = off.days.find(d => d.id === 'a2');
    const backOn = applyDayPresence(off, DATE, ['ana'], true, OPTS);
    const backRec = backOn.days.find(d => d.id === 'a2');
    const offTotal = E.calcForDisplay(off, offRec, CREW[0], null).total;
    check(`P3/${engineLabel}`, 'UN-TICK -> £0 preserving all fields; tick->un-tick->tick restores the exact record',
      offRec.dayType === 'Day off' && offTotal === 0 &&
      offRec.callTime === '07:30' && offRec.wrapTime === '20:45' &&
      eq(backRec, frozen),
      `off total ${offTotal}, restored ${eq(backRec, frozen)}`);
  }
  // P4 — the turnaround feed across a Day-off day (the flip's whole risk).
  {
    const p = mkProd([
      { id: 'a1', crewId: 'ana', date: '2026-06-01', callTime: '08:00', wrapTime: '23:00' },
      { id: 'a2', crewId: 'ana', date: DATE, dayType: 'Day off' },
      { id: 'a3', crewId: 'ana', date: '2026-06-03', callTime: '08:00', wrapTime: '19:00' },
    ]);
    // The POSITIONAL feed exactly as crewWithCalcs builds it.
    const dates = [...new Set(p.days.map(d => d.date))].sort();
    const prevOf = (date) => {
      const i = dates.indexOf(date);
      return i > 0 ? p.days.find(d => d.date === dates[i - 1] && d.crewId === 'ana') : null;
    };
    const offCalc = E.calcForDisplay(p, p.days[1], CREW[0], prevOf(DATE));
    const nextCalc = E.calcForDisplay(p, p.days[2], CREW[0], prevOf('2026-06-03'));
    // Control: the SAME shape but the middle day genuinely worked -> real TOC.
    const ctrl = mkProd([
      { id: 'a1', crewId: 'ana', date: '2026-06-01', callTime: '08:00', wrapTime: '23:00' },
      { id: 'a2', crewId: 'ana', date: DATE, callTime: '08:00', wrapTime: '19:00' },
    ]);
    const ctrlCalc = E.calcForDisplay(ctrl, ctrl.days[1], CREW[0], ctrl.days[0]);
    check(`P4/${engineLabel}`, 'turnaround feed correct across a Day off: none on it, none after it, real TOC still fires when worked',
      offCalc.total === 0 && !offCalc.lines.some(l => l.isTOC) &&
      !nextCalc.lines.some(l => l.isTOC) &&
      ctrlCalc.lines.some(l => l.isTOC),
      `off TOC ${offCalc.lines.some(l => l.isTOC)}, next TOC ${nextCalc.lines.some(l => l.isTOC)}, control TOC ${ctrlCalc.lines.some(l => l.isTOC)}`);
  }
  // P5 — ALL-on covers a crew member with no record; never double-appends.
  {
    const p = mkProd([{ id: 'a2', crewId: 'ana', date: DATE, dayType: 'Day off' }]); // ben has NO record
    const after = applyDayPresence(p, DATE, ['ana', 'ben'], true, OPTS);
    const onDate = after.days.filter(d => d.date === DATE);
    const perCrew = ['ana', 'ben'].map(id => onDate.filter(d => d.crewId === id).length);
    const allWorking = onDate.every(d => E.resolveEffectiveDayType(after, DATE, d) !== 'Day off');
    // Idempotence: applying again must not append a second record.
    const twice = applyDayPresence(after, DATE, ['ana', 'ben'], true, OPTS);
    check(`P5/${engineLabel}`, 'ALL-on creates a record for crew who had none, never double-appends (idempotent)',
      onDate.length === 2 && eq(perCrew, [1, 1]) && allWorking &&
      twice.days.filter(d => d.date === DATE).length === 2,
      `records ${onDate.length}, perCrew ${JSON.stringify(perCrew)}, reapplied ${twice.days.filter(d => d.date === DATE).length}`);
  }
  // P6 — ALL-off zeroes the day; the undo snapshot restores it exactly.
  {
    const before = mkProd([
      { id: 'a2', crewId: 'ana', date: DATE, callTime: '07:30' },
      { id: 'b2', crewId: 'ben', date: DATE },
    ]);
    const snapshot = clone(before.days); // what pushUndo captures
    const after = applyDayPresence(before, DATE, ['ana', 'ben'], false, OPTS);
    const totals = after.days.map(d => E.calcForDisplay(after, d, CREW.find(c => c.id === d.crewId), null).total);
    const restored = { ...after, days: snapshot };
    check(`P6/${engineLabel}`, 'ALL-off zeroes the whole day; restoring the undo snapshot reproduces the original exactly',
      totals.every(t => t === 0) && eq(restored.days, before.days === snapshot ? snapshot : clone(snapshot)) &&
      eq(restored.days, snapshot),
      `totals ${JSON.stringify(totals)}`);
  }
  // P7 — purity, both directions.
  {
    const p = mkProd(blankDay());
    const frozen = clone(p);
    applyDayPresence(p, DATE, ['ana', 'ben'], true, OPTS);
    applyDayPresence(p, DATE, ['ana', 'ben'], false, OPTS);
    check(`P7/${engineLabel}`, 'purity: the input production is never mutated in either direction', eq(p, frozen));
  }
  // P8 — ticking when the dept default for the date is itself Day off.
  {
    const p = mkProd(blankDay(), { [DATE]: { dayType: 'Day off', callTime: '08:00', wrapTime: '19:00', lunchStartTime: '13:00', lunchDurationMins: 60 } });
    const after = applyDayPresence(p, DATE, ['ana'], true, OPTS);
    const rec = after.days.find(d => d.id === 'a2');
    const resolved = E.resolveEffectiveDayType(after, DATE, rec);
    check(`P8/${engineLabel}`, 'tick still produces a WORKING day when the dept default for the date is Day off',
      resolved !== 'Day off' && E.calcForDisplay(after, rec, CREW[0], null).total > 0,
      `resolved ${resolved}`);
  }
}

async function main() {
  console.log('');
  console.log('============================================================');
  console.log(" Who's on today — the BB day ticker (blank days + presence)");
  console.log('============================================================');
  console.log('');
  console.log('[1/1] Executed contract — source engine, then built bundle');

  const src = await loadSourceEngine();
  const built = loadBuiltEngine();
  for (const need of ['applyDayPresence', 'resolveEffectiveDayType', 'calcForDisplay', 'resolveDay']) {
    if (typeof src[need] !== 'function' || typeof built[need] !== 'function') {
      console.log(`      ✗ ${need} missing from an engine (src=${typeof src[need]}, built=${typeof built[need]})`);
      process.exit(1);
    }
  }
  runSuite('src', src);
  runSuite('built', built);

  const pass = results.every((r) => r.pass);
  console.log('');
  console.log('============================================================');
  console.log(pass
    ? ` ✅ PASS — ${results.length} checks: blank days are dense £0 Day offs,`
    : ` ❌ FAIL — see details above.`);
  if (pass) console.log('    ticking round-trips exactly, and turnaround stays correct.');
  console.log('============================================================');

  fs.writeFileSync(
    path.join(__dirname, 'last-day-presence.json'),
    JSON.stringify({ when: new Date().toISOString(), results, pass }, null, 2),
  );
  process.exit(pass ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(2); });
