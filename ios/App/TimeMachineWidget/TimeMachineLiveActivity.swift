//
//  TimeMachineLiveActivity.swift
//
//  Live Activity UI (Lock Screen card + Dynamic Island). Stage 2 adds the
//  interactive Lunch/Wrap buttons (iOS 17+). Lives in the TimeMachineWidget
//  extension target (minimum iOS 16.2).
//
//  Design language — "chrome cool, data hot":
//    • near-black chrome (#0a0a0a), no gradients
//    • ALL figures in a monospaced font with tabular figures
//    • the £ glyph + brand accents in sky-500 (#0ea5e9)
//    • chip slot (top-right): WRAPPED (green) > CWD (tm-pen red, flag computed
//      by the web layer — the money-relevant state outranks AT LUNCH) >
//      AT LUNCH (amber) — empty while ON CALL with no warning
//    • uppercase, letter-spaced micro-labels (DAY TOTAL, CALL 08:00 / PRE-CALL …)
//    • system font for non-numeric text; data is the hero
//    • elapsed timer = ActivityKit's native Text(timerInterval:) — ticks
//      on-device with zero updates; FREEZES at wrap (range ends at endEpoch,
//      in the past, so it renders the final elapsed statically).
//    • buttons: native-iOS pills (continuous-corner rounded rects, SF sentence
//      case); two-tap — first tap arms ("✓ Confirm?", auto-resets ~4s), second
//      confirms.
//

import SwiftUI
import WidgetKit
import ActivityKit
import AppIntents

// MARK: - Palette

private extension Color {
    init(hex: UInt32) {
        self.init(
            .sRGB,
            red:   Double((hex >> 16) & 0xFF) / 255.0,
            green: Double((hex >> 8) & 0xFF) / 255.0,
            blue:  Double(hex & 0xFF) / 255.0,
            opacity: 1.0
        )
    }
    static let tmBg      = Color(hex: 0x0A0A0A)   // neutral-950
    static let tmInk     = Color(hex: 0xFAFAFA)   // neutral-50
    static let tmMuted   = Color(hex: 0xA3A3A3)   // neutral-400
    static let tmFaint   = Color(hex: 0x6B7280)   // caption grey
    static let tmSky     = Color(hex: 0x0EA5E9)   // sky-500
    static let tmAmber   = Color(hex: 0xF59E0B)   // tm-warn
    static let tmGood    = Color(hex: 0x22C55E)   // tm-good
    static let tmPen     = Color(hex: 0xF43F5E)   // tm-pen — penalties (L1 / CWD)
}

// MARK: - State helpers

private func chipColor(_ state: String) -> Color {
    switch state {
    case "lunch":   return .tmAmber
    case "wrapped": return .tmGood
    default:        return .tmSky
    }
}
private func chipLabel(_ state: String) -> String {
    switch state {
    case "lunch":   return "ON LUNCH"
    case "wrapped": return "WRAPPED"
    default:        return "ON CALL"
    }
}
private func callDate(_ epoch: Double) -> Date { Date(timeIntervalSince1970: epoch) }

// MARK: - Shared figure styles

private let moneyFont = Font.system(size: 30, weight: .bold, design: .monospaced)
private let moneyFontSmall = Font.system(size: 17, weight: .bold, design: .monospaced)
// Expanded-island hero figure — bigger than moneyFontSmall (the total is the
// hero there), smaller than the lock card's 30pt so two lines sit comfortably
// inside the island's enforced height.
private let moneyFontIsland = Font.system(size: 22, weight: .bold, design: .monospaced)
private let timerFont = Font.system(size: 15, weight: .semibold, design: .monospaced)

// Expanded-island secondary line: "CALL 08:00 · OT FROM 19:00" in the lock
// card's microlabel voice. anchorLabel arrives pre-formatted; OT-from is
// hidden when wrapped or absent (otFrom is already "" then — the guard is
// belt-and-braces). "" when nothing to show so the caller can skip the row.
private func expandedSecondaryLine(_ s: TimeMachineActivityAttributes.ContentState) -> String {
    var parts: [String] = []
    if !s.anchorLabel.isEmpty { parts.append(s.anchorLabel) }
    if s.state != "wrapped" && !s.otFrom.isEmpty { parts.append("OT FROM \(s.otFrom)") }
    return parts.joined(separator: " · ")
}

private func microLabel(_ text: String) -> some View {
    Text(text)
        .font(.system(size: 9, weight: .bold))
        .tracking(1.4)
        .foregroundColor(.tmMuted)
}

// £ in sky, the digits in ink — the "hot data" treatment.
private func moneyText(_ s: String, font: Font) -> some View {
    let pounds = s.hasPrefix("£") ? String(s.dropFirst()) : s
    return (Text("£").foregroundColor(.tmSky) + Text(pounds).foregroundColor(.tmInk))
        .font(font)
        .monospacedDigit()
        .lineLimit(1)
        .minimumScaleFactor(0.6)
}

private func stateChip(_ state: String) -> some View {
    let c = chipColor(state)
    return Text(chipLabel(state))
        .font(.system(size: 9, weight: .bold))
        .tracking(1.2)
        .foregroundColor(c)
        .padding(.horizontal, 7)
        .padding(.vertical, 3)
        .background(c.opacity(0.14))
        .clipShape(Capsule())
}

// Penalty warning chip (CWD) — tm-pen, matching the in-app day-row pills. The
// flag arrives pre-computed from the web layer (deriveBreakState family); this
// renders it only.
private func warnChip(_ label: String) -> some View {
    Text(label)
        .font(.system(size: 9, weight: .bold))
        .tracking(1.2)
        .foregroundColor(.tmPen)
        .padding(.horizontal, 7)
        .padding(.vertical, 3)
        .background(Color.tmPen.opacity(0.14))
        .clipShape(Capsule())
}

// The shared on-lunch predicate (Group C) — derived NATIVELY from Date() vs the
// pushed lunchEndEpoch so the on-lunch→full-hour boundary resolves at the deadline
// on the next render/wake with NO background push. Gated by lunchLogged (lunch was
// actually started, not just a seeded plan) and cleared on a curtail (curtailMins
// > 0, incl. the native pending preview). Drives the chip, the timer slot, and the
// Curtailed?/Full-hour split — display-state only, never pay (all money/durations
// stay pushed; identical discipline to the native countdown that already compares
// Date() to lunchEndEpoch).
private func isOnLunch(_ s: TimeMachineActivityAttributes.ContentState) -> Bool {
    s.lunchLogged && s.curtailMins == 0 && s.lunchEndEpoch > 0 &&
        Date().timeIntervalSince1970 < s.lunchEndEpoch
}

// The single chip slot. Priority: WRAPPED > CWD > ON LUNCH — the money-relevant
// state wins: a lunch logged in CWD territory shows CWD (what the pay is
// computing), not ON LUNCH. The ON-LUNCH term is the native onLunch predicate, so
// it clears at the hour-end (and on a curtail) without a push. ON CALL renders no chip.
@ViewBuilder
private func chipSlot(state: String, cwd: Bool, onLunch: Bool) -> some View {
    if state == "wrapped" {
        stateChip(state)
    } else if cwd {
        warnChip("CWD")
    } else if onLunch {
        stateChip("lunch")
    }
}

// Elapsed since the anchor (call / pre-call). While live (end == 0) it counts up
// on-device with zero updates; once wrapped (end > anchor) the range ends in the
// past, so SwiftUI renders the FINAL elapsed value frozen (item 5).
private func elapsedTimer(anchor: Double, end: Double) -> some View {
    Group {
        if anchor > 0 {
            Text(timerInterval: callDate(anchor)...(end > anchor ? callDate(end) : callDate(anchor).addingTimeInterval(24 * 3600)),
                 countsDown: false)
                .font(timerFont)
                .monospacedDigit()
                .foregroundColor(.tmInk)
        } else {
            Text("-").font(timerFont).foregroundColor(.tmMuted)
        }
    }
}

// MARK: - Action buttons (Stage 2, iOS 17+)

// Native-iOS pill: an explicit RoundedRectangle(cornerRadius: 14, style:
// .continuous) — Apple's continuous-curvature corners — drawn as a custom
// background on a PLAIN button style (the bordered styles ignore shape control
// in Live Activities). Typography is native system: SF semibold, sentence case,
// no tracking — the card's caption labels keep the uppercase brand style; only
// the buttons go native. Colour coding kept: lunch = amber family, wrap = sky
// primary; armed = the loud inverse treatment + "✓ Confirm?" so a half-done
// two-tap can't read as done. The flip animates with .snappy (honoured in Live
// Activities on iOS 17+, 2s cap) instead of the slow default blurred crossfade.
// Each fires its App Intent in the APP process (LiveActivityIntent). Callers
// gate on iOS 17 + a non-wrapped state.
private struct ActionPill: View {
    let text: String
    let confirm: Bool
    let fill: Color
    let stroke: Color?
    let textColor: Color

    var body: some View {
        HStack(spacing: 5) {
            if confirm {
                Image(systemName: "checkmark").font(.system(size: 13, weight: .semibold))
            }
            Text(text).font(.system(size: 14, weight: .semibold))
        }
        .foregroundColor(textColor)
        .frame(maxWidth: .infinity)
        .padding(.vertical, 10)
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(fill))
        .overlay {
            if let stroke {
                RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(stroke, lineWidth: 1.5)
            }
        }
        .contentShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
    }
}

// The lunch-slot button (Group C) — the LEFT button only (Wrap is unaffected).
// ENTRY is gated on lunchLogged: until lunch is ACTUALLY started it stays "Lunch
// now" regardless of the clock or any planned/seeded lunch. Once logged, the
// on-lunch→full-hour boundary is the NATIVE onLunch predicate (Date() vs
// lunchEndEpoch), so "Curtailed?" resolves to "Full hour" at the deadline on the
// next render — no push. The curtail PENDING/Undo state rides the native `armed`
// slot. Active phases use saturated text (amber / black-on-amber); the two
// disabled/informational phases are plain pills (no Button) with muted grey text.
@available(iOS 17.0, *)
@ViewBuilder
private func lunchSlot(_ productionId: String, armed: String, lunchLogged: Bool, curtailMins: Int, onLunch: Bool) -> some View {
    if !lunchLogged {
        // ENTRY GATE — lunch not started. A planned/seeded lunch never gets past here.
        if armed == "lunch" {
            // Lunch-now two-tap mid-confirm.
            Button(intent: LunchNowIntent(productionId: productionId)) {
                ActionPill(text: "Confirm?", confirm: true, fill: .tmAmber, stroke: nil, textColor: .black)
            }
            .buttonStyle(.plain)
        } else {
            Button(intent: LunchNowIntent(productionId: productionId)) {
                ActionPill(text: "Lunch now", confirm: false, fill: Color.tmAmber.opacity(0.14), stroke: Color.tmAmber.opacity(0.4), textColor: .tmAmber)
            }
            .buttonStyle(.plain)
        }
    } else if armed == "curtail" {
        // PENDING — single tap = Undo (cancels, writes nothing); auto-commits at 5s.
        Button(intent: CurtailIntent(productionId: productionId)) {
            ActionPill(text: "Undo · \(curtailMins)m", confirm: false, fill: .tmAmber, stroke: nil, textColor: .black)
        }
        .buttonStyle(.plain)
    } else if curtailMins > 0 {
        // COMMITTED curtail — informational, not tappable.
        ActionPill(text: "Lunch \(curtailMins)m ✓", confirm: false, fill: Color.tmAmber.opacity(0.12), stroke: nil, textColor: .tmMuted)
    } else if onLunch {
        // Logged, within the statutory hour — single tap arms the curtail.
        Button(intent: CurtailIntent(productionId: productionId)) {
            ActionPill(text: "Back early?", confirm: false, fill: Color.tmAmber.opacity(0.14), stroke: Color.tmAmber.opacity(0.4), textColor: .tmAmber)
        }
        .buttonStyle(.plain)
    } else {
        // Logged, the statutory hour has elapsed uncurtailed (native Date() ≥
        // lunchEnd) — full lunch stands; informational, not tappable.
        ActionPill(text: "Full hour", confirm: false, fill: Color.tmFaint.opacity(0.12), stroke: Color.tmFaint.opacity(0.35), textColor: .tmFaint)
    }
}

@available(iOS 17.0, *)
@ViewBuilder
private func wrapButton(_ productionId: String, armed: Bool) -> some View {
    Button(intent: WrapNowIntent(productionId: productionId)) {
        if armed {
            // Loud inverse: rest is the solid sky primary, so armed flips to the
            // tinted-outline treatment (mirrors the in-app Wrap confirm state).
            ActionPill(text: "Confirm?", confirm: true, fill: Color.tmSky.opacity(0.2), stroke: .tmSky, textColor: .tmInk)
        } else {
            ActionPill(text: "Wrap now", confirm: false, fill: .tmSky, stroke: nil, textColor: .black)
        }
    }
    .buttonStyle(.plain)
}

@available(iOS 17.0, *)
private func actionButtons(_ productionId: String, armed: String, lunchLogged: Bool, curtailMins: Int, onLunch: Bool) -> some View {
    HStack(spacing: 8) {
        lunchSlot(productionId, armed: armed, lunchLogged: lunchLogged, curtailMins: curtailMins, onLunch: onLunch)
        wrapButton(productionId, armed: armed == "wrap")
    }
    .animation(.snappy(duration: 0.25), value: armed)
}

// MARK: - Line-4 timer slot + OT-from (Group A.5 — display-only)

// Native countdown to lunch-end (= lunchStart + 60min), mirroring elapsedTimer so
// it ticks DOWN on the LOCKED screen with zero pushed updates — fixing the old
// pushed-integer "N min left" that only refreshed on foreground. The interval
// starts 60min before the end so the readout reads as minutes-left (MM:SS,
// showsHours:false); once "now" passes the end the system clamps it to 00:00.
// Just the fork.knife glyph + the ticking figure — no trailing label. Amber
// echoes the ON LUNCH chip; rendered only while the native onLunch predicate holds.
private func lunchCountdown(end: Double) -> some View {
    HStack(spacing: 4) {
        Image(systemName: "fork.knife").font(.system(size: 12, weight: .semibold))
        Text(timerInterval: callDate(end).addingTimeInterval(-3600)...callDate(end),
             countsDown: true, showsHours: false)
            .font(timerFont)
            .monospacedDigit()
    }
    .foregroundColor(.tmAmber)
    .lineLimit(1)
}

// The Line-4 timer slot — ONE slot, two modes. ON LUNCH (the native onLunch
// predicate): the lunch countdown (ticks down on-device). Otherwise: the elapsed
// count-up since the anchor. Because onLunch is Date()-vs-lunchEndEpoch, the slot
// switches back to elapsed at the hour-end (and on a curtail) on the next render,
// with no push.
@ViewBuilder
private func timerSlot(onLunch: Bool, anchor: Double, end: Double, lunchEnd: Double) -> some View {
    if onLunch {
        lunchCountdown(end: lunchEnd)
    } else {
        elapsedTimer(anchor: anchor, end: end)
    }
}

// Line 4: the timer slot (left) and the OT-from projection (right). OT-from is
// INFORMATIONAL — neutral tmFaint, never a penalty/warning colour — and hidden
// when wrapped or absent (Group A logic, unchanged). Both are display-only.
@ViewBuilder
private func timerProjectionRow(state: String, onLunch: Bool, anchor: Double, end: Double, lunchEnd: Double, otFrom: String) -> some View {
    HStack(alignment: .firstTextBaseline) {
        timerSlot(onLunch: onLunch, anchor: anchor, end: end, lunchEnd: lunchEnd)
        Spacer(minLength: 8)
        if state != "wrapped" && !otFrom.isEmpty {
            Text("OT from \(otFrom)")
                .font(.system(size: 12, weight: .medium))
                .foregroundColor(.tmFaint)
                .lineLimit(1)
        }
    }
}

// MARK: - Lock Screen / banner

struct TimeMachineLockScreenView: View {
    let context: ActivityViewContext<TimeMachineActivityAttributes>

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            // Line 1: production name · state chip. The name shrinks (to 75%)
            // then tail-truncates rather than overflowing: an over-wide row
            // would otherwise push the VStack past the card's width and the
            // centred overflow clips the LEADING edge of the name ("REBULL
            // RACING" losing its R).
            HStack {
                Text(context.attributes.productionName)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(.tmMuted)
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .minimumScaleFactor(0.75)
                Spacer()
                chipSlot(state: context.state.state, cwd: context.state.cwd, onLunch: isOnLunch(context.state))
            }
            // Line 2: the two micro-labels — DAY TOTAL (left) · CALL anchor (right)
            HStack {
                microLabel("DAY TOTAL")
                Spacer()
                microLabel(context.state.anchorLabel)
            }
            // Line 3: the total alone, large and clean (elapsed timer moved off
            // this line so the figure reads at a glance)
            moneyText(context.state.totalText, font: moneyFont)
            // Line 4: timer slot — elapsed count-up, or the native lunch countdown
            // ON LUNCH — on the left; OT-from on the right. The VStack spacing alone
            // separates it from the total above (no divider).
            timerProjectionRow(state: context.state.state, onLunch: isOnLunch(context.state), anchor: context.state.callEpoch, end: context.state.endEpoch, lunchEnd: context.state.lunchEndEpoch, otFrom: context.state.otFrom)
            if #available(iOS 17.0, *), context.state.state != "wrapped" {
                actionButtons(context.attributes.productionId, armed: context.state.armed, lunchLogged: context.state.lunchLogged, curtailMins: context.state.curtailMins, onLunch: isOnLunch(context.state))
            }
        }
        // Pin the stack to the full offered width, leading-aligned: a child
        // row that can't fit then truncates in place instead of widening the
        // stack past the card and getting centre-clipped at both edges.
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .activityBackgroundTint(.tmBg)
        .activitySystemActionForegroundColor(.tmSky)
    }
}

// MARK: - Live Activity configuration

struct TimeMachineLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: TimeMachineActivityAttributes.self) { context in
            TimeMachineLockScreenView(context: context)
        } dynamicIsland: { context in
            DynamicIsland {
                // Expanded (long-press) — the regions used AS INTENDED (the
                // device round proved a single "full-width" leading region
                // doesn't span: the system reserves trailing width
                // regardless, cramming everything top-left). Leading = dot +
                // name (anti-clip trio); trailing = the day total, hero
                // size; bottom = ONE muted microlabel line, full width,
                // single line ("CALL 08:00 · OT FROM 19:00", OT omitted
                // when wrapped/absent) — nothing else, no buttons, no
                // timer. maxHeight .infinity centres leading/trailing
                // content vertically as far as the system allows.
                DynamicIslandExpandedRegion(.leading) {
                    HStack(spacing: 7) {
                        Circle().fill(chipColor(isOnLunch(context.state) ? "lunch" : context.state.state)).frame(width: 8, height: 8)
                        Text(context.attributes.productionName)
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundColor(.tmMuted)
                            .lineLimit(1)
                            .truncationMode(.tail)
                            .minimumScaleFactor(0.75)
                    }
                    .padding(.leading, 4)
                    .frame(maxHeight: .infinity)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    moneyText(context.state.totalText, font: moneyFontIsland)
                        .frame(maxHeight: .infinity)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    let secondary = expandedSecondaryLine(context.state)
                    if !secondary.isEmpty {
                        microLabel(secondary)
                            .lineLimit(1)
                            .minimumScaleFactor(0.8)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.leading, 4)
                    }
                }
            } compactLeading: {
                Circle().fill(chipColor(isOnLunch(context.state) ? "lunch" : context.state.state)).frame(width: 8, height: 8)
            } compactTrailing: {
                // Money is deliberately absent from the always-visible
                // presentations (compact/minimal show the status dot only);
                // the day total lives in the expanded island and lock screen.
                EmptyView()
            } minimal: {
                Circle().fill(chipColor(isOnLunch(context.state) ? "lunch" : context.state.state)).frame(width: 8, height: 8)
            }
            .widgetURL(URL(string: "timemachine://today"))
            .keylineTint(.tmSky)
        }
        // The card's own .padding(16) is the ONLY margin: opt out of the
        // iOS 17 system content margins so the inset is deterministic and
        // identical across OS versions instead of stacking on top of ours.
        // (No-op below iOS 17.)
        .contentMarginsDisabled()
    }
}
