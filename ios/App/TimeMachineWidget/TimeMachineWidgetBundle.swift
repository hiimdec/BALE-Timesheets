//
//  TimeMachineWidgetBundle.swift
//
//  The widget extension's entry point. When you create the Widget Extension in
//  Xcode it auto-generates its own `@main` WidgetBundle — there can be only ONE
//  `@main` per target, so:
//    • If you KEEP Xcode's generated bundle, DELETE this file and instead add
//      `TimeMachineLiveActivity()` to that generated bundle's `body`.
//    • If you DELETE Xcode's generated bundle/boilerplate, use this file as-is.
//
//  Stage 1 ships only the Live Activity (no Home Screen / Lock Screen static
//  widgets), so the bundle contains just TimeMachineLiveActivity.
//

import SwiftUI
import WidgetKit

@main
struct TimeMachineWidgetBundle: WidgetBundle {
    var body: some Widget {
        TimeMachineLiveActivity()
    }
}
