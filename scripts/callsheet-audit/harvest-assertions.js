#!/usr/bin/env node
'use strict';
/*
 * Pattern-primary harvest pins + corpus measurement (commit 1, 2026-08-31).
 *
 * FIXTURE pins (always run in the gate): swiftc-compile CallSheetHarvest.swift
 * (+ CallSheetTitleLogic.swift) with a generated main and EXECUTE the real
 * Swift against committed, sanitized cases — every measured capture rule has
 * its witness: payee verbs, the stop-phrase fall-through, the CO-ORDINATOR
 * guard, the table/next-line cell rule, the suffixed-payee preference, the
 * widened job-ref capture with the sentence-token stop, block anchoring, and
 * address = block + postcode (with the NEGATIVE case: a postcode outside any
 * block yields nothing — the scoping IS the design). The relocated members
 * are pinned byte-equivalent by execution: same outputs on a fixed battery.
 *
 * INERTNESS pins: the new harvests have ZERO call sites in the plugin this
 * commit; the relocated members are reached only through same-signature
 * forwarders. The app cannot behave differently.
 *
 * CORPUS mode (loud-skip like coverage.js): extracts the real sheets VIA
 * PDFKIT — the same decoder family as the device, closing the pdfjs line-
 * shape gap Part 1 accepted — runs the harvests, reports per-sheet
 * resolution, and measures THE ADDRESS REACH (block∩postcode, named misses),
 * which GATES commit 2 by ruling. Also writes the founder's prefilled
 * expectations draft OUTSIDE the repo (~/Developer/tm-callsheets/
 * expected.draft.txt) — real invoicing data never enters this public repo.
 *
 * VACUITY, plainly: fixture pins execute the real logic and genuinely
 * redden; what they cannot prove is corpus behaviour (that is the corpus
 * mode's report, which asserts only extraction sanity, not right answers —
 * right answers arrive with the founder-confirmed expected.txt in a later
 * commit) or the Vision OCR line shapes (device-walk territory).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const HARVEST = path.join(ROOT, 'ios', 'App', 'App', 'CallSheetHarvest.swift');
const TITLE = path.join(ROOT, 'ios', 'App', 'App', 'CallSheetTitleLogic.swift');
const PLUGIN = path.join(ROOT, 'ios', 'App', 'App', 'CallSheetPlugin.swift');
const APP_HTML = path.join(ROOT, 'index.html');
const CORPUS = process.env.TM_CALLSHEET_DIR || path.join(os.homedir(), 'Developer', 'tm-callsheets');

// kind: prodco | jobref | address(expect "value|postcode" or <NIL>) | blocks
// (expect count) | emails (expect primary token or <NIL>) | helper batteries.
const CASES = [
  // ── HV1: payee verbs capture the payee company ──
  { id: 'HV1-addressed-to', kind: 'prodco', pages: ['INVOICING\nALL INVOICES MUST BE ADDRESSED TO TEEPEE FILMS, NETIL CORNER, 2 EXAMPLE STREET, LONDON, E8 4RU'], expect: 'TEEPEE FILMS' },
  { id: 'HV1-made-out-to', kind: 'prodco', pages: ['INVOICING Made out to: Uncovered Group, 5 Example Gardens, London AB1 2CD'], expect: 'Uncovered Group' },
  { id: 'HV1-invoicing-address-label', kind: 'prodco', pages: ['INVOICING ADDRESS: BROTHER FILM CO LLP\nFULL CORRECT NAME AS REGISTERED'], expect: 'BROTHER FILM CO LLP' },
  // ── HV2: stop-phrase falls through to the label ──
  { id: 'HV2-department-falls-through', kind: 'prodco', pages: ['INVOICES TO BE ADDRESSED TO THE PRODUCTION DEPARTMENT. ALL HEADS NOTE.\nPRODUCTION COMPANY: EXELL FILM'], expect: 'EXELL FILM' },
  // ── HV3: the CO-ORDINATOR guard ──
  { id: 'HV3-coordinator-not-a-label', kind: 'prodco', pages: ['PRODUCTION CO ORDINATOR: Alex Example RED alex@example.test\nPRODUCTION COMPANY: SEE PRODUCTION'], expect: 'SEE PRODUCTION' },
  { id: 'HV3-coordinator-alone-yields-nothing', kind: 'prodco', pages: ['PRODUCTION CO ORDINATOR: Jane Example follows here'], expect: '<NIL>' },
  { id: 'HV3-production-co-label-works', kind: 'prodco', pages: ['PRODUCTION CO: EXAMPLE FILMS'], expect: 'EXAMPLE FILMS' },
  // ── HV4: table layout — label as header, value in a cell below ──
  { id: 'HV4-table-cell-suffix-wins', kind: 'prodco', pages: ['PRODUCTION COMPANY LOCATION DETAILS WEATHER CATERING\nSTUDIO 5\nSee Production Ltd, 1 Example Street'], expect: 'See Production Ltd' },
  { id: 'HV4b-suffixless-same-line-falls-to-cell', kind: 'prodco', pages: ['PRODUCTION COMPANY CENTRAL CHAMBERS 9 EXAMPLE HOUSE\nSee Production Ltd, 1 Example Street'], expect: 'See Production Ltd' },
  // ── HV5: suffixed payee outranks an earlier person-naming payee line ──
  { id: 'HV5-suffixed-payee-beats-person', kind: 'prodco', pages: ['INVOICES TO BE ADDRESSED TO ALEX EXAMPLE AND EMAILED TO alex@example.test\nINVOICES TO BE ADDRESSED TO ALEX EXAMPLE STUDIO LTD, 16 EXAMPLE DRIVE, AB1 2CD'], expect: 'ALEX EXAMPLE STUDIO LTD' },
  // ── HV6: widened job-ref value capture ──
  { id: 'HV6-spaced-ref', kind: 'jobref', pages: ['JOB REFERENCE: CMK AW26'], expect: 'CMK AW26' },
  { id: 'HV6-quoted-ref', kind: 'jobref', pages: ['please send invoices with ref "FLP AM/PM"'], expect: 'FLP AM/PM' },
  { id: 'HV6-hash-ref', kind: 'jobref', pages: ['JOB NUMBER: BFC#0032'], expect: 'BFC#0032' },
  { id: 'HV6-sentence-stop (the Square failure)', kind: 'jobref', pages: ['INVOICES : PLEASE SEND INVOICES QUOTING JOB NUMBER 20514 WITHIN 7 DAYS.'], expect: '20514' },
  { id: 'HV6-no-ref-no-invention', kind: 'jobref', pages: ['CALL SHEET\nUNIT CALL 07:00\nLOCATION EXAMPLE STUDIOS'], expect: '<NIL>' },
  // FOUNDER-RULED 2026-09-01: the numeric pair IS the reference ("1001 25" on
  // the Square sheet). The collapse that kept the first token was written for
  // this very sheet and was wrong about it.
  { id: 'HV6-numeric-pair-is-the-reference (ruled)', kind: 'jobref', pages: ['JOB NUMBER 1001 25'], expect: '1001 25' },
  // ── CLEANING (founder-ruled): applied to WHATEVER wins, model or pattern ──
  { id: 'CL1-ref-leading-label-stripped (the model read)', kind: 'cleanref', input: 'JOB NUMBER 1001 25', expect: '1001 25' },
  { id: 'CL1b-ref-leading-label-colon', kind: 'cleanref', input: 'Job Number: TDA176', expect: 'TDA176' },
  { id: 'CL1c-ref-clean-is-idempotent', kind: 'cleanref', input: 'CMK AW26', expect: 'CMK AW26' },
  { id: 'CL2-title-trailing-day-stripped (the Gymshark model read)', kind: 'cleantitle', input: 'GYMSHARK WINTER WOMENSWEAR - DAY 1', expect: 'GYMSHARK WINTER WOMENSWEAR' },
  { id: 'CL2b-title-leading-colonless-label (the Nettwerk model read)', kind: 'cleantitle', input: 'Title TENDER LP VISUALISERS', expect: 'TENDER LP VISUALISERS' },
  { id: 'CL2c-title-leading-colon-label', kind: 'cleantitle', input: 'Title: TENDER LP VISUALISERS', expect: 'TENDER LP VISUALISERS' },
  { id: 'CL2d-title-pure-boilerplate-becomes-nil', kind: 'cleantitle', input: 'CALL SHEET DAY 2 OF 2', expect: '<NIL>' },
  { id: 'CL2e-title-real-hyphen-survives', kind: 'cleantitle', input: 'AMAHLA - A LITTLE HOPE MUSIC VIDEOS', expect: 'AMAHLA - A LITTLE HOPE MUSIC VIDEOS' },
  { id: 'CL2f-title-day-of-the-dead-survives', kind: 'cleantitle', input: 'DAY OF THE DEAD', expect: 'DAY OF THE DEAD' },
  // ── THE MODEL PAGE PLAN (founder-ruled: 12 seconds and three pages) ──
  { id: 'PP1-with-invoicing-pages-the-plan-is-unchanged (byte-identity)', kind: 'plan', input: '2615,2842,2238,855,812,526,4171|0,6', expect: '0,6' },
  // Two invoicing pages besides page 1, and more than the cap: ALL of them
  // are kept - the cap applies only when there is no invoicing page. (The
  // MI11 mutation, which truncated the invoicing set, passed PP1 because its
  // single-page fixture could not tell.)
  { id: 'PP1b-every-invoicing-page-is-kept-past-the-cap', kind: 'plan', input: '100,200,300,400,500,600,700|0,2,4,6', expect: '0,2,4,6' },
  { id: 'PP2-no-invoicing-page-page1-plus-two-densest (Comet)', kind: 'plan', input: '1694,2142,2446,2516,3136,1427,1298|', expect: '0,3,4' },
  { id: 'PP3-two-pages-both', kind: 'plan', input: '10,20|', expect: '0,1' },
  { id: 'PP4-single-page', kind: 'plan', input: '500|', expect: '0' },
  { id: 'PP5-empty', kind: 'plan', input: '|', expect: '' },
  { id: 'PP6-ties-resolve-in-document-order', kind: 'plan', input: '100,900,900,900|', expect: '0,1,2' },
  // ── HV7: an in-block reference outranks document order ──
  { id: 'HV7-in-block-ref-wins', kind: 'jobref', pages: ['JOB NUMBER SO102\nsome masthead text', 'INVOICING DETAILS\nQUOTE ON INVOICE: JOB NO: XY999'], expect: 'XY999' },
  // ── HV8: address = block anchor + postcode; scoping is the design ──
  { id: 'HV8-block-address', kind: 'address', pages: ['INVOICING DETAILS\nAddress Invoices to: Merman Example Limited\n2nd floor, 32 Example Place\nLondon W1T 1JJ'], expect: 'W1T 1JJ' },
  { id: 'HV8-postcode-outside-block-is-nothing', kind: 'address', pages: ['LOCATION Fire Strength and Fitness, Unit 8A Example Estate, SG11 2DY\nUNIT CALL 07:00'], expect: '<NIL>' },
  // ── HV9: block anchoring mechanics ──
  { id: 'HV9-two-anchors-merge', kind: 'blocks', pages: ['INVOICING\nPlease invoice: Job number ARM123\nsome line\nAll invoices need breakdowns'], expect: '1' },
  { id: 'HV9-hmrc-is-an-anchor', kind: 'blocks', pages: ['YOUR INVOICE NEEDS TO INCLUDE:\nCOMPANY NUMBER IF LTD\nVAT NUMBER WHERE REGISTERED'], expect: '1' },
  { id: 'HV9-plain-page-no-blocks', kind: 'blocks', pages: ['CALL SHEET\nUNIT CALL 07:00\nWEATHER: RAIN'], expect: '0' },
  // ── HV10: relocated members, byte-equivalence by execution ──
  { id: 'HV10-extractEmails-two-tokens', kind: 'emails-extract', input: 'EMAIL INVOICES TO: a@example.test & b@example.test', expect: 'a@example.test,b@example.test' },
  { id: 'HV10-extractEmails-dedup', kind: 'emails-extract', input: 'a@example.test A@EXAMPLE.TEST', expect: 'a@example.test' },
  { id: 'HV10-plausible', kind: 'emails-plausible', input: 'accounts@example.test', expect: 'true' },
  { id: 'HV10-implausible', kind: 'emails-plausible', input: 'not an email @ all', expect: 'false' },
  { id: 'HV10-postcode-yes', kind: 'postcode', input: 'Merman London Limited, 32 Example Place, W1T 1JJ', expect: 'true' },
  { id: 'HV10-postcode-no', kind: 'postcode', input: 'no code here', expect: 'false' },
  { id: 'HV10-harvest-emails-crew-safe', kind: 'emails-core', pages: ['GAFFER Alex Example alex@example.test 07000 000000'], expect: '<NIL>' },
  { id: 'HV10-harvest-emails-intent', kind: 'emails-core', pages: ['PLEASE EMAIL INVOICES TO accounts@example.test WITHIN 7 DAYS'], expect: 'accounts@example.test' },
  // ── HV11: THE MODEL-WINS RANKING (commit 2) — the byte-identity invariant,
  //    executed. A verified model value is NEVER displaced by a pattern hit;
  //    a pattern fills only unverified/missing; an unverified model value
  //    with no pattern stays as-is. The ordered mutation (patterns outrank
  //    a verified model value) reddens HV11a.
  { id: 'HV11a-model-verified-wins', kind: 'resolve', input: 'verified|true', expect: 'model' },
  { id: 'HV11b-pattern-fills-unverified', kind: 'resolve', input: 'unverified|true', expect: 'pattern' },
  { id: 'HV11c-pattern-fills-missing', kind: 'resolve', input: '|true', expect: 'pattern' },
  { id: 'HV11d-no-pattern-leaves-model', kind: 'resolve', input: 'unverified|false', expect: 'model' },
  { id: 'HV11e-nothing-anywhere', kind: 'resolve', input: '|false', expect: 'none' },
];

function generateMain(fixturePath) {
  return `
import Foundation
import PDFKit
struct C: Codable { let id: String; let kind: String; let pages: [String]?; let input: String?; let expect: String }
func pt(_ pages: [String]) -> [CallSheetHarvest.PageText] {
    pages.enumerated().map { CallSheetHarvest.PageText(index: $0.offset, text: $0.element) }
}
let mode = CommandLine.arguments.count > 2 ? CommandLine.arguments[2] : "fixtures"
if mode == "fixtures" {
    let data = try! Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1]))
    let cases = try! JSONDecoder().decode([C].self, from: data)
    var red = 0
    for c in cases {
        var got = "<NIL>"
        switch c.kind {
        case "prodco":  if let h = CallSheetHarvest.harvestProdCo(pages: pt(c.pages ?? [])) { got = h.value }
        case "jobref":  if let h = CallSheetHarvest.harvestJobRef(pages: pt(c.pages ?? [])) { got = h.value }
        case "address": if let h = CallSheetHarvest.harvestAddress(pages: pt(c.pages ?? [])) { got = h.postcode }
        case "blocks":  got = String(CallSheetHarvest.invoicingBlocks(pages: pt(c.pages ?? [])).count)
        case "emails-extract": got = CallSheetHarvest.extractEmails(c.input ?? "").joined(separator: ",")
        case "emails-plausible": got = CallSheetHarvest.isPlausibleEmail(c.input ?? "") ? "true" : "false"
        case "postcode": got = CallSheetHarvest.containsUKPostcode(c.input ?? "") ? "true" : "false"
        case "cleanref": got = CallSheetHarvest.cleanRef(c.input ?? "")
        case "cleantitle": got = CallSheetTitle.cleanTitle(c.input ?? "") ?? "<NIL>"
        case "plan":
            let parts = (c.input ?? "").split(separator: "|", omittingEmptySubsequences: false).map(String.init)
            let counts = parts[0].split(separator: ",").compactMap { Int($0) }
            let inv = Set(parts.count > 1 ? parts[1].split(separator: ",").compactMap { Int($0) } : [])
            got = CallSheetHarvest.modelPagePlan(pageCharCounts: counts, invoicPages: inv).map(String.init).joined(separator: ",")
            if got.isEmpty { got = "" }
        case "emails-core":
            let r = CallSheetHarvest.harvestInvoicingEmailsCore(pages: pt(c.pages ?? []))
            got = r.primary?.token ?? "<NIL>"
        case "resolve":
            let parts = (c.input ?? "").split(separator: "|", omittingEmptySubsequences: false).map(String.init)
            let state = parts[0].isEmpty ? nil : parts[0]
            switch CallSheetHarvest.resolveField(modelState: state, hasPatternHit: parts[1] == "true") {
            case .model: got = "model"
            case .pattern: got = "pattern"
            case .none: got = "none"
            }
        default: got = "<UNKNOWN>"
        }
        if got == c.expect { print("OK \\(c.id)") } else { red += 1; print("RED \\(c.id) | expected \\(c.expect) | got \\(got)") }
    }
    exit(red == 0 ? 0 : 1)
}
// ── CORPUS mode: PDFKit extraction (the device's decoder family) ──
let dir = CommandLine.arguments[1]
let files = (try? FileManager.default.contentsOfDirectory(atPath: dir))?.filter { $0.lowercased().hasSuffix(".pdf") }.sorted() ?? []
var draft = ""
var addressMisses: [String] = []
var addressHits = 0
var harvested: [String: [String: String]] = [:]
// Every value is ONE LINE on its way out: a harvested value carrying a
// trailing newline split 13 of the 20 draft blocks in two, and the reader
// then attributed the tail's fields to nothing. Same rule at both exits.
let clean: (String) -> String = { $0.split(whereSeparator: { $0.isNewline || $0 == " " || $0 == "\\t" }).joined(separator: " ") }
let redact: (String) -> String = { s in
    var v = s
    for pat in ["[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\\\.[A-Za-z]{2,}", "\\\\+?\\\\d[\\\\d\\\\s().-]{7,}\\\\d", "\\\\d{4,}"] {
        v = v.replacingOccurrences(of: pat, with: "[x]", options: .regularExpression)
    }
    return v
}
for f in files {
    guard let doc = PDFDocument(url: URL(fileURLWithPath: dir + "/" + f)) else { print("CORPUS \\(f) | UNREADABLE"); continue }
    var pages: [CallSheetHarvest.PageText] = []
    var chars = 0
    var exotic = 0
    for i in 0..<doc.pageCount {
        let t = doc.page(at: i)?.string ?? ""
        chars += t.filter { !$0.isWhitespace }.count
        exotic += t.unicodeScalars.filter { $0.value > 0x2500 }.count
        pages.append(CallSheetHarvest.PageText(index: i, text: t))
    }
    let prod = CallSheetHarvest.harvestProdCo(pages: pages)
    let ref = CallSheetHarvest.harvestJobRef(pages: pages)
    let addr = CallSheetHarvest.harvestAddress(pages: pages)
    let mail = CallSheetHarvest.harvestInvoicingEmailsCore(pages: pages)
    // Title draft: pure label scan + masthead (the plugin's own rules).
    var title = ""
    outer: for page in pages {
        for label in CallSheetTitle.titleLabels {
            for raw in page.text.components(separatedBy: "\\n") {
                let low = raw.lowercased().trimmingCharacters(in: .whitespaces)
                guard low.hasPrefix(label) else { continue }
                let v = String(raw.trimmingCharacters(in: .whitespaces).dropFirst(label.count)).trimmingCharacters(in: CallSheetTitle.titleTrimSet)
                if !v.isEmpty, !CallSheetTitle.isTitleBoilerplate(v), !CallSheetTitle.isQuotedList(v) { title = v; break outer }   // guard C mirrors the app
            }
        }
    }
    if title.isEmpty, let first = pages.first,
       let m = CallSheetTitle.mastheadCandidate(lines: first.text.components(separatedBy: "\\n")) { title = m.value }
    title = CallSheetTitle.cleanTitle(title) ?? ""    // the app cleans whatever wins; so does the draft
    // TITLE PINS ON PDFKIT (2026-09-01): the nine masthead sheets plus the
    // four the precedence ruling moved and M&S, asserted on the device's own
    // decoder. The sanitised fixtures in title-assertions.js prove the LOGIC;
    // these prove the corpus. A mismatch is printed and fails the stage.
    let titlePins: [(String, String)] = [
        ("vertical model", "Vertical Model"), ("dfs_wintersale", "Winter Sale"),
        ("amahla", "AMAHLA - A LITTLE HOPE MUSIC VIDEOS"), ("umberto", "UMBERTO GIANNINI - KNOW YOUR CURLS"),
        ("nike vision", "NIKE VISION"), ("project comet", "‘PROJECT COMET’"),
        ("nettwerk", "TENDER LP VISUALISERS"), ("teepee", "Teepee Films"),
        ("gymshark", "GYMSHARK WINTER WOMENSWEAR"),
        ("square evol", "SQUARE - EVOLVE"), ("brother_rbr", "INSIDE THE TEAM"),
        ("mcdonalds", "MCDONALDS US / FIFA MWC"), ("tda176", "CAPSULE"),
        ("m&s winter", "MARKS & SPENCER"), ("dove x merman", "CLIENT DOVE"),
    ]
    for (key, want) in titlePins where f.lowercased().contains(key) {
        print(title == want ? "TITLE-PIN-OK \\(key)" : "TITLE-PIN-RED \\(key) | expected=\\(want) got=\\(title)")
    }
    if addr != nil { addressHits += 1 } else { addressMisses.append(f) }
    print("CORPUS \\(f) | pages=\\(doc.pageCount) chars=\\(chars) exotic=\\(exotic) | prodCo=\\(prod.map { $0.how + ":" + $0.value } ?? "-") | ref=\\(ref?.value ?? "-") | addrPC=\\(addr?.postcode ?? "-") | email=\\(mail.primary != nil ? "found" : "-")")
    draft += "sheet: \\(f)\\n"
    draft += "title: \\(clean(title))\\n"
    draft += "company: \\(clean(prod?.value ?? ""))\\n"
    draft += "job ref: \\(ref.map { clean($0.value) } ?? "(none)")\\n"
    draft += "invoice email: \\(clean(mail.primary?.token ?? ""))\\n"
    draft += "cc email: \\(mail.cc.map { clean($0.token) } ?? "(none)")\\n"
    draft += "postcode: \\(clean(addr?.postcode ?? ""))\\n"
    draft += "notes: draft - confirm every line against the sheet\\n\\n"
    harvested[clean(f)] = [
        "title": clean(title), "company": clean(prod?.value ?? ""), "job ref": clean(ref?.value ?? ""),
        "invoice email": clean(mail.primary?.token ?? ""), "cc email": clean(mail.cc?.token ?? ""),
        "postcode": clean(addr?.postcode ?? ""),
    ]
}
print("ADDRESS-REACH \\(addressHits)/\\(files.count)")
if !addressMisses.isEmpty { print("ADDRESS-MISSES " + addressMisses.joined(separator: " | ")) }
try? draft.write(toFile: dir + "/expected.draft.txt", atomically: true, encoding: .utf8)
print("DRAFT-WRITTEN \\(dir)/expected.draft.txt")

// ── PHASE TWO (commit 4): assert against the founder-reviewed expected.txt ──
// The draft above is REWRITTEN on every run; expected.txt is the founder's
// copy and is never written by this harness. A block whose notes line still
// begins with "draft" is UNREVIEWED and is counted, not asserted - so the
// file can be reviewed incrementally without a half-done file asserting on
// lines nobody has confirmed. Values are never printed raw: mismatches go
// through the same redaction as the corpus lines (the corpus is private data
// outside the repo, but the gate log is not the place for it either).
let expectedPath = dir + "/expected.txt"
if let raw = try? String(contentsOfFile: expectedPath, encoding: .utf8) {
    func norm(_ field: String, _ v: String) -> String {
        let t = v.trimmingCharacters(in: .whitespacesAndNewlines)
        if t.isEmpty || t == "(none)" { return "" }
        switch field {
        case "postcode": return t.replacingOccurrences(of: " ", with: "").uppercased()
        case "invoice email", "cc email": return t.lowercased()
        default: return t.split(separator: " ").joined(separator: " ")
        }
    }
    var asserted = 0, unreviewed = 0, red = 0, unknown = 0
    var block: [String: String] = [:]
    func flush() {
        guard let sheet = block["sheet"] else { block = [:]; return }
        defer { block = [:] }
        let notes = (block["notes"] ?? "").lowercased()
        if notes.hasPrefix("draft") { unreviewed += 1; return }
        guard let got = harvested[clean(sheet)] else { unknown += 1; print("EXPECT-UNKNOWN-SHEET \\(sheet)"); return }
        asserted += 1
        var bad: [String] = []
        for field in ["title", "company", "job ref", "invoice email", "cc email", "postcode"] {
            let want = norm(field, block[field] ?? "")
            let have = norm(field, got[field] ?? "")
            if want != have { bad.append("\\(field): expected=\\(redact(want.isEmpty ? "(nothing)" : want)) got=\\(redact(have.isEmpty ? "(nothing)" : have))") }
        }
        if bad.isEmpty { print("EXPECT-OK \\(sheet)") } else { red += 1; print("EXPECT-RED \\(sheet) | " + bad.joined(separator: " | ")) }
    }
    for line in raw.components(separatedBy: "\\n") {
        if line.trimmingCharacters(in: .whitespaces).isEmpty { continue }   // blank lines are decoration, not delimiters
        guard let colon = line.firstIndex(of: ":") else { continue }
        let key = String(line[..<colon]).trimmingCharacters(in: .whitespaces)
        let val = String(line[line.index(after: colon)...]).trimmingCharacters(in: .whitespaces)
        if key == "sheet" && block["sheet"] != nil { flush() }
        block[key] = val
    }
    flush()
    print("EXPECT-SUMMARY asserted=\\(asserted) ok=\\(asserted - red) red=\\(red) unreviewed=\\(unreviewed) unknownSheet=\\(unknown)")
} else {
    print("EXPECT-ABSENT \\(expectedPath)")
}
`;
}

function structuralChecks() {
  const hv = fs.readFileSync(HARVEST, 'utf8');
  const plugin = fs.readFileSync(PLUGIN, 'utf8');
  const checks = [
    ['HS1 EVOLVED (commit 2 ends inertness by design): the harvests have EXACTLY the three wired call sites in run() - one per field, all inside the applyPatternHit block - and invoicingBlocks is never called from the plugin (block logic stays pure-side)',
      (plugin.match(/CallSheetHarvest\.harvestProdCo\(/g) || []).length === 1
      && (plugin.match(/CallSheetHarvest\.harvestJobRef\(/g) || []).length === 1
      && (plugin.match(/CallSheetHarvest\.harvestAddress\(/g) || []).length === 1
      && !/invoicingBlocks/.test(plugin)],
    ['HS2 the relocations are forwarders, not copies: typealias EmailHit, the emails adapter, and the three helper forwards all delegate to CallSheetHarvest; no duplicate scoring body remains in the plugin',
      /typealias EmailHit = CallSheetHarvest\.EmailHit/.test(plugin)
      && /CallSheetHarvest\.harvestInvoicingEmailsCore\(pages: pages\.map/.test(plugin)
      && /CallSheetHarvest\.extractEmails\(s\)/.test(plugin)
      && /CallSheetHarvest\.isPlausibleEmail\(s\)/.test(plugin)
      && /CallSheetHarvest\.containsUKPostcode\(s\)/.test(plugin)
      && !/if positive == 0 \{ continue \}/.test(plugin)],
    ['HS3 the measured dead weight stays OUT of the new lexicons: the payee/section/HMRC/ref pattern declarations contain no remittance or pay-to, while the RELOCATED email list keeps both verbatim (inert this commit; the drop is commit 2)',
      (() => {
        const decl = (name) => (hv.match(new RegExp('static let ' + name + ' =[\\s\\S]*?(?=\\n\\n|\\n    \\/\\/\\/)')) || [''])[0];
        const newLex = ['payeeVerbPattern', 'sectionHeaderPattern', 'hmrcPattern', 'refLabelPattern'].map(decl).join(' ');
        return !/remittance|pay\s+to/.test(newLex)
          && /invoiceIntentKeywords = \[[^\]]*"remittance"[^\]]*"pay to"[^\]]*\]/.test(hv);
      })()],
    ['HS4 the CO-ORDINATOR guard is a negative lookahead on the label itself',
      /\(\?!\\\\s\*-\?\\\\s\*ordinator\)/.test(hv)],
    ['HS5 CallSheetHarvest imports Foundation ONLY (pure - the swiftc harness depends on it)',
      (hv.match(/^import\s+\w+/gm) || []).join(',') === 'import Foundation'],
    ['HS6 COMMIT-2 WIRING: run() feeds all three harvests through applyPatternHit, which routes EVERY fill decision through the pure resolveField (the byte-identity seam) and presents pattern hits through the same snippet/crop machinery; the email/title paths are untouched by the block',
      /applyPatternHit\("prodCo", CallSheetHarvest\.harvestProdCo\(pages: harvestPages\)\)/.test(plugin)
      && /applyPatternHit\("jobReference", CallSheetHarvest\.harvestJobRef\(pages: harvestPages\)\)/.test(plugin)
      && /applyPatternHit\("invoicingAddress", CallSheetHarvest\.Hit\(value: addr\.value/.test(plugin)
      && /guard CallSheetHarvest\.resolveField\(modelState: modelState, hasPatternHit: true\) == \.pattern else \{ return \}/.test(plugin)
      && /\["value": hit\.value, "state": "verified", "page": hit\.pageIndex \+ 1\]/.test(plugin)],
    ['HS7 COMMIT 3 HAS UNGATED IT: extract() and getPageRuns carry NO availability guard, the pipeline namespace is no longer @available-scoped, and the annotation sits on exactly the four model-touching members instead. This clause is the inverse of the one it replaces - commit 2 asserted the guards were still present, precisely so the ungating could not happen as a side effect',
      // extract() rejects on neither iOS version nor model availability.
      !/guard #available\(iOS 26\.0, \*\) else \{ call\.reject\("Call-sheet import needs iOS 26/.test(plugin)
      && !/guard SystemLanguageModel\.default\.availability == \.available else \{/.test(plugin)
      // the namespace is open...
      && /\nenum CallSheetPipeline \{/.test(plugin)
      && !/@available\(iOS 26\.0, \*\)\nenum CallSheetPipeline \{/.test(plugin)
      // ...and the gate moved onto the four members, not nowhere.
      && /@available\(iOS 26\.0, \*\)\n    static func modelCandidates\(/.test(plugin)
      && /@available\(iOS 26\.0, \*\)\n    static func generate\(on text: String\)/.test(plugin)
      && /@available\(iOS 26\.0, \*\)\n    static func mergeFirstNonNil\(/.test(plugin)
      && /@available\(iOS 26\.0, \*\)\n    static func fieldValues\(/.test(plugin)],

    ['HS7b THE MODEL IS FOLDED IN, NOT ASSUMED: run() executes the pattern work unconditionally and asks for model candidates only behind BOTH the OS check and the availability check, defaulting to an empty candidate set. An ungating that simply deleted the guards would call the model on a device that has none',
      /var candidates: \[String: \[Candidate\]\] = \[:\]\n        if #available\(iOS 26\.0, \*\), SystemLanguageModel\.default\.availability == \.available \{/.test(plugin)
      && /let plan = CallSheetHarvest\.modelPagePlan\(pageCharCounts: pages\.map \{ \$0\.text\.count \}, invoicPages: invoicSet\)/.test(plugin)
      && /candidates = await modelCandidates\(selected: modelPages, invoicSet: invoicSet, deadline: Date\(\)\.addingTimeInterval\(12\)\)/.test(plugin)
      && /if Date\(\) > deadline \{ break \}/.test(plugin)
      // the pattern harvests are NOT inside that conditional
      && /applyPatternHit\("prodCo"/.test(plugin)
      && plugin.indexOf('applyPatternHit("prodCo"') > plugin.indexOf('candidates = await modelCandidates(')],

    ['HS7d AN EMPTY CANDIDATE SET IS AN ORDINARY STATE, NOT A SPECIAL CASE: run() has exactly ONE exit, and nothing tests candidates for emptiness. An early return when the model found nothing would skip the pattern harvests entirely - the reader would be ungated on paper while an iPhone 12 still got nothing, which is the exact failure this commit exists to prevent. Found by the MG4 mutation, which HS7b could not see because it only checked ordering',
      (() => {
        const runStart = plugin.indexOf('static func run(paths: [String]) async throws -> [String: Any] {');
        const runEnd = plugin.indexOf('\n    @available(iOS 26.0, *)\n    static func modelCandidates(');
        if (runStart < 0 || runEnd < 0 || runEnd < runStart) return false;
        const body = plugin.slice(runStart, runEnd);
        return (body.match(/return \[\n            "fields": fields,/g) || []).length === 1
          && !/candidates\.isEmpty/.test(body)
          && !/candidates\.count == 0/.test(body);
      })()],

    ['HS11 RULING 1 IS WORDED AS RULED AND SCOPED TO THE ELIGIBLE-BUT-OFF DEVICE: the hint appears only for reason === appleIntelligenceNotEnabled - never for deviceNotEligible or osTooOld, who have nothing to switch on - and its text is the founder\'s sentence, which deliberately does not imply the reader is degraded without the model',
      (() => {
        const html = fs.readFileSync(APP_HTML, 'utf8');
        const i = html.indexOf("{avail.reason === 'appleIntelligenceNotEnabled' && (");
        if (i < 0) return false;
        const after = html.slice(i, i + 400);
        return /Apple Intelligence is off\. The reader works without it and reads most sheets the same way\./.test(after)
          && (html.match(/Apple Intelligence is off\. The reader works without it/g) || []).length === 1
          && !/deviceNotEligible' && \(/.test(html)
          && !/Apple Intelligence can help with unusual sheets/.test(html);
      })()],

    ['HS12 RULING 2 IS WORDED AS RULED AND FIRES ONLY WHEN EVERY INVOICING FIELD IS MISSING: title is excluded from the test (it is not an invoicing detail), every other field must be missing AND untouched, and the sentence is the founder\'s. A sheet that found some fields already reads as working; a caveat there would be noise',
      (() => {
        const html = fs.readFileSync(APP_HTML, 'utf8');
        return /FIELDS\.filter\(f => f\.key !== 'title'\)\.every\(f => fieldState\(f\.key\)\.state === 'missing' && edits\[f\.key\] === undefined\)/.test(html)
          && /This sheet doesn't carry invoicing details\. Plenty don't - tap any row to fill it in yourself\./.test(html)
          && (html.match(/This sheet doesn't carry invoicing details/g) || []).length === 1
          // it renders ABOVE the rows, where the dashed screen would otherwise start
          && html.indexOf("This sheet doesn't carry invoicing details") < html.indexOf('{FIELDS.map(reviewRow)}');
      })()],

    ['HS13 PHASE TWO NEVER WRITES expected.txt, NEVER ASSERTS AN UNREVIEWED BLOCK, AND NEVER SKIPS QUIETLY: the harness writes only the draft; a block whose notes line still begins "draft" is counted and skipped; an absent expected.txt prints the loud SKIPPED line; and expectation mismatches gate the exit code. Without the last clause the file could be wrong forever behind a green stage',
      (() => {
        const me = fs.readFileSync(__filename, 'utf8');
        // SELF-MATCH GUARD: this clause reads its own source, so any literal
        // it tests for is present in the file by virtue of the test itself.
        // The two clauses below therefore count occurrences and require MORE
        // than the one this check contributes, or match on syntax the check
        // does not reproduce (`if (` ... `) {`). Found by the MH7 and MH8
        // mutations, which removed the real lines and left this green.
        const skipLine = 'EXPECTATIONS NOT PRESENT' + ' - phase two SKIPPED';
        return /if notes\.hasPrefix\("draft"\) \{ unreviewed \+= 1; return \}/.test(me)
          && !/write\(toFile: dir \+ "\/expected\.txt"/.test(me)
          && (me.match(/write\(toFile: dir \+ "\/expected\.draft\.txt"/g) || []).length === 1
          && me.split(skipLine).length - 1 >= 1
          && /if \(reds === 0 && execOk && structBad === 0 && expectRed === 0\) \{/.test(me)
          && /expectRed = Number\(m\[3\]\) \+ Number\(m\[5\]\);/.test(me);
      })()],

    ['HS7c THE BYTE-IDENTITY PROMISE SURVIVES THE GATE MOVE: resolveField is still the only thing that decides prodCo/jobReference/invoicingAddress, and it is still consulted with the model state, so a VERIFIED model value is never displaced by a pattern. Moving where the model runs must not change what wins when it does run',
      /let modelState = \(perField\[key\] as\? \[String: Any\]\)\?\["state"\] as\? String/.test(plugin)
      && /guard CallSheetHarvest\.resolveField\(modelState: modelState, hasPatternHit: true\) == \.pattern else \{ return \}/.test(plugin)
      // and the model loop reached perField by the same route as before:
      // modelCandidates feeds `candidates`, which pick() still consumes.
      && /let winner = pick\(key: key, from: candidates\[key\] \?\? \[\]\)/.test(plugin)],

    ['HS14 run() APPLIES THE CLEANING TO THE WINNING VALUE: the title and the reference are passed through CallSheetTitle.cleanTitle / CallSheetHarvest.cleanRef before the payload is built, and a title that cleans to nothing becomes missing. The CL pins prove the functions; only this proves they are wired - the MI13 mutation disconnected them and every CL pin stayed green',
      /if let t = fields\["title"\] as\? String \{\n            if let cleaned = CallSheetTitle\.cleanTitle\(t\) \{/.test(plugin)
      && /fields\["title"\] = nil\n                perField\["title"\] = \["state": "missing"\]\n            \}\n        \}/.test(plugin)
      && /if let r = fields\["jobReference"\] as\? String \{\n            let cleaned = CallSheetHarvest\.cleanRef\(r\)/.test(plugin)
      && plugin.indexOf('CallSheetTitle.cleanTitle(t)') < plugin.indexOf('return [\n            "fields": fields,')
      && plugin.indexOf('CallSheetTitle.cleanTitle(t)') > plugin.indexOf('applyPatternHit("invoicingAddress"')],

    ['HS8 THE JS GATE IS NATIVE PRESENCE, NOT MODEL AVAILABILITY: the reader surface renders wherever the plugin has answered, and no longer requires avail.available or an appleIntelligenceNotEnabled/modelNotReady reason. Leaving the Swift ungated while the JS still hid the entry point would ungate nothing a user could see',
      (() => {
        const html = fs.readFileSync(APP_HTML, 'utf8');
        return /const visible = IS_NATIVE && !!avail;/.test(html)
          && !/const visible = IS_NATIVE && avail && \(avail\.available/.test(html)
          // the auto-import effect waits for an answer, not for a model
          && /if \(!avail\) return;   \/\/ wait for the plugin's answer, not for a model/.test(html)
          // and the share-in "new shoot" path no longer diverts to the plain flow
          && !/Model unavailable: honour the tap with the plain new-shoot flow/.test(html);
      })()],

    ['HS9 THE ENTRY POINT IS UNCONDITIONAL, by structure: between CallSheetImport\'s return and its Import button there is no reference to `avail` at all, and the file contains zero `avail.available` reads. (The earlier form of this clause asserted a phrase was absent and passed only because a code comment happened to wrap that phrase across a line - a pin that passes by accident is not a pin.)',
      (() => {
        const html = fs.readFileSync(APP_HTML, 'utf8');
        const fn = html.indexOf('function CallSheetImport(');
        // Anchor on the JSX itself, not on the first `return (` in the
        // component - that matched an effect's cleanup and made "between"
        // span the whole body (six legitimate avail.reason reads).
        const ret = html.indexOf('{/* ALWAYS SHOWN (commit 3).', fn);
        const btn = html.indexOf("onClick={() => setChooser(true)}", ret);
        if (fn < 0 || ret < 0 || btn < 0) return false;
        const between = html.slice(ret, btn);
        // The only `avail` use permitted before the button is none at all: the
        // ruling-1 hint reads avail.reason, but it FOLLOWS the button. So the
        // button precedes the first avail.reason read, and nothing else reads
        // avail anywhere in the component's JSX. Neither test can be satisfied
        // by a comment.
        const firstReason = html.indexOf('avail.reason', ret);
        return !/\bavail\.(?!reason)/.test(between)
          && firstReason > btn
          && (html.match(/avail\.available/g) || []).length === 0
          && /Import from call sheet/.test(html.slice(btn, btn + 300));
      })()],

    ['HS10 THE TWO SUPERSEDED LINES ARE DELETED (rulings 3 and 4): the tutorial card no longer claims the reader "Needs iOS 26 and Apple Intelligence", and the share-in chooser no longer says it "isn\'t available on this device". Both became false with this commit, and a false capability claim in onboarding is worse than none',
      (() => {
        const html = fs.readFileSync(APP_HTML, 'utf8');
        return !/Needs iOS 26 and Apple Intelligence/.test(html)
          && !/isn't available on this device - choosing a shoot just opens it/.test(html)
          // the card itself survives - the ruling removed a sentence, not the card
          && /tap share and pick TimeMachine from the share sheet/.test(html);
      })()],
  ];
  let bad = 0;
  for (const [name, ok] of checks) { console.log(`  ${ok ? '✓' : '✗'} ${name}`); if (!ok) bad++; }
  // Counted, never hardcoded: the summary said "7 structural" through two
  // commits that added clauses, which quietly understated the suite.
  return { bad, count: checks.length };
}

function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-harvest-'));
  const fixturePath = path.join(tmp, 'cases.json');
  fs.writeFileSync(fixturePath, JSON.stringify(CASES.map(c => ({ id: c.id, kind: c.kind, pages: c.pages || null, input: c.input || null, expect: c.expect }))));
  fs.writeFileSync(path.join(tmp, 'main.swift'), generateMain(fixturePath));
  const bin = path.join(tmp, 'harvesttest');
  try {
    cp.execSync(`swiftc -O "${HARVEST}" "${TITLE}" "${path.join(tmp, 'main.swift')}" -o "${bin}"`, { stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    console.error('❌ harvest pins: swiftc compile FAILED\n' + String(e.stderr || e.message));
    process.exit(1);
  }
  let out = '';
  let execOk = true;
  try { out = cp.execSync(`"${bin}" "${fixturePath}" fixtures`, { encoding: 'utf8' }); }
  catch (e) { out = String(e.stdout || ''); execOk = false; }
  for (const l of out.split('\n').filter(l => l.startsWith('RED'))) console.log('  ✗ ' + l.slice(4));
  const okCount = out.split('\n').filter(l => l.startsWith('OK ')).length;
  const { bad: structBad, count: structCount } = structuralChecks();
  const reds = out.split('\n').filter(l => l.startsWith('RED')).length;

  // ── CORPUS mode: loud-skip, address-reach measurement, draft generator ──
  let corpusNote = '';
  let expectRed = 0;
  if (!fs.existsSync(CORPUS) || !fs.readdirSync(CORPUS).some(f => f.toLowerCase().endsWith('.pdf'))) {
    console.log('⚠ CALL-SHEET FIXTURES NOT PRESENT at ' + CORPUS);
    console.log('⚠ harvest corpus measurement SKIPPED - the ADDRESS-REACH gate for commit 2 cannot run on this machine');
    corpusNote = 'corpus SKIPPED';
  } else {
    let cout = '';
    try { cout = cp.execSync(`"${bin}" "${CORPUS}" corpus`, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }); }
    catch (e) { cout = String(e.stdout || ''); }
    process.stdout.write(cout.split('\n').filter(l => l.startsWith('CORPUS') || l.startsWith('ADDRESS') || l.startsWith('DRAFT')).map(l => '  ' + l + '\n').join(''));
    const reach = (cout.match(/ADDRESS-REACH (\d+)\/(\d+)/) || []);
    corpusNote = reach.length ? `address-reach ${reach[1]}/${reach[2]}` : 'corpus ran';
    // The nine masthead fixtures moved to PDFKit (founder-ruled 2026-09-01),
    // plus the precedence set. Red here means the device would disagree with
    // a sanitised fixture that still passes - the Comet finding.
    const titleReds = cout.split('\n').filter(l => l.startsWith('TITLE-PIN-RED'));
    const titleOks = cout.split('\n').filter(l => l.startsWith('TITLE-PIN-OK')).length;
    for (const l of titleReds) console.log('  ✗ ' + l);
    expectRed += titleReds.length;
    corpusNote += ` · title-pins ${titleOks}/${titleOks + titleReds.length} on PDFKit`;

    // PHASE TWO. Absent expected.txt is a LOUD skip, never a quiet pass: the
    // founder has to review the draft before this can assert anything, and
    // the gate must keep saying so until he has.
    const lines = cout.split('\n');
    if (lines.some(l => l.startsWith('EXPECT-ABSENT'))) {
      console.log('⚠ EXPECTATIONS NOT PRESENT - phase two SKIPPED. Review expected.draft.txt, save it as expected.txt in the same folder, and correct it there. The draft is rewritten every run; expected.txt never is.');
      corpusNote += ' · expectations SKIPPED';
    } else {
      for (const l of lines.filter(l => l.startsWith('EXPECT-RED') || l.startsWith('EXPECT-UNKNOWN-SHEET'))) console.log('  ✗ ' + l);
      const sum = (lines.find(l => l.startsWith('EXPECT-SUMMARY')) || '');
      const m = sum.match(/asserted=(\d+) ok=(\d+) red=(\d+) unreviewed=(\d+) unknownSheet=(\d+)/);
      if (!m) { console.log('  ✗ EXPECT-SUMMARY line missing from the harness output'); expectRed = 1; }
      else {
        expectRed = Number(m[3]) + Number(m[5]);
        if (Number(m[4]) > 0) console.log(`⚠ ${m[4]} block(s) in expected.txt still say "draft" in their notes line and were NOT asserted - review them to bring them into the gate.`);
        corpusNote += ` · expectations ${m[2]}/${m[1]} ok, ${m[4]} unreviewed`;
      }
    }
  }

  const total = CASES.length + structCount;
  if (reds === 0 && execOk && structBad === 0 && expectRed === 0) {
    console.log(`✅ harvest pins: ${total} assertions (${okCount} executed through the real Swift, ${structCount} structural) · ${corpusNote}`);
    process.exit(0);
  }
  console.log(`❌ harvest pins: ${reds + structBad + expectRed} failure(s) of ${total}${expectRed ? ` (${expectRed} expectation mismatch${expectRed === 1 ? '' : 'es'})` : ''}`);
  process.exit(1);
}

main();
