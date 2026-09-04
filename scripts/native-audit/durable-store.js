#!/usr/bin/env node
/*
 * DurableStore pins - swiftc-compiled and EXECUTED in a temp directory (the BuildKind pattern).
 *
 * The record's atomic file: "saved" means saved. Executed: round trip, overwrite,
 * stat, remove, invalid keys, the directory created on first use. Structural: the
 * write is atomic, the store is Foundation-only, both files are in the target, the
 * plugin is registered and routes every method through the store, and the JS
 * adapter's durable list is the record alone.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const LOGIC = path.join(ROOT, 'ios', 'App', 'App', 'DurableStore.swift');
const PLUGIN = path.join(ROOT, 'ios', 'App', 'App', 'DurableStorePlugin.swift');
const CONTROLLER = path.join(ROOT, 'ios', 'App', 'App', 'MainViewController.swift');
const LA = path.join(ROOT, 'ios', 'App', 'App', 'LiveActivityPlugin.swift');

const MAIN = `import Foundation
func check(_ id: String, _ ok: Bool, _ got: String) { print(ok ? "OK \\(id)" : "RED \\(id) - got: \\(got)") }
let base = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("tm-durable-test-\\(UUID().uuidString)", isDirectory: true)
let key = "bigals_productions"
let v1 = "[{\\"id\\":\\"p1\\",\\"days\\":[{\\"date\\":\\"2026-09-04\\",\\"lunchDurationMins\\":1}]}]"
// DS1 first write creates the directory and the file; read returns the same bytes
let w1 = try! DurableStore.write(base: base, key: key, value: v1)
let r1 = DurableStore.read(base: base, key: key)
check("DS1 the first write creates the directory and the file, and the read returns the same bytes", FileManager.default.fileExists(atPath: DurableStore.directory(base: base).path) && r1?.value == v1 && w1.bytes == v1.utf8.count && r1?.info.bytes == v1.utf8.count, "read=\\(String(describing: r1?.value)) bytes=\\(w1.bytes)")
// DS2 stat reports the size and a current mtime
let s1 = DurableStore.stat(base: base, key: key)
let nowMs = Int(Date().timeIntervalSince1970 * 1000)
check("DS2 stat reports the size and an mtime within the last ten seconds", s1?.bytes == v1.utf8.count && s1.map { abs(nowMs - $0.mtimeMs) < 10_000 } == true, "stat=\\(String(describing: s1))")
// DS3 an overwrite replaces the whole file (no append, no leftover)
let v2 = "[{\\"id\\":\\"p1\\",\\"days\\":[{\\"date\\":\\"2026-09-04\\",\\"lunchDurationMins\\":60,\\"wrapped\\":true}]}]"
_ = try! DurableStore.write(base: base, key: key, value: v2)
let r2 = DurableStore.read(base: base, key: key)
check("DS3 an overwrite replaces the whole file - the read is the new value and only the new value", r2?.value == v2 && r2?.info.bytes == v2.utf8.count, "read=\\(String(describing: r2?.value))")
// DS4 a missing key reads nil and stats nil
check("DS4 a missing key reads nil and stats nil", DurableStore.read(base: base, key: "bigals_nothing") == nil && DurableStore.stat(base: base, key: "bigals_nothing") == nil, "-")
// DS5 invalid keys are refused (a key is a file name, never a path)
var threw = false
do { _ = try DurableStore.write(base: base, key: "../escape", value: "x") } catch { threw = true }
check("DS5 a key with a path in it is refused, and a slash, a space or an empty key yields no URL", threw && DurableStore.fileURL(base: base, key: "a/b") == nil && DurableStore.fileURL(base: base, key: "a b") == nil && DurableStore.fileURL(base: base, key: "") == nil && DurableStore.isValidKey("bigals_la_unapplied"), "threw=\\(threw)")
// DS6 remove deletes the file; a second remove is not an error
try! DurableStore.remove(base: base, key: key)
var second = true
do { try DurableStore.remove(base: base, key: key) } catch { second = false }
check("DS6 remove deletes the file, a read then returns nil, and removing again is not an error", DurableStore.read(base: base, key: key) == nil && second, "-")
// DS7 unicode survives the round trip byte for byte
let v3 = "[{\\"title\\":\\"Café £548.40 – night\\"}]"
_ = try! DurableStore.write(base: base, key: key, value: v3)
check("DS7 unicode survives the round trip", DurableStore.read(base: base, key: key)?.value == v3, "-")
try? FileManager.default.removeItem(at: base)
`;
const EXECUTED = 7;

function structuralChecks() {
  const logic = fs.readFileSync(LOGIC, 'utf8');
  const plugin = fs.readFileSync(PLUGIN, 'utf8');
  const ctrl = fs.readFileSync(CONTROLLER, 'utf8');
  const la = fs.readFileSync(LA, 'utf8');
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const pbx = fs.readFileSync(path.join(ROOT, 'ios', 'App', 'App.xcodeproj', 'project.pbxproj'), 'utf8');
  const checks = [
    ['DS-S1 THE WRITE IS ATOMIC: Data.write(to:options: .atomic) - a temp file then a rename, never a torn file', /try data\.write\(to: url, options: \.atomic\)/.test(logic)],
    ['DS-S2 DurableStore imports Foundation ONLY', /^import Foundation$/m.test(logic) && !/import (Capacitor|UIKit|SwiftUI)/.test(logic)],
    ['DS-S3 both files are in the Xcode target', (pbx.match(/DurableStore\.swift/g) || []).length >= 4 && (pbx.match(/DurableStorePlugin\.swift/g) || []).length >= 4],
    ['DS-S4 the plugin is registered with the bridge, and every method routes through DurableStore', /registerPluginInstance\(DurableStorePlugin\(\)\)/.test(ctrl)
      && /DurableStore\.write\(base: DurableStore\.appBase/.test(plugin) && /DurableStore\.read\(base: DurableStore\.appBase/.test(plugin) && /DurableStore\.stat\(base: DurableStore\.appBase/.test(plugin) && /DurableStore\.remove\(base: DurableStore\.appBase/.test(plugin)
      && ['write', 'read', 'stat', 'remove'].every(m => new RegExp(`CAPPluginMethod\\(name: "${m}"`).test(plugin))],
    ['DS-S5 the base is Application Support (backed up, never purged), not Caches or tmp', /urls\(for: \.applicationSupportDirectory, in: \.userDomainMask\)/.test(logic) && !/cachesDirectory/.test(logic)],
    ['DS-S6 THE SCOPE IS THE RECORD ALONE: the JS adapter\'s durable list is exactly [\'bigals_productions\']', /const DURABLE_KEYS = \['bigals_productions'\];/.test(html)],
    ['DS-S7 persist.landed now reports the record FILE (bytes, mtime) and synchronize() is gone from the confirm path', /DurableStore\.stat\(base: DurableStore\.appBase, key: "bigals_productions"\)/.test(la) && /record=file bytes=\\\(\$0\.bytes\) mtime=\\\(\$0\.mtimeMs\) applied=prefs ids=\\\(ids\.count\)/.test(la) && !/synchronize\(\)/.test(la)],
  ];
  let bad = 0;
  for (const [name, ok] of checks) { console.log(`  ${ok ? '✓' : '✗'} ${name}`); if (!ok) bad++; }
  return { bad, count: checks.length };
}

function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-durablestore-'));
  const mainPath = path.join(tmp, 'main.swift');
  fs.writeFileSync(mainPath, MAIN);
  const bin = path.join(tmp, 'durablestoretest');
  try {
    cp.execSync(`swiftc -O "${LOGIC}" "${mainPath}" -o "${bin}"`, { stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    console.error('❌ DurableStore pins: swiftc compile FAILED\n' + String(e.stderr || e.message));
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
    console.log(`✅ DurableStore pins: ${total} assertions (${okCount} executed through the real Swift, ${s.count} structural)`);
    process.exit(0);
  }
  console.log(`❌ DurableStore pins: ${reds.length + s.bad + (okCount === EXECUTED ? 0 : 1)} failure(s) of ${total}`);
  process.exit(1);
}

main();
