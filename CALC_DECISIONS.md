# CALC_DECISIONS — judgement calls awaiting Derrick's ruling

The 2026-07 adversarial calc audit split its findings in two. The confirmed
boundary bugs are FIXED on `fix/calc-audit` (TIME_EPS floating-point guard,
curtailed-lunch double-pay on hourly structures, Sunday/BH triple gated to
OT — see the three commits and `scripts/build-vs-source-audit/calc-boundary-assertions.js`).
Everything below is deliberately NOT fixed: each item hinges on an internal
contradiction or ambiguity in APA_RULES.md, and picking a reading in code
without checking the actual APA Recommended Terms (September 2025 PDF) would
be a guess. The engine's current behaviour is defensible in every case.

> **Editorial note first:** APA_RULES.md itself carries the contradictions
> that block these rulings — §2.1.5 vs §2.2.2/§2.2.5 (night flat vs night
> CWD), the §2.1.3 header "(Mon–Fri" vs its own prose "applies all 7 days",
> and §6.2's "charged at BHR" vs the cheat sheet's "30m × BHR" for a missed
> first break on a night shoot. Once each item below is ruled, APA_RULES.md
> needs an editorial pass so the rulebook and the engine agree in writing.

All £ figures use a grade I £444 BDR (BHR £44.40, OT £66.60, 2× £88.80,
3× £133.20) unless stated; impacts scale linearly with BDR.

---

## A4 — Missed first break on a night shoot: no charge is emitted

**Rulebook conflict.** §6.2 (table row): *"Missed on a night shoot: Charged
at BHR."* Cheat sheet (1st-break row): *"On night shoot: 30m × BHR."* The two
lines agree a charge is owed but disagree on the amount (1h × BHR = £44.40 vs
30m × BHR = £22.20).

**Engine today.** No charge line at all. The worked-through hour is paid at
the flat night 2× BHR (it is worked time, so it lands in the hourly line) and
the £7.50 meal allowance fires only if `noMealProvided` is set — but the
§6.2 night-missed-break charge itself is never emitted.

**Readings.**
1. Charge 1h × BHR on top (literal §6.2): +£44.40 per occurrence.
2. Charge 30m × BHR on top (cheat sheet): +£22.20 per occurrence.
3. No separate charge (current engine): the hour is already paid at 2× as
   worked time; read "charged at BHR" as describing that pay, not a penalty.

**Direction.** Readings 1–2 mean the engine currently **under-pays** crew by
£22.20–£44.40 per continuous night. Frequency: high — nights routinely run
through without a sit-down break.

**DERRICK TO RULE:** whether a separate charge is owed for a missed first
break on a night shoot, and if so the amount (1h or 30m × BHR).

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

## B2 — Early-call premium on Saturday

**Rulebook conflict.** §2.1.3's heading: *"Early Call: 05:00–07:00 (Mon–Fri,
applies all 7 days)"* — the header says Mon–Fri, the parenthetical prose says
all 7 days. (On Sunday/BH the question is moot: the hourly 2× BHR structure
already pays the early hours from call.)

**Engine today.** No early premium on Saturday: a Sat 06:00 call pays the
flat 1.5×BDR only (verified £666.00; premium reading would add 1h × 1.5× BHR
= £66.60 → £732.60).

**Direction.** If "all 7 days" is right, the engine **under-pays** £66.60
per Saturday early call (scales: 1h × Sat OT rate).

**DERRICK TO RULE:** does the 05:00–07:00 early-call premium apply on
Saturday? (Confirm against the actual terms; the September 2025 PDF's §2.1.3
wording decides it.)

---

## B3 — Travel-time threshold: span vs net worked hours

**Rulebook text.** §3.1: *"If travel time + working time totals less than
11 hours, no travel time is payable."* Read literally that is a GATE on net
working time + travel. The in-app explainer documents a third model
(absorption into the unused basic day). The engine implements none of the
three exactly.

**Engine today.** Pays travel beyond `11h − SPAN`, where span = call→wrap
INCLUDING the unpaid lunch hour. Measured (2h door-to-door each way, so 1h
each way after the first-hour deduction = 2h deductible travel):

| Day | Net worked | Engine pays | Gate reading | Absorb reading |
|---|---|---|---|---|
| 08:00–19:00 (11h span) | 10h | 2h (£88.80) | 2h | 1h |
| 08:00–18:00 (10h span) | 9h | 1h (£44.40) | 2h | 0h |
| 08:00–17:00 (9h span) | 8h | 0h | 0h (8+2 < 11 → wait, 10 < 11 → £0) | 0h |

The engine effectively counts the unpaid lunch hour as "working time" for
the threshold. On full 11h-span days it lands on the gate reading; on
shorter days it under-pays the gate reading by up to 1h × BHR and over-pays
the absorb reading.

**Direction.** ±£44.40–£88.80 per travel day depending on the ruling and
the day length. Not consistently favourable in either direction.

**DERRICK TO RULE:** the intended basis — (a) gate on NET work + travel
(≥11h → all deducted travel payable), (b) absorption into the unused basic
day, or (c) current span-based hybrid. Also whether lunch counts as
"working time" for the threshold.

---

## B4 — Break penalties on nights charged at 2× BHR

**Rulebook.** §6.3/§6.4: missed 2nd break / CWD breaks = *"30 min × BHR"* —
flat, no night uplift. Engine (deliberate, per the code comment "matching
the flat night-shoot rate per APA §2.1.5"): on nights these penalties charge
at 2× BHR (£44.40 half-hour instead of £22.20).

**Direction.** Crew-favourable **over-charge** of +£22.20 per missed break
on a night. Invoice-dispute risk if production reads §6.3 literally.

**DERRICK TO RULE:** keep the night uplift or align to the literal
30m × 1× BHR.

---

## B5 — Curtailment top-up rate on Saturday: "single time" vs prevailing rate

**Rulebook.** §6.2 (curtailed, no OT worked): crew is *"paid for the
curtailed minutes at single time."* On a Saturday no-OT day the engine pays
the top-up at the prevailing 1.5× BHR (30m = £33.30) rather than literal
single time (£22.20). Weekday pays 1× (literal). Note: after fix A2 this
only arises on the FLAT structures (weekday/Saturday) — Sunday/BH and nights
no longer emit a top-up at all (the hourly pay already covers the minutes).

**Direction.** Crew-favourable **over-charge** of +£11.10 per Saturday
curtailment.

**DERRICK TO RULE:** keep the prevailing-multiplier reading ("single time"
= the day's non-OT rate) or align to literal 1× BHR.

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

## B7 — PMPA simplifications (deliberate, confirm)

Appendix 1 §(a) crew (PM / PA / Runner / Floor Runner) are exempt from
§2/§3/§4/§5/§6. Two engine choices to confirm:

1. **Travel Day pays flat BDR** rather than the §2.4(xiii) min-5h × BHR
   (which §3 would give general crew). Over-pays vs a 5h×BHR reading
   (£238 vs £119 for a Runner) — deliberate simplification, favourable.
2. **Mileage is still payable** if entered, although §3 (travel expenses)
   is excluded for PMPA. User-entered, so effectively opt-in.

**DERRICK TO RULE:** confirm both simplifications (or align Travel Day to
min-5h × BHR and suppress PMPA mileage).

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

*Compiled 2026-07-12 on `fix/calc-audit` from the adversarial audit findings.
Fixes A1–A3 are implemented and pinned; every item above awaits a ruling
against the actual APA Recommended Crew Terms (September 2025).*
