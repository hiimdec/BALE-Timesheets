//
//  BuildKind.swift
//  TimeMachine
//
//  WHICH BUILD IS THIS? The analytics payload carries an `isDebug` flag, and
//  Aptabase routes on it: a debug event lands under a `<appId>_DEBUG` bucket
//  server-side and never mixes with release in the dashboard. Getting this
//  wrong in either direction is expensive - stamp everything release and the
//  founder's own testing is indistinguishable from real usage; stamp
//  everything debug and the release dashboard is permanently empty.
//
//  PURE FOUNDATION, DELIBERATELY. Everything decidable without Capacitor or
//  UIKit lives here so the swiftc harness can compile and EXECUTE it off
//  device (the TimeMachineTimesParser / CallSheetTitleLogic precedent).
//  BuildInfoPlugin is the thin shim that supplies the two real inputs.
//
//  WHAT THE PINS COVER AND WHAT THEY CANNOT:
//    - resolve(...) is fully pinned. Given a compile flag and a receipt file
//      name, the verdict is asserted by the gate on every run.
//    - That TestFlight actually writes a receipt named "sandboxReceipt" is
//      NOT pinned and CANNOT BE. No test on this machine can produce a real
//      TestFlight install. A GREEN GATE DOES NOT COVER IT. It is verified by
//      hand on the 15 Pro (see MAINTENANCE.md, the 15 Pro walk list) and
//      nowhere else. Do not read a passing audit as evidence for it.
//
import Foundation

enum BuildKind {
    /// The verdict. `reason` is for the device walk - it never leaves the
    /// device, only the boolean is put on the wire.
    struct Verdict {
        let isDebug: Bool
        let reason: String      // "debug" | "testflight" | "release"
    }

    /// FOUNDER-RULED: TestFlight folds into debug. Testers are not users, and
    /// mixing them into release is exactly the pollution this exists to stop.
    /// The founder's own App Store install stays counted as real usage, which
    /// is correct - he is a user of his own app.
    ///
    /// - Parameters:
    ///   - isDebugCompile: the `#if DEBUG` compile flag, from the shim.
    ///   - receiptLastComponent: last path component of
    ///     `Bundle.main.appStoreReceiptURL`, or nil when there is no receipt.
    static func resolve(isDebugCompile: Bool, receiptLastComponent: String?) -> Verdict {
        if isDebugCompile {
            return Verdict(isDebug: true, reason: "debug")
        }
        // A release-configuration build with a SANDBOX receipt is TestFlight.
        // An App Store install writes "receipt"; a build with no receipt at
        // all (never validated) is not TestFlight and reads as release.
        if receiptLastComponent == "sandboxReceipt" {
            return Verdict(isDebug: true, reason: "testflight")
        }
        return Verdict(isDebug: false, reason: "release")
    }
}
