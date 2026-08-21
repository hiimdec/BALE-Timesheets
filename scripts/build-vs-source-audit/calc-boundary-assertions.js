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
 *   B3 — travel time on a working day (§3.1, Derrick's net-worked model):
 *        billable travel (first hour deducted each way) pays past the day's
 *        shortfall against a NET-WORKED bar (Shoot/basic-night 10 — 11 on an
 *        11-hour arrangement — any CWD 9, Prep/Recce/Build/De-rig 8,
 *        Pre-light 8). onClock = (span − lunch taken) + raw pre-call hours;
 *        curtailment shifts the threshold via net worked time (no separate
 *        credit term); late calls emerge from the bar; travel is ALWAYS
 *        1× BHR regardless of the day's rate.
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

// ---- B2: Saturday early-call premium (§2.1.3 all-days rule) -------------------

function stageB2(eng, ok) {
  console.log('\nB2 · Saturday early-call premium at the Saturday OT rate');
  const calc = (d, crew) => eng.calculateDay(baseDay({ date: '2026-06-06', lunchStartTime: '11:00', ...d }), baseCrew(crew || {}));
  const early = (c) => c.lines.find(l => l.label.startsWith('Early Call'));

  const a = calc({ callTime: '06:00', wrapTime: '17:00' });
  ok('B2a Sat 06:00 call: +1h × 1.5×BHR = £732.60', !!early(a) && near(early(a).amount, 66.60) && near(a.total, 732.60), `total=${a.total}`);

  const b = calc({ callTime: '07:00', wrapTime: '18:00', lunchStartTime: '12:00' });
  ok('B2b Sat 07:00 call boundary: no premium, £666.00', !early(b) && near(b.total, 666.00), `total=${b.total}`);

  const c = calc({ callTime: '05:30', wrapTime: '16:30' });
  ok('B2c Sat 05:30 call: 1.5h premium = £765.90', !!early(c) && near(c.total, 765.90), `total=${c.total}`);

  // §2.2.3-style: early call on a Saturday CWD — premium + OT after 9h.
  const d = calc({ callTime: '06:00', wrapTime: '17:00', lunchStartTime: '', lunchDurationMins: 0, cwdBreak1Given: true, cwdBreak2Given: true });
  ok('B2d Sat 06:00 CWD: premium + 2h OT after 9h = £865.80', !!early(d) && near(d.total, 865.80), `total=${d.total}`);

  const e = calc({ callTime: '06:00', wrapTime: '17:00' }, { role: 'Producer', bdr: 800, otCoef: 0, noOT: true });
  ok('B2e noOT crew gets no Saturday premium (£1200.00 flat)', !early(e) && near(e.total, 1200.00), `total=${e.total}`);

  // Sunday stays a documented no-op: hourly-from-call already pays 2× BHR.
  const f = calc({ date: '2026-06-07', callTime: '06:00', wrapTime: '17:00' });
  ok('B2f Sunday 06:00 unchanged: hourly min-10h £888.00, no premium line', !early(f) && near(f.total, 888.00), `total=${f.total}`);
}

// ---- B3: travel time on a working day (§3.1, net-worked model) ----------------

function stageB3(eng, ok) {
  console.log('\nB3 · travel-time gate: net-worked bars, pre-call counts, 1×BHR always');
  const T = { travelOutMins: 120, travelBackMins: 120 }; // 2h billable after first-hour-each-way
  const calc = (d) => eng.calculateDay(baseDay({ lunchStartTime: '13:00', ...T, ...d }), baseCrew());
  const tl = (c) => c.lines.find(l => l.label === 'Travel Time');
  const travelIs = (c, qty, amt) => { const t = tl(c); return !!t && near(t.qty, qty) && near(t.amount, amt) && near(t.rate, 44.40); };

  ok('B3a full Shoot: 2h £88.80 (total £532.80)', (c => travelIs(c, 2, 88.80) && near(c.total, 532.80))(calc({})), '');
  ok('B3b 1h-early wrap: 1h £44.40 (total £488.40)', (c => travelIs(c, 1, 44.40) && near(c.total, 488.40))(calc({ wrapTime: '18:00' })), '');

  // The ruled C-case: curtailment shifts the threshold 30m earlier —
  // 18:30 threshold, wrapped 18:00 → 30m absorbed → 1.5h travel, PLUS the
  // £22.20 top-up. No double-count in either direction.
  const c = calc({ wrapTime: '18:00', lunchDurationMins: 30 });
  ok('B3c curtailed 30m + 1h-early wrap: 1.5h £66.60 + £22.20 top-up (total £532.80)',
    travelIs(c, 1.5, 66.60) && c.lines.some(l => l.label === 'Curtailed 1st Break' && near(l.amount, 22.20)) && near(c.total, 532.80), `total=${c.total}`);

  const d = calc({ wrapTime: '18:00', preCallTime: '07:00' });
  ok('B3d 1h pre-call fills the 1h-early gap: 2h £88.80 (total £599.40)', travelIs(d, 2, 88.80) && near(d.total, 599.40), `total=${d.total}`);

  const e = calc({ callTime: '13:00', wrapTime: '22:00', lunchStartTime: '18:00' });
  ok('B3e late call 13:00→22:00: travel fully absorbed (£444.00, note)', !tl(e) && near(e.total, 444.00) && (e.meta.notes || []).some(n => /Travel not paid/.test(n)), `total=${e.total}`);

  const f = calc({ callTime: '12:00', wrapTime: '22:00', lunchStartTime: '17:00' });
  ok('B3f late call 12:00→22:00: 1h £44.40 (total £488.40)', travelIs(f, 1, 44.40) && near(f.total, 488.40), `total=${f.total}`);

  const g = calc({ wrapTime: '17:00', lunchStartTime: '', lunchDurationMins: 0, cwdBreak1Given: true, cwdBreak2Given: true });
  ok('B3g full CWD (bar 9): 2h £88.80 (total £532.80)', travelIs(g, 2, 88.80) && near(g.total, 532.80), `total=${g.total}`);

  const h = calc({ wrapTime: '15:00', lunchStartTime: '', lunchDurationMins: 0, cwdBreak1Given: true, cwdBreak2Given: true });
  ok('B3h 7h CWD: fully absorbed (£444.00)', !tl(h) && near(h.total, 444.00), `total=${h.total}`);

  const i = calc({ dayType: 'Prep Day', wrapTime: '16:00', lunchStartTime: '', lunchDurationMins: 0 });
  ok('B3i full Prep (bar 8): 2h £88.80 (total £444.00)', travelIs(i, 2, 88.80) && near(i.total, 444.00), `total=${i.total}`);

  const j = calc({ dayType: 'Pre-light', wrapTime: '17:00' });
  ok('B3j full Pre-light (bar 8): 2h £88.80 (total £444.00)', travelIs(j, 2, 88.80) && near(j.total, 444.00), `total=${j.total}`);

  // 1×BHR guards on the elevated-rate days (§3.1 "single time, regardless").
  const k = calc({ callTime: '20:00', wrapTime: '07:00', wrapNextDay: true, lunchStartTime: '01:00' });
  ok('B3k night basic full: 2h at 1×BHR £88.80 (total £976.80)', travelIs(k, 2, 88.80) && near(k.total, 976.80), `total=${k.total}`);

  const l = calc({ date: '2026-06-07', wrapTime: '17:00', lunchStartTime: '', lunchDurationMins: 0, cwdBreak1Given: true, cwdBreak2Given: true });
  ok('B3l Sunday CWD full: 2h at 1×BHR £88.80 (total £976.80)', travelIs(l, 2, 88.80) && near(l.total, 976.80), `total=${l.total}`);

  const m = calc({ date: '2026-06-06' });
  ok('B3m Saturday full Shoot: 2h at 1×BHR £88.80 (total £754.80)', travelIs(m, 2, 88.80) && near(m.total, 754.80), `total=${m.total}`);
}

// ---- Mileage rate (Phase 5b bug fix) ----------------------------------------
// production.mileageRatePerMile, spread into weekendOpts at the call site and
// seeded from userPrefs.defaultMileageRate at creation, is now read by all three
// APA mileage sites (two in calculateDay, one in calculatePmpaDay). Absent falls
// back to the 50p literal, so a job that never set a rate is byte-identical.

function stageMileage(eng, ok) {
  console.log('\nMILEAGE · per-job rate: production.mileageRatePerMile via weekendOpts, absent → 50p');
  const mLine = (c) => c.lines.find(l => l.label === 'Mileage');
  const def = mLine(eng.calculateDay(baseDay({ miles: 46 }), baseCrew(), {}));
  ok('MILE1 absent per-job rate falls back to 50p: 46 mi @ £0.50 = £23.00', !!def && near(def.rate, 0.5) && near(def.amount, 23.00), JSON.stringify(def));
  const custom = mLine(eng.calculateDay(baseDay({ miles: 46 }), baseCrew(), { mileageRatePerMile: 0.45 }));
  ok('MILE2 calculateDay reads the per-job rate: 46 mi @ £0.45 = £20.70 (the dead pref is live via seeding)', !!custom && near(custom.rate, 0.45) && near(custom.amount, 20.70), JSON.stringify(custom));
  const pmpa = mLine(eng.calculateDay(baseDay({ miles: 46 }), baseCrew({ role: 'Production Assistant' }), { mileageRatePerMile: 0.45 }));
  ok('MILE3 the PMPA path (calculatePmpaDay) reads the same per-job rate: 46 mi @ £0.45 = £20.70', !!pmpa && near(pmpa.rate, 0.45) && near(pmpa.amount, 20.70), JSON.stringify(pmpa));
  const zero = mLine(eng.calculateDay(baseDay({ miles: 10 }), baseCrew(), { mileageRatePerMile: 0 }));
  ok('MILE4 a zero per-job rate is ignored, not billed at £0: 10 mi falls back to 50p = £5.00', !!zero && near(zero.rate, 0.5) && near(zero.amount, 5.00), JSON.stringify(zero));
}

// ---- NOOT: the no-overtime flag is money, not decoration --------------------
// The engine reads `crew.noOT ? 0 : (Number(crew.otCoef) || 1)`. The card gives
// Director/Producer otCoef 0 AND noOT true; the 0 alone cannot carry the rule,
// because `Number(0) || 1` falls through to 1.0 — so a crew record that lost the
// flag bills phantom overtime at 1T. Two editors were dropping it (Phase 8
// Part 1). This is a DIVERGENCE pin, not a default-path one: the same day and
// the same stored coefficient produce different money with the flag and without.
function stageNoOT(eng, ok) {
  console.log('\nNOOT · the no-overtime flag: present vs absent must differ in MONEY');
  const director = (o = {}) => baseCrew({ role: 'Director', bdr: 961, otCoef: 0, otRate: null, ...o });
  // Weekday shoot, 08:00–21:00 (13h span, 1h lunch) — 2h past the basic day.
  const otDay = baseDay({ callTime: '08:00', wrapTime: '21:00', lunchStartTime: '13:00', lunchDurationMins: 60 });
  const withFlag = eng.calculateDay(otDay, director({ noOT: true }), {});
  const without = eng.calculateDay(otDay, director({ noOT: false }), {});
  ok('NOOT1 flag PRESENT: a Director works 2h past the basic day and bills NO overtime — BDR only (£961 + the £48.05 missed-2nd-break penalty = £1,009.05), no OT line at all',
    near(withFlag.total, 1009.05) && !withFlag.lines.some(l => /^OT\b/.test(l.label)) && otQty(withFlag) === 0,
    JSON.stringify({ total: withFlag.total, labels: withFlag.lines.map(l => l.label) }));
  ok('NOOT2 flag ABSENT (the bug both editors shipped): the SAME day and the SAME stored otCoef 0 bill 2h phantom OT at 1T (£96.10/h = £192.20), total £1,201.25 — the over-claim that reached invoices',
    near(without.total, 1201.25) && near(otQty(without), 2) && near(without.total - withFlag.total, 192.20),
    JSON.stringify({ total: without.total, otQty: otQty(without) }));
  ok('NOOT3 the divergence is the point: flag present and absent are NOT equal (£192.20 apart), so this pin cannot pass by both paths agreeing at a default',
    !near(withFlag.total, without.total) && near(without.total - withFlag.total, 192.20),
    JSON.stringify({ withFlag: withFlag.total, without: without.total }));
  // The flag only bites where OT exists: a day inside the basic day pays the
  // same either way, which is why the bug hid — most Director days have no OT.
  const shortDay = baseDay({ callTime: '08:00', wrapTime: '18:00', lunchStartTime: '13:00', lunchDurationMins: 60 });
  const shortWith = eng.calculateDay(shortDay, director({ noOT: true }), {});
  const shortWithout = eng.calculateDay(shortDay, director({ noOT: false }), {});
  ok('NOOT4 inside the basic day the two agree — the reason the bug hid for so long; the pin above deliberately does NOT sit on this path',
    near(shortWith.total, shortWithout.total), JSON.stringify({ w: shortWith.total, wo: shortWithout.total }));
}

// ---- DAYRATE: the per-day-type agreed rate (Phase 9) ------------------------
// A per-job figure for a non-shoot day (production.dayTypeRates), resolved onto
// the day by resolveCrewForDay. It is a RATE OVERRIDE, not a fixed fee: the
// engine knows nothing about it — it simply receives a crew whose bdr is the
// agreed figure, so BHR, OT, weekends and penalties all re-derive. These pins
// assert the two paths give DIFFERENT money (the mileage / NOOT lesson), and
// that a production with no rate set is untouched.
function stageDayRate(eng, ok) {
  console.log('\nDAYRATE · a per-day-type agreed rate overrides the BASE, and OT follows it');
  const crew = baseCrew();                       // Spark, BDR 444 → BHR 44.40, OT 66.60
  // Recce, weekday, 08:00–18:00 = 10h. §2.3: 8h basic (no lunch), 2h OT.
  const recce = baseDay({ dayType: 'Recce', callTime: '08:00', wrapTime: '18:00', lunchStartTime: '', lunchDurationMins: 0 });

  const apaCrew = eng.resolveCrewForDay(recce, crew, null);
  const rateCrew = eng.resolveCrewForDay(recce, crew, { 'Recce': 300 });
  ok('DAYRATE1 the overlay replaces the BASE only: bdr 444 → 300, and the coefficient (the person\'s grade) is untouched',
    apaCrew.bdr === 444 && rateCrew.bdr === 300 && rateCrew.otCoef === crew.otCoef,
    JSON.stringify({ apa: apaCrew.bdr, rated: rateCrew.bdr, coef: rateCrew.otCoef }));

  const apa = eng.calculateDay(recce, apaCrew, {});
  const rated = eng.calculateDay(recce, rateCrew, {});
  ok('DAYRATE2 no rate set → the day is unchanged: 8h × £44.40 + 2h OT × £66.60 = £488.40 (the APA path, byte-identical to before the feature)',
    near(apa.total, 488.40) && near(otQty(apa), 2), JSON.stringify({ total: apa.total, ot: otQty(apa) }));
  ok('DAYRATE3 a £300 recce rate re-derives the WHOLE day: 8h × £30.00 + 2h OT × £45.00 = £330.00 — the overtime computes from £300, not from the shoot rate',
    near(rated.total, 330.00) && near(otQty(rated), 2) &&
    near(rated.lines.find(l => /^OT\b/.test(l.label)).rate, 45), JSON.stringify({ total: rated.total, otRate: rated.lines.find(l => /^OT\b/.test(l.label)).rate }));
  ok('DAYRATE4 the divergence is the point: the two paths are £158.40 apart on the same day, and their OT lines differ too (£133.20 vs £90.00) — this pin cannot pass by both agreeing at a default',
    !near(apa.total, rated.total) && near(apa.total - rated.total, 158.40) &&
    !near(apa.lines.find(l => /^OT\b/.test(l.label)).amount, rated.lines.find(l => /^OT\b/.test(l.label)).amount),
    JSON.stringify({ apa: apa.total, rated: rated.total, delta: apa.total - rated.total }));

  // Step-up WINS over the day-type rate (ruled): more specific, hand-entered,
  // and it carries a role and coefficient the day rate does not.
  const steppedUp = { ...recce, stepUpRole: 'Gaffer', stepUpBDR: 585, stepUpOTCoef: 1.25, stepUpOTRate: null };
  const suCrew = eng.resolveCrewForDay(steppedUp, crew, { 'Recce': 300 });
  ok('DAYRATE5 a step-up on the day WINS over the job rate: bdr 585 (the step-up), not 300 — and it brings its own role and coefficient',
    suCrew.bdr === 585 && suCrew.otCoef === 1.25 && suCrew.role === 'Gaffer',
    JSON.stringify({ bdr: suCrew.bdr, coef: suCrew.otCoef, role: suCrew.role }));

  // Scope is enforced in the RESOLVER, not only at the control: a stray key for
  // an ineligible type (a hand-edited backup, a future bug) must never silently
  // re-rate a shoot or travel day. Both return the crew record UNCHANGED —
  // asserted by object identity, so a copy that happened to match would fail.
  const shoot = baseDay({ dayType: 'Shoot' });
  const travel = baseDay({ dayType: 'Travel Day' });
  ok('DAYRATE6 an ineligible day type is never rate-overridden even when a rate IS keyed to it: Shoot and Travel Day both pass the crew record through untouched (identity), so a stray key cannot reach money',
    eng.resolveCrewForDay(shoot, crew, { 'Shoot': 300 }) === crew &&
    eng.resolveCrewForDay(travel, crew, { 'Travel Day': 300 }) === crew,
    JSON.stringify({ shoot: eng.resolveCrewForDay(shoot, crew, { 'Shoot': 300 }).bdr, travel: eng.resolveCrewForDay(travel, crew, { 'Travel Day': 300 }).bdr }));
  ok('DAYRATE6b the scope guard is not vacuous: the SAME rate value on an ELIGIBLE type does override (Recce 300 lands), so DAYRATE6 passes because of the type, not because the mechanism is dead',
    eng.resolveCrewForDay(recce, crew, { 'Recce': 300 }).bdr === 300, 'the eligible case must still apply');
  ok('DAYRATE7 an absent or zero rate is ignored rather than billed as £0 (the mileage-zero lesson): the crew record passes through IDENTICALLY',
    eng.resolveCrewForDay(recce, crew, { 'Recce': 0 }) === crew &&
    eng.resolveCrewForDay(recce, crew, {}) === crew &&
    eng.resolveCrewForDay(recce, crew, null) === crew,
    'zero/absent must return the same object');
}

// ---- NATION: bank holidays by UK production base (Phase 10) ------------------
// UK_BANK_HOLIDAYS is England & Wales only, so a Scottish or Northern Irish job
// missed holidays it should pay and paid one it shouldn't. Bank holidays pay at
// a premium (§2.4: Sunday rate, 2× BDR), so the error was real money in BOTH
// directions. The engine now resolves through the composed nation sets keyed by
// production.baseNation, which rides in weekendOpts like every other per-job
// setting. ABSENT = england-wales = byte-identical to before.
function stageNation(eng, ok) {
  console.log('\nNATION · bank holidays follow the production base, and the error runs both ways');
  const crew = baseCrew();                                   // BDR 444
  const day = (date) => baseDay({ date, dayType: 'Shoot', callTime: '08:00', wrapTime: '19:00' });
  const run = (date, nation) => eng.calculateDay(day(date), crew, nation ? { baseNation: nation } : {});

  // Direction 1: Scotland pays 2 January; England & Wales does not.
  const jan2London = run('2026-01-02');
  const jan2Scot = run('2026-01-02', 'scotland');
  ok('NATION1 2 January 2026 is a SCOTTISH bank holiday only: a Glasgow-based job pays the §2.4 premium (£888) where a London one pays an ordinary day (£444) - money the Scottish user was previously losing',
    near(jan2London.total, 444) && near(jan2Scot.total, 888) &&
    jan2London.meta.isBankHoliday === false && jan2Scot.meta.isBankHoliday === true &&
    jan2Scot.meta.bankHolidayName === '2nd January',
    JSON.stringify({ london: jan2London.total, scotland: jan2Scot.total, name: jan2Scot.meta.bankHolidayName }));

  // Direction 2: England & Wales pays Easter Monday; Scotland does not.
  const emLondon = run('2026-04-06');
  const emScot = run('2026-04-06', 'scotland');
  ok('NATION2 Easter Monday 2026 is E&W (and NI) only, NOT Scottish: the SAME job pays £888 in London and £444 in Glasgow - the other direction, money the Scottish user was previously over-claiming',
    near(emLondon.total, 888) && near(emScot.total, 444) &&
    emLondon.meta.isBankHoliday === true && emScot.meta.isBankHoliday === false,
    JSON.stringify({ london: emLondon.total, scotland: emScot.total }));

  ok('NATION3 the divergence is the point, both ways: each date differs by £444 between the two nations, and the two dates disagree in OPPOSITE directions - neither pin can pass by both paths agreeing at a default',
    !near(jan2London.total, jan2Scot.total) && !near(emLondon.total, emScot.total) &&
    near(jan2Scot.total - jan2London.total, 444) && near(emLondon.total - emScot.total, 444),
    JSON.stringify({ jan2Delta: jan2Scot.total - jan2London.total, easterDelta: emLondon.total - emScot.total }));

  // Vacuity guard: the SAME day on the SAME nation must agree with itself, so
  // the differences above are attributable to the nation and not to the
  // fixtures drifting apart for some unrelated reason.
  ok('NATION4 vacuity guard: the same date on the same nation gives the same money (both nations, both dates), so NATION1-3 differ because of the NATION and not because the fixtures drift',
    near(run('2026-01-02', 'scotland').total, jan2Scot.total) &&
    near(run('2026-01-02').total, jan2London.total) &&
    near(run('2026-04-06', 'scotland').total, emScot.total) &&
    near(run('2026-04-06').total, emLondon.total),
    'a fixture is not reproducible');

  // Northern Ireland: E&W plus its own two, so it must agree with London on
  // Easter Monday AND carry St Patrick's Day that neither other nation has.
  const patLondon = run('2026-03-17');
  const patNI = run('2026-03-17', 'northern-ireland');
  ok('NATION5 Northern Ireland is E&W PLUS its own: St Patrick\'s Day 2026 pays £888 in Belfast and £444 in London, while NI still carries E&W\'s Easter Monday (£888) - proving NI composes rather than replaces',
    near(patLondon.total, 444) && near(patNI.total, 888) &&
    near(run('2026-04-06', 'northern-ireland').total, 888),
    JSON.stringify({ london: patLondon.total, ni: patNI.total, niEaster: run('2026-04-06', 'northern-ireland').total }));

  // The DEFAULT PATH: absent nation must equal the old behaviour exactly. An
  // unknown value must fall back to E&W rather than crashing or paying nothing.
  ok('NATION6 an ABSENT baseNation computes exactly as before (every existing production), and an unknown/malformed value falls back to England & Wales rather than silently paying an ordinary day on a real holiday',
    near(run('2026-04-06').total, 888) && near(run('2026-04-06', undefined).total, 888) &&
    near(run('2026-04-06', 'atlantis').total, 888) && near(run('2026-01-02', 'atlantis').total, 444),
    JSON.stringify({ absent: run('2026-04-06').total, unknown: run('2026-04-06', 'atlantis').total }));

  // The PMPA path shares the same resolver - Production Manager/Assistant/
  // Runner route to calculatePmpaDay, which reads the nation too.
  const pmpaScot = eng.calculateDay(day('2026-01-02'), baseCrew({ role: 'Production Assistant', bdr: 441 }), { baseNation: 'scotland' });
  const pmpaLondon = eng.calculateDay(day('2026-01-02'), baseCrew({ role: 'Production Assistant', bdr: 441 }), {});
  ok('NATION7 the PMPA path (calculatePmpaDay) reads the nation too - a Production Assistant on a Scottish 2 January diverges from the same day in London, so the second engine entry point was not missed',
    !near(pmpaScot.total, pmpaLondon.total) && pmpaScot.meta.isBankHoliday === true && pmpaLondon.meta.isBankHoliday === false,
    JSON.stringify({ scot: pmpaScot.total, london: pmpaLondon.total }));
}

// ---- PREP: Sept 2026 prep-day rewrite (clause 2.3), card-versioned ----------
//
// The 2026 card carries terms: { prepOtAfter10: true }; the 2025 card carries
// none. The engine reads weekendOpts.apaTerms (resolved from the PRODUCTION
// START DATE at the calcForDisplay call site), so an August-started shoot
// keeps 2025 prep money for its whole run, September days included.
//
// PREP2 pins the reading of "overtime shall only apply after 10 hours have
// been worked" - hours 9 and 10 at BHR, not OT, threshold on hours worked
// not on the booking. CONFIRMED against practice by the founder (Phase 13):
// booked 8, worked 10 is ten hours at basic rate, overtime only after that.
// The rule lives in the engine's one prep2026 emit block; PREP1/PREP2/PREP6
// pin it.

function stagePrep(eng, ok) {
  console.log('\nPREP · Sept 2026 prep rule (clause 2.3): 8-or-10 booking, OT after 10 worked, weekday only');
  const crew = baseCrew();                                   // BDR 444 → BHR 44.40, OT 66.60
  // No lunch on the core fixtures - the 2025 lunch extension is PREP6's job.
  const prepDay = (o = {}) => baseDay({ dayType: 'Prep Day', lunchStartTime: '', lunchDurationMins: 0, ...o });
  const T26 = { prepOtAfter10: true };
  const run = (day, terms) => eng.calculateDay(day, crew, terms ? { apaTerms: terms } : {});
  const addlQty = (calc) => calc.lines.filter(l => l.label === 'Additional prep hours (BHR)').reduce((s, l) => s + l.qty, 0);

  // PREP1 — the OT threshold moves from 8 (no lunch) to a flat 10.
  const span12 = prepDay({ date: '2026-09-01', callTime: '08:00', wrapTime: '20:00' }); // Tuesday, 12h span
  const p1new = run(span12, T26);
  const p1old = run(span12);
  ok('PREP1 12h weekday prep, 8h booking: 2026 pays 8h booking (£355.20) + 2h more BHR to the 10h threshold (£88.80) + 2h OT (£133.20) = £577.20; the SAME day on 2025 terms pays 8h + 4h OT = £621.60 - the rule is £44.40 of real divergence, in the producer\'s favour',
    near(p1new.total, 577.20) && near(p1old.total, 621.60) &&
    addlQty(p1new) === 2 && otQty(p1new) === 2 &&
    addlQty(p1old) === 0 && otQty(p1old) === 4,
    JSON.stringify({ new: p1new.total, old: p1old.total, addl: addlQty(p1new), ot: [otQty(p1new), otQty(p1old)] }));

  // PREP2 — THE LITERAL READING, flagged: hours 9-10 at BHR, not OT.
  const span10 = prepDay({ date: '2026-09-01', callTime: '08:00', wrapTime: '18:00' }); // 10h span exactly
  const p2new = run(span10, T26);
  const p2old = run(span10);
  ok('PREP2 [CONFIRMED by the founder against practice] 10h weekday prep, 8h booking: hours 9-10 are BHR (£444.00 total, NO OT line), where 2025 paid them as OT (£488.40). Threshold is on hours WORKED, never inferred from the booking',
    near(p2new.total, 444.00) && otQty(p2new) === 0 && addlQty(p2new) === 2 &&
    near(p2old.total, 488.40) && otQty(p2old) === 2,
    JSON.stringify({ new: p2new.total, old: p2old.total }));

  // PREP3 — the booking is a charged minimum, and the control is money.
  const span7b10 = prepDay({ date: '2026-09-01', callTime: '08:00', wrapTime: '15:00', prepBookingHours: 10 });
  const span7b8  = prepDay({ date: '2026-09-01', callTime: '08:00', wrapTime: '15:00' });
  const p3b10 = run(span7b10, T26);
  const p3b8  = run(span7b8, T26);
  ok('PREP3 7h worked on a 10h booking still charges the full booking (£444.00); the same day booked at 8h charges £355.20 - prepBookingHours is £88.80 of money, so the day-record field cannot be decorative',
    near(p3b10.total, 444.00) && near(p3b8.total, 355.20) && otQty(p3b10) === 0 && otQty(p3b8) === 0,
    JSON.stringify({ b10: p3b10.total, b8: p3b8.total }));

  // PREP4 — Saturday precedence: clauses 2.4(vii)-(viii) unchanged, so the
  // 10h threshold must NOT leak into Saturday prep (which reads basicHrs for
  // its OT). Byte-equal lines with terms on/off; PREP1 proves the same terms
  // object is live money on a weekday, so the equality is not vacuous.
  const sat12 = prepDay({ date: '2026-09-05', callTime: '08:00', wrapTime: '20:00' }); // Saturday
  const p4on = run(sat12, T26);
  const p4off = run(sat12);
  ok('PREP4 Saturday prep is UNTOUCHED by the 2026 terms: identical lines and total with terms on and off (2.4(vii)-(viii) unchanged), while the SAME terms object moves weekday money in PREP1 - a basicHrs leak into the Saturday branch goes RED here',
    JSON.stringify(p4on.lines) === JSON.stringify(p4off.lines) && near(p4on.total, p4off.total) &&
    p4on.total > 0 && !near(p1new.total, p1old.total),
    JSON.stringify({ on: p4on.total, off: p4off.total }));

  // PREP5 — the other two exclusions. HONESTY NOTE (mutation-tested): unlike
  // Saturday, the Sunday/BH non-Shoot emit (flat hourly, min 8) and the night
  // emit (flat hourly, min 10) never read basicHrs TODAY, so dropping
  // !treatAsSun or !isNightShoot from the guard moves no money on any fixture
  // - these equalities cannot go red on the guard edit alone. They are
  // TRIPWIRES: they fire the day either branch starts reading basicHrs while
  // the guard is wrong. The guard EDIT itself is what goes RED, at source, in
  // PT4 (storage suite) - that pin, not this one, holds those two exclusions.
  const sun12 = prepDay({ date: '2026-09-06', callTime: '08:00', wrapTime: '20:00' });   // Sunday
  const bh12  = prepDay({ date: '2026-08-31', callTime: '08:00', wrapTime: '20:00' });   // August BH (E&W)
  const night = prepDay({ date: '2026-09-01', callTime: '20:00', wrapTime: '06:00', wrapNextDay: true });
  const eq = (day) => { const a = run(day, T26), b = run(day); return JSON.stringify(a.lines) === JSON.stringify(b.lines) && near(a.total, b.total) && a.total > 0; };
  ok('PREP5 Sunday prep, bank-holiday prep and NIGHT prep are byte-equal with terms on and off - a TRIPWIRE, not a load-bearing pin: those branches do not read basicHrs today (so this cannot fail on the guard edit alone - PT4 pins the guard at source); it fires if they ever start',
    eq(sun12) && eq(bh12) && eq(night),
    JSON.stringify({ sun: [run(sun12, T26).total, run(sun12).total], bh: [run(bh12, T26).total, run(bh12).total], night: [run(night, T26).total, run(night).total] }));

  // PREP6 — the split is prep-ONLY: Recce/Build/De-rig keep the 2025 branch
  // (lunch extension included) under 2026 terms, while the SAME times as a
  // Prep Day diverge - proving the extension was deleted for prep, retained
  // for the other three discretionary types.
  const recce = baseDay({ dayType: 'Recce', date: '2026-09-01', callTime: '08:00', wrapTime: '18:00' }); // 10h span, 1h lunch given
  const r26 = run(recce, T26);
  const r25 = run(recce);
  const prepSameTimes = run(baseDay({ dayType: 'Prep Day', date: '2026-09-01', callTime: '08:00', wrapTime: '18:00' }), T26);
  const otherTypesUntouched = ['Build Day', 'De-rig'].every((t) => {
    const d = baseDay({ dayType: t, date: '2026-09-01', callTime: '08:00', wrapTime: '20:00' });
    const a = run(d, T26), b = run(d);
    return JSON.stringify(a.lines) === JSON.stringify(b.lines) && near(a.total, b.total);
  });
  ok('PREP6 Recce with a 1h lunch pays £421.80 (8h + 1h OT past the 9h extension) IDENTICALLY on both term sets, and Build/De-rig are byte-equal too - but the same times as a 2026 Prep Day pay £444.00 with no OT (extension deleted, threshold 10): the split is prep-only',
    near(r26.total, 421.80) && near(r25.total, 421.80) &&
    JSON.stringify(r26.lines) === JSON.stringify(r25.lines) &&
    near(prepSameTimes.total, 444.00) && otQty(prepSameTimes) === 0 &&
    otherTypesUntouched,
    JSON.stringify({ recce: [r26.total, r25.total], prep: prepSameTimes.total }));

  // PREP7 — the resolution seam itself: terms come from the START date's
  // card, so an August-started shoot never sees the 2026 rule. (No pin on an
  // absent date - resolveRateCard falls back to today, which would flip this
  // suite on 1 September.)
  const t0901 = eng.resolveApaTerms('2026-09-01');
  const t0831 = eng.resolveApaTerms('2026-08-31');
  const t0601 = eng.resolveApaTerms('2026-06-01');
  ok('PREP7 resolveApaTerms: a 2026-09-01 start carries { prepOtAfter10: true }; 2026-08-31 and 2026-06-01 starts carry {} - and feeding the resolver\'s own outputs through the engine reproduces PREP1\'s divergence, so the seam is live end to end',
    t0901 && t0901.prepOtAfter10 === true && Object.keys(t0901).length === 1 &&
    t0831 && Object.keys(t0831).length === 0 && t0601 && Object.keys(t0601).length === 0 &&
    near(eng.calculateDay(span12, crew, { apaTerms: t0901 }).total, 577.20) &&
    near(eng.calculateDay(span12, crew, { apaTerms: t0831 }).total, 621.60),
    JSON.stringify({ t0901, t0831, t0601 }));
}

// ---- PC: the pre-call OT line states its REAL window -------------------------
// The detail used to hardcode `05:00 – ${callTime}` for every case, so a 07:00
// pre-call against an 08:00 call printed "05:00 – 08:00" beside qty 1: a
// three-hour window claimed for a one-hour charge. The money was always right;
// the working shown was not.
//
// Anchored on the RULE, not the string: parse the window out of the detail and
// assert it spans exactly `qty` hours. A hardcoded start cannot satisfy that
// across the boundary, and neither can a future edit that reformats the string
// while getting the arithmetic wrong. The amounts are pinned alongside, so this
// stage also proves the fix moved no money.
function stagePreCallWindow(eng, ok) {
  console.log('\nPC · pre-call OT line: stated window equals the charged hours');
  const run = (over) => eng.calculateDay(baseDay(over), baseCrew(), {});
  // [label, overrides, expected OT-segment start, expected qty, expected amount]
  const cases = [
    ['pre-call 07:00 → call 08:00 (the reported case)', { preCallTime: '07:00', callTime: '08:00' }, '07:00', 1, 66.60],
    ['pre-call 06:00 → call 08:00', { preCallTime: '06:00', callTime: '08:00' }, '06:00', 2, 133.20],
    ['pre-call 05:00 → call 08:00 (exactly on the boundary)', { preCallTime: '05:00', callTime: '08:00' }, '05:00', 3, 199.80],
    ['pre-call 04:00 → call 08:00 (spans 05:00 — triple runs up to it)', { preCallTime: '04:00', callTime: '08:00' }, '05:00', 3, 199.80],
    ['pre-call 22:00 → call 06:00 (overnight — triple crosses midnight)', { preCallTime: '22:00', callTime: '06:00', wrapTime: '17:00' }, '05:00', 1, 66.60],
  ];
  for (const [label, over, wantStart, wantQty, wantAmount] of cases) {
    const calc = run(over);
    const otLine = calc.lines.find(l => l.label === 'Pre-call' && /OT rate/.test(l.detail || ''));
    if (!otLine) { ok(`PC ${label}`, false, 'no pre-call OT line emitted'); continue; }
    const m = /^(\d{2}:\d{2}) – (\d{2}:\d{2}) · OT rate$/.exec(otLine.detail || '');
    if (!m) { ok(`PC ${label}`, false, `detail not in the expected shape: ${JSON.stringify(otLine.detail)}`); continue; }
    const [, start, end] = m;
    const hrs = (Number(end.slice(0, 2)) - Number(start.slice(0, 2))) + (Number(end.slice(3)) - Number(start.slice(3))) / 60;
    ok(`PC ${label}: window ${start}–${end} spans ${hrs}h and qty is ${otLine.qty}`,
      start === wantStart && near(hrs, Number(otLine.qty)) && near(Number(otLine.qty), wantQty),
      `start=${start} end=${end} spanHrs=${hrs} qty=${otLine.qty}`);
    ok(`PC ${label}: amount unmoved at £${wantAmount.toFixed(2)}`,
      near(Number(otLine.amount), wantAmount),
      `amount=${otLine.amount}`);
  }
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
  stageB2(eng, ok);
  stageB3(eng, ok);
  stageMileage(eng, ok);
  stageNoOT(eng, ok);
  stageDayRate(eng, ok);
  stageNation(eng, ok);
  stagePrep(eng, ok);
  stagePreCallWindow(eng, ok);
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
