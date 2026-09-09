#!/usr/bin/env node
'use strict';
/*
 * Lifecycle pins (watchdog items 2 and 3, founder-ruled 8 September 2026):
 * bounded background work and the lifecycle lines, plus the iCloud plugin's
 * cancel timer. STRUCTURAL - the files import Capacitor and UIKit, which
 * swiftc cannot compile off-device; the Xcode build proves they compile, and
 * the behaviour is a device-walk item (a ring export after backgrounding shows
 * background / background.done / foreground with the JS summary; a forced
 * termination shows terminate).
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const mvc = read('ios/App/App/MainViewController.swift');
const icloud = read('ios/App/App/ICloudBackupPlugin.swift');
const appSwift = fs.readdirSync(path.join(ROOT, 'ios/App/App')).filter(f => f.endsWith('.swift')).map(f => [f, read('ios/App/App/' + f)]);
const widgetSwift = fs.readdirSync(path.join(ROOT, 'ios/App/TimeMachineWidget')).filter(f => f.endsWith('.swift')).map(f => [f, read('ios/App/TimeMachineWidget/' + f)]);
const plugin = (mvc.match(/public class AppLifecyclePlugin: CAPPlugin, CAPBridgedPlugin \{([\s\S]*?)\n\}\n/) || [])[1] || '';
let bad = 0, total = 0;
function check(name, cond, detail) { total++; if (cond) console.log('  ✓ ' + name); else { bad++; console.log('  ✗ ' + name + (detail ? '  [' + detail + ']' : '')); } }

check('LC1 the lifecycle plugin exists, is registered with the bridge, and exposes exactly backgroundWorkDone',
  /bridge\?\.registerPluginInstance\(AppLifecyclePlugin\(\)\)/.test(mvc) && /public let jsName = "AppLifecycle"/.test(plugin)
  && (plugin.match(/CAPPluginMethod\(name: "/g) || []).length === 1 && /CAPPluginMethod\(name: "backgroundWorkDone"/.test(plugin),
  'plugin body length ' + plugin.length);

check('LC2 didEnterBackground begins ONE background task with an expiration handler that ends it, and writes the always-on lifecycle.background line with the remaining time',
  /didEnterBackgroundNotification[\s\S]{0,120}?self\?\.beginHold\(\)/.test(plugin)
  && /guard taskId == \.invalid else \{ return \}/.test(plugin)
  && /beginBackgroundTask\(withName: "tm\.background-work"\) \{ \[weak self\] in self\?\.endHold\(reason: "expired"\) \}/.test(plugin)
  && /TMLiveActivity\.dbg\("lifecycle\.background", "task=[^\n]*remaining=[^\n]*always: true\)/.test(plugin),
  'begin path');

check('LC3 the task ends exactly once, whichever comes first: the JS signal (done), foreground, expiry, or the fixed cap; endHold is idempotent and the only caller of endBackgroundTask',
  /backgroundWorkDone[\s\S]{0,400}?self\?\.endHold\(reason: "done"\)/.test(plugin)
  && /willEnterForegroundNotification[\s\S]{0,120}?self\?\.endHold\(reason: "foreground"\)/.test(plugin)
  && /asyncAfter\(deadline: \.now\(\) \+ Self\.backgroundHoldCap\)[\s\S]{0,200}?self\.endHold\(reason: "capped"\)/.test(plugin)
  && /static let backgroundHoldCap: TimeInterval = 20/.test(plugin)
  && /let id = taskId\n\s*guard id != \.invalid else \{/.test(plugin) && /taskId = \.invalid\n/.test(plugin)
  && (plugin.match(/endBackgroundTask\(/g) || []).length === 1,
  'end paths');

check('LC4 the three lifecycle lines are always-on (background, foreground, terminate, plus background.done and background.end), and the terminate line\'s landing is waited for with a bound of at most one second - the only DispatchSemaphore in either target',
  /"lifecycle\.foreground"/.test(plugin) && /"lifecycle\.terminate"/.test(plugin) && /"lifecycle\.background\.done"/.test(plugin) && /"lifecycle\.background\.end"/.test(plugin)
  && (plugin.match(/always: true/g) || []).length >= 5
  && /static let terminateFlushBound: TimeInterval = 0\.5/.test(plugin)
  && /landed\.wait\(timeout: \.now\(\) \+ Self\.terminateFlushBound\)/.test(plugin)
  && [...appSwift, ...widgetSwift].filter(([, s]) => /DispatchSemaphore\(/.test(s)).map(([f]) => f).join(',') === 'MainViewController.swift',
  'semaphores in: ' + [...appSwift, ...widgetSwift].filter(([, s]) => /DispatchSemaphore\(/.test(s)).map(([f]) => f).join(','));

check('LC5 every iCloud coordination runs under the cancel timer: one NSFileCoordinator is made inside coordinated(), the three calls (write, read, delete) go through it, the timer is 15 s and writes the always-on icloud.timeout line',
  (icloud.match(/NSFileCoordinator\(filePresenter: nil\)/g) || []).length === 1
  && /private func coordinated\(_ what: String, _ body: \(NSFileCoordinator\) -> Void\)/.test(icloud)
  && (icloud.match(/self\.coordinated\("(write|read|delete)"\) \{ c in c\.coordinate\(/g) || []).length === 3
  && (icloud.match(/\.coordinate\(/g) || []).length === 3
  && /static let coordinateTimeout: TimeInterval = 15/.test(icloud)
  && /cancelQueue\.asyncAfter\(deadline: \.now\(\) \+ Self\.coordinateTimeout, execute: cancel\)/.test(icloud)
  && /coordinator\.cancel\(\)\n\s*TMLiveActivity\.dbg\("icloud\.timeout"[^\n]*always: true\)/.test(icloud)
  && /body\(coordinator\)\n\s*cancel\.cancel\(\)/.test(icloud),
  'coordinate sites=' + (icloud.match(/\.coordinate\(/g) || []).length);

check('LC6 the container URL is cached after the first success, on the plugin\'s own queue, so the daemon round trip runs once per process',
  /private var cachedRoot: URL\?/.test(icloud)
  && /if let root = cachedRoot \{ return root \}\n\s*let root = FileManager\.default\.url\(forUbiquityContainerIdentifier: Self\.containerId\)\n\s*if root != nil \{ cachedRoot = root \}/.test(icloud),
  'cache');

console.log(bad === 0 ? `✅ lifecycle pins: ${total} assertions` : `❌ lifecycle pins: ${bad} failure(s) of ${total}`);
process.exit(bad === 0 ? 0 : 1);
