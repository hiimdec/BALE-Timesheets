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
//    • state chip: shown ONLY AT LUNCH (amber) / WRAPPED (green) — hidden while
//      ON CALL (the default state needs no chip)
//    • uppercase, letter-spaced micro-labels (DAY TOTAL, CALL 08:00 / PRE-CALL …)
//    • system font for non-numeric text; data is the hero
//    • elapsed timer = ActivityKit's native Text(timerInterval:) — ticks
//      on-device with zero updates; FREEZES at wrap (range ends at endEpoch,
//      in the past, so it renders the final elapsed statically).
//    • two-tap buttons: first tap arms (button → "✓ CONFIRM?"), second confirms.
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
    case "lunch":   return "AT LUNCH"
    case "wrapped": return "WRAPPED"
    default:        return "ON CALL"
    }
}
private func callDate(_ epoch: Double) -> Date { Date(timeIntervalSince1970: epoch) }

// MARK: - Shared figure styles

private let moneyFont = Font.system(size: 30, weight: .bold, design: .monospaced)
private let moneyFontSmall = Font.system(size: 17, weight: .bold, design: .monospaced)
private let timerFont = Font.system(size: 15, weight: .semibold, design: .monospaced)

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

// Item 6: the chip is shown ONLY for AT LUNCH / WRAPPED. ON CALL (the default)
// renders no chip — the card is calmer at rest.
@ViewBuilder
private func stateChipIfActive(_ state: String) -> some View {
    if state != "oncall" {
        stateChip(state)
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
            Text("—").font(timerFont).foregroundColor(.tmMuted)
        }
    }
}

// MARK: - Action buttons (Stage 2, iOS 17+)

// Two-tap confirm (item 8). At rest: Lunch = amber outline (.bordered), Wrap =
// sky filled (.borderedProminent). When armed, the button flips to the INVERSE
// treatment + "✓ CONFIRM?" (Lunch → filled, Wrap → outline) so the confirming
// second tap is visually distinct. Each fires its App Intent in the widget
// process (no app launch). Callers gate on `#available(iOS 17.0, *)` AND a
// non-wrapped state, so on 16.2 — or once wrapped — the card stays display-only.
@available(iOS 17.0, *)
@ViewBuilder
private func lunchButton(_ productionId: String, armed: Bool) -> some View {
    if armed {
        Button(intent: LunchNowIntent(productionId: productionId)) {
            Text("✓ CONFIRM?").font(.system(size: 12, weight: .bold)).frame(maxWidth: .infinity)
        }
        .buttonStyle(.borderedProminent).tint(.tmAmber)
    } else {
        Button(intent: LunchNowIntent(productionId: productionId)) {
            Text("Lunch now").font(.system(size: 12, weight: .semibold)).frame(maxWidth: .infinity)
        }
        .buttonStyle(.bordered).tint(.tmAmber)
    }
}

@available(iOS 17.0, *)
@ViewBuilder
private func wrapButton(_ productionId: String, armed: Bool) -> some View {
    if armed {
        Button(intent: WrapNowIntent(productionId: productionId)) {
            Text("✓ CONFIRM?").font(.system(size: 12, weight: .bold)).frame(maxWidth: .infinity)
        }
        .buttonStyle(.bordered).tint(.tmSky)
    } else {
        Button(intent: WrapNowIntent(productionId: productionId)) {
            Text("Wrap now").font(.system(size: 12, weight: .semibold)).frame(maxWidth: .infinity)
        }
        .buttonStyle(.borderedProminent).tint(.tmSky)
    }
}

@available(iOS 17.0, *)
private func actionButtons(_ productionId: String, armed: String) -> some View {
    HStack(spacing: 8) {
        lunchButton(productionId, armed: armed == "lunch")
        wrapButton(productionId, armed: armed == "wrap")
    }
    .controlSize(.small)
}

// MARK: - Lock Screen / banner

struct TimeMachineLockScreenView: View {
    let context: ActivityViewContext<TimeMachineActivityAttributes>

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text(context.attributes.productionName)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(.tmMuted)
                    .lineLimit(1)
                Spacer()
                stateChipIfActive(context.state.state)
            }
            HStack(alignment: .lastTextBaseline) {
                VStack(alignment: .leading, spacing: 2) {
                    microLabel("DAY TOTAL")
                    moneyText(context.state.totalText, font: moneyFont)
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 2) {
                    microLabel(context.attributes.anchorLabel)
                    elapsedTimer(anchor: context.attributes.callEpoch, end: context.state.endEpoch)
                }
            }
            if #available(iOS 17.0, *), context.state.state != "wrapped" {
                actionButtons(context.attributes.productionId, armed: context.state.armed)
            }
        }
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
                // Expanded
                DynamicIslandExpandedRegion(.leading) {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(context.attributes.productionName)
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundColor(.tmMuted)
                            .lineLimit(1)
                        stateChipIfActive(context.state.state)
                    }
                }
                DynamicIslandExpandedRegion(.trailing) {
                    VStack(alignment: .trailing, spacing: 2) {
                        microLabel("DAY TOTAL")
                        moneyText(context.state.totalText, font: moneyFontSmall)
                    }
                }
                DynamicIslandExpandedRegion(.bottom) {
                    VStack(spacing: 8) {
                        HStack {
                            microLabel(context.attributes.anchorLabel)
                            Spacer()
                            elapsedTimer(anchor: context.attributes.callEpoch, end: context.state.endEpoch)
                        }
                        if #available(iOS 17.0, *), context.state.state != "wrapped" {
                            actionButtons(context.attributes.productionId, armed: context.state.armed)
                        }
                    }
                }
            } compactLeading: {
                Circle().fill(chipColor(context.state.state)).frame(width: 8, height: 8)
            } compactTrailing: {
                moneyText(context.state.totalText, font: Font.system(size: 14, weight: .bold, design: .monospaced))
            } minimal: {
                Circle().fill(chipColor(context.state.state)).frame(width: 8, height: 8)
            }
            .widgetURL(URL(string: "timemachine://today"))
            .keylineTint(.tmSky)
        }
    }
}
