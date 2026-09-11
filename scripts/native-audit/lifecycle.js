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
 *
 * UIScene pins (2026.13 stop 2, founder-ruled 11 September 2026): the app
 * starts up through a scene now, on the STORYBOARD ROUTE - the scene manifest
 * names Main.storyboard, whose initial controller is MainViewController (the
 * eleven plugins, the chrome, the lifecycle plugin), and SceneDelegate.swift
 * builds no window and names no controller. The vendor's template builds a
 * second window around a plain CAPBridgeViewController, which boots with no
 * plugins and no chrome; SC4 exists so that shape can never come back
 * silently. STRUCTURAL, like the lifecycle pins (UIKit). The executed proof is
 * the simulator: one plugin.load line on a cold launch, the bars present.
 * TM_IOS_APP_DIR points the scene pins at a copy of ios/App for mutation runs.
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

// ── UIScene: the storyboard route ─────────────────────────────────────────────
const IOS_APP = process.env.TM_IOS_APP_DIR ? path.resolve(process.env.TM_IOS_APP_DIR) : path.join(ROOT, 'ios', 'App');
const readIos = (p) => fs.existsSync(path.join(IOS_APP, p)) ? fs.readFileSync(path.join(IOS_APP, p), 'utf8') : '';
const plistJson = (() => {
  try { return JSON.parse(require('child_process').execFileSync('plutil', ['-convert', 'json', '-o', '-', path.join(IOS_APP, 'App/Info.plist')], { encoding: 'utf8' })); }
  catch (e) { return null; }
})();
const manifest = plistJson && plistJson.UIApplicationSceneManifest;
const roleCfgs = manifest && manifest.UISceneConfigurations && manifest.UISceneConfigurations.UIWindowSceneSessionRoleApplication;
const sceneCfg = Array.isArray(roleCfgs) && roleCfgs.length === 1 ? roleCfgs[0] : null;

check('SC1 Info.plist declares exactly one scene configuration: the SceneDelegate class by module name, the Main storyboard, multiple scenes off',
  !!sceneCfg && manifest.UIApplicationSupportsMultipleScenes === false
  && sceneCfg.UISceneDelegateClassName === '$(PRODUCT_MODULE_NAME).SceneDelegate'
  && sceneCfg.UISceneStoryboardFile === 'Main'
  && sceneCfg.UISceneConfigurationName === 'Default Configuration',
  'manifest=' + JSON.stringify(manifest));

const storyboard = readIos('App/Base.lproj/Main.storyboard');
const initialId = (storyboard.match(/initialViewController="([^"]+)"/) || [])[1];
const initialClass = initialId ? (new RegExp('<viewController id="' + initialId + '"[^>]*customClass="([^"]+)"').exec(storyboard) || [])[1] : undefined;
check('SC2 Main.storyboard\'s initial view controller is MainViewController - the root controller is defined here and nowhere else',
  initialClass === 'MainViewController', 'initial=' + initialId + ' class=' + initialClass);

const sceneDelegate = readIos('App/SceneDelegate.swift');
check('SC3 SceneDelegate.swift exists, is the window-scene delegate with the window property UIKit fills, and forwards all three scene callbacks to the runtime proxy',
  /class SceneDelegate: UIResponder, UIWindowSceneDelegate \{/.test(sceneDelegate)
  && /var window: UIWindow\?/.test(sceneDelegate)
  && /func scene\(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene\.ConnectionOptions\) \{\s*SceneDelegateProxy\.shared\.scene\(scene, willConnectTo: session, options: connectionOptions\)\s*\}/.test(sceneDelegate)
  && /func scene\(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>\) \{\s*SceneDelegateProxy\.shared\.scene\(scene, openURLContexts: URLContexts\)\s*\}/.test(sceneDelegate)
  && /func scene\(_ scene: UIScene, continue userActivity: NSUserActivity\) \{\s*SceneDelegateProxy\.shared\.scene\(scene, continue: userActivity\)\s*\}/.test(sceneDelegate),
  'length ' + sceneDelegate.length);

check('SC4 SceneDelegate.swift builds no window and names no controller: no UIWindow(, no rootViewController, no makeKeyAndVisible, no CAPBridgeViewController, no MainViewController()',
  sceneDelegate.length > 0
  && !/UIWindow\(/.test(sceneDelegate) && !/rootViewController/.test(sceneDelegate) && !/makeKeyAndVisible/.test(sceneDelegate)
  && !/CAPBridgeViewController/.test(sceneDelegate) && !/MainViewController\(/.test(sceneDelegate),
  'window-building tokens present');

const appDelegate = readIos('App/AppDelegate.swift');
check('SC5 AppDelegate.swift hands scene connections to SceneDelegate and holds no URL or user-activity handler - delivery belongs to the scene, so a share-in that works proves the scene path served it',
  /func application\(_ application: UIApplication,\s*configurationForConnecting connectingSceneSession: UISceneSession,\s*options: UIScene\.ConnectionOptions\) -> UISceneConfiguration \{/.test(appDelegate)
  && /config\.delegateClass = SceneDelegate\.self/.test(appDelegate)
  && /@UIApplicationMain/.test(appDelegate)
  && !/open url:/.test(appDelegate) && !/continue userActivity:/.test(appDelegate) && !/ApplicationDelegateProxy/.test(appDelegate),
  'ad');

const pbx = readIos('App.xcodeproj/project.pbxproj');
const sdRef = (pbx.match(/([0-9A-F]{24}) \/\* SceneDelegate\.swift \*\/ = \{isa = PBXFileReference; lastKnownFileType = sourcecode\.swift; path = SceneDelegate\.swift; sourceTree = "<group>"; \};/) || [])[1];
const sdBuild = pbx.match(/([0-9A-F]{24}) \/\* SceneDelegate\.swift in Sources \*\/ = \{isa = PBXBuildFile; fileRef = ([0-9A-F]{24}) \/\* SceneDelegate\.swift \*\/; \};/) || [];
const appSources = (pbx.match(/504EC3001FED79650016851F \/\* Sources \*\/ = \{[\s\S]*?files = \(([\s\S]*?)\);/) || [])[1] || '';
const appGroup = (pbx.match(/504EC3061FED79650016851F \/\* App \*\/ = \{[\s\S]*?children = \(([\s\S]*?)\);/) || [])[1] || '';
check('SC6 project.pbxproj registers SceneDelegate.swift the way Xcode does: one canonical file reference, one build file pointing at it, in the App group and the App target\'s Sources phase only (six mentions: two per entry line, one per list line), no serialiser attribute, LastUpgradeCheck untouched',
  !!sdRef && sdBuild.length === 3 && sdBuild[2] === sdRef
  && appSources.includes(sdBuild[1] + ' /* SceneDelegate.swift in Sources */')
  && appGroup.includes(sdRef + ' /* SceneDelegate.swift */')
  && (pbx.match(/SceneDelegate\.swift/g) || []).length === 6
  && !/explicitFileType = undefined/.test(pbx)
  && /LastUpgradeCheck = 0920;/.test(pbx),
  'ref=' + sdRef + ' build=' + sdBuild[1] + ' mentions=' + (pbx.match(/SceneDelegate\.swift/g) || []).length);

check('SC7 Info.plist is still hand-formatted: the FORCE DARK reasoning above UIUserInterfaceStyle survived (a plist serialiser drops every comment)',
  /<!-- FORCE DARK \(founder-ruled, 2026-08-31\)[\s\S]*?-->\s*<key>UIUserInterfaceStyle<\/key>/.test(readIos('App/Info.plist')), 'comment');

console.log(bad === 0 ? `✅ lifecycle pins: ${total} assertions` : `❌ lifecycle pins: ${bad} failure(s) of ${total}`);
process.exit(bad === 0 ? 0 : 1);
