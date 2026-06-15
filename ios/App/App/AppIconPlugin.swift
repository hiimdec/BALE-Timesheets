//
//  AppIconPlugin.swift
//
//  Second app icon ("Scribble") — lets the user pick between the primary
//  AppIcon and the alternate "Scribble" icon from Settings.
//
//  In-app Capacitor 8 plugin (same template as NativePdf / LiveActivity /
//  CallSheet: @objc CAPPlugin / CAPBridgedPlugin, registered explicitly in
//  MainViewController.capacitorDidLoad). Two methods:
//
//    getAppIcon()      → the active alternate icon name, or "default" when the
//                        primary is active (UIApplication.alternateIconName is
//                        nil for the primary icon).
//    setAppIcon(name)  → UIApplication.setAlternateIconName on the MAIN thread;
//                        null / "" / "default" reverts to the primary. Guarded
//                        on supportsAlternateIcons. A redundant set (already the
//                        requested icon) short-circuits so iOS doesn't re-show
//                        its confirmation alert for a no-op.
//
//  The alternate asset lives in Assets.xcassets as the "Scribble" appiconset,
//  surfaced to setAlternateIconName by the App-target build settings
//  ASSETCATALOG_COMPILER_ALTERNATE_APPICON_NAMES = Scribble and
//  ASSETCATALOG_COMPILER_INCLUDE_ALL_APPICON_ASSETS = YES.
//
//  NOTE: iOS always shows its own "You've changed the icon for …" system alert
//  after a successful switch. There is no public API to suppress it, and every
//  known workaround is App-Store-unsafe — so we do not attempt one.
//

import Foundation
import Capacitor
import UIKit

@objc(AppIconPlugin)
public class AppIconPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AppIconPlugin"
    public let jsName = "AppIcon"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getAppIcon", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setAppIcon", returnType: CAPPluginReturnPromise),
    ]

    // The primary icon reports to JS as "default"; an alternate reports its
    // asset name (e.g. "Scribble"). UIKit icon APIs are main-thread only.
    @objc func getAppIcon(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let name = UIApplication.shared.alternateIconName
            call.resolve(["name": name ?? "default"])
        }
    }

    // null / "" / "default" → revert to the primary icon; any other name → that
    // alternate. Main-thread + supportsAlternateIcons-guarded. A no-op set is
    // skipped so we never trigger the system alert for an already-active icon.
    @objc func setAppIcon(_ call: CAPPluginCall) {
        let raw = call.getString("name")
        let target: String? = (raw == nil || raw == "" || raw == "default") ? nil : raw
        DispatchQueue.main.async {
            guard UIApplication.shared.supportsAlternateIcons else {
                call.reject("Alternate icons are not supported on this device")
                return
            }
            if UIApplication.shared.alternateIconName == target {
                call.resolve(["name": target ?? "default"])
                return
            }
            UIApplication.shared.setAlternateIconName(target) { error in
                if let error = error {
                    call.reject("Failed to set app icon: \(error.localizedDescription)")
                } else {
                    call.resolve(["name": target ?? "default"])
                }
            }
        }
    }
}
