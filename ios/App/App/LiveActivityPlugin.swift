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
        CAPPluginMethod(name: "listActivities", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "endForProduction", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "endActivityIds", returnType: CAPPluginReturnPromise),
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

    // MARK: - load (Issue C — background-drain bridge)

    // Capacitor calls load() when the plugin is registered (i.e. the webview
    // booted). We (1) flag the process as webview-alive so a LiveActivityIntent
    // running in THIS app process knows JS can be nudged, and (2) observe an
    // in-process notification the intent posts on a lock-screen confirm, relaying
    // it to JS via notifyListeners so JS can drain + apply + recompute +
    // updateActivity in the background window. Idempotent on the JS side.
    override public func load() {
        TMLiveActivity.webviewObserving = true
        NotificationCenter.default.addObserver(
            self, selector: #selector(onDrainRequest),
            name: Notification.Name("TMLiveActivityDrainRequest"), object: nil)
    }

    @objc private func onDrainRequest() {
        notifyListeners("drainRequest", data: [:])
    }

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
        let anchorLabel = call.getString("anchorLabel") ?? ""
        let totalText = call.getString("totalText") ?? ""
        let state = call.getString("state") ?? "oncall"
        let endEpoch = call.getDouble("endEpoch") ?? 0
        let cwd = call.getBool("cwd") ?? false
        let lunchEndEpoch = call.getDouble("lunchEndEpoch") ?? 0
        let otFrom = call.getString("otFrom") ?? ""
        let productionId = call.getString("productionId") ?? ""
        let staleDate = call.getDouble("staleEpoch").map { Date(timeIntervalSince1970: $0) }

        DispatchQueue.main.async {
            let attributes = TimeMachineActivityAttributes(productionName: name, productionId: productionId)
            let content = ActivityContent(
                state: TimeMachineActivityAttributes.ContentState(totalText: totalText, state: state, callEpoch: callEpoch, anchorLabel: anchorLabel, endEpoch: endEpoch, armed: "", armedAt: 0, cwd: cwd, lunchEndEpoch: lunchEndEpoch, otFrom: otFrom),
                staleDate: staleDate
            )
            // SINGLE-ACTIVITY INVARIANT (duplicate-card fix). "Start" is issued
            // by the controller on every fresh mount (its startedKeyRef is
            // mount-local) and on cold relaunch — where the in-memory
            // currentActivity handle is LOST but the system card survives. So
            // dedupe against the system registry, not the handle: if a card for
            // THIS production already exists, ADOPT + UPDATE it (never request a
            // second); end every other TimeMachine card so exactly one remains.
            let all = Activity<TimeMachineActivityAttributes>.activities
            let adopt = all.first { $0.attributes.productionId == productionId }
            let strays = all.filter { $0.id != adopt?.id }
            if let adopt = adopt {
                self.currentActivity = adopt
                Task {
                    await adopt.update(content)
                    for s in strays { await s.end(nil, dismissalPolicy: .immediate) }
                    call.resolve(["id": adopt.id, "adopted": true])
                }
            } else {
                do {
                    let activity = try Activity.request(attributes: attributes, content: content, pushType: nil)
                    self.currentActivity = activity
                    call.resolve(["id": activity.id])
                    Task { for s in strays { await s.end(nil, dismissalPolicy: .immediate) } }
                } catch {
                    call.reject("Failed to start Live Activity: \(error.localizedDescription)")
                }
            }
        }
    }

    // MARK: - update

    @objc func updateActivity(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *) else { call.resolve(); return }
        guard let activity = currentActivity as? Activity<TimeMachineActivityAttributes> else { call.resolve(); return }
        let totalText = call.getString("totalText") ?? ""
        let state = call.getString("state") ?? "oncall"
        let callEpoch = call.getDouble("callEpoch") ?? 0
        let anchorLabel = call.getString("anchorLabel") ?? ""
        let endEpoch = call.getDouble("endEpoch") ?? 0
        let cwd = call.getBool("cwd") ?? false
        let lunchEndEpoch = call.getDouble("lunchEndEpoch") ?? 0
        let otFrom = call.getString("otFrom") ?? ""
        let staleDate = call.getDouble("staleEpoch").map { Date(timeIntervalSince1970: $0) }
        Task {
            // The anchor (callEpoch + anchorLabel) is carried on EVERY update so a
            // mid-day call/pre-call edit re-anchors the live card (it lives in
            // ContentState, not the start-fixed Attributes). armed:"" — an app-driven
            // update always clears any pending two-tap arm (the app never sends a
            // non-empty armed): the backstop reset for an arm that never confirmed.
            await activity.update(ActivityContent(
                state: TimeMachineActivityAttributes.ContentState(totalText: totalText, state: state, callEpoch: callEpoch, anchorLabel: anchorLabel, endEpoch: endEpoch, armed: "", armedAt: 0, cwd: cwd, lunchEndEpoch: lunchEndEpoch, otFrom: otFrom),
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
        // immediate:true (disqualified day / setting off) dismisses NOW; the
        // default keeps the brief linger so a wrapped card gets its send-off.
        // The JS controller also sets a staleDate as a wider safety net.
        let immediate = call.getBool("immediate") ?? false
        Task {
            await activity.end(
                ActivityContent(state: activity.content.state, staleDate: nil),
                dismissalPolicy: immediate ? .immediate : .after(Date().addingTimeInterval(5 * 60))
            )
            call.resolve()
        }
    }

    // MARK: - listActivities / endForProduction (round 3 reconcile sweep)

    // Backed by ActivityKit's own registry (Activity.activities), NOT the
    // plugin's single tracked handle — so the sweep can see and end a card that
    // outlived an app restart (where currentActivity was lost and endActivity
    // would silently no-op).
    @objc func listActivities(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *) else { call.resolve(["activities": []]); return }
        let acts = Activity<TimeMachineActivityAttributes>.activities.map {
            ["id": $0.id, "productionId": $0.attributes.productionId]
        }
        call.resolve(["activities": acts])
    }

    @objc func endForProduction(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *) else { call.resolve(); return }
        let productionId = call.getString("productionId") ?? ""
        let immediate = call.getBool("immediate") ?? true
        guard !productionId.isEmpty else { call.resolve(); return }
        if let tracked = currentActivity as? Activity<TimeMachineActivityAttributes>,
           tracked.attributes.productionId == productionId {
            currentActivity = nil
        }
        Task {
            for activity in Activity<TimeMachineActivityAttributes>.activities
            where activity.attributes.productionId == productionId {
                await activity.end(
                    ActivityContent(state: activity.content.state, staleDate: nil),
                    dismissalPolicy: immediate ? .immediate : .after(Date().addingTimeInterval(5 * 60))
                )
            }
            call.resolve()
        }
    }

    // End specific activities by id — the reconcile sweep's duplicate-converge
    // backstop: it keeps ONE card per qualifying production and ends the rest by
    // id (endForProduction would wrongly end the kept one too). Immediate.
    @objc func endActivityIds(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *) else { call.resolve(); return }
        let ids = Set(call.getArray("ids", String.self) ?? [])
        guard !ids.isEmpty else { call.resolve(); return }
        if let tracked = currentActivity as? Activity<TimeMachineActivityAttributes>, ids.contains(tracked.id) {
            currentActivity = nil
        }
        Task {
            for activity in Activity<TimeMachineActivityAttributes>.activities where ids.contains(activity.id) {
                await activity.end(ActivityContent(state: activity.content.state, staleDate: nil), dismissalPolicy: .immediate)
            }
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
}
