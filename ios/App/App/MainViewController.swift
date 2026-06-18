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
    private var invoicesShown = true   // current tab set; rebuilt when the web's invoicing toggle flips
    private lazy var backButton = UIBarButtonItem(
        image: UIImage(systemName: "chevron.backward"), style: .plain, target: self, action: #selector(onBack))
    // Floating "+" create button (Rate-style): a SOLID blue circle (text-sky-500, the wordmark
    // blue — not invented), white glyph, ~56pt, subtle elevation so it reads as floating. Part
    // of the bottom chrome; the web drives visibility via `createButton` (Shoots root only).
    private lazy var fabButton: UIButton = {
        let b = UIButton(type: .custom)
        b.translatesAutoresizingMaskIntoConstraints = false
        b.backgroundColor = UIColor(red: 14.0/255.0, green: 165.0/255.0, blue: 233.0/255.0, alpha: 1)  // text-sky-500
        b.tintColor = .white
        b.setImage(UIImage(systemName: "plus", withConfiguration: UIImage.SymbolConfiguration(pointSize: 22, weight: .semibold)), for: .normal)
        b.layer.cornerRadius = 28        // 56pt diameter → circle
        b.layer.shadowColor = UIColor.black.cgColor
        b.layer.shadowOpacity = 0.3
        b.layer.shadowRadius = 8
        b.layer.shadowOffset = CGSize(width: 0, height: 4)
        b.isHidden = true
        b.addTarget(self, action: #selector(onCreate), for: .touchUpInside)
        return b
    }()

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

    // Tab set is driven by the web's invoicesTabVisible(userPrefs). Tags are STABLE
    // (Shoots 0 / Invoices 1 / Stats 2) regardless of which are present, so the active-tab
    // sync (by tag, below) never misaligns when Invoices is dropped.
    private func tabItems(invoices: Bool) -> [UITabBarItem] {
        var items = [UITabBarItem(title: "Shoots", image: UIImage(systemName: "film"), tag: 0)]
        if invoices { items.append(UITabBarItem(title: "Invoices", image: UIImage(systemName: "doc.text"), tag: 1)) }
        items.append(UITabBarItem(title: "Stats", image: UIImage(systemName: "chart.bar"), tag: 2))
        return items
    }

    private func setupChrome() {
        // Top nav bar — sits just below the status bar; centered title + leading back
        // (hidden by default) + trailing buttons. The trailing buttons are CONTEXT-AWARE
        // (set per update() in applyChromeState), so none are wired here.
        navBar.items = [navItem]
        navBar.delegate = self
        navBar.translatesAutoresizingMaskIntoConstraints = false
        navBar.isHidden = true
        // Opaque solid-black bar (matches the #0a0a0a app background) so content scrolling UNDER
        // it is hidden instead of ghosting through the translucent default (worst on Stats mid-
        // scroll). On the near-black app this blends with the bg at rest and reads clean on
        // scroll. Drop the hairline (shadowColor = clear) so there's no harsh edge on the black.
        // The bottom tab bar keeps its default glass look (no title to clash with).
        let barBg = UIColor(red: 10.0/255.0, green: 10.0/255.0, blue: 10.0/255.0, alpha: 1)  // #0a0a0a (bg-neutral-950)
        let navAppearance = UINavigationBarAppearance()
        navAppearance.configureWithOpaqueBackground()
        navAppearance.backgroundColor = barBg
        navAppearance.shadowColor = .clear
        navBar.standardAppearance = navAppearance
        navBar.scrollEdgeAppearance = navAppearance
        navBar.compactAppearance = navAppearance
        if #available(iOS 15.0, *) { navBar.compactScrollEdgeAppearance = navAppearance }
        navBar.isTranslucent = false
        view.addSubview(navBar)

        // Bottom tab bar — 3 items (reuses the spike pattern). Pinned to the bottom edge
        // so it auto-grows to include the home-indicator inset.
        tabBar.items = tabItems(invoices: invoicesShown)
        tabBar.selectedItem = tabBar.items?.first
        tabBar.delegate = self
        tabBar.translatesAutoresizingMaskIntoConstraints = false
        tabBar.isHidden = true
        view.addSubview(tabBar)

        // Floating + button — to the right of the tab bar, vertically aligned with the tab
        // items (centre ≈ 24.5pt below the bar's top, the item band), respecting the bottom
        // safe area (the bar carries the home-indicator inset below).
        view.addSubview(fabButton)

        NSLayoutConstraint.activate([
            navBar.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            navBar.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            navBar.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            tabBar.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            tabBar.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            tabBar.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            fabButton.widthAnchor.constraint(equalToConstant: 56),
            fabButton.heightAnchor.constraint(equalToConstant: 56),
            fabButton.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -16),
            fabButton.centerYAnchor.constraint(equalTo: tabBar.topAnchor, constant: 24.5),
        ])
    }

    // Full-screen webview: the bars OVERLAY it (content scrolls under them — the glass look).
    // We do NOT inset the scrollView — a contentInset made short pages overflow by the bar
    // heights and shoved fixed overlays (kebab/export sheet) off-screen. Instead push the
    // measured bar clearances to the web as CSS vars; the web owns its layout from them
    // (see the body.tm-native rules + the --sat/--sab sweep in index.html). --sat/--sab are
    // zeroed because the native bars cover the device safe area; --sab keeps the bottom safe
    // area only when the tab bar is hidden (nothing else covers the home indicator then).
    private func applyContentInsets() {
        guard chromeEnabled, let webView = bridge?.webView else { return }
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.scrollView.contentInset = .zero
        webView.scrollView.verticalScrollIndicatorInsets = .zero
        let top = navBar.frame.maxY
        let bottom = tabBar.isHidden ? view.safeAreaInsets.bottom : max(0, view.bounds.height - tabBar.frame.minY)
        let sab = tabBar.isHidden ? view.safeAreaInsets.bottom : 0
        let js = "document.documentElement.style.setProperty('--tm-native-top','\(top)px');"
            + "document.documentElement.style.setProperty('--tm-native-bottom','\(bottom)px');"
            + "document.documentElement.style.setProperty('--sat','0px');"
            + "document.documentElement.style.setProperty('--sab','\(sab)px');"
        webView.evaluateJavaScript(js, completionHandler: nil)
    }

    // MARK: - Web → native (NativeChromePlugin forwards here, main thread)

    func applyChromeState(title: String, backVisible: Bool, activeTab: String, tabBarVisible: Bool, trailing: [String], invoicesVisible: Bool,
                          wordmark: Bool = false, wordmarkName: String = "", createButton: Bool = false) {
        if !chromeEnabled {
            chromeEnabled = true
            navBar.isHidden = false
        }
        navItem.title = title
        // Tab roots get the custom two-line wordmark lockup as the titleView; pushed screens
        // (production name / Settings) fall back to the plain string title (titleView = nil).
        navItem.titleView = wordmark ? makeWordmarkLockup(name: wordmarkName) : nil
        navItem.leftBarButtonItem = backVisible ? backButton : nil
        // rightBarButtonItems lay out right-to-left (index 0 = rightmost); the web sends
        // them in that order. Unknown keys are dropped.
        navItem.rightBarButtonItems = trailing.compactMap { trailingButton(for: $0) }
        // Honour the web's invoicing toggle: rebuild the tab set when it flips.
        if invoicesVisible != invoicesShown {
            invoicesShown = invoicesVisible
            tabBar.items = tabItems(invoices: invoicesVisible)
        }
        tabBar.isHidden = !tabBarVisible
        // Sync by TAG (the tab NAME), not index — so dropping Invoices never highlights Stats as Invoices.
        let tag = activeTab == "invoices" ? 1 : (activeTab == "stats" ? 2 : 0)
        tabBar.selectedItem = tabBar.items?.first(where: { $0.tag == tag })
        // Floating + create button — Shoots root only.
        fabButton.isHidden = !createButton
        view.bringSubviewToFront(navBar)
        view.bringSubviewToFront(tabBar)
        view.bringSubviewToFront(fabButton)
        view.setNeedsLayout()
        applyContentInsets()
    }

    // Two-line centred wordmark lockup for the three tab roots, matching the web wordmark:
    //   line 1 (possessive)  — muted grey (text-neutral-500 = #737373), medium, wide tracking
    //                          (0.2em), ~0.52x the mark; omitted when there's no display name.
    //   line 2 (mark)        — signature blue (text-sky-500 = #0EA5E9), heavy, tight tracking.
    // System font, all caps, static. Colours are the literal web tokens (not invented).
    // Mark point size finalised at the Large value (19pt) after the on-device size review.
    private func makeWordmarkLockup(name: String) -> UIView {
        let mark: CGFloat = 19
        let possSize = (mark * 0.52).rounded()
        let blue = UIColor(red: 14.0/255.0, green: 165.0/255.0, blue: 233.0/255.0, alpha: 1)   // text-sky-500
        let grey = UIColor(red: 115.0/255.0, green: 115.0/255.0, blue: 115.0/255.0, alpha: 1)  // text-neutral-500

        let stack = UIStackView()
        stack.axis = .vertical
        stack.alignment = .center
        stack.spacing = 0
        stack.isUserInteractionEnabled = false

        if !name.isEmpty {
            let poss = UILabel()
            poss.attributedText = NSAttributedString(string: name.uppercased(), attributes: [
                .font: UIFont.systemFont(ofSize: possSize, weight: .medium),
                .foregroundColor: grey,
                .kern: possSize * 0.2,        // tracking-[0.2em]
            ])
            stack.addArrangedSubview(poss)
        }
        let markLabel = UILabel()
        markLabel.attributedText = NSAttributedString(string: "TIMEMACHINE", attributes: [
            .font: UIFont.systemFont(ofSize: mark, weight: .black),
            .foregroundColor: blue,
            .kern: mark * -0.025,             // tracking-tight
        ])
        stack.addArrangedSubview(markLabel)
        stack.frame = CGRect(origin: .zero, size: stack.systemLayoutSizeFitting(UIView.layoutFittingCompressedSize))
        return stack
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
    @objc private func onShare() { dispatchNav(action: "share") }
    @objc private func onProdSettings() { dispatchNav(action: "prodSettings") }
    @objc private func onMore() { dispatchNav(action: "more") }
    // Floating + → its own event (not a nav action); the web opens New Production.
    @objc private func onCreate() {
        bridge?.webView?.evaluateJavaScript("window.dispatchEvent(new CustomEvent('tmNativeCreate'))", completionHandler: nil)
    }

    // Context-aware trailing nav-bar buttons. Each key maps to an SF Symbol + a distinct
    // `tmNativeNav` action. Tab roots / best-boy: settings + search; solo shoot: share +
    // prodSettings (production settings, distinct from app settings).
    private func trailingButton(for key: String) -> UIBarButtonItem? {
        let symbol: String
        let action: Selector
        switch key {
        case "settings":     symbol = "gearshape";           action = #selector(onSettings)
        case "search":       symbol = "magnifyingglass";     action = #selector(onSearch)
        case "share":        symbol = "square.and.arrow.up";  action = #selector(onShare)
        case "prodSettings": symbol = "slider.horizontal.3";  action = #selector(onProdSettings)
        case "more":         symbol = "ellipsis";             action = #selector(onMore)
        default: return nil
        }
        return UIBarButtonItem(image: UIImage(systemName: symbol), style: .plain, target: self, action: action)
    }

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
        let trailing = call.getArray("trailing", String.self) ?? ["settings", "search"]
        let invoicesVisible = call.getBool("invoicesVisible") ?? true
        // Wordmark lockup (tab roots only). `wordmark` gates the custom two-line titleView;
        // `wordmarkName` is the possessive line. `createButton` shows the floating + (Shoots root).
        let wordmark = call.getBool("wordmark") ?? false
        let wordmarkName = call.getString("wordmarkName") ?? ""
        let createButton = call.getBool("createButton") ?? false
        DispatchQueue.main.async { [weak self] in
            (self?.bridge?.viewController as? MainViewController)?.applyChromeState(
                title: title, backVisible: backVisible, activeTab: activeTab, tabBarVisible: tabBarVisible, trailing: trailing, invoicesVisible: invoicesVisible,
                wordmark: wordmark, wordmarkName: wordmarkName, createButton: createButton)
            call.resolve()
        }
    }
}
