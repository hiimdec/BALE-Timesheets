#!/usr/bin/env node
'use strict';
/*
 * Call-sheet TITLE pins (founder-approved, 2026-08-31) — the first pins this
 * surface has ever had. The logic under test is CallSheetTitleLogic.swift
 * (pure Foundation, the TimeMachineTimesParser precedent): this harness
 * swiftc-compiles it with a generated test main and EXECUTES the real Swift
 * against committed fixtures, so the strip rules are proven, not described.
 *
 * FIXTURES: sanitized from the 20-sheet real corpus — company and job names
 * only, NO personal data (the one real masthead carrying a person's name
 * uses the placeholder "ALEX EXAMPLE", preserving the shape that matters).
 *
 * VACUITY, stated plainly:
 *  - The masthead/strip pins execute the real logic — they genuinely redden
 *    when the stripper breaks.
 *  - The ORDER fixtures alone could pass a chain that works for the wrong
 *    reason (whole-segment classification makes several wrong orders yield
 *    the same result) — the STRUCTURAL order clause is what pins the order
 *    itself, and the MR4 mutation demonstrates exactly this split.
 *  - The label-precedence pin is STRUCTURAL ONLY (the full pipeline is not
 *    executed here); the label VALUES are executed against the relocated
 *    boilerplate rule, but run()'s wiring is pinned by text.
 *  - Fixture lines are this suite's own extraction of the corpus; PDFKit's
 *    line splitting on device can differ — the pins prove the LOGIC, and
 *    device verify remains the end-to-end word, as always.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const LOGIC = path.join(ROOT, 'ios', 'App', 'App', 'CallSheetTitleLogic.swift');
const PLUGIN = path.join(ROOT, 'ios', 'App', 'App', 'CallSheetPlugin.swift');

// kind: "masthead" runs mastheadCandidate(lines); "strip" runs
// stripTitleBoilerplate(input) (expect null via "<NIL>").
const CASES = [
  // ── T1: the NINE masthead sheets of the real corpus, sanitized ──
  { id: 'T1-vertical', kind: 'masthead', lines: ['CALL SHEET', 'Vertical Model', '25/11/25'], expect: 'Vertical Model' },
  { id: 'T1-dfs (leading-label line preferred)', kind: 'masthead', lines: ['CALL SHEET', 'PRODUCTION TITLE Winter Sale', 'PRODUCTION JOB NUMBER DFS-2025347'], expect: 'Winter Sale' },
  { id: 'T1-amahla (hyphen is not a separator)', kind: 'masthead', lines: ['AMAHLA - A LITTLE HOPE MUSIC VIDEOS', 'Friday 14th August 2026'], expect: 'AMAHLA - A LITTLE HOPE MUSIC VIDEOS' },
  { id: 'T1-umberto (title inside the boilerplate line era survives on its own line)', kind: 'masthead', lines: ['CALL SHEET', 'UMBERTO GIANNINI - KNOW YOUR CURLS'], expect: 'UMBERTO GIANNINI - KNOW YOUR CURLS' },
  { id: 'T1-nike', kind: 'masthead', lines: ['NIKE VISION', 'CALL SHEET', '8th DECEMBER 2025'], expect: 'NIKE VISION' },
  { id: 'T1-comet', kind: 'masthead', lines: ['‘PROJECT COMET’', 'SHOOT CALL SHEET - FRIDAY 8TH AUGUST 2025'], expect: '‘PROJECT COMET’' },
  { id: 'T1-nettwerk (sanitized; the load-bearing preference)', kind: 'masthead', lines: ['SHOOT DAY CALL SHEET | NETTWERK | ALEX EXAMPLE | WEDNESDAY 27th AUGUST 2025', 'TITLE TENDER LP VISUALISERS'], expect: 'TENDER LP VISUALISERS' },
  { id: 'T1-teepee', kind: 'masthead', lines: ['Teepee Films', 'Netil Corner'], expect: 'Teepee Films' },
  { id: 'T1-gymshark (trailing DAY 1 stripped from the title line)', kind: 'masthead', lines: ['GYMSHARK WINTER WOMENSWEAR - DAY 1', 'TUESDAY 1 SEPTEMBER 2026'], expect: 'GYMSHARK WINTER WOMENSWEAR' },
  // The McDonald's SHAPE (its sheet is label-path in the app; the masthead
  // line is the strip stress case): title + fused CALLSHEET + date + DAY N OF N.
  { id: 'T1x-mcdonalds-shape', kind: 'masthead', lines: ['TH', 'MCDONALD’S CALLSHEET | THURSDAY 4 DECEMBER 2025 | DAY 2 OF 2', 'IMPORTANT NOTE!!!'], expect: 'MCDONALD’S' },

  // ── T3: one-word CALLSHEET (the Bank-of-America live bug) ──
  { id: 'T3-callsheet-word-alone', kind: 'strip', input: 'CALLSHEET', expect: '<NIL>' },
  { id: 'T3-callsheet-word-stripped', kind: 'masthead', lines: ['CALLSHEET', 'NEVER ALONE'], expect: 'NEVER ALONE' },

  // ── T4: the stop-list — job vocabulary is never promoted ──
  { id: 'T4-shoot', kind: 'strip', input: 'SHOOT', expect: '<NIL>' },
  { id: 'T4-producer', kind: 'strip', input: 'PRODUCER:', expect: '<NIL>' },
  { id: 'T4-important-note', kind: 'strip', input: 'IMPORTANT NOTE!!!', expect: '<NIL>' },
  { id: 'T4-masthead-skips-stoplist-line', kind: 'masthead', lines: ['IMPORTANT NOTE!!!', 'ATLAS RISING'], expect: 'ATLAS RISING' },

  // ── DN1: every day-numbering form MEASURED in the corpus is stripped ──
  { id: 'DN1-whole-segment DAY N OF N (4/20 sheets)', kind: 'strip', input: 'ATLAS RISING | DAY 2 OF 2', expect: 'ATLAS RISING' },
  { id: 'DN1-trailing DAY N (8/20 sheets)', kind: 'strip', input: 'SILK ROAD - DAY 3', expect: 'SILK ROAD' },
  { id: 'DN1-leading DAY N: prefix (2/20 sheets)', kind: 'strip', input: 'DAY 1: WINTER SALE', expect: 'WINTER SALE' },
  { id: 'DN1-SHOOT DAY N (4/20 sheets)', kind: 'strip', input: 'SHOOT DAY 2 | ATLAS RISING', expect: 'ATLAS RISING' },
  { id: 'DN1-bare N OF N as its own segment (4/20 sheets)', kind: 'strip', input: 'ATLAS RISING | 2 OF 2', expect: 'ATLAS RISING' },
  // INTERIOR day forms revealed by deletion — both are corpus-real lines
  // (Square, Walkers): the edge rules can't see the form until the sheet
  // words and dates are gone; the post-clean re-classification catches it.
  { id: 'DN1-interior-after-clean (Square shape)', kind: 'strip', input: 'CALLSHEET DAY 3 OF 3 7/11/25', expect: '<NIL>' },
  { id: 'DN1-interior-after-clean (Walkers shape)', kind: 'strip', input: 'CALL SHEET SHOOT DAY 6 OF 7 TUESDAY 2 DECEMBER', expect: '<NIL>' },

  // ── DN2: the pin that matters MORE — real titles survive intact.
  //    Day numbering is ANCHORED (whole segment / segment edge); an
  //    unanchored bare match would silently mangle a job title. ──
  { id: 'DN2-day-of-the-dead', kind: 'strip', input: 'CALL SHEET | DAY OF THE DEAD', expect: 'DAY OF THE DEAD' },
  { id: 'DN2-number-start-title', kind: 'strip', input: 'CALL SHEET | 3 DAYS IN MARGATE', expect: '3 DAYS IN MARGATE' },
  { id: 'DN2-interior N-of-N untouched', kind: 'strip', input: 'CALL SHEET | BEST 2 OF 3', expect: 'BEST 2 OF 3' },
  { id: 'DN2-number-start-with-trailing-day', kind: 'strip', input: '28 DAYS LATER - DAY 3', expect: '28 DAYS LATER' },

  // ── T5: the leading-label preference is load-bearing (Nettwerk shape) —
  //    the SECOND line's label value must win over the FIRST line's
  //    stripped remainder, which carries a person-shaped segment. ──
  { id: 'T5-preference-outranks-earlier-line', kind: 'masthead', lines: ['NETTWERK | ALEX EXAMPLE', 'TITLE TENDER LP VISUALISERS'], expect: 'TENDER LP VISUALISERS' },

  // ── T2 (executable half): the eleven labelled sheets' label VALUES are
  //    accepted by the relocated boilerplate rule, so harvestTitle keeps
  //    returning first and the masthead is never consulted for them. ──
  ...['REBULL RACING', 'SQUARE', 'BANK OF AMERICA', 'MCDONALDS US / FIFA MWC',
      'InRehearsal', 'WALKERS / LAYS', 'Market Rhythms 3.0', 'MARKS & SPENCER',
      'CAPSULE', 'DOVE', 'FOREVER LIVING'].map((v, i) => (
    { id: `T2-label-value-${i + 1}-accepted`, kind: 'notboiler', input: v, expect: 'OK' })),
];

function generateMain(fixturePath) {
  return `
import Foundation
struct Case: Codable { let id: String; let kind: String; let lines: [String]?; let input: String?; let expect: String }
let data = try! Data(contentsOf: URL(fileURLWithPath: "${fixturePath}"))
let cases = try! JSONDecoder().decode([Case].self, from: data)
var red = 0
for c in cases {
    var got: String
    switch c.kind {
    case "masthead":
        got = CallSheetTitle.mastheadCandidate(lines: c.lines ?? []).map { $0.value } ?? "<NIL>"
    case "strip":
        got = CallSheetTitle.stripTitleBoilerplate(c.input ?? "") ?? "<NIL>"
    case "notboiler":
        got = CallSheetTitle.isTitleBoilerplate(c.input ?? "") ? "<BOILER>" : "OK"
    default:
        got = "<UNKNOWN KIND>"
    }
    if got == c.expect { print("OK \\(c.id)") } else { red += 1; print("RED \\(c.id) | expected \\(c.expect) | got \\(got)") }
}
exit(red == 0 ? 0 : 1)
`;
}

function structuralChecks() {
  const logic = fs.readFileSync(LOGIC, 'utf8');
  const plugin = fs.readFileSync(PLUGIN, 'utf8');
  const checks = [
    ['S1 deletion ORDER: day-numbering (whole-segment + edge) runs BEFORE the sheet words — behavioural fixtures alone can pass a wrong order (see vacuity note); this clause pins the order itself',
      (() => {
        const body = (logic.match(/static func stripTitleBoilerplate[\s\S]*?\n    \}/) || [''])[0];
        const day = body.indexOf('isWholeDayNumbering(seg)');
        const edge = body.indexOf('stripEdgeDayNumbering(seg)');
        const sheet = body.indexOf('shoot\\\\s+day\\\\s+call\\\\s*sheet');
        return day > -1 && edge > -1 && sheet > -1 && day < sheet && edge < sheet;
      })()],
    ['S2 ANCHORING: whole-segment uses the broad core (^…$), the EDGE rules use the DAY-required core ($-anchored trailing, ^-anchored leading) — no bare day-form deletion exists anywhere',
      /\^\\\\s\*\\\(dayFormCore\)\[\\\\s\.:\!\]\*\$/.test(logic)
      && /\(dayEdgeForm\)\[\\\\s\.:\!\]\*\$/.test(logic)
      && /\^\\\\s\*\\\(dayEdgeForm\)\\\\s\*\[/.test(logic)
      && !/gsub\("\\\\bday/.test(logic) && !/gsub\(dayFormCore\)/.test(logic) && !/gsub\(dayEdgeForm\)/.test(logic)
      && !/replacingOccurrences\(of: dayFormCore/.test(logic) && !/replacingOccurrences\(of: dayEdgeForm/.test(logic)],
    ['S3 one-word CALLSHEET is a deletion target (call\\s*sheet — zero-or-more space)',
      /call\\\\s\*sheet/.test(logic)],
    ['S4 the plugin DELEGATES: mastheadTitle uses CallSheetTitle.mastheadCandidate; the relocated members forward verbatim',
      /CallSheetTitle\.mastheadCandidate\(lines: lines\)/.test(plugin)
      && /static let titleLabels = CallSheetTitle\.titleLabels/.test(plugin)
      && /CallSheetTitle\.isTitleBoilerplate\(s\)/.test(plugin)],
    ['S5 label PRECEDENCE unchanged: run() consults harvestTitle first and mastheadTitle only in the fallback branch (the collision fix stays out of this commit: the label list is byte-identical)',
      (() => {
        const runBody = (plugin.match(/if let labelled = harvestTitle\(pages\) \{[\s\S]*?mastheadTitle\(pages\)/) || [''])[0];
        return runBody.includes('setHarvestedTitle(labelled)')
          && /static let titleLabels = \["production:", "production title:", "client:", "title:", "project:", "job name:", "campaign:"\]/.test(logic);
      })()],
  ];
  let bad = 0;
  for (const [name, ok] of checks) {
    console.log(`  ${ok ? '✓' : '✗'} ${name}`);
    if (!ok) bad++;
  }
  return bad;
}

function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-title-'));
  const fixturePath = path.join(tmp, 'cases.json');
  fs.writeFileSync(fixturePath, JSON.stringify(CASES.map(c => ({ id: c.id, kind: c.kind, lines: c.lines || null, input: c.input || null, expect: c.expect }))));
  const mainPath = path.join(tmp, 'main.swift');
  fs.writeFileSync(mainPath, generateMain(fixturePath));
  const bin = path.join(tmp, 'titletest');
  try {
    cp.execSync(`swiftc -O "${LOGIC}" "${mainPath}" -o "${bin}"`, { stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    console.error('❌ title pins: swiftc compile FAILED\n' + String(e.stderr || e.message));
    process.exit(1);
  }
  let out = '';
  let execOk = true;
  try { out = cp.execSync(`"${bin}"`, { encoding: 'utf8' }); }
  catch (e) { out = String((e.stdout || '')); execOk = false; }
  const reds = out.split('\n').filter(l => l.startsWith('RED'));
  for (const l of reds) console.log('  ✗ ' + l.slice(4));
  const okCount = out.split('\n').filter(l => l.startsWith('OK ')).length;
  const structBad = structuralChecks();
  const total = CASES.length + 5;
  if (reds.length === 0 && execOk && structBad === 0) {
    console.log(`✅ call-sheet TITLE pins: ${total} assertions (${okCount} executed through the real Swift, 5 structural)`);
    process.exit(0);
  }
  console.log(`❌ call-sheet TITLE pins: ${reds.length + structBad} failure(s) of ${total}`);
  process.exit(1);
}

main();
