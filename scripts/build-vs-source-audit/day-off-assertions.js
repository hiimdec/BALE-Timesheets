/*
 * day-off-assertions.js
 *
 *   $ node scripts/build-vs-source-audit/day-off-assertions.js
 *
 * The Day-off model (ruled 2026-07-30). "Day off" is the ninth day type:
 * £0, not engaged — no BDR, no OT, no penalties, no TOC, no meal comp. It
 * is what un-tick/remove-from-day now writes; the paid APA Rest Day (flat
 * BDR, engaged non-shooting) is a deliberate assignment only. Forward-only:
 * existing Rest Day records untouched. The ninth type NEVER travels on the
 * frozen v1 wire — un-worked days are filtered before the encoder, so the
 * 0-7 decoder range stays frozen (type 8 refuses clean as damaged).
 *
 * Executed against the SOURCE engine and the BUILT bundle:
 *
 *   D1  Day off is genuinely £0 — empty lines, zero total — even with
 *       explicit stored times AND a late-wrap previous working day (no TOC)
 *   D2  resolveDay blanks times on Day off (explicit values overridden;
 *       the stored record is NOT mutated — a re-type restores them)
 *   D3  un-tick (applyRemoveFromDay) writes 'Day off', NOT the paid
 *       'Rest Day'; every other field byte-preserved; pure
 *   D4  the phantom-TOC-on-untick case is GONE end-to-end: the un-ticked
 *       day totals £0 with no TOC, and the day AFTER it gets no TOC either
 *   D5  Rest Day still pays flat BDR — exact frozen object
 *   D6  wire: worked+rest+day-off production shares as the worked days
 *       only, round-trips through the frozen v1 codec; a hand-crafted
 *       type-8 tuple refuses clean as damaged (never misread)
 *   D7  PM/PA/Runner TOC exclusion pinned on the clause's worked example
 *
 * Wiring: audit:build (after quick-set) · standalone audit:dayoff.
 * Exit code: 0 all pass, 1 any fail, 2 harness error.
 */

const zlib = require('zlib');
const { loadSourceEngine, loadBuiltEngine } = require('./load-engines');

const results = [];
function check(id, desc, pass, detail) {
  results.push({ id, desc, pass, detail: detail || '' });
  console.log(`      ${pass ? '✓' : '✗'} ${id}  ${desc}${pass || !detail ? '' : `\n           ${detail}`}`);
}

const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const clone = (x) => JSON.parse(JSON.stringify(x));
const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fragOf = (envelope) => b64url(zlib.deflateRawSync(Buffer.from(JSON.stringify(envelope))));

const CREW = { id: 'b', name: 'Billy', role: 'Lighting Technician', bdr: 444, otCoef: 1.5, otRate: null, noOT: false };
const PM = { ...CREW, role: 'Production Manager' };
const mkProd = (days) => ({
  title: 'Day-off model fixture', bestBoyMode: true,
  defaultDay: { callTime: '08:00', wrapTime: '22:00', lunchStartTime: '13:00', lunchDurationMins: 60, dayType: 'Shoot' },
  dayDefaults: {}, crew: [CREW], days,
});

function runSuite(engineLabel, E) {
  // D1 — true zero, with explicit stored times AND a late-wrap prev day.
  {
    const p = mkProd([
      { id: 'w1', crewId: 'b', date: '2026-08-10' },
      { id: 'o1', crewId: 'b', date: '2026-08-11', dayType: 'Day off', callTime: '09:00', wrapTime: '23:00', lunchStartTime: '13:00' },
    ]);
    const off = E.calcForDisplay(p, p.days[1], CREW, p.days[0]);
    check(`D1/${engineLabel}`, 'Day off is genuinely £0: empty lines, zero total, no TOC (explicit times + late-wrap prev)',
      off.total === 0 && Array.isArray(off.lines) && off.lines.length === 0 && off.meta.dayLabel === 'Day off',
      `total ${off.total}, lines ${off.lines.length}`);
  }
  // D2 — resolution blanks times; the record is not mutated.
  {
    const p = mkProd([{ id: 'o1', crewId: 'b', date: '2026-08-11', dayType: 'Day off', callTime: '09:00', wrapTime: '23:00' }]);
    const frozen = clone(p.days[0]);
    const r = E.resolveDay(p, p.days[0], CREW);
    check(`D2/${engineLabel}`, 'resolveDay blanks times on Day off; stored record untouched',
      r.callTime === undefined && r.wrapTime === undefined && r.lunchStartTime === undefined &&
      eq(p.days[0], frozen),
      `resolved call ${JSON.stringify(r.callTime)}, wrap ${JSON.stringify(r.wrapTime)}`);
  }
  // D3 — un-tick writes Day off, not Rest Day; other fields byte-preserved.
  {
    const p = mkProd([{ id: 'x1', crewId: 'b', date: '2026-08-11', wrapTime: '19:45', travelOutMins: 30, expenses: [{ id: 'e1', presetId: 'builtin-perdiem', name: 'Per Diem', amount: 35, detail: '' }] }]);
    const frozen = clone(p);
    const after = E.applyRemoveFromDay(p, 'x1');
    const rec = after.days[0];
    const { dayType: _t, ...rest } = rec;
    const { dayType: _t0, ...restBefore } = frozen.days[0];
    check(`D3/${engineLabel}`, "un-tick produces dayType 'Day off' (never the paid Rest Day); all other fields preserved; pure",
      rec.dayType === 'Day off' && rec.dayType !== 'Rest Day' && eq(rest, restBefore) && eq(p, frozen),
      `dayType ${rec.dayType}`);
  }
  // D4 — the phantom TOC on un-tick is gone, both edges, end-to-end.
  {
    const p = mkProd([
      { id: 'w1', crewId: 'b', date: '2026-08-10' },                          // Shoot, wrap 22:00 (cascade)
      { id: 'u1', crewId: 'b', date: '2026-08-11' },                          // will be un-ticked
      { id: 'w3', crewId: 'b', date: '2026-08-12' },                          // Shoot
    ]);
    const after = E.applyRemoveFromDay(p, 'u1');
    const offDay = E.calcForDisplay(after, after.days[1], CREW, after.days[0]);
    const nextDay = E.calcForDisplay(after, after.days[2], CREW, after.days[1]);
    check(`D4/${engineLabel}`, 'phantom-TOC-on-untick GONE: un-ticked day £0 no TOC; the day after gets no TOC from it',
      offDay.total === 0 && !offDay.lines.some(l => l.isTOC) && !nextDay.lines.some(l => l.isTOC),
      `off ${offDay.total}, next TOC ${nextDay.lines.some(l => l.isTOC)}`);
  }
  // D5 — Rest Day unchanged: the exact frozen pay object.
  {
    const p = mkProd([{ id: 'r1', crewId: 'b', date: '2026-08-11', dayType: 'Rest Day' }]);
    const rest = E.calcForDisplay(p, p.days[0], CREW, null);
    check(`D5/${engineLabel}`, 'Rest Day still pays flat BDR exactly (the APA type untouched)',
      rest.total === 444 && rest.lines.length === 1 && rest.lines[0].label === 'Rest Day (flat BDR)' && rest.lines[0].amount === 444,
      JSON.stringify(rest.lines));
  }
  // D6 — the wire: worked days only travel; type 8 refuses clean.
  {
    const p = mkProd([
      { id: 'w1', crewId: 'b', date: '2026-08-10' },
      { id: 'o1', crewId: 'b', date: '2026-08-11', dayType: 'Day off' },
      { id: 'r1', crewId: 'b', date: '2026-08-12', dayType: 'Rest Day' },
      { id: 'w2', crewId: 'b', date: '2026-08-13' },
    ]);
    const span = E.extractCrewShareDays(p, 'b');
    return { p, span };
  }
}

async function main() {
  console.log('');
  console.log('============================================================');
  console.log(' Day-off model — the ninth type, £0 and never on the wire');
  console.log('============================================================');

  console.log('');
  console.log('[1/2] Executed fixtures — source engine, then built bundle');
  const src = await loadSourceEngine();
  const built = loadBuiltEngine();
  for (const need of ['applyRemoveFromDay', 'extractCrewShareDays', 'calcForDisplay', 'resolveDay']) {
    if (typeof src[need] !== 'function' || typeof built[need] !== 'function') {
      console.log(`      ✗ ${need} missing from an engine`);
      process.exit(1);
    }
  }
  const wires = [];
  for (const [label, E] of [['src', src], ['built', built]]) {
    const w = runSuite(label, E);
    wires.push([label, E, w]);
  }
  for (const [label, E, { p, span }] of wires) {
    const res = await E.encodeShareLink(p, span, CREW);
    const dec = res.ok ? await E.decodeShareLink(res.url.split('#')[1]) : { ok: false };
    check(`D6/${label}`, 'wire: only the two WORKED days travel; round-trips through frozen v1',
      span.length === 2 && res.ok === true && dec.ok === true &&
      dec.shoot.days.length === 2 &&
      dec.shoot.days.map(d => d.date).join(',') === '2026-08-10,2026-08-13',
      `span ${span.length}, decoded ${dec.ok ? dec.shoot.days.length : 'refused'}`);
  }
  // Type-8 fail-clean: a hand-crafted envelope carrying an unknown ninth
  // type must refuse as damaged in the SHIPPED decoder — never misread.
  {
    const envelope = { v: 1, n: 1, s: ['T', '', '', '', ''], d: [['2026-08-10', 8, '08:00', '13:00', 60, null, null, null, '19:00', 0, 0, 0, 0, 0]] };
    const out = await src.decodeShareLink(fragOf(envelope));
    const outB = await built.decodeShareLink(fragOf(envelope));
    check('D6x', 'a type-8 tuple refuses clean as damaged (both engines — never misread)',
      eq(out, { ok: false, reason: 'damaged' }) && eq(outB, { ok: false, reason: 'damaged' }), JSON.stringify(out));
  }
  // D7 — PM/PA/Runner exclusion pinned on the clause's worked example.
  {
    const p = mkProd([
      { id: 'w1', crewId: 'b', date: '2026-08-10', callTime: '08:00', wrapTime: '23:00' },
      { id: 'w2', crewId: 'b', date: '2026-08-11', callTime: '08:00', wrapTime: '20:00' },
    ]);
    const tech = src.calcForDisplay(p, p.days[1], CREW, p.days[0]);
    const pm = src.calcForDisplay({ ...p, crew: [PM] }, p.days[1], PM, p.days[0]);
    check('D7', 'clause example: technician gets 1h TOC at basic OT; a PM gets NONE (APA exclusion pinned)',
      tech.lines.some(l => l.isTOC && l.qty === 1 && l.rate === 66.6) && !pm.lines.some(l => l.isTOC),
      `tech TOC ${tech.lines.some(l => l.isTOC)}, pm TOC ${pm.lines.some(l => l.isTOC)}`);
  }

  const pass = results.every((r) => r.pass);
  console.log('');
  console.log('============================================================');
  console.log(pass
    ? ` ✅ PASS — ${results.length} checks: Day off is £0 everywhere, the`
    : ` ❌ FAIL — see details above.`);
  if (pass) {
    console.log('    Rest Day is untouched, and the ninth type never reaches the wire.');
  }
  console.log('============================================================');

  const fs = require('fs');
  const path = require('path');
  fs.writeFileSync(
    path.join(__dirname, 'last-day-off.json'),
    JSON.stringify({ when: new Date().toISOString(), results, pass }, null, 2),
  );

  process.exit(pass ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(2); });
