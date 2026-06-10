//
//  LiveActivityPlugin.swift
//
//  In-app Capacitor 8 plugin that drives a single iOS Live Activity for the
//  active solo shoot day (Stage 1 — display-only; no App Intents / buttons).
//
//  Built on the same pattern as NativePdfPlugin: an @objc(...) CAPPlugin /
//  CAPBridgedPlugin registered explicitly in MainViewController via
//  bridge?.registerPluginInstance(...) (Capacitor 8 under SPM does NOT
//  auto-scan the ObjC runtime for app-embedded plugins).
//
//  iOS-version safety: the App target's minimum stays at iOS 15.0. `import
//  ActivityKit` is SDK-safe at that minimum; every ActivityKit symbol is used
//  ONLY inside `if #available(iOS 16.2, *)`, and `isAvailable` returns false
//  below 16.2 — so iOS 15 devices keep working and simply get no Live Activity.
//
//  Single-activity model: the plugin tracks one current Activity. startActivity
//  ends any existing one and starts fresh; updateActivity mutates the current
//  one; endActivity finishes it. The JS controller only calls start when the
//  (production, today) key changes and update otherwise, so this stays a single
//  card per day.
//
//  Shared type: TimeMachineActivityAttributes lives in the widget folder and is
//  compiled into BOTH this (App) target and the widget target (Target
//  Membership). It is referenced here behind the same availability guard.
//

import Foundation
import Capacitor
import ActivityKit

@objc(LiveActivityPlugin)
public class LiveActivityPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "LiveActivityPlugin"
    public let jsName = "LiveActivity"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startActivity", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "updateActivity", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "endActivity", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "drainPendingEvents", returnType: CAPPluginReturnPromise)
    ]

    // App Group shared with the widget extension. The Stage-2 App Intents
    // (LunchNowIntent / WrapNowIntent) APPEND events here from the widget
    // process; this method (app process) reads-and-clears them on foreground.
    private static let appGroupSuite = "group.co.uk.timemachineapp.shared"
    private static let pendingEventsKey = "pendingEvents"

    // Held as Any? because Activity<…> is only available on iOS 16.2+ and this
    // class isn't availability-gated; cast inside `if #available` blocks.
    private var currentActivity: Any?

    // MARK: - isAvailable

    @objc func isAvailable(_ call: CAPPluginCall) {
        if #available(iOS 16.2, *) {
            call.resolve(["available": ActivityAuthorizationInfo().areActivitiesEnabled])
        } else {
            call.resolve(["available": false])
        }
    }

    // MARK: - start

    @objc func startActivity(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *) else { call.reject("Live Activities require iOS 16.2+"); return }
        guard ActivityAuthorizationInfo().areActivitiesEnabled else {
            call.reject("Live Activities are disabled for this app in Settings")
            return
        }
        let name = call.getString("name") ?? "Shoot"
        let callEpoch = call.getDouble("callEpoch") ?? 0
        let totalText = call.getString("totalText") ?? ""
        let state = call.getString("state") ?? "oncall"
        let productionId = call.getString("productionId") ?? ""
        let staleDate = call.getDouble("staleEpoch").map { Date(timeIntervalSince1970: $0) }

        DispatchQueue.main.async {
            self.endCurrentActivity()
            let attributes = TimeMachineActivityAttributes(productionName: name, callEpoch: callEpoch, productionId: productionId)
            let content = ActivityContent(
                state: TimeMachineActivityAttributes.ContentState(totalText: totalText, state: state),
                staleDate: staleDate
            )
            do {
                let activity = try Activity.request(attributes: attributes, content: content, pushType: nil)
                self.currentActivity = activity
                call.resolve(["id": activity.id])
            } catch {
                call.reject("Failed to start Live Activity: \(error.localizedDescription)")
            }
        }
    }

    // MARK: - update

    @objc func updateActivity(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *) else { call.resolve(); return }
        guard let activity = currentActivity as? Activity<TimeMachineActivityAttributes> else { call.resolve(); return }
        let totalText = call.getString("totalText") ?? ""
        let state = call.getString("state") ?? "oncall"
        let staleDate = call.getDouble("staleEpoch").map { Date(timeIntervalSince1970: $0) }
        Task {
            await activity.update(ActivityContent(
                state: TimeMachineActivityAttributes.ContentState(totalText: totalText, state: state),
                staleDate: staleDate
            ))
            call.resolve()
        }
    }

    // MARK: - end

    @objc func endActivity(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *) else { call.resolve(); return }
        guard let activity = currentActivity as? Activity<TimeMachineActivityAttributes> else { call.resolve(); return }
        self.currentActivity = nil
        Task {
            // Keep the last shown content; let the wrapped card linger briefly,
            // then dismiss. The JS controller also sets a staleDate as a wider
            // safety net for a forgotten Activity.
            await activity.end(
                ActivityContent(state: activity.content.state, staleDate: nil),
                dismissalPolicy: .after(Date().addingTimeInterval(5 * 60))
            )
            call.resolve()
        }
    }

    // MARK: - drainPendingEvents (Stage 2)

    // Atomic-ish read-and-clear of the App-Group event queue the App Intents
    // append to. Returns the events to JS and clears the key in one go so each
    // event is handed over exactly once. The app + extension never write/drain
    // simultaneously in practice (a human tap vs a foreground), and the JS side
    // keeps an appliedEventIds set as a belt-and-braces guard against a double
    // hand-over. Available on all OS versions (plain UserDefaults; no ActivityKit).
    @objc func drainPendingEvents(_ call: CAPPluginCall) {
        guard let defaults = UserDefaults(suiteName: Self.appGroupSuite) else {
            call.resolve(["events": []])
            return
        }
        let events = defaults.array(forKey: Self.pendingEventsKey) as? [[String: Any]] ?? []
        if !events.isEmpty {
            defaults.removeObject(forKey: Self.pendingEventsKey)
        }
        call.resolve(["events": events])
    }

    // MARK: - helpers

    @available(iOS 16.2, *)
    private func endCurrentActivity() {
        if let activity = currentActivity as? Activity<TimeMachineActivityAttributes> {
            Task { await activity.end(nil, dismissalPolicy: .immediate) }
        }
        currentActivity = nil
    }
}
