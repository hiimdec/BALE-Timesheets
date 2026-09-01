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
  // ── HV5: suffixed payee outranks an earlier person-naming payee line ──
  { id: 'HV5-suffixed-payee-beats-person', kind: 'prodco', pages: ['INVOICES TO BE ADDRESSED TO ALEX EXAMPLE AND EMAILED TO alex@example.test\nINVOICES TO BE ADDRESSED TO ALEX EXAMPLE STUDIO LTD, 16 EXAMPLE DRIVE, AB1 2CD'], expect: 'ALEX EXAMPLE STUDIO LTD' },
  // ── HV6: widened job-ref value capture ──
  { id: 'HV6-spaced-ref', kind: 'jobref', pages: ['JOB REFERENCE: CMK AW26'], expect: 'CMK AW26' },
  { id: 'HV6-quoted-ref', kind: 'jobref', pages: ['please send invoices with ref "FLP AM/PM"'], expect: 'FLP AM/PM' },
  { id: 'HV6-hash-ref', kind: 'jobref', pages: ['JOB NUMBER: BFC#0032'], expect: 'BFC#0032' },
  { id: 'HV6-sentence-stop (the Square failure)', kind: 'jobref', pages: ['INVOICES : PLEASE SEND INVOICES QUOTING JOB NUMBER 20514 WITHIN 7 DAYS.'], expect: '20514' },
  { id: 'HV6-no-ref-no-invention', kind: 'jobref', pages: ['CALL SHEET\nUNIT CALL 07:00\nLOCATION EXAMPLE STUDIOS'], expect: '<NIL>' },
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
        case "emails-core":
            let r = CallSheetHarvest.harvestInvoicingEmailsCore(pages: pt(c.pages ?? []))
            got = r.primary?.token ?? "<NIL>"
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
                if !v.isEmpty, !CallSheetTitle.isTitleBoilerplate(v) { title = v; break outer }
            }
        }
    }
    if title.isEmpty, let first = pages.first,
       let m = CallSheetTitle.mastheadCandidate(lines: first.text.components(separatedBy: "\\n")) { title = m.value }
    if addr != nil { addressHits += 1 } else { addressMisses.append(f) }
    print("CORPUS \\(f) | pages=\\(doc.pageCount) chars=\\(chars) exotic=\\(exotic) | prodCo=\\(prod.map { $0.how + ":" + $0.value } ?? "-") | ref=\\(ref?.value ?? "-") | addrPC=\\(addr?.postcode ?? "-") | email=\\(mail.primary != nil ? "found" : "-")")
    draft += "sheet: \\(f)\\n"
    draft += "title: \\(title.isEmpty ? "" : title)\\n"
    draft += "company: \\(prod?.value ?? "")\\n"
    draft += "job ref: \\(ref?.value ?? "(none)")\\n"
    draft += "invoice email: \\(mail.primary?.token ?? "")\\n"
    draft += "cc email: \\(mail.cc?.token ?? "(none)")\\n"
    draft += "postcode: \\(addr?.postcode ?? "")\\n"
    draft += "notes: draft - confirm every line against the sheet\\n\\n"
}
print("ADDRESS-REACH \\(addressHits)/\\(files.count)")
if !addressMisses.isEmpty { print("ADDRESS-MISSES " + addressMisses.joined(separator: " | ")) }
try? draft.write(toFile: dir + "/expected.draft.txt", atomically: true, encoding: .utf8)
print("DRAFT-WRITTEN \\(dir)/expected.draft.txt")
`;
}

function structuralChecks() {
  const hv = fs.readFileSync(HARVEST, 'utf8');
  const plugin = fs.readFileSync(PLUGIN, 'utf8');
  const checks = [
    ['HS1 INERT: the new harvests have ZERO call sites in the plugin this commit (harvestProdCo / harvestJobRef / harvestAddress / invoicingBlocks unreferenced) - the app cannot behave differently',
      !/harvestProdCo|harvestJobRef|harvestAddress|invoicingBlocks/.test(plugin)],
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
  ];
  let bad = 0;
  for (const [name, ok] of checks) { console.log(`  ${ok ? '✓' : '✗'} ${name}`); if (!ok) bad++; }
  return bad;
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
  const structBad = structuralChecks();
  const reds = out.split('\n').filter(l => l.startsWith('RED')).length;

  // ── CORPUS mode: loud-skip, address-reach measurement, draft generator ──
  let corpusNote = '';
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
  }

  const total = CASES.length + 5;
  if (reds === 0 && execOk && structBad === 0) {
    console.log(`✅ harvest pins: ${total} assertions (${okCount} executed through the real Swift, 5 structural) · ${corpusNote}`);
    process.exit(0);
  }
  console.log(`❌ harvest pins: ${reds + structBad} failure(s) of ${total}`);
  process.exit(1);
}

main();
