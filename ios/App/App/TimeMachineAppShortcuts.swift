//
//  TimeMachineAppShortcuts.swift
//
//  Siri Stage A — voice verbs via App Shortcuts. Plain App Intents + App
//  Shortcuts (no AI, no Apple Intelligence): "Hey Siri, wrap now in
//  TimeMachine" works with zero user setup on iOS 17+ (the Live Activity
//  floor), and both verbs appear in the Shortcuts app / Spotlight.
//
//  APP TARGET ONLY. AppShortcutsProvider metadata is read from the app
//  bundle, and keeping this file out of the widget target avoids duplicate
//  App Intents metadata extraction. The types it leans on are already
//  compiled into the App target: TMLiveActivity + the Live Activity button
//  intents (TimeMachineIntents.swift, dual-membership) and
//  TimeMachineActivityAttributes (shared type).
//
//  WHY SEPARATE VOICE INTENTS instead of exposing the button intents:
//    1. LunchNowIntent/WrapNowIntent take a REQUIRED productionId — App
//       Shortcut phrases can't supply an arbitrary String, and Siri would
//       prompt for it. The voice intents resolve the production from the
//       RUNNING Live Activity instead (it exists exactly when there's an
//       active, started, unwrapped day today).
//    2. The buttons are deliberately TWO-TAP (arm → confirm) because lock
//       screen taps are accident-prone. A spoken command is deliberate, so
//       the voice intents stamp in ONE step. The button intents and their
//       arming behaviour are untouched.
//
//  STAMPING IS REUSED VERBATIM: the voice confirm calls the SAME
//  TMLiveActivity.appendEvent — current local HH:mm into the App-Group
//  pending-events queue, drained by the app through the existing ingestion
//  (idempotent, today-only, record-write via applyLunchNow/applyWrapNow).
//  No new write path; nothing is stamped when no day qualifies.
//
//  NO-ACTIVE-DAY: the button path never hits this (buttons only render on a
//  live card), and the underlying helpers silently no-op without an
//  Activity. Voice CAN hit it, so the guard lives here: no running,
//  unwrapped Activity → spoken "No active day in TimeMachine." and ZERO
//  writes — nothing stamped, nothing created.
//

import Foundation
import AppIntents
import ActivityKit

// MARK: - Voice intents (single-step; Activity-derived target)

@available(iOS 17.0, *)
private func activeUnwrappedActivity() -> Activity<TimeMachineActivityAttributes>? {
    // "Active day" = a running Live Activity that hasn't wrapped. A wrapped
    // card lingering in its 5-minute dismissal window does NOT count — the
    // day is already wrapped, so voice should say "no active day".
    Activity<TimeMachineActivityAttributes>.activities.first { $0.content.state.state != "wrapped" }
}

@available(iOS 17.0, *)
struct WrapNowVoiceIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "Wrap Now"
    static var description = IntentDescription("Stamps the current time as today's wrap on the active shoot.")
    static var openAppWhenRun: Bool = false

    func perform() async throws -> some IntentResult & ProvidesDialog {
        guard let activity = activeUnwrappedActivity() else {
            return .result(dialog: "No active day in TimeMachine.")
        }
        let pid = activity.attributes.productionId
        let at = TMLiveActivity.appendEvent(type: "wrapNow", productionId: pid)  // CRITICAL — same write as the button confirm
        await TMLiveActivity.endWrapped(pid)                                      // best-effort wrap + freeze + end, same as button
        return .result(dialog: at.isEmpty ? "Wrapped." : "Wrapped at \(at).")
    }
}

@available(iOS 17.0, *)
struct LunchNowVoiceIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "Lunch Now"
    static var description = IntentDescription("Stamps the current time as today's lunch on the active shoot.")
    static var openAppWhenRun: Bool = false

    func perform() async throws -> some IntentResult & ProvidesDialog {
        guard let activity = activeUnwrappedActivity() else {
            return .result(dialog: "No active day in TimeMachine.")
        }
        let pid = activity.attributes.productionId
        let at = TMLiveActivity.appendEvent(type: "lunchNow", productionId: pid) // CRITICAL — same write as the button confirm
        await TMLiveActivity.update(pid, state: "lunch")                          // best-effort chip, same as button
        await TMLiveActivity.requestBackgroundDrain()                             // best-effort live total, same as button
        return .result(dialog: at.isEmpty ? "Lunch logged." : "Lunch logged at \(at).")
    }
}

// MARK: - Log my times (dictation → parse → confirm → structured queue event)

// Today's-active-shoot snapshot, written by the app (plugin setActiveShoot) when
// the user opens/works a shoot with a today day — lets this intent resolve the
// production with NO Live Activity running (BB mode, or solo pre-start).
@available(iOS 17.0, *)
private func activeShootSnapshot() -> (productionId: String, date: String)? {
    guard let dict = UserDefaults(suiteName: TMLiveActivity.appGroupSuite)?
            .dictionary(forKey: TMLiveActivity.activeShootKey),
          let pid = dict["productionId"] as? String, !pid.isEmpty,
          let date = dict["date"] as? String, !date.isEmpty
    else { return nil }
    return (pid, date)
}

// UTC yyyy-MM-dd — matches appendEvent's `date` and the web's todayISO().
private func todayUTCString() -> String {
    let f = DateFormatter()
    f.locale = Locale(identifier: "en_US_POSIX")
    f.timeZone = TimeZone(identifier: "UTC")
    f.dateFormat = "yyyy-MM-dd"
    return f.string(from: Date())
}

private func timesReadback(_ p: ParsedTimes) -> String {
    var parts: [String] = []
    if let c = p.call { parts.append("call \(c)") }
    if let l = p.lunch {
        if let d = p.lunchDurationMins { parts.append("lunch \(l) for \(d) minutes") }
        else { parts.append("lunch \(l)") }
    }
    if let w = p.wrap { parts.append("wrap \(w)") }
    let joined = parts.joined(separator: ", ")
    return joined.isEmpty ? joined : joined.prefix(1).uppercased() + joined.dropFirst()
}

@available(iOS 17.0, *)
struct LogMyTimesVoiceIntent: AppIntent {
    static var title: LocalizedStringResource = "Log My Times"
    static var description = IntentDescription("Dictate today's call, lunch and wrap times for the active shoot.")
    static var openAppWhenRun: Bool = false

    @Parameter(title: "Times", requestValueDialog: "What are your times?")
    var spoken: String

    // PLAIN AppIntent (NOT LiveActivityIntent) — the bug fix. The App Shortcut
    // phrases omit the times, so `spoken` is elicited as a spoken FOLLOW-UP after
    // the trigger. A LiveActivityIntent runs headless in-process with no
    // elicitation surface, so BY VOICE it tore down before asking "What are your
    // times?" (typed worked, because Shortcuts has a foreground prompt). This
    // intent touches NO ActivityKit — only the App-Group write + a best-effort
    // drain nudge — so it needs none of LiveActivityIntent's in-process guarantee
    // (the Wrap/Lunch voice intents + the widget-button intents keep it).
    //
    // parameterSummary is LOAD-BEARING, not decorative: on iOS 18 a @Parameter
    // absent from the summary can fail elicitation with NSCocoaErrorDomain 4099,
    // which would re-break the spoken ask even as a plain AppIntent.
    static var parameterSummary: some ParameterSummary { Summary("Log \(\.$spoken)") }

    init() {}

    func perform() async throws -> some IntentResult & ProvidesDialog {
        // Resolve the shoot from the snapshot; stale (date != today) or absent → no write.
        guard let shoot = activeShootSnapshot(), shoot.date == todayUTCString() else {
            return .result(dialog: "No active shoot in TimeMachine.")
        }
        let parsed = parseSpokenTimes(spoken)
        if parsed.call == nil, parsed.lunch == nil, parsed.wrap == nil {
            return .result(dialog: "I didn't catch your times.")
        }
        let readback = timesReadback(parsed)
        // Read back + CONFIRM before any write. A declined confirmation throws,
        // so nothing is appended — zero writes on "no". The modern
        // requestConfirmation(dialog:) is iOS 18+, so gate it; the intent's iOS 17
        // floor keeps the still-working (deprecated) result: form.
        if #available(iOS 18.0, *) {
            try await requestConfirmation(
                actionName: .custom(acceptLabel: "Log it", acceptAlternatives: [], denyLabel: "Cancel", denyAlternatives: []),
                dialog: "\(readback) — log it?")
        } else {
            try await requestConfirmation(result: .result(dialog: "\(readback) — log it?"))
        }
        TMLiveActivity.appendSetTimesEvent(
            productionId: shoot.productionId, date: shoot.date,
            call: parsed.call, lunch: parsed.lunch, wrap: parsed.wrap,
            lunchDurationMins: parsed.lunchDurationMins
        )
        await TMLiveActivity.requestBackgroundDrain()   // best-effort live apply, same as the now-stamps
        return .result(dialog: "\(readback) — logged.")
    }
}

// MARK: - App Shortcuts (zero-setup Siri phrases + Shortcuts/Spotlight tiles)

@available(iOS 17.0, *)
struct TimeMachineAppShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: WrapNowVoiceIntent(),
            phrases: [
                "wrap now in \(.applicationName)",
                "wrap in \(.applicationName)",
                "wrap me in \(.applicationName)",
                "wrap the day in \(.applicationName)",
                "\(.applicationName) wrap now",
                "\(.applicationName) wrap",
            ],
            shortTitle: "Wrap Now",
            systemImageName: "checkmark.circle.fill"
        )
        AppShortcut(
            intent: LunchNowVoiceIntent(),
            phrases: [
                "lunch in \(.applicationName)",
                "lunch now in \(.applicationName)",
                "going to lunch in \(.applicationName)",
                "break for lunch in \(.applicationName)",
                "\(.applicationName) lunch",
                "\(.applicationName) lunch now",
            ],
            shortTitle: "Lunch Now",
            systemImageName: "fork.knife"
        )
        AppShortcut(
            intent: LogMyTimesVoiceIntent(),
            phrases: [
                "log my times in \(.applicationName)",
                "log times in \(.applicationName)",
                "log my hours in \(.applicationName)",
                "log my day in \(.applicationName)",
                "set my times in \(.applicationName)",
                "\(.applicationName) log my times",
                "\(.applicationName) log times",
            ],
            shortTitle: "Log My Times",
            systemImageName: "clock.fill"
        )
    }
}
