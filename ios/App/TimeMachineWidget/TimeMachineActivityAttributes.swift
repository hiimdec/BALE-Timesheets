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

        public init(totalText: String, state: String) {
            self.totalText = totalText
            self.state = state
        }
    }

    /// Production name, fixed for the day.
    public var productionName: String
    /// Call time as a UNIX epoch (seconds) for *today* — the anchor for the
    /// native `Text(timerInterval:)` elapsed counter (ticks on-device, no
    /// updates needed). 0 if unknown.
    public var callEpoch: Double

    public init(productionName: String, callEpoch: Double) {
        self.productionName = productionName
        self.callEpoch = callEpoch
    }
}
