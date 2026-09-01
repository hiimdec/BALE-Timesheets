#!/usr/bin/env node
/*
 * BuildKind pins - swiftc-compiled and EXECUTED, not read.
 *
 * The analytics isDebug flag decides which server-side bucket an event lands
 * in. Getting it wrong in either direction is expensive: stamp everything
 * release and the founder's own testing is indistinguishable from real usage;
 * stamp everything debug and the release dashboard is permanently empty.
 *
 * WHAT THIS COVERS AND WHAT IT CANNOT, stated so nobody mistakes a green run
 * for more than it is:
 *   COVERED - BuildKind.resolve's verdict for every combination of compile
 *     flag and receipt file name, run through the real Swift.
 *   NOT COVERED, AND NOT COVERABLE HERE - that a real TestFlight install
 *     actually writes a receipt named "sandboxReceipt". No test on this
 *     machine can produce one. That clause is verified BY HAND on the 15 Pro
 *     (MAINTENANCE.md, the 15 Pro walk list). A GREEN GATE IS NOT EVIDENCE
 *     FOR IT.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const LOGIC = path.join(ROOT, 'ios', 'App', 'App', 'BuildKind.swift');
const SHIM = path.join(ROOT, 'ios', 'App', 'App', 'BuildInfoPlugin.swift');

// [compile flag, receipt last component (null = no receipt), expected isDebug, expected reason]
const CASES = [
  ['debug build, no receipt',            true,  null,             true,  'debug'],
  ['debug build, sandbox receipt',       true,  'sandboxReceipt', true,  'debug'],
  ['debug build, App Store receipt',     true,  'receipt',        true,  'debug'],
  ['TESTFLIGHT: release + sandbox',      false, 'sandboxReceipt', true,  'testflight'],
  ['APP STORE: release + receipt',       false, 'receipt',        false, 'release'],
  ['release, no receipt at all',         false, null,             false, 'release'],
  ['release, unexpected receipt name',   false, 'somethingElse',  false, 'release'],
  ['case matters: SandboxReceipt',       false, 'SandboxReceipt', false, 'release'],
];

function generateMain() {
  const rows = CASES.map(([id, dbg, receipt, expDebug, expReason]) => {
    const r = receipt === null ? 'nil' : `"${receipt}"`;
    return `  run("${id.replace(/"/g, '\\"')}", ${dbg}, ${r}, ${expDebug}, "${expReason}")`;
  }).join('\n');
  return `import Foundation
func run(_ id: String, _ dbg: Bool, _ receipt: String?, _ expDebug: Bool, _ expReason: String) {
  let v = BuildKind.resolve(isDebugCompile: dbg, receiptLastComponent: receipt)
  if v.isDebug == expDebug && v.reason == expReason {
    print("OK \\(id)")
  } else {
    print("RED \\(id) - got isDebug=\\(v.isDebug) reason=\\(v.reason), expected isDebug=\\(expDebug) reason=\\(expReason)")
  }
}
${rows}
`;
}

function structuralChecks() {
  const logic = fs.readFileSync(LOGIC, 'utf8');
  const shim = fs.readFileSync(SHIM, 'utf8');
  const checks = [
    ['BK-S1 BuildKind imports Foundation ONLY - the swiftc harness depends on it, and a Capacitor import here would make the decision untestable off device',
      /^import Foundation$/m.test(logic) && !/import (Capacitor|UIKit|SwiftUI)/.test(logic)],
    ['BK-S2 the DECISION lives in the pure file, not the shim: the shim supplies the two inputs and forwards, and holds no branch of its own beyond the #if DEBUG it exists to read',
      /BuildKind\.resolve\(/.test(shim)
      && !/sandboxReceipt/.test(shim)
      // No runtime branch of its own: no if-statement, no ternary, no switch.
      // The one #if DEBUG is the compile-time flag it exists to read.
      && !/\bif\s*\(/.test(shim)
      && !/\?\s*[^.\n]*:/.test(shim.replace(/\?\./g, ''))
      && !/\bswitch\b/.test(shim)
      && (shim.match(/^\s*#if DEBUG$/gm) || []).length === 1],
    ['BK-S3 the shim reads the REAL receipt URL, not a stub',
      /Bundle\.main\.appStoreReceiptURL\?\.lastPathComponent/.test(shim)],
    ['BK-S4 the shim is registered with the bridge, or JS would silently fail toward debug for every user',
      /registerPluginInstance\(BuildInfoPlugin\(\)\)/.test(
        fs.readFileSync(path.join(ROOT, 'ios', 'App', 'App', 'MainViewController.swift'), 'utf8'))],
    ['BK-S5 the un-pinnable clause is LABELLED as such in the source, so nobody later reads a green gate as covering TestFlight',
      /NOT pinned and CANNOT BE/.test(logic) && /15 Pro/.test(logic)],
    ['BK-S6 both files are in the Xcode target - a file that compiles here but is absent from project.pbxproj ships nothing',
      (() => {
        const pbx = fs.readFileSync(path.join(ROOT, 'ios', 'App', 'App.xcodeproj', 'project.pbxproj'), 'utf8');
        return (pbx.match(/BuildKind\.swift/g) || []).length >= 4
          && (pbx.match(/BuildInfoPlugin\.swift/g) || []).length >= 4;
      })()],
  ];
  let bad = 0;
  for (const [name, ok] of checks) {
    console.log(`  ${ok ? '✓' : '✗'} ${name}`);
    if (!ok) bad++;
  }
  return bad;
}

function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-buildkind-'));
  const mainPath = path.join(tmp, 'main.swift');
  fs.writeFileSync(mainPath, generateMain());
  const bin = path.join(tmp, 'buildkindtest');
  try {
    cp.execSync(`swiftc -O "${LOGIC}" "${mainPath}" -o "${bin}"`, { stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    console.error('❌ BuildKind pins: swiftc compile FAILED\n' + String(e.stderr || e.message));
    process.exit(1);
  }
  let out = '';
  let execOk = true;
  try { out = cp.execSync(`"${bin}"`, { encoding: 'utf8' }); }
  catch (e) { out = String(e.stdout || ''); execOk = false; }
  const reds = out.split('\n').filter(l => l.startsWith('RED'));
  for (const l of reds) console.log('  ✗ ' + l.slice(4));
  const okCount = out.split('\n').filter(l => l.startsWith('OK ')).length;
  const structBad = structuralChecks();
  const total = CASES.length + 6;
  console.log('  NOTE: that TestFlight writes a receipt named "sandboxReceipt" is NOT');
  console.log('        pinned here and cannot be. Device-verified only - 15 Pro walk.');
  if (reds.length === 0 && execOk && structBad === 0 && okCount === CASES.length) {
    console.log(`✅ BuildKind pins: ${total} assertions (${okCount} executed through the real Swift, 6 structural)`);
    process.exit(0);
  }
  console.log(`❌ BuildKind pins: ${reds.length + structBad} failure(s) of ${total}`);
  process.exit(1);
}

main();
