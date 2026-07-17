//
//  TimeMachineActivityAttributes.swift
//
//  SHARED TYPE — this file MUST have Target Membership ticked for BOTH the
//  "App" target AND the "TimeMachineWidget" target (File Inspector → Target
//  Membership). ActivityKit matches a running Activity to its widget by the
//  Attributes *type identity*, so the app (which starts/updates the Activity)
//  and the widget (which renders it) must compile the SAME struct from the SAME
//  source file. Duplicating it in two targets would create two distinct types
//  that never match.
//
//  Design split: ActivityKit FIXES the Attributes at Activity.request — they can
//  never change for the life of the Activity. Only ContentState is mutable via
//  Activity.update. So ONLY genuinely-immutable identity lives in Attributes
//  (production name + id); everything the app can change mid-day lives in
//  ContentState — including the timer ANCHOR (callEpoch + anchorLabel), because
//  the user can edit today's call/pre-call time while the card is live and that
//  must reach the card (it previously couldn't, when the anchor sat in Attributes).
//

import Foundation
import ActivityKit

@available(iOS 16.2, *)
public struct TimeMachineActivityAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        /// Pre-formatted by the web layer with fmtGBP (e.g. "£599.40") so the
        /// native side never re-derives money — display-only, identical string.
        public var totalText: String
        /// "oncall" | "lunch" | "wrapped". Drives the state chip label + colour.
        public var state: String
        /// The elapsed-timer ANCHOR as a UNIX epoch (seconds) for *today* — pre-call
        /// time if one is set, else call time. Drives the native `Text(timerInterval:)`
        /// counter. In ContentState (not Attributes) so editing the call/pre-call
        /// time mid-day re-anchors the live card. 0 if unknown.
        public var callEpoch: Double
        /// Right-side micro-label describing the anchor, e.g. "CALL 08:00" or
        /// "PRE-CALL 07:30". Computed by the web layer alongside callEpoch.
        public var anchorLabel: String
        /// Wrap epoch (seconds) once WRAPPED — freezes the elapsed timer at the
        /// final value (anchor…endEpoch). 0 while the day is live (timer runs).
        public var endEpoch: Double
        /// Two-tap arm state (Stage 2): "" idle, "lunch" / "wrap" awaiting the
        /// confirming second tap. Reset to "" on confirm, by the in-perform delayed
        /// auto-reset (~4s), or on the next app-driven content update (the app
        /// never sends a non-empty armed).
        public var armed: String
        /// Epoch (seconds) when the current arm was written; 0 when idle. Stamps
        /// the arm INSTANCE so (a) the delayed auto-reset only clears the arm it
        /// created, never a newer one, and (b) a stale armed value (auto-reset
        /// missed because iOS suspended the process) can never confirm — the
        /// intent treats an expired arm as a fresh ARM, not a confirm.
        public var armedAt: Double
        /// CWD warning flag, computed by the WEB layer from the same
        /// deriveBreakState family that drives the in-app chips — the native side
        /// renders it only; no APA threshold maths lives in Swift. (L1 was tried
        /// and removed in round 3 — too narrow/confusing for a glanceable card.)
        public var cwd: Bool
        /// Lunch-end as a UNIX epoch (seconds) = lunchStart + 60min (Group A.5,
        /// display-only). The card renders a NATIVE Text(timerInterval:) counting
        /// DOWN to this, so it ticks on the locked screen with zero pushed updates
        /// (replacing the old pushed "N min left" integer that froze when
        /// backgrounded). > 0 only while ON LUNCH; 0 restores the elapsed timer.
        public var lunchEndEpoch: Double
        /// Projected clock time the day goes into OT, preformatted "HH:mm" by the
        /// JS calc engine (shifts with CWD / curtailed lunch). "" hides the line
        /// (wrapped, no call time, or a day type with no hourly OT). The card
        /// never computes this — display-only, same discipline as totalText.
        public var otFrom: String
        /// Curtailed-lunch minutes (Group B). During the 5s undo PENDING window
        /// (armed == "curtail") this is the native-captured duration for the
        /// "Undo · NNm" label; once a curtail is RECORDED it's the day's
        /// lunchDurationMins (0 < NN < 60), pushed by the descriptor so the button
        /// settles to "Lunch NNm ✓". 0 when no curtail is pending or recorded.
        public var curtailMins: Int
        /// Whether lunch was ACTUALLY started (card/in-app "Lunch now"), as opposed
        /// to the planned/seeded lunchStartTime every day carries. The entry gate
        /// for the whole lunch state machine: until true the card stays "Lunch now"
        /// and the on-lunch / Curtailed? / Full-hour phases (derived natively from
        /// Date() vs lunchEndEpoch) are unreachable. Pushed by the descriptor from
        /// rec.lunchLogged, and set on the spot by the Lunch-now confirm intent for
        /// an instant flip. Display-only — the calc never reads it.
        public var lunchLogged: Bool
        /// Wrap-total curve — flattened ascending [epoch, pence, epoch, pence, …]
        /// pairs precomputed by the JS calc engine: the day total if wrapped at
        /// each 30-minute OT boundary. Lets endWrapped freeze the CORRECT total
        /// at the moment the card's Wrap confirm lands (first breakpoint ≥ now —
        /// the same round-up-to-30-min-in-the-crew's-favour the engine applies),
        /// with NO pay maths in Swift: these are engine outputs, sampled. Empty
        /// (default) → endWrapped keeps the pushed totalText (the pre-curve
        /// freeze). Display-only, same discipline as totalText.
        public var wrapCurve: [Double]
        /// Lifetime-cap epoch (fix/la-husk Fix 2 — "the card must never lie").
        /// Set NATIVELY at Activity.request time to requestedAt + ~7h45m (just
        /// inside iOS's ~8h Live Activity lifetime cap) and carried through
        /// every reconstruction. Every ActivityContent staleDate is clamped to
        /// min(semantic wake, cap), so the LAST re-render the system will ever
        /// grant fires just before iOS kills updates — and the view branches to
        /// a truthful EXPIRED card (no ticking timer, total resolved from the
        /// wrapCurve AT this epoch) instead of ticking a dead husk. OPTIONAL,
        /// deliberately: synthesized Codable decodes it via decodeIfPresent, so
        /// an IN-FLIGHT activity started on the previous schema decodes with
        /// nil (no cap known → no clamp, no EXPIRED branch — the old behaviour)
        /// rather than failing to decode at all. Display/lifecycle only — the
        /// calc never reads it.
        public var capEpoch: Double?

        public init(totalText: String, state: String, callEpoch: Double = 0, anchorLabel: String = "", endEpoch: Double = 0, armed: String = "", armedAt: Double = 0, cwd: Bool = false, lunchEndEpoch: Double = 0, otFrom: String = "", curtailMins: Int = 0, lunchLogged: Bool = false, wrapCurve: [Double] = [], capEpoch: Double? = nil) {
            self.totalText = totalText
            self.state = state
            self.callEpoch = callEpoch
            self.anchorLabel = anchorLabel
            self.endEpoch = endEpoch
            self.armed = armed
            self.armedAt = armedAt
            self.cwd = cwd
            self.lunchEndEpoch = lunchEndEpoch
            self.otFrom = otFrom
            self.curtailMins = curtailMins
            self.lunchLogged = lunchLogged
            self.wrapCurve = wrapCurve
            self.capEpoch = capEpoch
        }
    }

    /// Production name, fixed for the life of the Activity.
    public var productionName: String
    /// Production id — the immutable identity key. Carried so a Lunch-now /
    /// Wrap-now App Intent can tag its App-Group event with the exact shoot the
    /// card belongs to, and so the app can match the running Activity to update.
    public var productionId: String

    public init(productionName: String, productionId: String) {
        self.productionName = productionName
        self.productionId = productionId
    }
}
