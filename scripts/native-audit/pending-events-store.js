#!/usr/bin/env node
/*
 * PendingEventsStore pins - swiftc-compiled and EXECUTED, not read (the BuildKind pattern).
 *
 * The App Group event queue's hand-over is where a lost card press became a lost
 * curtail (3 September 2026): the old drain deleted at hand-over. The store makes
 * the hand-over at-least-once. Every clause that makes that safe is executed here
 * through the real Swift: dedupe, oldest-press-first, the age cap, a claim that
 * survives to the re-hand, and confirm as the only remover.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const LOGIC = path.join(ROOT, 'ios', 'App', 'App', 'PendingEventsStore.swift');
const PLUGIN = path.join(ROOT, 'ios', 'App', 'App', 'LiveActivityPlugin.swift');
const INTENTS = path.join(ROOT, 'ios', 'App', 'TimeMachineWidget', 'TimeMachineIntents.swift');

const MAIN = `import Foundation
func ev(_ id: String, _ ts: Int, _ type: String = "lunchCurtail") -> [String: Any] { ["id": id, "type": type, "ts": ts, "productionId": "p1", "date": "2026-09-03", "at": "13:58"] }
func ids(_ xs: [[String: Any]]) -> [String] { xs.map { PendingEventsStore.id($0) } }
func check(_ id: String, _ ok: Bool, _ got: String) { print(ok ? "OK \\(id)" : "RED \\(id) - got: \\(got)") }
let now = 1_788_530_400_000   // 2026-09-04 14:00:00 UTC, ms
let cap = PendingEventsStore.ageCapMs
// PE1 a pending event is handed AND kept in flight, stamped once, hands=1
let d1 = PendingEventsStore.drain(pending: [ev("a", now - 1000)], inflight: [], nowMs: now)
check("PE1 pending moves to in-flight and is handed, handedAt=now hands=1", ids(d1.hand) == ["a"] && ids(d1.inflight) == ["a"] && (d1.inflight[0]["handedAt"] as? Int) == now && (d1.inflight[0]["hands"] as? Int) == 1 && d1.expired.isEmpty, "hand=\\(ids(d1.hand)) inflight=\\(ids(d1.inflight))")
// PE2 the same id pending twice is handed once
let d2 = PendingEventsStore.drain(pending: [ev("a", now - 1000), ev("a", now - 900)], inflight: [], nowMs: now)
check("PE2 a duplicate id in pending is handed once", ids(d2.hand) == ["a"] && d2.inflight.count == 1, "hand=\\(ids(d2.hand))")
// PE3 an unconfirmed in-flight event is handed AGAIN, hands bumps, handedAt kept
let d3 = PendingEventsStore.drain(pending: [], inflight: d1.inflight, nowMs: now + 60_000)
check("PE3 an unconfirmed event is re-handed on the next drain with hands=2 and its original handedAt", ids(d3.hand) == ["a"] && (d3.inflight[0]["hands"] as? Int) == 2 && (d3.inflight[0]["handedAt"] as? Int) == now, "hands=\\(String(describing: d3.inflight.first?["hands"]))")
// PE4 oldest press first regardless of arrival
let d4 = PendingEventsStore.drain(pending: [ev("late", now - 100), ev("early", now - 5000)], inflight: [ev("mid", now - 2000)], nowMs: now)
check("PE4 hand order is oldest press first, across pending and in-flight", ids(d4.hand) == ["early", "mid", "late"], "\\(ids(d4.hand))")
// PE5 expiry by press age: older than the cap leaves as expired, is not handed, is not kept
let d5 = PendingEventsStore.drain(pending: [ev("old", now - cap - 1)], inflight: [ev("stale", now - cap - 5000), ev("fresh", now - 10)], nowMs: now)
check("PE5 presses older than the cap leave as expired, never handed, never kept", ids(d5.expired).sorted() == ["old", "stale"] && ids(d5.hand) == ["fresh"] && ids(d5.inflight) == ["fresh"], "expired=\\(ids(d5.expired)) hand=\\(ids(d5.hand))")
// PE5b exactly the cap is NOT expired (strict)
let d5b = PendingEventsStore.drain(pending: [ev("edge", now - cap)], inflight: [], nowMs: now)
check("PE5b a press exactly at the cap is still handed (the test is strictly older)", ids(d5b.hand) == ["edge"] && d5b.expired.isEmpty, "hand=\\(ids(d5b.hand))")
// PE6 claim sets targetDate on the matching id only, and a re-hand carries it
let c6 = PendingEventsStore.claim(inflight: d4.inflight, targets: ["mid": "2026-09-02"])
let d6 = PendingEventsStore.drain(pending: [], inflight: c6, nowMs: now + 1)
let mid6 = d6.hand.first { PendingEventsStore.id($0) == "mid" }
let early6 = d6.hand.first { PendingEventsStore.id($0) == "early" }
check("PE6 claim stores targetDate on the claimed id only, and the next hand carries it", (mid6?["targetDate"] as? String) == "2026-09-02" && early6?["targetDate"] == nil, "mid=\\(String(describing: mid6?["targetDate"]))")
// PE7 confirm removes exactly the ids; unknown ids are ignored; it is the only remover
let c7 = PendingEventsStore.confirm(inflight: d4.inflight, ids: ["mid", "nope"])
let d7 = PendingEventsStore.drain(pending: [], inflight: c7, nowMs: now + 2)
check("PE7 confirm removes exactly the confirmed ids and a confirmed id never returns", ids(c7) == ["early", "late"] && ids(d7.hand) == ["early", "late"], "\\(ids(c7))")
// PE8 an empty drain is empty
let d8 = PendingEventsStore.drain(pending: [], inflight: [], nowMs: now)
check("PE8 nothing pending, nothing in flight: nothing handed, nothing expired", d8.hand.isEmpty && d8.inflight.isEmpty && d8.expired.isEmpty, "-")
// PE9 ts stored as Double (plist round trip) still orders and ages correctly
let dbl: [String: Any] = ["id": "dbl", "type": "wrapNow", "ts": Double(now - 3000), "productionId": "p1"]
let d9 = PendingEventsStore.drain(pending: [dbl, ev("int", now - 1000)], inflight: [], nowMs: now)
check("PE9 a Double ts (plist round trip) orders and ages like an Int", ids(d9.hand) == ["dbl", "int"], "\\(ids(d9.hand))")
`;
const EXECUTED = 10;

function structuralChecks() {
  const logic = fs.readFileSync(LOGIC, 'utf8');
  const plugin = fs.readFileSync(PLUGIN, 'utf8');
  const intents = fs.readFileSync(INTENTS, 'utf8');
  const pbx = fs.readFileSync(path.join(ROOT, 'ios', 'App', 'App.xcodeproj', 'project.pbxproj'), 'utf8');
  const drain = (() => { const a = plugin.indexOf('@objc func drainPendingEvents('); const b = plugin.indexOf('@objc func claimEvents('); return a > 0 && b > a ? plugin.slice(a, b) : ''; })();
  const confirm = (() => { const a = plugin.indexOf('@objc func confirmEvents('); const b = plugin.indexOf('\n    }\n', a); return a > 0 ? plugin.slice(a, b) : ''; })();
  const hold = (() => { const a = intents.indexOf('static func requestBackgroundDrain()'); const b = intents.indexOf('\n    }\n', a); return a > 0 ? intents.slice(a, b) : ''; })();
  const checks = [
    ['PE-S1 PendingEventsStore imports Foundation ONLY - the swiftc harness depends on it',
      /^import Foundation$/m.test(logic) && !/import (Capacitor|UIKit|SwiftUI|ActivityKit|AppIntents)/.test(logic)],
    ['PE-S2 the file is in the Xcode target',
      (pbx.match(/PendingEventsStore\.swift/g) || []).length >= 4],
    ['PE-S3 THE DRAIN MOVES, NEVER DELETES IN-FLIGHT: it builds the hand through PendingEventsStore.drain, writes in-flight BEFORE clearing pending, never removes the in-flight key, and returns events AND expired',
      drain.length > 0 && /PendingEventsStore\.drain\(pending: pending, inflight: inflight/.test(drain)
      && drain.indexOf('defaults.set(d.inflight, forKey: Self.inflightEventsKey)') < drain.indexOf('defaults.removeObject(forKey: Self.pendingEventsKey)')
      && !/removeObject\(forKey: Self\.inflightEventsKey\)/.test(plugin)
      && /call\.resolve\(\["events": d\.hand, "expired": d\.expired\]\)/.test(drain)],
    ['PE-S4 CONFIRM IS THE ONLY REMOVER and ends the hold: confirmEvents filters through PendingEventsStore.confirm and posts drainConfirmedName; claimEvents stores targets through PendingEventsStore.claim; both are registered plugin methods',
      /PendingEventsStore\.confirm\(inflight: inflight, ids: ids\)/.test(confirm)
      && /NotificationCenter\.default\.post\(name: TMLiveActivity\.drainConfirmedName, object: nil\)/.test(confirm)
      && /PendingEventsStore\.claim\(inflight: inflight, targets: targets\)/.test(plugin)
      && /CAPPluginMethod\(name: "claimEvents"/.test(plugin) && /CAPPluginMethod\(name: "confirmEvents"/.test(plugin)
      && (plugin.match(/forKey: Self\.inflightEventsKey\)/g) || []).length >= 3],
    ['PE-S5 THE HOLD ENDS ON CONFIRM, CAPPED: requestBackgroundDrain observes drainConfirmedName, waits through TMDrainWaiter with drainHoldCap (4s), and the blind 2.5s sleep is gone',
      /static let drainHoldCap: TimeInterval = 4\.0/.test(intents)
      && /addObserver\(forName: drainConfirmedName/.test(hold) && /waiter\.wait\(cap: drainHoldCap\)/.test(hold)
      && !/Task\.sleep\(nanoseconds: 2_500_000_000\)/.test(intents)
      && /final class TMDrainWaiter/.test(intents)],
  ];
  let bad = 0;
  for (const [name, ok] of checks) { console.log(`  ${ok ? '✓' : '✗'} ${name}`); if (!ok) bad++; }
  return { bad, count: checks.length };
}

function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-pendingstore-'));
  const mainPath = path.join(tmp, 'main.swift');
  fs.writeFileSync(mainPath, MAIN);
  const bin = path.join(tmp, 'pendingstoretest');
  try {
    cp.execSync(`swiftc -O "${LOGIC}" "${mainPath}" -o "${bin}"`, { stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    console.error('❌ PendingEventsStore pins: swiftc compile FAILED\n' + String(e.stderr || e.message));
    process.exit(1);
  }
  let out = '';
  let execOk = true;
  try { out = cp.execSync(`"${bin}"`, { encoding: 'utf8' }); }
  catch (e) { out = String(e.stdout || ''); execOk = false; }
  const reds = out.split('\n').filter(l => l.startsWith('RED'));
  for (const l of reds) console.log('  ✗ ' + l.slice(4));
  const okCount = out.split('\n').filter(l => l.startsWith('OK ')).length;
  const s = structuralChecks();
  const total = EXECUTED + s.count;
  if (reds.length === 0 && execOk && s.bad === 0 && okCount === EXECUTED) {
    console.log(`✅ PendingEventsStore pins: ${total} assertions (${okCount} executed through the real Swift, ${s.count} structural)`);
    process.exit(0);
  }
  console.log(`❌ PendingEventsStore pins: ${reds.length + s.bad + (okCount === EXECUTED ? 0 : 1)} failure(s) of ${total}`);
  process.exit(1);
}

main();
