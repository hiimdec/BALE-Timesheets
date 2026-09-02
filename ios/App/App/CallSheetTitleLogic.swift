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

    /// FOUNDER-RULED 2026-09-01: `title:` outranks `production title:`,
    /// `production:` and `client:`. Measured on the corpus, the old order
    /// returned the CLIENT on three sheets that carry a real title line
    /// (Brother, McDonald's, Everlast) and the shorter of two titles on
    /// Square. Consistency beats a nicer-looking answer; the user can edit.
    static let titleLabels = ["title:", "production title:", "production:", "client:", "project:", "job name:", "campaign:"]
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
        // PASS 1b: a page-1 line that is entirely a QUOTED phrase is a title
        // the sheet itself has marked out (Comet's ‘PROJECT COMET’ sits at
        // line 9, under a CLIENT line and an address). Quotes are a stronger
        // signal than position. Measured: only Comet and M&S quote a title,
        // and M&S carries a colon label that wins before this pass runs.
        for (i, line) in lines.enumerated() {
            let t = line.trimmingCharacters(in: .whitespacesAndNewlines)
            guard t.count >= 5, t.range(of: "^[‘'\"“][^‘'\"“”’]{2,}[’'\"”]$", options: .regularExpression) != nil else { continue }
            if let v = stripTitleBoilerplate(t) { return (v, i) }
        }
        for (i, line) in lines.enumerated() {
            let t = line.trimmingCharacters(in: .whitespacesAndNewlines)
            guard t.count >= 3, t.rangeOfCharacter(from: .letters) != nil else { continue }
            // Project Comet's real page 1 opens with "PRODUCTION COMPANY <address>"
            // and the stripper let it through as the title. A line that
            // begins with another field's label is that field, not a masthead.
            if startsWithFieldLabel(t) { continue }
            // An address line is never a title. Comet's page 1 opens with a
            // PRODUCTION COMPANY line that wraps onto "ESSEX, SS7 2RF"; skipping
            // only the labelled line promoted its continuation.
            if containsPostcode(t) { continue }
            if let v = stripTitleBoilerplate(t) { return (v, i) }
        }
        return nil
    }

    /// Labels of OTHER fields that can open a page-1 line. Matched as a
    /// prefix followed by a space or colon, so "PRODUCTION TITLE Winter Sale"
    /// (a title label, PASS 1) is untouched and "PRODUCTION" alone is not a
    /// label. Tight on purpose - every entry is measured on the corpus.
    /// NOT "client": on the Dove sheet "CLIENT DOVE" is the title-at-best and
    /// skipping it promoted the next line ("PRODUCT DOVE DYPTIQUE 2"). The
    /// colon form "client:" is a title label and never reaches this pass.
    static let fieldLabelPrefixes = [
        "production company", "production co", "prod co", "agency",
        "unit base", "location", "shoot date", "date", "call time", "job number",
        "job no", "director", "producer", "contact",
    ]
    /// GUARD C (founder-ruled 2026-09-01): TWO OR MORE QUOTED STRINGS IS A
    /// LIST, AND A LIST IS NOT A TITLE. "‘THE WALK’ ‘GIFTING’ ‘HOSTING’" on the
    /// M&S sheet is three film titles pasted into the TITLE field; on an
    /// invoice it reads like a shot list. Such a value loses to the next
    /// label (PRODUCTION: MARKS & SPENCER). It names the shape rather than a
    /// threshold that happens to land right on twenty sheets - a "mostly
    /// quoted" share and a length ceiling also separated the corpus, and
    /// were rejected for that reason. Each quoted string must be at least two
    /// characters and stand alone (start/space before, space/end after), so
    /// "ROCK 'N' ROLL" and "MCDONALD’S" are not lists. Comet's single quoted
    /// title is not a list.
    static func isQuotedList(_ value: String) -> Bool {
        guard let re = try? NSRegularExpression(pattern: "(?:^|\\s)[‘'\"“]([^‘'\"“”’]{2,})[’'\"”](?=\\s|$)") else { return false }
        return re.numberOfMatches(in: value, range: NSRange(location: 0, length: (value as NSString).length)) >= 2
    }

    static func containsPostcode(_ line: String) -> Bool {
        line.range(of: "\\b[A-Za-z]{1,2}[0-9][0-9A-Za-z]?\\s*[0-9][A-Za-z]{2}\\b", options: .regularExpression) != nil
    }
    static func startsWithFieldLabel(_ line: String) -> Bool {
        let low = line.lowercased().trimmingCharacters(in: .whitespaces)
        return fieldLabelPrefixes.contains { low.hasPrefix($0 + " ") || low.hasPrefix($0 + ":") }
    }

    // ── CLEANING (founder-ruled 2026-09-01) ─────────────────────────────
    // Sourcing decides WHICH value wins (resolveField, byte-identity: a
    // verified model value is never displaced). Cleaning is applied to
    // WHATEVER wins, model or pattern. Square proved the distinction: the
    // pattern gave "1001", the model gave "JOB NUMBER 1001 25", the sheet
    // says "1001 25" - no choice of source was right. On a 15 Pro the model
    // read "GYMSHARK WINTER WOMENSWEAR - DAY 1" verbatim and, being no
    // boilerplate, it stood; the stripper only ever ran on the pattern path.
    //
    // cleanTitle: strip a leading colonless label, then edge day numbering,
    // then boilerplate. nil = nothing survives (the value WAS boilerplate),
    // and the caller marks the field missing rather than keep junk.
    // Executed across all 20 corpus titles before landing: zero changes.
    static func cleanTitle(_ value: String) -> String? {
        var s = value.trimmingCharacters(in: .whitespacesAndNewlines)
        let low = s.lowercased()
        for label in colonlessTitleLabels where low.hasPrefix(label + " ") || low.hasPrefix(label + ":") {
            s = String(s.dropFirst(label.count)).trimmingCharacters(in: titleTrimSet)
            break
        }
        // Edge day numbering is stripped INSIDE stripTitleBoilerplate (the DN1
        // pins); an explicit call here was redundant - the MI3 mutation removed
        // it and nothing changed, which is the proof.
        guard !s.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
        return stripTitleBoilerplate(s)
    }
}
