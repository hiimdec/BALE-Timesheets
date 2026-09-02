//
//  CallSheetHarvest.swift
//
//  The pattern-primary harvest core, PURE Foundation — the third use of the
//  TimeMachineTimesParser / CallSheetTitleLogic precedent: everything here is
//  executable off-device by the audit suite's swiftc harness
//  (scripts/callsheet-audit/harvest-assertions.js).
//
//  COMMIT 1 OF THE PATTERN-PRIMARY READER (founder-approved, 2026-08-31):
//  this file is INERT in the app — the NEW harvests (prodCo / job ref /
//  address / block anchoring) have NO call sites yet; the pipeline wires them
//  in at commit 2, and the availability ungating is commit 3. What the app
//  DOES use today are the RELOCATED members at the bottom: byte-equivalent
//  moves with thin forwarders left in CallSheetPipeline, so behaviour is
//  identical on every input.
//
//  EVERY LEXICON HERE IS MEASURED, not guessed — 20 real call sheets
//  (~/Developer/tm-callsheets, outside the public repo). Coverage per anchor:
//  section-header lines 11/20, payee verbs 13/20 (with "please invoice"),
//  header∪payee 18/20 in-suite (InRehearsal's header is glyph-damaged only in
//  the old pdfjs tooling — clean via PDFKit, the decoder this suite now
//  shares with the device), HMRC boilerplate 13/20, job-ref labels 16/20
//  (the four misses have NO reference at all), prodCo label family 12/20,
//  postcode shape 20/20. "remittance" and "pay to" appear on ZERO sheets and
//  are EXCLUDED from the new intent lexicon (they survive verbatim in the
//  relocated email-harvest core below ONLY because commit 1 is inert - the
//  drop lands with commit 2's rewiring, where behaviour is allowed to move).
//

import Foundation

enum CallSheetHarvest {

    // ── The page model the pure harvests consume ────────────────────────────
    // (index, text) is all the pipeline's SourcePage exposes to the harvests;
    // adapters in CallSheetPipeline map SourcePage → PageText.
    struct PageText {
        let index: Int
        let text: String
    }

    struct Hit {
        let value: String
        let pageIndex: Int
        let range: NSRange       // in the page's text
        let how: String          // which rule fired — diagnostics + pins
    }

    // ── MEASURED LEXICONS ───────────────────────────────────────────────────

    /// Payee verbs — how real sheets NAME the company invoices go to.
    /// Measured 13/20 (misses: Vertical, Umberto, Nike, InRehearsal, Forever
    /// Living, M&S, Comet — all but Comet covered by the other anchors).
    static let payeeVerbPattern =
        "(made\\s+out\\s+to|addressed\\s+to|address(ed)?\\s+invoices?\\s+to|" +
        "invoices?\\s+(must\\s+)?(to\\s+)?be\\s+(emailed|addressed|sent|made\\s+out)(\\s+(within|to))?|" +
        "invoicing\\s+address|invoice\\s+to|please\\s+invoice)"

    /// A standalone section-header line: INVOICING / INVOICE DETAILS /
    /// INVOICING INFORMATION / INVOICES:  — measured 11/20 as a line.
    static let sectionHeaderPattern =
        "^\\s*\\W{0,4}(invoicing|invoices?)\\s*(details|information|info)?\\s*:?\\s*\\W{0,4}$"

    /// HMRC compliance boilerplate — an INDEPENDENT invoicing-section signal
    /// (near-identical numbered requirement lists on 13/20 sheets).
    static let hmrcPattern =
        "(schedule\\s+d|lp10|inland\\s+revenue|hmrc|company\\s+number|vat\\s+(no\\b|number|reg)|ni\\s+number|\\butr\\b)"

    /// Job-reference labels — measured 16/20; the four misses (Vertical,
    /// InRehearsal, Comet, Gymshark) carry NO reference at all. Alternation
    /// is LONGEST-FIRST ("reference" before "ref") — the first run proved
    /// "ref" would eat "REFERENCE:" and leave "ERENCE:" in the value.
    static let refLabelPattern =
        "(job\\s*(number|reference|no|ref|code)\\s*[:#]?|quote\\s+on\\s+invoice|quoting|with\\s+ref|job\\s+name\\s*:)"

    /// The value ends at sentence tokens — the Square sheet exposed this
    /// ("… QUOTING JOB NUMBER 1234 25 WITHIN 7 DAYS" must not bleed).
    static let refStopTokens = ["WITHIN", "PLEASE", "AND", "TO", "ON", "IF"]

    /// Company suffixes (case-insensitive at use): ranking aid INSIDE an
    /// invoicing block, never a standalone prodCo picker — measured: 19/20
    /// sheets carry 2+ distinct suffix-bearing names, so suffix-hunting alone
    /// can never disambiguate.
    static let companySuffixPattern =
        "\\b(ltd\\.?|limited|llp|productions?|films?|pictures|studios?|media)\\b"

    /// prodCo label — "PRODUCTION COMPANY:" family. Anchored at line start
    /// OR after a 2+-space column gap: PDFKit joins table columns onto one
    /// line ("CLIENT: X   PRODUCTION COMPANY: Y" — the BofA shape, found by
    /// the first corpus run), while a single space still blocks prose
    /// collisions. The negative lookahead is the CO-ORDINATOR guard.
    /// Measured 12/20 as a label.
    static let prodCoLabelPattern =
        "(^|\\s{2,})(uk\\s+production\\s+company|production\\s+company|production\\s+co\\.?|prod\\.?\\s*co\\.?)(?!\\s*-?\\s*ordinator)\\s*[:=]?\\s*"

    /// Payee stop-phrases — a payee line naming one of these names a
    /// DEPARTMENT or instruction, not a company (measured on Square and
    /// McDonald's: "invoices to be addressed to the production department").
    static let payeeStopPhrases = ["the production department", "the attention of", "your invoice", "the client", "the address below"]

    /// UK postcode shape — the address anchor. 20/20 sheets carry at least
    /// one postcode-shaped token; the BLOCK scoping is what makes it the
    /// invoicing address.
    static let postcodePattern = "\\b[A-Za-z]{1,2}[0-9][0-9A-Za-z]?\\s*[0-9][A-Za-z]{2}\\b"

    // ── Block anchoring: the SECTION, not the line ──────────────────────────

    struct Block {
        let pageIndex: Int
        let startLine: Int      // anchor line index within the page's lines
        let endLine: Int        // inclusive, bounded window
    }

    /// A page's lines — a plain \n split, IDENTICAL to how the pipeline reads
    /// PDFKit's page.string (NSString.lineRange walks the same boundaries).
    static func lines(of text: String) -> [String] {
        text.components(separatedBy: "\n")
    }

    static func isBlockAnchor(_ line: String) -> Bool {
        let l = line.lowercased()
        if l.range(of: sectionHeaderPattern, options: [.regularExpression]) != nil { return true }
        if l.range(of: payeeVerbPattern, options: [.regularExpression]) != nil { return true }
        if l.range(of: hmrcPattern, options: [.regularExpression]) != nil { return true }
        return false
    }

    /// Anchored invoicing blocks: each anchor opens a bounded window (the
    /// anchor line + the next `window` lines), overlapping windows merge.
    /// Bounded by design — a runaway block would swallow the crew list.
    static func invoicingBlocks(pages: [PageText], window: Int = 12) -> [Block] {
        var out: [Block] = []
        for page in pages {
            let ls = lines(of: page.text)
            var current: (start: Int, end: Int)? = nil
            for (i, line) in ls.enumerated() {
                guard isBlockAnchor(line) else { continue }
                let end = min(i + window, ls.count - 1)
                if let cur = current, i <= cur.end {
                    current = (cur.start, max(cur.end, end))
                } else {
                    if let cur = current { out.append(Block(pageIndex: page.index, startLine: cur.start, endLine: cur.end)) }
                    current = (i, end)
                }
            }
            if let cur = current { out.append(Block(pageIndex: page.index, startLine: cur.start, endLine: cur.end)) }
        }
        return out
    }

    // ── prodCo: payee line → label → suffix line inside a block ─────────────

    static func containsPayeeStopPhrase(_ s: String) -> Bool {
        let l = s.lowercased()
        return payeeStopPhrases.contains { l.contains($0) }
    }

    static func trimCompanyTail(_ s: String) -> String {
        // Measured hygiene (M&S / Walkers / Dove): cut trailing TEL/phone/
        // email tails and addresses after the first comma-or-run separator.
        var v = s.trimmingCharacters(in: .whitespacesAndNewlines)
        if let r = v.range(of: "\\s+(tel|t)\\s*[:.]", options: [.regularExpression, .caseInsensitive]) { v = String(v[..<r.lowerBound]) }
        // A trailing street address is TRIMMED, not fatal - "RIFF RAFF FILMS
        // LTD 71 ELBOROUGH STREET" is a good label value with an address tail
        // (the second corpus run caught the over-rejection).
        if let r = v.range(of: "\\s+\\d+[-–]?\\d*\\s+\\S+\\s+(road|street|lane|avenue|place|square|drive|estate)\\b", options: [.regularExpression, .caseInsensitive]) { v = String(v[..<r.lowerBound]) }
        if let r = v.range(of: "\\s+and\\s+emailed\\b", options: [.regularExpression, .caseInsensitive]) { v = String(v[..<r.lowerBound]) }
        if let r = v.range(of: "[,;]", options: .regularExpression) { v = String(v[..<r.lowerBound]) }
        if let r = v.range(of: "\\s{3,}", options: .regularExpression) { v = String(v[..<r.lowerBound]) }
        return v.trimmingCharacters(in: CharacterSet(charactersIn: " \t\r\n.:-–—|"))
    }

    /// Company-value hygiene, learned from the first corpus run: a captured
    /// "company" must not be an instruction sentence, a chained label, a
    /// person addressed F.A.O, an email, or an address cell. Falling through
    /// beats auto-filling junk — a harvest hit always matches back into the
    /// text, so a junk value would arrive VERIFIED-looking; this gate is the
    /// shape rule that keeps that honest.
    static func plausibleCompanyValue(_ v: String) -> Bool {
        guard v.count >= 3, v.count <= 60, v.rangeOfCharacter(from: .letters) != nil else { return false }
        let low = v.lowercased()
        if low.range(of: payeeVerbPattern, options: .regularExpression) != nil { return false }   // chained label (the Amahla shape)
        if low.contains("@") || low.contains("f.a.o") || low.contains("attention") { return false } // person/email addressee (the Everlast shape)
        if low.range(of: "^(please|all|your|any)\\b", options: .regularExpression) != nil { return false } // instruction line (the Brother shape)
        if low.range(of: "\\d+\\s+\\S+\\s+(road|street|lane|avenue|chambers|floor|estate)\\b", options: .regularExpression) != nil { return false } // address cell (the Comet shape)
        if v.split(separator: " ").count > 6 { return false }
        return true
    }

    /// The company NAME around a suffix word: up to three preceding
    /// capitalised tokens (leading glue words dropped), requiring at least
    /// two words in total — so "ADDRESS TO MAD COW FILMS" yields
    /// "MAD COW FILMS", while "…THE FILM INDUSTRY…" and a bare "STUDIO 5"
    /// yield nothing (the first corpus run's junk captures).
    /// (g) A label-trusted cell: 2-5 capitalised words, no colon, not another
    /// field's label ("CLIENT AUDIBLE" on Comet), no 1-2 letter token (a damaged
    /// postcode), no postcode on this line or the next. OCR text only.
    static func labelledCompanyValue(_ s: String, next: String, relaxed: Bool) -> String? {
        guard relaxed else { return nil }
        let t = s.trimmingCharacters(in: .whitespacesAndNewlines)
        let low = t.lowercased()
        for lbl in ["client", "agency", "director", "producer", "location", "unit base", "date", "call time", "contact", "production"] where low.hasPrefix(lbl + " ") || low.hasPrefix(lbl + ":") { return nil }
        // Tokens must be SPACE-separated: "{2,5}" with an optional space let
        // "POTTERMORE" pass as "P" + "OTTERMORE" (found by the R2g3 case).
        guard t.range(of: "^[A-Z][A-Za-z&'’.-]*(?:\\s+[A-Z][A-Za-z&'’.-]*){1,4}$", options: .regularExpression) != nil, !t.contains(":") else { return nil }
        // Location vocabulary is never a company: on Comet's OCR the cells under
        // a PRODUCTION COMPANY header were "STUDIO5" and "BD STUDIOS" - a wrong
        // fill is worse than the honest empty the founder had.
        guard low.range(of: "\\b(studio|studios|stage|stages|unit|park|road|street|lane|square|house|floor|hub|centre|center)\\b", options: .regularExpression) == nil else { return nil }
        guard t.range(of: "\\b[A-Z]{1,2}\\b", options: .regularExpression) == nil else { return nil }
        guard !containsUKPostcode(t), !containsUKPostcode(next) else { return nil }
        return t
    }

    static func companyNameWindow(in line: String) -> String? {
        // The LAST suffix in the line anchors the window - "See Production
        // Ltd" must window on "Ltd", not on the "Production" inside the name
        // (the harness's first run caught exactly that).
        guard let re = try? NSRegularExpression(pattern: companySuffixPattern, options: [.caseInsensitive]) else { return nil }
        let nsLine = line as NSString
        let all = re.matches(in: line, range: NSRange(location: 0, length: nsLine.length))
        guard let lastMatch = all.last, let sufRange = Range(lastMatch.range, in: line) else { return nil }
        // (d, 2026-09-02) A single digit glued to a capitalised word is a glyph
        // artefact ("c/o 7Wallace Music Limited" on the Amahla sheet), not a token.
        let before = String(line[..<sufRange.lowerBound]).replacingOccurrences(of: "\\b\\d([A-Z][a-z]{3,})", with: "$1", options: .regularExpression)
        let suffix = String(line[sufRange]).trimmingCharacters(in: .whitespaces)
        let glue: Set<String> = ["to", "the", "of", "at", "by", "for", "and", "with", "address", "invoices", "invoice", "all"]
        var tokens: [String] = []
        for raw in before.split(separator: " ").reversed() {
            let t = String(raw).trimmingCharacters(in: CharacterSet(charactersIn: " \t.,:;|"))
            if t.isEmpty { continue }
            guard t.range(of: "^[A-Z][A-Za-z&.'’-]*$", options: .regularExpression) != nil else { break }
            if glue.contains(t.lowercased()) { break }
            tokens.insert(t, at: 0)
            if tokens.count == 3 { break }
        }
        guard !tokens.isEmpty else { return nil }
        let name = (tokens + [suffix]).joined(separator: " ")
        return plausibleCompanyValue(name) ? name : nil
    }

    /// (g, 2026-09-02) `relaxed` is true ONLY for OCR text, never the layer: a
    /// labelled cell without a company suffix ("Production Company:" / "The
    /// Visuals Team") is trusted by its label on OCR, where glyphs cannot be
    /// deleted. On a damaged layer the same rule captured "SUSSEX BN NR" - a
    /// postcode with its digits gone - so the layer keeps the suffix rule.
    static func harvestProdCo(pages: [PageText], relaxed: Bool = false) -> Hit? {
        // 1. PAYEE LINES anywhere — the strongest signal ("addressed to X",
        //    "Made out to: X"). Stop-phrases fall through to the label. TWO
        //    PASSES (the measured Nettwerk rule): a payee value carrying a
        //    company suffix OUTRANKS an earlier payee line naming a person —
        //    "INVOICES TO BE ADDRESSED TO <person> ..." then
        //    "... ADDRESSED TO <person>'S STUDIO LTD, <address>" must yield
        //    the Ltd, not the person.
        var payeeHits: [Hit] = []
        for page in pages {
            let ns = page.text as NSString
            for lineRange in lineRanges(of: ns) {
                let line = ns.substring(with: lineRange)
                guard line.range(of: payeeVerbPattern, options: [.regularExpression, .caseInsensitive]) != nil else { continue }
                guard !containsPayeeStopPhrase(line) else { continue }
                if let m = line.range(of: "(made\\s+out\\s+to|addressed\\s+to|invoicing\\s+address|address(ed)?\\s+invoices?\\s+to|invoice\\s+to)\\s*:?\\s*",
                                      options: [.regularExpression, .caseInsensitive]) {
                    let after = String(line[m.upperBound...])
                    let v = trimCompanyTail(after)
                    if plausibleCompanyValue(v), !containsPayeeStopPhrase(v) {
                        payeeHits.append(Hit(value: v, pageIndex: page.index, range: lineRange, how: "payee-line"))
                    }
                }
            }
        }
        if let suffixed = payeeHits.first(where: { $0.value.range(of: companySuffixPattern, options: [.regularExpression, .caseInsensitive]) != nil }) {
            return Hit(value: suffixed.value, pageIndex: suffixed.pageIndex, range: suffixed.range, how: "payee-line-suffixed")
        }
        // (Bank of America ruling, 2026-09-02) Where a sheet names two companies
        // in a header label, the one the INVOICING BLOCK names wins. This is the
        // payee branch - already ranked above the label path - given one more
        // anchor: "COMPANY ADDRESS: Knucklehead, 28 Cowper Street, ..." inside a
        // block. The name is the run before the first comma or digit; no suffix
        // is required because the block is the sheet's own statement of the payee.
        // Block-scoped, so a crew-list "company address" elsewhere cannot fire.
        for block in invoicingBlocks(pages: pages) {
            guard let page = pages.first(where: { $0.index == block.pageIndex }) else { continue }
            let ns = page.text as NSString
            let ranges = lineRanges(of: ns)
            for i in block.startLine...min(block.endLine, ranges.count - 1) {
                let line = ns.substring(with: ranges[i])
                guard let m = line.range(of: "^\\s*company\\s+address\\s*:\\s*", options: [.regularExpression, .caseInsensitive]) else { continue }
                let rest = String(line[m.upperBound...])
                let name = String(rest.prefix { $0 != "," && !$0.isNumber }).trimmingCharacters(in: CharacterSet(charactersIn: " \t.;"))
                if name.range(of: "^[A-Z][A-Za-z&'’.-]*(?:\\s[A-Z][A-Za-z&'’.-]*){0,3}$", options: .regularExpression) != nil {
                    return Hit(value: name, pageIndex: page.index, range: ranges[i], how: "block-company-address")
                }
            }
        }
        if let first = payeeHits.first { return first }
        // 2. THE LABEL — "PRODUCTION COMPANY:" (line-start anchored,
        //    co-ordinator-guarded). Value on the line, else the next
        //    non-empty line, else (table layout: the label is a column
        //    header) the first suffix-bearing line among the next three.
        for page in pages {
            let ns = page.text as NSString
            let ranges = lineRanges(of: ns)
            for (i, lineRange) in ranges.enumerated() {
                let line = ns.substring(with: lineRange)
                guard let m = line.range(of: prodCoLabelPattern, options: [.regularExpression, .caseInsensitive]) else { continue }
                let sameLine = trimCompanyTail(String(line[m.upperBound...]))
                // (a3, 2026-09-02) After a UK PRODUCTION COMPANY label the same-line value
                // is the company even without a suffix - short, capitalised, no digits
                // ("KNUCKLEHEAD x EPOCH"). Subordinate to the payee branch above: where
                // the invoicing block names one of two companies, the block wins.
                if line.range(of: "uk\\s+production\\s+company", options: [.regularExpression, .caseInsensitive]) != nil,
                   sameLine.range(of: "^[A-Z][A-Za-z&'’ x-]{2,40}$", options: .regularExpression) != nil {
                    return Hit(value: sameLine, pageIndex: page.index, range: lineRange, how: "prodco-uk-label")
                }
                // A same-line label value must CARRY a company suffix - the
                // third corpus run's Comet capture ("CENTRAL CHAMBERS", a
                // building from a joined table row) showed a suffixless
                // same-line value is more often the next column than the
                // company. Without one, fall through to the cell walk.
                if plausibleCompanyValue(sameLine),
                   sameLine.range(of: companySuffixPattern, options: [.regularExpression, .caseInsensitive]) != nil,
                   sameLine.range(of: "^(location|details|weather|catering)\\b", options: [.regularExpression, .caseInsensitive]) == nil {
                    return Hit(value: sameLine, pageIndex: page.index, range: lineRange, how: "prodco-label")
                }
                // Label alone (or a table header row) — walk up to three
                // lines for the cell; the company-name WINDOW rule extracts
                // the name and rejects location cells ("STUDIO 5") and
                // address cells (the first corpus run's junk captures).
                for j in (i + 1)...(min(i + 3, ranges.count - 1)) where j > i {
                    let cand = ns.substring(with: ranges[j]).trimmingCharacters(in: .whitespacesAndNewlines)
                    guard !cand.isEmpty else { continue }
                    // A location cell is never a company, whichever rule would take it:
                    // OCR splits Comet's header row so "BD STUDIOS" (STUDIOS is a company
                    // suffix) landed as a cell under PRODUCTION COMPANY (2026-09-02).
                    if cand.range(of: "\\b(location|studio|studios|stage|stages|weather|catering|unit\\s*base)\\b", options: [.regularExpression, .caseInsensitive]) != nil { continue }
                    if let name = companyNameWindow(in: cand) ?? labelledCompanyValue(cand, next: j + 1 < ranges.count ? ns.substring(with: ranges[j + 1]) : "", relaxed: relaxed) {
                        return Hit(value: name, pageIndex: page.index, range: ranges[j], how: "prodco-label-cell")
                    }
                }
            }
        }
        // 3. SUFFIX-BEARING LINE inside an anchored invoicing block — the
        //    Nettwerk rule (the payee line names a person; the studio Ltd
        //    sits on the adjacent line).
        for block in invoicingBlocks(pages: pages) {
            guard let page = pages.first(where: { $0.index == block.pageIndex }) else { continue }
            let ls = lines(of: page.text)
            let ns = page.text as NSString
            let ranges = lineRanges(of: ns)
            for i in block.startLine...min(block.endLine, ls.count - 1) {
                let line = ls[i]
                // The second corpus run's junk fills all lived on HMRC
                // boilerplate or instruction sentences ("IF INVOICING AS AN
                // LTD COMPANY...") - a suffix there is legal text, never the
                // payee. Skip those lines outright.
                let low = line.lowercased()
                if low.range(of: hmrcPattern, options: .regularExpression) != nil { continue }
                if low.range(of: "\\b(if|must|please|ensure|your|copy)\\b", options: .regularExpression) != nil { continue }
                guard i < ranges.count, let name = companyNameWindow(in: line) else { continue }
                return Hit(value: name, pageIndex: page.index, range: ranges[i], how: "suffix-in-block")
            }
        }
        return nil
    }

    // ── Job reference: widened capture + the sentence-token stop ────────────

    static func harvestJobRef(pages: [PageText]) -> Hit? {
        var fallback: Hit? = nil
        let blocks = invoicingBlocks(pages: pages)
        for page in pages {
            let ns = page.text as NSString
            let ranges = lineRanges(of: ns)
            for (i, lineRange) in ranges.enumerated() {
                let line = ns.substring(with: lineRange)
                guard let v = refValue(from: line) else { continue }
                let hit = Hit(value: v, pageIndex: page.index, range: lineRange, how: "ref-label")
                let inBlock = blocks.contains { $0.pageIndex == page.index && i >= $0.startLine && i <= $0.endLine }
                if inBlock { return hit }              // an in-block ref wins
                if fallback == nil { fallback = hit }  // else first in document order
            }
        }
        return fallback
    }

    /// Rest-of-line value after a ref label: quote-aware, spaces/slashes/#
    /// allowed ("CMK AW26", "FLP AM/PM", "BFC#0032"), stopped at sentence
    /// tokens and triple-space runs. nil when nothing value-shaped remains.
    static func refValue(from line: String) -> String? {
        // The LAST label occurrence wins — real lines chain them ("QUOTING
        // MCDONALDS & JOB NUMBER 12345", "QUOTE ON INVOICE: JOB NO: TDA176"),
        // and the value follows the final label (the first corpus run).
        guard let re = try? NSRegularExpression(pattern: refLabelPattern, options: [.caseInsensitive]) else { return nil }
        let ns = line as NSString
        let matches = re.matches(in: line, range: NSRange(location: 0, length: ns.length))
        guard let last = matches.last, let m = Range(last.range, in: line) else { return nil }
        var after = String(line[m.upperBound...]).trimmingCharacters(in: CharacterSet(charactersIn: " \t:#"))
        if after.hasPrefix("\"") || after.hasPrefix("“") {
            after = String(after.dropFirst())
            if let q = after.range(of: "[\"”]", options: .regularExpression) { after = String(after[..<q.lowerBound]) }
        }
        if let r = after.range(of: "\\s{3,}|\\||\\s+•", options: .regularExpression) { after = String(after[..<r.lowerBound]) }
        var words: [String] = []
        for w in after.split(separator: " ").map(String.init) {
            if refStopTokens.contains(w.uppercased()) { break }
            words.append(w)
            if words.count >= 4 { break }
        }
        let v = words.joined(separator: " ").trimmingCharacters(in: CharacterSet(charactersIn: " \t.,;:"))
        // The numeric-pair collapse that lived here ("1001 25" -> "1001") was
        // written FOR the Square sheet, and the founder's reading of that
        // sheet is that the pair IS the reference. Deleted 2026-09-01; no other
        // corpus reference is a numeric pair, so nothing else moves.
        guard !v.isEmpty, v.count <= 30,
              v.range(of: "[0-9]", options: .regularExpression) != nil
                || v.range(of: "^[A-Z]{2,}", options: .regularExpression) != nil else { return nil }
        return v
    }

    // ── CLEANING (founder-ruled 2026-09-01): applied to the winning value,
    //    model or pattern. A leading reference label is never part of the
    //    reference ("JOB NUMBER 1001 25" -> "1001 25"). Executed across all
    //    16 corpus references before landing: unchanged. ──
    static func cleanRef(_ value: String) -> String {
        var s = value.trimmingCharacters(in: .whitespacesAndNewlines)
        if let re = try? NSRegularExpression(pattern: "^" + refLabelPattern, options: [.caseInsensitive]),
           let m = re.firstMatch(in: s, range: NSRange(location: 0, length: (s as NSString).length)),
           let r = Range(m.range, in: s) {
            s = String(s[r.upperBound...]).trimmingCharacters(in: CharacterSet(charactersIn: " \t:#"))
        }
        return s
    }

    // ── THE MODEL PAGE PLAN (founder-ruled 2026-09-01: 12 seconds and three
    //    pages). Project Comet - seven pages, none mentioning invoicing - ran
    //    seven sequential on-device generations with no cap. When a sheet HAS
    //    invoicing pages the plan is unchanged (page 1 + those pages, byte-
    //    identity for every sheet that reads today); when it has NONE, the
    //    model sees page 1 plus the two densest pages, in document order.
    //    Patterns still run on every page - they are milliseconds. ──
    static func modelPagePlan(pageCharCounts: [Int], invoicPages: Set<Int>, cap: Int = 3) -> [Int] {
        let n = pageCharCounts.count
        guard n > 0 else { return [] }
        if !invoicPages.isEmpty {
            return [0] + (1..<n).filter { invoicPages.contains($0) }
        }
        let rest = (1..<n).sorted { pageCharCounts[$0] != pageCharCounts[$1] ? pageCharCounts[$0] > pageCharCounts[$1] : $0 < $1 }
        return ([0] + rest.prefix(max(0, cap - 1))).sorted()
    }

    // ── Address: block anchor + postcode scoping (replaces the 5/20 label
    //    lexicon — the reach is MEASURED by the harness's corpus mode and
    //    gates commit 2, as ruled) ──────────────────────────────────────────

    struct AddressHit {
        let value: String        // the address lines, joined with ", "
        let pageIndex: Int
        let range: NSRange       // spanning the contributing lines
        let postcode: String
    }

    static func harvestAddress(pages: [PageText]) -> AddressHit? {
        for block in invoicingBlocks(pages: pages) {
            guard let page = pages.first(where: { $0.index == block.pageIndex }) else { continue }
            let ns = page.text as NSString
            let ranges = lineRanges(of: ns)
            let ls = lines(of: page.text)
            for i in block.startLine...min(block.endLine, ls.count - 1) {
                let line = ls[i]
                guard let pcRange = line.range(of: postcodePattern, options: [.regularExpression]) else { continue }
                let postcode = String(line[pcRange])
                // The address = this line back to (at most) two prior
                // non-empty lines that are not themselves anchors/labels.
                var parts: [String] = []
                var startIdx = i
                var back = i - 1
                var taken = 0
                while back >= block.startLine, taken < 2 {
                    let cand = ls[back].trimmingCharacters(in: .whitespaces)
                    if cand.isEmpty || isBlockAnchor(cand)
                        || cand.range(of: prodCoLabelPattern, options: [.regularExpression, .caseInsensitive]) != nil { break }
                    parts.insert(cand, at: 0); startIdx = back; taken += 1; back -= 1
                }
                parts.append(line.trimmingCharacters(in: .whitespaces))
                guard startIdx < ranges.count, i < ranges.count else { continue }
                let span = NSUnionRange(ranges[startIdx], ranges[i])
                return AddressHit(value: parts.joined(separator: ", "), pageIndex: page.index, range: span, postcode: postcode)
            }
        }
        return nil
    }

    // ── The MODEL-WINS ranking (commit 2, founder-ruled): the byte-identity
    //    invariant, pure and pinned. A model value the pipeline VERIFIED
    //    stands untouched — same value, same crop, same page — on every
    //    eligible device; a pattern hit fills ONLY where today's answer is
    //    unverified or missing. This function is the single decision point
    //    the plugin wires through, so the invariant is executable off-device
    //    and the ordered mutation (patterns outranking a verified model
    //    value) reddens its pin. ──

    enum FieldResolution: Equatable {
        case model          // the model's value stands (verified today)
        case pattern        // the pattern hit fills (today: unverified/missing)
        case none           // neither side has anything
    }

    static func resolveField(modelState: String?, hasPatternHit: Bool) -> FieldResolution {
        if modelState == "verified" { return .model }         // byte-identity: NEVER displaced
        if hasPatternHit { return .pattern }                  // fill the gap, verified by construction
        if modelState != nil { return .model }                // unverified model value, no pattern: unchanged
        return .none
    }

    // ── Shared line walking (NSString.lineRange — the pipeline's own walk) ──

    static func lineRanges(of ns: NSString) -> [NSRange] {
        var out: [NSRange] = []
        var idx = 0
        while idx < ns.length {
            let lr = ns.lineRange(for: NSRange(location: idx, length: 0))
            out.append(lr)
            idx = lr.location + lr.length
        }
        return out
    }

    // ════════════════════════════════════════════════════════════════════════
    // RELOCATED VERBATIM from CallSheetPipeline (2026-08-31, commit 1) — the
    // bodies below are byte-equivalent moves; CallSheetPipeline keeps thin
    // forwarders/adapters so every call site and behaviour is unchanged.
    // ════════════════════════════════════════════════════════════════════════

    struct EmailHit { let token: String; let pageIndex: Int; let range: NSRange; let lineRange: NSRange; let score: Int }

    // Positive: the email's line or the line above carries invoicing intent.
    // ("invoice" matches "invoices/invoiced"; "account" matches "accounts".)
    // NOTE: "remittance" / "pay to" measure 0/20 on the corpus and leave this
    // list at COMMIT 2 (the rewiring) — kept here verbatim because commit 1
    // is inert on every input, corpus or not.
    static let invoiceIntentKeywords = ["invoice", "invoicing", "account", "billing", "please email", "send to", "send invoices", "email invoices", "remittance", "pay to"]
    // Demote: crew/contact-list context around the email.
    static let crewContextKeywords = ["crew", "unit list", "call sheet", "runner", "gaffer", "best boy", "electrician", "rigger", "trainee", "daily", "mobile", "diary", "director", "producer", "1st ad", "2nd ad", "stand-by", "standby"]

    static func harvestInvoicingEmailsCore(pages: [PageText]) -> (primary: EmailHit?, cc: EmailHit?) {
        guard let emailRe = try? NSRegularExpression(pattern: "[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}") else { return (nil, nil) }
        let phonePattern = "(\\+44\\s?7|\\b07)\\d{2,3}[\\s.\\-]?\\d{3}[\\s.\\-]?\\d{3}"
        var candidates: [EmailHit] = []
        for page in pages {
            let ns = page.text as NSString
            let matches = emailRe.matches(in: page.text, range: NSRange(location: 0, length: ns.length))
            let emailLocs = matches.map { $0.range.location }
            for m in matches {
                let lineRange = ns.lineRange(for: m.range)
                let line = ns.substring(with: lineRange).lowercased()
                var prev = ""
                if lineRange.location > 0 {
                    let pr = ns.lineRange(for: NSRange(location: lineRange.location - 1, length: 0))
                    prev = ns.substring(with: pr).lowercased()
                }
                let lineHit = invoiceIntentKeywords.contains { line.contains($0) }
                let prevHit = invoiceIntentKeywords.contains { prev.contains($0) }
                let positive = (lineHit ? 10 : 0) + (prevHit ? 5 : 0)
                if positive == 0 { continue }  // no invoicing intent → never a candidate (crew-safe)
                var score = positive
                if crewContextKeywords.contains(where: { line.contains($0) }) { score -= 6 }
                if crewContextKeywords.contains(where: { prev.contains($0) }) { score -= 4 }
                if (line + " " + prev).range(of: phonePattern, options: .regularExpression) != nil { score -= 4 }
                let clustered = emailLocs.filter { abs($0 - m.range.location) <= 220 }.count
                if clustered >= 4 { score -= 5 }  // dense email rows = a list, not an invoicing block
                candidates.append(EmailHit(token: ns.substring(with: m.range), pageIndex: page.index, range: m.range, lineRange: lineRange, score: score))
            }
        }
        let sorted = candidates.sorted {
            $0.score != $1.score ? $0.score > $1.score
            : ($0.pageIndex != $1.pageIndex ? $0.pageIndex < $1.pageIndex : $0.range.location < $1.range.location)
        }
        guard let best = sorted.first else { return (nil, nil) }
        // CC = a distinct invoicing-intent address on the SAME line or the same
        // block (an adjacent line, ~within 120 chars).
        let cc = sorted.first {
            $0.token.lowercased() != best.token.lowercased() && $0.pageIndex == best.pageIndex &&
            (NSEqualRanges($0.lineRange, best.lineRange) || abs($0.lineRange.location - best.lineRange.location) <= 120)
        }
        return (best, cc)
    }

    static func isPlausibleEmail(_ s: String) -> Bool {
        let pattern = "^[^@\\s]+@[^@\\s]+\\.[^@\\s]{2,}$"
        return s.range(of: pattern, options: .regularExpression) != nil
    }

    /// Pull every valid email TOKEN out of a string, in order, case-insensitively
    /// de-duplicated. An invoicing email is often printed on a shared line — e.g.
    /// "EMAIL INVOICES TO: a@x.com & b@y.com" — so the right operation is to
    /// EXTRACT the address(es) from the value, not validate the whole line as one.
    static func extractEmails(_ s: String) -> [String] {
        let pattern = "[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}"
        guard let re = try? NSRegularExpression(pattern: pattern) else { return [] }
        let ns = s as NSString
        var out: [String] = []
        var seen = Set<String>()
        for m in re.matches(in: s, range: NSRange(location: 0, length: ns.length)) {
            let tok = ns.substring(with: m.range)
            if seen.insert(tok.lowercased()).inserted { out.append(tok) }
        }
        return out
    }

    static func containsUKPostcode(_ s: String) -> Bool {
        let pattern = "[A-Za-z]{1,2}[0-9][0-9A-Za-z]?\\s*[0-9][A-Za-z]{2}"
        return s.range(of: pattern, options: .regularExpression) != nil
    }
}
