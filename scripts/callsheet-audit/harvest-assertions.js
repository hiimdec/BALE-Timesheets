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
 * THE REFERENCE GATE (founder-ruled 2026-09-07, the Gymshark "DAY 1"): the
 * RG cases execute refHasLabelContext through the same match-back shape the
 * pipeline uses (case-insensitive find, then the gate judges the span), the
 * RD cases execute the whole-value day-numbering reject, and HS18-HS20 pin
 * the wiring: the verify case, the candidate-loop drop, the cleaning reject.
 * HS21 pins the Inbox clearance in ingestSharedFile (a structural pin - the
 * plugin imports Capacitor and cannot compile here; the behaviour is a
 * device-walk item).
 *
 * THE COMPANY GATE (founder-ruled 2026-09-07, measured 14 of 20 wrong
 * unguarded on the Mac's model): the PC cases execute modelCompanyCounts
 * (payee or label line, company shape), the RK cases execute the rank
 * (payee above label), and HS22-HS24 pin the wiring: the verify case, the
 * loop drop with the rank on the candidate, the pick order.
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
  // ── 2026-09-02 round: the four shape fixes, the labelled cell, the block anchor ──
  { id: 'R2a-digit-glued-word-is-an-artefact (Amahla)', kind: 'prodco', pages: ['INVOICE INFORMATION\nPlease Address invoices to: Please email invoices to: x@y.com\nc/o 7Wallace Music Limited'], expect: 'Wallace Music Limited' },
  { id: 'R2b-UK-production-company-label-suffixless', kind: 'prodco', pages: ['UK PRODUCTION COMPANY: KNUCKLEHEAD x EPOCH 28 Cowper Street, London, EC2A 4AS'], expect: 'KNUCKLEHEAD x EPOCH' },
  { id: 'R2c-the-invoicing-block-names-the-payee-and-outranks-the-header (Bank of America ruling)', kind: 'prodco', pages: ['UK PRODUCTION COMPANY: KNUCKLEHEAD x EPOCH 28 Cowper Street, London, EC2A 4AS', 'INVOICES ALL INVOICES TO BE EMAILED WITHIN 7 DAYS OF SHOOT TO:\nEMAIL: a@b.com\nCOMPANY ADDRESS: Knucklehead, 28 Cowper Street, London, EC2A 4AS\nJOB REFERENCE: SERV56'], expect: 'Knucklehead' },
  { id: 'R2c2-a-company-address-line-OUTSIDE-a-block-does-not-fire', kind: 'prodco', pages: ['CREW LIST\nCOMPANY ADDRESS: Somewhere, 1 Road\nGAFFER Someone'], expect: '<NIL>' },
  { id: 'R2g-labelled-cell-trusted-on-OCR-text (InRehearsal)', kind: 'prodco-relaxed', pages: ['Production Company:\nThe Visuals Team\nClient: InRehearsal'], expect: 'The Visuals Team' },
  { id: 'R2g2-the-same-cell-is-REFUSED-on-the-layer', kind: 'prodco', pages: ['Production Company:\nThe Visuals Team\nClient: InRehearsal'], expect: '<NIL>' },
  { id: 'R2g3-a-field-label-line-is-never-a-cell (Comet: CLIENT AUDIBLE)', kind: 'prodco-relaxed', pages: ['PRODUCTION COMPANY CENTRAL CHAMBERS 227 LONDON ROAD, HADLEIGH, BENFLEET,\nESSEX, SS7 2RF\nCLIENT AUDIBLE\nPOTTERMORE'], expect: '<NIL>' },
  { id: 'R2g4-a-damaged-postcode-is-never-a-cell (SUSSEX BN NR)', kind: 'prodco-relaxed', pages: ['Production Company:\nSUSSEX BN NR\nsomething'], expect: '<NIL>' },
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
  // ── RG (founder-ruled 2026-09-07): a model reference counts only where a reference belongs ──
  { id: 'RG1-the-Gymshark-masthead-day-is-not-a-reference', kind: 'ref-context', pages: ['GYMSHARK WINTER WOMENSWEAR - DAY 1\nTUESDAY 1 SEPTEMBER 2026\nCALL 0700'], input: 'day 1', expect: 'false' },
  { id: 'RG2-a-label-on-the-line-counts', kind: 'ref-context', pages: ['CREW CALL 0700\nJOB NUMBER: 9627\nUNIT BASE'], input: '9627', expect: 'true' },
  { id: 'RG3-inside-an-anchored-block-counts-without-a-label', kind: 'ref-context', pages: ['CREW LIST\nINVOICING\nplease quote SERV56 on every invoice\nPAYMENT 30 DAYS'], input: 'SERV56', expect: 'true' },
  { id: 'RG4-a-label-on-the-previous-line-only-does-not-count (same line or block, as ruled)', kind: 'ref-context', pages: ['JOB NUMBER\nNU684\nUNIT BASE'], input: 'NU684', expect: 'false' },
  { id: 'RG5-beyond-the-block-window-does-not-count', kind: 'ref-context', pages: ['INVOICING\n1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n11\n12\nBFC#0032'], input: 'BFC#0032', expect: 'false' },
  { id: 'RG6-quote-on-invoice-is-a-label (case-insensitive find, like match-back)', kind: 'ref-context', pages: ['CATERING\nQUOTE ON INVOICE: BFC#0032\nLOCATION'], input: 'bfc#0032', expect: 'true' },
  // ── RD: whole-value day numbering is not a reference - a reject, never a strip; the word DAY is required ──
  { id: 'RD1-day-1-is-day-numbering', kind: 'ref-dayform', input: 'day 1', expect: 'true' },
  { id: 'RD2-day-n-of-n', kind: 'ref-dayform', input: 'DAY 2 OF 3', expect: 'true' },
  { id: 'RD3-shoot-day-n', kind: 'ref-dayform', input: 'Shoot Day 1', expect: 'true' },
  { id: 'RD4-a-slashed-reference-survives (no word DAY)', kind: 'ref-dayform', input: '14/08', expect: 'false' },
  { id: 'RD5-bare-n-of-n-survives (no word DAY)', kind: 'ref-dayform', input: '2 of 3', expect: 'false' },
  { id: 'RD6-a-reference-that-contains-a-date-survives', kind: 'ref-dayform', input: 'Amahla 14/08', expect: 'false' },
  { id: 'RD7-trailing-colon-is-still-day-numbering', kind: 'ref-dayform', input: 'DAY 1:', expect: 'true' },
  { id: 'RD8-day-numbering-with-a-remainder-is-not-whole (never a strip)', kind: 'ref-dayform', input: 'DAY 1 - GYMSHARK', expect: 'false' },
  { id: 'RD9-a-real-reference-survives', kind: 'ref-dayform', input: 'SHS_NET1', expect: 'false' },
  // ── PC (founder-ruled 2026-09-07): a model company counts only on a payee or label line, and only in company shape ──
  { id: 'PC1-a-payee-line-counts (case-insensitive find, like match-back)', kind: 'company-gate', pages: ['CREW CALL 0700\nINVOICES TO BE ADDRESSED TO EXAMPLE FILMS LTD, 1 EXAMPLE STREET, LONDON E8 4RU\nUNIT BASE'], input: 'Example Films Ltd', expect: 'true' },
  { id: 'PC2-a-production-company-label-line-counts', kind: 'company-gate', pages: ['PRODUCTION COMPANY: EXAMPLE FILMS LTD\nDIRECTOR: Sam Example'], input: 'EXAMPLE FILMS LTD', expect: 'true' },
  { id: 'PC3-the-page-1-brand-masthead-does-not', kind: 'company-gate', pages: ['EXAMPLE BRAND x PARTNER | SHOOT CALLSHEET | TUESDAY 11th NOVEMBER 2025\nCALL 0700'], input: 'EXAMPLE BRAND x PARTNER', expect: 'false' },
  { id: 'PC4-a-client-label-line-does-not', kind: 'company-gate', pages: ['CLIENT: BIG DRINKS PLC\nAGENCY: EXAMPLE AGENCY'], input: 'BIG DRINKS PLC', expect: 'false' },
  { id: 'PC5-a-company-inside-a-block-without-a-payee-or-label-line-does-not (the line, not the block)', kind: 'company-gate', pages: ['INVOICING\nPAPERWORK IS KEPT ON FILE AT EXAMPLE FILMS. IF YOUR INVOICE IS NOT ACCOMPANIED YOU WILL BE TAXED\nPAYMENT 30 DAYS'], input: 'Example Films', expect: 'false' },
  { id: 'PC6-an-addressee-on-a-payee-line-does-not (hygiene)', kind: 'company-gate', pages: ['EMAIL INVOICE TO: MARK INVOICES: F.A.O SAM EXAMPLE'], input: 'F.A.O SAM EXAMPLE', expect: 'false' },
  { id: 'PC7-a-payee-stop-phrase-does-not', kind: 'company-gate', pages: ['INVOICES TO BE ADDRESSED TO THE PRODUCTION DEPARTMENT. ALL HEADS NOTE.'], input: 'the production department', expect: 'false' },
  { id: 'PC8-a-label-alone-on-the-line-above-does-not (the pattern cell rule fills it)', kind: 'company-gate', pages: ['PRODUCTION COMPANY\nExample Film Co. LLP,\n1 Example Street'], input: 'Example Film Co. LLP', expect: 'false' },
  { id: 'PC9-an-email-on-a-payee-line-is-not-a-company (hygiene; the line itself qualifies)', kind: 'company-gate', pages: ['INVOICES TO BE EMAILED TO accounts@example.test WITHIN 30 DAYS'], input: 'accounts@example.test', expect: 'false' },
  { id: 'PC10-a-glued-digit-name-on-a-block-line-does-not', kind: 'company-gate', pages: ['INVOICING\nc/o 7Example Music Limited, 1 Example Road, London N1 1AA'], input: '7Example Music Limited', expect: 'false' },
  // ── RK: inside the gate a payee line ranks above a label line (the harvest's own order) ──
  { id: 'RK1-payee-line-ranks-first', kind: 'company-rank', pages: ['Address Invoices to: Example London Limited, 2nd floor, 1 Example Place, W1T 1JJ'], input: 'Example London Limited', expect: '0' },
  { id: 'RK2-label-line-ranks-second', kind: 'company-rank', pages: ['PRODUCTION COMPANY EXAMPLE LONDON Tel 020 8000 0000'], input: 'EXAMPLE LONDON', expect: '1' },
  { id: 'RK3-neither-ranks-last', kind: 'company-rank', pages: ['EXAMPLE LONDON\nSHOOT DAY 2'], input: 'EXAMPLE LONDON', expect: '2' },
  { id: 'RK4-the-pipeline-form-ranks-prodCo-only', kind: 'company-rank-key', pages: ['Address Invoices to: Example London Limited'], input: 'prodCo|Example London Limited', expect: '0' },
  { id: 'RK5-the-pipeline-form-leaves-other-fields-unranked', kind: 'company-rank-key', pages: ['Address Invoices to: Example London Limited'], input: 'title|Example London Limited', expect: '2' },
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
  // ── AV: THE ADDRESS IS WHAT FOLLOWS THE PHRASE (founder-ruled 2026-09-04, from the device walk) ──
  { id: 'AV1-header-and-verb-on-the-postcode-line (Gymshark shape)', kind: 'address-value', pages: ['INVOICING Made out to: Uncovered Example, 5 Example Gardens, London SW8 1DF'], expect: 'Uncovered Example, 5 Example Gardens, London SW8 1DF' },
  { id: 'AV2-invoices-to-be-addressed-to (Nettwerk shape, trailing stop)', kind: 'address-value', pages: ['INVOICES TO BE ADDRESSED TO EXAMPLE STUDIO LTD, 16 Example Drive, Colwyn Bay, LL28 4YB.'], expect: 'EXAMPLE STUDIO LTD, 16 Example Drive, Colwyn Bay, LL28 4YB' },
  { id: 'AV3-all-invoices-must-be-addressed-to (Teepee shape)', kind: 'address-value', pages: ['ALL INVOICES MUST BE ADDRESSED TO TEEPEE EXAMPLE, NETIL CORNER, 2 Example Street, LONDON, E8 4RU'], expect: 'TEEPEE EXAMPLE, NETIL CORNER, 2 Example Street, LONDON, E8 4RU' },
  { id: 'AV4-please-address-invoices-to-colon (Walkers shape)', kind: 'address-value', pages: ['INVOICING\nPLEASE ADDRESS INVOICES TO: EXAMPLE EYE, 2ND FLOOR, 52 Example Avenue, LONDON, EC1R 4RP.'], expect: 'EXAMPLE EYE, 2ND FLOOR, 52 Example Avenue, LONDON, EC1R 4RP' },
  { id: 'AV5-list-items-above-and-a-list-marker-on-the-line (McDonalds shape)', kind: 'address-value', pages: ['INVOICE DETAILS\n1) YOUR NAME\n2) DATE OF BIRTH\n3) FULL HOME ADDRESS\n4) ADDRESSED TO EXAMPLE FILMS, 19 Example Street, LONDON EC1V 0DR'], expect: 'EXAMPLE FILMS, 19 Example Street, LONDON EC1V 0DR' },
  { id: 'AV6-email-line-above-and-a-label-on-the-line (Bank of America shape)', kind: 'address-value', pages: ['INVOICING\nEMAIL: accounts@example.test\nCOMPANY ADDRESS: Example Head, 28 Example Street, London, EC2A 4AS'], expect: 'Example Head, 28 Example Street, London, EC2A 4AS' },
  { id: 'AV7-sentences-above-and-please-ensure-on-the-line (DFS shape)', kind: 'address-value', pages: ['INVOICING\nPlease mark all invoices for the attention of A Person & submit in pdf format\nPlease ensure that invoices are addressed to EXAMPLE CREATIONS LTD, 6 Example Street, LONDON, E1 1RH'], expect: 'EXAMPLE CREATIONS LTD, 6 Example Street, LONDON, E1 1RH' },
  { id: 'AV8-a-bare-label-above-is-not-an-address-line (Armoury shape)', kind: 'address-value', pages: ['INVOICING\nDetails to include:\nExample Films Ltd, Unit 6A, Example Works, London, N16 8JH'], expect: 'Example Films Ltd, Unit 6A, Example Works, London, N16 8JH' },
  { id: 'AV9-a-postcode-on-an-insurance-or-contact-line-is-refused', kind: 'address-value', pages: ['INVOICING\nAD-WRAP INSURANCE: EXAMPLE TEL: 0207 000 0000, 5TH FLOOR, EXAMPLE PLACE, BIRMINGHAM, B1 2JQ'], expect: '<NIL>' },
  { id: 'AV10-an-insurance-line-above-does-not-join (the M&S front)', kind: 'address-value', pages: ['INVOICING\nAD-WRAP INSURANCE: EXAMPLE TEL: 0207 000 0000\n5TH FLOOR, EXAMPLE PLACE, BIRMINGHAM, B1 2JQ'], expect: '5TH FLOOR, EXAMPLE PLACE, BIRMINGHAM, B1 2JQ' },
  { id: 'AV11-vocabulary-matches-as-words (Mustard Lane, Shouldham Street)', kind: 'address-value', pages: ['INVOICING\nAddressed to: Example Ltd\n12 Mustard Lane\nShouldham Street, London W1H 5FA'], expect: '12 Mustard Lane, Shouldham Street, London W1H 5FA' },
  { id: 'AV12-the-two-line-shape-is-unchanged (HV8 value)', kind: 'address-value', pages: ['INVOICING DETAILS\nAddress Invoices to: Merman Example Limited\n2nd floor, 32 Example Place\nLondon W1T 1JJ'], expect: '2nd floor, 32 Example Place, London W1T 1JJ' },
  { id: 'AV13-lead-in-strips-header-verb-and-colon', kind: 'lead-in', input: 'INVOICING Made out to: Uncovered Example, 5 Example Gardens', expect: 'Uncovered Example, 5 Example Gardens' },
  { id: 'AV14-address-line-word-not-substring', kind: 'address-line', input: '12 Mustard Lane', expect: 'true' },
  { id: 'AV15-address-line-refuses-an-instruction', kind: 'address-line', input: 'Please mark all invoices for the attention of A Person', expect: 'false' },
  // ── AD: THE PAYEE NAME DOES NOT PRINT TWICE (founder-ruled 2026-09-04) ──
  { id: 'AD1-leading-segment-equal-to-the-company-is-dropped', kind: 'address-dedupe', input: 'Uncovered Example, 5 Example Gardens, London SW8 1DF|Uncovered Example', expect: '5 Example Gardens, London SW8 1DF' },
  { id: 'AD2-company-plus-suffix-words-is-the-company (Brother shape)', kind: 'address-dedupe', input: 'EXAMPLE FILM CO LLP, 307 Example Levels, SE15 4ST|EXAMPLE FILM', expect: '307 Example Levels, SE15 4ST' },
  { id: 'AD3-a-different-company-is-untouched', kind: 'address-dedupe', input: 'Example Head, 28 Example Street, EC2A 4AS|Other Co', expect: 'Example Head, 28 Example Street, EC2A 4AS' },
  { id: 'AD4-no-company-untouched', kind: 'address-dedupe', input: 'A Street, B Town|', expect: 'A Street, B Town' },
  { id: 'AD5-a-single-segment-address-is-never-emptied', kind: 'address-dedupe', input: 'Uncovered Example|Uncovered Example', expect: 'Uncovered Example' },
  // ── IW: INTENT IS A WORD, NOT A SUBSTRING (Comet, founder-ruled 2026-09-04) ──
  { id: 'IW1-a-surname-containing-billing-is-not-intent (Comet)', kind: 'intent-hit', input: 'Sam Billings 07000 000000', expect: 'false' },
  { id: 'IW2-billing-the-word-is', kind: 'intent-hit', input: 'Billing queries: accounts', expect: 'true' },
  { id: 'IW3-accountant-is-not-account', kind: 'intent-hit', input: 'Production Accountant: Alex Example', expect: 'false' },
  { id: 'IW4-accounts-keeps-its-inflection', kind: 'intent-hit', input: 'Accounts payable', expect: 'true' },
  { id: 'IW5-invoiced-keeps-its-inflection', kind: 'intent-hit', input: 'invoiced within 30 days', expect: 'true' },
  { id: 'IW6-townsend-to-is-not-send-to', kind: 'intent-hit', input: 'Townsend to confirm', expect: 'false' },
  { id: 'IW7-display-to-is-not-pay-to', kind: 'intent-hit', input: 'display to be tested', expect: 'false' },
  { id: 'IW8-strong-phrase-yes', kind: 'strong-hit', input: 'Please send invoices to', expect: 'true' },
  { id: 'IW9-agency-title-is-not-strong', kind: 'strong-hit', input: 'Account Manager: Sam', expect: 'false' },
  { id: 'IW10-a-lone-generic-word-is-not-strong', kind: 'strong-hit', input: 'billing', expect: 'false' },
  { id: 'CW1-screwfix-is-not-crew', kind: 'crew-hit', input: 'Screwfix Ltd', expect: 'false' },
  { id: 'CW2-subsidiary-is-not-diary', kind: 'crew-hit', input: 'a subsidiary of Example Group', expect: 'false' },
  { id: 'CW3-automobile-is-not-mobile', kind: 'crew-hit', input: 'Automobile Association', expect: 'false' },
  { id: 'CW4-roadrunner-is-not-runner', kind: 'crew-hit', input: 'Roadrunner Films', expect: 'false' },
  { id: 'CW5-2nd-AD-is-crew', kind: 'crew-hit', input: '2nd AD Alex Example', expect: 'true' },
  { id: 'CW6-account-manager-is-demoted (agency title, ruled)', kind: 'crew-hit', input: 'Account Manager: Sam Example', expect: 'true' },
  { id: 'CW7-account-executive-is-demoted', kind: 'crew-hit', input: 'Account Executive Sam', expect: 'true' },
  // ── EG: A CANDIDATE NEEDS A STRONG PHRASE OR AN INVOICING BLOCK ──
  { id: 'EG1-THE-COMET-SHAPE: a unit list with a surname containing billing yields nothing', kind: 'emails-core', pages: ['AD Runner Alex Example alex@example.test 07000 000000 Sam Billings sam@example.test'], expect: '<NIL>' },
  { id: 'EG2-an-agency-contact-outside-a-block-yields-nothing', kind: 'emails-core', pages: ['CLIENT CONTACTS\nAccount Manager: Sam Example sam@example.test'], expect: '<NIL>' },
  { id: 'EG3-a-generic-word-inside-a-block-still-qualifies', kind: 'emails-core', pages: ['INVOICING DETAILS\nAccounts: accounts@example.test'], expect: 'accounts@example.test' },
  { id: 'EG4-a-strong-phrase-outside-a-block-still-qualifies', kind: 'emails-core', pages: ['some page text\nplease email invoices to billing@example.test'], expect: 'billing@example.test' },
  // The real shape: the header and the payee verb share the line ABOVE the addresses ("INVOICING Made out to: ..."), so the word and the strong phrase both sit on prev; four addresses on one line demote the cluster to a score of 0, and 0 is still a candidate.
  { id: 'EG5-the-zero-score-corpus-winner-survives (Gymshark shape)', kind: 'emails-core', pages: ['INVOICING Made out to: Example Group, 5 Example Gardens, London SW8 1DF\nSend by email to: a@example.test; b@example.test; c@example.test; d@example.test'], expect: 'a@example.test' },
  { id: 'EC1-a-model-token-on-a-crew-line-has-no-context', kind: 'email-context', input: 'sam@example.test', pages: ['AD Runner Sam Billings sam@example.test'], expect: 'false' },
  { id: 'EC2-a-model-token-on-an-invoicing-line-has-context', kind: 'email-context', input: 'accounts@example.test', pages: ['INVOICES TO accounts@example.test'], expect: 'true' },
  { id: 'EC3-a-model-token-absent-from-the-text-has-none', kind: 'email-context', input: 'ghost@example.test', pages: ['INVOICES TO accounts@example.test'], expect: 'false' },
  { id: 'EC4-a-model-token-deep-in-an-invoicing-block-has-context-by-membership', kind: 'email-context', input: 'sam@example.test', pages: ['INVOICING DETAILS\nJob number 123\nVAT applies\nQueries: sam@example.test'], expect: 'true' },
];

function generateMain(fixturePath) {
  return `
import Foundation
import PDFKit
import Vision
import AppKit
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
        case "prodco-relaxed": if let h = CallSheetHarvest.harvestProdCo(pages: pt(c.pages ?? []), relaxed: true) { got = h.value }
        case "jobref":  if let h = CallSheetHarvest.harvestJobRef(pages: pt(c.pages ?? [])) { got = h.value }
        case "address": if let h = CallSheetHarvest.harvestAddress(pages: pt(c.pages ?? [])) { got = h.postcode }
        case "address-value": if let h = CallSheetHarvest.harvestAddress(pages: pt(c.pages ?? [])) { got = h.value }
        case "address-dedupe":
            let parts = (c.input ?? "").split(separator: "|", omittingEmptySubsequences: false).map(String.init)
            got = CallSheetHarvest.addressWithoutCompany(parts[0], company: parts.count > 1 && !parts[1].isEmpty ? parts[1] : nil)
        case "address-line": got = CallSheetHarvest.looksLikeAddressLine(c.input ?? "") ? "true" : "false"
        case "lead-in": got = CallSheetHarvest.stripAddressLeadIn(c.input ?? "")
        case "intent-hit": got = CallSheetHarvest.intentHit(c.input ?? "") ? "true" : "false"
        case "strong-hit": got = CallSheetHarvest.strongIntentHit(c.input ?? "") ? "true" : "false"
        case "crew-hit": got = CallSheetHarvest.crewContextHit(c.input ?? "") ? "true" : "false"
        case "email-context": got = CallSheetHarvest.emailHasInvoicingContext(c.input ?? "", pages: pt(c.pages ?? [])) ? "true" : "false"
        case "blocks":  got = String(CallSheetHarvest.invoicingBlocks(pages: pt(c.pages ?? [])).count)
        case "emails-extract": got = CallSheetHarvest.extractEmails(c.input ?? "").joined(separator: ",")
        case "emails-plausible": got = CallSheetHarvest.isPlausibleEmail(c.input ?? "") ? "true" : "false"
        case "postcode": got = CallSheetHarvest.containsUKPostcode(c.input ?? "") ? "true" : "false"
        case "cleanref": got = CallSheetHarvest.cleanRef(c.input ?? "")
        case "ref-context":
            // Mirrors the pipeline: match-back (a) finds the model value case-insensitively, then the gate judges the span.
            let text = (c.pages ?? []).first ?? ""
            let found = (text as NSString).range(of: c.input ?? "", options: [.caseInsensitive])
            got = found.location == NSNotFound ? "<NOMATCH>" : (CallSheetHarvest.refHasLabelContext(at: found, in: text) ? "true" : "false")
        case "ref-dayform": got = CallSheetHarvest.isDayNumberingRef(c.input ?? "") ? "true" : "false"
        case "company-gate":
            let ctext = (c.pages ?? []).first ?? ""
            let cfound = (ctext as NSString).range(of: c.input ?? "", options: [.caseInsensitive])
            got = cfound.location == NSNotFound ? "<NOMATCH>" : (CallSheetHarvest.modelCompanyCounts(c.input ?? "", at: cfound, in: ctext) ? "true" : "false")
        case "company-rank":
            let rtext = (c.pages ?? []).first ?? ""
            let rfound = (rtext as NSString).range(of: c.input ?? "", options: [.caseInsensitive])
            got = rfound.location == NSNotFound ? "<NOMATCH>" : String(CallSheetHarvest.companyContextRank(at: rfound, in: rtext))
        case "company-rank-key":
            let parts = (c.input ?? "").split(separator: "|", omittingEmptySubsequences: false).map(String.init)
            let ktext = (c.pages ?? []).first ?? ""
            let kfound = (ktext as NSString).range(of: parts.count > 1 ? parts[1] : "", options: [.caseInsensitive])
            got = String(CallSheetHarvest.companyContextRank(key: parts[0], match: kfound.location == NSNotFound ? nil : kfound, text: ktext))
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
    var prod = CallSheetHarvest.harvestProdCo(pages: pages)
    let ref = CallSheetHarvest.harvestJobRef(pages: pages)
    var addr = CallSheetHarvest.harvestAddress(pages: pages)
    // THE OCR FALLBACK, mirrored from run() (2026-09-02): layer present AND
    // company or postcode missing -> OCR page 1 + invoicing pages, fill only
    // those two fields, relaxed labelled cells on OCR text only. The draft,
    // the title pins and phase two must see what the device produces.
    var ocrUsed = ""
    if prod == nil || addr == nil {
        let invoic = Set(pages.filter { $0.text.lowercased().contains("invoic") }.map { $0.index })
        var ocrPages: [CallSheetHarvest.PageText] = []
        for i in 0..<doc.pageCount where i == 0 || invoic.contains(i) {
            guard let pg = doc.page(at: i) else { continue }
            let b = pg.bounds(for: .mediaBox); let scale = 1600.0 / max(b.width, 1)
            let img = pg.thumbnail(of: NSSize(width: b.width * scale, height: b.height * scale), for: .mediaBox)
            var rect = NSRect(origin: .zero, size: img.size)
            guard let cg = img.cgImage(forProposedRect: &rect, context: nil, hints: nil) else { continue }
            let req = VNRecognizeTextRequest(); req.recognitionLevel = .accurate; req.usesLanguageCorrection = false
            try? VNImageRequestHandler(cgImage: cg, options: [:]).perform([req])
            let obs = (req.results ?? []).sorted { $0.boundingBox.minY != $1.boundingBox.minY ? $0.boundingBox.minY > $1.boundingBox.minY : $0.boundingBox.minX < $1.boundingBox.minX }
            let text = obs.compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\\n")
            if !text.isEmpty { ocrPages.append(CallSheetHarvest.PageText(index: i, text: text)) }
        }
        if !ocrPages.isEmpty {
            if prod == nil, let h = CallSheetHarvest.harvestProdCo(pages: ocrPages, relaxed: true) { prod = h; ocrUsed += "company " }
            if addr == nil, let a = CallSheetHarvest.harvestAddress(pages: ocrPages) { addr = a; ocrUsed += "postcode " }
        }
    }
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
        ("nettwerk", "TENDER LP VISUALISERS"), ("teepee", "A Little More"),
        ("gymshark", "GYMSHARK WINTER WOMENSWEAR"),
        ("square evol", "SQUARE - EVOLVE"), ("brother_rbr", "INSIDE THE TEAM"),
        ("mcdonalds", "MCDONALDS US / FIFA MWC"), ("tda176", "CAPSULE"),
        ("m&s winter", "MARKS & SPENCER"), ("dove x merman", "DOVE DYPTIQUE 2"),
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
    if !ocrUsed.isEmpty { print("OCR-FALLBACK \\(f.prefix(34)) filled: \\(ocrUsed.trimmingCharacters(in: .whitespaces))") }
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
        if t.isEmpty || t == "(none)" || t == "(none" { return "" }   // "(none" - a typo in the founder's file, founder-ruled as none
        switch field {
        case "postcode": return t.replacingOccurrences(of: " ", with: "").uppercased()
        case "invoice email", "cc email": return t.lowercased()
        // Case-folded (founder-ruled 2026-09-02): capitalisation is his own
        // transcription, not a reader fault - two "misses" were exactly that.
        case "title", "company": return t.split(separator: " ").joined(separator: " ").lowercased()
        default: return t.split(separator: " ").joined(separator: " ")
        }
    }
    var asserted = 0, unreviewed = 0, red = 0, redFields = 0, unknown = 0
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
        if bad.isEmpty { print("EXPECT-OK \\(sheet)") } else { red += 1; redFields += bad.count; print("EXPECT-RED \\(sheet) | " + bad.joined(separator: " | ")) }
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
    print("EXPECT-SUMMARY asserted=\\(asserted) ok=\\(asserted - red) red=\\(red) redFields=\\(redFields) unreviewed=\\(unreviewed) unknownSheet=\\(unknown)")
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
      // 2026-09-02: the OCR fallback adds exactly ONE more harvestProdCo and ONE
      // more harvestAddress call, both on `ocrPT` - counted explicitly, so any
      // further call site still reddens this clause.
      (plugin.match(/CallSheetHarvest\.harvestProdCo\(/g) || []).length === 2
      && (plugin.match(/CallSheetHarvest\.harvestProdCo\(pages: ocrPT, relaxed: true\)/g) || []).length === 1
      && (plugin.match(/CallSheetHarvest\.harvestJobRef\(/g) || []).length === 1
      && (plugin.match(/CallSheetHarvest\.harvestAddress\(/g) || []).length === 2
      && (plugin.match(/CallSheetHarvest\.harvestAddress\(pages: ocrPT\)/g) || []).length === 1
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
          && /if \(reds === 0 && execOk && structBad === 0 && expectRedFields <= EXPECT_KNOWN_RED_FIELDS\) \{/.test(me)
          // THE VALUE is pinned, not just its presence: loosening the ratchet must
          // redden this clause. And per the SELF-MATCH GUARD above, it is COUNTED:
          // the literal below appears once in this regex and once as the real
          // declaration, so the count must be exactly 2. A plain .test() matched
          // its own regex text and stayed green when the MR19 mutation raised the
          // real constant to 20 - the trap this guard exists for, sprung again.
          && (me.match(/const EXPECT_KNOWN_RED_FIELDS = 9;/g) || []).length === 2
          && /REGRESSION/.test(me)
          && /expectRedFields = Number\(m\[4\]\) \+ Number\(m\[6\]\);/.test(me);
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

    ['HS15 THE OCR FALLBACK IS WIRED EXACTLY AS RULED: trigger = a text layer is present AND company or postcode is MISSING; pages = page 1 + invoicing pages, layer-read pages only; fills company and postcode ONLY, never emails, never a replace (state must be "missing"); relaxed labelled cells on the OCR text ONLY. The comment carries the finding that matters - the ceiling is the lexicon, not the OCR',
      /let companyMissing = \(\(perField\["prodCo"\] as\? \[String: Any\]\)\?\["state"\] as\? String \?\? "missing"\) == "missing"/.test(plugin)
      && /let postcodeMissing = \(\(perField\["invoicingAddress"\] as\? \[String: Any\]\)\?\["state"\] as\? String \?\? "missing"\) == "missing"/.test(plugin)
      && /if anyLayer, companyMissing \|\| postcodeMissing \{/.test(plugin)
      && /for page in pages where page\.index == 0 \|\| invoicSet\.contains\(page\.index\) \{\n                guard case \.pdfLayer\(let pdfPage\) = page\.target else \{ continue \}/.test(plugin)
      && /if companyMissing, let hit = CallSheetHarvest\.harvestProdCo\(pages: ocrPT, relaxed: true\)/.test(plugin)
      && /if postcodeMissing, let addr = CallSheetHarvest\.harvestAddress\(pages: ocrPT\)/.test(plugin)
      && !/harvestInvoicingEmailsCore\(pages: ocrPT/.test(plugin)
      && (plugin.match(/relaxed: true\)/g) || []).length === 1   // the CALL, not the comment that mentions it
      && /THE CEILING IS THE LEXICON, NOT THE OCR/.test(plugin)
      && /THE DAMAGE DETECTOR PROPOSED IN MAINTENANCE\.md DOES NOT WORK/.test(plugin)],

    ['HS16 THE MODEL FALLBACK NEEDS INVOICING CONTEXT AND THE PAYEE NAME IS DROPPED FROM THE ADDRESS (founder-ruled 2026-09-04): both token lists in the fallback pass through emailHasInvoicingContext; an emptied primary or cc becomes "missing", never an "unverified" survivor; addressWithoutCompany runs on the settled address with the settled company, after the OCR fallback and before the title clean',
      /let primaryTokens = extractEmails\(primaryRaw\)\.filter \{ CallSheetHarvest\.emailHasInvoicingContext\(\$0, pages: contextPT\) \}/.test(plugin)
      && /let ccTokens = extractEmails\(ccRaw\)\.filter \{ CallSheetHarvest\.emailHasInvoicingContext\(\$0, pages: contextPT\) \}/.test(plugin)
      && /fields\["invoicingEmail"\] = nil\s*\/\/ no invoicing context → nothing, honestly\n\s*perField\["invoicingEmail"\] = \["state": "missing"\]/.test(plugin)
      && !/e\["state"\] = "unverified"; perField\["invoicingEmail"\] = e/.test(plugin)
      && !/e\["state"\] = "unverified"; perField\["ccEmail"\] = e/.test(plugin)
      && /let deduped = CallSheetHarvest\.addressWithoutCompany\(addr, company: fields\["prodCo"\] as\? String\)/.test(plugin)
      && plugin.indexOf('CallSheetHarvest.addressWithoutCompany(addr') > plugin.indexOf('if postcodeMissing, let addr = CallSheetHarvest.harvestAddress(pages: ocrPT)')
      && plugin.indexOf('CallSheetHarvest.addressWithoutCompany(addr') < plugin.indexOf('CallSheetTitle.cleanTitle(t)')],

    ['HS17 BOTH KEYWORD LISTS MATCH AS WORDS: the core scores through intentHit/crewContextHit (no substring contains on either list remains), keywordPattern keeps the invoice/account inflections and bounds everything else, the strong-or-block gate stands in the core, and the three agency titles are on the demote list',
      /let lineHit = intentHit\(line\)\n\s*let prevHit = intentHit\(prev\)/.test(hv)
      && /if crewContextHit\(line\) \{ score -= 6 \}\n\s*if crewContextHit\(prev\) \{ score -= 4 \}/.test(hv)
      && !/invoiceIntentKeywords\.contains \{ line\.contains/.test(hv) && !/crewContextKeywords\.contains\(where: \{ line\.contains/.test(hv)
      && /case "invoice", "invoicing": return "\\\\binvoic\(\?:e\|es\|ing\|ed\)\\\\b"/.test(hv)
      && /case "account": return "\\\\baccounts\?\\\\b"/.test(hv)
      && /if !\(strongIntentHit\(line\) \|\| strongIntentHit\(prev\)\) && !inInvoicingBlock\(pageIndex: page\.index, location: m\.range\.location, pages: pages\) \{ continue \}/.test(hv)
      && /crewContextKeywords = \[[^\]]*"account manager", "account director", "account executive"\]/.test(hv)],

    ['HS18 THE REFERENCE GATE IS IN verify (founder-ruled 2026-09-07): jobReference needs a matched span AND label context - the pure refHasLabelContext judges the span - so a masthead "DAY 1" that merely appears on the sheet is never a verified reference',
      /case "jobReference":\n[\s\S]{0,600}?guard let r = match else \{ return false \}\n\s*return CallSheetHarvest\.refHasLabelContext\(at: r, in: pageText\)/.test(plugin)
      && plugin.indexOf('case "jobReference":') < plugin.indexOf('default:\n            return match != nil')],
    ['HS19 A MODEL REFERENCE WITHOUT CONTEXT DOES NOT COUNT AT ALL: the candidate loop drops a jobReference that failed verification before it is appended - absent, not "unverified" - so a pattern hit fills and no hit is honestly missing',
      /let verified = verify\(key: key, value: raw, match: match, pageText: page\.text\)\n[\s\S]{0,500}?if key == "jobReference", !verified \{ continue \}\n[\s\S]{0,200}?candidates\[key, default: \[\]\]\.append\(Candidate\(/.test(plugin)],
    ['HS20 WHOLE-VALUE DAY NUMBERING IS REJECTED, NEVER STRIPPED: after cleanRef the reference passes isDayNumberingRef and a day form becomes missing (nil + "missing"); the pattern requires the word DAY; the cleaning wiring HS14 pins is unchanged',
      /let cleaned = CallSheetHarvest\.cleanRef\(r\)\n\s*if CallSheetHarvest\.isDayNumberingRef\(cleaned\) \{\n[\s\S]{0,400}?fields\["jobReference"\] = nil\n\s*perField\["jobReference"\] = \["state": "missing"\]\n\s*\} else if cleaned != r \{/.test(plugin)
      && /static let dayNumberingRefPattern = "\^\\\\s\*\(\?:shoot\\\\s\+\)\?day\\\\s\*/.test(hv)],
    ['HS22 THE COMPANY GATE IS IN verify (founder-ruled 2026-09-07): prodCo needs a matched span AND the pure modelCompanyCounts rule (payee or label line, company shape), so a page-1 brand that merely appears on the sheet is never a verified company',
      /case "prodCo":\n[\s\S]{0,700}?guard let r = match else \{ return false \}\n\s*return CallSheetHarvest\.modelCompanyCounts\(value, at: r, in: pageText\)/.test(plugin)
      && plugin.indexOf('case "prodCo":') < plugin.indexOf('default:\n            return match != nil')],
    ['HS23 A MODEL COMPANY WITHOUT CONTEXT DOES NOT COUNT AT ALL, AND CARRIES ITS RANK WHEN IT DOES: the candidate loop drops a prodCo that failed verification right after the reference drop, the rank comes from the pure companyContextRank(key:match:text:) and travels on the candidate',
      /if key == "jobReference", !verified \{ continue \}\n\s*if key == "prodCo", !verified \{ continue \}/.test(plugin)
      && /let rank = CallSheetHarvest\.companyContextRank\(key: key, match: match, text: page\.text\)/.test(plugin)
      && /fromInvoicPage: fromInvoic, verified: verified, matchRange: match, contextRank: rank/.test(plugin)],
    ['HS24 INSIDE THE GATE A PAYEE LINE OUTRANKS A LABEL LINE: pick orders prodCo by contextRank between verified and session order, and the Candidate carries contextRank defaulting to 2 (neither), so every other field is untouched',
      /if a\.verified != b\.verified \{ return a\.verified \}\n\s*if key == "prodCo", a\.contextRank != b\.contextRank \{ return a\.contextRank < b\.contextRank \}\n\s*return a\.order < b\.order/.test(plugin)
      && /var contextRank: Int = 2/.test(plugin)],
    ['HS21 THE INBOX IS CLEARED, AND ONLY THE INBOX: ingestSharedFile removes the original after a successful copy only when it lies under Documents/Inbox (isInInbox), sweeps older siblings behind the same guard, and the picker path never removes a source',
      /try FileManager\.default\.copyItem\(at: url, to: dest\)\n[\s\S]{0,800}?if let inbox = inboxDirectory\(\), isInInbox\(url, inbox: inbox\) \{\n\s*try\? FileManager\.default\.removeItem\(at: url\)\n\s*sweepInbox\(inbox, olderThan: 60\)\n\s*\}/.test(plugin)
      && (plugin.match(/FileManager\.default\.removeItem\(at: url\)/g) || []).length === 1
      && /private func isInInbox\(_ url: URL, inbox: URL\) -> Bool/.test(plugin)],   // retargeted 2026-09-07: an instance method (Xcode refused the static call from ingestSharedFile; the harness cannot compile the plugin)
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
  // THE RATCHET (2026-09-02). The founder's file is complete and the reader is
  // not perfect, so phase two cannot demand zero mismatches without keeping the
  // gate red for ever. It demands NO REGRESSION instead: the number of red
  // sheets may not EXCEED this committed count, and the run says out loud when
  // it could be tightened. Tighten it in the commit that fixes a miss; never
  // loosen it silently. It counts FIELD mismatches, not red sheets: a sheet
  // already red for its title would otherwise hide a company regression on
  // the same sheet (the MR21 mutation found exactly that). 11 = the eleven
  // honest field misses after the 2026-09-02 round. HS13 pins this value, so
  // loosening it is a visible two-place change, never a quiet edit.
  const EXPECT_KNOWN_RED_FIELDS = 9;   // tightened 2026-09-04: Comet and DFS email lines corrected by the founder, fixes 1+2 landed
  let expectRed = 0, expectRedFields = 0;
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
      const m = sum.match(/asserted=(\d+) ok=(\d+) red=(\d+) redFields=(\d+) unreviewed=(\d+) unknownSheet=(\d+)/);
      if (!m) { console.log('  ✗ EXPECT-SUMMARY line missing from the harness output'); expectRed = 1; }
      else {
        expectRed = Number(m[3]) + Number(m[6]); expectRedFields = Number(m[4]) + Number(m[6]);
        if (Number(m[4]) > 0) console.log(`⚠ ${m[4]} block(s) in expected.txt still say "draft" in their notes line and were NOT asserted - review them to bring them into the gate.`);
        corpusNote += ` · expectations ${m[2]}/${m[1]} ok, ${m[4]} unreviewed`;
      }
    }
  }

  const total = CASES.length + structCount;
  if (expectRedFields > 0) console.log(`  EXPECT-RATCHET red-fields=${expectRedFields} known=${EXPECT_KNOWN_RED_FIELDS} (red-sheets=${expectRed})` + (expectRedFields < EXPECT_KNOWN_RED_FIELDS ? '  <-- ratchet can TIGHTEN' : (expectRedFields > EXPECT_KNOWN_RED_FIELDS ? '  <-- REGRESSION' : '')));
  if (reds === 0 && execOk && structBad === 0 && expectRedFields <= EXPECT_KNOWN_RED_FIELDS) {
    console.log(`✅ harvest pins: ${total} assertions (${okCount} executed through the real Swift, ${structCount} structural) · ${corpusNote}`);
    process.exit(0);
  }
  console.log(`❌ harvest pins: ${reds + structBad + expectRed} failure(s) of ${total}${expectRed ? ` (${expectRed} expectation mismatch${expectRed === 1 ? '' : 'es'})` : ''}`);
  process.exit(1);
}

main();
