import UIKit
import Capacitor

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Phase-1 Option-A spike, GATED by the Info.plist Boolean `TMNativeChrome` (committed false).
        // OFF (key absent/false): do nothing — the && short-circuits before touching the window, so
        // the storyboard's MainViewController stays the window root, BYTE-IDENTICAL to before.
        // ON: host that SAME storyboard-instantiated MainViewController as the single persistent child
        // of a RootTabBarController (system tab bar) and make the tab controller the window root.
        if Bundle.main.object(forInfoDictionaryKey: "TMNativeChrome") as? Bool == true,
           let window = self.window,
           let main = window.rootViewController as? MainViewController {
            let root = RootTabBarController()
            root.hostBridgeViewController(main)
            window.rootViewController = root
        }
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // Called when the app was launched with a url. Feel free to add additional processing here,
        // but if you want the App API to support tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        // Called when the app was launched with an activity, including Universal Links.
        // Feel free to add additional processing here, but if you want the App API to support
        // tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

}

/// Phase-1 Option-A spike — a throwaway foundation. A UITabBarController that owns the SYSTEM tab bar
/// but hosts the single Capacitor bridge VC (MainViewController) as ONE persistent, full-screen child.
/// The bridge VC is NEVER placed in `viewControllers`, so UIKit never hides/shows it on a tab change →
/// the WKWebView (the React app, its router, scroll state) is never torn down. The three tabs are empty
/// PLACEHOLDERS that exist only so the bar renders three items and emits `didSelect`; their views are
/// never shown as content. A tab tap routes to the web via the existing `tmNativeNav` tab event — no
/// native VC swap. Phase 2 deletes the old hand-built bottom chrome and re-sources clearance; this
/// spike only proves the re-parent works, so clearance/create/morph are deliberately left for later.
final class RootTabBarController: UITabBarController, UITabBarControllerDelegate {

    private weak var host: MainViewController?

    func hostBridgeViewController(_ main: MainViewController) {
        host = main
        delegate = self

        // Placeholder tabs — CLEAR + non-interactive, so the persistent webview behind them stays
        // visible and keeps receiving touches. Tags 0/1/2 mirror MainViewController.tabItems.
        viewControllers = [
            placeholder("Shoots", "film", 0),
            placeholder("Invoices", "doc.text", 1),
            placeholder("Stats", "chart.bar", 2),
        ]

        // Embed the bridge VC ONCE as a persistent child — NOT in `viewControllers` (that's what keeps
        // the webview alive across tab changes). Sized by AUTORESIZING (the model Capacitor's webView
        // expects) and sent to the BACK: on iOS 26 the system tab bar's glass container is NOT a direct
        // subview of `view`, so the earlier insertBelow/bringToFront against `tabBar` was a no-op and the
        // full-bleed webView covered the bar. At the back, UIKit keeps the tab bar (and its container)
        // on top; the clear placeholders pass touches through to the webView.
        addChild(main)
        main.view.translatesAutoresizingMaskIntoConstraints = true
        main.view.frame = view.bounds
        main.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(main.view)
        view.sendSubviewToBack(main.view)
        main.didMove(toParent: self)
    }

    private func placeholder(_ title: String, _ symbol: String, _ tag: Int) -> UIViewController {
        let vc = UIViewController()
        vc.view.backgroundColor = .clear
        vc.view.isUserInteractionEnabled = false
        vc.tabBarItem = UITabBarItem(title: title, image: UIImage(systemName: symbol), tag: tag)
        return vc
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        // Keep the persistent webview at the BACK every layout pass (UIKit re-inserts the selected
        // placeholder on a tab change); the tab bar stays topmost by UIKit default.
        if let h = host?.view, h.superview == view {
            view.sendSubviewToBack(h)
        }
        // The re-parented webView's TOP safe area collapsed (the status-bar inset isn't propagating
        // geometrically to the hosted child). Compensate so the native top bar clears the status bar
        // exactly as when MainViewController was root. Non-oscillating: `inherited` backs out our own
        // additional inset, so once set it stays put. Top only — bottom/clearance is Phase 2.
        var inheritedTop: CGFloat = -1
        if let main = host {
            let want = view.safeAreaInsets.top
            inheritedTop = main.view.safeAreaInsets.top - main.additionalSafeAreaInsets.top
            let needed = max(0, want - inheritedTop)
            if abs(main.additionalSafeAreaInsets.top - needed) > 0.5 {
                main.additionalSafeAreaInsets = UIEdgeInsets(top: needed, left: 0, bottom: 0, right: 0)
            }
        }
        // Spike diagnostics (ON-path only — this controller exists only when the gate fired). Confirms
        // the gate, the tab-bar frame, and whether the top inset propagated (inheritedTop) vs after fix.
        print("[OptionA-spike] gate FIRED. tabBar.frame=\(tabBar.frame) hidden=\(tabBar.isHidden) "
            + "root.safeTop=\(view.safeAreaInsets.top) host.inheritedTop=\(inheritedTop) host.safeTop=\(host?.view.safeAreaInsets.top ?? -1)")
    }

    // Tab tap → fire the EXISTING web tab event (verbatim); never swap to a placeholder's view.
    func tabBarController(_ tabBarController: UITabBarController, didSelect viewController: UIViewController) {
        host?.spikeDispatchTab(index: viewController.tabBarItem.tag)
        if let h = host?.view, h.superview == view { view.sendSubviewToBack(h) }
    }

    // UIViewControllerBasedStatusBarAppearance is true — keep status-bar appearance coming from the
    // bridge VC, not the tab controller, so it doesn't regress now that the tab controller is root.
    override var childForStatusBarStyle: UIViewController? { host }
    override var childForStatusBarHidden: UIViewController? { host }
}
