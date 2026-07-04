//
//  HealthStepsPlugin.swift
//
//  Minimal HealthKit READ bridge for the Legwork stats block: ONE capability
//  — summed step counts over an arbitrary window — and nothing else. Built on
//  the same pattern as the other app-embedded plugins (explicit
//  registerPluginInstance in MainViewController; Capacitor 8 under SPM does
//  not auto-scan for app-embedded plugins).
//
//  Deliberate scope limits (App Store review posture):
//    • READ-ONLY — requestAuthorization(toShare: nil). No write types.
//      Info.plist carries BOTH purpose strings, but only because Apple's
//      upload validator (ITMS-90683) demands NSHealthUpdateUsageDescription
//      whenever the Health framework's authorization APIs are present —
//      the write string itself says the app never writes. The entitlement
//      is the plain com.apple.developer.healthkit boolean — no
//      clinical-records access array, no background delivery. App target
//      only; the widget extension never links HealthKit.
//    • The only HealthKit type this binary touches is stepCount.
//    • iOS read-authorization opacity is BY DESIGN: a denied read returns
//      empty data, indistinguishable from no data. getRequestStatus reports
//      whether the permission SHEET still needs presenting
//      (shouldRequest/unnecessary) — never what the user chose. The JS layer
//      builds its pre-ask/post-ask states on that, per the approved G2 flow.
//
//  All queries run on-device; nothing leaves the phone.
//

import Foundation
import Capacitor
import HealthKit

@objc(HealthStepsPlugin)
public class HealthStepsPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "HealthStepsPlugin"
    public let jsName = "HealthSteps"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getRequestStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestRead", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "querySteps", returnType: CAPPluginReturnPromise)
    ]

    private let store = HKHealthStore()

    private var stepType: HKQuantityType? {
        HKQuantityType.quantityType(forIdentifier: .stepCount)
    }

    // MARK: - isAvailable

    @objc func isAvailable(_ call: CAPPluginCall) {
        call.resolve(["available": HKHealthStore.isHealthDataAvailable() && stepType != nil])
    }

    // MARK: - getRequestStatus

    // "shouldRequest" → the system sheet has never been presented for our
    // read set (show the explainer/opt-in card). "unnecessary" → it has
    // (query and render, or show the quiet line on universal zeros).
    // HealthKit's own state — survives reinstalls/restores, unlike any
    // JS-side flag.
    @objc func getRequestStatus(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable(), let stepType else {
            call.resolve(["status": "unknown"])
            return
        }
        store.getRequestStatusForAuthorization(toShare: [], read: [stepType]) { status, _ in
            let s: String
            switch status {
            case .shouldRequest: s = "shouldRequest"
            case .unnecessary:   s = "unnecessary"
            default:             s = "unknown"
            }
            call.resolve(["status": s])
        }
    }

    // MARK: - requestRead

    @objc func requestRead(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable(), let stepType else {
            call.resolve(["ok": false])
            return
        }
        store.requestAuthorization(toShare: nil, read: [stepType]) { ok, _ in
            // ok = the sheet flow completed; the read grant itself is opaque.
            call.resolve(["ok": ok])
        }
    }

    // MARK: - querySteps

    // Summed step count strictly inside [startEpoch, endEpoch] (seconds).
    // Strict-dates predicate so a sample straddling the window edge doesn't
    // leak call-to-wrap accounting. No data (or denied read — opaque) → 0.
    @objc func querySteps(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable(), let stepType,
              let startEpoch = call.getDouble("startEpoch"),
              let endEpoch = call.getDouble("endEpoch"),
              endEpoch > startEpoch else {
            call.resolve(["steps": 0])
            return
        }
        let predicate = HKQuery.predicateForSamples(
            withStart: Date(timeIntervalSince1970: startEpoch),
            end: Date(timeIntervalSince1970: endEpoch),
            options: [.strictStartDate, .strictEndDate]
        )
        let query = HKStatisticsQuery(quantityType: stepType,
                                      quantitySamplePredicate: predicate,
                                      options: .cumulativeSum) { _, stats, _ in
            let steps = stats?.sumQuantity()?.doubleValue(for: .count()) ?? 0
            call.resolve(["steps": Int(steps.rounded())])
        }
        store.execute(query)
    }
}
