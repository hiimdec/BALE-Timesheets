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
 * Wiring: audit:build (after theme-parity) · standalone audit:share.
 * Exit code: 0 all pass, 1 any fail, 2 harness error.
 */

const zlib = require('zlib');
const { loadSourceEngine } = require('./load-engines');

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

  console.log(`\n${fail === 0 ? '✅ PASS' : '❌ FAIL'} — ${pass} passed, ${fail} failed\n`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
