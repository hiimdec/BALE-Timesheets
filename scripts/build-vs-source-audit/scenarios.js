/*
 * scenarios.js
 *
 * Broad coverage of TimeMachine pay scenarios. Each entry is a self-contained
 * (production, day, crewMember, prevDay) quadruple. The audit harness calls
 * calcForDisplay on both the SOURCE engine and the BUILT engine and compares.
 *
 * Coverage groups (>= 50 scenarios, currently 87):
 *   A. Continuous shoot days, various lengths
 *   B. Pre-light (incl. Saturday Pre-light)
 *   C. Prep / Recce / Build / De-rig
 *   D. Travel Day
 *   E. Rest Day
 *   F. Night shoots (overnight wrap)
 *   G. Pre-call (before/after 05:00 boundary)
 *   H. Missed / late / second breaks
 *   I. CWD breaks
 *   J. Weekend (Saturday / Sunday) rate variations
 *   K. Bank holidays
 *   L. Mileage / kit money / per diem / expenses
 *   M. Step-up
 *   N. PMPA roles
 *   O. TOC (rest <11h, breach <10h)
 *   P. noOT roles
 *   Q. BWD-override roles (DoP/Art Director/Location Manager on non-Shoot)
 *   R. Edge cases (zero BDR, APA rounding, favourable rounding, etc.)
 *
 * NOTE on intent: these scenarios are NOT a correctness oracle against APA
 * §rules. They are a probe set — varied enough that ANY systematic logic
 * difference between source and built will surface in at least one of them.
 * If you want APA-correctness assurance, that's a separate independent-reference
 * effort (the original 77-scenario audit lived outside this repo).
 */

// ---- Builders -------------------------------------------------------------

function baseCrew(overrides = {}) {
  return {
    id: 'c1',
    name: 'Test Crew',
    role: 'Spark',
    department: 'Electrical',
    bdr: 444,
    otCoef: 1.5,
    otRate: null,
    noOT: false,
    pmpa: false,
    vatRegistered: false,
    vatRate: 20,
    kitMoneyEnabled: false,
    kitMoneyAmount: 0,
    isDriver: false,
    email: '',
    ...overrides,
  };
}

function baseDay(overrides = {}) {
  return {
    id: 'd1',
    crewId: 'c1',
    date: '2026-06-01', // Monday by default
    callTime: '08:00',
    wrapTime: '19:00',
    wrapNextDay: false,
    dayType: 'Shoot',
    lunchStartTime: '13:00',
    lunchDurationMins: 60,
    noMealProvided: false,
    secondBreakDurationMins: 0,
    secondBreakLogged: false,
    cwdBreak1Given: false,
    cwdBreak2Given: false,
    preCallTime: '',
    travelOutMins: 0,
    travelBackMins: 0,
    miles: 0,
    mileagePostcode: '',
    mileageMethod: 'distance',
    mileageRoundTrip: false,
    perDiemAmount: 0,
    kitMoneyAmount: 0,
    expenses: [],
    stepUpRole: '',
    stepUpBDR: 0,
    stepUpOTCoef: 0,
    wrapped: false,
    note: '',
    ...overrides,
  };
}

function baseProduction(overrides = {}) {
  return {
    id: 'p1',
    title: 'Audit Production',
    prodCo: '',
    jobReference: '',
    crew: [],
    days: [],
    defaultDay: null,
    dayDefaults: {},
    bestBoyMode: false,
    viewMode: 'mobile',
    iAmCrewId: 'c1',
    isElevenHourDay: false,
    favourableRounding: false,
    apaRounding: false,
    startDate: '2026-06-01',
    gridDates: [],
    weekStarts: [],
    invoicingEmail: '',
    cancellationData: null,
    ...overrides,
  };
}

function mk(id, label, crewOver = {}, dayOver = {}, prodOver = {}, prevDayOver = null) {
  const crew = baseCrew(crewOver);
  const day = baseDay({ ...dayOver, crewId: crew.id });
  const production = baseProduction({
    ...prodOver,
    crew: [crew],
    days: [day],
    iAmCrewId: crew.id,
  });
  const prevDay = prevDayOver
    ? baseDay({ ...prevDayOver, crewId: crew.id })
    : null;
  return { id, label, production, day, crewMember: crew, prevDay };
}

// ---- Scenarios -----------------------------------------------------------

const scenarios = [
  // A. Continuous shoot days
  mk('A01', 'Standard shoot 08:00-19:00 (11h, no OT)'),
  mk('A02', 'Long shoot 08:00-22:00 (14h, 3h OT)', {}, { wrapTime: '22:00' }),
  mk('A03', 'Long shoot 08:00-00:30 next day (16.5h)', {}, { wrapTime: '00:30', wrapNextDay: true }),
  mk('A04', 'Short shoot 08:00-17:00 (9h)', {}, { wrapTime: '17:00' }),
  mk('A05', 'Late call shoot 12:00-23:00 (11h)', {}, { callTime: '12:00', wrapTime: '23:00' }),
  mk('A06', 'Late call shoot 12:00-02:00 next day (14h)', {}, { callTime: '12:00', wrapTime: '02:00', wrapNextDay: true }),
  mk('A07', '11-hr-day prod override (12h basic)', {}, {}, { isElevenHourDay: true }),
  mk('A08', '11-hr-day prod override, long shoot', {}, { wrapTime: '22:00' }, { isElevenHourDay: true }),

  // B. Pre-light (incl. Saturday Pre-light bugfix area)
  mk('B01', 'Pre-light Mon 09:00-18:00 (9h)', {}, { dayType: 'Pre-light', callTime: '09:00', wrapTime: '18:00' }),
  mk('B02', 'Pre-light Mon with OT 09:00-20:00', {}, { dayType: 'Pre-light', callTime: '09:00', wrapTime: '20:00' }),
  mk('B03', 'Pre-light Sat 09:00-17:00', {}, { dayType: 'Pre-light', date: '2026-06-06', callTime: '09:00', wrapTime: '17:00' }),
  mk('B04', 'Pre-light Sat with OT 09:00-20:00', {}, { dayType: 'Pre-light', date: '2026-06-06', callTime: '09:00', wrapTime: '20:00' }),
  mk('B05', 'Pre-light Sun (rare)', {}, { dayType: 'Pre-light', date: '2026-06-07', callTime: '09:00', wrapTime: '17:00' }),
  mk('B06', 'Pre-light short 09:00-15:00 (6h)', {}, { dayType: 'Pre-light', callTime: '09:00', wrapTime: '15:00' }),

  // C. Other non-shoot day types
  mk('C01', 'Prep Day 09:00-17:00 (8h)', {}, { dayType: 'Prep Day', callTime: '09:00', wrapTime: '17:00', lunchStartTime: '13:00' }),
  mk('C02', 'Recce 09:00-17:00', {}, { dayType: 'Recce', callTime: '09:00', wrapTime: '17:00' }),
  mk('C03', 'Build Day 09:00-17:00', {}, { dayType: 'Build Day', callTime: '09:00', wrapTime: '17:00' }),
  mk('C04', 'De-rig 09:00-17:00', {}, { dayType: 'De-rig', callTime: '09:00', wrapTime: '17:00' }),
  mk('C05', 'De-rig with OT 09:00-19:00', {}, { dayType: 'De-rig', callTime: '09:00', wrapTime: '19:00' }),

  // D. Travel Day
  mk('D01', 'Travel Day 09:00-14:00 (5h)', {}, { dayType: 'Travel Day', callTime: '09:00', wrapTime: '14:00', lunchDurationMins: 0 }),
  mk('D02', 'Travel Day long 06:00-18:00', {}, { dayType: 'Travel Day', callTime: '06:00', wrapTime: '18:00' }),

  // E. Rest Day
  mk('E01', 'Rest Day (no times)', {}, { dayType: 'Rest Day', callTime: '', wrapTime: '', lunchStartTime: '', lunchDurationMins: 0 }),

  // F. Night shoots (overnight wrap)
  mk('F01', 'Night shoot call 17:00 wrap 03:00+1', {}, { callTime: '17:00', wrapTime: '03:00', wrapNextDay: true }),
  mk('F02', 'Late-late shoot call 22:00 wrap 08:00+1', {}, { callTime: '22:00', wrapTime: '08:00', wrapNextDay: true, lunchStartTime: '02:00' }),
  mk('F03', 'Night shoot call 18:00 wrap 06:00+1 with OT', {}, { callTime: '18:00', wrapTime: '06:00', wrapNextDay: true, lunchStartTime: '23:00' }),
  mk('F04', 'Night shoot Saturday', {}, { date: '2026-06-06', callTime: '20:00', wrapTime: '06:00', wrapNextDay: true, lunchStartTime: '01:00' }),

  // G. Pre-call (before/after 05:00 boundary)
  mk('G01', 'Pre-call 06:00, main call 08:00 (after 05:00)', {}, { preCallTime: '06:00', callTime: '08:00', wrapTime: '19:00' }),
  mk('G02', 'Pre-call 04:00, main call 08:00 (spans 05:00)', {}, { preCallTime: '04:00', callTime: '08:00', wrapTime: '19:00' }),
  mk('G03', 'Pre-call 03:00, main call 06:00 (all before 05:00)', {}, { preCallTime: '03:00', callTime: '06:00', wrapTime: '17:00' }),
  mk('G04', 'Pre-call slightly after main call (user-error case)', {}, { preCallTime: '09:00', callTime: '08:00', wrapTime: '19:00' }),
  mk('G05', 'Pre-call on Saturday Pre-light (Sat Pre-light fix)', {}, { dayType: 'Pre-light', date: '2026-06-06', preCallTime: '07:00', callTime: '09:00', wrapTime: '17:00' }),
  mk('G06', 'Pre-call 22:00 prior day for late night call (overnight)', {}, { preCallTime: '22:00', callTime: '06:00', wrapTime: '17:00' }),

  // H. Missed / late / second breaks
  mk('H01', 'Shoot, no meal provided', {}, { noMealProvided: true, lunchStartTime: '', lunchDurationMins: 0 }),
  mk('H02', 'Shoot, late lunch (start at 15:00)', {}, { lunchStartTime: '15:00' }),
  mk('H03', 'Shoot 14h, no 2nd break logged', {}, { wrapTime: '22:00' }),
  mk('H04', 'Shoot 14h, 2nd break 15min', {}, { wrapTime: '22:00', secondBreakDurationMins: 15, secondBreakLogged: true }),
  mk('H05', 'Shoot 14h, 2nd break 30min', {}, { wrapTime: '22:00', secondBreakDurationMins: 30, secondBreakLogged: true }),
  mk('H06', 'Night shoot no meal provided', {}, { callTime: '17:00', wrapTime: '03:00', wrapNextDay: true, noMealProvided: true, lunchStartTime: '', lunchDurationMins: 0 }),

  // I. CWD (continuous working day) breaks
  mk('I01', 'CWD shoot, both breaks given', {}, { cwdBreak1Given: true, cwdBreak2Given: true, lunchStartTime: '', lunchDurationMins: 0 }),
  mk('I02', 'CWD shoot, break1 only', {}, { cwdBreak1Given: true, cwdBreak2Given: false, lunchStartTime: '', lunchDurationMins: 0 }),
  mk('I03', 'CWD shoot, neither break', {}, { cwdBreak1Given: false, cwdBreak2Given: false, lunchStartTime: '', lunchDurationMins: 0 }),

  // J. Weekend rates
  mk('J01', 'Sat shoot 08:00-19:00', {}, { date: '2026-06-06' }),
  mk('J02', 'Sun shoot 08:00-19:00', {}, { date: '2026-06-07' }),
  mk('J03', 'Sat shoot with OT 08:00-22:00', {}, { date: '2026-06-06', wrapTime: '22:00' }),
  mk('J04', 'Sun shoot with OT 08:00-22:00', {}, { date: '2026-06-07', wrapTime: '22:00' }),
  mk('J05', 'Sat shoot 11-hr-day override', {}, { date: '2026-06-06' }, { isElevenHourDay: true }),
  mk('J06', 'Sun shoot APA rounding on', {}, { date: '2026-06-07' }, { apaRounding: true }),

  // K. Bank holidays (UK England & Wales)
  mk('K01', "New Year's Day 2026 (Thu Jan 1)", {}, { date: '2026-01-01' }),
  mk('K02', 'Good Friday 2026 (Apr 3)', {}, { date: '2026-04-03' }),
  mk('K03', 'Easter Monday 2026 (Apr 6)', {}, { date: '2026-04-06' }),
  mk('K04', 'Christmas Day 2026 (Fri Dec 25)', {}, { date: '2026-12-25' }),
  mk('K05', 'Bank holiday + OT', {}, { date: '2026-04-06', wrapTime: '22:00' }),

  // L. Mileage / kit money / per diem / expenses
  mk('L01', 'Shoot + 30 miles', {}, { miles: 30 }),
  mk('L02', 'Shoot + per diem £30', {}, { perDiemAmount: 30 }),
  mk('L03', 'Shoot + kit money £40 (day-level)', { kitMoneyEnabled: true, kitMoneyAmount: 40 }, { kitMoneyAmount: 40 }),
  mk('L04', 'Shoot + expenses (2 items)', {}, { expenses: [{ category: 'Parking', description: 'NCP', amount: 12 }, { category: 'Materials', description: 'Gels', amount: 8.50 }] }),
  mk('L05', 'Shoot + all extras', { kitMoneyEnabled: true, kitMoneyAmount: 40 }, { miles: 25, perDiemAmount: 30, kitMoneyAmount: 40, expenses: [{ category: 'Parking', description: 'NCP', amount: 12 }] }),
  mk('L06', 'Shoot + mileage round-trip', {}, { miles: 30, mileageRoundTrip: true }),
  // Expenses rework — NEW-shape entries exercise augmentCalc's new reading path.
  // L07 mirrors L02's per-diem output via a preset instance (presetId per-diem);
  // L08 exercises a custom (presetId:null, name) + a non-per-diem preset instance.
  mk('L07', 'Shoot + per-diem PRESET INSTANCE £30 (new shape — matches L02)', {}, { perDiemAmount: 0, expenses: [{ id: 'pd1', presetId: 'builtin-perdiem', name: 'Per Diem', amount: 30, detail: '' }] }),
  mk('L08', 'Shoot + new-shape expenses (custom + congestion preset)', {}, { expenses: [{ id: 'x1', presetId: null, name: 'Parking', amount: 12, detail: 'NCP' }, { id: 'x2', presetId: 'builtin-congestion', name: 'Congestion Charge', amount: 18, detail: '' }] }),
  // Cascade REMOVED (strictly per-day): an empty day.expenses + a populated
  // dayDefaults[date] must NOT inherit any more — calcForDisplay shows base only,
  // and source==built agree (the materialisation happens in MIGRATIONS[4], proven
  // by the EX-suite, not by resolveDay at calc time).
  mk('L09', 'Cascade removed — empty day.expenses + dayDefaults set → no inheritance', {}, { expenses: [] }, { dayDefaults: { '2026-06-01': { expenses: [{ category: 'Parking', description: 'NCP', amount: 12 }], perDiemAmount: 25 } } }),

  // M. Step-up
  mk('M01', 'Spark stepping up to Gaffer (higher BDR)', {}, { stepUpRole: 'Gaffer', stepUpBDR: 600, stepUpOTCoef: 1.5 }),
  mk('M02', 'Step-up with OT', {}, { stepUpRole: 'Gaffer', stepUpBDR: 600, stepUpOTCoef: 1.5, wrapTime: '22:00' }),

  // N. PMPA roles
  mk('N01', 'PMPA Floor Runner shoot 11h', { role: 'Floor Runner / AD Trainee', pmpa: true, bdr: 200 }),
  mk('N02', 'PMPA Production Manager prep day', { role: 'Production Manager', pmpa: true, bdr: 300 }, { dayType: 'Prep Day', callTime: '09:00', wrapTime: '17:00' }),
  mk('N03', 'PMPA night shoot', { role: 'Production Runner', pmpa: true, bdr: 200 }, { callTime: '17:00', wrapTime: '03:00', wrapNextDay: true }),
  mk('N04', 'PMPA Saturday shoot', { role: 'Production Assistant', pmpa: true, bdr: 250 }, { date: '2026-06-06' }),
  mk('N05', 'PMPA with kit money + per diem', { role: 'Floor Runner / AD Trainee', pmpa: true, bdr: 200, kitMoneyEnabled: true, kitMoneyAmount: 30 }, { perDiemAmount: 25, kitMoneyAmount: 30 }),
  mk('N06', 'PMPA long shoot 14h', { role: 'Floor Runner / AD Trainee', pmpa: true, bdr: 200 }, { wrapTime: '22:00' }),

  // O. TOC (rest violations using prevDay)
  mk('O01', '9h rest (TOC ~2h)', {},
    { callTime: '08:00', wrapTime: '19:00' },
    {},
    { date: '2026-05-31', callTime: '08:00', wrapTime: '23:00' }),
  mk('O02', '7h rest (BREACH + TOC)', {},
    { callTime: '06:00', wrapTime: '17:00' },
    {},
    { date: '2026-05-31', callTime: '08:00', wrapTime: '23:00' }),
  mk('O03', '13h rest (no TOC)', {},
    { callTime: '08:00', wrapTime: '19:00' },
    {},
    { date: '2026-05-31', callTime: '08:00', wrapTime: '19:00' }),
  mk('O04', 'Overnight prev wrap, today TOC',
    {},
    { callTime: '12:00', wrapTime: '23:00' },
    {},
    { date: '2026-05-31', callTime: '15:00', wrapTime: '03:00', wrapNextDay: true }),

  // P. noOT roles
  mk('P01', 'Director (noOT) on 14h shoot', { role: 'Director', noOT: true, bdr: 800 }, { wrapTime: '22:00' }),
  mk('P02', 'Producer (noOT) on Saturday', { role: 'Producer', noOT: true, bdr: 800 }, { date: '2026-06-06' }),

  // Q. BWD-override roles (always pay as Shoot on non-Shoot days)
  mk('Q01', 'DoP on Prep Day', { role: 'DoP', bdr: 700 }, { dayType: 'Prep Day', callTime: '08:00', wrapTime: '19:00' }),
  mk('Q02', 'DoP on Recce', { role: 'DoP', bdr: 700 }, { dayType: 'Recce', callTime: '08:00', wrapTime: '19:00' }),
  mk('Q03', 'Art Director on Build Day', { role: 'Art Director', bdr: 550 }, { dayType: 'Build Day', callTime: '08:00', wrapTime: '19:00' }),
  mk('Q04', 'Location Manager on De-rig', { role: 'Location Manager', bdr: 550 }, { dayType: 'De-rig', callTime: '08:00', wrapTime: '19:00' }),

  // R. Edge cases
  mk('R01', 'Zero BDR', { bdr: 0 }),
  mk('R02', 'Wrap == call (zero hours, odd)', {}, { callTime: '08:00', wrapTime: '08:00' }),
  mk('R03', 'Lunch duration 0', {}, { lunchDurationMins: 0 }),
  mk('R04', 'APA rounding on', {}, {}, { apaRounding: true }),
  mk('R05', 'Favourable rounding on', {}, {}, { favourableRounding: true }),
  mk('R06', 'Both roundings on, Sat shoot with OT', {}, { date: '2026-06-06', wrapTime: '22:00' }, { apaRounding: true, favourableRounding: true }),
  mk('R07', 'OT coefficient 1.25 (junior bracket)', { otCoef: 1.25 }, { wrapTime: '22:00' }),
  mk('R08', 'Fixed otRate override (£75/h)', { otRate: 75 }, { wrapTime: '22:00' }),

  // S. Boundary regression probes (fix/calc-audit) — cases that sit ON an
  //    exact rule boundary reached from 5/10-minute-grid times, where pre-fix
  //    FP noise tipped the calc a full increment (phantom 30m OT / phantom £10
  //    late lunch / phantom CWD conversion). Parity probes only — the
  //    expected-£ pins for these live in calc-boundary-assertions.js.
  mk('S01', 'OT exactly 1.0h from 10-min grid (08:10-20:10)', {}, { callTime: '08:10', wrapTime: '20:10', lunchStartTime: '11:10', secondBreakStartTime: '17:00', secondBreakDurationMins: 30 }),
  mk('S02', 'OT exactly 0.5h from 10-min grid (08:10-19:40)', {}, { callTime: '08:10', wrapTime: '19:40', lunchStartTime: '13:10' }),
  mk('S03', 'Lunch exactly at +5:30 (07:05 call, 12:35 lunch)', {}, { callTime: '07:05', wrapTime: '18:05', lunchStartTime: '12:35' }),
  mk('S04', 'Lunch exactly at +6:30 (07:05 call, 13:35 lunch)', {}, { callTime: '07:05', wrapTime: '19:05', lunchStartTime: '13:35' }),
  mk('S05', 'Real 1h01m OT still rounds up (08:10-20:11)', {}, { callTime: '08:10', wrapTime: '20:11', lunchStartTime: '11:10', secondBreakStartTime: '17:00', secondBreakDurationMins: 30 }),
  mk('S06', 'Curtailed lunch, wrap exactly at shifted OT threshold (18:30)', {}, { wrapTime: '18:30', lunchDurationMins: 30 }),
  mk('S07', 'TOC rest exactly 11h (prev wrap 21:10, call 08:10)', {}, { callTime: '08:10', wrapTime: '19:10' }, {}, { date: '2026-05-31', callTime: '08:00', wrapTime: '21:10' }),
  mk('S08', 'Sunday curtailed lunch 30m (hourly pay, no top-up)', {}, { date: '2026-06-07', lunchDurationMins: 30 }),
  mk('S09', 'Night shoot curtailed lunch 30m (hourly pay, no top-up)', {}, { callTime: '20:00', wrapTime: '07:00', wrapNextDay: true, lunchStartTime: '01:00', lunchDurationMins: 30 }),
  mk('S10', 'Saturday curtailed lunch 30m no-OT (flat pay, top-up kept)', {}, { date: '2026-06-06', wrapTime: '18:00', lunchDurationMins: 30 }),
  mk('S11', 'Sunday crossing midnight inside basic day (no OT, no triple)', {}, { date: '2026-06-07', callTime: '16:30', wrapTime: '03:30', wrapNextDay: true, lunchStartTime: '21:00' }),
  mk('S12', 'Sunday min-10h crossing midnight (floor tops up at 2x)', {}, { date: '2026-06-07', callTime: '15:00', wrapTime: '01:30', wrapNextDay: true, lunchStartTime: '19:00' }),
  mk('S13', 'Sunday genuine OT past midnight (1h triple)', {}, { date: '2026-06-07', callTime: '08:00', wrapTime: '01:00', wrapNextDay: true, secondBreakStartTime: '18:00', secondBreakDurationMins: 30 }),
  // B1 (§2.2.2/§2.2.5): weekday continuous nights = 2×BDR + OT after 9h at 2×BHR.
  mk('S14', 'Weekday continuous night 12h (2xBDR + 3h OT@2xBHR)', {}, { callTime: '22:00', wrapTime: '10:00', wrapNextDay: true, lunchStartTime: '', lunchDurationMins: 0, cwdBreak1Given: true, cwdBreak2Given: true }),
  mk('S15', "PDF §2.2.2 example (1st AD £785: structure £1,570+£157, +A4 night charge)", { role: '1st AD', bdr: 785, otCoef: 1.0 }, { callTime: '03:00', wrapTime: '13:00', lunchStartTime: '', lunchDurationMins: 0, cwdBreak1Given: true, cwdBreak2Given: true }),
  mk('S16', 'BASIC night 12h with lunch stays flat (no-regression)', {}, { callTime: '20:00', wrapTime: '08:00', wrapNextDay: true, lunchStartTime: '01:00', secondBreakStartTime: '07:00', secondBreakDurationMins: 30 }),
  mk('S17', 'Saturday continuous night stays flat per §2.4(iii)', {}, { date: '2026-06-06', callTime: '22:00', wrapTime: '10:00', wrapNextDay: true, lunchStartTime: '', lunchDurationMins: 0, cwdBreak1Given: true, cwdBreak2Given: true }),
  // §2.4(vi): Sunday/BH continuous day = 2×BDR + OT after 9h at 2×BHR.
  mk('S18', 'Sunday continuous day 12h (2xBDR + 3h OT@2xBHR)', {}, { date: '2026-06-07', callTime: '08:00', wrapTime: '20:00', lunchStartTime: '', lunchDurationMins: 0, cwdBreak1Given: true, cwdBreak2Given: true }),
  // A4 (§6.2/§6.3 night rows): missed 1st break on a night charges 1h at the
  // ruled 2×BHR; very-late (taken) converts without the charge.
  mk('S19', 'Saturday night missed 1st break (flat + 1h night charge)', {}, { date: '2026-06-06', callTime: '20:00', wrapTime: '08:00', wrapNextDay: true, lunchStartTime: '', lunchDurationMins: 0, cwdBreak1Given: true, cwdBreak2Given: true }),
  mk('S20', 'Weekday night very-late lunch (converts, no missed charge)', {}, { callTime: '20:00', wrapTime: '08:00', wrapNextDay: true, lunchStartTime: '03:00', cwdBreak1Given: true, cwdBreak2Given: true }),
  // B2 (§2.1.3 "all days throughout a week"): Saturday early-call premium.
  mk('S21', 'Saturday 06:00 early call (1h premium at 1.5xBHR)', {}, { date: '2026-06-06', callTime: '06:00', wrapTime: '17:00', lunchStartTime: '11:00' }),
  mk('S22', 'Saturday 07:00 call — no premium (boundary)', {}, { date: '2026-06-06', callTime: '07:00', wrapTime: '18:00', lunchStartTime: '12:00' }),
  mk('S23', 'Saturday 06:00 early call + CWD (premium + OT after 9h)', {}, { date: '2026-06-06', callTime: '06:00', wrapTime: '17:00', lunchStartTime: '', lunchDurationMins: 0, cwdBreak1Given: true, cwdBreak2Given: true }),
];

module.exports = { scenarios };
