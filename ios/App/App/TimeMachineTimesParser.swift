//
//  TimeMachineTimesParser.swift
//
//  Siri Stage B — the "log my times" dictation parser. A PURE, Foundation-only
//  function so it can be unit-tested off-device (swiftc harness) AND read back
//  mid-conversation by the App Intent (it must live native for that). NO AI.
//
//  Deterministic: a spoken transcription → {call?, lunch?, wrap?,
//  lunchDurationMins?}, each as "HH:mm", any subset. Can't confidently extract a
//  field → omit it; nothing extracted → empty. The intent reads these back and
//  asks to confirm BEFORE anything is written.
//
//  am/pm priority: (1) explicit am/pm or 24h wins; (2) lunch clamps a bare hour
//  into the lunch window; (3) call→am, wrap→pm defaults; (4) tiebreaker — a bare
//  lunch/wrap is pushed past the call. No night-shoot keyword.
//

import Foundation

struct ParsedTimes: Equatable {
    var call: String?
    var lunch: String?
    var wrap: String?
    var lunchDurationMins: Int?
}

private enum TMField { case call, lunch, wrap }
private enum Meridiem { case am, pm, h24, none }

private let wordNumbers: [String: Int] = [
    "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6,
    "seven": 7, "eight": 8, "nine": 9, "ten": 10, "eleven": 11, "twelve": 12,
    "noon": 12, "midday": 12, "midnight": 0,
]

private func numFromToken(_ t: String) -> Int? {
    if let w = wordNumbers[t] { return w }
    if let n = Int(t) { return n }
    return nil
}

// Tokenize: lowercase, strip punctuation (keep ':' for HH:mm, drop apostrophes),
// split on whitespace. "9am" / "9:00" / "13:30" stay single tokens.
private func tokenize(_ s: String) -> [String] {
    var cleaned = ""
    for ch in s.lowercased() {
        if ch.isLetter || ch.isNumber || ch == ":" { cleaned.append(ch) }
        else { cleaned.append(" ") }
    }
    return cleaned.split(separator: " ").map(String.init)
}

// "9", "09", "9:00", "13:30", "1:30", "9am", "7pm", "1:30pm" → (hour, minute, meridiem).
// Returns nil for anything that isn't a clean numeric time (e.g. word numbers).
private func parseDigitLike(_ t: String) -> (h: Int, m: Int, mer: Meridiem)? {
    var idx = t.startIndex
    var hourStr = ""
    while idx < t.endIndex, t[idx].isNumber { hourStr.append(t[idx]); idx = t.index(after: idx) }
    if hourStr.isEmpty { return nil }
    var minStr = ""
    var hadColon = false
    if idx < t.endIndex, t[idx] == ":" {
        hadColon = true
        idx = t.index(after: idx)
        while idx < t.endIndex, t[idx].isNumber { minStr.append(t[idx]); idx = t.index(after: idx) }
    }
    let rest = String(t[idx...])
    var mer: Meridiem = .none
    if rest == "am" { mer = .am }
    else if rest == "pm" { mer = .pm }
    else if !rest.isEmpty { return nil }   // unknown suffix → not a clean time token
    guard let h = Int(hourStr) else { return nil }
    let m = minStr.isEmpty ? 0 : (Int(minStr) ?? 0)
    if mer == .none, hadColon, (h >= 13 || h == 0) { mer = .h24 }   // 13:30 / 00:30 → unambiguous 24h
    return (h, m, mer)
}

// Scan a window of tokens for the FIRST recognizable time expression.
private func parseTimeWindow(_ toks: [String]) -> (Int, Int, Meridiem)? {
    var i = 0
    while i < toks.count {
        let t = toks[i]
        let next = i + 1 < toks.count ? toks[i + 1] : ""
        let next2 = i + 2 < toks.count ? toks[i + 2] : ""

        // "half an hour" / "half a hour" is a DURATION, never a time — skip past it.
        if t == "half", next == "an" || next == "a" { i += 1; continue }
        // "half [past] X" → X:30
        if t == "half" {
            if next == "past", let h = numFromToken(next2) { return (h, 30, .none) }
            if let h = numFromToken(next) { return (h, 30, .none) }
            i += 1; continue
        }
        // "quarter|N past|to X"  (quarter = 15)
        var base: Int? = nil
        if t == "quarter" { base = 15 }
        else if let n = numFromToken(t), next == "past" || next == "to" { base = n }
        if let b = base, next == "past" || next == "to" {
            if let h = numFromToken(next2) {
                if next == "past" { return (h, b, .none) }
                let hh = h - 1
                return (hh <= 0 ? hh + 12 : hh, 60 - b, .none)
            }
            i += 1; continue
        }
        // Digit-like time ("9", "9am", "9:00", "13:30", "1:30").
        if let p = parseDigitLike(t) {
            var mer = p.mer
            if mer == .none { if next == "am" { mer = .am } else if next == "pm" { mer = .pm } }
            return (p.h, p.m, mer)
        }
        // Word-number hour ("nine", "eight"), optional am/pm.
        if let h = numFromToken(t) {
            var mer: Meridiem = .none
            if next == "am" { mer = .am } else if next == "pm" { mer = .pm }
            return (h, 0, mer)
        }
        i += 1
    }
    return nil
}

// Lunch duration: "hour and a half"=90, "half an hour"=30, "N minutes"=N,
// "hour"/"an hour"=60. Only consulted when a lunch anchor exists.
private func parseDuration(_ toks: [String]) -> Int? {
    for i in 0..<toks.count {
        let t = toks[i]
        let n1 = i + 1 < toks.count ? toks[i + 1] : ""
        let n2 = i + 2 < toks.count ? toks[i + 2] : ""
        let n3 = i + 3 < toks.count ? toks[i + 3] : ""
        if t == "hour", n1 == "and", n2 == "a" || n2 == "an", n3 == "half" { return 90 }
        if t == "half", n1 == "an" || n1 == "a", n2 == "hour" || n2 == "our" { return 30 }
        if let n = Int(t), n1 == "minutes" || n1 == "mins" || n1 == "minute" || n1 == "min" { return n }
        if t == "hour" { return 60 }
    }
    return nil
}

// "on set" is two tokens; everything else is one. Returns (field, tokenLength).
private func anchorAt(_ toks: [String], _ i: Int) -> (TMField, Int)? {
    let t = toks[i]
    if t == "wrap" || t == "wrapped" || t == "done" || t == "finished" || t == "out" { return (.wrap, 1) }
    if t == "lunch" || t == "break" || t == "meal" { return (.lunch, 1) }
    if t == "call" || t == "started" { return (.call, 1) }
    if t == "on", i + 1 < toks.count, toks[i + 1] == "set" { return (.call, 2) }
    return nil
}

private func resolveHour(rawHour: Int, meridiem: Meridiem, field: TMField, callHour: Int?) -> Int {
    switch meridiem {
    case .pm: return rawHour >= 12 ? rawHour : rawHour + 12   // 12pm→12, 1→13, 11→23
    case .am: return rawHour == 12 ? 0 : rawHour              // 12am→0, 9→9
    case .h24: return rawHour
    case .none:
        var h: Int
        switch field {
        case .call: h = rawHour                                       // am default — keep as spoken
        case .wrap: h = (rawHour >= 1 && rawHour <= 11) ? rawHour + 12 : rawHour   // pm default
        case .lunch: h = (rawHour >= 1 && rawHour <= 3) ? rawHour + 12 : rawHour   // clamp into the lunch window
        }
        // Tiebreaker: a bare lunch/wrap must fall after the call.
        if let c = callHour, field != .call, h <= c, h + 12 < 24, h + 12 > c { h += 12 }
        return h
    }
}

func parseSpokenTimes(_ transcription: String, now: Date = Date()) -> ParsedTimes {
    let toks = tokenize(transcription)
    if toks.isEmpty { return ParsedTimes() }

    // Collect anchors with their value windows.
    var anchors: [(field: TMField, start: Int, valueStart: Int)] = []
    var i = 0
    while i < toks.count {
        if let (f, len) = anchorAt(toks, i) { anchors.append((f, i, i + len)); i += len }
        else { i += 1 }
    }
    if anchors.isEmpty { return ParsedTimes() }

    // Per-field raw parse (first anchor for a field wins). "now"/"just" → current time.
    var raw: [TMField: (h: Int, m: Int, mer: Meridiem)] = [:]
    var nowFields: Set<TMField> = []
    var hasLunchAnchor = false
    for (idx, a) in anchors.enumerated() {
        if a.field == .lunch { hasLunchAnchor = true }
        if raw[a.field] != nil || nowFields.contains(a.field) { continue }
        let nextStart = idx + 1 < anchors.count ? anchors[idx + 1].start : toks.count
        let window = Array(toks[a.valueStart..<nextStart])
        if let p = parseTimeWindow(window) {
            raw[a.field] = p
        } else {
            let precededByJust = a.start > 0 && toks[a.start - 1] == "just"
            if precededByJust || window.contains("now") || window.contains("just") { nowFields.insert(a.field) }
        }
    }

    var cal = Calendar.current
    cal.timeZone = TimeZone.current
    let nowH = cal.component(.hour, from: now)
    let nowM = cal.component(.minute, from: now)
    func fmt(_ h: Int, _ m: Int) -> String { String(format: "%02d:%02d", ((h % 24) + 24) % 24, m) }

    // Resolve call first so it can anchor the lunch/wrap tiebreaker.
    var out = ParsedTimes()
    var callHour: Int? = nil
    if nowFields.contains(.call) { out.call = fmt(nowH, nowM); callHour = nowH }
    else if let p = raw[.call] { let h = resolveHour(rawHour: p.h, meridiem: p.mer, field: .call, callHour: nil); out.call = fmt(h, p.m); callHour = h }

    if nowFields.contains(.lunch) { out.lunch = fmt(nowH, nowM) }
    else if let p = raw[.lunch] { let h = resolveHour(rawHour: p.h, meridiem: p.mer, field: .lunch, callHour: callHour); out.lunch = fmt(h, p.m) }

    if nowFields.contains(.wrap) { out.wrap = fmt(nowH, nowM) }
    else if let p = raw[.wrap] { let h = resolveHour(rawHour: p.h, meridiem: p.mer, field: .wrap, callHour: callHour); out.wrap = fmt(h, p.m) }

    if hasLunchAnchor { out.lunchDurationMins = parseDuration(toks) }
    return out
}
