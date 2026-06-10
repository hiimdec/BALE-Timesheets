//
//  TimeMachineIntents.swift
//  TimeMachineWidget
//
//  Stage 2 — interactive Live Activity buttons (Lunch now / Wrap now).
//
//  Process model: these conform to `LiveActivityIntent`, so the system runs
//  perform() in the APP process (background-launched, NOT foregrounded —
//  openAppWhenRun=false), which is where ActivityKit can reliably mutate the
//  app-owned Activity. (Stage 2 first shipped them as plain `AppIntent`s, which
//  iOS runs in the WIDGET-EXTENSION process while the app is backgrounded; from
//  there `Activity.update` silently no-ops, so the arm never rendered and — since
//  the event writes only on the confirming tap — `armedAction` never flipped, so
//  no event was ever appended. Switching to LiveActivityIntent fixed both.)
//
//  Two-tap confirm: the FIRST tap ARMS (writes `armed` into the running
//  Activity's ContentState so the button flips to "✓ CONFIRM?"); the confirming
//  SECOND tap (already armed) (1) APPENDS an event to the App-Group queue — the
//  CRITICAL path, a direct UserDefaults write that never depends on the arm
//  render — and (2) flips the chip / freezes+ends the card. The app drains +
//  applies the queue on next foreground through the shared record-write
//  transform, idempotent + today-only. The arm RESETS to "" on confirm, on
//  tapping the other button, or on the next app-driven content update (the app
//  never sends a non-empty `armed`).
//
//  Target membership: because perform() must run in the APP process, this file
//  is a member of BOTH the TimeMachineWidget extension (where Button(intent:)
//  references the type) AND the App target (where perform() executes) — wired in
//  project.pbxproj via the App-target membershipExceptions, same as the shared
//  TimeMachineActivityAttributes.swift.
//
//  iOS gate: Live Activity buttons + LiveActivityIntent require iOS 17. These
//  intents are @available(iOS 17.0, *); the SwiftUI gates the buttons behind the
//  same check, so on 16.2 the card stays display-only.
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
struct LunchNowIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "Lunch now"
    // Runs in the widget process without surfacing the app.
    static var openAppWhenRun: Bool = false

    @Parameter(title: "Production") var productionId: String

    init() {}
    init(productionId: String) { self.productionId = productionId }

    func perform() async throws -> some IntentResult {
        // Two-tap: first tap ARMS (no event written), the confirming second tap
        // (already armed) writes the event. So a single stray tap never logs.
        let armed = TMLiveActivity.armedAction(productionId)
        NSLog("[LiveActivity] LunchNowIntent.perform (app process) armed=%@ pid=%@", armed, productionId)
        if armed == "lunch" {
            TMLiveActivity.appendEvent(type: "lunchNow", productionId: productionId) // CRITICAL (confirm only)
            await TMLiveActivity.update(productionId, state: "lunch", armed: "")      // best-effort chip + disarm
        } else {
            await TMLiveActivity.update(productionId, armed: "lunch")                 // arm → button shows ✓ CONFIRM?
        }
        return .result()
    }
}

@available(iOS 17.0, *)
struct WrapNowIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "Wrap now"
    static var openAppWhenRun: Bool = false

    @Parameter(title: "Production") var productionId: String

    init() {}
    init(productionId: String) { self.productionId = productionId }

    func perform() async throws -> some IntentResult {
        // Two-tap: first tap ARMS (no event written), the confirming second tap
        // (already armed) writes the event + freezes/ends the card.
        let armed = TMLiveActivity.armedAction(productionId)
        NSLog("[LiveActivity] WrapNowIntent.perform (app process) armed=%@ pid=%@", armed, productionId)
        if armed == "wrap" {
            TMLiveActivity.appendEvent(type: "wrapNow", productionId: productionId)  // CRITICAL (confirm only)
            await TMLiveActivity.endWrapped(productionId)                            // best-effort wrap + freeze + end
        } else {
            await TMLiveActivity.update(productionId, armed: "wrap")                 // arm → button shows ✓ CONFIRM?
        }
        return .result()
    }
}
