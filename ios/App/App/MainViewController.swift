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
    private static let fabSize: CGFloat = 56

    // Floating bottom-cluster geometry. The bead's diameter == the capsule's height, so the two
    // share a vertical centre and the bead's circle radius matches the capsule's rounded end.
    private static let capsuleHeight: CGFloat = 56
    private static let capsuleBottomMargin: CGFloat = 8   // float ABOVE the home indicator
    private static let beadGap: CGFloat = 8               // capsule trailing end → bead (Rate spacing)
    private static let tabItemWidth: CGFloat = 80         // per-item width → capsule hugs the item count

    // Shared bottom-chrome material: REAL Liquid Glass on iOS 26 (so the capsule and the + bead are
    // the SAME clear/neutral glass — NO tint), a thin-material blur fallback on iOS 15-25. Over the
    // near-black app background the bead reads as a subtle dark-translucent glass disc (intended).
    // The only colour on the bead is the white "+" glyph.
    private static func glassEffect() -> UIVisualEffect {
        if #available(iOS 26.0, *) {
            return UIGlassEffect()   // clear glass, no tintColor
        }
        return UIBlurEffect(style: .systemThinMaterial)
    }

    // The tab bar lives INSIDE this glass capsule (transparent bar + glass behind), so the bar
    // reads as one floating iOS-26 pill, not an edge-to-edge slab — the SAME material as the +
    // bead (Self.glassEffect). Width hugs the visible item count; recomputed on the invoicing
    // toggle. HIDDEN as a unit when the web hides the tab bar (the clearance maths keys off this
    // view, not the bar). (Non-lazy `let` → explicit type name, not `Self`, in the initializer.)
    private let capsuleGlass = UIVisualEffectView(effect: MainViewController.glassEffect())
    private var capsuleWidthConstraint: NSLayoutConstraint?

    private func capsuleWidth(forItems count: Int) -> CGFloat {
        CGFloat(max(count, 1)) * Self.tabItemWidth
    }

    // Floating "+" create button — a GLASS BEAD (Rate-style) sharing the capsule's CLEAR glass
    // material, so it stops reading as a foreign solid disc. No tint, no fill, no drop-shadow — over
    // the near-black app background it's a subtle dark-translucent glass disc. The only colour is
    // the white "+" glyph on top.
    private lazy var fabButton: UIButton = {
        let b = UIButton(type: .custom)
        b.translatesAutoresizingMaskIntoConstraints = false
        let glass = UIVisualEffectView(effect: Self.glassEffect())
        glass.translatesAutoresizingMaskIntoConstraints = false
        glass.isUserInteractionEnabled = false
        glass.layer.cornerRadius = Self.fabSize / 2     // circle — matches the capsule's end radius
        glass.layer.cornerCurve = .continuous
        glass.clipsToBounds = true
        b.insertSubview(glass, at: 0)
        // Dedicated WHITE "+" as its OWN image view ON TOP of the glass — NOT UIButton's managed
        // imageView. The managed imageView lost the z-fight with the inserted effect view (it was
        // composited under / swallowed by the glass), so setting .white never made it show. This
        // explicit, non-interactive image view is the topmost subview → it composites cleanly above
        // the glass and is unambiguously legible.
        let plusGlyph = UIImageView(image: UIImage(systemName: "plus",
            withConfiguration: UIImage.SymbolConfiguration(pointSize: 23, weight: .bold))?
            .withRenderingMode(.alwaysTemplate))
        plusGlyph.translatesAutoresizingMaskIntoConstraints = false
        plusGlyph.tintColor = .white
        plusGlyph.isUserInteractionEnabled = false
        b.addSubview(plusGlyph)                         // added after the glass → on top
        NSLayoutConstraint.activate([
            glass.leadingAnchor.constraint(equalTo: b.leadingAnchor),
            glass.trailingAnchor.constraint(equalTo: b.trailingAnchor),
            glass.topAnchor.constraint(equalTo: b.topAnchor),
            glass.bottomAnchor.constraint(equalTo: b.bottomAnchor),
            plusGlyph.centerXAnchor.constraint(equalTo: b.centerXAnchor),
            plusGlyph.centerYAnchor.constraint(equalTo: b.centerYAnchor),
        ])
        b.isHidden = true
        b.addTarget(self, action: #selector(onCreate), for: .touchUpInside)
        // Tactile press (scale + opacity) to suggest interaction.
        b.addTarget(self, action: #selector(fabPressDown), for: [.touchDown, .touchDragEnter])
        b.addTarget(self, action: #selector(fabPressUp), for: [.touchUpInside, .touchUpOutside, .touchCancel, .touchDragExit])
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
        view.bringSubviewToFront(capsuleGlass)
        view.bringSubviewToFront(tabBar)
        view.bringSubviewToFront(fabButton)
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
        // FULLY transparent bar via the MODERN appearance ONLY — this clears the iOS-26 glass
        // platter (the would-be second pill) the supported way, on BOTH standard + scrollEdge.
        // Do NOT also set the LEGACY bar-level properties (backgroundImage / shadowImage /
        // backgroundColor / isTranslucent): mixing legacy customization with a UITabBarAppearance
        // makes UIKit keep a SECOND, legacy visual provider alongside the modern one, and each
        // renders its OWN copy of the items → the doubled, slightly-offset labels seen on device.
        // Appearance-only = a single provider = one item set. The selection indicator is
        // item-level and survives; the glass capsule behind remains the only pill.
        let tabAppearance = UITabBarAppearance()
        tabAppearance.configureWithTransparentBackground()
        tabAppearance.backgroundColor = .clear
        tabAppearance.backgroundImage = UIImage()
        tabAppearance.shadowImage = UIImage()
        tabAppearance.shadowColor = .clear
        tabBar.standardAppearance = tabAppearance
        if #available(iOS 15.0, *) { tabBar.scrollEdgeAppearance = tabAppearance }
        tabBar.isHidden = true   // a sibling of the capsule now → gated in lockstep with it

        // Glass capsule — centred, floating, fully-rounded, item-hugging. The ONLY rounded/clipped
        // shape. Seated directly BEHIND a same-frame transparent tab bar as a SIBLING — NOT nested
        // in the effect view's contentView (that nesting clipped the bar against the capsule corners
        // and left a second visible pill). Same glass-behind-content pattern the bead uses.
        // cornerRadius = height/2 → fully-rounded ends matching the bead's circle.
        capsuleGlass.translatesAutoresizingMaskIntoConstraints = false
        capsuleGlass.isHidden = true
        capsuleGlass.layer.cornerRadius = Self.capsuleHeight / 2
        capsuleGlass.layer.cornerCurve = .continuous
        capsuleGlass.clipsToBounds = true
        view.addSubview(capsuleGlass)
        view.addSubview(tabBar)   // transparent, same frame, ON TOP of the glass (a sibling)

        // Floating + bead — clustered immediately right of the capsule's trailing end (small
        // consistent gap), same vertical centre, diameter == capsule height. Reads as one centred
        // cluster, NOT stranded at the screen edge. The capsule stays dead-centre regardless of
        // the bead's Shoots-only visibility, so it never jumps between tabs.
        view.addSubview(fabButton)

        let widthC = capsuleGlass.widthAnchor.constraint(equalToConstant: capsuleWidth(forItems: tabBar.items?.count ?? 3))
        capsuleWidthConstraint = widthC

        NSLayoutConstraint.activate([
            navBar.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            navBar.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            navBar.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),

            capsuleGlass.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            capsuleGlass.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -Self.capsuleBottomMargin),
            capsuleGlass.heightAnchor.constraint(equalToConstant: Self.capsuleHeight),
            widthC,

            // Tab bar is congruent with the glass pill (same rect, ON TOP) → a definite size, items
            // centred, and the capsule's corner radius clips nothing of the bar.
            tabBar.leadingAnchor.constraint(equalTo: capsuleGlass.leadingAnchor),
            tabBar.trailingAnchor.constraint(equalTo: capsuleGlass.trailingAnchor),
            tabBar.topAnchor.constraint(equalTo: capsuleGlass.topAnchor),
            tabBar.bottomAnchor.constraint(equalTo: capsuleGlass.bottomAnchor),

            fabButton.widthAnchor.constraint(equalToConstant: Self.fabSize),
            fabButton.heightAnchor.constraint(equalToConstant: Self.fabSize),
            fabButton.leadingAnchor.constraint(equalTo: capsuleGlass.trailingAnchor, constant: Self.beadGap),
            fabButton.centerYAnchor.constraint(equalTo: capsuleGlass.centerYAnchor),
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
        // Phase-1 Option-A spike (device check ii): prove the re-parented bridge VC still reaches its
        // webview. Gated to the tab-controller path so the OFF build (tabBarController == nil) is silent
        // and byte-identical.
        if tabBarController != nil {
            print("[OptionA-spike] applyContentInsets: bridge?.webView = \(bridge?.webView == nil ? "NIL" : "non-nil")")
        }
        guard chromeEnabled, let webView = bridge?.webView else { return }
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.scrollView.contentInset = .zero
        webView.scrollView.verticalScrollIndicatorInsets = .zero
        let top = navBar.frame.maxY
        // Clearance keys off the floating CAPSULE's top edge, not the old bottom-pinned bar. The
        // capsule floats `capsuleBottomMargin` above the home indicator, so its top sits higher
        // than the bar's did → web content / sheets clear the whole cluster (the bead shares the
        // capsule's vertical extent, so its top is covered too). When the capsule is hidden, fall
        // back to the bottom safe area (nothing covers the home indicator then).
        let bottom = capsuleGlass.isHidden ? view.safeAreaInsets.bottom : max(0, view.bounds.height - capsuleGlass.frame.minY)
        let sab = capsuleGlass.isHidden ? view.safeAreaInsets.bottom : 0
        let js = "document.documentElement.style.setProperty('--tm-native-top','\(top)px');"
            + "document.documentElement.style.setProperty('--tm-native-bottom','\(bottom)px');"
            + "document.documentElement.style.setProperty('--sat','0px');"
            + "document.documentElement.style.setProperty('--sab','\(sab)px');"
        webView.evaluateJavaScript(js, completionHandler: nil)
    }

    // MARK: - Web → native (NativeChromePlugin forwards here, main thread)

    func applyChromeState(title: String, backVisible: Bool, activeTab: String, tabBarVisible: Bool, trailing: [String], invoicesVisible: Bool,
                          wordmark: Bool = false, wordmarkName: String = "", createButton: Bool = false, leading: [String] = []) {
        if !chromeEnabled {
            chromeEnabled = true
            navBar.isHidden = false
        }
        navItem.title = title
        // Tab roots get the custom two-line wordmark lockup as the titleView; pushed screens
        // (production name / Settings) fall back to the plain string title (titleView = nil).
        navItem.titleView = wordmark ? makeWordmarkLockup(name: wordmarkName) : nil
        // Leading slot holds the back button (pushed screens) OR the web's leading actions
        // (search, roots only) — never both. Leading actions reuse the same key→button map as
        // trailing, so the icon styling matches. rightBarButtonItems lay out right-to-left
        // (index 0 = rightmost); the web sends them in that order. Unknown keys are dropped.
        if backVisible {
            navItem.leftBarButtonItems = [backButton]
        } else {
            let leadingItems = leading.compactMap { trailingButton(for: $0) }
            navItem.leftBarButtonItems = leadingItems.isEmpty ? nil : leadingItems
        }
        navItem.rightBarButtonItems = trailing.compactMap { trailingButton(for: $0) }
        // Honour the web's invoicing toggle: rebuild the tab set when it flips.
        if invoicesVisible != invoicesShown {
            invoicesShown = invoicesVisible
            tabBar.items = tabItems(invoices: invoicesVisible)
            capsuleWidthConstraint?.constant = capsuleWidth(forItems: tabBar.items?.count ?? 3)
        }
        // Capsule (glass) + tab bar are SIBLINGS now (the bar sits ON TOP of the glass, not inside
        // its contentView) → toggle BOTH in lockstep. Clearance still keys off capsuleGlass, which
        // shares the bar's exact frame.
        capsuleGlass.isHidden = !tabBarVisible
        tabBar.isHidden = !tabBarVisible
        // Sync by TAG (the tab NAME), not index — so dropping Invoices never highlights Stats as Invoices.
        let tag = activeTab == "invoices" ? 1 : (activeTab == "stats" ? 2 : 0)
        tabBar.selectedItem = tabBar.items?.first(where: { $0.tag == tag })
        // Floating + create button — Shoots root only.
        fabButton.isHidden = !createButton
        // Phase-1 Option-A spike: when hosted in the RootTabBarController the SYSTEM tab bar IS the
        // bottom chrome, so force the OLD hand-built cluster hidden to avoid a doubled bar. Reversible
        // guard (Phase 2 deletes the old code). On the OFF build MainViewController is the window root,
        // so `tabBarController` is nil and this is a no-op → byte-identical. Clearance left as-is.
        if tabBarController != nil {
            capsuleGlass.isHidden = true
            tabBar.isHidden = true
            fabButton.isHidden = true
        }
        view.bringSubviewToFront(navBar)
        view.bringSubviewToFront(capsuleGlass)   // glass (behind)
        view.bringSubviewToFront(tabBar)         // transparent bar, on top of the glass
        view.bringSubviewToFront(fabButton)      // bead, on top of all
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
    // Phase-1 Option-A spike: the RootTabBarController routes a SYSTEM-tab tap here, firing the SAME
    // `tmNativeNav` tab event the hand-built bar dispatches (index 0/1/2 → shoots/invoices/stats).
    func spikeDispatchTab(index: Int) {
        let tab = index == 1 ? "invoices" : (index == 2 ? "stats" : "shoots")
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
    @objc private func fabPressDown() {
        UIView.animate(withDuration: 0.12, delay: 0, options: [.allowUserInteraction, .beginFromCurrentState]) {
            self.fabButton.transform = CGAffineTransform(scaleX: 0.9, y: 0.9)
            self.fabButton.alpha = 0.85
        }
    }
    @objc private func fabPressUp() {
        UIView.animate(withDuration: 0.18, delay: 0, options: [.allowUserInteraction, .beginFromCurrentState]) {
            self.fabButton.transform = .identity
            self.fabButton.alpha = 1
        }
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
        let trailing = call.getArray("trailing", String.self) ?? ["settings"]
        // Leading nav-bar actions (left of the title) — search on roots; empty on pushed
        // screens where the back button owns the leading slot.
        let leading = call.getArray("leading", String.self) ?? ["search"]
        let invoicesVisible = call.getBool("invoicesVisible") ?? true
        // Wordmark lockup (tab roots only). `wordmark` gates the custom two-line titleView;
        // `wordmarkName` is the possessive line. `createButton` shows the floating + (Shoots root).
        let wordmark = call.getBool("wordmark") ?? false
        let wordmarkName = call.getString("wordmarkName") ?? ""
        let createButton = call.getBool("createButton") ?? false
        DispatchQueue.main.async { [weak self] in
            (self?.bridge?.viewController as? MainViewController)?.applyChromeState(
                title: title, backVisible: backVisible, activeTab: activeTab, tabBarVisible: tabBarVisible, trailing: trailing, invoicesVisible: invoicesVisible,
                wordmark: wordmark, wordmarkName: wordmarkName, createButton: createButton, leading: leading)
            call.resolve()
        }
    }
}
