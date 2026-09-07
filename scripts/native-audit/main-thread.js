#!/usr/bin/env node
'use strict';
/*
 * Main-thread pins (founder-ruled 8 September 2026): no synchronous system
 * call on the main thread.
 *
 * The 4 September watchdog file (0x8BADF00D, process-exit, Background, zero
 * application CPU across the five seconds) is a process that could not answer
 * a graceful termination. The graceful path delivers the request on the main
 * thread; a main thread parked in a synchronous system round trip cannot take
 * it. The code held three such round trips on that thread: the diagnostics
 * ring's App Group UserDefaults read-modify-write (cfprefsd, on every native
 * tap), ActivityKit's registry read and request in the Live Activity start
 * path, and WebKit's print pagination (export only; unchanged, noted). The
 * first two now run on serial queues of their own; the readers of the ring go
 * through the same queue so ordering holds; the intents flush the queue before
 * returning so a suspension cannot eat a queued line.
 *
 * STRUCTURAL, stated plainly: TimeMachineIntents.swift and LiveActivityPlugin
 * .swift import ActivityKit, AppIntents and Capacitor, which swiftc cannot
 * compile here, so these pins read the source. The Xcode build proves it
 * compiles; the behaviour is a device-walk item (a ring export after a burst
 * of taps reads in order; a Live Activity starts from a fresh mount).
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const intents = read('ios/App/TimeMachineWidget/TimeMachineIntents.swift');
const la = read('ios/App/App/LiveActivityPlugin.swift');
const mvc = read('ios/App/App/MainViewController.swift');
const appSwift = fs.readdirSync(path.join(ROOT, 'ios/App/App')).filter(f => f.endsWith('.swift')).map(f => [f, read('ios/App/App/' + f)]);
const widgetSwift = fs.readdirSync(path.join(ROOT, 'ios/App/TimeMachineWidget')).filter(f => f.endsWith('.swift')).map(f => [f, read('ios/App/TimeMachineWidget/' + f)]);

let bad = 0, total = 0;
function check(name, cond, detail) {
  total++;
  if (cond) console.log('  ✓ ' + name);
  else { bad++; console.log('  ✗ ' + name + (detail ? '  [' + detail + ']' : '')); }
}

// MT1: dbg takes the timestamp on the caller, then does ALL of its App Group work inside diagQueue.async.
const dbgBody = (intents.match(/static func dbg\(_ tag: String, _ detail: String = "", always: Bool = false\) \{\n([\s\S]*?)\n    \}\n/) || [])[1] || '';
check('MT1 dbg: the timestamp is the caller\'s, and every UserDefaults access sits inside diagQueue.async (the ring never runs a cfprefsd round trip on the calling thread)',
  /^\s*let stamp = dbgFormatter\.string\(from: Date\(\)\)[^\n]*\n\s*diagQueue\.async \{/.test(dbgBody)
  && dbgBody.indexOf('UserDefaults(suiteName: appGroupSuite)') > dbgBody.indexOf('diagQueue.async {')
  && (dbgBody.match(/UserDefaults\(/g) || []).length === 1
  && /static let diagQueue = DispatchQueue\(label: "uk\.co\.timemachineapp\.diagnostics"/.test(intents),
  'dbg body: ' + dbgBody.slice(0, 120).replace(/\n/g, ' '));

// MT2: the Live Activity start path dispatches to its own serial queue, never to main.
const startBody = (la.match(/@objc func startActivity\(_ call: CAPPluginCall\) \{([\s\S]*?)\n    \}\n\n    \/\/ MARK: - update/) || [])[1] || '';
check('MT2 startActivity: dispatches to Self.laQueue.async and contains no DispatchQueue.main (ActivityKit\'s registry read, request and state reads leave the main thread)',
  /Self\.laQueue\.async \{/.test(startBody) && !/DispatchQueue\.main/.test(startBody)
  && /private static let laQueue = DispatchQueue\(label: "uk\.co\.timemachineapp\.liveactivity"/.test(la),
  'start body has main=' + /DispatchQueue\.main/.test(startBody));

// MT3: the ring's readers and the flag writer are ordered through the same queue.
const method = (name) => (la.match(new RegExp('@objc func ' + name + '\\(_ call: CAPPluginCall\\) \\{([\\s\\S]*?)\\n    \\}')) || [])[1] || '';
check('MT3 the four diagnostics accessors (setDebugLogging, getDebugLogging, getDiagnostics, clearDiagnostics) each run their App Group work inside TMLiveActivity.diagQueue.async',
  ['setDebugLogging', 'getDebugLogging', 'getDiagnostics', 'clearDiagnostics'].every(n => /TMLiveActivity\.diagQueue\.async \{/.test(method(n))),
  ['setDebugLogging', 'getDebugLogging', 'getDiagnostics', 'clearDiagnostics'].map(n => n + '=' + /TMLiveActivity\.diagQueue\.async/.test(method(n))).join(' '));

// MT4: the chrome-state stamp and the export read leave the main thread; the sheet presents on main.
check('MT4 MainViewController: the chrome stamp writes inside TMLiveActivity.diagQueue.async, the export reads the ring inside it and presents the sheet from DispatchQueue.main.async, and no other UserDefaults(suiteName:) access remains in the file',
  /let at = stamp\.string\(from: Date\(\)\)\n[\s\S]{0,200}?TMLiveActivity\.diagQueue\.async \{\n\s*UserDefaults\(suiteName: TMLiveActivity\.appGroupSuite\)\?\.set\(/.test(mvc)
  && /TMLiveActivity\.diagQueue\.async \{\n\s*let snap = DiagnosticsExport\.snapshot\([\s\S]{0,900}?DispatchQueue\.main\.async \{ \[weak self\] in[\s\S]{0,400}?\.present\(av, animated: true\)/.test(mvc)
  && (mvc.match(/UserDefaults\(suiteName:/g) || []).length === 1,
  'suite sites=' + (mvc.match(/UserDefaults\(suiteName:/g) || []).length);

// MT5: no synchronous hop onto the main thread anywhere in either target.
const mainSync = [...appSwift, ...widgetSwift].filter(([, src]) => /DispatchQueue\.main\.sync\b/.test(src)).map(([f]) => f);
check('MT5 no DispatchQueue.main.sync in the app or the widget sources', mainSync.length === 0, 'found in ' + mainSync.join(', '));

// MT6: every LiveActivityIntent perform() flushes the ring before every return.
const performs = intents.split(/func perform\(\) async throws -> some IntentResult \{/).slice(1);
const flushOk = performs.length === 3 && performs.every(p => {
  const body = p.split('\n    }\n}')[0];
  const returns = (body.match(/return \.result\(\)/g) || []).length;
  const flushes = (body.match(/await TMLiveActivity\.dbgFlush\(\)/g) || []).length;
  return returns > 0 && flushes === returns;
});
check('MT6 the three LiveActivityIntent perform() bodies await TMLiveActivity.dbgFlush() before EVERY return (a queued line must land before the suspension that follows the intent)',
  flushOk && /static func dbgFlush\(\) async \{/.test(intents),
  'performs=' + performs.length);

console.log(bad === 0 ? `✅ main-thread pins: ${total} assertions` : `❌ main-thread pins: ${bad} failure(s) of ${total}`);
process.exit(bad === 0 ? 0 : 1);
