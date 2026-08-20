# CALC_DECISIONS — rulings ledger for the calc engine

The 2026-07 adversarial calc audit split its findings in two. The confirmed
boundary bugs were FIXED first (TIME_EPS floating-point guard, curtailed-
lunch double-pay on hourly structures, Sunday/BH triple gated to OT). The
judgement calls below were then **adjudicated by Derrick on 2026-07-12
against the actual APA Recommended Terms PDF** (`APA RULES.pdf`, repo root —
effective 1 Sept 2025), and the approved corrections implemented on
`fix/calc-audit` with expected-£ pins in
`scripts/build-vs-source-audit/calc-boundary-assertions.js`. Status per
item: **RESOLVED — IMPLEMENTED**, **RESOLVED — KEEP**, **DEFERRED**, or
backlog. Every resolved entry quotes its PDF citation.

> **Editorial note:** APA_RULES.md (the markdown reconstruction) carried
> contradictions the PDF resolves — §2.1.5 vs §2.2.2/§2.2.5 (basic night vs
> continuous night: BOTH are real, distinct day types), §2.1.3's boilerplate
> Mon–Fri opener vs its explicit "Early call rule applies on all days
> throughout a week, Monday to Sunday" sentence (the sentence governs), and
> §6.2's night-row amount (the first break is one hour, so 1h — the cheat
> sheet's "30m" conflated it with the second break). APA_RULES.md still
> needs that editorial pass so the reconstruction matches the PDF and the
> engine; until then the PDF is the only authority.

All £ figures use a grade I £444 BDR (BHR £44.40, OT £66.60, 2× £88.80,
3× £133.20) unless stated; impacts scale linearly with BDR.

---

## A4 — Night missed-break charges: **RESOLVED — IMPLEMENTED** (Derrick, 2026-07-12)

**PDF citations.** §6.2: *"Your first break of one hour will begin no more
than 5½ hours after work has commenced"* and its night row: *"If Missed on a
night shoot — Missed break on a night shoot is charged at basic hourly
rate."* §6.3: second break is half an hour, identical night row. The break
durations settle the amounts: the first break's charge covers 1 hour, the
second's 30 minutes.

**Ruling on the rate.** Derrick rules all break penalties on nights charge
at the prevailing **2× BHR** — a deliberate crew-favourable choice, uniform
across the 1st-break, 2nd-break and CWD-break charges, because the night day
operates at double time. **This exceeds the literal single-rate reading**:
the PDF's night rows say "basic hourly rate", and its own §2.2.2 night-CWD
example prices the missed 30m break at £39 = single BHR for a £785 1st AD.
Recorded here explicitly as a chosen generosity, not an oversight, so it is
defensible if a producer queries an invoice against the literal terms.

**Implemented.** New line "Missed 1st Break (night)": 1h × 2× BHR (£88.80
@£444), gated on `lunchMissed` (a very-late-but-taken break converts the day
via §6.2 **without** this charge — pinned). It stacks with the B1
continuous-night conversion per the ruling (separate concerns: pay structure
vs missed-break charge). The missed/late 2nd break on nights stays at
30m × 2× BHR (unchanged, now pinned as deliberate).

**Nuance recorded for future reference:** the app cannot distinguish a day
*booked* as a continuous night (where no first break was ever scheduled —
the shape of the PDF's £1,727 example, which carries no missed-break charge)
from a night whose break was *missed*; `lunchMissed` is the only signal, so
every no-lunch night carries the charge. Crew-favourable; if a producer
disputes a booked-CWD night, the charge line is the item to discuss (a
"booked CWD" flag would be the carve-out if ever needed).

Probe delta: H06 £1,028.70 → £1,117.50. Pins: S19–S20 + stageA4
(5 assertions), B1 pins re-anchored at line level (structure unchanged).

---

## B1 — Continuous nights: **RESOLVED — IMPLEMENTED** (Derrick, 2026-07-12)

**Ruling.** §2.2.2/§2.2.5 govern a night that runs continuous; §2.1.5's flat
model governs basic (non-continuous) nights. Implemented on `fix/calc-audit`.

**PDF citations (authoritative source, re-spaced from the letter-spaced
extraction).** §2.2.2: *"If your call time is before 5 a.m. and the day is a
Continuous Working Day, we will pay you double basic daily rate. … Overtime
will apply after 9 hours from the call time and is charged at double basic
hourly rate."* §2.2.5: same structure for 5 p.m.–5 a.m. calls ("The day
includes 9 hours in total."). Decisively, the PDF's own §2.2.2 worked
example prices a 1st AD (£785), call 03:00 wrap 13:00, as **1×£1,570 (2×BDR
covering 03:00–12:00) + 1×£157 (OT hour) = £1,727** — OT meters from hour
NINE. (My earlier table here said the models "coincide up to 10h" — wrong:
the divergence ramps from 9h and holds at 1h × 2×BHR from 10h on.)

**Implemented.** Night branch: when `continuousDay` (the §6.2-conversion
flag — first break missed or started past 6.5h) AND the call date is a
weekday, pay `2×BDR + ceilHalf(max(0, wrap − (call + 9h))) × 2×BHR` —
clock-based, no lunch deduction (mirrors the weekday CWD), no triple after
midnight (clause prices night-CWD OT at 2×BHR; §2.1.5's no-triple covers
night engagements), no separate min-10h (2×BDR ≡ the old 10h floor, so ≤9h
days are payout-identical). Basic nights stay flat (pinned, no regression).
**Weekend/BH nights stay flat** per the explicit §2.4(iii)/(iv) night rows —
§2.2.2/§2.2.5 carry the Mon–Fri opener with no all-days override (unlike
§2.1.3). Engine's PDF-example output verified: **£1,727 exactly**.

Probe-scenario deltas (their old values embedded the under-payment): F01
£932.40 → £1,021.20; H06 £939.90 → £1,028.70 (before A4's separate charge).
Pins: S14–S17 + stageB1 (7 assertions incl. the PDF example to the pound).

## §2.4(vi) — Sunday/BH continuous days: **RESOLVED — IMPLEMENTED** (Derrick, 2026-07-12)

Surfaced during the PDF confirmation pass (was not in the original audit —
the audit had checked the Sunday CWD against the hourly model, not §2.4(vi)).

**PDF citation.** §2.4(vi): *"Continuous Working Day if on Sundays, Bank
Holidays and Statutory Holidays means you will be paid at two times your
basic daily rate. Overtime commences after 9 hours from the call time. For
each overtime hour, you will get paid double your basic hourly (2xBHR)
rate."*

**Implemented.** Sunday/BH Shoot arm: when `continuousDay`, pay
`2×BDR + OT after 9h from call at 2×BHR`, clock-based, with §4.7's
after-midnight OT at triple retained via the A3 OT-gated split. ≤9h
continuous days pay 2×BDR ≡ the old hourly min-10h floor (payout-identical).
Saturday §2.4(v) already matched the engine — untouched, pinned. 12h Sunday
CWD: £1,065.60 → **£1,154.40** (+£88.80 at £444; scales with BDR). The A3d
boundary pin updated accordingly (£932.40 → £1,021.20 — the day fee is
2×BDR, not hourly, under the ruled structure). Pins: S18 + stageSunCwd
(4 assertions incl. BH-Monday labels and the Saturday no-change guard).

---

## B2 — Saturday early-call premium: **RESOLVED — IMPLEMENTED** (Derrick, 2026-07-12)

**PDF citation.** §2.1.3: *"Early call rule applies on all days throughout a
week, Monday to Sunday."* The clause's "provisions apply to weekdays ie
Monday to Friday" opener is the section template (§2.1.4/§2.1.5 carry it
verbatim); §2.1.3 is the only §2.1.x clause with an all-days override
sentence, so the sentence governs.

**Implemented.** The Saturday Shoot arm emits the early-call line exactly as
the weekday branch does: `ceilHalf(7 − callH)` hours at the **Saturday OT
rate (1.5× BHR** per §2.4(i)/§4.6), gated on `!crew.noOT`, Shoot and CWD
alike; the OT threshold (11h from call, 9h on a CWD) is unchanged, and the
05:00–07:00 band is disjoint from the night bands — no double-count against
the flat 1.5×BDR day fee. **Sunday is a documented no-op**: the hourly
2×BHR-from-call structure already pays 05:00–07:00 at §4.7's Sunday OT rate
(2× BHR), which is the premium.

Verified: Sat 06:00 call £666.00 → **£732.60**; Sat 05:30 → £765.90; Sat
07:00 boundary unchanged £666.00; Sat early CWD £865.80 (premium + OT after
9h, mirroring §2.2.3); noOT crew gets no premium; Sunday 06:00 unchanged
£888.00. Pins: S21–S23 + stageB2 (6 assertions).

---

## B3 — Travel time on a working day: **RESOLVED — IMPLEMENTED** (Derrick, 2026-07-13)

**PDF text.** §3.1: *"Travel time is always paid at single time, regardless
of time, or day of the week. If travel time & working time total less than
11 hours, then no travel time is payable."* Plus the Travel-on-a-Basic-
Working-Day row: paid *"less the first hour of the outward and homeward
journey."* §6.2's note makes the lunch break not part of the working day.

**Derrick's model (fully specified, supersedes the old span-based
`gap = max(0, 11 − span)` hybrid).** Billable travel — after the first-hour
deduction EACH WAY, unchanged — pays only to the extent it exceeds the day's
shortfall against a **net-worked full-day bar**:

```
onClock    = netWorked (= span − lunch actually taken) + raw pre-call hours
shortfall  = max(0, barNet − onClock)
travelPaid = ceilHalf(max(0, billableTravel − shortfall)) × 1× BHR
barNet     : Shoot & basic night 10 (11 on an 11-hour-day arrangement)
             any CWD 9 · Prep/Recce/Build/De-rig 8 · Pre-light 8
```

**The three resolved parameters.**
1. **Pre-call counts** toward onClock (raw hours; the old `preUnitHrs = 0`
   exclusion is deleted).
2. **Late calls are emergent** — no special term: netWorked measured from the
   actual call against the full bar makes the notional 11:00→call hours the
   shortfall (13:00→22:00 absorbs 2h; 12:00→22:00 absorbs 1h — both pinned).
   Ruled: an early wrap widens the absorption to the full shortfall
   (conservative).
3. **Per-day-type bars** replace the hard-coded 11, as listed.

**Threshold-shift / curtailment reconciliation.** Curtailing lunch by X
shifts the travel threshold X earlier via netWorked itself (a shorter lunch
is already more worked span) — **no separate credit term**; an explicit
credit would double-count the worked-through minutes, since
span − actualLunch already contains them. One uniform rule with OT (whose
basicHrs shifts by the same X). The ruled C-case: call 08:00, wrap 18:00,
30m lunch → threshold 18:30, wrapped 30m short → travel 2h − 0.5h =
**1.5h £66.60**, PLUS the £22.20 §6.2 curtailment top-up (each half-hour
counted once). Day total £532.80.

**Travel rate is always 1× BHR** — pinned on night, Saturday and Sunday-CWD
days (worked hours at 2×/1.5×/2×, travel at £44.40/h).

**£ direction vs the old span model** (all at £444, 2h billable): full CWD
£0→£88.80, full Prep/Pre-light £0→£88.80, curtailed C-case £44.40→£66.60,
pre-call-backed short day £44.40→£88.80 — under-payments corrected; full
standard/Sat/Sun/night days and the fully-absorbed shapes are unchanged.
Travel DAY (min-5h × BHR branch), PMPA (§3 excluded) and mileage untouched.
All pre-existing scenarios byte-identical (none carried travel-time fields —
verified before and after). Pins: scenarios S24–S36 + stageB3 (13
assertions incl. the three 1×-rate guards).

---

## B4 — Break penalties on nights at 2× BHR: **RESOLVED — KEEP** (Derrick, 2026-07-12)

**Ruling.** Keep the 2× BHR (double) rate on all night break penalties —
1st break (the new A4 charge), 2nd break, and the CWD 9h/12.5h breaks —
uniformly at the prevailing double rate, because the night day operates at
double time. A **deliberate crew-favourable interpretation that exceeds the
literal terms**: the PDF's §6.2/§6.3 night rows say "charged at basic hourly
rate", and its own §2.2.2 night-CWD worked example prices the missed 30m
break at £39 = single BHR (£785 1st AD). Recorded as a chosen generosity,
not an oversight — the defence if a producer queries an invoice line against
the literal terms is that the choice is intentional and consistently
applied. Day-shift penalties stay at single BHR per §6.3/§6.4. The code
comment at the `breakPenaltyRate` definition carries the same note.

---

## B5 — Saturday curtailment top-up rate: **RESOLVED — KEEP** (Derrick, 2026-07-12)

**PDF.** §6.2 (curtailed, no OT worked): crew is *"paid for the time by
which their break was curtailed at single time."* On a Saturday no-OT day
the engine pays the top-up at the prevailing 1.5× BHR (30m = £33.30) rather
than literal single time (£22.20); weekday pays 1× (literal). After fix A2
this only arises on the FLAT structures — Sunday/BH and nights no longer
emit a top-up at all (the hourly pay already covers the minutes).

**Ruling.** Keep — crew-favourable by +£11.10 per Saturday curtailment,
same "prevailing rate on a double/uplifted day" philosophy as B4.

---

## B6 — Defensive-default gaps (robustness hardening, low reachability)

Not rulebook conflicts — engine fallbacks that only bite on hand-made or
corrupted data. The normal UI seeds all of these correctly.

1. **Missing `otCoef` falls back to 1.0**, not `autoOtCoef(bdr)`. A grade I
   crew record with a stripped coefficient pays OT at 1× BHR instead of
   1.5× (verified: £330 + penalties vs £360 grade-correct — an under-pay of
   £15/OT-hour at £300 BDR). Suggested hardening: fall back to
   `autoOtCoef(bdr)`.
2. **Step-up to a hand-typed role with no `stepUpOTCoef`** inherits the
   crew's own coefficient (verified: Spark 1.5 stepping to a £568 custom
   role pays OT £85.20/h vs grade II £71.00 — over-pay £14.20/h). The role
   picker seeds coefficients from the rate card, so this needs a free-typed
   role.
3. **`noOT` does not carry through step-up**: stepping up to Director/
   Producer would pay OT on a £933+ BDR. No real-world path today.

**DERRICK TO RULE:** priority for hardening these three (suggest: bundle
into the next calc-touching release; none is reachable from the UI today).

---

## B7 — PMPA simplifications: **RESOLVED — KEEP** (Derrick, 2026-07-12)

Appendix 1 §(a) crew (PM / PA / Runner / Floor Runner) are exempt from
§2/§3/§4/§5/§6 (PDF §3 note confirmed verbatim: *"None of the provisions of
clause 3 shall apply to PM's, PA's or Runners"*). Both engine choices
confirmed as deliberate:

1. **Travel Day pays flat BDR** rather than min-5h × BHR — favourable
   simplification (£238 vs £119 for a Runner).
2. **Mileage stays payable** if entered — user-entered, effectively opt-in.

---

## B8 — Latent tripwires (guarded assumptions, no action needed today)

1. **Bank holiday on a Saturday** would resolve as Saturday 1.5× rather than
   BH 2× — `treatAsSat` is checked before `treatAsSun` in both engines.
   UNREACHABLE with the current UK_BANK_HOLIDAYS table (every gazetted
   E&W holiday 2025–2035 is a weekday; weekend holidays are listed as their
   Monday/Tuesday substitutes, matching gov.uk). This is a **guarded
   assumption**: if the table is ever extended with a raw weekend date, the
   branch order silently under-pays 0.5× BDR. Guard suggestion for the next
   calc-touching release: an assertion (or table-load check) that no
   UK_BANK_HOLIDAYS key falls on a Saturday/Sunday.
2. **Short-day missed lunch labels the day CWD** (e.g. call 08:00, wrap
   13:00, no lunch → `continuousDay: true`) even though §6.2 converts only
   once 6.5h have elapsed. Verified **money-neutral** (flat BDR either way;
   CWD break penalties can't fire before the 9h deadline) — cosmetic only
   (day label/chip reads CWD). Fix opportunistically whenever the break
   state machine is next touched.

---

*Compiled 2026-07-12 on `fix/calc-audit` from the adversarial audit findings;
adjudicated by Derrick against the actual APA Recommended Terms PDF.
Implemented and pinned: A1–A3 (boundary bugs), B1 + §2.4(vi) (continuous
double-rate days), A4 (night missed-break charge, ruled 2×), B2 (Saturday
early call), B3 (travel-time gate, net-worked model, 2026-07-13). Kept
deliberately: B4 (night penalties at 2×), B5, B7. Backlog: B6, B8. Remaining
follow-ups: the APA_RULES.md editorial pass, and the optional "booked CWD"
carve-out noted under A4.*

---

## Sept 2026 terms — OT grade boundaries: **RESOLVED — IMPLEMENTED** (Phase 12)

**Source:** `APA_CREW_TERMS_2026.md` clauses 4.1–4.3 (repo root; PDF at
`apa-crew-terms-sept-2026.pdf`, p.9), effective 1 September 2026.

> 4.1 Grade I (Basic Daily Rate £0 – £458) … one and a half times (1.5)
> 4.2 Grade II (Basic Daily Rate £459 – £696) … one and a quarter times (1.25)
> 4.3 Grade III (Basic Daily Rate £697 and more) … one times (1.0)

**The clause supersedes an inference.** Phase 6 had only the rate CSV, so the
2026 ceilings were *derived* from each grade's role maximum on the card, giving
`{ '1.5': 457, '1.25': 694 }`. Those figures were never wrong by much — the
uplift happened to land near them — but they were a derivation, and the terms
now state the boundaries outright: **458 and 696**. Both corrected. Anywhere the
earlier reasoning survives (the Phase 6 commit message `6130901`, and the
superseded code comment) should be read as history, not as the rule.

The boundaries **abut exactly** — £696 then £697 — so no BDR can fall in a gap
between grades. Pinned as such (`OTG2b`), because the adjacency is the property
worth protecting, not the two numbers on their own.

**Card-versioned, not global.** The ceilings live in `otGrades` on the Sept 2026
card only. The 2025 card carries none, so a production that started before
1 September keeps the legacy thresholds for its whole run, September days
included. `OTG2c` pins both directions with rates that genuinely diverge (£458
is Grade I under 2026 but Grade II under legacy; £696 is Grade II under 2026 but
Grade III under legacy), so it cannot pass by the two paths agreeing.

**Reach:** these ceilings are read *only* by `autoOtCoef`, the card-less-role
fallback. A role that exists on the card always takes its own `otCoef`, so for
every pickable role this changes nothing — which is why no calc pin moves.

---

## Sept 2026 terms — card-versioned RULES (`apaTerms`): **RESOLVED — IMPLEMENTED** (Phase 12)

**The "numbers only" invariant now has exactly one documented exception.**
Since the cards landed, the rule has been: cards carry figures, never rules —
the engine is card-invariant and an existing production never moves when a new
card is published. The Sept 2026 prep-day rewrite is the first *rule* change
that must version with the card, so the mechanism gains one exception, built
narrow on the `apaRounding` precedent:

- The Sept 2026 card carries `terms: { prepOtAfter10: true }`. The 2025 card
  carries no `terms` key; absent means existing behaviour.
- `resolveApaTerms(startDate)` (= `resolveRateCard(startDate).terms || {}`)
  resolves the term set from the **production start date**, so an
  August-started shoot keeps 2025 rules for its whole run, September days
  included — same retroactivity contract as the rates.
- Resolution happens at exactly **one** call site: the `calcForDisplay` spread,
  beside `apaRounding`. The engine reads `weekendOpts.apaTerms` and never
  resolves a card itself — it stays pure-by-parameter.
- **A future rule change extends this term set; it does not add a second
  mechanism.** `PT3` pins single-sitedness (one definition, one call site);
  `PT1`/`PT2` pin the card shape and the resolver; `RW1` auto-caught the new
  engine read and its writer declaration names the call-site resolution.

## Sept 2026 terms — prep day (clause 2.3): **RESOLVED — CONFIRMED** (founder, 2026-08, Phase 13)

**Source:** `APA_CREW_TERMS_2026.md` lines 578–579 (PDF p.4), effective
1 September 2026, card-versioned via `apaTerms` (above):

> Preparation days can be booked for 8 hours or 10 hours. Overtime shall only
> apply after 10 hours have been worked.

**Built (founder-ruled, items 1, 3, 4):**

- `prepBookingHours` on the **day record** — `10` or absent (absent = 8, the
  clause's first-listed option and the 2025-shaped default). The booking is a
  charged minimum: 7h worked on a 10h booking still bills 10 × BHR (`PREP3`).
- Prep is **split out** of the shared discretionary branch. Recce, Build Day
  and De-rig keep the byte-identical 2025 path, lunch extension included
  (`PREP6`, `PT5`). For 2026 prep the extension row was *deleted* by the
  rewrite, not revised: the threshold is a flat 10, no lunch shift.
- **Weekday only.** Clauses 2.4(vii)–(viii) are unchanged, so Saturday and
  Sunday/BH prep keep 8h at 1.5×/2× with their own structures; night prep
  (clause silent on nights) keeps 2025 behaviour. Guard:
  `!treatAsSat && !treatAsSun && !isNightShoot`. `PREP4` proves the Saturday
  direction with money (the Saturday branch reads `basicHrs`, so a leak is
  £-visible); the Sunday/BH and night emits do **not** read `basicHrs` today,
  so those two exclusions are pinned at source by `PT4` and tripwired by
  `PREP5` — recorded honestly rather than claimed as money pins.

**CONFIRMED (founder, 2026-08 — Phase 13):** hours 9 and 10 on an 8-hour
booking are billed at **BHR**, not OT, and the threshold attaches to hours
**worked**, never inferred from the booking. Shipped in Phase 12 as the
literal text of both the clause and the change log ("do not infer the OT
threshold from the selected 8-hour booking"), flagged as a reading; the
founder has since checked it against practice and confirmed: *booked 8,
worked 10 is ten hours at basic rate, overtime only after that* — the literal
reading is also the practical one. It is £44.40/hr *against* the crew
relative to 2025 (`PREP2`: a 10h weekday prep pays £444.00 under 2026 terms
where 2025 paid £488.40), and that is the agreed rate, not an open question.
The whole rule stays in **one place** — the `prepOtAfter10` emit block in
`calculateDay` — with `PREP1`/`PREP2`/`PREP6` pinning it.

**Deliberately untouched:** `travelBarNet` keeps prep at 8 — the §3.1
travel-absorption bar is a separate rule the 2026 terms do not amend, and
raising it to 10 would quietly absorb more travel pay (crew-unfavourable).
Claim-and-flag: left at 8, flagged here. `DEFAULT_HOURS` ("Prep Day": 8, wrap
derivation) and PMPA (§2-exempt) also unchanged.

---

## Sept 2026 terms — equipment-hire base-to-base exclusion (clause 3.1): **DEFERRED — RECORDED** (Phase 12, founder-ruled)

**Source:** `APA_CREW_TERMS_2026.md` clause 3.1 note (PDF p.8), effective
1 September 2026:

> Note: base to base is not applicable to equipment hired from the crew member.

The change log's instruction: suppress the base-to-base working-time treatment
when the collected equipment is hired *from the crew member*; keep it for
production/third-party equipment and personnel collection; and — explicitly —
"the document does not provide a replacement paid-travel formula for the
excluded case, so do not invent one."

**The Phase 12 investigation found there is nothing to suppress.** The
base-to-base *collection* rule of clause 3.1 was never implemented. What the
engine implements from §3.1 is the travel-time row only — billable travel
minutes past the net-worked bar (`travelBarNet`, the B3 model). There is no
"collecting equipment" day input, no base-to-base working-time computation,
and therefore no code path the new note can except. An
`equipmentHiredFromCrew` flag today would gate a rule that does not exist —
decoration, the exact class of pin/flag this project deletes on sight.

**Ruling (founder, 2026-08): defer with a record.** No inert flag ships.
Base-to-base collection becomes its own scoped item, and **when it is built,
the exclusion is built in from the start** — the builder starts from this
entry, not from the 2025 text. Two term sets already diverge here at day one:

- 2025-card production: base-to-base applies to ALL collection, including
  crew-hired equipment.
- Sept 2026-card production: crew-hired equipment excluded, no replacement
  formula (do not invent one — no paid-travel fallback for that case beyond
  the ordinary travel-time row).

That will be the second entry in `apaTerms` (see the card-versioned RULES
entry above): extend the term set, do not add a second mechanism.

---

# The stats screen — what it reports and why

Everything below concerns the **stats screen's money figures**. Three phases
changed how that screen reports money and none of them wrote down what the
screen is *for*; the fourth nearly revoked a standing pin (`ST1`) by accident.
These entries exist so the next change starts from a rule rather than from the
code it finds.

**The framing.** The screen answers **two different questions and must not blur
them.**

*Counts and time describe the work* — days, hours, streak, shoot-day length,
night shoots, TOC breaches, late-lunch counts, steps. These read **day records
only** and have never been in scope for any of this.

*Money describes what the user was paid.* Where the app can honestly know what
was **billed**, the money figure reports that. Where it cannot, the figure
reports the **agreement value** and says so on screen.

Which gives the line that governs every entry below:

> **The top-level money total is what was billed. The breakdown figures are
> what the work was worth under the agreement. Both are labelled on screen.
> Neither pretends to be the other.**

**Working rule for anyone editing a money figure here: check the figure next to
it first.** Every defect in this section was a figure that stopped agreeing
with its neighbour — a count against its own money, a chart against its header,
a home card against a day editor.

---

## Stats money — pro-rata attribution across claimed days: **SUPERSEDED** (founder-ruled, Phase 14)

**The question.** A day is covered by a sent invoice. The invoice's total is
known; the day's own calculated value is known. What should the day report?

**The rule at stake.** Earnings should reflect what was actually invoiced,
discounts included — not what the day theoretically computes to.

**The ruling (Phase 14).** Every claimed day reports its **pro-rata share** of
the invoice's final net, weighted by that day's computed total in the invoice's
frozen `dayBreakdown`. The day's whole calc is scaled by `billed / computed`,
lines included, so the basic/OT/penalty buckets still sum to the reported
figure and no two stats surfaces disagree.

**Reach.** Every money figure on the stats screen, plus the home screen's
per-production totals and month headers.

**Superseded by** the Phase 17 entry below. The premise was right and the
granularity was wrong: an invoice records what it billed **in total**, and does
not record how a reduction was split across the days it covers. Splitting it
was an invention, and it moved money between days that were never discounted.

---

## Stats money — an invoice is atomic: **RESOLVED — IMPLEMENTED** (founder-ruled, Phase 17)

**The question.** Same question, asked again after the pro-rata rule produced a
figure nobody could account for.

**The failure that motivated it.** On one production the **recce line was
edited down** on the invoice — from the APA rate to a flat figure — because a
custom recce rate did not exist in the app yet, so the invoice editor was being
used as a rate editor. That single edited line reduced the invoice's net, and
the pro-rata rule then spread that reduction across **every day the invoice
covered**. Worked example, three days:

| day | computed | reported under pro rata | actually billed |
|---|---|---|---|
| the edited recce day | £300.00 | £259.92 | £125.00 |
| an untouched shoot day | £510.00 | £441.87 | £510.00 |
| an untouched shoot day | £500.00 | £433.21 | £500.00 |

The discounted day reported **higher** than it was billed, and the two
untouched days reported **lower**. A flat £10 late-break penalty on the second
day read £8.66. The invoice total stayed exact throughout — the redistribution
preserves the sum — which is precisely why it survived two phases undetected.

**Why inference is impossible.** To attribute a reduction to the right day the
app would have to know *which line was edited and which days fed it*. It cannot:
there is **no invoice-level discount concept**, so a per-line rate correction
and a whole-invoice discount are indistinguishable in stored data. Recorded in
`MAINTENANCE.md` under *"Design gap — no invoice-level discount concept"* —
see it there rather than duplicating it here. That entry also records the
related gap: `buildInvoiceLineItems` computes the per-line date set and
discards it.

**The ruling.** **Billed money is read at invoice granularity and nowhere
finer.** An invoice contributes its net, whole, or contributes nothing. No
per-day claim amount exists to be spent. Where a day is covered by a sent
invoice it contributes nothing of its own; where it is not, it contributes its
own calc.

**Reach.** The stats money figures and the home screen's per-production totals
— two consumers on different paths, both of which had to change. Pinned by
`IE4`, `IE10` (granularity: nothing below invoice level reads a billed amount)
and `WIN1`.

**Supersedes** the Phase 14 pro-rata entry above. **Partly superseded by**
revised Ruling 1 below, which narrows *which* figures read billed money.

---

## Stats money — which figures read billed, which read the agreement: **RESOLVED — RULED** (founder, Phase 18)

**The question.** Phase 17 settled that billed money is read per invoice. It
did not settle *which figures on the screen read it*.

**The rule at stake.** A figure should report the billed amount wherever the
app can honestly know it, and the agreement value wherever it cannot — and it
must never switch between the two silently.

**The ruling.**

- **Total earnings** and **top production company** read the invoice's own
  frozen line items, discounts included, for any day covered by a sent invoice.
  Days not covered report their own calc. Neither figure needs any line to be
  categorised, which is why both are safe.
- **Highest-earning day and its basic / OT / penalty / kit / extras breakdown**
  stay on **day calc for all days**, covered or not. Invoice line items
  aggregate across days, and a discount on an aggregated line cannot be
  attributed to one day without reintroducing exactly the pro-rata attribution
  Phase 17 removed.
- **Overtime earned** and **late lunches earned** stay on **day calc**, the same
  treatment as highest-earning day. *Dropped from this ruling deliberately* —
  see below.
- Every agreement-value figure is **labelled as such on screen**.

**Why overtime and late lunches were dropped.** The first draft had them read
invoice line items. Checked against the code before writing, that cannot be
built reliably — invoice lines cannot be categorised:

1. **The kit marker does not survive.** A day's kit line is classified by a
   hidden `bucket: 'kit'` field, not by its text. `buildInvoiceLineItems` does
   not carry that field, so kit lines fall through to text matching and land in
   *basic*. Present in real data (`"Kit"`, `"Wireless Kit"`).
2. **Aggregation strips the OT marker.** The invoice key is
   `label.split(" (")[0]`, so `Early Call (OT rate)` becomes `Early Call` —
   overtime on the day, *basic* on the invoice. Overtime earned would silently
   shrink.
3. **Labels are user-editable.** A renamed mileage line (`"Milton Keynes ->
   London"` in real data) carries no recoverable category. This is not a gap a
   better rule closes; it is information the app no longer holds.

**And `ST1` stands.** That pin requires the late-lunch **count** and the
late-lunch **money** to read one predicate — written after they drifted and
produced *"2 late lunches, £19.42"*. Moving the money to invoice lines while the
count stayed on day records would reopen exactly that drift. **`ST1` is not
revoked or amended.**

**The fallback was considered and rejected** (founder): fall back to the day
figure when a line cannot be categorised. Rejected because *a figure that
switches basis depending on whether a line was renamed is worse than either
consistent answer*.

**Reach.** The stats money figures only. No calc change; the engine has never
read invoice data and does not now.

**Partly supersedes** the Phase 17 entry, which implied all money figures read
billed. Only total earnings and top production company do.

---

## Stats money — monthly bucketing by work date: **RULED — NOT YET BUILT** (founder, Phase 18)

**The question.** An invoice covers days in one month and is sent in another.
Which month does its money belong to?

**The rule at stake.** Every other figure on the screen is anchored to the
**work** date. Bucketing money by send date makes the chart disagree with the
day counts printed beside it — and makes *busiest month* move when the user
presses Send, which is indefensible.

**The ruling.** **Monthly earnings bucket by the month the work happened.** An
invoice belongs to the month of the **earliest day it covers**. No splitting
across months, no pro rata.

**The tax-year filter stays on a billed basis**, because that is an accounting
question and is labelled as one.

**The accepted consequence, which must be visible.** Running two date bases on
one screen means that under the tax-year filter **the bars will not sum to the
header**: an invoice sent in one tax year for work done in the previous one
counts in the tax-year total while its month sits outside the year on the
chart. This is **accepted and must be stated on screen, not silently
tolerated** — tax year is an accounting question on a billed basis, months are
a *when was I busy* question on a worked basis, and the screen says so.

**Ordering.** Ships **after** the read-time day-link derivation below. Until
that lands, the unlinked invoices have no earliest covered day to bucket by.

**Supersedes** nothing — this is the first ruling on bucketing. It replaces an
unruled behaviour introduced in Phase 17 (bucket by `dateSent`).

---

## Stats money — unlinked invoices, read-time day derivation: **RULED — NOT YET BUILT** (founder, Phase 18)

**The question.** An invoice records which days it covers. That record did not
exist before 17 August 2026, and the `dayBreakdown` it falls back to only from
10 August. Ten of one real dataset's fourteen sent invoices therefore name **no
days at all** — not corrupt, simply older than the field. Under the Phase 17
rule their money is excluded entirely. Can the link be recovered?

**The rule at stake.** An invoice whose days are unknown must never have its
net added on top of days that also compute — that was the doubling defect
(£568 day + £568 invoice = £1,136 on the home card). But excluding it loses
real billed money, including any discount on it.

**The ruling.** **Derive the day link at read time. Never write it back to a
frozen invoice.** Derive only when **all three** hold:

1. the invoice has no `dayBreakdown`;
2. its `shootDateStart`–`shootDateEnd` range resolves to days on that
   production;
3. **no other sent invoice on that production claims any of those days.**

Where `userCrewId` is absent, resolve ownership by the rule the app already
uses (`userCrewIdsInProduction` — see the ownership entry in `HANDOVER.md`'s
lessons). **If any guard fails, behave as today and do not count that invoice's
money.**

> **Under-claiming beats mis-attributing.**

**Evidence it is derivable.** Tested against the real dataset: **9 of the 10**
derive exactly all the user's days from `userCrewId` plus the date range, none
derive a subset, and the tenth fails only because it predates `userCrewId`
entirely — its dates match its production's days precisely, and the production
has a single crew member. No production in that dataset has more than one sent
invoice, so guard 3 is satisfiable throughout.

**What it restores.** Those jobs report what was invoiced rather than what the
days compute. For most that is the same figure; it matters for the two whose
lines were edited, one of which carries a real per-line discount.

**Known limitation, deliberately accepted.** `shootDateStart`/`shootDateEnd`
describe the shoot, they are not a record of what was billed. On the real data
they coincide exactly. They would not necessarily coincide on a job invoiced in
parts, or where a day was added inside the range after the invoice was sent —
which is what guard 3 and the no-`dayBreakdown` guard exist to catch.

**Reach.** Read path only. No stored data changes, no migration, no frozen
invoice mutated.

**Supersedes** nothing. It narrows the Phase 17 exclusion without weakening it.
