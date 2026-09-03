#!/usr/bin/env node
/*
 * DiagnosticsExport pins - swiftc-compiled and EXECUTED, not read (the BuildKind pattern).
 *
 * The diagnostics file is the evidence for the failure mode where the web layer is
 * dead and Settings cannot be reached. Two native routes build it (the nav-bar press
 * and the Share Diagnostics App Shortcut), both through DiagnosticsExport, so the
 * TEXT is pinned here once, through the real Swift.
 *
 * THE CHROME LINE (DX6a-e) is pinned as its OWN executed clause, never folded into a
 * generic header check: it is the one line that says whether the bars were hidden
 * when the buttons died - the direct evidence the 3 September incident lacked.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const LOGIC = path.join(ROOT, 'ios', 'App', 'App', 'DiagnosticsExport.swift');
const CONTROLLER = path.join(ROOT, 'ios', 'App', 'App', 'MainViewController.swift');
const INTENTS = path.join(ROOT, 'ios', 'App', 'App', 'TimeMachineAppShortcuts.swift');

const MAIN = `import Foundation
let tz = TimeZone(identifier: "Europe/London")!
let at = Date(timeIntervalSince1970: 1788530400)   // 2026-09-04 14:00:00 UTC = 15:00 BST
let known = DiagnosticsChromeState(title: "Shoots", backVisible: false, tabBarVisible: true, chromeHidden: false, at: "2026-09-04T14:59:58+01:00")
let hidden = DiagnosticsChromeState(title: "What's new", backVisible: false, tabBarVisible: false, chromeHidden: true, at: "2026-09-04T14:59:59+01:00")
func meta(_ on: Bool, _ c: DiagnosticsChromeState?) -> DiagnosticsExportMeta {
  DiagnosticsExportMeta(appVersion: "2026.12", build: "12", osVersion: "26.0.1", deviceModel: "iPhone16,1", exportedAt: at, timeZone: tz, diagnosticsEnabled: on, chrome: c)
}
let lines = ["2026-09-04 14:58:01.000 | nav.native | action=settings",
             "2026-09-04 14:58:01.004 | js | nav.settings",
             "2026-09-04 14:58:09.120 | webview.TERMINATED | content process died; Capacitor reloads next"]
func split(_ s: String) -> [String] { s.components(separatedBy: "\\n") }
func check(_ id: String, _ ok: Bool, _ got: String) { print(ok ? "OK \\(id)" : "RED \\(id) - got: \\(got)") }
let full = split(DiagnosticsExport.text(lines: lines, meta: meta(true, known)))
let off = split(DiagnosticsExport.text(lines: lines, meta: meta(false, known)))
let hid = split(DiagnosticsExport.text(lines: lines, meta: meta(true, hidden)))
let none = split(DiagnosticsExport.text(lines: lines, meta: meta(true, nil)))
let empty = split(DiagnosticsExport.text(lines: [], meta: meta(false, nil)))
check("DX1 the first line names the app", full[0] == "TimeMachine diagnostics", full[0])
check("DX2 app, build, iOS and device on one line", full[1] == "app 2026.12 (12) | iOS 26.0.1 | iPhone16,1", full[1])
check("DX3 the export stamp carries its offset and zone, and says the lines are local", full[2] == "exported 2026-09-04T15:00:00+01:00 (Europe/London; log lines are local time)", full[2])
check("DX4a the flag line, on, with the always-on note", full[3] == "diagnostics logging: on (navigation, render and termination lines are recorded regardless)", full[3])
check("DX4b the flag line, off", off[3] == "diagnostics logging: off (navigation, render and termination lines are recorded regardless)", off[3])
check("DX5 the line count against the cap", full[4] == "lines: 3 of 300", full[4])
check("DX6a THE CHROME LINE, known state: sixth line, exact, chromeHidden=false", full[5] == "chrome | title=\\"Shoots\\" back=false tabBar=true chromeHidden=false | at 2026-09-04T14:59:58+01:00", full[5])
check("DX6b THE CHROME LINE says chromeHidden=true when the bars were hidden", hid[5] == "chrome | title=\\"What's new\\" back=false tabBar=false chromeHidden=true | at 2026-09-04T14:59:59+01:00", hid[5])
check("DX6c THE CHROME LINE says none recorded, never blank, when nothing was ever mirrored", none[5] == "chrome | none recorded", none[5])
let parsed = DiagnosticsExport.chromeState(dict: ["title": "Shoots", "back": true, "tabBar": false, "chromeHidden": true, "at": "2026-09-04T14:59:57+01:00"])
check("DX6d THE CHROME LINE reads the mirror's five keys exactly as applyChromeState writes them", DiagnosticsExport.chromeLine(parsed) == "chrome | title=\\"Shoots\\" back=true tabBar=false chromeHidden=true | at 2026-09-04T14:59:57+01:00", DiagnosticsExport.chromeLine(parsed))
check("DX6e a missing mirror parses to nil, and a mirror without chromeHidden reads false, not true", DiagnosticsExport.chromeState(dict: nil) == nil && DiagnosticsExport.chromeState(dict: ["title": "x"])?.chromeHidden == false, "parsed")
check("DX7 the separator, then the ring verbatim in order, then one trailing newline", full[6] == "---" && full[7] == lines[0] && full[8] == lines[1] && full[9] == lines[2] && full.count == 11 && full[10] == "", full.joined(separator: " / "))
check("DX8a an empty ring still gets the whole header, then No lines yet", empty[4] == "lines: 0 of 300" && empty[5] == "chrome | none recorded" && empty[6] == "---" && empty[7] == "No lines yet." && empty.count == 9, empty.joined(separator: " / "))
check("DX8b the dialog for none, one and many", DiagnosticsExport.dialog(lineCount: 0) == "Nothing logged yet - the file has the version header only." && DiagnosticsExport.dialog(lineCount: 1) == "Shared 1 diagnostic line." && DiagnosticsExport.dialog(lineCount: 212) == "Shared 212 diagnostic lines.", DiagnosticsExport.dialog(lineCount: 0))
check("DX9 the file name is dated to the minute in the export zone", DiagnosticsExport.fileName(at: at, timeZone: tz) == "TimeMachine-diagnostics-20260904-1500.txt", DiagnosticsExport.fileName(at: at, timeZone: tz))
`;
const EXECUTED = 15;

function structuralChecks() {
  const logic = fs.readFileSync(LOGIC, 'utf8');
  const ctrl = fs.readFileSync(CONTROLLER, 'utf8');
  const intents = fs.readFileSync(INTENTS, 'utf8');
  const pbx = fs.readFileSync(path.join(ROOT, 'ios', 'App', 'App.xcodeproj', 'project.pbxproj'), 'utf8');
  const present = (() => { const a = ctrl.indexOf('private func presentDiagnosticsShare('); const b = ctrl.indexOf('\n    }\n', a); return a > 0 ? ctrl.slice(a, b) : ''; })();
  const perform = (() => { const a = intents.indexOf('struct ShareDiagnosticsIntent'); const b = intents.indexOf('\n}\n', a); return a > 0 ? intents.slice(a, b) : ''; })();
  const checks = [
    ['DX-S1 DiagnosticsExport imports Foundation ONLY - the swiftc harness depends on it, and UIKit or Capacitor here would make the text untestable off device',
      /^import Foundation$/m.test(logic) && !/import (Capacitor|UIKit|SwiftUI|AppIntents)/.test(logic)],
    ['DX-S2 the file is in the Xcode target - a file that compiles here but is absent from project.pbxproj ships nothing',
      (pbx.match(/DiagnosticsExport\.swift/g) || []).length >= 4],
    ['DX-S3 applyChromeState mirrors the APPLIED state under the export\'s key with the five keys the chrome line reads: title, back, tabBar, chromeHidden, at',
      (() => { const a = ctrl.indexOf('func applyChromeState('); const b = ctrl.indexOf('// MARK: - Diagnostics share'); const body = a > 0 && b > a ? ctrl.slice(a, b) : '';
        return /\["title": title, "back": backVisible, "tabBar": tabBarVisible, "chromeHidden": chromeHidden, "at": stamp\.string\(from: Date\(\)\)\],\s*forKey: DiagnosticsExport\.chromeStateKey\)/.test(body); })()],
    ['DX-S4 BOTH routes build through DiagnosticsExport.snapshot, and neither has an empty-ring exit: the press always presents, the intent always returns a file',
      /DiagnosticsExport\.snapshot\(/.test(present) && /DiagnosticsExport\.snapshot\(/.test(perform)
      && present.length > 0 && !/isEmpty/.test(present) && /present\(av, animated: true\)/.test(present)
      && perform.length > 0 && !/isEmpty|\bguard\b|\bthrow\b/.test(perform) && /\.result\(value: file, dialog:/.test(perform)],
  ];
  let bad = 0;
  for (const [name, ok] of checks) { console.log(`  ${ok ? '✓' : '✗'} ${name}`); if (!ok) bad++; }
  return { bad, count: checks.length };
}

function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-diagexport-'));
  const mainPath = path.join(tmp, 'main.swift');
  fs.writeFileSync(mainPath, MAIN);
  const bin = path.join(tmp, 'diagexporttest');
  try {
    cp.execSync(`swiftc -O "${LOGIC}" "${mainPath}" -o "${bin}"`, { stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    console.error('❌ DiagnosticsExport pins: swiftc compile FAILED\n' + String(e.stderr || e.message));
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
    console.log(`✅ DiagnosticsExport pins: ${total} assertions (${okCount} executed through the real Swift, ${s.count} structural)`);
    process.exit(0);
  }
  console.log(`❌ DiagnosticsExport pins: ${reds.length + s.bad + (okCount === EXECUTED ? 0 : 1)} failure(s) of ${total}`);
  process.exit(1);
}

main();
