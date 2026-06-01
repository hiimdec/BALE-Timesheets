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

import UIKit
import Capacitor

class MainViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        bridge?.registerPluginInstance(NativePdfPlugin())
    }
}
