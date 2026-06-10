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
//  Two-tap confirm: the FIRST tap ARMS (writes `armed` + an `armedAt` stamp into
//  the running Activity's ContentState so the button flips to "✓ Confirm?"); the
//  confirming SECOND tap (armed and FRESH — within armWindow) (1) APPENDS an
//  event to the App-Group queue — the CRITICAL path, a direct UserDefaults write
//  that never depends on the arm render — and (2) flips the chip / freezes+ends
//  the card. The app drains + applies the queue on next foreground through the
//  shared record-write transform, idempotent + today-only.
//
//  Arm lifecycle: the arm AUTO-RESETS after ~4s — the arming perform() stays
//  open for the window (the system holds the app process while an intent is in
//  flight; observed perform() budget is ~20-30s, so 4s is comfortably inside)
//  and then clears the arm IF it is still the same instance (stamp check), so a
//  confirm or a newer arm is never cancelled or doubled. Further resets: confirm,
//  tapping the other button (re-arms to it), any app-driven content update (the
//  app never sends a non-empty `armed`), and — if iOS suspended the process
//  before the delayed reset fired — armedAction's freshness gate refuses to
//  confirm off an expired arm (the tap re-arms instead), so a visually stuck
//  CONFIRM? can never instantly log.
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

    /// Set true by LiveActivityPlugin.load() when the app's webview/JS booted in
    /// THIS process. A LiveActivityIntent that RESUMES a suspended app still sees
    /// it true (process memory survives suspend); a COLD intent-launch (no webview)
    /// sees false → requestBackgroundDrain no-ops and the event waits for the
    /// normal foreground drain. The discriminator that keeps Issue-C's background
    /// nudge from wastefully holding a cold process.
    static var webviewObserving = false

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

    /// The two-tap confirm window. An arm older than this is EXPIRED: the view's
    /// auto-reset clears it visually, and armedAction refuses to confirm off it.
    static let armWindow: TimeInterval = 4.0

    /// The running Activity for this production (if any).
    @available(iOS 16.2, *)
    static func current(_ productionId: String) -> Activity<TimeMachineActivityAttributes>? {
        Activity<TimeMachineActivityAttributes>.activities.first { $0.attributes.productionId == productionId }
    }

    /// Current two-tap arm state ("" | "lunch" | "wrap"), gated on FRESHNESS:
    /// an arm older than armWindow returns "" so a stale CONFIRM? (auto-reset
    /// missed because iOS suspended the process mid-hold) can never confirm —
    /// the tap re-arms instead. Keeps the intent's decision aligned with what
    /// the card visually promises.
    @available(iOS 16.2, *)
    static func armedAction(_ productionId: String) -> String {
        guard let cur = current(productionId)?.content.state else { return "" }
        guard cur.armed != "",
              Date().timeIntervalSince1970 - cur.armedAt < armWindow else { return "" }
        return cur.armed
    }

    /// ARM — write the armed state stamped with its instant. Returns the stamp so
    /// the caller's delayed auto-reset can clear exactly THIS arm and never a
    /// newer one. The FIRST operation of an arm tap; nothing precedes it.
    @available(iOS 16.2, *)
    static func arm(_ productionId: String, action: String) async -> Double {
        guard let activity = current(productionId) else { return 0 }
        let cur = activity.content.state
        let stamp = Date().timeIntervalSince1970
        let next = TimeMachineActivityAttributes.ContentState(
            totalText: cur.totalText, state: cur.state,
            callEpoch: cur.callEpoch, anchorLabel: cur.anchorLabel, endEpoch: cur.endEpoch,
            armed: action, armedAt: stamp, l1: cur.l1, cwd: cur.cwd
        )
        await activity.update(ActivityContent(state: next, staleDate: nil))
        return stamp
    }

    /// Delayed auto-reset — clears the arm IF it is still the exact instance the
    /// caller created (same action + same stamp). A confirm (armed→"") or a newer
    /// arm (different stamp) makes this a no-op, so it can never cancel or double
    /// a confirmed action — it only ever un-arms its own stale CONFIRM?.
    @available(iOS 16.2, *)
    static func disarmIfStillArmed(_ productionId: String, action: String, stamp: Double) async {
        guard let activity = current(productionId) else { return }
        let cur = activity.content.state
        guard cur.armed == action, cur.armedAt == stamp else { return }
        let next = TimeMachineActivityAttributes.ContentState(
            totalText: cur.totalText, state: cur.state,
            callEpoch: cur.callEpoch, anchorLabel: cur.anchorLabel, endEpoch: cur.endEpoch,
            armed: "", armedAt: 0, l1: cur.l1, cwd: cur.cwd
        )
        await activity.update(ActivityContent(state: next, staleDate: nil))
    }

    /// CONFIRM-side update — flips the chip state and clears the arm, preserving
    /// everything else (anchor, endEpoch, warning flags).
    @available(iOS 16.2, *)
    static func update(_ productionId: String, state: String? = nil) async {
        guard let activity = current(productionId) else { return }
        let cur = activity.content.state
        let next = TimeMachineActivityAttributes.ContentState(
            totalText: cur.totalText,
            state: state ?? cur.state,
            callEpoch: cur.callEpoch,
            anchorLabel: cur.anchorLabel,
            endEpoch: cur.endEpoch,
            armed: "", armedAt: 0, l1: cur.l1, cwd: cur.cwd
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
                callEpoch: cur.callEpoch,
                anchorLabel: cur.anchorLabel,
                endEpoch: Date().timeIntervalSince1970,
                armed: "", armedAt: 0, l1: cur.l1, cwd: cur.cwd
            ),
            staleDate: nil
        )
        await activity.update(wrapped)
        await activity.end(wrapped, dismissalPolicy: .after(Date().addingTimeInterval(5 * 60)))
    }

    /// BEST-EFFORT (Issue C) — if the app's WKWebView/JS is alive in this process
    /// (app suspended, not terminated), nudge it to re-run ingestion (drain +
    /// apply + recompute + updateActivity) so a lock-screen log reflects on the
    /// card's TOTAL without opening the app — then hold the process briefly so that
    /// async round-trip can finish before iOS re-suspends. Cold (no webview) →
    /// no-op; the event waits for the normal foreground drain. Exactly-once holds:
    /// JS re-uses the SAME idempotency set + atomic queue clear as the foreground
    /// path, so a background apply can never double-apply on the next foreground.
    static func requestBackgroundDrain() async {
        guard webviewObserving else { return }   // cold launch → leave it for foreground
        NotificationCenter.default.post(name: Notification.Name("TMLiveActivityDrainRequest"), object: nil)
        try? await Task.sleep(nanoseconds: 2_500_000_000)
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
        // Two-tap: first tap ARMS, the confirming second tap writes the event.
        let armed = TMLiveActivity.armedAction(productionId)
        if armed == "lunch" {
            // CONFIRM: the App-Group append is the critical, direct write.
            TMLiveActivity.appendEvent(type: "lunchNow", productionId: productionId)
            await TMLiveActivity.update(productionId, state: "lunch")               // immediate chip + disarm
            await TMLiveActivity.requestBackgroundDrain()                           // best-effort live total
        } else {
            // ARM: the Activity update is the FIRST op — nothing (logging, queue
            // work) precedes it, to minimise the visible arm latency. Then HOLD
            // perform() open for the confirm window (the system keeps the app
            // process alive while an intent is in flight; the button stays
            // tappable — intent taps are not serialised behind this) and
            // auto-reset the arm if it was never confirmed. The stamp check makes
            // a confirm or a newer arm turn the reset into a no-op.
            let stamp = await TMLiveActivity.arm(productionId, action: "lunch")
            NSLog("[LiveActivity] LunchNowIntent armed (app process) pid=%@", productionId)
            try? await Task.sleep(nanoseconds: UInt64(TMLiveActivity.armWindow * 1_000_000_000))
            await TMLiveActivity.disarmIfStillArmed(productionId, action: "lunch", stamp: stamp)
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
        // Two-tap: first tap ARMS, the confirming second tap writes the event.
        let armed = TMLiveActivity.armedAction(productionId)
        if armed == "wrap" {
            // CONFIRM: critical direct write, then freeze + end the card. No
            // background-drain nudge — the card is ending and the total freezes
            // at wrap; the wrap write reaches records on the normal foreground drain.
            TMLiveActivity.appendEvent(type: "wrapNow", productionId: productionId)
            await TMLiveActivity.endWrapped(productionId)
        } else {
            // ARM first, then hold the confirm window open and auto-reset if
            // never confirmed (see LunchNowIntent for the full rationale).
            let stamp = await TMLiveActivity.arm(productionId, action: "wrap")
            NSLog("[LiveActivity] WrapNowIntent armed (app process) pid=%@", productionId)
            try? await Task.sleep(nanoseconds: UInt64(TMLiveActivity.armWindow * 1_000_000_000))
            await TMLiveActivity.disarmIfStillArmed(productionId, action: "wrap", stamp: stamp)
        }
        return .result()
    }
}
