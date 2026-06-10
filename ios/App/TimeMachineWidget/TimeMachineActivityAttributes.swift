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
//  Stage 1 (display-only). No App Intents / interactivity here — that's Stage 2.
//
//  Design split: values that never change for the life of the day live in the
//  Attributes (production name + the call-time epoch that drives the free,
//  zero-update elapsed timer). Values that change as the app recomputes live in
//  the ContentState (the last-computed day total + the day state chip).
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
        /// Wrap epoch (seconds) once WRAPPED — freezes the elapsed timer at the
        /// final value (anchor…endEpoch). 0 while the day is live (timer runs).
        public var endEpoch: Double
        /// Two-tap arm state (Stage 2): "" idle, "lunch" / "wrap" awaiting the
        /// confirming second tap. Reset to "" on confirm OR on the next app-driven
        /// content update (the app never sends a non-empty armed).
        public var armed: String

        public init(totalText: String, state: String, endEpoch: Double = 0, armed: String = "") {
            self.totalText = totalText
            self.state = state
            self.endEpoch = endEpoch
            self.armed = armed
        }
    }

    /// Production name, fixed for the day.
    public var productionName: String
    /// The elapsed-timer ANCHOR as a UNIX epoch (seconds) for *today* — pre-call
    /// time if one is set, else call time. Drives the native `Text(timerInterval:)`
    /// counter (ticks on-device, no updates needed). 0 if unknown.
    public var callEpoch: Double
    /// Right-side micro-label describing the anchor, e.g. "CALL 08:00" or
    /// "PRE-CALL 07:30". Computed by the web layer alongside callEpoch.
    public var anchorLabel: String
    /// Production id (Stage 2). Carried so a Lunch-now / Wrap-now App Intent can
    /// tag its App-Group event with the exact shoot the card belongs to — the
    /// app's ingestion applies the lunch/wrap write to THIS production, never a
    /// guessed one.
    public var productionId: String

    public init(productionName: String, callEpoch: Double, anchorLabel: String, productionId: String) {
        self.productionName = productionName
        self.callEpoch = callEpoch
        self.anchorLabel = anchorLabel
        self.productionId = productionId
    }
}
