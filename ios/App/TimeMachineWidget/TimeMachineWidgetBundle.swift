//
//  TimeMachineWidgetBundle.swift
//  TimeMachineWidget
//
//  The widget extension's single @main entry point. Stage 1 ships ONLY the
//  Live Activity (no Home Screen timeline widgets, no Control Center controls)
//  — Xcode's generated sample widgets (TimeMachineWidget.swift,
//  TimeMachineWidgetControl.swift, TimeMachineWidgetLiveActivity.swift) were
//  deliberately deleted; this bundle replaces the generated one.
//

import WidgetKit
import SwiftUI

@main
struct TimeMachineWidgetBundle: WidgetBundle {
    var body: some Widget {
        TimeMachineLiveActivity()
    }
}
