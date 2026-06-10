//
//  TimeMachineIntents.swift
//  TimeMachineWidget
//
//  Stage 2 — interactive Live Activity buttons (Lunch now / Wrap now).
//
//  Process model (decided): these App Intents run in the WIDGET-EXTENSION
//  process — they do NOT open or background-launch the (Capacitor/WKWebView)
//  app. Each tap (1) APPENDS an event to the App-Group queue — the CRITICAL
//  path — and (2) flips the running Activity's chip for instant feedback — a
//  BEST-EFFORT cosmetic. The app drains + applies the queue on next foreground
//  through its existing lunch/wrap setters; the chip flip is not relied upon.
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

    /// BEST-EFFORT — flip the matching Activity's chip from this (extension)
    /// process. Total is preserved; only the state changes. Isolated so the
    /// fallback to app-process is a one-spot change.
    @available(iOS 16.2, *)
    static func flipChip(productionId: String, to state: String) async {
        for activity in Activity<TimeMachineActivityAttributes>.activities
        where activity.attributes.productionId == productionId {
            let cur = activity.content.state
            await activity.update(ActivityContent(
                state: TimeMachineActivityAttributes.ContentState(totalText: cur.totalText, state: state),
                staleDate: nil
            ))
        }
    }

    /// BEST-EFFORT — flip to WRAPPED then end with a short dismissal window.
    @available(iOS 16.2, *)
    static func flipChipAndEnd(productionId: String) async {
        for activity in Activity<TimeMachineActivityAttributes>.activities
        where activity.attributes.productionId == productionId {
            let cur = activity.content.state
            let wrapped = ActivityContent(
                state: TimeMachineActivityAttributes.ContentState(totalText: cur.totalText, state: "wrapped"),
                staleDate: nil
            )
            await activity.update(wrapped)
            await activity.end(wrapped, dismissalPolicy: .after(Date().addingTimeInterval(5 * 60)))
        }
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
        TMLiveActivity.appendEvent(type: "lunchNow", productionId: productionId) // critical
        await TMLiveActivity.flipChip(productionId: productionId, to: "lunch")    // best-effort
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
        TMLiveActivity.appendEvent(type: "wrapNow", productionId: productionId)   // critical
        await TMLiveActivity.flipChipAndEnd(productionId: productionId)           // best-effort
        return .result()
    }
}
