//
//  BuildInfoPlugin.swift
//  TimeMachine
//
//  The thin shim over BuildKind. It supplies the two inputs the pure logic
//  cannot see - the `#if DEBUG` compile flag and the App Store receipt's file
//  name - and forwards the verdict to JS. All of the DECIDING lives in
//  BuildKind.swift, which the gate compiles and executes; this file is
//  deliberately too small to hold a decision.
//
//  Read once at startup by the analytics wrapper and cached for the process.
//
import Foundation
import Capacitor

@objc(BuildInfoPlugin)
public class BuildInfoPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "BuildInfoPlugin"
    public let jsName = "BuildInfo"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "kind", returnType: CAPPluginReturnPromise)
    ]

    @objc func kind(_ call: CAPPluginCall) {
        let verdict = BuildKind.resolve(
            isDebugCompile: BuildInfoPlugin.isDebugCompile,
            receiptLastComponent: Bundle.main.appStoreReceiptURL?.lastPathComponent
        )
        call.resolve(["isDebug": verdict.isDebug, "reason": verdict.reason])
    }

    private static var isDebugCompile: Bool {
        #if DEBUG
        return true
        #else
        return false
        #endif
    }
}
