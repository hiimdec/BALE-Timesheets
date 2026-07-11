/*
 * calc-boundary-assertions.js
 *
 *   $ node scripts/build-vs-source-audit/calc-boundary-assertions.js
 *
 * Expected-£ regression pins for the fix/calc-audit boundary fixes. The
 * scenarios.js probe set is deliberately NOT a correctness oracle (it compares
 * source vs built only, so a bug present in both passes) — these assertions
 * pin the engine's output against hand-computed APA expectations at the exact
 * boundaries the 2026-07 adversarial audit found tipping:
 *
 *   A1 — floating-point boundary tipping. parseHHMM floats + bare >/Math.ceil
 *        amplified 1-ulp noise into a full increment (phantom 30m OT, phantom
 *        £10 late lunch, phantom CWD conversion), always over-billing. Fixed
 *        with TIME_EPS in ceilHalf and every threshold comparison.
 *
 *   A2 — curtailed-lunch double-pay on HOURLY-paid structures (Sunday/Bank
 *        Holiday and night shoots pay worked-minus-actual-lunch, so curtailed
 *        minutes are already paid as worked time; the unconditional top-up
 *        line paid them again, +30m × 2× BHR). Flat structures (weekday /
 *        Saturday) keep the top-up — genuinely owed there.
 *
 *   A3 — Sunday/BH triple-time gated to OT. 3× after midnight is an overtime
 *        rate (§4.4/§4.7); the old unconditional wrapAbs − 24 split paid 3×
 *        for post-midnight hours INSIDE the basic/min-10h day and let triple
 *        eat the min-10h top-up. Now split at max(call + basicHrs, 24) like
 *        the weekday/Saturday branches.
 *
 *   B1 — weekday continuous nights (§2.2.2/§2.2.5, Derrick-approved): a night
 *        that runs continuous is a CWD at night — 2× BDR covering 9h from
 *        call + OT after 9h at 2× BHR, clock-based, no triple. Confirmed by
 *        the PDF's own §2.2.2 example (1st AD £785, 03:00→13:00 = £1,727).
 *        Basic nights stay flat; weekend/BH nights stay flat per §2.4(iii)/(iv).
 *
 * Reference crew throughout: grade I, BDR £444 → BHR £44.40, OT £66.60,
 * 2× £88.80, 3× £133.20.
 *
 * Exit code: 0 if all assertions pass, 1 if any fail, 2 on harness error.
 */

const { loadSourceEngine } = require('./load-engines');

// ---- Pass/fail collector (same shape as kit-assertions) --------------------

function makeCollector() {
  let pass = 0, fail = 0;
  const failures = [];
  const ok = (label, cond, detail) => {
    if (cond) { pass++; console.log(`  ✓ ${label}`); }
    else      { fail++; failures.push({ label, detail }); console.log(`  ✗ FAIL ${label}${detail ? ' — ' + detail : ''}`); }
  };
  const summary = () => ({ pass, fail, failures });
  return { ok, summary };
}

// ---- Fixtures ---------------------------------------------------------------

const baseCrew = (overrides = {}) => ({
  id: 'c1', name: 'Test', role: 'Spark', department: 'Electrical',
  bdr: 444, otCoef: 1.5, otRate: null, noOT: false, pmpa: false,
  vatRegistered: false, vatRate: 20,
  kitMoneyEnabled: false, kitMoneyAmount: 0,
  isDriver: false, email: '',
  ...overrides,
});

const baseDay = (overrides = {}) => ({
  id: 'd1', crewId: 'c1', date: '2026-06-01', // Monday
  callTime: '08:00', wrapTime: '19:00', wrapNextDay: false,
  dayType: 'Shoot', lunchStartTime: '13:00', lunchDurationMins: 60,
  noMealProvided: false,
  secondBreakStartTime: '', secondBreakDurationMins: 0, secondBreakLogged: false,
  cwdBreak1Given: false, cwdBreak2Given: false,
  preCallTime: '', travelOutMins: 0, travelBackMins: 0,
  miles: 0, mileagePostcode: '', mileageMethod: 'distance', mileageRoundTrip: false,
  perDiemAmount: 0, expenses: [], kitMoneyAmount: 0, kitItems: [],
  stepUpRole: '', stepUpBDR: 0, stepUpOTCoef: 1, stepUpOTRate: null,
  ...overrides,
});

const near = (a, b, eps = 0.01) => Math.abs(a - b) < eps;
const otQty = (calc) => calc.lines.filter(l => /^OT\b/.test(l.label)).reduce((s, l) => s + (Number(l.qty) || 0), 0);
const hasLine = (calc, label) => calc.lines.some(l => l.label === label);

// ---- A1: floating-point boundary tipping ------------------------------------

function stageA1(eng, ok) {
  console.log('\nA1 · FP boundary tipping (TIME_EPS)');
  const calc = (d, opts = {}) => eng.calculateDay(baseDay(d), baseCrew(), opts);

  // Exact 1.0h OT from a 10-minute-grid pair (pre-fix: charged 1.5h, +£33.30).
  const a = calc({ callTime: '08:10', wrapTime: '20:10', lunchStartTime: '11:10', secondBreakStartTime: '17:00', secondBreakDurationMins: 30 });
  ok('A1a 08:10→20:10 charges exactly 1.0h OT', near(otQty(a), 1.0), `otQty=${otQty(a)}`);
  ok('A1a total £510.60 (BDR + 1h OT)', near(a.total, 510.60), `total=${a.total}`);

  // Exact 0.5h OT; wrap lands exactly ON the 2nd-break deadline (also pinned).
  const b = calc({ callTime: '08:10', wrapTime: '19:40', lunchStartTime: '13:10' });
  ok('A1b 08:10→19:40 charges exactly 0.5h OT', near(otQty(b), 0.5), `otQty=${otQty(b)}`);
  ok('A1b no phantom missed 2nd break at exact deadline', !hasLine(b, 'Missed 2nd Break'), JSON.stringify(b.lines.map(l => l.label)));
  ok('A1b total £477.30', near(b.total, 477.30), `total=${b.total}`);

  // Real 1h01m OT still rounds UP to 1.5h (epsilon must never absorb a minute).
  const c = calc({ callTime: '08:10', wrapTime: '20:11', lunchStartTime: '11:10', secondBreakStartTime: '17:00', secondBreakDurationMins: 30 });
  ok('A1c 1h01m real OT still rounds up to 1.5h', near(otQty(c), 1.5), `otQty=${otQty(c)}`);
  ok('A1c total £543.90', near(c.total, 543.90), `total=${c.total}`);

  // Lunch exactly AT +5:30 is on time (pre-fix: phantom £10 on some pairs).
  const d = calc({ callTime: '07:05', wrapTime: '18:05', lunchStartTime: '12:35' });
  ok('A1d lunch exactly at +5:30 fires no £10', !hasLine(d, 'Late 1st Break'), JSON.stringify(d.lines.map(l => l.label)));
  ok('A1d total £444.00 flat', near(d.total, 444.00), `total=${d.total}`);

  // One real minute past the deadline still fires the £10.
  const e = calc({ callTime: '07:05', wrapTime: '18:05', lunchStartTime: '12:36' });
  ok('A1e lunch at +5:31 still fires £10', hasLine(e, 'Late 1st Break') && near(e.total, 454.00), `total=${e.total}`);

  // Lunch exactly AT +6:30 stays a late-lunch day (pre-fix: phantom CWD, +£123.20).
  const f = calc({ callTime: '07:05', wrapTime: '19:05', lunchStartTime: '13:35' });
  ok('A1f lunch exactly at +6:30 does NOT convert to CWD', !f.meta.continuousDay, `continuousDay=${f.meta.continuousDay}`);
  ok('A1f late-lunch day: £10 + 1h OT = £520.60', hasLine(f, 'Late 1st Break') && near(f.total, 520.60), `total=${f.total}`);

  // One real minute past 6:30 still converts. CWD breaks marked given so the
  // pin isolates the conversion itself: BDR + 3h OT after the 9h CWD basic.
  const g = calc({ callTime: '07:05', wrapTime: '19:05', lunchStartTime: '13:36', cwdBreak1Given: true, cwdBreak2Given: true });
  ok('A1g lunch at +6:31 still converts to CWD (£643.80)', g.meta.continuousDay && near(g.total, 643.80), `cwd=${g.meta.continuousDay} total=${g.total}`);

  // Quarter-hour times (binary-exact) behave exactly as before.
  const h = calc({ callTime: '08:00', wrapTime: '20:00', lunchStartTime: '13:00', secondBreakStartTime: '17:00', secondBreakDurationMins: 30 });
  ok('A1h quarter-hour 08:00→20:00 still exactly 1.0h OT, £510.60', near(otQty(h), 1.0) && near(h.total, 510.60), `otQty=${otQty(h)} total=${h.total}`);

  // Curtailed lunch with wrap exactly at the shifted OT threshold: the top-up
  // must be paid (the epsilon'd absorbed-in-OT check must not swallow it).
  const i = calc({ wrapTime: '18:30', lunchDurationMins: 30 });
  ok('A1i curtail top-up at exact shifted threshold: £466.20', hasLine(i, 'Curtailed 1st Break') && near(i.total, 466.20), `total=${i.total}`);

  // TOC: rest of exactly 11h owes nothing; 10h59m owes a favourable-rounded 0.5h.
  const t1 = eng.calcTOC(baseDay({ callTime: '08:00', wrapTime: '21:10' }), baseDay({ date: '2026-06-02', callTime: '08:10' }), baseCrew(), false);
  ok('A1j TOC at exactly 11h rest → no TOC', t1 === null, JSON.stringify(t1));
  const t2 = eng.calcTOC(baseDay({ callTime: '08:00', wrapTime: '21:11' }), baseDay({ date: '2026-06-02', callTime: '08:10' }), baseCrew(), false);
  ok('A1k TOC at 10h59m rest → 0.5h × OT = £33.30', !!t2 && near(t2.amount, 33.30), JSON.stringify(t2));
}

// ---- A2: curtailed-lunch double-pay on hourly-paid structures ----------------

function stageA2(eng, ok) {
  console.log('\nA2 · curtailed lunch on hourly vs flat structures');
  const calc = (d) => eng.calculateDay(baseDay(d), baseCrew());
  const curt = (c) => hasLine(c, 'Curtailed 1st Break');

  // FIXED — hourly structures: minutes already paid as worked time, no top-up.
  const sun = calc({ date: '2026-06-07', lunchDurationMins: 30 }); // Sun 08:00-19:00
  ok('A2a Sunday curtailed 30m: hourly pay only, £932.40, no top-up line', !curt(sun) && near(sun.total, 932.40), `total=${sun.total} line=${curt(sun)}`);
  const sunOt = calc({ date: '2026-06-07', wrapTime: '21:00', lunchDurationMins: 30, secondBreakStartTime: '19:00', secondBreakDurationMins: 30 });
  ok('A2b Sunday curtailed 30m with OT-region hours: £1110.00, no top-up', !curt(sunOt) && near(sunOt.total, 1110.00), `total=${sunOt.total}`);
  const nPost = calc({ callTime: '20:00', wrapTime: '07:00', wrapNextDay: true, lunchStartTime: '01:00', lunchDurationMins: 30 });
  ok('A2c night (post-5pm) curtailed 30m: £932.40, no top-up', !curt(nPost) && near(nPost.total, 932.40), `total=${nPost.total}`);
  const nPre = calc({ callTime: '02:00', wrapTime: '13:00', lunchStartTime: '07:00', lunchDurationMins: 30 });
  ok('A2d night (pre-5am) curtailed 30m: £932.40, no top-up', !curt(nPre) && near(nPre.total, 932.40), `total=${nPre.total}`);

  // KEPT — flat structures: the top-up is genuinely owed (day fee fixed).
  const sat = calc({ date: '2026-06-06', wrapTime: '18:00', lunchDurationMins: 30 });
  ok('A2e Saturday curtailed 30m no-OT keeps top-up: £699.30', curt(sat) && near(sat.total, 699.30), `total=${sat.total} line=${curt(sat)}`);
  const wd = calc({ wrapTime: '18:30', lunchDurationMins: 30 });
  ok('A2f weekday curtailed 30m no-OT keeps top-up: £466.20', curt(wd) && near(wd.total, 466.20), `total=${wd.total}`);
  const satOt = calc({ date: '2026-06-06', lunchDurationMins: 30 });
  ok('A2g Saturday curtailed 30m WITH OT absorbs (no separate line): £699.30', !curt(satOt) && near(satOt.total, 699.30), `total=${satOt.total}`);
}

// ---- A3: Sunday/BH triple-time only for OT hours ------------------------------

function stageA3(eng, ok) {
  console.log('\nA3 · Sunday/BH post-midnight triple gated to OT');
  const calc = (d) => eng.calculateDay(baseDay({ date: '2026-06-07', ...d }), baseCrew()); // Sunday
  const tripleLine = (c) => c.lines.find(l => l.label.startsWith('OT Triple'));

  // The spec case: net 10h, OT would only start at call+11h = 03:30 = wrap.
  const a = calc({ callTime: '16:30', wrapTime: '03:30', wrapNextDay: true, lunchStartTime: '21:00' });
  ok('A3a Sun 16:30→03:30(+1) net 10h: all at 2× BHR, £888.00, no triple', !tripleLine(a) && near(a.total, 888.00), `total=${a.total} triple=${!!tripleLine(a)}`);

  // Min-10h day crossing midnight: the floor tops up at 2×, never 3×.
  const b = calc({ callTime: '15:00', wrapTime: '01:30', wrapNextDay: true, lunchStartTime: '19:00' });
  ok('A3b Sun 15:00→01:30(+1) net 9.5h: min-10h all at 2× BHR, £888.00', !tripleLine(b) && near(b.total, 888.00), `total=${b.total}`);

  // Genuine OT past midnight still triples (unchanged behaviour).
  const c = calc({ callTime: '08:00', wrapTime: '01:00', wrapNextDay: true, secondBreakStartTime: '18:00', secondBreakDurationMins: 30 });
  ok('A3c Sun 08:00→01:00(+1): 15h at 2× + 1h OT at 3× = £1465.20', !!tripleLine(c) && near(tripleLine(c).qty, 1) && near(c.total, 1465.20), `total=${c.total} triple=${tripleLine(c) && tripleLine(c).qty}`);

  // Sunday CWD (basic 9h): only the post-midnight OT hour triples. Expected
  // value updated by the §2.4(vi) ruling: the day fee is 2× BDR (not hourly),
  // so 16:00→02:00 = £888 fee + 1h post-midnight OT at 3× = £1,021.20.
  const d = calc({ callTime: '16:00', wrapTime: '02:00', wrapNextDay: true, lunchStartTime: '', lunchDurationMins: 0, cwdBreak1Given: true, cwdBreak2Given: true });
  ok('A3d Sun CWD 16:00→02:00(+1): 2×BDR + 1h OT at 3× = £1021.20', !!tripleLine(d) && near(d.total, 1021.20), `total=${d.total}`);

  // Bank holiday rides the same branch.
  const e = eng.calculateDay(baseDay({ date: '2026-08-31', callTime: '16:30', wrapTime: '03:30', wrapNextDay: true, lunchStartTime: '21:00' }), baseCrew());
  ok('A3e BH Monday 16:30→03:30(+1): £888.00, Bank Holiday label', near(e.total, 888.00) && e.meta.dayLabel === 'Bank Holiday', `total=${e.total} label=${e.meta.dayLabel}`);
}

// ---- B1: weekday continuous nights (§2.2.2/§2.2.5) ---------------------------

function stageB1(eng, ok) {
  console.log('\nB1 · weekday continuous nights: 2×BDR + OT after 9h at 2×BHR');
  const cont = (d, crew) => eng.calculateDay(baseDay({ lunchStartTime: '', lunchDurationMins: 0, cwdBreak1Given: true, cwdBreak2Given: true, ...d }), baseCrew(crew || {}));
  const cwdLine = (c) => c.lines.find(l => l.label === 'Night CWD (2× BDR)');
  const otLine = (c) => c.lines.find(l => l.label === 'Night CWD OT (2× BHR)');

  // NOTE: these no-lunch continuous nights are also lunchMissed, so from A4
  // on they carry the ruled "Missed 1st Break (night)" charge (1h × 2× BHR)
  // ON TOP of the B1 structure — the structure itself is asserted at line
  // level so the two rulings stay independently pinned.
  const chargeLine = (c) => c.lines.find(l => l.label === 'Missed 1st Break (night)');

  const a = cont({ callTime: '22:00', wrapTime: '10:00', wrapNextDay: true }); // 12h continuous
  ok('B1a weekday continuous night 12h: 2×BDR + 3h OT (+A4 charge) = £1243.20', !!cwdLine(a) && !!otLine(a) && near(otLine(a).qty, 3) && near(a.total, 1243.20), `total=${a.total}`);
  ok('B1a no triple line on a night CWD', !a.lines.some(l => l.label.startsWith('OT Triple')), JSON.stringify(a.lines.map(l => l.label)));

  const b = cont({ callTime: '22:00', wrapTime: '09:00', wrapNextDay: true }); // 11h
  ok('B1b weekday continuous night 11h: structure £1065.60 (+A4) = £1154.40', near(b.total, 1154.40) && near(otLine(b).qty, 2), `total=${b.total}`);

  // The PDF's own §2.2.2 worked example — the STRUCTURE reproduces to the
  // pound (2×BDR £1,570 + 1h OT £157); the ruled A4 charge (£157 at 2× BHR)
  // stacks on top because a no-lunch night is lunchMissed in the app's model.
  const c = cont({ callTime: '03:00', wrapTime: '13:00' }, { role: '1st AD', bdr: 785, otCoef: 1.0 });
  ok('B1c PDF example structure: 2×BDR £1,570 + OT £157 (lines exact)', near(cwdLine(c).amount, 1570) && near(otLine(c).amount, 157), JSON.stringify(c.lines.map(l => l.label + ':' + l.amount)));
  ok('B1c PDF example total incl. ruled A4 charge = £1,884.00', near(c.total, 1884.00) && near(chargeLine(c).amount, 157), `total=${c.total}`);

  const d = cont({ callTime: '22:00', wrapTime: '07:00', wrapNextDay: true }); // 9h — fee equals old floor
  ok('B1d continuous night ≤9h: fee 2×BDR ≡ old min-10h floor (line £888.00)', near(cwdLine(d).amount, 888.00) && !otLine(d) && near(d.total, 976.80), `total=${d.total}`);

  // No-regression: a BASIC night (lunch taken on time) stays flat, no CWD lines.
  const e = eng.calculateDay(baseDay({ callTime: '20:00', wrapTime: '08:00', wrapNextDay: true, lunchStartTime: '01:00', secondBreakStartTime: '07:00', secondBreakDurationMins: 30 }), baseCrew());
  ok('B1e basic night 12h span + lunch stays flat £976.80, no CWD lines', near(e.total, 976.80) && !cwdLine(e) && !otLine(e), `total=${e.total}`);

  // Weekend nights stay flat per §2.4(iii)/(iv) (flat line £1065.60 + A4 charge).
  const f = cont({ date: '2026-06-06', callTime: '22:00', wrapTime: '10:00', wrapNextDay: true });
  ok('B1f SATURDAY continuous night stays flat (12h × 2×BHR line) + A4 = £1154.40', near(f.total, 1154.40) && !cwdLine(f), `total=${f.total}`);
}

// ---- §2.4(vi): Sunday/BH continuous days --------------------------------------

function stageSunCwd(eng, ok) {
  console.log('\n§2.4(vi) · Sunday/BH CWD: 2×BDR + OT after 9h at 2×BHR');
  const cont = (d) => eng.calculateDay(baseDay({ date: '2026-06-07', lunchStartTime: '', lunchDurationMins: 0, cwdBreak1Given: true, cwdBreak2Given: true, ...d }), baseCrew());

  const a = cont({ callTime: '08:00', wrapTime: '20:00' }); // 12h Sunday CWD
  ok('vi-a Sunday CWD 12h: 2×BDR + 3h OT@2×BHR = £1154.40', near(a.total, 1154.40) && a.lines.some(l => l.label === 'Sunday CWD (2× BDR)'), `total=${a.total}`);

  const b = cont({ callTime: '08:00', wrapTime: '17:00' }); // 9h — equals old hourly floor
  ok('vi-b Sunday CWD ≤9h pays 2×BDR ≡ old hourly min-10h (£888.00)', near(b.total, 888.00), `total=${b.total}`);

  const c = cont({ date: '2026-08-31', callTime: '08:00', wrapTime: '20:00' }); // BH Monday
  ok('vi-c BH Monday CWD 12h: £1154.40, Bank Holiday labels', near(c.total, 1154.40) && c.lines.some(l => l.label === 'Bank Holiday CWD (2× BDR)'), `total=${c.total}`);

  const d = cont({ date: '2026-06-06', callTime: '08:00', wrapTime: '20:00' }); // Saturday §2.4(v) untouched
  ok('vi-d Saturday CWD 12h unchanged: 1.5×BDR + 3h OT@1.5×BHR = £865.80', near(d.total, 865.80) && d.lines.some(l => l.label === 'Saturday Day (1.5× BDR)'), `total=${d.total}`);
}

// ---- A4: night missed-break charges (§6.2/§6.3 night rows) -------------------

function stageA4(eng, ok) {
  console.log('\nA4 · night missed-break charges (1h first / 30m second, at ruled 2× BHR)');
  const calc = (d) => eng.calculateDay(baseDay({ cwdBreak1Given: true, cwdBreak2Given: true, ...d }), baseCrew());
  const charge = (c) => c.lines.find(l => l.label === 'Missed 1st Break (night)');

  // Weekday continuous night with MISSED first break: B1 structure + 1h × 2×BHR.
  const a = calc({ callTime: '20:00', wrapTime: '08:00', wrapNextDay: true, lunchStartTime: '', lunchDurationMins: 0 });
  ok('A4a weekday night missed 1st: structure £1154.40 + £88.80 = £1243.20', !!charge(a) && near(charge(a).amount, 88.80) && near(a.total, 1243.20), `total=${a.total}`);

  // Saturday night (flat structure) with MISSED first break: flat + charge.
  const b = calc({ date: '2026-06-06', callTime: '20:00', wrapTime: '08:00', wrapNextDay: true, lunchStartTime: '', lunchDurationMins: 0 });
  ok('A4b Saturday night missed 1st: flat £1065.60 + £88.80 = £1154.40', !!charge(b) && near(b.total, 1154.40), `total=${b.total}`);

  // VERY-LATE (taken) break converts the day but carries NO missed charge.
  const c = calc({ callTime: '20:00', wrapTime: '08:00', wrapNextDay: true, lunchStartTime: '03:00', lunchDurationMins: 60 });
  ok('A4c night very-late lunch: converts, no missed charge (£1154.40)', !charge(c) && near(c.total, 1154.40), `total=${c.total}`);

  // Missed SECOND break on a night stays 30m × 2× BHR (ruling: keep 2×).
  const d = calc({ callTime: '20:00', wrapTime: '08:00', wrapNextDay: true, lunchStartTime: '01:00', lunchDurationMins: 60 });
  const sb = d.lines.find(l => l.label === 'Missed 2nd Break');
  ok('A4d night missed 2nd stays 30m × 2×BHR = £44.40 (total £1021.20)', !!sb && near(sb.amount, 44.40) && near(d.total, 1021.20), `total=${d.total}`);

  // Day-shift missed lunch: NO night charge (conversion only).
  const e = calc({ callTime: '08:00', wrapTime: '19:00', lunchStartTime: '', lunchDurationMins: 0 });
  ok('A4e weekday day-shift missed lunch: no night charge (£577.20)', !charge(e) && near(e.total, 577.20), `total=${e.total}`);
}

// ---- Runner ------------------------------------------------------------------

async function runCalcBoundaryAssertions() {
  const eng = await loadSourceEngine();
  const { ok, summary } = makeCollector();
  stageA1(eng, ok);
  stageA2(eng, ok);
  stageA3(eng, ok);
  stageB1(eng, ok);
  stageSunCwd(eng, ok);
  stageA4(eng, ok);
  return summary();
}

if (require.main === module) {
  console.log('============================================================');
  console.log(' calc-boundary-assertions: APA boundary regression pins');
  console.log('============================================================');
  runCalcBoundaryAssertions().then(({ pass, fail }) => {
    const total = pass + fail;
    console.log('\n============================================================');
    if (fail === 0) {
      console.log(` ✅ PASS — all ${total} calc boundary assertions passed.`);
    } else {
      console.log(` ❌ FAIL — ${fail} of ${total} calc boundary assertions failed.`);
    }
    console.log('============================================================');
    process.exit(fail > 0 ? 1 : 0);
  }).catch((e) => { console.error(e); process.exit(2); });
}

module.exports = { runCalcBoundaryAssertions };
