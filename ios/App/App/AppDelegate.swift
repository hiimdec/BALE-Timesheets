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

        // Placeholder tabs — tags 0/1/2 mirror MainViewController.tabItems (Shoots / Invoices / Stats).
        viewControllers = [
            placeholder("Shoots", "film", 0),
            placeholder("Invoices", "doc.text", 1),
            placeholder("Stats", "chart.bar", 2),
        ]

        // Embed the bridge VC ONCE as a persistent full-screen child — NOT in `viewControllers`. That
        // single choice is what keeps the webview alive across every tab change. Z-order (above the
        // never-shown placeholder content, below the system tab bar) is re-asserted in layout.
        addChild(main)
        main.view.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(main.view)
        NSLayoutConstraint.activate([
            main.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            main.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            main.view.topAnchor.constraint(equalTo: view.topAnchor),
            main.view.bottomAnchor.constraint(equalTo: view.bottomAnchor),
        ])
        main.didMove(toParent: self)
    }

    private func placeholder(_ title: String, _ symbol: String, _ tag: Int) -> UIViewController {
        let vc = UIViewController()
        vc.tabBarItem = UITabBarItem(title: title, image: UIImage(systemName: symbol), tag: tag)
        return vc
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        keepHostBelowTabBar()
    }

    // The persistent webview host must stay ABOVE the placeholder content (so touches reach the
    // webview) but BELOW the system tab bar (so tab taps work). UIKit re-inserts the selected
    // placeholder's view on selection, so re-assert the z-order every layout pass.
    private func keepHostBelowTabBar() {
        guard let h = host?.view, h.superview == view else { return }
        view.insertSubview(h, belowSubview: tabBar)
    }

    // Tab tap → fire the EXISTING web tab event (verbatim); never swap to a placeholder's view.
    func tabBarController(_ tabBarController: UITabBarController, didSelect viewController: UIViewController) {
        host?.spikeDispatchTab(index: viewController.tabBarItem.tag)
        keepHostBelowTabBar()
    }

    // UIViewControllerBasedStatusBarAppearance is true — keep status-bar appearance coming from the
    // bridge VC, not the tab controller, so it doesn't regress now that the tab controller is root.
    override var childForStatusBarStyle: UIViewController? { host }
    override var childForStatusBarHidden: UIViewController? { host }
}
