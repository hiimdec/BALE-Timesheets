//
//  DiagnosticsExport.swift
//  App
//
//  The TEXT of a shared diagnostics file - PURE Foundation, no UIKit, no
//  Capacitor, so scripts/native-audit/diagnostics-export.js can compile it
//  with swiftc on the Mac and EXECUTE the pins (the BuildKind pattern).
//
//  Both routes to the file build through here: the one-second press on the
//  nav bar in MainViewController and the "Share Diagnostics" App Shortcut.
//  They exist for ONE failure mode - the web layer dead while native is
//  alive, when Settings cannot be reached - so nothing here touches the web
//  view and nothing here needs the app's UI. Founder-ruled 2026-09-04.
//
//  THE CHROME LINE is the single most important line for the dead-buttons
//  incident: the last chrome state native applied (title, back, tab bar,
//  chromeHidden) and WHEN. applyChromeState mirrors it into the App Group on
//  every update, so a cold-launch export still shows what the previous
//  process last did - the one line that says whether the bars were hidden.
//  Pinned as its own executed clause (DX6), never folded into a generic
//  header check.
//

import Foundation

struct DiagnosticsChromeState {
    var title: String
    var backVisible: Bool
    var tabBarVisible: Bool
    var chromeHidden: Bool
    var at: String   // ISO 8601 with offset, as applyChromeState wrote it
}

struct DiagnosticsExportMeta {
    var appVersion: String
    var build: String
    var osVersion: String
    var deviceModel: String
    var exportedAt: Date
    var timeZone: TimeZone
    var diagnosticsEnabled: Bool
    var chrome: DiagnosticsChromeState?   // nil = none recorded on this device yet
}

enum DiagnosticsExport {
    static let lineCap = 300
    /// App Group key applyChromeState mirrors its last applied state into. Read here.
    static let chromeStateKey = "tm_chrome_state"

    static func fileName(at date: Date, timeZone: TimeZone) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = timeZone
        f.dateFormat = "yyyyMMdd-HHmm"
        return "TimeMachine-diagnostics-\(f.string(from: date)).txt"
    }

    static func exportedLine(at date: Date, timeZone: TimeZone) -> String {
        let f = ISO8601DateFormatter()
        f.timeZone = timeZone
        f.formatOptions = [.withInternetDateTime]
        return "exported \(f.string(from: date)) (\(timeZone.identifier); log lines are local time)"
    }

    /// THE CHROME LINE. Exact, so a report months from now says whether the bars were hidden.
    static func chromeLine(_ c: DiagnosticsChromeState?) -> String {
        guard let c = c else { return "chrome | none recorded" }
        return "chrome | title=\"\(c.title)\" back=\(c.backVisible) tabBar=\(c.tabBarVisible) chromeHidden=\(c.chromeHidden) | at \(c.at)"
    }

    static func header(_ m: DiagnosticsExportMeta, lineCount: Int) -> [String] {
        [
            "TimeMachine diagnostics",
            "app \(m.appVersion) (\(m.build)) | iOS \(m.osVersion) | \(m.deviceModel)",
            exportedLine(at: m.exportedAt, timeZone: m.timeZone),
            "diagnostics logging: \(m.diagnosticsEnabled ? "on" : "off") (navigation, render and termination lines are recorded regardless)",
            "lines: \(lineCount) of \(lineCap)",
            chromeLine(m.chrome),
            "---",
        ]
    }

    /// The whole file. An empty ring still gets the header - never an empty file.
    static func text(lines: [String], meta: DiagnosticsExportMeta) -> String {
        var out = header(meta, lineCount: lines.count)
        if lines.isEmpty { out.append("No lines yet.") } else { out.append(contentsOf: lines) }
        return out.joined(separator: "\n") + "\n"
    }

    /// The spoken / shown result. Never an error: the file always exists.
    static func dialog(lineCount: Int) -> String {
        lineCount == 0
            ? "Nothing logged yet - the file has the version header only."
            : "Shared \(lineCount) diagnostic line\(lineCount == 1 ? "" : "s")."
    }

    // MARK: - Gathering (Foundation only; parameterised so this file names no other type)

    /// Parses the mirrored dictionary. Pure, so the harness can execute it.
    static func chromeState(dict d: [String: Any]?) -> DiagnosticsChromeState? {
        guard let d = d else { return nil }
        return DiagnosticsChromeState(
            title: d["title"] as? String ?? "",
            backVisible: d["back"] as? Bool ?? false,
            tabBarVisible: d["tabBar"] as? Bool ?? false,
            chromeHidden: d["chromeHidden"] as? Bool ?? false,
            at: d["at"] as? String ?? "?")
    }

    static func deviceModel() -> String {
        var sys = utsname()
        uname(&sys)
        return withUnsafePointer(to: &sys.machine) {
            $0.withMemoryRebound(to: CChar.self, capacity: 256) { String(cString: $0) }
        }
    }

    static func osVersionString() -> String {
        let v = ProcessInfo.processInfo.operatingSystemVersion
        return "\(v.majorVersion).\(v.minorVersion).\(v.patchVersion)"
    }

    struct Snapshot {
        let lines: [String]
        let meta: DiagnosticsExportMeta
        var text: String { DiagnosticsExport.text(lines: lines, meta: meta) }
        var fileName: String { DiagnosticsExport.fileName(at: meta.exportedAt, timeZone: meta.timeZone) }
        var dialog: String { DiagnosticsExport.dialog(lineCount: lines.count) }
    }

    /// Reads the ring, the flag and the chrome mirror from the App Group and stamps the build.
    static func snapshot(suite: String, logKey: String, flagKey: String, now: Date = Date()) -> Snapshot {
        let d = UserDefaults(suiteName: suite)
        let lines = d?.stringArray(forKey: logKey) ?? []
        let info = Bundle.main.infoDictionary ?? [:]
        let meta = DiagnosticsExportMeta(
            appVersion: info["CFBundleShortVersionString"] as? String ?? "?",
            build: info["CFBundleVersion"] as? String ?? "?",
            osVersion: osVersionString(),
            deviceModel: deviceModel(),
            exportedAt: now,
            timeZone: TimeZone.current,
            diagnosticsEnabled: d?.bool(forKey: flagKey) ?? false,
            chrome: chromeState(dict: d?.dictionary(forKey: chromeStateKey)))
        return Snapshot(lines: lines, meta: meta)
    }
}
