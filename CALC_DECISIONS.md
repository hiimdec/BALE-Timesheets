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

## Sept 2026 terms — prep day (clause 2.3): **IMPLEMENTED — ONE READING FLAGGED** (Phase 12)

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

**FLAGGED — a reading, not a certainty (founder checking against practice):**
hours 9 and 10 on an 8-hour booking are billed at **BHR**, not OT, and the
threshold attaches to hours **worked**, never inferred from the booking. That
is the literal text of both the clause and the change log ("do not infer the
OT threshold from the selected 8-hour booking"), and it is what ships. It is
also £44.40/hr *against* the crew relative to 2025 (`PREP2`: a 10h weekday
prep pays £444.00 under 2026 terms where 2025 paid £488.40). The whole reading
lives in **one place** — the `prepOtAfter10` emit block in `calculateDay` —
so a different ruling is a small change, and `PREP1`/`PREP2`/`PREP6` are the
pins that move with it.

**Deliberately untouched:** `travelBarNet` keeps prep at 8 — the §3.1
travel-absorption bar is a separate rule the 2026 terms do not amend, and
raising it to 10 would quietly absorb more travel pay (crew-unfavourable).
Claim-and-flag: left at 8, flagged here. `DEFAULT_HOURS` ("Prep Day": 8, wrap
derivation) and PMPA (§2-exempt) also unchanged.
