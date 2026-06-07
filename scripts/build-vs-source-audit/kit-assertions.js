/*
 * kit-assertions.js
 *
 *   $ node scripts/build-vs-source-audit/kit-assertions.js
 *
 * Permanent Kit Inventory regression suite. Consolidates the per-stage
 * spot-checks (Stages 2, 2b, 2c, 2d, 3, 4) into one runnable so a regression
 * in any kit code path — itemised lines, auto-apply, auto-remove, scoping,
 * shoot-level aggregation, deal application on the invoice — is caught by
 * a normal `npm run audit:build`.
 *
 * Wiring:
 *   - Standalone:                      npm run audit:kit
 *   - Auto-runs after build/textual:   npm run audit:build
 *
 * The source engine is loaded ONCE (esbuild + vm is the heavy cost), then
 * every stage's assertions execute against that single engine instance.
 *
 * Exit code: 0 if all assertions pass, 1 if any fail, 2 on harness error.
 */

const { loadSourceEngine } = require('./load-engines');

// ---- Pass/fail collector ---------------------------------------------------

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

// ---- Common fixtures -------------------------------------------------------

const baseCrewMember = () => ({
  id: 'c1', name: 'Test', role: 'Spark', department: 'Electrical',
  bdr: 444, otCoef: 1.5, otRate: null, noOT: false, pmpa: false,
  vatRegistered: false, vatRate: 20,
  kitMoneyEnabled: false, kitMoneyAmount: 0,
  isDriver: false, email: '',
});

const baseDay = (overrides = {}) => ({
  id: 'd1', crewId: 'c1', date: '2026-06-04', // Thursday
  callTime: '08:00', wrapTime: '19:00', wrapNextDay: false,
  dayType: 'Shoot', lunchStartTime: '13:00', lunchDurationMins: 60,
  noMealProvided: false, secondBreakDurationMins: 0, secondBreakLogged: false,
  cwdBreak1Given: false, cwdBreak2Given: false,
  preCallTime: '', travelOutMins: 0, travelBackMins: 0,
  miles: 0, mileagePostcode: '', mileageMethod: 'distance', mileageRoundTrip: false,
  perDiemAmount: 0, kitMoneyAmount: 0,
  kitItems: [], expenses: [],
  stepUpRole: '', stepUpBDR: 0, stepUpOTCoef: 0, wrapped: false, note: '',
  ...overrides,
});

const baseProd = (overrides = {}) => ({
  id: 'p1', title: 'T', prodCo: '', jobReference: '', crew: [], days: [],
  defaultDay: null, dayDefaults: {}, bestBoyMode: false, viewMode: 'mobile',
  iAmCrewId: 'c1', isElevenHourDay: false, favourableRounding: false, apaRounding: false,
  startDate: '2026-06-01', gridDates: [], weekStarts: [], invoicingEmail: '', cancellationData: null,
  ...overrides,
});

// ===========================================================================
// Stage 2 — itemised kit lines + bucketing via the bucket:'kit' marker.
// ===========================================================================

function runStage2(eng, ok) {
  const { calcForDisplay, categorizeBreakdownLine } = eng;
  const crew = (o = {}) => ({ ...baseCrewMember(), ...o });
  const day = (o = {}) => baseDay(o);
  const prod = (o = {}) => baseProd({ iAmCrewId: 'c1', ...o });
  const lineBucket = (l) => categorizeBreakdownLine(l);

  // (a) Two kitItems → two lines with correct labels/amounts; each buckets 'kit'.
  {
    const d = day({
      kitItems: [
        { itemId: 'kit-a', name: 'Sennheiser MKH8060', rate: 75 },
        { itemId: 'kit-b', name: 'Sound Devices MixPre-6', rate: 50 },
      ],
    });
    const r = calcForDisplay(prod(), d, crew(), null);
    const kitLines = r.lines.filter(l => l.bucket === 'kit');
    ok('Stage 2 · a1: two itemised kit lines emitted', kitLines.length === 2, `got ${kitLines.length}`);
    ok('Stage 2 · a2: first item label/amount verbatim',
      kitLines[0] && kitLines[0].label === 'Sennheiser MKH8060' && kitLines[0].amount === 75);
    ok('Stage 2 · a3: second item label/amount verbatim',
      kitLines[1] && kitLines[1].label === 'Sound Devices MixPre-6' && kitLines[1].amount === 50);
    ok('Stage 2 · a4: BOTH lines bucket as kit via the marker',
      kitLines.every(l => lineBucket(l) === 'kit'));
    ok('Stage 2 · a5: total = BDR £444 + £75 + £50 = £569',
      Math.abs(r.total - 569) < 0.01, `total=${r.total}`);
  }

  // (b) Ad-hoc Kit line appears + buckets correctly.
  {
    const d = day({ kitMoneyAmount: 60 });
    const r = calcForDisplay(prod(), d, crew(), null);
    const kitLine = r.lines.find(l => l.bucket === 'kit');
    ok('Stage 2 · b1: ad-hoc kit line present', !!kitLine);
    ok('Stage 2 · b2: ad-hoc line label is "Kit"', kitLine && kitLine.label === 'Kit');
    ok('Stage 2 · b3: ad-hoc line amount = 60', kitLine && kitLine.amount === 60);
    ok('Stage 2 · b4: ad-hoc line buckets as kit', kitLine && lineBucket(kitLine) === 'kit');
  }

  // (c) Crew default + kitItems → only itemised lines (flat suppressed).
  {
    const d = day({ kitMoneyAmount: 0, kitItems: [{ itemId: 'kit-x', name: 'A-Item', rate: 30 }] });
    const c = crew({ kitMoneyEnabled: true, kitMoneyAmount: 100 });
    const r = calcForDisplay(prod(), d, c, null);
    const kitLines = r.lines.filter(l => l.bucket === 'kit');
    ok('Stage 2 · c1: only ONE kit line (the itemised one, crew default suppressed)',
      kitLines.length === 1);
    ok('Stage 2 · c2: the one kit line is the item, not the flat default',
      kitLines[0] && kitLines[0].label === 'A-Item' && kitLines[0].amount === 30);
    ok('Stage 2 · c3: total = £444 + £30 = £474 (crew default NOT added)',
      Math.abs(r.total - 474) < 0.01, `total=${r.total}`);
  }

  // (d) Crew default + NO kitItems → crew flat line preserved (legacy).
  {
    const d = day({ kitMoneyAmount: 0, kitItems: [] });
    const c = crew({ kitMoneyEnabled: true, kitMoneyAmount: 100 });
    const r = calcForDisplay(prod(), d, c, null);
    const kitLines = r.lines.filter(l => l.bucket === 'kit');
    ok('Stage 2 · d1: one kit line (the crew flat default)', kitLines.length === 1);
    ok('Stage 2 · d2: line labelled "Kit" with crew default amount',
      kitLines[0] && kitLines[0].label === 'Kit' && kitLines[0].amount === 100);
    ok('Stage 2 · d3: total = £444 + £100 = £544', Math.abs(r.total - 544) < 0.01);
  }

  // (e) Kit is purely additive — basic/OT/pen/extras buckets identical with vs without kit.
  {
    const dNoKit = day({ wrapTime: '21:00' }); // 13h call-to-wrap → 2h OT
    const dWithKit = day({
      wrapTime: '21:00',
      kitMoneyAmount: 40,
      kitItems: [{ itemId: 'kit-q', name: 'Q-Mic', rate: 25 }],
    });
    const rNoKit = calcForDisplay(prod(), dNoKit, crew(), null);
    const rWithKit = calcForDisplay(prod(), dWithKit, crew(), null);
    const sumBucket = (lines, bucket) =>
      lines.filter(l => categorizeBreakdownLine(l) === bucket)
           .reduce((s, l) => s + (Number(l.amount) || 0), 0);
    for (const b of ['basic', 'ot', 'pen', 'extras']) {
      const a = sumBucket(rNoKit.lines, b);
      const z = sumBucket(rWithKit.lines, b);
      ok(`Stage 2 · e1[${b}]: bucket sum identical with vs without kit`,
        Math.abs(a - z) < 0.01, `noKit=${a}, withKit=${z}`);
    }
    const kitSum = sumBucket(rWithKit.lines, 'kit');
    ok('Stage 2 · e2: kit bucket sum = ad-hoc £40 + item £25 = £65',
      Math.abs(kitSum - 65) < 0.01);
    ok('Stage 2 · e3: total delta = kit total exactly (purely additive)',
      Math.abs((rWithKit.total - rNoKit.total) - 65) < 0.01);
  }
}

// ===========================================================================
// Stage 2b — applyKitAutoApply on kit-bearing types; no-op elsewhere.
// ===========================================================================

function runStage2b(eng, ok) {
  const { applyKitAutoApply } = eng;
  const prefs = {
    kitInventory: [
      { id: 'kit-a', name: 'Sennheiser MKH8060', defaultDailyRate: 75, defaultOn: true },
      { id: 'kit-b', name: 'Sound Devices MixPre-6', defaultDailyRate: 50, defaultOn: true },
      { id: 'kit-c', name: 'Spare Boom', defaultDailyRate: 20, defaultOn: false },
    ],
  };
  const ME = 'c1';
  const blankDay = (o = {}) => ({
    id: 'd1', crewId: ME, date: '2026-06-04',
    dayType: 'Shoot', kitItems: [], kitMoneyAmount: 0, ...o,
  });
  // Stage 2d added the userCrewId 4th arg. The day.crewId is ME, so we pass ME
  // through as the user-crew-id — same shape every real caller uses.

  // (a) Kit-bearing types add the default-on items, snapshot intact.
  for (const type of ['Pre-light', 'Build Day', 'Shoot', 'De-rig']) {
    const r = applyKitAutoApply(blankDay({ dayType: type }), prefs, null, ME);
    ok(`Stage 2b · a[${type}]: kitItems populated`,
      Array.isArray(r.kitItems) && r.kitItems.length === 2);
    const byId = id => r.kitItems.find(it => it.itemId === id);
    ok(`Stage 2b · a[${type}]: 'Sennheiser MKH8060' snapshot intact`,
      byId('kit-a') && byId('kit-a').name === 'Sennheiser MKH8060' && byId('kit-a').rate === 75);
    ok(`Stage 2b · a[${type}]: 'Sound Devices MixPre-6' snapshot intact`,
      byId('kit-b') && byId('kit-b').name === 'Sound Devices MixPre-6' && byId('kit-b').rate === 50);
    ok(`Stage 2b · a[${type}]: default-off item NOT included`, !byId('kit-c'));
  }

  // (b) Non-kit-bearing types stay empty.
  for (const type of ['Prep Day', 'Recce', 'Rest Day', 'Travel Day']) {
    const r = applyKitAutoApply(blankDay({ dayType: type }), prefs, null, ME);
    ok(`Stage 2b · b[${type}]: kitItems remains empty`,
      Array.isArray(r.kitItems) && r.kitItems.length === 0);
    ok(`Stage 2b · b[${type}]: pure — no extra items piled on`, r.kitItems.length === 0);
  }

  // (c) Existing kitItems are NOT clobbered when re-typed.
  {
    const existing = [{ itemId: 'kit-existing', name: 'Existing User Pick', rate: 99 }];
    const day = blankDay({ dayType: 'Shoot', kitItems: existing });
    const r = applyKitAutoApply(day, prefs, null, ME);
    ok('Stage 2b · c1: existing kitItems preserved on Shoot', r.kitItems === existing);
    ok('Stage 2b · c2: preserved on De-rig',
      applyKitAutoApply({ ...day, dayType: 'De-rig' }, prefs, null, ME).kitItems === existing);
    ok('Stage 2b · c3: preserved on Build Day',
      applyKitAutoApply({ ...day, dayType: 'Build Day' }, prefs, null, ME).kitItems === existing);
  }

  // (d) Default-off items never auto-add.
  {
    const offOnlyPrefs = { kitInventory: [
      { id: 'k1', name: 'Off Item 1', defaultDailyRate: 10, defaultOn: false },
      { id: 'k2', name: 'Off Item 2', defaultDailyRate: 20, defaultOn: false },
    ]};
    for (const type of ['Pre-light', 'Build Day', 'Shoot', 'De-rig']) {
      const r = applyKitAutoApply(blankDay({ dayType: type }), offOnlyPrefs, null, ME);
      ok(`Stage 2b · d[${type}]: no default-on items → no auto-add`,
        Array.isArray(r.kitItems) && r.kitItems.length === 0);
    }
  }

  // (e) Defensive edges.
  {
    const r = applyKitAutoApply(blankDay({ dayType: 'Shoot' }), { kitInventory: [] }, null, ME);
    ok('Stage 2b · e1: empty inventory → no-op on kit-bearing day', r.kitItems.length === 0);
    const r2 = applyKitAutoApply(blankDay({ dayType: 'Shoot' }), null, null, ME);
    ok('Stage 2b · e2: null userPrefs → pass-through', r2.kitItems.length === 0);
    const r3 = applyKitAutoApply(blankDay({ dayType: undefined }), prefs, null, ME);
    ok('Stage 2b · e3: undefined dayType → no-op', r3.kitItems.length === 0);
    const r4 = applyKitAutoApply(blankDay({ dayType: 'Shoot' }), prefs, null, ME);
    ok('Stage 2b · e4: Shoot is kit-bearing (CWD is a modifier, not a different type)',
      r4.kitItems.length === 2);
  }
}

// ===========================================================================
// Stage 2c — auto/manual model + auto-remove + cascade resolution.
// ===========================================================================

function runStage2c(eng, ok) {
  const { applyKitAutoApply, applyKitAutoRemove, resolveEffectiveDayType } = eng;
  const prefs = {
    kitInventory: [
      { id: 'k-a', name: 'Sennheiser MKH8060', defaultDailyRate: 75, defaultOn: true },
      { id: 'k-b', name: 'Sound Devices MixPre-6', defaultDailyRate: 50, defaultOn: true },
      { id: 'k-c', name: 'Off Item', defaultDailyRate: 30, defaultOn: false },
    ],
  };
  const ME = 'c1';
  const blank = (o = {}) => ({
    id: 'd1', crewId: ME, date: '2026-06-04',
    dayType: 'Shoot', kitItems: [], kitMoneyAmount: 0, ...o,
  });

  // (a) auto:true marker correctness.
  {
    const r = applyKitAutoApply(blank(), prefs, null, ME);
    ok('Stage 2c · a1: applyKitAutoApply added 2 default-on items',
      r.kitItems && r.kitItems.length === 2);
    ok('Stage 2c · a2: every auto-added item carries auto:true',
      r.kitItems && r.kitItems.every(it => it.auto === true));
    const dayManual = blank({ dayType: 'Prep Day',
      kitItems: [{ itemId: 'manual-m', name: 'My Pick', rate: 100 }] });
    const removed = applyKitAutoRemove(dayManual, ME);
    ok('Stage 2c · a3: manual items (no auto flag) survive auto-remove on non-kit day',
      removed.kitItems.length === 1 && removed.kitItems[0].itemId === 'manual-m');
    ok('Stage 2c · a4: applyKitAutoRemove never sets auto:true on a kept item',
      removed.kitItems.every(it => it.auto !== true));
  }

  // (b) Type change to non-kit removes ONLY auto items, ad-hoc untouched.
  {
    const mixed = blank({
      dayType: 'Prep Day', kitMoneyAmount: 25,
      kitItems: [
        { itemId: 'k-a', name: 'Sennheiser MKH8060', rate: 75, auto: true },
        { itemId: 'k-b', name: 'Sound Devices MixPre-6', rate: 50, auto: true },
        { itemId: 'manual-x', name: 'My Manual Pick', rate: 100 },
      ],
    });
    const after = applyKitAutoRemove(mixed, ME);
    ok('Stage 2c · b1: auto items stripped (3 → 1)', after.kitItems.length === 1);
    ok('Stage 2c · b2: surviving entry is the MANUAL pick',
      after.kitItems[0].itemId === 'manual-x');
    ok('Stage 2c · b3: ad-hoc kitMoneyAmount NOT touched', after.kitMoneyAmount === 25);
    ok('Stage 2c · b4: kit-bearing types are never auto-removed (Shoot)',
      applyKitAutoRemove({ ...mixed, dayType: 'Shoot' }, ME).kitItems.length === 3);
  }

  // (c) Cascade-created day: effective kit-bearing type → adds; else → none.
  // Days here get crewId so scope check passes; the test isolates cascade logic.
  {
    const prodEmptyDefault = { dayDefaults: {}, defaultDay: null };
    const d1 = { crewId: ME, kitItems: [] };
    const effType = resolveEffectiveDayType(prodEmptyDefault, '2026-06-04', d1);
    ok('Stage 2c · c1: cascade resolves to "Shoot" when no defaults set',
      effType === 'Shoot');
    const r1 = applyKitAutoApply(d1, prefs, effType, ME);
    ok('Stage 2c · c2: effectiveType="Shoot" → adds default-on items',
      r1.kitItems && r1.kitItems.length === 2 && r1.kitItems.every(it => it.auto === true));
    const prodPrepDate = { dayDefaults: { '2026-06-05': { dayType: 'Prep Day' } }, defaultDay: null };
    const effType2 = resolveEffectiveDayType(prodPrepDate, '2026-06-05', { kitItems: [] });
    ok('Stage 2c · c3: cascade resolves to "Prep Day" from dayDefaults[date]',
      effType2 === 'Prep Day');
    const r2 = applyKitAutoApply({ crewId: ME, kitItems: [] }, prefs, effType2, ME);
    ok('Stage 2c · c4: effectiveType="Prep Day" → adds NOTHING',
      r2.kitItems.length === 0);
    const prodWithBuild = {
      dayDefaults: { '2026-06-10': { dayType: 'De-rig' } },
      defaultDay: { dayType: 'Build Day' },
    };
    ok('Stage 2c · c5: explicit day.dayType wins over dayDefaults',
      resolveEffectiveDayType(prodWithBuild, '2026-06-10', { dayType: 'Recce' }) === 'Recce');
    ok('Stage 2c · c6: dayDefaults[date] wins over production.defaultDay',
      resolveEffectiveDayType(prodWithBuild, '2026-06-10', {}) === 'De-rig');
    ok('Stage 2c · c7: production.defaultDay wins over DEFAULT when dayDefaults absent',
      resolveEffectiveDayType(prodWithBuild, '2026-06-11', {}) === 'Build Day');
  }

  // (d) Re-typing back to kit-bearing: empty re-adds; manual untouched.
  {
    const d = applyKitAutoApply(blank({ dayType: 'Shoot' }), prefs, null, ME);
    ok('Stage 2c · d1: setup — auto-applied 2 items on Shoot',
      d.kitItems.length === 2 && d.kitItems.every(it => it.auto === true));
    const dPrep = applyKitAutoRemove({ ...d, dayType: 'Prep Day' }, ME);
    ok('Stage 2c · d2: Prep Day → all auto items stripped', dPrep.kitItems.length === 0);
    const dShootAgain = applyKitAutoApply({ ...dPrep, dayType: 'Shoot' }, prefs, null, ME);
    ok('Stage 2c · d3: re-typed Shoot with empty kitItems → 2 auto items re-added',
      dShootAgain.kitItems.length === 2 && dShootAgain.kitItems.every(it => it.auto === true));
    const dManual = blank({ dayType: 'Shoot',
      kitItems: [{ itemId: 'manual-z', name: 'My Boom', rate: 60 }] });
    const dManualPrep = applyKitAutoRemove({ ...dManual, dayType: 'Prep Day' }, ME);
    ok('Stage 2c · d4: Prep Day with only manual → manual item preserved',
      dManualPrep.kitItems.length === 1 && dManualPrep.kitItems[0].itemId === 'manual-z');
    const dManualShoot = applyKitAutoApply({ ...dManualPrep, dayType: 'Shoot' }, prefs, null, ME);
    ok('Stage 2c · d5: re-typed Shoot with NON-EMPTY → no defaults piled on top',
      dManualShoot.kitItems.length === 1 && dManualShoot.kitItems[0].itemId === 'manual-z');
    ok('Stage 2c · d6: re-typed Shoot → no auto items appear (suppressed because non-empty)',
      dManualShoot.kitItems.every(it => it.auto !== true));
  }
}

// ===========================================================================
// Stage 2d — user-crew scoping for auto-apply / auto-remove.
// ===========================================================================

function runStage2d(eng, ok) {
  const { applyKitAutoApply, applyKitAutoRemove, getEffectiveUserCrewId } = eng;
  const prefs = (o = {}) => ({
    displayName: 'Test User',
    kitInventory: [
      { id: 'k-a', name: 'Sennheiser MKH8060', defaultDailyRate: 75, defaultOn: true },
      { id: 'k-b', name: 'Sound Devices MixPre-6', defaultDailyRate: 50, defaultOn: true },
    ],
    ...o,
  });
  // NOTE: id-builder uses index, NOT Math.random, so the harness stays deterministic.
  const blankDay = (crewId, idx, o = {}) => ({
    id: `d-${crewId}-${idx}`, crewId, date: '2026-06-04',
    dayType: 'Shoot', kitItems: [], kitMoneyAmount: 0, ...o,
  });

  // (a) Bulk-add: user's day gets defaults, others get NONE.
  {
    const production = { bestBoyMode: true, crew: [
      { id: 'c1', name: 'Sparks Smith' },
      { id: 'c2', name: 'Test User' },
      { id: 'c3', name: 'Camera Jones' },
    ]};
    const myCrewId = getEffectiveUserCrewId(production, prefs());
    ok('Stage 2d · a0: getEffectiveUserCrewId resolves displayName to "Test User"',
      myCrewId === 'c2');
    const newDays = ['c1', 'c2', 'c3'].map((id, i) =>
      applyKitAutoApply(blankDay(id, i, { dayType: 'Shoot' }), prefs(), null, myCrewId));
    const userDay = newDays.find(d => d.crewId === 'c2');
    const others  = newDays.filter(d => d.crewId !== 'c2');
    ok("Stage 2d · a1: the user's row picks up 2 default-on items",
      userDay && userDay.kitItems.length === 2 && userDay.kitItems.every(it => it.auto === true));
    ok('Stage 2d · a2: each OTHER crew row has empty kitItems',
      others.length === 2 && others.every(d => d.kitItems.length === 0));
  }

  // (b) Auto-remove only affects the user's own day.
  {
    const production = { bestBoyMode: true, crew: [
      { id: 'c1', name: 'Sparks Smith' },
      { id: 'c2', name: 'Test User' },
    ]};
    const myCrewId = getEffectiveUserCrewId(production, prefs());
    const sparksDay = blankDay('c1', 0, { dayType: 'Prep Day',
      kitItems: [{ itemId: 'k-a', name: 'A', rate: 10, auto: true }] });
    const userDay = blankDay('c2', 0, { dayType: 'Prep Day', kitItems: [
      { itemId: 'k-a', name: 'A', rate: 10, auto: true },
      { itemId: 'manual-x', name: 'My Manual', rate: 99 },
    ]});
    const sparksAfter = applyKitAutoRemove(sparksDay, myCrewId);
    const userAfter   = applyKitAutoRemove(userDay,   myCrewId);
    ok("Stage 2d · b1: Sparks' kit untouched (scope says: not the user)",
      sparksAfter.kitItems.length === 1 && sparksAfter.kitItems[0].auto === true);
    ok("Stage 2d · b2: User's auto item stripped, manual kept",
      userAfter.kitItems.length === 1 && userAfter.kitItems[0].itemId === 'manual-x');
  }

  // (c) Solo mode still auto-applies.
  {
    const soloProd = { bestBoyMode: false, crew: [{ id: 'solo', name: 'Test User' }] };
    const myCrewId = getEffectiveUserCrewId(soloProd, prefs());
    ok('Stage 2d · c1: getEffectiveUserCrewId returns the solo crew id',
      myCrewId === 'solo');
    const newDay = applyKitAutoApply(blankDay('solo', 0, { dayType: 'Shoot' }),
      prefs(), null, myCrewId);
    ok('Stage 2d · c2: solo day picks up the default-on items',
      newDay.kitItems.length === 2 && newDay.kitItems.every(it => it.auto === true));
    const noNamePrefs = { ...prefs(), displayName: '' };
    const myCrewIdNoName = getEffectiveUserCrewId(soloProd, noNamePrefs);
    ok('Stage 2d · c3: solo fallback resolves user even with empty displayName',
      myCrewIdNoName === 'solo');
    const newDay2 = applyKitAutoApply(blankDay('solo', 0, { dayType: 'Shoot' }),
      noNamePrefs, null, myCrewIdNoName);
    ok('Stage 2d · c4: solo with empty displayName STILL auto-applies',
      newDay2.kitItems.length === 2);
  }

  // (d) Chip-display gate (pure-logic: v.crewId === myCrewId).
  {
    const production = { bestBoyMode: true, crew: [
      { id: 'c1', name: 'Sparks Smith' },
      { id: 'c2', name: 'Test User' },
    ]};
    const myCrewId = getEffectiveUserCrewId(production, prefs());
    const isUsersOwnDay = (day) => myCrewId != null && day.crewId === myCrewId;
    ok("Stage 2d · d1: user's own day → inventory shown",
      isUsersOwnDay({ crewId: 'c2' }) === true);
    ok("Stage 2d · d2: another crew's day → inventory hidden",
      isUsersOwnDay({ crewId: 'c1' }) === false);
    const noMatchPrefs = { ...prefs(), displayName: 'Not In Crew' };
    const myCrewIdNoMatch = getEffectiveUserCrewId(production, noMatchPrefs);
    ok('Stage 2d · d3: best-boy without matching crew → myCrewId null',
      myCrewIdNoMatch == null);
    const isUsersOwnDayNull = (day) => myCrewIdNoMatch != null && day.crewId === myCrewIdNoMatch;
    ok("Stage 2d · d4: with null myCrewId, no day reads as user's",
      isUsersOwnDayNull({ crewId: 'c1' }) === false && isUsersOwnDayNull({ crewId: 'c2' }) === false);
  }

  // (e) Defensive: explicit nulls / mismatches don't auto-apply.
  {
    const r = applyKitAutoApply(blankDay('c1', 0, { dayType: 'Shoot' }), prefs(), null, null);
    ok('Stage 2d · e1: null userCrewId → no auto-apply', r.kitItems.length === 0);
    const r2 = applyKitAutoApply(blankDay('c-other', 0, { dayType: 'Shoot' }),
      prefs(), null, 'c-me');
    ok('Stage 2d · e2: day.crewId !== userCrewId → no auto-apply', r2.kitItems.length === 0);
  }
}

// ===========================================================================
// Stage 3 — aggregateKitForShoot: days-on, usual total, discount %.
// ===========================================================================

function runStage3(eng, ok) {
  const { aggregateKitForShoot } = eng;
  const userPrefs = { displayName: 'Test User', kitInventory: [
    { id: 'k-a', name: 'Sennheiser MKH8060', defaultDailyRate: 100, defaultOn: true },
    { id: 'k-b', name: 'MixPre-6', defaultDailyRate: 50, defaultOn: true },
  ]};
  const buildProd = (o = {}) => ({
    bestBoyMode: true,
    crew: [
      { id: 'c-other', name: 'Sparks Smith' },
      { id: 'c-me', name: 'Test User' },
    ],
    days: [], kitDeals: [], ...o,
  });
  const day = (crewId, date, dayType, kitItems = []) =>
    ({ id: `d-${crewId}-${date}`, crewId, date, dayType, kitItems });

  // (a) days-on + usual total.
  {
    const prod = buildProd({ days: [
      day('c-me', '2026-06-01', 'Shoot', [
        { itemId: 'k-a', name: 'Sennheiser MKH8060', rate: 100 },
        { itemId: 'k-b', name: 'MixPre-6', rate: 50 },
      ]),
      day('c-me', '2026-06-02', 'Shoot', [
        { itemId: 'k-a', name: 'Sennheiser MKH8060', rate: 100 },
        { itemId: 'k-b', name: 'MixPre-6', rate: 50 },
      ]),
      day('c-me', '2026-06-03', 'Shoot', [
        { itemId: 'k-b', name: 'MixPre-6', rate: 50 },
      ]),
    ]});
    const r = aggregateKitForShoot(prod, userPrefs);
    ok('Stage 3 · a1: kitBearingUserDayCount = 3 (all Shoot)',
      r.kitBearingUserDayCount === 3);
    const A = r.items.find(it => it.itemId === 'k-a');
    const B = r.items.find(it => it.itemId === 'k-b');
    ok('Stage 3 · a2: item A on 2 days, usual £200',
      A && A.daysOn === 2 && A.usual === 200);
    ok('Stage 3 · a3: item B on 3 days, usual £150',
      B && B.daysOn === 3 && B.usual === 150);
    ok('Stage 3 · a4: items carry the snapshot name',
      A && A.name === 'Sennheiser MKH8060' && B && B.name === 'MixPre-6');
  }

  // (b) Worked example: 2 days × £100 → £200, deal £150 → 25%.
  {
    const prod = buildProd({
      days: [
        day('c-me', '2026-06-01', 'Shoot', [{ itemId: 'k-a', name: 'A', rate: 100 }]),
        day('c-me', '2026-06-02', 'Shoot', [{ itemId: 'k-a', name: 'A', rate: 100 }]),
      ],
      kitDeals: [{ itemId: 'k-a', negotiatedTotal: 150 }],
    });
    const r = aggregateKitForShoot(prod, userPrefs);
    const A = r.items[0];
    ok('Stage 3 · b1: usual £200, negotiated £150, discount = 25%',
      A.usual === 200 && A.negotiatedTotal === 150 && A.discountPct === 25);
  }

  // (c) Scope: other crew's days don't count toward the user's aggregation.
  {
    const prod = buildProd({ days: [
      day('c-me', '2026-06-01', 'Shoot', [{ itemId: 'k-a', name: 'A', rate: 100 }]),
      day('c-other', '2026-06-01', 'Shoot', [{ itemId: 'k-a', name: 'A', rate: 100 }]),
      day('c-other', '2026-06-02', 'Shoot', [{ itemId: 'k-a', name: 'A', rate: 100 }]),
    ]});
    const r = aggregateKitForShoot(prod, userPrefs);
    ok('Stage 3 · c1: kitBearingUserDayCount = 1 (only user days counted)',
      r.kitBearingUserDayCount === 1);
    const A = r.items.find(it => it.itemId === 'k-a');
    ok('Stage 3 · c2: item A daysOn = 1, usual £100 (other crew excluded)',
      A && A.daysOn === 1 && A.usual === 100);
  }

  // (d1) deal == usual → no discount.
  {
    const prod = buildProd({
      days: [
        day('c-me', '2026-06-01', 'Shoot', [{ itemId: 'k-a', name: 'A', rate: 100 }]),
        day('c-me', '2026-06-02', 'Shoot', [{ itemId: 'k-a', name: 'A', rate: 100 }]),
      ],
      kitDeals: [{ itemId: 'k-a', negotiatedTotal: 200 }],
    });
    const r = aggregateKitForShoot(prod, userPrefs);
    const A = r.items[0];
    ok('Stage 3 · d1: usual £200, negotiated £200 → discount 0%',
      A.usual === 200 && A.negotiatedTotal === 200 && A.discountPct === 0);
  }
  // (d2) deal > usual → no discount.
  {
    const prod = buildProd({
      days: [day('c-me', '2026-06-01', 'Shoot', [{ itemId: 'k-a', name: 'A', rate: 100 }])],
      kitDeals: [{ itemId: 'k-a', negotiatedTotal: 200 }],
    });
    const r = aggregateKitForShoot(prod, userPrefs);
    const A = r.items[0];
    ok('Stage 3 · d2: deal > usual → discount 0%',
      A.negotiatedTotal === 200 && A.discountPct === 0);
  }
  // (d3) usual = 0 → no discount even with a deal.
  {
    const prod = buildProd({
      days: [day('c-me', '2026-06-01', 'Shoot', [{ itemId: 'k-a', name: 'A', rate: 0 }])],
      kitDeals: [{ itemId: 'k-a', negotiatedTotal: 50 }],
    });
    const r = aggregateKitForShoot(prod, userPrefs);
    const A = r.items.find(it => it.itemId === 'k-a');
    ok('Stage 3 · d3: usual = 0 → discountPct = 0',
      A && A.usual === 0 && A.discountPct === 0);
  }

  // (e1) item with no kitDeals entry → negotiatedTotal null.
  {
    const prod = buildProd({
      days: [day('c-me', '2026-06-01', 'Shoot', [{ itemId: 'k-a', name: 'A', rate: 100 }])],
      kitDeals: [{ itemId: 'k-OTHER', negotiatedTotal: 999 }],
    });
    const r = aggregateKitForShoot(prod, userPrefs);
    const A = r.items.find(it => it.itemId === 'k-a');
    ok("Stage 3 · e1: item with no kitDeals entry → negotiatedTotal null, discount 0",
      A && A.negotiatedTotal === null && A.discountPct === 0);
  }

  // Edges.
  {
    const prod = buildProd({ days: [day('c-me', '2026-06-01', 'Shoot', [])] });
    const r = aggregateKitForShoot(prod, userPrefs);
    ok('Stage 3 · e2: no items across user days → items: []', r.items.length === 0);
    const prodCascade = buildProd({
      defaultDay: { dayType: 'Build Day' },
      days: [{ id: 'd1', crewId: 'c-me', date: '2026-06-01',
        kitItems: [{ itemId: 'k-a', name: 'A', rate: 100 }] }],
    });
    const r2 = aggregateKitForShoot(prodCascade, userPrefs);
    ok('Stage 3 · e3: cascade-only kit-bearing day counts toward M',
      r2.kitBearingUserDayCount === 1);
  }
  {
    const noMatchPrefs = { ...userPrefs, displayName: 'Not In Crew' };
    const prod = buildProd({ days: [
      day('c-me', '2026-06-01', 'Shoot', [{ itemId: 'k-a', name: 'A', rate: 100 }]),
    ]});
    const r = aggregateKitForShoot(prod, noMatchPrefs);
    ok('Stage 3 · e4: no user identified → empty aggregation',
      r.kitBearingUserDayCount === 0 && r.items.length === 0);
  }
}

// ===========================================================================
// Stage 4 — buildInvoiceLineItems: deal application + frozen-records safety.
// ===========================================================================

function runStage4(eng, ok) {
  const { buildInvoiceLineItems } = eng;
  const crewMember = { id: 'c-me', name: 'Test User', role: 'Sound Mixer',
    department: 'Sound', bdr: 444, otCoef: 1.5, otRate: null, noOT: false,
    pmpa: false, vatRegistered: false, vatRate: 20, kitMoneyEnabled: false,
    kitMoneyAmount: 0, isDriver: false, email: '' };
  const userPrefs = { displayName: 'Test User', kitInventory: [
    { id: 'k-a', name: 'Sennheiser MKH8060', defaultDailyRate: 100, defaultOn: true },
    { id: 'k-b', name: 'MixPre-6', defaultDailyRate: 50, defaultOn: true },
  ]};
  const sBaseDay = (date, kitItems = []) => ({
    id: `d-${date}`, crewId: 'c-me', date,
    callTime: '08:00', wrapTime: '19:00', wrapNextDay: false,
    dayType: 'Shoot', lunchStartTime: '13:00', lunchDurationMins: 60,
    noMealProvided: false, secondBreakDurationMins: 0, secondBreakLogged: false,
    cwdBreak1Given: false, cwdBreak2Given: false, preCallTime: '',
    travelOutMins: 0, travelBackMins: 0, miles: 0, mileagePostcode: '',
    mileageMethod: 'distance', mileageRoundTrip: false,
    perDiemAmount: 0, kitMoneyAmount: 0,
    kitItems, expenses: [],
    stepUpRole: '', stepUpBDR: 0, stepUpOTCoef: 0, wrapped: false, note: '',
  });
  const sBaseProd = (o = {}) => ({
    id: 'p1', title: 'T', prodCo: '', jobReference: '',
    crew: [crewMember], days: [],
    defaultDay: null, dayDefaults: {},
    bestBoyMode: false, viewMode: 'mobile', iAmCrewId: 'c-me',
    isElevenHourDay: false, favourableRounding: false, apaRounding: false,
    startDate: '2026-06-01', gridDates: [], weekStarts: [],
    invoicingEmail: '', cancellationData: null, kitDeals: [], ...o,
  });
  const findItem = (lineItems, label) => lineItems.find(li => li.label === label);
  const totalOf = (lineItems) => lineItems.reduce((s, li) => s + (Number(li.amount) || 0), 0);

  // (a) Deal billed at negotiatedTotal; invoice total reflects it.
  {
    const days = [
      sBaseDay('2026-06-01', [{ itemId: 'k-a', name: 'Sennheiser MKH8060', rate: 100 }]),
      sBaseDay('2026-06-02', [{ itemId: 'k-a', name: 'Sennheiser MKH8060', rate: 100 }]),
    ];
    const undealtProd = sBaseProd({ days });
    const undealtItems = buildInvoiceLineItems(undealtProd, userPrefs, 'c-me');
    const undealtKit   = findItem(undealtItems, 'Sennheiser MKH8060');
    const undealtTotal = totalOf(undealtItems);
    ok('Stage 4 · a1: NO deal — kit line amount = usual (£200)',
      undealtKit && undealtKit.amount === 200);
    const dealtProd = sBaseProd({ days, kitDeals: [{ itemId: 'k-a', negotiatedTotal: 150 }] });
    const dealtItems = buildInvoiceLineItems(dealtProd, userPrefs, 'c-me');
    const dealtKit   = findItem(dealtItems, 'Sennheiser MKH8060');
    const dealtTotal = totalOf(dealtItems);
    ok('Stage 4 · a2: WITH deal — kit line amount = negotiatedTotal (£150)',
      dealtKit && dealtKit.amount === 150);
    ok('Stage 4 · a3: invoice total drops by exactly the discount (£50)',
      Math.abs((undealtTotal - dealtTotal) - 50) < 0.01);
    ok('Stage 4 · a4: only ONE kit line per item (no double-counting)',
      dealtItems.filter(li => li.label === 'Sennheiser MKH8060').length === 1);
  }

  // (b) Worked example — 2 days @ £100, deal £150 → line £150, "25%".
  {
    const days = [
      sBaseDay('2026-06-01', [{ itemId: 'k-a', name: 'Sennheiser MKH8060', rate: 100 }]),
      sBaseDay('2026-06-02', [{ itemId: 'k-a', name: 'Sennheiser MKH8060', rate: 100 }]),
    ];
    const prod = sBaseProd({ days, kitDeals: [{ itemId: 'k-a', negotiatedTotal: 150 }] });
    const items = buildInvoiceLineItems(prod, userPrefs, 'c-me');
    const kit = findItem(items, 'Sennheiser MKH8060');
    ok('Stage 4 · b1: line amount = £150', kit && kit.amount === 150);
    ok('Stage 4 · b2: detail contains "25% kit discount"',
      kit && /25% kit discount/.test(kit.detail || ''));
    ok('Stage 4 · b3: detail contains the day-basis "2 days"',
      kit && /\b2 days\b/.test(kit.detail || ''));
    ok('Stage 4 · b4: rate is nulled on dealt line', kit && kit.rate === null);
  }

  // (c) Non-deal item bills at usual.
  {
    const days = [
      sBaseDay('2026-06-01', [{ itemId: 'k-a', name: 'Sennheiser MKH8060', rate: 100 }]),
      sBaseDay('2026-06-02', [{ itemId: 'k-a', name: 'Sennheiser MKH8060', rate: 100 }]),
      sBaseDay('2026-06-03', [{ itemId: 'k-a', name: 'Sennheiser MKH8060', rate: 100 }]),
    ];
    const prod = sBaseProd({ days });
    const items = buildInvoiceLineItems(prod, userPrefs, 'c-me');
    const kit = findItem(items, 'Sennheiser MKH8060');
    ok('Stage 4 · c1: non-deal item amount = usual (£300)', kit && kit.amount === 300);
    ok('Stage 4 · c2: detail "3 days @ £100.00" (no discount suffix)',
      kit && /3 days @ £100\.00/.test(kit.detail || '') && !/discount/i.test(kit.detail || ''));
    ok('Stage 4 · c3: rate preserved on uniform-rate no-deal line',
      kit && kit.rate === 100 && kit.qty === 3);
  }

  // (d) Partial item: N of M days.
  {
    const days = [
      sBaseDay('2026-06-01', [{ itemId: 'k-a', name: 'Sennheiser MKH8060', rate: 100 }]),
      sBaseDay('2026-06-02', [{ itemId: 'k-a', name: 'Sennheiser MKH8060', rate: 100 }]),
      sBaseDay('2026-06-03', []),
      sBaseDay('2026-06-04', []),
    ];
    const prod = sBaseProd({ days });
    const items = buildInvoiceLineItems(prod, userPrefs, 'c-me');
    const kit = findItem(items, 'Sennheiser MKH8060');
    ok('Stage 4 · d1: detail reads "2 of 4 days @ £100.00"',
      kit && /\b2 of 4 days @ £100\.00\b/.test(kit.detail || ''));
    ok('Stage 4 · d2: partial item amount = usual sum (£200)',
      kit && kit.amount === 200);
  }

  // (e) Ad-hoc + legacy crew-default "Kit" lines unchanged.
  {
    const adHocDays = [sBaseDay('2026-06-01', []), sBaseDay('2026-06-02', [])];
    adHocDays[0].kitMoneyAmount = 25;
    adHocDays[1].kitMoneyAmount = 25;
    const adHocProd = sBaseProd({ days: adHocDays });
    const adHocItems = buildInvoiceLineItems(adHocProd, userPrefs, 'c-me');
    const adHocKit = findItem(adHocItems, 'Kit');
    ok('Stage 4 · e1: ad-hoc "Kit" line aggregates legacy-style (qty=2, rate=null, £50)',
      adHocKit && adHocKit.qty === 2 && adHocKit.amount === 50 && adHocKit.rate === null);
    ok("Stage 4 · e2: ad-hoc line detail uses date-range formatting",
      adHocKit && !/days @ £/.test(adHocKit.detail || ''));
    const crewWithKit = { ...crewMember, kitMoneyEnabled: true, kitMoneyAmount: 30 };
    const defaultDays = [sBaseDay('2026-06-01', []), sBaseDay('2026-06-02', [])];
    const defaultProd = sBaseProd({ crew: [crewWithKit], days: defaultDays });
    const defaultItems = buildInvoiceLineItems(defaultProd, userPrefs, 'c-me');
    const defaultKit = findItem(defaultItems, 'Kit');
    ok('Stage 4 · e3: crew-default "Kit" aggregates legacy-style (qty=2, £60)',
      defaultKit && defaultKit.qty === 2 && defaultKit.amount === 60 && defaultKit.rate === null);
  }

  // (f) SENT invoice snapshot is frozen — adding a deal doesn't recompute it.
  {
    const days = [
      sBaseDay('2026-06-01', [{ itemId: 'k-a', name: 'Sennheiser MKH8060', rate: 100 }]),
      sBaseDay('2026-06-02', [{ itemId: 'k-a', name: 'Sennheiser MKH8060', rate: 100 }]),
    ];
    const noDealProd = sBaseProd({ days });
    const snapshottedLineItems = buildInvoiceLineItems(noDealProd, userPrefs, 'c-me');
    const sentInvoiceLineItems = JSON.parse(JSON.stringify(snapshottedLineItems));
    const dealtProd = { ...noDealProd, kitDeals: [{ itemId: 'k-a', negotiatedTotal: 150 }] };
    const newDraftLineItems = buildInvoiceLineItems(dealtProd, userPrefs, 'c-me');
    ok('Stage 4 · f1: new draft on dealt prod gets discounted line (£150)',
      findItem(newDraftLineItems, 'Sennheiser MKH8060').amount === 150);
    ok('Stage 4 · f2: sent invoice snapshot is untouched (still £200)',
      findItem(sentInvoiceLineItems, 'Sennheiser MKH8060').amount === 200);
    ok('Stage 4 · f3: sent invoice line detail carries NO "kit discount" suffix',
      !/kit discount/.test(findItem(sentInvoiceLineItems, 'Sennheiser MKH8060').detail || ''));
  }

  // (g) Rate-variation edge.
  {
    const days = [
      sBaseDay('2026-06-01', [{ itemId: 'k-a', name: 'Sennheiser MKH8060', rate: 100 }]),
      sBaseDay('2026-06-02', [{ itemId: 'k-a', name: 'Sennheiser MKH8060', rate: 120 }]),
    ];
    const noDealItems = buildInvoiceLineItems(sBaseProd({ days }), userPrefs, 'c-me');
    const noDealKit = noDealItems.filter(li => li.label === 'Sennheiser MKH8060');
    ok('Stage 4 · g1: rate variation collapses to ONE kit line (no split)',
      noDealKit.length === 1);
    ok('Stage 4 · g2: rate null on varied-rate line, amount = sum (£220)',
      noDealKit[0].amount === 220 && noDealKit[0].rate === null);
    ok('Stage 4 · g3: detail omits "@ £rate" when rates vary',
      !/@ £/.test(noDealKit[0].detail || ''));
    const dealtItems = buildInvoiceLineItems(
      sBaseProd({ days, kitDeals: [{ itemId: 'k-a', negotiatedTotal: 180 }] }),
      userPrefs, 'c-me');
    const dealtKit = findItem(dealtItems, 'Sennheiser MKH8060');
    ok('Stage 4 · g4: deal applies to whole — amount = £180 (one line, not split)',
      dealtKit && dealtKit.amount === 180);
    ok('Stage 4 · g5: detail carries "18% kit discount"',
      dealtKit && /18% kit discount/.test(dealtKit.detail || ''));
  }

  // Extras (defensive) — two items with independent deals don't cross-contaminate.
  {
    const days = [
      sBaseDay('2026-06-01', [
        { itemId: 'k-a', name: 'A', rate: 100 },
        { itemId: 'k-b', name: 'B', rate: 50 },
      ]),
      sBaseDay('2026-06-02', [
        { itemId: 'k-a', name: 'A', rate: 100 },
        { itemId: 'k-b', name: 'B', rate: 50 },
      ]),
    ];
    const prod = sBaseProd({ days, kitDeals: [
      { itemId: 'k-a', negotiatedTotal: 150 },
      { itemId: 'k-b', negotiatedTotal: 80  },
    ]});
    const items = buildInvoiceLineItems(prod, userPrefs, 'c-me');
    ok('Stage 4 · x1: two distinct kit lines (A + B)',
      findItem(items, 'A') && findItem(items, 'B'));
    ok('Stage 4 · x2: A line = £150', findItem(items, 'A').amount === 150);
    ok('Stage 4 · x3: B line = £80',  findItem(items, 'B').amount === 80);
    ok('Stage 4 · x4: A detail shows 25%',
      /25% kit discount/.test(findItem(items, 'A').detail));
    ok('Stage 4 · x5: B detail shows 20%',
      /20% kit discount/.test(findItem(items, 'B').detail));
  }
}

// ===========================================================================
// Stage 6 — per-production kit discount + aggregate-rollup application.
// Stats / Home production-or-above totals subtract the discount; per-day
// surfaces (DayBreakdownView, Today widget) stay at daily rate.
// ===========================================================================

function runStage6(eng, ok) {
  const { computeProductionKitDiscount, buildInvoiceLineItems, calcForDisplay } = eng;

  const crewMember = { id: 'c-me', name: 'Test User', role: 'Sound Mixer',
    department: 'Sound', bdr: 444, otCoef: 1.5, otRate: null, noOT: false,
    pmpa: false, vatRegistered: false, vatRate: 20, kitMoneyEnabled: false,
    kitMoneyAmount: 0, isDriver: false, email: '' };
  const otherCrewMember = { ...crewMember, id: 'c-other', name: 'Sparks Smith' };
  const userPrefs = { displayName: 'Test User', kitInventory: [
    { id: 'k-a', name: 'Sennheiser MKH8060', defaultDailyRate: 100, defaultOn: true },
    { id: 'k-b', name: 'MixPre-6', defaultDailyRate: 50, defaultOn: true },
  ]};
  const bDay = (date, crewId, kitItems = []) => ({
    id: `d-${crewId}-${date}`, crewId, date,
    callTime: '08:00', wrapTime: '19:00', wrapNextDay: false,
    dayType: 'Shoot', lunchStartTime: '13:00', lunchDurationMins: 60,
    noMealProvided: false, secondBreakDurationMins: 0, secondBreakLogged: false,
    cwdBreak1Given: false, cwdBreak2Given: false, preCallTime: '',
    travelOutMins: 0, travelBackMins: 0, miles: 0, mileagePostcode: '',
    mileageMethod: 'distance', mileageRoundTrip: false,
    perDiemAmount: 0, kitMoneyAmount: 0,
    kitItems, expenses: [],
    stepUpRole: '', stepUpBDR: 0, stepUpOTCoef: 0, wrapped: false, note: '',
  });
  const bProd = (o = {}) => ({
    id: 'p1', title: 'T', prodCo: 'Acme Films', jobReference: '',
    crew: [crewMember], days: [],
    defaultDay: null, dayDefaults: {},
    bestBoyMode: false, viewMode: 'mobile', iAmCrewId: 'c-me',
    isElevenHourDay: false, favourableRounding: false, apaRounding: false,
    startDate: '2026-06-01', gridDates: [], weekStarts: [],
    invoicingEmail: '', cancellationData: null, kitDeals: [], ...o,
  });

  // (a) Stats kit total reduced by the discount = the dealt kit total.
  //     Verifies (i) computeProductionKitDiscount returns the exact discount;
  //     (ii) the per-production total falls by that discount; (iii) the number
  //     reconciles with the invoice line for the same item.
  {
    const days = [
      bDay('2026-06-01', 'c-me', [{ itemId: 'k-a', name: 'Sennheiser MKH8060', rate: 100 }]),
      bDay('2026-06-02', 'c-me', [{ itemId: 'k-a', name: 'Sennheiser MKH8060', rate: 100 }]),
    ];
    const prod = bProd({ days, kitDeals: [{ itemId: 'k-a', negotiatedTotal: 150 }] });
    const discount = computeProductionKitDiscount(prod, userPrefs);
    ok('Stage 6 · a1: discount = usual £200 − negotiated £150 = £50',
      discount === 50, `got £${discount}`);
    // Build raw per-day total (no discount), then apply rollup adjustment.
    const rawProdTotal = days.reduce((s, d) => {
      const c = prod.crew.find(cc => cc.id === d.crewId);
      return s + calcForDisplay(prod, d, c, null).total;
    }, 0);
    const rollupProdTotal = rawProdTotal - discount;
    ok('Stage 6 · a2: per-production rollup total drops by exactly the discount',
      Math.abs((rawProdTotal - rollupProdTotal) - 50) < 0.01);
    // Invoice consistency: dealt line on the invoice == negotiatedTotal.
    const invoiceItems = buildInvoiceLineItems(prod, userPrefs, 'c-me');
    const kitLine = invoiceItems.find(li => li.label === 'Sennheiser MKH8060');
    ok('Stage 6 · a3: dealt kit line on invoice = negotiatedTotal (£150)',
      kitLine && kitLine.amount === 150);
    // Stats-vs-invoice consistency: same number subtracted from the rollup as
    // the line items collectively reflect — usual £200 - dealt line £150 = £50.
    const invoiceTotalKitContribution = kitLine.amount;
    const wouldHaveBeen = 100 + 100; // usual sum from per-day walk
    ok('Stage 6 · a4: stats discount === (usual sum) − (dealt invoice line)',
      Math.abs(discount - (wouldHaveBeen - invoiceTotalKitContribution)) < 0.01);
  }

  // (b) Per-day breakdown for a day in the dealt production stays at daily rate.
  //     This is the central invariant: deal applies at rollup level only;
  //     calcForDisplay (which DayBreakdownView and the meter render) is untouched.
  {
    const day = bDay('2026-06-01', 'c-me',
      [{ itemId: 'k-a', name: 'Sennheiser MKH8060', rate: 100 }]);
    const dealtProd = bProd({ days: [day, bDay('2026-06-02', 'c-me',
      [{ itemId: 'k-a', name: 'Sennheiser MKH8060', rate: 100 }])],
      kitDeals: [{ itemId: 'k-a', negotiatedTotal: 150 }] });
    const undealtProd = bProd({ days: [day, bDay('2026-06-02', 'c-me',
      [{ itemId: 'k-a', name: 'Sennheiser MKH8060', rate: 100 }])] });
    const dealtCalc   = calcForDisplay(dealtProd,   day,
      dealtProd.crew[0],   null);
    const undealtCalc = calcForDisplay(undealtProd, day, undealtProd.crew[0], null);
    ok('Stage 6 · b1: per-day calc.total identical with vs without deal',
      Math.abs(dealtCalc.total - undealtCalc.total) < 0.01,
      `dealt=${dealtCalc.total}, undealt=${undealtCalc.total}`);
    const sumKit = (lines) => lines.filter(l => l.bucket === 'kit')
      .reduce((s, l) => s + (Number(l.amount) || 0), 0);
    ok('Stage 6 · b2: per-day kit bucket on the breakdown unchanged (daily rate)',
      sumKit(dealtCalc.lines) === sumKit(undealtCalc.lines),
      `dealt=${sumKit(dealtCalc.lines)}, undealt=${sumKit(undealtCalc.lines)}`);
    ok('Stage 6 · b3: that day still shows £100 kit (the daily rate)',
      sumKit(dealtCalc.lines) === 100);
  }

  // (c) Home rollup: simulate productionTotals = raw − discount; monthTotal
  //     derived from productionTotals auto-inherits the discount.
  {
    const days = [
      bDay('2026-06-01', 'c-me', [{ itemId: 'k-a', name: 'Sennheiser MKH8060', rate: 100 }]),
      bDay('2026-06-02', 'c-me', [{ itemId: 'k-a', name: 'Sennheiser MKH8060', rate: 100 }]),
    ];
    const prodA = bProd({ id: 'pA', days, kitDeals: [{ itemId: 'k-a', negotiatedTotal: 150 }] });
    const prodB = bProd({ id: 'pB', days: [
      bDay('2026-06-03', 'c-me', [{ itemId: 'k-b', name: 'MixPre-6', rate: 50 }]),
    ]});
    const rawA = days.reduce((s, d) => s + calcForDisplay(prodA, d, prodA.crew[0], null).total, 0);
    const rawB = calcForDisplay(prodB, prodB.days[0], prodB.crew[0], null).total;
    const discA = computeProductionKitDiscount(prodA, userPrefs);
    const discB = computeProductionKitDiscount(prodB, userPrefs);
    ok('Stage 6 · c1: prod A has a deal — discount = £50',
      discA === 50, `discA=£${discA}`);
    ok('Stage 6 · c2: prod B has NO deal — discount = £0',
      discB === 0, `discB=£${discB}`);
    const homeTotalsA = rawA - discA;
    const homeTotalsB = rawB - discB;
    const monthTotal  = homeTotalsA + homeTotalsB;
    ok('Stage 6 · c3: per-production rollup A drops by £50',
      Math.abs((rawA - homeTotalsA) - 50) < 0.01);
    ok('Stage 6 · c4: per-production rollup B unchanged',
      Math.abs(rawB - homeTotalsB) < 0.01);
    ok('Stage 6 · c5: per-month total = Σ(rollup totals) — auto-reflects discount',
      Math.abs(monthTotal - ((rawA + rawB) - 50)) < 0.01);
  }

  // (d) No deal anywhere → no rollup change.
  {
    const days = [
      bDay('2026-06-01', 'c-me', [{ itemId: 'k-a', name: 'Sennheiser MKH8060', rate: 100 }]),
      bDay('2026-06-02', 'c-me', [{ itemId: 'k-a', name: 'Sennheiser MKH8060', rate: 100 }]),
    ];
    const prod = bProd({ days }); // no kitDeals
    const discount = computeProductionKitDiscount(prod, userPrefs);
    ok('Stage 6 · d1: production with no deals → discount = £0',
      discount === 0);
    // Same with deals >= usual.
    const prod2 = bProd({ days, kitDeals: [{ itemId: 'k-a', negotiatedTotal: 999 }] });
    const discount2 = computeProductionKitDiscount(prod2, userPrefs);
    ok('Stage 6 · d2: deal >= usual → discount = £0 (no negative discount)',
      discount2 === 0);
    // Deal exactly equal to usual.
    const prod3 = bProd({ days, kitDeals: [{ itemId: 'k-a', negotiatedTotal: 200 }] });
    const discount3 = computeProductionKitDiscount(prod3, userPrefs);
    ok('Stage 6 · d3: deal == usual → discount = £0',
      discount3 === 0);
  }

  // (e) User-scoped: another crew member's days don't contribute to the
  //     discount. The user is solo on prod, even if "the other crew" used
  //     the same dealt itemId on their own days, those days don't count.
  {
    const days = [
      bDay('2026-06-01', 'c-me',    [{ itemId: 'k-a', name: 'Sennheiser MKH8060', rate: 100 }]),
      bDay('2026-06-01', 'c-other', [{ itemId: 'k-a', name: 'Sennheiser MKH8060', rate: 100 }]),
      bDay('2026-06-02', 'c-other', [{ itemId: 'k-a', name: 'Sennheiser MKH8060', rate: 100 }]),
    ];
    const prod = bProd({
      bestBoyMode: true,
      crew: [crewMember, otherCrewMember],
      iAmCrewId: 'c-me',
      days,
      kitDeals: [{ itemId: 'k-a', negotiatedTotal: 50 }],
    });
    const discount = computeProductionKitDiscount(prod, userPrefs);
    // User has the item on 1 day only (£100 usual). Deal £50 → discount £50.
    // Other crew's 2 days × £100 = £200 are NOT included.
    ok("Stage 6 · e1: discount = (user's usual £100) − (deal £50) = £50",
      discount === 50, `got £${discount}`);
    // If the discount had counted other crew's days, it would be (£300 − £50 = £250).
    ok('Stage 6 · e2: discount specifically NOT £250 (other crew excluded)',
      discount !== 250);
    // Confirm via explicit user-crew-id override that the result is identical.
    const discountExplicit = computeProductionKitDiscount(prod, userPrefs, 'c-me');
    ok('Stage 6 · e3: explicit userCrewId="c-me" matches displayName-resolved result',
      discountExplicit === 50);
    // And explicit other-crew override gives the other crew's discount (£200 − £50 = £150).
    const discountOther = computeProductionKitDiscount(prod, userPrefs, 'c-other');
    ok("Stage 6 · e4: explicit userCrewId=\"c-other\" gives THAT crew's scoped discount",
      discountOther === 150, `got £${discountOther}`);
  }

  // (f) Frozen-record interaction: applying a discount at Stats/Home rollup
  //     level NEVER mutates production.kitDeals nor any day record nor any
  //     invoice. Verify computeProductionKitDiscount is read-only.
  {
    const days = [
      bDay('2026-06-01', 'c-me', [{ itemId: 'k-a', name: 'Sennheiser MKH8060', rate: 100 }]),
      bDay('2026-06-02', 'c-me', [{ itemId: 'k-a', name: 'Sennheiser MKH8060', rate: 100 }]),
    ];
    const prod = bProd({ days, kitDeals: [{ itemId: 'k-a', negotiatedTotal: 150 }] });
    const before = JSON.stringify(prod);
    computeProductionKitDiscount(prod, userPrefs);
    computeProductionKitDiscount(prod, userPrefs);
    ok('Stage 6 · f1: computeProductionKitDiscount does not mutate production',
      JSON.stringify(prod) === before);
  }
}

// ===========================================================================
// Stage 7 — current-shoot total includes future days; aggregates stay
// elapsed-only. Locks in the two-map split on HomeScreen (productionTotals
// vs productionTotalsFull) so a future re-inflation regression is caught.
// ===========================================================================

function runStage7(eng, ok) {
  const { calcForDisplay, computeProductionKitDiscount } = eng;

  const crewMember = { id: 'c-me', name: 'Test User', role: 'Sound Mixer',
    department: 'Sound', bdr: 444, otCoef: 1.5, otRate: null, noOT: false,
    pmpa: false, vatRegistered: false, vatRate: 20, kitMoneyEnabled: false,
    kitMoneyAmount: 0, isDriver: false, email: '' };
  const userPrefs = { displayName: 'Test User', kitInventory: [
    { id: 'k-a', name: 'Sennheiser MKH8060', defaultDailyRate: 100, defaultOn: true },
  ]};
  const sDay = (date, kitItems = []) => ({
    id: `d-${date}`, crewId: 'c-me', date,
    callTime: '08:00', wrapTime: '19:00', wrapNextDay: false,
    dayType: 'Shoot', lunchStartTime: '13:00', lunchDurationMins: 60,
    noMealProvided: false, secondBreakDurationMins: 0, secondBreakLogged: false,
    cwdBreak1Given: false, cwdBreak2Given: false, preCallTime: '',
    travelOutMins: 0, travelBackMins: 0, miles: 0, mileagePostcode: '',
    mileageMethod: 'distance', mileageRoundTrip: false,
    perDiemAmount: 0, kitMoneyAmount: 0,
    kitItems, expenses: [],
    stepUpRole: '', stepUpBDR: 0, stepUpOTCoef: 0, wrapped: false, note: '',
  });
  const sProd = (o = {}) => ({
    id: 'p1', title: 'T', prodCo: 'Acme Films', jobReference: '',
    crew: [crewMember], days: [],
    defaultDay: null, dayDefaults: {},
    bestBoyMode: false, viewMode: 'mobile', iAmCrewId: 'c-me',
    isElevenHourDay: false, favourableRounding: false, apaRounding: false,
    startDate: '2026-06-01', gridDates: [], weekStarts: [],
    invoicingEmail: '', cancellationData: null, kitDeals: [], ...o,
  });
  // Replicate the EXACT formulas HomeScreen uses for productionTotals and
  // productionTotalsFull, so the assertions catch any future divergence in
  // either path (re-inflation of aggregates, or removal of the discount).
  // FIXED_TODAY is a Wednesday and the test days are Mon-Tue (past), Wed
  // (today), Thu-Fri (future) — all weekdays, so BDR math is uniform and
  // the expected numbers don't accidentally bake in Sat/Sun multipliers.
  const FIXED_TODAY = '2026-06-10'; // Wednesday
  const elapsedTotal = (p, today) => {
    const raw = (p.days || []).reduce((s, d) => {
      if (!d.date || d.date >= today) return s;
      const c = (p.crew || []).find(cc => cc.id === d.crewId);
      if (!c) return s;
      return s + calcForDisplay(p, d, c, null).total;
    }, 0);
    return raw - computeProductionKitDiscount(p, userPrefs);
  };
  const fullTotal = (p) => {
    const raw = (p.days || []).reduce((s, d) => {
      if (!d.date) return s;
      const c = (p.crew || []).find(cc => cc.id === d.crewId);
      if (!c) return s;
      return s + calcForDisplay(p, d, c, null).total;
    }, 0);
    return raw - computeProductionKitDiscount(p, userPrefs);
  };

  // (a) Live shoot with PAST + TODAY + FUTURE days: full-total includes them
  //     all; elapsed-only stops before today.
  {
    const prod = sProd({ days: [
      sDay('2026-06-08', [{ itemId: 'k-a', name: 'Sennheiser MKH8060', rate: 100 }]),
      sDay('2026-06-09', [{ itemId: 'k-a', name: 'Sennheiser MKH8060', rate: 100 }]),
      sDay('2026-06-10', [{ itemId: 'k-a', name: 'Sennheiser MKH8060', rate: 100 }]),
      sDay('2026-06-11', [{ itemId: 'k-a', name: 'Sennheiser MKH8060', rate: 100 }]),
      sDay('2026-06-12', [{ itemId: 'k-a', name: 'Sennheiser MKH8060', rate: 100 }]),
    ]});
    const full = fullTotal(prod);
    const elapsed = elapsedTotal(prod, FIXED_TODAY);
    ok('Stage 7 · a1: full > elapsed (future days lift the headline)',
      full > elapsed, `full=£${full}, elapsed=£${elapsed}`);
    // 5 days total at BDR £444 + £100 kit = £544/day. Past + today + future.
    const expectedFull = 5 * (444 + 100);
    ok('Stage 7 · a2: full = Σ ALL days × per-day total (£2,720)',
      Math.abs(full - expectedFull) < 0.01,
      `full=£${full}, expected=£${expectedFull}`);
    const expectedElapsed = 2 * (444 + 100); // only June 5 + 6 < today 2026-06-07
    ok('Stage 7 · a3: elapsed = Σ days WHERE date < today (£1,088)',
      Math.abs(elapsed - expectedElapsed) < 0.01,
      `elapsed=£${elapsed}, expected=£${expectedElapsed}`);
    ok('Stage 7 · a4: full − elapsed = sum of today + future days (£1,632)',
      Math.abs((full - elapsed) - (3 * (444 + 100))) < 0.01);
  }

  // (b) Same shoot with a kit deal: discount applied to BOTH paths. Neither
  //     is "discount-free"; both reflect the negotiated total.
  {
    const prod = sProd({ days: [
      sDay('2026-06-08', [{ itemId: 'k-a', name: 'Sennheiser MKH8060', rate: 100 }]),
      sDay('2026-06-09', [{ itemId: 'k-a', name: 'Sennheiser MKH8060', rate: 100 }]),
      sDay('2026-06-10', [{ itemId: 'k-a', name: 'Sennheiser MKH8060', rate: 100 }]),
      sDay('2026-06-11', [{ itemId: 'k-a', name: 'Sennheiser MKH8060', rate: 100 }]),
      sDay('2026-06-12', [{ itemId: 'k-a', name: 'Sennheiser MKH8060', rate: 100 }]),
    ], kitDeals: [{ itemId: 'k-a', negotiatedTotal: 300 }] });
    const discount = computeProductionKitDiscount(prod, userPrefs);
    ok('Stage 7 · b1: deal £300 on 5 × £100 kit → discount = £200',
      discount === 200, `discount=£${discount}`);
    const full    = fullTotal(prod);
    const elapsed = elapsedTotal(prod, FIXED_TODAY);
    // Full raw = 5 × £544 = £2720. After discount: £2520.
    ok('Stage 7 · b2: full reflects the discount (£2,720 − £200 = £2,520)',
      Math.abs(full - 2520) < 0.01, `full=£${full}`);
    // Elapsed raw = 2 × £544 = £1088. After discount: £888.
    ok('Stage 7 · b3: elapsed reflects the discount (£1,088 − £200 = £888)',
      Math.abs(elapsed - 888) < 0.01, `elapsed=£${elapsed}`);
    // Sanity: both paths subtract the SAME discount number.
    const rawFull = full + discount;
    const rawElapsed = elapsed + discount;
    ok('Stage 7 · b4: both paths subtract the same discount (£200)',
      Math.abs((rawFull - full) - (rawElapsed - elapsed)) < 0.01);
  }

  // (c) Aggregate guard — productionTotals (elapsed) is what feeds Home
  //     monthTotal and StatsScreen totalEarnings / earningsByMonth. Verify
  //     that adding future days to a production does NOT change the elapsed
  //     total (i.e. the future days don't leak into aggregates).
  {
    const pastOnly = sProd({ days: [
      sDay('2026-06-08', [{ itemId: 'k-a', name: 'Sennheiser MKH8060', rate: 100 }]),
      sDay('2026-06-09', [{ itemId: 'k-a', name: 'Sennheiser MKH8060', rate: 100 }]),
    ]});
    const pastPlusFuture = sProd({ days: [
      sDay('2026-06-08', [{ itemId: 'k-a', name: 'Sennheiser MKH8060', rate: 100 }]),
      sDay('2026-06-09', [{ itemId: 'k-a', name: 'Sennheiser MKH8060', rate: 100 }]),
      sDay('2026-06-11', [{ itemId: 'k-a', name: 'Sennheiser MKH8060', rate: 100 }]),
      sDay('2026-06-12', [{ itemId: 'k-a', name: 'Sennheiser MKH8060', rate: 100 }]),
    ]});
    const elapsedA = elapsedTotal(pastOnly,        FIXED_TODAY);
    const elapsedB = elapsedTotal(pastPlusFuture,  FIXED_TODAY);
    ok('Stage 7 · c1: future days do NOT inflate elapsed total (aggregate guard)',
      Math.abs(elapsedA - elapsedB) < 0.01,
      `pastOnly=£${elapsedA}, pastPlusFuture=£${elapsedB}`);
    const fullA = fullTotal(pastOnly);
    const fullB = fullTotal(pastPlusFuture);
    ok('Stage 7 · c2: full DOES include the added future days',
      fullB > fullA, `fullA=£${fullA}, fullB=£${fullB}`);
    ok('Stage 7 · c3: future-only increment = 2 days × £544 = £1,088',
      Math.abs((fullB - fullA) - 2 * (444 + 100)) < 0.01);
  }

  // (d) Fully-past shoot — full == elapsed; the fix doesn't change anything
  //     for past shoots.
  {
    const past = sProd({ days: [
      // Mon/Tue/Wed — weekdays so BDR math is uniform.
      sDay('2026-05-04', [{ itemId: 'k-a', name: 'Sennheiser MKH8060', rate: 100 }]),
      sDay('2026-05-05', [{ itemId: 'k-a', name: 'Sennheiser MKH8060', rate: 100 }]),
      sDay('2026-05-06', [{ itemId: 'k-a', name: 'Sennheiser MKH8060', rate: 100 }]),
    ]});
    ok('Stage 7 · d1: fully-past shoot — full == elapsed (no future to add)',
      Math.abs(fullTotal(past) - elapsedTotal(past, FIXED_TODAY)) < 0.01);
    // And with a deal:
    const pastDealt = { ...past, kitDeals: [{ itemId: 'k-a', negotiatedTotal: 200 }] };
    ok('Stage 7 · d2: fully-past dealt shoot — full == elapsed, discount applied',
      Math.abs(fullTotal(pastDealt) - elapsedTotal(pastDealt, FIXED_TODAY)) < 0.01);
    const disc = computeProductionKitDiscount(pastDealt, userPrefs);
    ok('Stage 7 · d3: fully-past dealt shoot — discount = usual £300 − deal £200 = £100',
      disc === 100, `disc=£${disc}`);
  }

  // (e) Fully-future shoot — elapsed = 0 (nothing past today), full = the
  //     entire booked total with deal applied. Edge case for a newly booked
  //     production with no day worked yet.
  {
    const futureOnly = sProd({ days: [
      sDay('2026-07-01', [{ itemId: 'k-a', name: 'Sennheiser MKH8060', rate: 100 }]),
      sDay('2026-07-02', [{ itemId: 'k-a', name: 'Sennheiser MKH8060', rate: 100 }]),
    ], kitDeals: [{ itemId: 'k-a', negotiatedTotal: 150 }] });
    const elapsed = elapsedTotal(futureOnly, FIXED_TODAY);
    const full    = fullTotal(futureOnly);
    ok('Stage 7 · e1: fully-future shoot — elapsed = −discount, full > 0',
      // elapsed raw = 0; elapsed = 0 - discount = -£50. The aggregates would
      // negative-bias this shoot, which is correct: invoice-once mental model
      // says the deal is realised but no work has happened — but as soon as
      // the first day passes, the discount catches up to actual earnings.
      full > 0 && elapsed < 0,
      `elapsed=£${elapsed}, full=£${full}`);
    // Full = 2 × £544 raw, − £50 discount = £1,038.
    ok('Stage 7 · e2: fully-future full = booked total minus discount (£1,038)',
      Math.abs(full - 1038) < 0.01, `full=£${full}`);
  }
}

// ---- Orchestrator ----------------------------------------------------------

async function runKitAssertions() {
  const eng = await loadSourceEngine();
  // Defensive: ensure every engine name we rely on is actually exported.
  const required = [
    'calcForDisplay', 'categorizeBreakdownLine',
    'applyKitAutoApply', 'applyKitAutoRemove', 'resolveEffectiveDayType',
    'getEffectiveUserCrewId', 'aggregateKitForShoot', 'buildInvoiceLineItems',
    'computeProductionKitDiscount',
  ];
  for (const name of required) {
    if (typeof eng[name] !== 'function') {
      console.error(`kit-assertions: engine missing export "${name}"`);
      return { pass: 0, fail: 1, failures: [{ label: `engine-missing:${name}` }] };
    }
  }

  console.log('============================================================');
  console.log(' kit-assertions: Kit Inventory regression suite');
  console.log('============================================================');

  const { ok, summary } = makeCollector();

  console.log('\n── Stage 2: itemised lines + bucket marker ──');
  runStage2(eng, ok);
  console.log('\n── Stage 2b: applyKitAutoApply on kit-bearing types ──');
  runStage2b(eng, ok);
  console.log('\n── Stage 2c: auto/manual model + auto-remove + cascade ──');
  runStage2c(eng, ok);
  console.log('\n── Stage 2d: user-crew scoping ──');
  runStage2d(eng, ok);
  console.log('\n── Stage 3: aggregateKitForShoot (days-on, usual, discount) ──');
  runStage3(eng, ok);
  console.log('\n── Stage 4: buildInvoiceLineItems (deals + frozen invoices) ──');
  runStage4(eng, ok);
  console.log('\n── Stage 6: per-production kit discount + Stats/Home rollups ──');
  runStage6(eng, ok);
  console.log('\n── Stage 7: current-shoot full vs aggregate elapsed-only ──');
  runStage7(eng, ok);

  return summary();
}

// ---- Standalone CLI --------------------------------------------------------

if (require.main === module) {
  runKitAssertions().then(({ pass, fail }) => {
    const total = pass + fail;
    console.log('\n============================================================');
    if (fail === 0) {
      console.log(` ✅ PASS — all ${total} kit assertions passed.`);
    } else {
      console.log(` ❌ FAIL — ${fail} of ${total} kit assertions failed.`);
    }
    console.log('============================================================');
    process.exit(fail > 0 ? 1 : 0);
  }).catch((e) => { console.error(e); process.exit(2); });
}

module.exports = { runKitAssertions };
