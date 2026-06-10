//
//  TimeMachineIntents.swift
//  TimeMachineWidget
//
//  Stage 2 — interactive Live Activity buttons (Lunch now / Wrap now).
//
//  Process model (decided): these App Intents run in the WIDGET-EXTENSION
//  process — they do NOT open or background-launch the (Capacitor/WKWebView)
//  app. Two-tap confirm: the FIRST tap ARMS (writes `armed` into the running
//  Activity's ContentState so the button flips to "✓ CONFIRM?"); the confirming
//  SECOND tap (already armed) (1) APPENDS an event to the App-Group queue — the
//  CRITICAL path — and (2) flips the chip / freezes+ends the card — BEST-EFFORT.
//  The app drains + applies the queue on next foreground through the shared
//  record-write transform; the chip flip is not relied upon. The arm RESETS to
//  "" on confirm, on tapping the other button, or on the next app-driven content
//  update (the app never sends a non-empty `armed`).
//
//  Note: two-tap depends on the extension-process content update persisting
//  `armed` between taps (the only cross-tap state a widget has). The event
//  write itself stays a direct App-Group append on confirm.
//
//  Contained fallback: if extension-process Activity updates prove unreliable
//  on device, the ONLY change needed is to make these conform to
//  `LiveActivityIntent` (app-process) and tick App-target membership on this
//  file — `appendEvent` (the critical path) stays exactly as-is.
//
//  iOS gate: Live Activity buttons require iOS 17. These intents are
//  @available(iOS 17.0, *); the SwiftUI gates the buttons behind the same
//  check, so on 16.2 the card stays display-only.
//

import AppIntents
import ActivityKit
import Foundation

// MARK: - App-Group event queue + chip bridge

enum TMLiveActivity {
    static let appGroupSuite = "group.co.uk.timemachineapp.shared"
    static let pendingEventsKey = "pendingEvents"

    /// CRITICAL PATH — append one event to the App-Group queue. Must be
    /// rock-solid and independent of the chip flip. Matches the in-app "Now"
    /// writers exactly: `at` = LOCAL HH:MM (no rounding); `date` = UTC
    /// YYYY-MM-DD to match the web's todayISO() (`toISOString().slice(0,10)`)
    /// so ingestion lands on the same day record.
    static func appendEvent(type: String, productionId: String) {
        guard let defaults = UserDefaults(suiteName: appGroupSuite) else { return }
        let now = Date()

        let timeFmt = DateFormatter()
        timeFmt.locale = Locale(identifier: "en_GB_POSIX")
        timeFmt.dateFormat = "HH:mm"            // local timezone (default)

        let dateFmt = DateFormatter()
        dateFmt.locale = Locale(identifier: "en_US_POSIX")
        dateFmt.timeZone = TimeZone(identifier: "UTC")
        dateFmt.dateFormat = "yyyy-MM-dd"       // UTC, to match todayISO()

        let event: [String: Any] = [
            "id": UUID().uuidString,
            "type": type,
            "at": timeFmt.string(from: now),
            "date": dateFmt.string(from: now),
            "ts": Int(now.timeIntervalSince1970 * 1000),
            "productionId": productionId,
        ]
        var queue = defaults.array(forKey: pendingEventsKey) as? [[String: Any]] ?? []
        queue.append(event)
        defaults.set(queue, forKey: pendingEventsKey)
    }

    /// The running Activity for this production (if any).
    @available(iOS 16.2, *)
    static func current(_ productionId: String) -> Activity<TimeMachineActivityAttributes>? {
        Activity<TimeMachineActivityAttributes>.activities.first { $0.attributes.productionId == productionId }
    }

    /// Current two-tap arm state ("" | "lunch" | "wrap"). Read synchronously so
    /// an Intent can decide arm-vs-confirm without awaiting.
    @available(iOS 16.2, *)
    static func armedAction(_ productionId: String) -> String {
        current(productionId)?.content.state.armed ?? ""
    }

    /// BEST-EFFORT — update the matching Activity's content from this (extension)
    /// process, preserving any field not overridden. Isolated so the fallback to
    /// app-process is a one-spot change.
    @available(iOS 16.2, *)
    static func update(_ productionId: String, state: String? = nil, armed: String? = nil) async {
        guard let activity = current(productionId) else { return }
        let cur = activity.content.state
        let next = TimeMachineActivityAttributes.ContentState(
            totalText: cur.totalText,
            state: state ?? cur.state,
            endEpoch: cur.endEpoch,
            armed: armed ?? cur.armed
        )
        await activity.update(ActivityContent(state: next, staleDate: nil))
    }

    /// BEST-EFFORT — flip to WRAPPED, freeze the timer (endEpoch = now), clear
    /// any arm, then end with a short dismissal window so the wrapped card lingers.
    @available(iOS 16.2, *)
    static func endWrapped(_ productionId: String) async {
        guard let activity = current(productionId) else { return }
        let cur = activity.content.state
        let wrapped = ActivityContent(
            state: TimeMachineActivityAttributes.ContentState(
                totalText: cur.totalText,
                state: "wrapped",
                endEpoch: Date().timeIntervalSince1970,
                armed: ""
            ),
            staleDate: nil
        )
        await activity.update(wrapped)
        await activity.end(wrapped, dismissalPolicy: .after(Date().addingTimeInterval(5 * 60)))
    }
}

// MARK: - Intents

@available(iOS 17.0, *)
struct LunchNowIntent: AppIntent {
    static var title: LocalizedStringResource = "Lunch now"
    // Runs in the widget process without surfacing the app.
    static var openAppWhenRun: Bool = false

    @Parameter(title: "Production") var productionId: String

    init() {}
    init(productionId: String) { self.productionId = productionId }

    func perform() async throws -> some IntentResult {
        // Two-tap: first tap ARMS (no event written), the confirming second tap
        // (already armed) writes the event. So a single stray tap never logs.
        if TMLiveActivity.armedAction(productionId) == "lunch" {
            TMLiveActivity.appendEvent(type: "lunchNow", productionId: productionId) // CRITICAL (confirm only)
            await TMLiveActivity.update(productionId, state: "lunch", armed: "")      // best-effort chip + disarm
        } else {
            await TMLiveActivity.update(productionId, armed: "lunch")                 // arm → button shows ✓ CONFIRM?
        }
        return .result()
    }
}

@available(iOS 17.0, *)
struct WrapNowIntent: AppIntent {
    static var title: LocalizedStringResource = "Wrap now"
    static var openAppWhenRun: Bool = false

    @Parameter(title: "Production") var productionId: String

    init() {}
    init(productionId: String) { self.productionId = productionId }

    func perform() async throws -> some IntentResult {
        // Two-tap: first tap ARMS (no event written), the confirming second tap
        // (already armed) writes the event + freezes/ends the card.
        if TMLiveActivity.armedAction(productionId) == "wrap" {
            TMLiveActivity.appendEvent(type: "wrapNow", productionId: productionId)  // CRITICAL (confirm only)
            await TMLiveActivity.endWrapped(productionId)                            // best-effort wrap + freeze + end
        } else {
            await TMLiveActivity.update(productionId, armed: "wrap")                 // arm → button shows ✓ CONFIRM?
        }
        return .result()
    }
}
