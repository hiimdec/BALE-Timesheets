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
    ///
    /// Returns the stamped `at` (HH:mm) so callers that speak a confirmation
    /// (the Siri voice intents) can echo the EXACT stamped time; the Live
    /// Activity button intents ignore it (@discardableResult) — their
    /// behaviour is unchanged. "" only if the App Group is unreachable.
    ///
    /// `durationMins` (Group B) is carried ONLY by the curtailed-lunch event
    /// ("lunchCurtail"): the whole-minute lunch duration the card captured
    /// (now − lunchStart). Omitted (nil) for every existing event type, so their
    /// payload — and the JS ingestion of them — is byte-for-byte unchanged. Same
    /// queue, same idempotent today-only ingestion; a new field, not a new channel.
    @discardableResult
    static func appendEvent(type: String, productionId: String, durationMins: Int? = nil) -> String {
        guard let defaults = UserDefaults(suiteName: appGroupSuite) else { return "" }
        let now = Date()

        let timeFmt = DateFormatter()
        timeFmt.locale = Locale(identifier: "en_GB_POSIX")
        timeFmt.dateFormat = "HH:mm"            // local timezone (default)

        let dateFmt = DateFormatter()
        dateFmt.locale = Locale(identifier: "en_US_POSIX")
        dateFmt.timeZone = TimeZone(identifier: "UTC")
        dateFmt.dateFormat = "yyyy-MM-dd"       // UTC, to match todayISO()

        let at = timeFmt.string(from: now)
        var event: [String: Any] = [
            "id": UUID().uuidString,
            "type": type,
            "at": at,
            "date": dateFmt.string(from: now),
            "ts": Int(now.timeIntervalSince1970 * 1000),
            "productionId": productionId,
        ]
        if let durationMins { event["durationMins"] = durationMins }
        var queue = defaults.array(forKey: pendingEventsKey) as? [[String: Any]] ?? []
        queue.append(event)
        defaults.set(queue, forKey: pendingEventsKey)
        return at
    }

    /// Stage B — today's-active-shoot snapshot key, written by the app (plugin
    /// setActiveShoot) and READ by the "log my times" voice intent to resolve the
    /// production with no running Live Activity. Must match LiveActivityPlugin's.
    static let activeShootKey = "activeShoot"

    /// Stage B — append a STRUCTURED "setTimes" event from the "log my times" voice
    /// intent. Unlike appendEvent, the times come from the PARSER (not "now"), and
    /// the `date` is the active-shoot date (already == today). Same queue, same
    /// idempotent today-only ingestion; a new event type, NOT a new channel — JS
    /// applies it through the SAME mapDayNow record-write the now-stamps use.
    static func appendSetTimesEvent(productionId: String, date: String,
                                    call: String?, lunch: String?, wrap: String?,
                                    lunchDurationMins: Int?) {
        guard let defaults = UserDefaults(suiteName: appGroupSuite) else { return }
        var event: [String: Any] = [
            "id": UUID().uuidString,
            "type": "setTimes",
            "date": date,
            "ts": Int(Date().timeIntervalSince1970 * 1000),
            "productionId": productionId,
        ]
        if let call { event["call"] = call }
        if let lunch { event["lunch"] = lunch }
        if let wrap { event["wrap"] = wrap }
        if let lunchDurationMins { event["lunchDurationMins"] = lunchDurationMins }
        var queue = defaults.array(forKey: pendingEventsKey) as? [[String: Any]] ?? []
        queue.append(event)
        defaults.set(queue, forKey: pendingEventsKey)
    }

    /// The curtail undo window (Group B). After a "Curtailed?" tap the button
    /// shows "Undo · NNm" for this long; the curtail is WRITTEN only if the window
    /// lapses untapped (a second tap inside it cancels, writing nothing) — so the
    /// calc never sees a value that's about to be undone.
    static let curtailUndoWindow: TimeInterval = 5.0

    /// Whole-minute lunch duration captured at the curtail tap: now − lunchStart,
    /// where lunchStart = lunchEndEpoch − 3600 (Group A.5). Rounded to the nearest
    /// minute to match the integer lunchDurationMins used everywhere else; the JS
    /// calc then owns all curtailed-break pay logic. 0 if no lunch-end is known.
    static func curtailMinutes(lunchEndEpoch: Double) -> Int {
        guard lunchEndEpoch > 0 else { return 0 }
        let lunchStart = lunchEndEpoch - 3600
        let elapsed = Date().timeIntervalSince1970 - lunchStart
        return Int((elapsed / 60).rounded())
    }

    /// The two-tap confirm window. An arm older than this is EXPIRED: the view's
    /// auto-reset clears it visually, and armedAction refuses to confirm off it.
    static let armWindow: TimeInterval = 4.0

    /// The running Activity for this production (if any).
    @available(iOS 16.2, *)
    static func current(_ productionId: String) -> Activity<TimeMachineActivityAttributes>? {
        Activity<TimeMachineActivityAttributes>.activities.first { $0.attributes.productionId == productionId }
    }

    /// The lunch-end refresh wake (LA lunch-exit fix). `isOnLunch` on the card is a
    /// Date()-vs-lunchEndEpoch predicate the SwiftUI view FREEZES between content
    /// updates — Text(timerInterval:) self-ticks without recomputing `body` — so the
    /// card never leaves AT-LUNCH on the locked screen until something refreshes it.
    /// Pointing the ActivityContent staleDate at lunchEndEpoch makes the system
    /// refresh the card AT lunch-end → `body` recomputes → isOnLunch flips false and
    /// the chip / timer slot / Curtailed?-Full-hour button (all on that one
    /// predicate) resolve together, with no foreground. Mirrors the view's isOnLunch
    /// EXACTLY: a still-on-lunch state (logged, uncurtailed, hour-end still ahead) →
    /// the lunch-end Date; anything else → nil (the prior behaviour, so a curtail /
    /// wrap / post-lunch update carries no wake). Every intent-side update routes its
    /// staleDate through this, so a mid-lunch tap can never clobber the wake.
    @available(iOS 16.2, *)
    static func lunchStaleDate(_ s: TimeMachineActivityAttributes.ContentState) -> Date? {
        guard s.lunchLogged, s.curtailMins == 0,
              s.lunchEndEpoch > Date().timeIntervalSince1970 else { return nil }
        return Date(timeIntervalSince1970: s.lunchEndEpoch)
    }

    /// Resolve the day total AT the wrap moment from the pushed wrapCurve —
    /// flattened ascending [epoch, pence, …] pairs the JS calc engine sampled
    /// at each 30-minute OT boundary. Pick the FIRST breakpoint ≥ now: OT is
    /// charged rounded UP to 30 minutes in the crew's favour, so rounding up
    /// the curve reproduces the engine's ceilHalf exactly. Beyond the last
    /// breakpoint → the last total (best effort). Empty curve (flat day types,
    /// probe failure, pre-curve payload) → the pushed totalText unchanged (the
    /// original freeze behaviour). NO pay maths here — these are engine
    /// outputs, looked up.
    @available(iOS 16.2, *)
    static func wrapTotalText(_ s: TimeMachineActivityAttributes.ContentState) -> String {
        guard s.wrapCurve.count >= 2 else { return s.totalText }
        let now = Date().timeIntervalSince1970
        var pence = s.wrapCurve[s.wrapCurve.count - 1]
        var i = 0
        while i + 1 < s.wrapCurve.count {
            if s.wrapCurve[i] >= now { pence = s.wrapCurve[i + 1]; break }
            i += 2
        }
        return gbpText(pence: pence)
    }

    /// "£1,234.56" from pence — byte-matches the web layer's fmtGBP
    /// (toFixed(2) + comma thousands) so a native-resolved total renders
    /// identically to a pushed one.
    static func gbpText(pence: Double) -> String {
        let pounds = pence / 100.0
        var s = String(format: "%.2f", pounds)
        let parts = s.split(separator: ".")
        if parts.count == 2 {
            var intPart = String(parts[0])
            var grouped = ""
            while intPart.count > 3 {
                grouped = "," + intPart.suffix(3) + grouped
                intPart = String(intPart.dropLast(3))
            }
            s = intPart + grouped + "." + parts[1]
        }
        return "£" + s
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
            armed: action, armedAt: stamp, cwd: cur.cwd, lunchEndEpoch: cur.lunchEndEpoch, otFrom: cur.otFrom, curtailMins: cur.curtailMins, lunchLogged: cur.lunchLogged, wrapCurve: cur.wrapCurve
        )
        await activity.update(ActivityContent(state: next, staleDate: lunchStaleDate(next)))
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
            armed: "", armedAt: 0, cwd: cur.cwd, lunchEndEpoch: cur.lunchEndEpoch, otFrom: cur.otFrom, curtailMins: cur.curtailMins, lunchLogged: cur.lunchLogged, wrapCurve: cur.wrapCurve
        )
        await activity.update(ActivityContent(state: next, staleDate: lunchStaleDate(next)))
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
            armed: "", armedAt: 0, cwd: cur.cwd, lunchEndEpoch: cur.lunchEndEpoch, otFrom: cur.otFrom, curtailMins: cur.curtailMins, lunchLogged: cur.lunchLogged, wrapCurve: cur.wrapCurve
        )
        await activity.update(ActivityContent(state: next, staleDate: lunchStaleDate(next)))
    }

    /// CONFIRM Wrap — flip the card to WRAPPED with the curve-resolved total
    /// and frozen timer the INSTANT the confirming tap lands, WITHOUT ending
    /// it yet: the activity stays updatable through the bounded background-
    /// drain window that follows (requestBackgroundDrain holds ~2.5s, the
    /// LunchNowIntent pattern), so a live webview can push one corrected
    /// total covering what the curve couldn't see (a curtail armed on the
    /// card moments before wrap). endWrapped then ends with the normal
    /// linger. Mirrors confirmLunch's instant-flip parity.
    @available(iOS 16.2, *)
    static func confirmWrap(_ productionId: String) async {
        guard let activity = current(productionId) else { return }
        let cur = activity.content.state
        let next = TimeMachineActivityAttributes.ContentState(
            totalText: wrapTotalText(cur),
            state: "wrapped",
            callEpoch: cur.callEpoch,
            anchorLabel: cur.anchorLabel,
            endEpoch: Date().timeIntervalSince1970,
            armed: "", armedAt: 0, cwd: cur.cwd, lunchEndEpoch: cur.lunchEndEpoch, otFrom: cur.otFrom, curtailMins: cur.curtailMins, lunchLogged: cur.lunchLogged, wrapCurve: cur.wrapCurve
        )
        await activity.update(ActivityContent(state: next, staleDate: lunchStaleDate(next)))
    }

    /// BEST-EFFORT — end the WRAPPED card with a short dismissal window so it
    /// lingers. An already-wrapped state (confirmWrap ran, and possibly a JS
    /// drain corrected the total after it) is preserved VERBATIM — resolving
    /// the curve again here would re-read "now" after the ~2.5s drain hold
    /// and could jump a 30-min OT boundary the user never worked. Only a
    /// not-yet-wrapped card (legacy/direct path) resolves and freezes here.
    @available(iOS 16.2, *)
    static func endWrapped(_ productionId: String) async {
        guard let activity = current(productionId) else { return }
        let cur = activity.content.state
        let alreadyWrapped = cur.state == "wrapped"
        let next = TimeMachineActivityAttributes.ContentState(
            totalText: alreadyWrapped ? cur.totalText : wrapTotalText(cur),
            state: "wrapped",
            callEpoch: cur.callEpoch,
            anchorLabel: cur.anchorLabel,
            endEpoch: (alreadyWrapped && cur.endEpoch > 0) ? cur.endEpoch : Date().timeIntervalSince1970,
            armed: "", armedAt: 0, cwd: cur.cwd, lunchEndEpoch: cur.lunchEndEpoch, otFrom: cur.otFrom, curtailMins: cur.curtailMins, lunchLogged: cur.lunchLogged, wrapCurve: cur.wrapCurve
        )
        // A normal end-of-day wrap is post-lunch (or curtailed) → helper returns
        // nil, behaviour unchanged. A rare wrap DURING the lunch hour keeps the
        // wake so the lingering wrapped card refreshes at lunch-end (drops the
        // stuck lunch countdown for the frozen day timer).
        let wrapped = ActivityContent(state: next, staleDate: lunchStaleDate(next))
        await activity.update(wrapped)
        await activity.end(wrapped, dismissalPolicy: .after(Date().addingTimeInterval(5 * 60)))
    }

    /// ARM a curtail (Group B) — single-tap PENDING. Writes armed="curtail" + a
    /// stamp and the captured whole-minute duration (for the "Undo · NNm" label).
    /// NOTHING reaches records yet; the commit only happens if the undo window
    /// lapses untapped. Returns the stamp so the held perform() commits exactly
    /// THIS instance and never a newer one.
    @available(iOS 16.2, *)
    static func armCurtail(_ productionId: String, mins: Int) async -> Double {
        guard let activity = current(productionId) else { return 0 }
        let cur = activity.content.state
        let stamp = Date().timeIntervalSince1970
        let next = TimeMachineActivityAttributes.ContentState(
            totalText: cur.totalText, state: cur.state,
            callEpoch: cur.callEpoch, anchorLabel: cur.anchorLabel, endEpoch: cur.endEpoch,
            armed: "curtail", armedAt: stamp, cwd: cur.cwd, lunchEndEpoch: cur.lunchEndEpoch,
            otFrom: cur.otFrom, curtailMins: mins, lunchLogged: cur.lunchLogged, wrapCurve: cur.wrapCurve
        )
        await activity.update(ActivityContent(state: next, staleDate: lunchStaleDate(next)))
        return stamp
    }

    /// UNDO a pending curtail — clear the arm + the captured minutes, write
    /// NOTHING. The second tap inside the undo window lands here.
    @available(iOS 16.2, *)
    static func cancelCurtail(_ productionId: String) async {
        guard let activity = current(productionId) else { return }
        let cur = activity.content.state
        let next = TimeMachineActivityAttributes.ContentState(
            totalText: cur.totalText, state: cur.state,
            callEpoch: cur.callEpoch, anchorLabel: cur.anchorLabel, endEpoch: cur.endEpoch,
            armed: "", armedAt: 0, cwd: cur.cwd, lunchEndEpoch: cur.lunchEndEpoch,
            otFrom: cur.otFrom, curtailMins: 0, lunchLogged: cur.lunchLogged, wrapCurve: cur.wrapCurve
        )
        await activity.update(ActivityContent(state: next, staleDate: lunchStaleDate(next)))
    }

    /// COMMIT a pending curtail IF it is still the exact armed instance — the
    /// CRITICAL App-Group write (appends "lunchCurtail" with the captured minutes),
    /// then clears the arm but KEEPS curtailMins so the button settles to "Lunch
    /// NNm ✓" until the descriptor re-confirms it from the record. A second tap
    /// (Undo), a Wrap-flush, or a newer arm changes armed/armedAt and makes this a
    /// no-op — so a cancelled curtail can never be written, and a Wrap-flushed one
    /// can never be double-written. Best-effort background drain so the OT-from /
    /// total update without foregrounding.
    @available(iOS 16.2, *)
    static func commitCurtailIfStillArmed(_ productionId: String, stamp: Double) async {
        guard let activity = current(productionId) else { return }
        let cur = activity.content.state
        guard cur.armed == "curtail", cur.armedAt == stamp,
              cur.curtailMins > 0, cur.curtailMins < 60 else { return }
        appendEvent(type: "lunchCurtail", productionId: productionId, durationMins: cur.curtailMins)
        let next = TimeMachineActivityAttributes.ContentState(
            totalText: cur.totalText, state: cur.state,
            callEpoch: cur.callEpoch, anchorLabel: cur.anchorLabel, endEpoch: cur.endEpoch,
            armed: "", armedAt: 0, cwd: cur.cwd, lunchEndEpoch: cur.lunchEndEpoch,
            otFrom: cur.otFrom, curtailMins: cur.curtailMins, lunchLogged: cur.lunchLogged, wrapCurve: cur.wrapCurve
        )
        await activity.update(ActivityContent(state: next, staleDate: lunchStaleDate(next)))
        await requestBackgroundDrain()
    }

    /// CONFIRM Lunch-now (Group C) — mark lunch ACTUALLY started on the card the
    /// instant the confirming tap lands, so the on-lunch phases (ON-LUNCH chip /
    /// countdown / Curtailed?) appear immediately instead of waiting for the JS
    /// write to drain back (parity with how Wrap sets state="wrapped" on the spot).
    /// lunchEndEpoch is the statutory hour-end from the SAME minute-floored "now"
    /// the JS write uses (the event `at` is HH:mm), so nothing flips when the write
    /// lands. curtailMins resets to 0 (a fresh lunch) and the arm clears.
    @available(iOS 16.2, *)
    static func confirmLunch(_ productionId: String) async {
        guard let activity = current(productionId) else { return }
        let cur = activity.content.state
        let flooredMin = (Date().timeIntervalSince1970 / 60).rounded(.down) * 60
        let next = TimeMachineActivityAttributes.ContentState(
            totalText: cur.totalText, state: cur.state,
            callEpoch: cur.callEpoch, anchorLabel: cur.anchorLabel, endEpoch: cur.endEpoch,
            armed: "", armedAt: 0, cwd: cur.cwd, lunchEndEpoch: flooredMin + 3600,
            otFrom: cur.otFrom, curtailMins: 0, lunchLogged: true, wrapCurve: cur.wrapCurve
        )
        await activity.update(ActivityContent(state: next, staleDate: lunchStaleDate(next)))
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
            await TMLiveActivity.confirmLunch(productionId)                         // instant lunchLogged + hour-end + disarm
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
            // CONFIRM: critical direct write, then the LunchNowIntent pattern —
            // instant state flip (confirmWrap: WRAPPED + curve-resolved total,
            // card still ACTIVE), a bounded best-effort background drain so a
            // live webview can push one corrected total while the card is
            // still updatable, THEN the linger end. A cold process no-ops the
            // drain and the curve total stands; the wrap write itself reaches
            // records on the normal foreground drain either way.
            TMLiveActivity.appendEvent(type: "wrapNow", productionId: productionId)
            await TMLiveActivity.confirmWrap(productionId)
            await TMLiveActivity.requestBackgroundDrain()
            await TMLiveActivity.endWrapped(productionId)
        } else {
            // Commit-then-wrap (Group B): if a curtail is mid-undo (armed=="curtail"
            // and fresh), committing it now — BEFORE we re-arm to wrap — flushes the
            // pending curtail so Wrap is never blocked and the curtail is never lost.
            // arm(wrap) below overwrites armed→"wrap", so the CurtailIntent's own
            // delayed commit then no-ops (armed/stamp guard) — exactly one write.
            if let cur = TMLiveActivity.current(productionId)?.content.state,
               cur.armed == "curtail",
               Date().timeIntervalSince1970 - cur.armedAt < TMLiveActivity.curtailUndoWindow,
               cur.curtailMins > 0, cur.curtailMins < 60 {
                TMLiveActivity.appendEvent(type: "lunchCurtail", productionId: productionId, durationMins: cur.curtailMins)
                NSLog("[LiveActivity] WrapNowIntent flushed pending curtail %dm pid=%@", cur.curtailMins, productionId)
            }
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

@available(iOS 17.0, *)
struct CurtailIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "Curtail lunch"
    static var openAppWhenRun: Bool = false

    @Parameter(title: "Production") var productionId: String

    init() {}
    init(productionId: String) { self.productionId = productionId }

    func perform() async throws -> some IntentResult {
        // Single-tap with a 5s undo window. If a curtail is ALREADY pending
        // (armed=="curtail" and fresh), THIS tap is the Undo → cancel, write
        // nothing. Otherwise capture the whole-minute duration (now − lunchStart)
        // and ARM; hold perform() open for the window, then COMMIT (the append is
        // the only write) unless it was undone/flushed. A duration ≥60 or ≤0 is
        // not a curtailment → no-op (the distracted min-70 tap, etc.).
        if let cur = TMLiveActivity.current(productionId)?.content.state,
           cur.armed == "curtail",
           Date().timeIntervalSince1970 - cur.armedAt < TMLiveActivity.curtailUndoWindow {
            await TMLiveActivity.cancelCurtail(productionId)        // UNDO — no write
            NSLog("[LiveActivity] CurtailIntent undo (app process) pid=%@", productionId)
            return .result()
        }
        let mins = TMLiveActivity.curtailMinutes(
            lunchEndEpoch: TMLiveActivity.current(productionId)?.content.state.lunchEndEpoch ?? 0)
        guard mins > 0, mins < 60 else { return .result() }        // ≥60 / ≤0 → no-op
        let stamp = await TMLiveActivity.armCurtail(productionId, mins: mins)
        NSLog("[LiveActivity] CurtailIntent armed %dm (app process) pid=%@", mins, productionId)
        try? await Task.sleep(nanoseconds: UInt64(TMLiveActivity.curtailUndoWindow * 1_000_000_000))
        await TMLiveActivity.commitCurtailIfStillArmed(productionId, stamp: stamp)
        return .result()
    }
}
