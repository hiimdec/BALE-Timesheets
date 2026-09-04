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
        CAPPluginMethod(name: "drainPendingEvents", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "claimEvents", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "confirmEvents", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setActiveShoot", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setDebugLogging", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getDebugLogging", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getDiagnostics", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearDiagnostics", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "appendDebugLog", returnType: CAPPluginReturnPromise)
    ]

    // App Group shared with the widget extension. The Stage-2 App Intents
    // (LunchNowIntent / WrapNowIntent) APPEND events here from the widget
    // process; this method (app process) reads-and-clears them on foreground.
    private static let appGroupSuite = "group.co.uk.timemachineapp.shared"
    private static let pendingEventsKey = "pendingEvents"
    // At-least-once (2026-09-04): drained events live here until JS confirms the persist.
    private static let inflightEventsKey = "inflightEvents"
    // Stage B: today's-active-shoot snapshot {productionId, date} written by the
    // app when the user opens/works a shoot that has a today day, so the "log my
    // times" voice intent can resolve the production with NO Live Activity running
    // (works in Best Boy mode too — id + date only).
    private static let activeShootKey = "activeShoot"

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
        TMLiveActivity.dbg("plugin.load", "webview booted")
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
        let curtailMins = call.getInt("curtailMins") ?? 0
        let lunchLogged = call.getBool("lunchLogged") ?? false
        // Flattened [epoch, pence, …] pairs; JS numbers arrive as NSNumber, so
        // go through doubleValue rather than a typed cast that an integral
        // pence value could dodge.
        let wrapCurve = (call.getArray("wrapCurve") ?? []).compactMap { ($0 as? NSNumber)?.doubleValue }
        let productionId = call.getString("productionId") ?? ""
        let staleDate = call.getDouble("staleEpoch").map { Date(timeIntervalSince1970: $0) }

        DispatchQueue.main.async {
            let attributes = TimeMachineActivityAttributes(productionName: name, productionId: productionId)
            // fix/la-husk Fix 2: capEpoch is NATIVE-OWNED — JS never sends it.
            // The cap differs per branch (a fresh request starts a fresh ~8h
            // lifetime; an adopted card keeps the one its request started), so
            // the content is built per-branch from the cap. Every staleDate is
            // clamped to min(semantic, cap) — the pre-cap wake that lets the
            // widget render its truthful EXPIRED branch instead of husking.
            let makeContent: (Double?) -> ActivityContent<TimeMachineActivityAttributes.ContentState> = { cap in
                ActivityContent(
                    state: TimeMachineActivityAttributes.ContentState(totalText: totalText, state: state, callEpoch: callEpoch, anchorLabel: anchorLabel, endEpoch: endEpoch, armed: "", armedAt: 0, cwd: cwd, lunchEndEpoch: lunchEndEpoch, otFrom: otFrom, curtailMins: curtailMins, lunchLogged: lunchLogged, wrapCurve: wrapCurve, capEpoch: cap),
                    staleDate: TMLiveActivity.cappedStaleDate(staleDate, capEpoch: cap)
                )
            }
            // SINGLE-ACTIVITY INVARIANT (duplicate-card fix). "Start" is issued
            // by the controller on every fresh mount (its startedKeyRef is
            // mount-local) and on cold relaunch — where the in-memory
            // currentActivity handle is LOST but the system card survives. So
            // dedupe against the system registry, not the handle: if a card for
            // THIS production already exists, ADOPT + UPDATE it (never request a
            // second); end every other TimeMachine card so exactly one remains.
            // fix/la-husk (d): adopt only a LIVE card (active/stale). A
            // system-ended husk is not updatable — adopting it would update()
            // into the void and resolve {adopted:true} while the lock screen
            // keeps a dead card. Ended/dismissed pid-matches fall into the
            // strays instead: the .immediate re-end is the dismissal attempt
            // that clears a lingering husk where the registry still holds it,
            // and a FRESH activity is requested in its place.
            let all = Activity<TimeMachineActivityAttributes>.activities
            let isLive: (Activity<TimeMachineActivityAttributes>) -> Bool = {
                $0.activityState == .active || $0.activityState == .stale
            }
            let adopt = all.first { $0.attributes.productionId == productionId && isLive($0) }
            let strays = all.filter { $0.id != adopt?.id }
            if let adopt = adopt {
                self.currentActivity = adopt
                // Cap backfill for the adopted card: its own ContentState first
                // (the request stamped it), else the App-Group requestedAt map
                // (cold relaunch of a card whose state predates/lost the field),
                // else start the clock now (never leave a live card uncapped —
                // a late cap only errs towards expiring EARLY, never lying late).
                let cap = adopt.content.state.capEpoch
                    ?? TMLiveActivity.requestedAt(adopt.id).map { $0 + TMLiveActivity.lifetimeCap }
                    ?? Date().timeIntervalSince1970 + TMLiveActivity.lifetimeCap
                TMLiveActivity.dbg("plugin.start", "pid=\(productionId.prefix(8)) ADOPT id=\(adopt.id.prefix(8)) strays=\(strays.count) call=\(Int(callEpoch)) otFrom=\(otFrom.isEmpty ? "-" : otFrom) cap=\(Int(cap))")
                Task {
                    await adopt.update(makeContent(cap))
                    for s in strays { await s.end(nil, dismissalPolicy: .immediate) }
                    call.resolve(["id": adopt.id, "adopted": true])
                }
            } else {
                do {
                    // A fresh request starts a fresh iOS lifetime: cap = now + 7h45m.
                    let cap = Date().timeIntervalSince1970 + TMLiveActivity.lifetimeCap
                    let activity = try Activity.request(attributes: attributes, content: makeContent(cap), pushType: nil)
                    self.currentActivity = activity
                    TMLiveActivity.recordRequestedAt(activity.id)
                    TMLiveActivity.dbg("plugin.start", "pid=\(productionId.prefix(8)) REQUEST id=\(activity.id.prefix(8)) strays=\(strays.count) call=\(Int(callEpoch)) otFrom=\(otFrom.isEmpty ? "-" : otFrom) cap=\(Int(cap))")
                    call.resolve(["id": activity.id])
                    Task { for s in strays { await s.end(nil, dismissalPolicy: .immediate) } }
                } catch {
                    TMLiveActivity.dbg("plugin.start.fail", error.localizedDescription)
                    call.reject("Failed to start Live Activity: \(error.localizedDescription)")
                }
            }
        }
    }

    // MARK: - update

    @objc func updateActivity(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *) else { call.resolve(); return }
        guard let activity = currentActivity as? Activity<TimeMachineActivityAttributes> else {
            // The silent stale-content window: after a cold relaunch the system
            // card survives but this in-memory handle is nil until the next
            // startActivity adopts it — every update lands here and vanishes.
            TMLiveActivity.dbg("plugin.update.noop", "handle=nil (cold-relaunch window) state=\(call.getString("state") ?? "?")")
            call.resolve(); return
        }
        let totalText = call.getString("totalText") ?? ""
        let state = call.getString("state") ?? "oncall"
        let callEpoch = call.getDouble("callEpoch") ?? 0
        let anchorLabel = call.getString("anchorLabel") ?? ""
        let endEpoch = call.getDouble("endEpoch") ?? 0
        let cwd = call.getBool("cwd") ?? false
        let lunchEndEpoch = call.getDouble("lunchEndEpoch") ?? 0
        let otFrom = call.getString("otFrom") ?? ""
        let curtailMins = call.getInt("curtailMins") ?? 0
        let lunchLogged = call.getBool("lunchLogged") ?? false
        let wrapCurve = (call.getArray("wrapCurve") ?? []).compactMap { ($0 as? NSNumber)?.doubleValue }
        let staleDate = call.getDouble("staleEpoch").map { Date(timeIntervalSince1970: $0) }
        Task {
            // The anchor (callEpoch + anchorLabel) is carried on EVERY update so a
            // mid-day call/pre-call edit re-anchors the live card (it lives in
            // ContentState, not the start-fixed Attributes). armed:"" — an app-driven
            // update always clears any pending two-tap arm (the app never sends a
            // non-empty armed): the backstop reset for an arm that never confirmed.
            // fix/la-husk Fix 2: the cap is PRESERVED across updates — the card's
            // own state first, the requestedAt map as backfill. nil (an in-flight
            // pre-cap card with no map entry) → no clamp, no EXPIRED branch:
            // exactly the old behaviour until that card is re-minted.
            let cap = activity.content.state.capEpoch
                ?? TMLiveActivity.requestedAt(activity.id).map { $0 + TMLiveActivity.lifetimeCap }
            await activity.update(ActivityContent(
                state: TimeMachineActivityAttributes.ContentState(totalText: totalText, state: state, callEpoch: callEpoch, anchorLabel: anchorLabel, endEpoch: endEpoch, armed: "", armedAt: 0, cwd: cwd, lunchEndEpoch: lunchEndEpoch, otFrom: otFrom, curtailMins: curtailMins, lunchLogged: lunchLogged, wrapCurve: wrapCurve, capEpoch: cap),
                staleDate: TMLiveActivity.cappedStaleDate(staleDate, capEpoch: cap)
            ))
            TMLiveActivity.dbg("plugin.update", "state=\(state) call=\(Int(callEpoch)) otFrom=\(otFrom.isEmpty ? "-" : otFrom) total=\(totalText) cap=\(cap.map { String(Int($0)) } ?? "-")")
            call.resolve()
        }
    }

    // MARK: - end

    @objc func endActivity(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *) else { call.resolve(); return }
        guard let activity = currentActivity as? Activity<TimeMachineActivityAttributes> else {
            TMLiveActivity.dbg("plugin.end.noop", "handle=nil")
            call.resolve(); return
        }
        self.currentActivity = nil
        // immediate:true (disqualified day / setting off) dismisses NOW; the
        // default keeps the brief linger so a wrapped card gets its send-off.
        // The JS controller also sets a staleDate as a wider safety net.
        let immediate = call.getBool("immediate") ?? false
        TMLiveActivity.dbg("plugin.end", "id=\(activity.id.prefix(8)) immediate=\(immediate)")
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
        let acts = Activity<TimeMachineActivityAttributes>.activities.map { act -> [String: Any] in
            // fix/la-husk (a): carry activityState so the sweep can tell a LIVE
            // card from a system-ended husk still sitting in the registry —
            // {id, productionId} alone made it structurally blind, and a husk
            // counted as "covered", blocking the re-mint.
            let state: String
            switch act.activityState {
            case .active:     state = "active"
            case .stale:      state = "stale"
            case .ended:      state = "ended"
            case .dismissed:  state = "dismissed"
            case .pending:    state = "pending"   // push-to-start only; this app never mints one
            @unknown default: state = "unknown"
            }
            // The card as WITNESS (founder-ruled 2026-09-04): its content state
            // travels to JS so the reconcile sweep can compare curtail minutes,
            // lunch logged and wrapped against the record - the detector that
            // would have caught the 3 September curtail while the card still
            // lived. Additive: id / productionId / activityState are unchanged.
            let st = act.content.state
            return ["id": act.id, "productionId": act.attributes.productionId, "activityState": state,
                    "state": st.state, "curtailMins": st.curtailMins, "lunchLogged": st.lunchLogged,
                    "lunchEndEpoch": st.lunchEndEpoch, "endEpoch": st.endEpoch, "callEpoch": st.callEpoch, "armed": st.armed]
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
            var ended = 0
            for activity in Activity<TimeMachineActivityAttributes>.activities
            where activity.attributes.productionId == productionId {
                await activity.end(
                    ActivityContent(state: activity.content.state, staleDate: nil),
                    dismissalPolicy: immediate ? .immediate : .after(Date().addingTimeInterval(5 * 60))
                )
                ended += 1
            }
            TMLiveActivity.dbg("plugin.endForProduction", "pid=\(productionId.prefix(8)) immediate=\(immediate) ended=\(ended)")
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
            TMLiveActivity.dbg("plugin.endIds", "converged=\(ids.count)")
            call.resolve()
        }
    }

    // MARK: - Diagnostics (fix/la-diagnostics — flag-gated ring buffer)

    // The JS-facing surface for TMLiveActivity's App-Group ring buffer: the
    // hidden Settings toggle flips the flag, "Share diagnostics" reads the
    // joined log, and appendDebugLog lets the controller/sweep/ingest add
    // their lines (native-gated on the same flag, so JS calls it
    // unconditionally at zero cost when off). No ActivityKit use — safe on
    // every OS version.

    @objc func setDebugLogging(_ call: CAPPluginCall) {
        let enabled = call.getBool("enabled") ?? false
        UserDefaults(suiteName: Self.appGroupSuite)?.set(enabled, forKey: TMLiveActivity.debugEnabledKey)
        if enabled {
            let v = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "?"
            let b = Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "?"
            TMLiveActivity.dbg("debug.enabled", "app v\(v) (\(b)) iOS \(ProcessInfo.processInfo.operatingSystemVersionString)")
        }
        call.resolve(["enabled": enabled])
    }

    @objc func getDebugLogging(_ call: CAPPluginCall) {
        call.resolve(["enabled": TMLiveActivity.debugEnabled])
    }

    @objc func getDiagnostics(_ call: CAPPluginCall) {
        let log = UserDefaults(suiteName: Self.appGroupSuite)?.stringArray(forKey: TMLiveActivity.debugLogKey) ?? []
        call.resolve(["log": log.joined(separator: "\n"), "count": log.count])
    }

    @objc func clearDiagnostics(_ call: CAPPluginCall) {
        UserDefaults(suiteName: Self.appGroupSuite)?.removeObject(forKey: TMLiveActivity.debugLogKey)
        call.resolve()
    }

    // `always` carries the JS caller's intent through to dbg(): the render/nav
    // lines set it so they record whether or not diagnostics are enabled, while
    // every existing Live Activity caller omits it and stays flag-gated exactly
    // as before. Absent → false → unchanged behaviour for all sixteen of them.
    @objc func appendDebugLog(_ call: CAPPluginCall) {
        TMLiveActivity.dbg("js", call.getString("line") ?? "", always: call.getBool("always") ?? false)
        call.resolve()
    }

    // MARK: - drainPendingEvents - AT-LEAST-ONCE (founder-ruled 2026-09-04)
    // The Stage-2 drain read-and-cleared ("handed over exactly once"), so a death
    // between the hand-over and the record's persist ate the press with the
    // queue already empty - the lost 32-minute curtail. Now pending events MOVE
    // into an in-flight set (PendingEventsStore.drain: dedupe, oldest press
    // first, age cap) and everything unconfirmed is handed again on every drain;
    // confirmEvents, called by JS after its persist chain has flushed, is the
    // only remover. In-flight is written BEFORE pending is cleared, so a death
    // between the two re-hands rather than loses. JS re-application is
    // idempotent (absolute-value writes), which is what makes this safe.
    @objc func drainPendingEvents(_ call: CAPPluginCall) {
        guard let defaults = UserDefaults(suiteName: Self.appGroupSuite) else {
            call.resolve(["events": [], "expired": []])
            return
        }
        let pending = defaults.array(forKey: Self.pendingEventsKey) as? [[String: Any]] ?? []
        let inflight = defaults.array(forKey: Self.inflightEventsKey) as? [[String: Any]] ?? []
        let d = PendingEventsStore.drain(pending: pending, inflight: inflight, nowMs: Int(Date().timeIntervalSince1970 * 1000))
        defaults.set(d.inflight, forKey: Self.inflightEventsKey)
        if !pending.isEmpty { defaults.removeObject(forKey: Self.pendingEventsKey) }
        if !d.hand.isEmpty || !d.expired.isEmpty {
            TMLiveActivity.dbg("plugin.drain", "handed \(d.hand.count) (new \(pending.count), in flight \(inflight.count)) expired \(d.expired.count)")
        }
        call.resolve(["events": d.hand, "expired": d.expired])
    }
    /// JS stores the target date it resolved for each id BEFORE applying, so a
    /// re-hand after a death carries it and never re-resolves ownership later.
    @objc func claimEvents(_ call: CAPPluginCall) {
        let targets = (call.getObject("targets") ?? [:]).compactMapValues { $0 as? String }
        if let defaults = UserDefaults(suiteName: Self.appGroupSuite), !targets.isEmpty {
            let inflight = defaults.array(forKey: Self.inflightEventsKey) as? [[String: Any]] ?? []
            defaults.set(PendingEventsStore.claim(inflight: inflight, targets: targets), forKey: Self.inflightEventsKey)
        }
        call.resolve()
    }
    /// THE ONLY REMOVER. JS calls it after the record and the applied set have
    /// flushed to disk; it also ends the intent's background hold (TMDrainWaiter).
    @objc func confirmEvents(_ call: CAPPluginCall) {
        let ids = call.getArray("ids", String.self) ?? []
        // A REAL FLUSH BEFORE THE ONLY REMOVER (founder-ruled 2026-09-04, after the
        // 09:04 loss): Capacitor's Preferences resolves on UserDefaults.set, which
        // hands the value to cfprefsd asynchronously - a kill inside that gap lost a
        // confirmed one-minute curtail while the JS believed it persisted.
        // synchronize() blocks until the daemon has the data: the standard domain
        // (where Capacitor keeps the record and the applied set) and the App Group
        // (the in-flight set). Both timed, so a future loss can be placed either
        // side of the flush: persist.landed before the kill and the value still
        // gone means synchronize() is not enough and the atomic-file fallback is
        // next; no persist.landed before the kill means the re-hand must carry it.
        let t0 = Date()
        _ = UserDefaults.standard.synchronize()
        let t1 = Date()
        let group = UserDefaults(suiteName: Self.appGroupSuite)
        _ = group?.synchronize()
        let t2 = Date()
        TMLiveActivity.dbg("persist.landed", "standard=\(Int(t1.timeIntervalSince(t0) * 1000))ms group=\(Int(t2.timeIntervalSince(t1) * 1000))ms ids=\(ids.count)")
        if let defaults = group, !ids.isEmpty {
            let inflight = defaults.array(forKey: Self.inflightEventsKey) as? [[String: Any]] ?? []
            defaults.set(PendingEventsStore.confirm(inflight: inflight, ids: ids), forKey: Self.inflightEventsKey)
            TMLiveActivity.dbg("plugin.confirm", "confirmed \(ids.count)")
        }
        NotificationCenter.default.post(name: TMLiveActivity.drainConfirmedName, object: nil)
        call.resolve()
    }
    // MARK: - setActiveShoot (Stage B)

    // JS->native write of the today's-active-shoot snapshot into the App Group, so
    // the "log my times" App Intent can resolve the production WITHOUT a running
    // Live Activity. Empty productionId or date CLEARS the key (closeProduction, or
    // no qualifying today day). The intent re-checks date == today on read.
    @objc func setActiveShoot(_ call: CAPPluginCall) {
        guard let defaults = UserDefaults(suiteName: Self.appGroupSuite) else {
            call.resolve(["ok": false])
            return
        }
        let pid = call.getString("productionId") ?? ""
        let date = call.getString("date") ?? ""
        if pid.isEmpty || date.isEmpty {
            defaults.removeObject(forKey: Self.activeShootKey)
        } else {
            defaults.set(["productionId": pid, "date": date], forKey: Self.activeShootKey)
        }
        call.resolve(["ok": true])
    }
}
