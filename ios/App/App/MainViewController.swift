//
//  MainViewController.swift
//
//  Capacitor 8's iOS bridge only registers plugins listed in the generated
//  capacitor.config.json `packageClassList` (which is rebuilt from installed
//  npm packages on every `cap sync`) plus a handful of internal plugins. It
//  does NOT scan the Objective-C runtime for @objc/CAPBridgedPlugin classes,
//  so an app-embedded plugin like NativePdfPlugin is never picked up
//  automatically.
//
//  The supported way to register an app-embedded plugin is to subclass the
//  bridge view controller and override `capacitorDidLoad()` — the hook the
//  bridge calls right after creating the bridge and before loading the web
//  view (see CAPBridgeViewController). registerPluginInstance(_:) both adds
//  the plugin to the native bridge AND injects its JS proxy into the web view
//  (via JSExport), so window.Capacitor.Plugins.NativePdf becomes available to
//  the web layer with no separate JS registerPlugin() call needed.
//
//  Main.storyboard's view controller customClass points at this class
//  (customModule="App"), so this is the bridge VC the app actually runs.
//
//  ───────────────────────── NATIVE CHROME (Stage 2 skeleton) ─────────────────────────
//  An unstyled native top nav bar + bottom tab bar overlaid on the Capacitor
//  WKWebView, wired to the web's navigation through a two-way bridge:
//    native → web : raw evaluateJavaScript `tmNativeNav` CustomEvents
//                   (tab / back / settings / search)
//    web → native : NativeChromePlugin.update → applyChromeState(...)
//                   (title / backVisible / activeTab / tabBarVisible)
//  The bars are created HIDDEN with zero content insets; the web only calls
//  update() when its NATIVE_CHROME && IS_NATIVE flag is on, so a flag-off build
//  is visually unchanged (no bars, no inset). The NativeChromePlugin class is
//  co-located in this file (no new pbxproj entry needed for the skeleton).
//  Stage 3 owns styling (glass), the + button, persistence, and de-duping the
//  web's own inner-screen headers against this bar.
//

import UIKit
import WebKit
import Capacitor

class MainViewController: CAPBridgeViewController, UITabBarDelegate, UINavigationBarDelegate {

    private let navBar = UINavigationBar()
    private let navItem = UINavigationItem()
    private let tabBar = UITabBar()
    private var chromeEnabled = false
    private lazy var backButton = UIBarButtonItem(
        image: UIImage(systemName: "chevron.backward"), style: .plain, target: self, action: #selector(onBack))

    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        bridge?.registerPluginInstance(NativePdfPlugin())
        bridge?.registerPluginInstance(LiveActivityPlugin())
        bridge?.registerPluginInstance(CallSheetPlugin())
        bridge?.registerPluginInstance(AppIconPlugin())
        bridge?.registerPluginInstance(ShareSheetPlugin())
        bridge?.registerPluginInstance(NativeChromePlugin())
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        setupChrome()
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        // Capacitor owns the webview as the VC's content; keep the bars on top in case
        // the bridge relayouts / re-adds the webview after our viewDidLoad.
        view.bringSubviewToFront(navBar)
        view.bringSubviewToFront(tabBar)
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        applyContentInsets()
    }

    private func setupChrome() {
        // Top nav bar — sits just below the status bar; centered title + leading back
        // (hidden by default) + trailing settings/search. Plain, unstyled.
        navItem.rightBarButtonItems = [
            UIBarButtonItem(image: UIImage(systemName: "gearshape"), style: .plain, target: self, action: #selector(onSettings)),
            UIBarButtonItem(image: UIImage(systemName: "magnifyingglass"), style: .plain, target: self, action: #selector(onSearch)),
        ]
        navBar.items = [navItem]
        navBar.delegate = self
        navBar.translatesAutoresizingMaskIntoConstraints = false
        navBar.isHidden = true
        view.addSubview(navBar)

        // Bottom tab bar — 3 items (reuses the spike pattern). Pinned to the bottom edge
        // so it auto-grows to include the home-indicator inset.
        tabBar.items = [
            UITabBarItem(title: "Shoots", image: UIImage(systemName: "film"), tag: 0),
            UITabBarItem(title: "Invoices", image: UIImage(systemName: "doc.text"), tag: 1),
            UITabBarItem(title: "Stats", image: UIImage(systemName: "chart.bar"), tag: 2),
        ]
        tabBar.selectedItem = tabBar.items?.first
        tabBar.delegate = self
        tabBar.translatesAutoresizingMaskIntoConstraints = false
        tabBar.isHidden = true
        view.addSubview(tabBar)

        NSLayoutConstraint.activate([
            navBar.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            navBar.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            navBar.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            tabBar.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            tabBar.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            tabBar.bottomAnchor.constraint(equalTo: view.bottomAnchor),
        ])
    }

    // Inset the webview's scroll content so the page clears both bars — native owns the
    // insets now (the web drops its bottom-padding hack under native chrome). Only when
    // enabled; otherwise Capacitor's webview is left untouched (flag-off = unchanged).
    private func applyContentInsets() {
        guard chromeEnabled, let scroll = bridge?.webView?.scrollView else { return }
        scroll.contentInsetAdjustmentBehavior = .never
        let top = navBar.frame.maxY
        let bottom = tabBar.isHidden ? 0 : max(0, view.bounds.height - tabBar.frame.minY)
        let insets = UIEdgeInsets(top: top, left: 0, bottom: bottom, right: 0)
        scroll.contentInset = insets
        scroll.verticalScrollIndicatorInsets = insets
    }

    // MARK: - Web → native (NativeChromePlugin forwards here, main thread)

    func applyChromeState(title: String, backVisible: Bool, activeTab: String, tabBarVisible: Bool) {
        if !chromeEnabled {
            chromeEnabled = true
            navBar.isHidden = false
        }
        navItem.title = title
        navItem.leftBarButtonItem = backVisible ? backButton : nil
        tabBar.isHidden = !tabBarVisible
        let tag = activeTab == "invoices" ? 1 : (activeTab == "stats" ? 2 : 0)
        tabBar.selectedItem = tabBar.items?.first(where: { $0.tag == tag })
        view.bringSubviewToFront(navBar)
        view.bringSubviewToFront(tabBar)
        view.setNeedsLayout()
        applyContentInsets()
    }

    // MARK: - Native → web (one-way evaluateJavaScript hop, same lightweight path as the spike)

    private func dispatchNav(action: String, tab: String? = nil) {
        let detail = tab == nil ? "{ action: '\(action)' }" : "{ action: '\(action)', tab: '\(tab!)' }"
        let js = "window.dispatchEvent(new CustomEvent('tmNativeNav', { detail: \(detail) }))"
        bridge?.webView?.evaluateJavaScript(js, completionHandler: nil)
    }

    func tabBar(_ tabBar: UITabBar, didSelect item: UITabBarItem) {
        let tab = item.tag == 1 ? "invoices" : (item.tag == 2 ? "stats" : "shoots")
        dispatchNav(action: "tab", tab: tab)
    }
    @objc private func onBack() { dispatchNav(action: "back") }
    @objc private func onSettings() { dispatchNav(action: "settings") }
    @objc private func onSearch() { dispatchNav(action: "search") }

    // No UINavigationController, so tell the standalone bar it's top-attached (correct
    // hairline / background extension).
    func position(for bar: UIBarPositioning) -> UIBarPosition { .topAttached }
}

// ───────────────────────── NativeChromePlugin (web → native) ─────────────────────────
// Co-located with the bridge VC (no separate pbxproj entry for the skeleton). One
// consolidated `update` method carries the whole nav state; it forwards to the bridge
// VC on the main thread. Registered in MainViewController.capacitorDidLoad above.
@objc(NativeChromePlugin)
public class NativeChromePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NativeChromePlugin"
    public let jsName = "NativeChrome"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "update", returnType: CAPPluginReturnPromise),
    ]

    @objc func update(_ call: CAPPluginCall) {
        let title = call.getString("title") ?? ""
        let backVisible = call.getBool("backVisible") ?? false
        let activeTab = call.getString("activeTab") ?? "shoots"
        let tabBarVisible = call.getBool("tabBarVisible") ?? true
        DispatchQueue.main.async { [weak self] in
            (self?.bridge?.viewController as? MainViewController)?.applyChromeState(
                title: title, backVisible: backVisible, activeTab: activeTab, tabBarVisible: tabBarVisible)
            call.resolve()
        }
    }
}
