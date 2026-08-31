//
//  CallSheetTitleLogic.swift
//
//  The call-sheet TITLE logic, PURE and Foundation-only — the
//  TimeMachineTimesParser precedent: it must be executable off-device by the
//  audit suite's swiftc harness (scripts/callsheet-audit/title-assertions.js),
//  because this surface shipped with zero pins and two live bugs proved it.
//
//  THE FIX (founder-approved, 2026-08-31, measured on 20 real call sheets):
//  the old masthead fallback REJECTED any line containing boilerplate — but on
//  9 of 20 real sheets the title lives INSIDE that line ("CALL SHEET |
//  UMBERTO GIANNINI - KNOW YOUR CURLS", "GYMSHARK WINTER WOMENSWEAR - DAY 1"),
//  and the one-word "CALLSHEET" passed the filter entirely and became a title.
//  stripTitleBoilerplate DELETES the boilerplate and keeps the remainder.
//
//  DELETION ORDER (ruled): day-numbering FIRST (DAY N OF N, DAY N, then any
//  orphaned N OF N a prior deletion exposed), THEN the sheet words (including
//  one-word CALLSHEET), THEN weekday/date/year shapes, then collapse and trim.
//  The order is pinned STRUCTURALLY as well as behaviourally: the orphan
//  N-OF-N cleanup is deliberate redundancy that makes several wrong orders
//  produce the same nil, so a behavioural fixture alone could pass a chain
//  that works for the wrong reason (stated in the pins' vacuity note).
//
//  TWO REFINEMENTS, both load-bearing (the simulation proved them):
//  - LEADING-LABEL-WITHOUT-COLON preference: a page-1 line beginning
//    "TITLE … " / "PRODUCTION TITLE … " / "JOB NAME … " yields its remainder
//    and OUTRANKS earlier plain lines. Without it the Nettwerk-shaped sheet
//    REGRESSES to an earlier line carrying a person's name. The set is
//    deliberately TIGHT: "PROJECT …" would hijack the Umberto-shaped sheet's
//    campaign line away from its correct masthead.
//  - STOP-LIST: a stripped remainder that is only job vocabulary ("SHOOT",
//    "PRODUCER", "IMPORTANT NOTE!!!") is rejected, never promoted.
//
//  The LABEL harvest (harvestTitle) is UNTOUCHED by this fix and still runs
//  first — the "Greener Production:" label collision is a separate, later
//  fix, deliberately not smuggled in here. titleLabels / titleTrimSet /
//  isTitleBoilerplate are RELOCATED here verbatim (byte-same logic) so the
//  label path's acceptance rule is testable too.
//

import Foundation

enum CallSheetTitle {

    // ── Relocated VERBATIM from CallSheetPipeline (no behaviour change) ──

    static let titleLabels = ["production:", "production title:", "client:", "title:", "project:", "job name:", "campaign:"]
    static let titleTrimSet = CharacterSet(charactersIn: " \t\r\n:-–—|")

    static func isTitleBoilerplate(_ s: String) -> Bool {
        let v = s.lowercased()
        if v.contains("call sheet") || v.contains("shoot day") || v.contains("unit list") || v.contains("movement order") { return true }
        if v.range(of: "day\\s+\\d+\\s+of\\s+\\d+", options: .regularExpression) != nil { return true }                       // "DAY 6 OF 7"
        if v.range(of: "^(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\\b.*\\d", options: .regularExpression) != nil { return true } // weekday + date
        if v.range(of: "\\d{1,2}(st|nd|rd|th)?\\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)", options: .regularExpression) != nil { return true }
        if v.range(of: "\\d{1,2}[/.\\-]\\d{1,2}[/.\\-]\\d{2,4}", options: .regularExpression) != nil { return true }          // 14/07/26
        return false
    }

    // ── The stop-list: job vocabulary that must never BE the title ──
    static let stopRemainders: Set<String> = [
        "shoot", "producer", "director", "location", "crew", "schedule",
        "contact", "contacts", "page", "note", "notes", "important",
        "important note", "unit", "unit call", "breakfast", "weather",
        "parking", "hospital", "callsheet", "call sheet",
    ]

    static func normalisedForStop(_ s: String) -> String {
        s.lowercased().filter { $0.isLetter || $0.isNumber || $0 == " " }
            .split(separator: " ").joined(separator: " ")
    }

    static func isStopListed(_ s: String) -> Bool {
        let norm = normalisedForStop(s)
        if norm.isEmpty { return true }
        if stopRemainders.contains(norm) { return true }
        // Every word individually job vocabulary ("IMPORTANT NOTE") → reject.
        let words = norm.split(separator: " ").map(String.init)
        return !words.isEmpty && words.allSatisfy { stopRemainders.contains($0) }
    }

    // ── strip-the-token-keep-the-remainder ──

    private static let monthNames = "january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec"
    private static let weekdayNames = "monday|tuesday|wednesday|thursday|friday|saturday|sunday"

    // ── Day numbering, MEASURED on the 20-sheet corpus (2026-08-31): ──
    // DAY N appears on 8/20, DAY N OF N on 4/20, SHOOT DAY N on 4/20,
    // "DAY N:" as a prefix on 2/20, bare N OF N on 4/20. Forms that appear
    // on ZERO sheets are deliberately EXCLUDED rather than guessed in:
    // D1/D2 (no D-digit token exists anywhere in the corpus, and a real
    // title could contain one), fused DAYN, spelled-out DAY ONE, UNIT DAY N,
    // and DAY N/N (the slash forms are still accepted inside the measured
    // shapes' tails, where the anchoring makes them safe).
    //
    // THE ANCHORING HAZARD (founder-ruled, the pin that matters more):
    // over-stripping mangles real titles - "Day of the Dead" is a job name,
    // "Best 2 of 3" contains a bare N-of-N, a title may START with a number.
    // So day numbering is stripped ONLY where it actually occurs on sheets:
    // a WHOLE separated segment ("… | DAY 2 OF 2"), a TRAILING fragment
    // after a separator ("GYMSHARK WINTER WOMENSWEAR - DAY 1"), or a
    // LEADING "DAY N:" prefix - NEVER a bare match in the middle of text.
    // TWO cores, deliberately: the WHOLE-SEGMENT test accepts bare "N OF N"
    // (measured: it only ever occurs as its own segment, e.g. "| DAY 2 OF 2");
    // the EDGE rules REQUIRE the word DAY — the first pin run proved why: a
    // trailing-anchored bare N-of-N ate the tail of "BEST 2 OF 3", the exact
    // over-stripping hazard the ruling weights above everything else.
    private static let dayFormCore = "(?:(?:shoot\\s+)?day\\s*\\d{1,2}(?:\\s*(?:of|\\/)\\s*\\d{1,2})?|\\d{1,2}\\s*(?:of|\\/)\\s*\\d{1,2})"
    private static let dayEdgeForm = "(?:shoot\\s+)?day\\s*\\d{1,2}(?:\\s*(?:of|\\/)\\s*\\d{1,2})?"

    static func isWholeDayNumbering(_ segment: String) -> Bool {
        segment.range(of: "^\\s*\(dayFormCore)[\\s.:!]*$",
                      options: [.regularExpression, .caseInsensitive]) != nil
    }

    static func stripEdgeDayNumbering(_ segment: String) -> String {
        var v = segment
        // Trailing: " - DAY 1", ", DAY 2 OF 2", " DAY 3" at the segment end.
        v = v.replacingOccurrences(
            of: "[\\s,:]*[-–—]?[\\s,:]+\(dayEdgeForm)[\\s.:!]*$",
            with: "", options: [.regularExpression, .caseInsensitive])
        // Leading: "DAY 1:" / "DAY 2 -" prefix before the real content.
        v = v.replacingOccurrences(
            of: "^\\s*\(dayEdgeForm)\\s*[:\\-–—]\\s*",
            with: "", options: [.regularExpression, .caseInsensitive])
        return v
    }

    /// Delete boilerplate from a masthead line and return the surviving
    /// title text, or nil when nothing usable survives. Segment-first:
    /// the line splits on hard separators (| • · – —, not plain hyphen -
    /// titles contain hyphens), each segment is classified whole, then
    /// day numbering is stripped from segment EDGES only (ruled), then the
    /// sheet words and date shapes are deleted, then collapse and trim.
    /// Surviving fragments join with " - ".
    static func stripTitleBoilerplate(_ s: String) -> String? {
        let rawSegments = s.components(separatedBy: CharacterSet(charactersIn: "|•·–—"))
        var kept: [String] = []
        for raw in rawSegments {
            let seg = raw.trimmingCharacters(in: .whitespaces)
            if seg.isEmpty { continue }
            // 1. DAY NUMBERING FIRST (ruled order): whole-segment forms drop,
            //    edge fragments strip - interior text is NEVER touched.
            if isWholeDayNumbering(seg) { continue }
            var v = stripEdgeDayNumbering(seg)
            let gsub = { (pattern: String) in
                v = v.replacingOccurrences(of: pattern, with: " ", options: [.regularExpression, .caseInsensitive])
            }
            // 2. THE SHEET WORDS - including the one-word CALLSHEET that the
            //    old filter let through whole (the Bank-of-America live bug).
            gsub("shoot\\s+day\\s+call\\s*sheet")
            gsub("call\\s*sheet")
            gsub("shoot\\s+day")
            gsub("unit\\s+list")
            gsub("movement\\s+order")
            // 3. WEEKDAY / DATE / YEAR shapes.
            gsub("\\b(\(weekdayNames))\\b[\\s,]*\\d{0,2}(st|nd|rd|th)?(\\s+of)?(\\s+(\(monthNames)))?(\\s+\\d{2,4})?")
            gsub("\\b\\d{1,2}(st|nd|rd|th)?\\s+(\(monthNames))(\\s+\\d{2,4})?")
            gsub("\\b(\(monthNames))\\s+\\d{1,2}(st|nd|rd|th)?(\\s+\\d{2,4})?")
            gsub("\\b\\d{1,2}[/.\\-]\\d{1,2}([/.\\-]\\d{2,4})?\\b")
            gsub("\\b(19|20)\\d{2}\\b")
            var cleaned = v.replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
                .trimmingCharacters(in: CharacterSet(charactersIn: " \t\r\n:-–—|,"))
            // RE-CLASSIFY after the other deletions (corpus-measured: the day
            // form can sit INTERIOR - "CALLSHEET DAY 3 OF 3 7/11/25",
            // "CALL SHEET SHOOT DAY 6 OF 7 TUESDAY 2 DECEMBER" - where the
            // edge rules cannot see it until the sheet words and dates are
            // gone; the remainder then IS the day form). Still anchored:
            // whole-segment or edges only, so "BEST 2 OF 3" - which nothing
            // above touches - reduces to itself and survives.
            if cleaned.isEmpty || isWholeDayNumbering(cleaned) { continue }
            cleaned = stripEdgeDayNumbering(cleaned)
                .trimmingCharacters(in: CharacterSet(charactersIn: " \t\r\n:-–—|,"))
            if !cleaned.isEmpty { kept.append(cleaned) }
        }
        let joined = kept.joined(separator: " - ")
            .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespaces)
        guard joined.count >= 3,
              joined.rangeOfCharacter(from: .letters) != nil,
              !isStopListed(joined) else { return nil }
        return joined
    }

    // ── The masthead candidate over page-1 lines ──

    /// Labels that name the title WITHOUT a colon on real sheets
    /// ("PRODUCTION TITLE Winter Sale", "TITLE TENDER LP VISUALISERS").
    /// TIGHT set (see header): PROJECT/CLIENT/PRODUCTION are excluded.
    static let colonlessTitleLabels = ["production title", "job name", "title"]

    static func leadingColonlessLabelValue(_ line: String) -> String? {
        let t = line.trimmingCharacters(in: .whitespaces)
        let low = t.lowercased()
        for label in colonlessTitleLabels {
            guard low.hasPrefix(label + " ") else { continue }
            let raw = String(t.dropFirst(label.count)).trimmingCharacters(in: titleTrimSet)
            guard !raw.isEmpty else { continue }
            if let stripped = stripTitleBoilerplate(raw) { return stripped }
        }
        return nil
    }

    /// The masthead title from page-1 lines: PASS 1 prefers a
    /// leading-label-without-colon line anywhere on the page (load-bearing —
    /// without it the Nettwerk shape regresses to a person-name line);
    /// PASS 2 takes the first line whose STRIPPED remainder survives.
    static func mastheadCandidate(lines: [String]) -> (value: String, lineIndex: Int)? {
        for (i, line) in lines.enumerated() {
            if let v = leadingColonlessLabelValue(line) { return (v, i) }
        }
        for (i, line) in lines.enumerated() {
            let t = line.trimmingCharacters(in: .whitespacesAndNewlines)
            guard t.count >= 3, t.rangeOfCharacter(from: .letters) != nil else { continue }
            if let v = stripTitleBoilerplate(t) { return (v, i) }
        }
        return nil
    }
}
