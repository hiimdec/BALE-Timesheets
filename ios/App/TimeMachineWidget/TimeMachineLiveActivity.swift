//
//  TimeMachineLiveActivity.swift
//
//  Stage 1 — display-only Live Activity UI (Lock Screen card + Dynamic Island).
//  No buttons / App Intents (that's Stage 2). Lives in the TimeMachineWidget
//  extension target (minimum iOS 16.2).
//
//  Design language — "chrome cool, data hot":
//    • near-black chrome (#0a0a0a), no gradients
//    • ALL figures in a monospaced font with tabular figures
//    • the £ glyph + brand accents in sky-500 (#0ea5e9)
//    • state chip: ON CALL = sky, AT LUNCH = amber, WRAPPED = green
//    • uppercase, letter-spaced micro-labels (DAY TOTAL, SINCE 08:00)
//    • system font for non-numeric text; data is the hero
//    • elapsed timer = ActivityKit's native Text(timerInterval:) — ticks
//      on-device with zero updates.
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
private func sinceLabel(_ epoch: Double) -> String {
    guard epoch > 0 else { return "SINCE —" }
    let f = DateFormatter(); f.dateFormat = "HH:mm"
    return "SINCE \(f.string(from: callDate(epoch)))"
}

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

private func elapsedTimer(_ epoch: Double) -> some View {
    Group {
        if epoch > 0 {
            Text(timerInterval: callDate(epoch)...callDate(epoch).addingTimeInterval(24 * 3600),
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

// Lunch now = secondary (amber outline); Wrap now = sky primary. Each fires its
// App Intent in the widget process (no app launch). Callers gate on
// `#available(iOS 17.0, *)` AND a non-wrapped state, so on 16.2 — or once the day
// is wrapped — the card stays display-only.
@available(iOS 17.0, *)
private func actionButtons(_ productionId: String) -> some View {
    HStack(spacing: 8) {
        Button(intent: LunchNowIntent(productionId: productionId)) {
            Text("Lunch now")
                .font(.system(size: 12, weight: .semibold))
                .frame(maxWidth: .infinity)
        }
        .buttonStyle(.bordered)
        .tint(.tmAmber)

        Button(intent: WrapNowIntent(productionId: productionId)) {
            Text("Wrap now")
                .font(.system(size: 12, weight: .semibold))
                .frame(maxWidth: .infinity)
        }
        .buttonStyle(.borderedProminent)
        .tint(.tmSky)
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
                stateChip(context.state.state)
            }
            HStack(alignment: .lastTextBaseline) {
                VStack(alignment: .leading, spacing: 2) {
                    microLabel("DAY TOTAL")
                    moneyText(context.state.totalText, font: moneyFont)
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 2) {
                    microLabel(sinceLabel(context.attributes.callEpoch))
                    elapsedTimer(context.attributes.callEpoch)
                }
            }
            if #available(iOS 17.0, *), context.state.state != "wrapped" {
                actionButtons(context.attributes.productionId)
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
                        stateChip(context.state.state)
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
                            microLabel(sinceLabel(context.attributes.callEpoch))
                            Spacer()
                            elapsedTimer(context.attributes.callEpoch)
                        }
                        if #available(iOS 17.0, *), context.state.state != "wrapped" {
                            actionButtons(context.attributes.productionId)
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
