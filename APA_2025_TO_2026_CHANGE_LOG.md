# APA crew terms: 2025 to 1 September 2026

## App-focused result

Ignoring ordinary increases to the monetary rate card and the corresponding updated worked-example amounts, there are **three substantive change groups** that affect an APA rate-calculation app:

1. Prep days may now be booked for either 8 or 10 hours, and weekday prep-day overtime moves from after 8 hours to only after 10 hours worked.
2. Base-to-base working-time treatment no longer applies when the equipment is hired from the crew member.
3. The Basic Daily Rate thresholds used to assign Monday-Friday overtime Grades I-III have changed.

The document's effective date also changes. No other rule, definition, example structure, penalty, break, day type, cancellation, holiday-pay, force-majeure, or role-treatment wording changed.

## Scope and completeness

This conclusion comes from comparing all 13 physical pages of both PDFs at three levels:

- page-aware extracted text, including headings, prose, tables, notes, worked-example labels and Appendix 2;
- a whitespace-insensitive redline, to exclude pagination and table-layout movement;
- a second redline with every sterling amount normalised, to separate rate-derived changes from actual wording or rule changes.

After sterling amounts and page-number/layout movement are excluded, the complete textual change inventory is: **effective date; clause 2.3 general wording; clause 2.3 prep-day wording; deletion of the prep-day table row; the new clause 3.1 equipment-hire note; and the three clause 4 overtime-grade boundaries.** There are no other changed substantive passages.

## Detailed change log

| Area | 2025 terms | 2026 terms | App impact | Required action |
|---|---|---|---|---|
| Effective date (cover, PDF p.1) | Effective 1 September 2025. | Effective 1 September 2026. | **Copy-only** | Version the terms/rate set from 2026-09-01 and update displayed legal/help copy. |
| General non-shooting-day rule (clause 2.3, PDF p.7) | Every non-shooting working day was stated to be 8 hours at BHR, with standard OT after 8 hours. The list expressly grouped rest, prep, recce, pre-light, construction/build and strike days. | The general rule is now qualified by “Unless otherwise specified below”; the blanket OT-after-8 sentence and generic list are removed. | **Calculator logic** | Do not use one shared 8-hour/OT-after-8 rule for every non-shooting day. Dispatch by subtype. |
| Prep-day booking length and weekday OT (clause 2.3, PDF p.7) | Prep, recce, construction and strike were one rule: 8 hours at BHR; standard OT after 8 hours. | Prep is split out: it may be booked for **8 or 10 hours**, charged at BHR, and OT “shall only apply after 10 hours have been worked.” Recce, construction and strike remain 8-hour days with OT after 8. | **Calculator logic** | Add a prep booking-length input/state (8 or 10). Charge worked/booked prep time at BHR through hour 10; apply standard OT only beyond 10. Keep recce/build/strike OT thresholds at 8 hours. Do not infer the OT threshold from the selected 8-hour booking. |
| Prep row in summary table (clause 2.3, PDF p.7) | The non-shooting-day table included Prep Day: 8 hours; OT after 8 (or after 9 if the first break is given); Monday 8×BHR; Sunday 8×2×BHR. | The Prep Day row is removed rather than revised. The prose above supplies the new rule. | **Calculator logic / copy** | Treat the prose as controlling. Remove any copied 2025 prep row/help text. The 2026 PDF gives no replacement table treatment for a first break on prep days. |
| Weekend/holiday prep rule retained (clause 2.4(vii)-(viii), PDF p.7) | Saturday prep: 8 hours at 1.5×BHR, OT after 8 at 1.5×BHR. Sunday/bank/statutory holiday prep: 8 hours at 2×BHR, OT after 8 at 2×BHR. | Wording is unchanged, despite the new general prep-day wording in clause 2.3. | **Calculator logic validation** | Preserve the explicit weekend/holiday rules: the new 10-hour prep OT threshold should be applied to ordinary weekday prep, not allowed to overwrite the more specific unchanged clauses 2.4(vii)-(viii). Flag this precedence in tests because the document is potentially ambiguous if clause 2.3 is read in isolation. |
| Equipment collection / base-to-base exclusion (clause 3.1, PDF p.8) | If production asked crew to collect equipment or personnel away from home, collection and delivery time counted as working time on a base-to-base basis, without an equipment-ownership exception. | New note: “base to base is not applicable to equipment hired from the crew member.” | **Calculator logic** | Add an `equipment_hired_from_crew_member` condition. When true, do not apply the clause 3.1 base-to-base working-time calculation merely because that equipment is collected/delivered. Keep the existing rule for production/third-party equipment and personnel collection. The document does not provide a replacement paid-travel formula for the excluded case, so do not invent one. |
| OT Grade I BDR threshold (clause 4.1, PDF p.9) | £0-£444 inclusive → 1.5×BHR. | £0-£458 inclusive → 1.5×BHR. | **Calculator logic/data** | Update boundary to `BDR <= 458`. |
| OT Grade II BDR threshold (clause 4.2, PDF p.9) | £445-£676 inclusive → 1.25×BHR. | £459-£696 inclusive → 1.25×BHR. | **Calculator logic/data** | Update boundary to `459 <= BDR <= 696`. |
| OT Grade III BDR threshold (clause 4.3, PDF p.9) | £677+ → 1.0×BHR. | £697+ → 1.0×BHR. | **Calculator logic/data** | Update boundary to `BDR >= 697`. Prefer effective-dated thresholds rather than deriving grade solely from a role, because the clauses classify by BDR. |

## Exact redline of substantive wording

### Clause 2.3 opening rule - PDF page 7

**Removed (2025):** “The non-shooting working day shall be eight hours, charged at your basic hourly rate. Overtime will begin after 8 hours and will be charged at standard overtime rate.”

**Added (2026):** “Unless otherwise specified below, a non-shooting working day shall be eight hours, charged at your basic hourly rate.”

The 2025 sentence listing a non-shooting day as “a rest day, a prep day, a recce day, a pre-light day, a construction (built) or strike day” is also removed. This changes the drafting from one blanket rule to subtype-specific rules; it does not remove those day types from the agreement.

### Clause 2.3 prep/recce/construction/strike rule - PDF page 7

**Removed (2025):** “Prep Day, Recce Day, Construction Day & Strike Day is a non-shooting working day which consists of 8 hours, charged at your basic hourly rate. Overtime will begin after 8 hours and will be charged at standard overtime rate.”

**Added (2026):** “Prep Day is a non-shooting working day which may be booked for 8 or 10 hours. The booking shall be charged at your basic hourly rate. Overtime shall only apply after 10 hours have been worked.”

**Added (2026):** A separate sentence restores the old 8-hour/OT-after-8 treatment for Recce Day, Construction Day and Strike Day.

### Clause 2.3 summary table - PDF page 7

The entire Prep Day row is deleted. Its 2025 contents were: day length 8; OT after 8, or after 9 if the first break is given; Monday example 8×BHR; Sunday example 8×2×BHR; meal break at producer's discretion; no meal compensation. No replacement prep row appears in 2026.

### Clause 3.1 equipment/people collection - PDF page 8

**Added (2026):** “Note: base to base is not applicable to equipment hired from the crew member.”

There is no deletion or other amendment to clause 3.1.

### Clauses 4.1-4.3 - PDF page 9

Only the BDR boundary figures change; the grade coefficients and wording remain the same:

- Grade I: £0-£444 becomes £0-£458; coefficient remains 1.5.
- Grade II: £445-£676 becomes £459-£696; coefficient remains 1.25.
- Grade III: £677+ becomes £697+; coefficient remains 1.0.

## Important implementation notes

- **Prep-day ambiguity:** An 8-hour prep booking no longer means OT begins after hour 8. The 2026 prose explicitly says OT applies only after 10 hours worked. Hours 9-10 therefore remain BHR under the literal wording.
- **Break handling on prep days:** The deleted 2025 table said prep OT could start after 9 hours if a first break was given. The 2026 prep prose contains no equivalent extension or break rule. Remove that special-case behaviour for prep, while retaining it for recce and build/strike because those table rows remain.
- **Role exceptions remain:** DOPs, Art Directors and Location Managers continue to treat each engagement day as a Basic Working Day (10+1, OT after 11), so the revised prep rule does not apply to those roles. Clause 2 still remains inapplicable to PMs, PAs and Runners, whose Appendix 1 rules are unchanged apart from rates.
- **Do not derive 2026 prices by simply multiplying 2025 rounded values.** Although monetary increases were excluded from this change log, use the published 2026 Appendix 1 values because BHR, multiples and examples contain currency rounding.

## Regression checklist: confirmed unchanged

No non-rate wording change was found in the following areas:

- Basic Working Day, standard/early/late/night calls, continuous working days, weekend and holiday day-type formulas (except the prep interaction noted above).
- Midnight triple-time rules, OT rounding, Saturday/Sunday OT wording and time off the clock.
- Meal breaks, continuous-day additional breaks, late-break penalties and meal compensation.
- Mileage, M25/20-mile rules, air travel and flight/rest thresholds (apart from the new equipment-hire base-to-base exclusion).
- Cancellation, payment, holiday pay, force majeure and Appendix 2's definition.
- PM/PA/Runner overtime treatment, Casting Director session structure and Programmable Lighting Desk Operator role definition.

## Clause-by-clause audit matrix

| Clause | Subject | Non-rate result | App classification |
|---|---|---|---|
| Cover/contents | Effective date and index | Effective date only; contents headings unchanged. | Copy-only |
| 1 | Your Services | Identical. | No app impact |
| 2.1 | Basic Working Day | Identical. | No app impact |
| 2.1.1 | Standard Call | Wording, timeline and charge quantities identical; example money only changed. | Rate-data only |
| 2.1.2 | Night Call/Night Shoot | Identical rule, ten-hour minimum, weekend crossover treatment and lunch example structure. | Rate-data only |
| 2.1.3 | Early Call | Identical, including pre-5 a.m. departmental-call treatment. | Rate-data only |
| 2.1.4 | Late Call | Identical. | Rate-data only |
| 2.1.5 | Night Shoot | Identical. | Rate-data only |
| 2.2 | Continuous Working Day | Identical nine-hour day, double-day basis and break penalty structure. | Rate-data only |
| 2.2.1-2.2.5 | Continuous standard/night/early/late/night-shoot calls | Wording, hour bands, quantities and examples unchanged except published money. | Rate-data only |
| 2.3 | Non-Shooting Days | Changed as fully redlined above. | Calculator logic |
| 2.4(i)-(vi) | Weekend/holiday basic, night and continuous days | Identical. | No app impact |
| 2.4(vii)-(viii) | Weekend/holiday prep, recce, build and strike | Identical; creates a precedence issue with new clause 2.3 prep wording. | Logic validation |
| 2.4(ix)-(xiv) | Weekend/holiday pre-light, rest and travel days | Identical. | No app impact |
| 3.1 | Travel Time | One new equipment-hire exclusion; all other travel-time wording identical. | Calculator logic |
| 3.2 | Travel Expenses | Identical 50p, M25 and non-London 20-mile-radius rules and examples. | No app impact |
| 3.3 | Travel by Air | Identical four-hour, eight-hour and 24-hour thresholds. | No app impact |
| 4 opening | OT formula and role exclusion | Identical. | No app impact |
| 4.1-4.3 | Weekday OT grades | Boundaries changed; coefficients unchanged. | Logic/data |
| 4.4 | OT After Midnight | Identical triple-time window and continuity rule. | No app impact |
| 4.5 | OT Charge Rounding | Identical per-minute/30-minute rounding language. | No app impact |
| 4.6-4.7 | Saturday/Sunday/holiday OT | Identical. | No app impact |
| 5 | Time Off the Clock | Identical 11-hour rule and remedy. | Rate-data only |
| 6.1-6.4 | Breaks and Continuous-Day breaks | Identical thresholds, timing, penalties and compensation. | Rate-data only |
| 7 | Cancellations | Identical. | No app impact |
| 8 | Payment | Identical. | No app impact |
| 9 | Holiday Pay | Identical. | No app impact |
| Force Majeure paragraph | Cancellation consequence | Identical. | No app impact |
| Appendix 1 table | Roles, min/max rates, grades and coefficients | Role list, classifications, grades and coefficients unchanged; monetary rates updated. | Rate-data only |
| Appendix 1(a) | PM/PA/Runner treatment | Identical. | No app impact |
| Appendix 1(b) | Casting Director sessions | Structure and character thresholds identical; fees only changed. | Rate-data only |
| Appendix 1(c) | Programmable Lighting Desk Operator definition | Identical. | No app impact |
| Appendix 2 | Force Majeure definition | Identical. | No app impact |

## Worked-example audit

Every worked example retains the same call/wrap times, day-length assumptions, charge components, multipliers and number of chargeable units. Their sterling inputs and totals were updated to the 2026 rate card. No example introduces a new rule. The only example-adjacent structural change is deletion of the Prep Day row from the clause 2.3 summary table.

## Suggested minimum tests

1. Weekday prep booked 8, worked 8 → 8×BHR, no OT.
2. Weekday prep booked 8, worked 9 or 10 → all worked hours at BHR, no OT under the literal 2026 wording.
3. Weekday prep booked 10, worked 11 → 10×BHR + 1 standard OT hour.
4. Recce/build/strike worked 9 without a break → 8×BHR + 1 standard OT hour.
5. Saturday prep worked 9 → 8×1.5BHR + 1×1.5BHR OT under clause 2.4(vii).
6. Sunday/bank-holiday prep worked 9 → 8×2BHR + 1×2BHR OT under clause 2.4(viii).
7. Equipment collected for production from a third party → retain base-to-base working time.
8. Equipment hired from the crew member → suppress that base-to-base treatment.
9. BDR boundary tests: £458=Grade I; £459=Grade II; £696=Grade II; £697=Grade III.
