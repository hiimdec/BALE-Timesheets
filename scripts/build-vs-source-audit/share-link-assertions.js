/*
 * share-link-assertions.js
 *
 *   $ node scripts/build-vs-source-audit/share-link-assertions.js
 *   $ SHARE_PIN_CAPTURE=1 node …  → prints this encoder's fragment for S5
 *
 * The shoot-share wire codec's permanent suite (format v1, FROZEN at gate 2,
 * 2026-07-29). Pins:
 *
 *   - THE CANONICAL FIXTURE (the "Meerkat" shoot from the format freeze):
 *     decode(fixtureLink) must equal the fixture shoot object byte-for-byte,
 *     forever. This is the frozen format's reference that cannot drift.
 *   - ROUND-TRIP: encode(fixture input) → decode → the same shoot object.
 *   - ENCODE-STRING PIN (S5): the exact fragment THIS shipped encoder emits
 *     in the audit's Node context. Deflate bytes are NOT canonical across
 *     zlib implementations/levels (the recorded nondeterminism note) — the
 *     browser may emit different bytes for the same envelope, which is fine:
 *     S6 pins the cross-implementation guarantee (the encoded envelope
 *     PARSES to the frozen JSON), S5 pins byte-stability in the gate.
 *   - REFUSALS: newer-version, damaged (arity, count, truncation, charset,
 *     cap, null-pairing) — the never-guess property. Refusal fixtures are
 *     compressed with node's zlib deflateRaw, which also proves the decoder
 *     accepts streams from a different deflate implementation.
 *
 *   - BB EXTRACTION (B1-B6): extractCrewShareDays feeds one BB crew
 *     member's WORKED days (ruled 2026-07-30: rest/un-ticked days are
 *     simply absent — days carry their own dates, so gaps need nothing)
 *     into the SAME frozen encoder. Pins: the fixture (lean/varying/dept-
 *     late worked days; a rested record and an absent date both SKIPPED)
 *     round-trips to the exact expected shoot; a BB link is BYTE-IDENTICAL
 *     to a solo link of the same days; BB noise (kit, other crew,
 *     non-per-diem expenses) cannot leak; cap counts WORKED days and a
 *     no-worked-days member refuses as empty; every tuple equals the
 *     direct resolveDay output; a legacy truckCallTime pre-call travels
 *     (the calc pays that alias, so the link must carry it). B1/B2 run on
 *     the BUILT engine too.
 *
 * Wiring: audit:build (after theme-parity) · standalone audit:share.
 * Exit code: 0 all pass, 1 any fail, 2 harness error.
 */

const zlib = require('zlib');
const fs = require('fs');
const path = require('path');
const { loadSourceEngine, loadBuiltEngine } = require('./load-engines');
// Source text, for the handful of BLK pins that assert CALL-SITE shape
// (render conditions, delivery gating) — things an engine execution cannot
// see. Everything executable stays executed.
const SRC_HTML = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');

// ── The canonical fixture (gate-2 freeze; scaffold ratified to /s#) ─────────
const FIXTURE_LINK = 'https://timemachineapp.co.uk/s#bc5NS8NAEAbgv7K850mZ_Uga9lQVC4VWLOJBQg4xG7Fk3S35EET875K0h4qFYQbmhWfmG5-wkhBgNaGHLbBrmq6tBrEJ_dhVoW7E3oCw2-xNolhlCecShNvonXiJvhXrg__oxXZwIOjOibWPsSMhc_H4fjgexdPQNc1AYhuDi0Hc36kbYR6eQajqOo5h6Fev0buv6Nu3iVrUcTG2KAkOtihwPpqwBkkC55YZBKnnmTGF0fuLBrmcEyaTTsXEJV0wZorAyzOjrD4xkCdZT2k2b6F4njzlGZNOmclkf7j0Gqf_f6X0Var8-QU';
const FIXTURE_ENVELOPE = {
  v: 1, n: 3,
  s: ['Meerkat Insurance Q4', 'MIQ4-2026-081', 'Bold Yolk Films Ltd',
      '3rd Floor, 18 Phipp Street, London EC2A 4NU', 'accounts@boldyolkfilms.co.uk'],
  d: [
    ['2026-08-03', 1, '08:00', '13:00', 60, null, null, null, '17:00', 0, 45, 45, 0, 0],
    ['2026-08-04', 0, '07:00', '12:30', 60, '18:00', 30, '06:30', '20:30', 0, 60, 60, 3500, 46],
    ['2026-08-05', 0, '07:00', '12:30', 30, null, null, null, '23:30', 0, 60, 60, 3500, 46],
  ],
};
const FIXTURE_SHOOT = {
  title: 'Meerkat Insurance Q4', jobReference: 'MIQ4-2026-081', prodCo: 'Bold Yolk Films Ltd',
  toAddress: '3rd Floor, 18 Phipp Street, London EC2A 4NU', invoicingEmail: 'accounts@boldyolkfilms.co.uk',
  days: [
    { date: '2026-08-03', dayType: 'Pre-light', callTime: '08:00', lunchStartTime: '13:00', lunchDurationMins: 60,
      secondBreakStartTime: '', secondBreakDurationMins: 0, preCallTime: '', wrapTime: '17:00', wrapNextDay: false,
      travelOutMins: 45, travelBackMins: 45, perDiemPence: 0, miles: 0 },
    { date: '2026-08-04', dayType: 'Shoot', callTime: '07:00', lunchStartTime: '12:30', lunchDurationMins: 60,
      secondBreakStartTime: '18:00', secondBreakDurationMins: 30, preCallTime: '06:30', wrapTime: '20:30', wrapNextDay: false,
      travelOutMins: 60, travelBackMins: 60, perDiemPence: 3500, miles: 46 },
    { date: '2026-08-05', dayType: 'Shoot', callTime: '07:00', lunchStartTime: '12:30', lunchDurationMins: 30,
      secondBreakStartTime: '', secondBreakDurationMins: 0, preCallTime: '', wrapTime: '23:30', wrapNextDay: false,
      travelOutMins: 60, travelBackMins: 60, perDiemPence: 3500, miles: 46 },
  ],
};

// S5 pin — THIS encoder's own output in the audit's Node context, captured
// once from the shipped encoder (SHARE_PIN_CAPTURE=1) and pinned thereafter.
const PINNED_ENCODE_FRAGMENT = 'bc5NS8NAEAbgv7K850mZ_Uga9lQVC4VWLOJBQg4xG7Fk3S35EET875K0h4qFYQbmhWfmG5-wkhBgNaGHLbBrmq6tBrEJ_dhVoW7E3oCw2-xNolhlCecShNvonXiJvhXrg__oxXZwIOjOibWPsSMhc_H4fjgexdPQNc1AYhuDi0Hc36kbYR6eQajqOo5h6Fev0buv6Nu3iVrUcTG2KAkOtihwPpqwBkkC55YZBKnnmTGF0fuLBrmcEyaTTsXEJV0wZorAyzOjrD4xkCdZT2k2b6F4njzlGZNOmclkf7j0Gqf_f6X0Var8-QU';

// The encoder input that must reproduce the fixture: full explicit records
// (no cascade dependence), per diem as the builtin-perdiem instance on the
// two £35 days — the recorded resolution rule's canonical home.
const FIXTURE_PRODUCTION = {
  title: 'Meerkat Insurance Q4', jobReference: 'MIQ4-2026-081', prodCo: 'Bold Yolk Films Ltd',
  toAddress: '3rd Floor, 18 Phipp Street, London EC2A 4NU', invoicingEmail: 'accounts@boldyolkfilms.co.uk',
  defaultDay: {}, dayDefaults: {}, crew: [],
};
const FIXTURE_CREW = { id: 'c1', name: 'Fixture', role: 'Spark', bdr: 444, otCoef: 1.5, otRate: null, noOT: false };
const mkFixtureDay = (o) => ({
  id: o.id, crewId: 'c1', date: o.date, dayType: o.dayType,
  callTime: o.call, wrapTime: o.wrap, wrapNextDay: false,
  lunchStartTime: o.lunchS, lunchDurationMins: o.lunchD,
  secondBreakStartTime: o.sbS || '', secondBreakDurationMins: o.sbD || 0,
  preCallTime: o.preC || '', travelOutMins: o.tOut, travelBackMins: o.tBack,
  miles: o.miles, perDiemAmount: 0,
  expenses: o.pd ? [{ id: 'pd-' + o.id, presetId: 'builtin-perdiem', name: 'Per Diem', amount: o.pd, detail: '' }] : [],
});
const FIXTURE_DAYS = [
  mkFixtureDay({ id: 'd1', date: '2026-08-03', dayType: 'Pre-light', call: '08:00', lunchS: '13:00', lunchD: 60, wrap: '17:00', tOut: 45, tBack: 45, miles: 0, pd: 0 }),
  mkFixtureDay({ id: 'd2', date: '2026-08-04', dayType: 'Shoot', call: '07:00', lunchS: '12:30', lunchD: 60, sbS: '18:00', sbD: 30, preC: '06:30', wrap: '20:30', tOut: 60, tBack: 60, miles: 46, pd: 35 }),
  mkFixtureDay({ id: 'd3', date: '2026-08-05', dayType: 'Shoot', call: '07:00', lunchS: '12:30', lunchD: 30, wrap: '23:30', tOut: 60, tBack: 60, miles: 46, pd: 35 }),
];

// Helpers to craft refusal fixtures with node's OWN deflate (also proves the
// decoder accepts non-CompressionStream streams).
const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fragOf = (envelope) => b64url(zlib.deflateRawSync(Buffer.from(JSON.stringify(envelope))));
const clone = (x) => JSON.parse(JSON.stringify(x));
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ── BB extraction fixture (B-pins) ──────────────────────────────────────────
// Sam's calendar: three WORKED days — lean (cascade), varying (explicit wrap
// + travel + per-diem instance + a non-per-diem expense that must NOT
// travel), dept late day (dayDefaults leg) — plus a rested record and an
// ABSENT date (Jo works, Sam has no record), both of which must be SKIPPED
// (worked-days-only ruling). Kit and a second crew member are noise the
// allowlist must drop.
const BB_CREW_SAM = { id: 'sam', name: 'Sam Spark', role: 'Lighting Technician', bdr: 500, otCoef: 1.5, otRate: null, noOT: false };
const BB_PRODUCTION = {
  title: 'Harbour Nights', jobReference: 'HN-2026-114', prodCo: 'Copper Kettle Films',
  toAddress: '12 Quay Lane, Bristol BS1 4DZ', invoicingEmail: 'accounts@copperkettle.co.uk',
  bestBoyMode: true,
  defaultDay: { callTime: '07:00', wrapTime: '19:00', lunchStartTime: '13:00', lunchDurationMins: 60, dayType: 'Shoot' },
  dayDefaults: { '2026-08-06': { wrapTime: '21:00' } },
  crew: [BB_CREW_SAM, { id: 'jo', name: 'Jo Gaffer', role: 'Gaffer', bdr: 650 }],
  days: [
    { id: 'b1', crewId: 'sam', date: '2026-08-04', kitItems: [{ itemId: 'k1', name: 'Radio kit', rate: 15 }], kitMoneyAmount: 50, expenses: [] },
    { id: 'b2', crewId: 'sam', date: '2026-08-05', wrapTime: '19:45', travelOutMins: 30, travelBackMins: 30,
      expenses: [{ id: 'e1', presetId: 'builtin-perdiem', name: 'Per Diem', amount: 35, detail: '' },
                 { id: 'e2', presetId: 'parking', name: 'Parking', amount: 12, detail: 'NCP' }] },
    { id: 'b3', crewId: 'sam', date: '2026-08-06' },
    { id: 'b4', crewId: 'sam', date: '2026-08-07', dayType: 'Rest Day', wrapTime: '19:45' },
    { id: 'b5', crewId: 'jo', date: '2026-08-04' },
    { id: 'b6', crewId: 'jo', date: '2026-08-08', preCallTime: '06:00' },
  ],
};
const bbDay = (o) => ({
  date: o.date, dayType: o.type, callTime: '07:00', lunchStartTime: '13:00', lunchDurationMins: 60,
  secondBreakStartTime: '', secondBreakDurationMins: 0, preCallTime: '', wrapTime: o.wrap, wrapNextDay: false,
  travelOutMins: o.tOut || 0, travelBackMins: o.tBack || 0, perDiemPence: o.pd || 0, miles: 0,
});
const BB_EXPECTED_SHOOT = {
  title: 'Harbour Nights', jobReference: 'HN-2026-114', prodCo: 'Copper Kettle Films',
  toAddress: '12 Quay Lane, Bristol BS1 4DZ', invoicingEmail: 'accounts@copperkettle.co.uk',
  days: [
    bbDay({ date: '2026-08-04', type: 'Shoot', wrap: '19:00' }),
    bbDay({ date: '2026-08-05', type: 'Shoot', wrap: '19:45', tOut: 30, tBack: 30, pd: 3500 }),
    bbDay({ date: '2026-08-06', type: 'Shoot', wrap: '21:00' }),
  ],
};
// The solo twin: the decoded shoot rebuilt as explicit solo records (the
// import constructor's field mapping). Encoding it through the solo call
// shape must reproduce the BB link BYTE-FOR-BYTE.
const soloTwinOf = (shoot) => ({
  title: shoot.title, jobReference: shoot.jobReference, prodCo: shoot.prodCo,
  toAddress: shoot.toAddress, invoicingEmail: shoot.invoicingEmail,
  defaultDay: {}, dayDefaults: {}, crew: [],
  days: shoot.days.map((sd, i) => ({
    id: 'tw' + i, crewId: 'c1', date: sd.date, dayType: sd.dayType,
    callTime: sd.callTime, wrapTime: sd.wrapTime, wrapNextDay: sd.wrapNextDay,
    lunchStartTime: sd.lunchStartTime, lunchDurationMins: sd.lunchDurationMins,
    secondBreakStartTime: sd.secondBreakStartTime, secondBreakDurationMins: sd.secondBreakDurationMins,
    preCallTime: sd.preCallTime, travelOutMins: sd.travelOutMins, travelBackMins: sd.travelBackMins,
    miles: sd.miles, perDiemAmount: 0,
    expenses: sd.perDiemPence > 0
      ? [{ id: 'pd-tw' + i, presetId: 'builtin-perdiem', name: 'Per Diem', amount: sd.perDiemPence / 100, detail: '' }]
      : [],
  })),
});

async function main() {
  const eng = await loadSourceEngine();
  const { encodeShareLink, decodeShareLink } = eng;
  let pass = 0, fail = 0;
  const ok = (label, cond, detail) => {
    if (cond) { pass++; console.log(`  ✓ ${label}`); }
    else { fail++; console.log(`  ✗ FAIL ${label}${detail ? ' — ' + detail : ''}`); }
  };

  console.log('\nshare-link — the frozen v1 wire codec\n');
  const fixtureFragment = FIXTURE_LINK.split('#')[1];

  // ── The canonical fixture ─────────────────────────────────────────────────
  const dec = await decodeShareLink(fixtureFragment);
  ok('S1 the canonical fixture link decodes ok', dec && dec.ok === true);
  ok('S2 …to the exact fixture shoot object (pinned forever)', dec.ok && eq(dec.shoot, FIXTURE_SHOOT));

  // ── Round-trip through the shipped encoder ────────────────────────────────
  const encRes = await encodeShareLink(FIXTURE_PRODUCTION, FIXTURE_DAYS, FIXTURE_CREW);
  ok('S3 the shipped encoder encodes the fixture input', encRes && encRes.ok === true && encRes.url.startsWith('https://timemachineapp.co.uk/s#'));
  const encFragment = encRes.ok ? encRes.url.split('#')[1] : '';
  const rt = await decodeShareLink(encFragment);
  ok('S4 encode → decode round-trips to the exact fixture shoot', rt.ok && eq(rt.shoot, FIXTURE_SHOOT));
  if (process.env.SHARE_PIN_CAPTURE) { console.log('\nCAPTURED S5 FRAGMENT:\n' + encFragment + '\n'); process.exit(0); }
  ok('S5 encode-to-exact-string pin (this encoder, node context)', encFragment === PINNED_ENCODE_FRAGMENT,
    encFragment === PINNED_ENCODE_FRAGMENT ? '' : `got ${encFragment.slice(0, 40)}…`);
  let envParsed = null;
  try { envParsed = JSON.parse(zlib.inflateRawSync(Buffer.from(encFragment.replace(/-/g, '+').replace(/_/g, '/'), 'base64')).toString()); } catch (_) {}
  ok('S6 the encoded envelope parses to the frozen wire JSON (cross-implementation pin)', eq(envParsed, FIXTURE_ENVELOPE));

  // ── Version safety: refuse-newer, refuse-damaged, never guess ────────────
  const newer = clone(FIXTURE_ENVELOPE); newer.v = 2;
  ok('S7 v:2 refuses as NEWER (update message path), before any field read', eq(await decodeShareLink(fragOf(newer)), { ok: false, reason: 'newer' }));
  const v0 = clone(FIXTURE_ENVELOPE); v0.v = 0;
  const vStr = clone(FIXTURE_ENVELOPE); vStr.v = '1';
  ok('S8 v:0 and v:"1" refuse as damaged', eq(await decodeShareLink(fragOf(v0)), { ok: false, reason: 'damaged' }) && eq(await decodeShareLink(fragOf(vStr)), { ok: false, reason: 'damaged' }));
  const arity = clone(FIXTURE_ENVELOPE); arity.d[1] = arity.d[1].slice(0, 13);
  ok('S9 a 13-slot day tuple refuses as damaged (arity is the contract)', eq(await decodeShareLink(fragOf(arity)), { ok: false, reason: 'damaged' }));
  const nMis = clone(FIXTURE_ENVELOPE); nMis.n = 2;
  ok('S10 n !== d.length refuses as damaged', eq(await decodeShareLink(fragOf(nMis)), { ok: false, reason: 'damaged' }));
  ok('S11 a truncated fragment (messenger cut) refuses as damaged', eq(await decodeShareLink(fixtureFragment.slice(0, Math.floor(fixtureFragment.length * 0.6))), { ok: false, reason: 'damaged' }));
  ok('S12 a non-base64url character refuses as damaged', eq(await decodeShareLink(fixtureFragment + '!!'), { ok: false, reason: 'damaged' }));
  const over = clone(FIXTURE_ENVELOPE); over.d = Array.from({ length: 15 }, () => clone(FIXTURE_ENVELOPE.d[1])); over.n = 15;
  ok('S13 15 days refuses as damaged (decoder cap = encoder cap = 14)', eq(await decodeShareLink(fragOf(over)), { ok: false, reason: 'damaged' }));
  const nullPair = clone(FIXTURE_ENVELOPE); nullPair.d[0][5] = null; nullPair.d[0][6] = 5;
  ok('S14 2nd-break null-pairing violation refuses as damaged', eq(await decodeShareLink(fragOf(nullPair)), { ok: false, reason: 'damaged' }));
  const badTime = clone(FIXTURE_ENVELOPE); badTime.d[0][2] = '25:00';
  ok('S15 an out-of-range time refuses as damaged', eq(await decodeShareLink(fragOf(badTime)), { ok: false, reason: 'damaged' }));

  // ── Encoder-side guards ───────────────────────────────────────────────────
  const fifteen = Array.from({ length: 15 }, (_, i) => mkFixtureDay({ id: 'x' + i, date: `2026-09-${String(i + 1).padStart(2, '0')}`, dayType: 'Shoot', call: '08:00', lunchS: '13:00', lunchD: 60, wrap: '19:00', tOut: 0, tBack: 0, miles: 0, pd: 0 }));
  ok('S16 encoder refuses 15 days with reason cap (never a silent trim)', eq(await encodeShareLink(FIXTURE_PRODUCTION, fifteen, FIXTURE_CREW), { ok: false, reason: 'cap' }));
  ok('S17 encoder refuses an empty shoot', eq(await encodeShareLink(FIXTURE_PRODUCTION, [], FIXTURE_CREW), { ok: false, reason: 'empty' }));

  // ── BB extraction (B-pins) — source engine, then B1/B2 on the built ──────
  console.log('');
  const runBB = async (tag, E) => {
    const spanDays = E.extractCrewShareDays(BB_PRODUCTION, 'sam');
    const bbRes = await E.encodeShareLink(BB_PRODUCTION, spanDays, BB_CREW_SAM);
    const bbFrag = bbRes.ok ? bbRes.url.split('#')[1] : '';
    const bbDec = bbRes.ok ? await E.decodeShareLink(bbFrag) : { ok: false };
    ok(`B1${tag} BB extraction round-trips WORKED days to the exact expected shoot (rested + absent SKIPPED)`,
      bbRes.ok === true && bbDec.ok === true && eq(bbDec.shoot, BB_EXPECTED_SHOOT) && spanDays.length === 3,
      bbDec.ok ? `span ${spanDays.length}` : 'encode/decode failed');
    const twin = soloTwinOf(BB_EXPECTED_SHOOT);
    const twinRes = await E.encodeShareLink(twin, twin.days, { id: 'c1', name: 'Twin', role: 'Spark', bdr: 444, otCoef: 1.5, otRate: null, noOT: false });
    ok(`B2${tag} the BB link is BYTE-IDENTICAL to the solo link of the same days`,
      bbRes.ok && twinRes.ok === true && twinRes.url === bbRes.url,
      twinRes.ok ? `bb …${bbFrag.slice(-12)} vs solo …${(twinRes.url || '').split('#')[1]?.slice(-12)}` : 'twin encode failed');
    return { spanDays, bbRes, bbFrag, bbDec };
  };
  const { spanDays, bbRes, bbFrag, bbDec } = await runBB('/src', eng);

  const leaked = JSON.stringify(bbDec.ok ? bbDec.shoot : {});
  ok('B3 nothing BB-specific leaks (kit, other crew, non-per-diem expenses, names, rates)',
    bbDec.ok &&
    !/Radio kit|Parking|Sam Spark|Jo Gaffer|kitMoney|kitItems|bdr|06:00/.test(leaked) &&
    bbDec.shoot.days.every(d => eq(Object.keys(d).sort(), ['callTime', 'date', 'dayType', 'lunchDurationMins', 'lunchStartTime', 'miles', 'perDiemPence', 'preCallTime', 'secondBreakDurationMins', 'secondBreakStartTime', 'travelBackMins', 'travelOutMins', 'wrapNextDay', 'wrapTime'].sort())));

  const manyWorked = { ...BB_PRODUCTION, days: Array.from({ length: 15 }, (_, i) => ({ id: 'm' + i, crewId: 'sam', date: `2026-09-${String(i + 1).padStart(2, '0')}` })) };
  const samNever = { ...BB_PRODUCTION, days: [{ id: 'j1', crewId: 'jo', date: '2026-08-04' }, { id: 'j2', crewId: 'jo', date: '2026-08-05' }] };
  ok('B4 cap counts WORKED days; a member with no worked days refuses as empty',
    eq(await eng.encodeShareLink(manyWorked, eng.extractCrewShareDays(manyWorked, 'sam'), BB_CREW_SAM), { ok: false, reason: 'cap' }) &&
    eq(await eng.encodeShareLink(samNever, eng.extractCrewShareDays(samNever, 'sam'), BB_CREW_SAM), { ok: false, reason: 'empty' }) &&
    eq(await eng.encodeShareLink({ ...BB_PRODUCTION, days: [] }, eng.extractCrewShareDays({ ...BB_PRODUCTION, days: [] }, 'sam'), BB_CREW_SAM), { ok: false, reason: 'empty' }));

  let bbEnv = null;
  try { bbEnv = JSON.parse(zlib.inflateRawSync(Buffer.from(bbFrag.replace(/-/g, '+').replace(/_/g, '/'), 'base64')).toString()); } catch (_) {}
  ok('B5 every encoded tuple equals the direct resolveDay output (the detail-view match, executed)',
    !!bbEnv && spanDays.every((day, i) => {
      const r = eng.resolveDay(BB_PRODUCTION, day, BB_CREW_SAM);
      const t = bbEnv.d[i];
      return t[0] === r.date && t[2] === r.callTime && t[3] === r.lunchStartTime &&
        t[4] === Math.round(Number(r.lunchDurationMins) || 0) && t[8] === r.wrapTime &&
        t[1] === ['Shoot', 'Pre-light', 'Prep Day', 'Recce', 'Build Day', 'De-rig', 'Travel Day', 'Rest Day'].indexOf(r.dayType);
    }));

  const legacyProd = { ...BB_PRODUCTION, days: [{ id: 'L1', crewId: 'sam', date: '2026-08-04', truckCallTime: '05:30' }] };
  const legacyDec = await (async () => {
    const r = await eng.encodeShareLink(legacyProd, eng.extractCrewShareDays(legacyProd, 'sam'), BB_CREW_SAM);
    return r.ok ? eng.decodeShareLink(r.url.split('#')[1]) : { ok: false };
  })();
  ok('B6 a legacy truckCallTime pre-call travels (the calc pays it, so the link carries it)',
    legacyDec.ok === true && legacyDec.shoot.days[0].preCallTime === '05:30');

  // ── BLK6a: the per-crew share item is web-capable, via the ONE helper ──
  // Both CrewActionSheet mounts used to wrap onShareLink in an IS_NATIVE
  // ternary around a 15-line copy of the encode-and-deliver journey. The
  // copies collapsed onto shareShootLink (which owns both platforms'
  // delivery), so the item renders on web too. This pins BOTH mounts routed
  // through the helper and NEITHER gated on platform — restoring the ternary
  // at either mount reddens it.
  ok('BLK6a both CrewActionSheet mounts pass an UNCONDITIONAL onShareLink routed through shareShootLink (web-capable; no IS_NATIVE ternary)',
    (() => {
      const handlers = SRC_HTML.match(/onShareLink=\{[\s\S]*?\}\}/g) || [];
      const wired = handlers.filter(h => /await shareShootLink\(production, spanDays, /.test(h) && /extractCrewShareDays\(production, /.test(h));
      const gated = handlers.filter(h => /IS_NATIVE \?/.test(h));
      const nulled = /onShareLink=\{IS_NATIVE/.test(SRC_HTML);
      return wired.length === 2 && gated.length === 0 && !nulled;
    })());

  // ── BLK: the Best Boy bulk block (composer executed, format pinned) ──
  // Fixture: dave + jo share IDENTICAL days (the duplicate-URL case), priya
  // has none (the named-refusal case), marek is over the 14-day cap.
  const blkDay = (id, crewId, date) => ({ id, crewId, date, dayType: 'Shoot',
    callTime: '08:00', lunchStartTime: '13:00', lunchDurationMins: 60, wrapTime: '19:00' });
  const BLK_CREW = [
    { id: 'dave',  name: 'Dave Hollis',  role: 'Gaffer',   bdr: 480, otCoef: 1.5 },
    { id: 'priya', name: 'Priya Nair',   role: 'Best Boy', bdr: 420, otCoef: 1.5 },
    { id: 'jo',    name: 'Jo Whitfield', role: 'Spark',    bdr: 380, otCoef: 1.5 },
    { id: 'marek', name: 'Marek Kowalski', role: 'Spark',  bdr: 380, otCoef: 1.5 },
  ];
  const BLK_DAYS = [
    blkDay('d1', 'dave', '2026-09-07'), blkDay('d2', 'dave', '2026-09-08'),
    blkDay('j1', 'jo',   '2026-09-07'), blkDay('j2', 'jo',   '2026-09-08'),
    ...Array.from({ length: 15 }, (_, i) => blkDay('m' + i, 'marek', `2026-09-${String(7 + i).padStart(2, '0')}`)),
  ];
  const BLK_PRODUCTION = { id: 'pBLK', title: 'Meerkat Insurance Q4', prodCo: 'Bold Yolk Films Ltd',
    jobReference: 'MIQ4-2026-081', toAddress: '', invoicingEmail: '', crew: BLK_CREW, days: BLK_DAYS,
    bestBoyMode: true, dayDefaults: {}, startDate: '2026-09-07' };

  const blk = await eng.buildCrewShareLinkBlock(BLK_PRODUCTION);
  const blkLines = (blk && blk.text || '').split('\n');
  const URL_LINE = /^https:\/\/timemachineapp\.co\.uk\/s#[A-Za-z0-9_-]+$/;

  ok('BLK1 title first, then every crew member exactly once, BY NAME, in crew order - a refusing member is NAMED with a reason, never silently omitted',
    (() => {
      if (blkLines[0] !== 'Meerkat Insurance Q4') return false;
      const names = ['Dave Hollis', 'Priya Nair', 'Jo Whitfield', 'Marek Kowalski'];
      const idx = names.map(n => blkLines.findIndex(l => l === n || l.startsWith(n + ' - ')));
      const eachOnce = names.every((n, i) => blkLines.filter(l => l === n || l.startsWith(n + ' - ')).length === 1);
      const inOrder = idx.every((v, i) => v > 0 && (i === 0 || v > idx[i - 1]));
      const priya = blkLines.find(l => l.startsWith('Priya Nair - '));
      const marek = blkLines.find(l => l.startsWith('Marek Kowalski - '));
      return eachOnce && inOrder && priya === 'Priya Nair - no days to share yet'
        && marek === 'Marek Kowalski - over the 14-day link cap';
    })(), JSON.stringify(blkLines.slice(0, 12)));

  ok('BLK2 every URL line is a URL ENTIRE - anchored start to end, so no messenger linkifier can swallow an adjacent character into the fragment',
    (() => {
      const urlish = blkLines.filter(l => l.includes('timemachineapp.co.uk/s#'));
      return urlish.length === 2 && urlish.every(l => URL_LINE.test(l));
    })(), JSON.stringify(blkLines.filter(l => l.includes('/s#')).map(l => l.slice(-20))));

  ok('BLK3 each member URL equals encodeShareLink run directly on their extracted days - the composer cannot fork from the codec',
    await (async () => {
      const direct = await eng.encodeShareLink(BLK_PRODUCTION, eng.extractCrewShareDays(BLK_PRODUCTION, 'dave'), BLK_CREW[0]);
      const daveIdx = blkLines.indexOf('Dave Hollis');
      return direct.ok && daveIdx >= 0 && blkLines[daveIdx + 1] === direct.url;
    })());

  ok('BLK4 identical-day members keep their duplicate URLs - both present, byte-equal, unannotated (ruled: leave them, say nothing)',
    (() => {
      const daveIdx = blkLines.indexOf('Dave Hollis');
      const joIdx = blkLines.indexOf('Jo Whitfield');
      if (daveIdx < 0 || joIdx < 0) return false;
      const daveUrl = blkLines[daveIdx + 1], joUrl = blkLines[joIdx + 1];
      const clean = !/duplicate|same link|identical/i.test(blk.text);
      return URL_LINE.test(daveUrl) && daveUrl === joUrl && clean;
    })());

  const BLK_EMPTY = { ...BLK_PRODUCTION, days: [] };
  const blkEmpty = await eng.buildCrewShareLinkBlock(BLK_EMPTY);
  ok('BLK5 no member linkable: anyLinks false, every member still named - and the call site gates delivery on it (toast, no sheet)',
    blkEmpty.anyLinks === false
    && BLK_CREW.every(c => blkEmpty.text.includes(c.name + ' - no days to share yet'))
    && /if \(!anyLinks\) \{ showToast\?\.\('No one has days to share yet\.'\); return; \}/.test(SRC_HTML),
    `anyLinks=${blkEmpty.anyLinks}`);

  // BLK6b REWRITTEN when the placement moved (founder: the list placement was
  // his error - the bulk block belongs in the crew overview, beside the
  // per-crew link). The gates became STRUCTURAL: MultiCrewOverviewView only
  // renders for a Best Boy production inside the APA ProductionApp, so the
  // pin asserts the button lives INSIDE that component, unconditionally
  // rendered, no platform gate - and that the retired list-sheet copy is
  // GONE, so the action has exactly one home. The solo per-shoot item keeps
  // its own list-sheet placement, unchanged.
  ok('BLK6b the bulk Share links lives in the crew overview (structural BB+APA gates), platform-ungated, and the retired productions-list copy is gone',
    (() => {
      const overview = (SRC_HTML.match(/function MultiCrewOverviewView\([\s\S]*?\n    \}\n/) || [''])[0];
      const inOverview = /buildCrewShareLinkBlock\(production\)/.test(overview) && /Share links\s*<\/button>/.test(overview);
      const ungated = !/IS_NATIVE &&[^\n]*Share links/.test(overview);
      const listCopyGone = !/\{actionSheet\.bestBoyMode && agreementOf\(actionSheet\) === 'apa' && \(/.test(SRC_HTML);
      const soloItemStays = /\{!actionSheet\.bestBoyMode && agreementOf\(actionSheet\) === 'apa' && \(/.test(SRC_HTML);
      const oneCallSite = (SRC_HTML.match(/buildCrewShareLinkBlock\(/g) || []).length === 2;   // definition + the one call
      return inOverview && ungated && listCopyGone && soloItemStays && oneCallSite;
    })());

  const built = loadBuiltEngine();
  await runBB('/built', built);

  console.log(`\n${fail === 0 ? '✅ PASS' : '❌ FAIL'} — ${pass} passed, ${fail} failed\n`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
