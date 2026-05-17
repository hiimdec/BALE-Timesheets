# TimeMachine v3 — pre-launch audit

Single-pass triage after the v3 sweep (V3-1 → V3-17). Findings only; no code changes in this pass.

Severity legend: **P0** = broken / data loss / wrong calc · **P1** = visible regression users will notice · **P2** = polish · **P3** = note / future.

---

## 1. Stale design tokens

### Amber survivors (should be `tm-warn`)

- **(P1)** DayEditModal (~4226, ~4235) — calc-meta hints `text-amber-400` for OT badge inside the modal. One-line fix: swap to `text-tm-warn`. Surface: every time a user opens a day edit modal in Best Boy grid.
- **(P1)** DayEditModal note char-counter (~4809) — `text-amber-400` for the >500 char warning state on Notes textarea. Swap to `text-tm-warn`.
- **(P1)** DayEditModal `lineColor` / `lineCls` (~4842) — the calc breakdown table inside the modal uses an internal `'red'/'amber'/'neutral'` mapping returning `text-red-300`/`text-amber-300` etc. Reroute through tm-warn/tm-pen for consistency. This is a small refactor but affects the most-viewed table in the app.
- **(P1)** DayEditModal calc footer pills (~4952) — `bg-amber-900 text-amber-200` "OT Xh" chip and `bg-red-900 text-red-200` penalty chip. Swap to the v3 chip styling used in the breakdown's BY DAY rows (`bg-tm-warn/10 text-tm-warn border-tm-warn/25` etc).
- **(P1)** GridCell flag chips (~5021–5025) — best-boy grid cell chips: OT (`bg-amber-900 text-amber-200`), CWD (`bg-red-900 text-red-200`), L1 (`bg-red-900 text-red-200`), MSB (`bg-red-900 text-red-200`), TOC (`bg-amber-900 text-amber-200` / breach `bg-red-900 text-red-200`). Same token swap to tm-warn / tm-pen. Most visible inconsistency on best-boy grid.
- **(P1)** Best-boy grid Sun/Sat column headers (~5150–5151, 5200–5201) — `bg-red-950/60 text-red-400` and `bg-amber-950/60 text-amber-400` for Sun/Sat columns; `bg-red-950/40` / `bg-amber-950/40` for body cells. Per V3-10 the rule is Sun → tm-pen, Sat → tm-warn. Refactor.
- **(P1)** Best-boy grid CWD label on row (~5922) — `bg-red-900 text-red-200`. Swap.
- **(P1)** Best-boy grid `border-amber-500` accent ring on day cells with OT/CWD (~5908) — swap to `border-tm-warn`.
- **(P1)** Production-settings status hint (~3435) — `bg-amber-900/40 text-amber-400` "custom weekend" pill. Swap to `bg-tm-warn/10 text-tm-warn`.
- **(P1)** LunchNowBtn "confirming" state (~5638, 5648) — `bg-amber-500/10 border-amber-500 text-amber-300`. Was an intentional warn signal in early phases; aligns now to `tm-warn` tokens.
- **(P1)** DiscountModal — `text-amber-400` Waived chip + saving line (~9088, 9107, 9211, 9352, 9356). Five occurrences. Swap to tm-warn.
- **(P1)** ChangelogBanner / "What's new" tile (~8993–9001) — `bg-amber-900/20 border-amber-700/30 text-amber-300` for the modal. Swap to a tm-warn or sky-tinted card.
- **(P1)** AllInvoicesView "Set up invoicing" empty state (~10216) — `bg-amber-500/10 border-amber-500/30` info card. Pick either tm-warn or sky-500 tint depending on whether it's a warning or info.

### Red survivors

- **(P3)** danger Btn variant (~3249) and ConfirmDialog `confirmColors.danger` (~6900) — `bg-red-600`. Kept by the audit convention; these are the canonical "destructive" path. No change.
- **(P2)** CancellationCalcModal grid `hover:text-red-400` on remove ✕ buttons (~3969, ~3994). Swap to `hover:text-tm-pen`.
- **(P2)** DayEntryForm expense remove button (~4787) and DateEditModal expense remove (~5469) — `hover:text-red-400`. Swap to `hover:text-tm-pen`.
- **(P2)** DayEntryForm Notes char counter (~4809) — already covered above. Same line uses `text-red-400` for >1000-char state. Swap to `text-tm-pen`.
- **(P2)** Grid date-cell `text-red-700 hover:text-red-400` small remove buttons (~5187). Tone is fine for "very dim destructive" but `tm-pen/50 hover:tm-pen` would be the v3 equivalent.
- **(P2)** BH (Bank Holiday) chip label inside grid (~5218) — `text-red-400`. Per V3-10's rule BH = tm-pen. Swap.
- **(P1)** SectionCard `accent="red"` branch (~8128) — still renders `text-red-400 border-red-900/60`. Used at least by CWD Breaks section in DayEntryForm. Swap to tm-pen tones. **Important** because this is a shared component.
- **(P2)** Three action-sheet "Delete invoice" / "Delete day" / "Delete production" buttons in the three kebab menus (~9214, ~10088, ~11002) — `text-red-400`. Swap to `text-tm-pen`. Already-spec'd colour in V3-2 description.

### Green survivors

- **(P3)** Btn `success` variant + Toast + `ConfirmDialog confirmColors.green` — bg-green-500/600 etc. These are the universal "success" channel. Acceptable as-is, but could be swapped to tm-good for full token alignment in a follow-up.

### bg-sky-400 / bg-sky-900/40

- **(P3)** `hover:bg-sky-400` on WrapNowBtn primary (line 5588) and LunchNowBtn primary (~5597). These are hover states on a sky-500 base; sky-400 is a hover lighten. Intentional.
- **(P3)** Two share-sheet primaries use the same pattern (6863, 7570). Same — intentional hover.
- **(P2)** `bg-sky-900/40 text-sky-500` "11h day" pill on ProductionsScreen non-hero card (~3436). Out of date — should be `bg-sky-500/10 border-sky-500/30 text-sky-400` per the badge variant convention or just `tm-warn` since 11-hour-day is an OT-adjacent setting. Needs confirmation which.

### Lighter input survivors (`bg-neutral-800 border-neutral-700`)

- **(P1)** Invoice editor — Due-row days input (line 9431) — `bg-neutral-800 border-neutral-700`. Standalone tiny number input inside the meta strip. Visually mismatches its peers. Swap to `bg-neutral-950 border-neutral-800`.
- **(P1)** Invoice editor — Notes textarea inside the collapsible (line 9650) — `bg-neutral-800 border-neutral-700`. From V3-4 era. Should match the V3-17 textarea standard.
- **(P2)** Three share-sheet secondary buttons (~6871, ~7576, ~7582) — these explicitly use `bg-tm-card-2 hover:bg-neutral-800 border-neutral-700` — chip-lift pattern. Intentional.
- **(P2)** Production Settings — Best Boy mode chip header (~7418) — `bg-neutral-800 border border-neutral-700 text-neutral-300` is the day-type chip's "default Shoot" state. Intentional and distinct from inputs.

### Hardcoded hex colours outside of intentional zones

- **(P3)** A handful of inline `color: '#171717'` / `#737373` / `#525252` etc inside `BottomMoneyPill` (~3848–3857) — pill is on the cool-grey paper, these are intentional dark-on-light text colours. Fine, but could move to CSS variables for consistency.
- **(P2)** BottomMoneyPill background hardcoded `#171717` (~3852) and inline shadows — should reference the existing `--pill-paper` / `--pill-ink` vars.
- **(P3)** ErrorBanner + MigrationBanner inline colours (~8554, 8559, 8565) — `#7f1d1d`, `#0c1e33`, `#052e16` etc. Standalone toast-style banners; OK as-is.
- **(P3)** Logo preview `background: '#262626'` (~5706) is fine.
- **(P3)** Line-options ⋯ button `background: 'rgba(115,115,115,0.15)'` (~6663) — leftover from earlier phase, should switch to a Tailwind class.
- **(P2)** `style={isCurrent ? { borderLeft: '3px solid #0ea5e9' } : ...}` (~4340) in DaysManager — should use a Tailwind class or `--tm-accent`.

---

## 2. Section header pattern consistency

The V3-12 SectionHdr (sky-500 caps + trailing hairline) was applied only on the Stats screen. Everywhere else still uses the older `text-[10px] uppercase tracking-wide text-sky-500 font-bold` without the hairline.

- **(P2)** ProductionSettingsSheet section labels inside Disclosures (e.g. "VAT Registered" at 3644, "Kit Money" at 3653, "Driver" at 3663, "Saturday rate" at 6381, etc.) — these are toggle-row labels, not section headers. They're fine as-is.
- **(P2)** DayEntryForm field-cluster labels — "Conditions" (4600), "Travel Time" (5396), "Per Diem" (5414), "Kit Money" (5425), "Expenses" (5436), "Step-Up for all crew" (5479) — these are field-group labels inside the form. Pattern is consistent within DayEntryForm; aligning them to the V3-12 hairline pattern is a polish pass, not a regression.
- **(P3)** CalcBreakdownView BY DAY heading already uses `text-[10px] uppercase tracking-[0.18em] text-neutral-500 font-bold mb-2 mx-4` — neutral, not sky. Possibly intentional as a sub-label.
- **(P3)** Cancellation calc "Days" header (3887) — already uses the V3-12 hairline pattern. Good.

Verdict: **section labels are not visually noisy** — the inconsistency is structural (some have hairlines, some don't). Not a launch blocker.

---

## 3. SectionCard vs Disclosure usage

- **(P1)** SettingsScreen — covered in V3-13. Two `SectionCard`s (Tools, My Setup) + 14 Disclosures with summaries. Correctly applied.
- **(P1)** ProductionSettingsSheet — covered in V3-14. One `SectionCard` (Basics) + 4 Disclosures with summaries. Correctly applied.
- **(P2)** InvoiceEditorView — uses inline card divs (no SectionCard wrapper) for the meta strip, line items, etc. Notes/Bank/From are collapsibles built ad-hoc inline rather than via `<Disclosure>`. Functional but means three different collapsible idioms coexist (DayEntryForm chip-cards, Settings `<Disclosure>`, editor inline collapsibles). Worth unifying in a follow-up.
- **(P2)** DayEntryForm has its own chip-driven condition cards (`variant="condition"`) — different mental model from Disclosure (these toggle data, not just visibility). Documented behaviour. Fine.

Summaries — live update verified by code reading:
- Settings summaries derive from `userPrefs` directly inside the component body, so they recompute on every render. ✓
- Production Settings summaries same — derive from `production`. ✓
- Editor From/Notes/Bank summaries inline in the JSX, derive directly from `invoice`. ✓

---

## 4. Button audit

### Primary CTA shadow

Only 5 buttons in the file currently apply `boxShadow: '0 4px 16px rgba(14,165,233,0.25)'`:

1. Invoice editor "Send via email" / "Mark paid" (~4135) ✓
2. Overview share sheet PDF (~6864) ✓
3. Day-page export sheet PDF (~7571) ✓
4. New Production "Create" (~7907, conditional on canCreate) ✓
5. Cancellation calc "Copy breakdown" (~9701) ✓

Missing the shadow:
- **(P2)** Onboarding wizard "Continue" / "Add Production" primaries (~7975, 8045, 8091) — three steps in the new-user flow. Adds polish.
- **(P2)** DateEditModal "Save all" (~9114) and DayEditModal "Save" (~9184) — primary save actions. Worth the shadow.
- **(P2)** AllInvoicesView header "+ New Invoice" Btn (~9923) and empty-state CTA (~9932) — both primary entry points; deserve the shadow.
- **(P2)** ProductionPicker "Done" (~10233) and "Pick & open" (~10240) — primary completion actions.
- **(P1)** ProductionsScreen empty-state "+ New Production" Btn (~10870) — only CTA on the empty home screen; should pop.
- **(P3)** AllInvoicesView "Set up invoicing" Btn (~10310) — gated empty state.

### Dashed `+ Add X` pattern

- ✓ Invoices: "+ New invoice" in AllInvoicesView (V3-7).
- ✓ Productions: "+ New production" inline (V3-11).
- ✓ Cancellation calc: "+ Add day" (V3-17).
- **(P2)** "Add line" inside invoice line items card uses `<Btn variant="ghost" size="sm">` instead of dashed. Inconsistent. Spec hasn't called this one out yet — leaving for confirmation.
- **(P2)** "Add Crew" in CrewManager (~3507) — `<Btn variant="primary">`. Could become dashed for consistency, but it's a primary action inside a section.
- **(P2)** "Add Day" buttons in DaysManager (~5850, 5878) — `<Btn variant="primary">`. Same consideration.
- **(P3)** "Add expense" inline link inside Extras (within Expenses chip-card) — small text button. Fine.

### Action-sheet headers

- ✓ Cancellation calc: `<IShare/> Share / export` — both sheets in V3-9 have icon + label.
- ✓ Invoice editor kebab + Day-actions kebab — title is invoice number / day actions. No icon.
- ✓ Production action sheet — production title as header. No icon.
- **(P2)** Header pattern is *slightly* inconsistent between share-sheets (icon + label) and kebab menus (item identifier as label). Acceptable since they communicate different things.

---

## 5. Filter pills audit

Three implementations: `InvoiceListView` (line 9959), `AllInvoicesView` (10349), and `StatsScreen` (8883).

Comparison:
- All three use the spec'd `active ? 'bg-sky-500/10 border-sky-500/30 text-sky-400' : 'bg-tm-card-2 border-neutral-700 text-neutral-400'` colour pair. ✓
- All use `rounded-full`, `font-bold tracking-wider`, `whitespace-nowrap border transition-colors`. ✓

Drift:
- **(P2)** StatsScreen pills use `px-3 py-1.5 text-[11px]` (larger).
- **(P2)** InvoiceList and AllInvoices pills use `px-2.5 py-1 text-[10px]` (smaller).

Two-size pattern is fine if intentional, but consider standardising to one size (likely the larger px-3 one for thumb-friendliness on phones).

---

## 6. Header consistency

Eight stickies in the app. Of these, six have `border-b border-sky-500`. Two don't:

- **(P1)** InvoiceEditorView sticky (line 9375) — `border-b border-neutral-800`. From V3-3's breadcrumb redesign. Mockup specifically shows no sky underline on this screen — but the rest of the app has it. **Needs confirmation**: is the editor intentionally treated as a sub-screen (no underline) or should it match?
- **(P1)** InvoiceListView sticky (line 9917) — `border-b border-neutral-800`. This is the **per-production** invoice list (different from AllInvoicesView). Should match the AllInvoicesView treatment. Swap to `border-b border-sky-500`.

Other inconsistencies:
- **(P2)** ProductionsScreen has no sticky header — it's a scrolling page with the search/icons inline at the top. Acceptable by design but worth noting.
- **(P2)** SoloDayPage header is the V3-K breadcrumb design (`← SHOOTS` + production name). Doesn't have the sky underline at all. By design per V3-K.
- **(P3)** CancellationCalcModal has its own modal header (3818) — uses `border-b border-neutral-700` (slightly different than the global `neutral-800`). Cosmetic.

---

## 7. Empty / single / many states

- **(P2)** ProductionsScreen empty state with no productions, no invoices: renders ICal icon, "No shoots yet" heading, paragraph, and a primary `+ New Production` Btn. Functional. No shadow on the CTA.
- **(P2)** AllInvoicesView empty state two-tier (no setup vs no invoices). Both communicative. The "no setup" CTA could use the shadow.
- **(P2)** CalcBreakdownView with `sorted.length === 0`: renders centered grey "No days entered yet". Tiny text, no card. Could use a small empty-state card.
- **(P1)** Cancellation calc post-V3-17 empty state: notice date input + "Days" header + dashed "Add day" button + Total £0.00 + APA footer. Confirmed working but note: when `crew.length === 0 && setCrew`, the chain still shows "Add a crew member below to begin" before the Add Person form — that's correct.
- **(P2)** Stats: when `enrichedDays.length === 0` shows "No data yet for '{displayName}'" — fine. When no `displayName`: shows the gear-icon CTA. ✓
- **(P3)** Invoice line items with zero lines: shows "No line items — tap Add line below" inside the card. ✓

---

## 8. Cross-screen data integration

- **(P0?)** **Settings → Pill comparison NOT reflected in Stats comparison.** `StatsScreen.ComparisonContent` (line 8589) maps over the **full** `COMPARISON_ITEMS` array — it doesn't honour `userPrefs.comparisonUnit`. Per V3-Q the user's pick should also surface here, OR the spec was "breakdown stays full" only. Re-read of V3-Q says "DO NOT change the IN REAL MONEY card on the breakdown — that's the deliberate 'everything' view." But the Stats comparison is a different surface — likely should follow the setting. **Needs confirmation** whether Stats follows the setting or shows all.
- ✓ Settings → My Setup name change → flows into `createNewInvoice` snapshot via `userPrefs.displayName` (line 1523 region, `fromName: userPrefs.displayName`). PrintView reads `invoice.fromName`. ✓
- ✓ Settings → VAT registered toggle → flows into new invoices via `createNewInvoice` (line 1533). ✓
- ✓ Production Settings → Best Boy mode toggle → drives grid render. ✓
- ✓ Production Settings → Weekend rate overrides → `satRateMode`/`satRateCustom`/`sunRateMode`/`sunRateCustom` consumed in calc (lines 925+). ✓
- ✓ Production Settings → Your role → mutates `production.crew[0]` directly. Used by calc. ✓
- ✓ Invoice editor field edits → `updateInvoice` is called; verify `linesEdited` flag. Looking at updateInvoice helper… the helper itself doesn't set `linesEdited` — only direct line edits do (line 9163: `linesEdited: true`). Header/job/from/to edits don't mark linesEdited. ✓ That's correct behaviour — only line edits should set linesEdited.
- ✓ Day editor → call/wrap/lunch change → triggers re-run of auto-refresh `useEffect` for un-edited drafts (line 9203 area in editor). Looking at the editor's useEffect — runs whenever `production.days` etc. change. ✓

---

## 9. iOS / mobile specifics

- ✓ All sticky / fixed headers I sampled use `paddingTop: 'env(safe-area-inset-top)'`. Quick audit shows the pattern is consistent.
- ✓ Bottom-pinned UI uses `paddingBottom: 'calc(env(safe-area-inset-bottom) + …)'` — verified on pills, footers, action bars.
- **(P2)** Two kebab buttons with sub-44 hit areas:
  - AllInvoicesView card kebab (~10410): `minWidth: 28, minHeight: 28` — V3-7's spec'd reduction. Acceptable for a secondary affordance, but 28×28 is below the 44×44 a11y minimum. Worth widening to 32 at least.
  - CancellationCalcModal solo-mode card remove ✕ (~3904): `minWidth: 32, minHeight: 32`. Same consideration.
- **(P1)** Plain `<Input type="date">` survivors that could render empty/invisible on iOS:
  - CancellationCalcModal grid mode per-column date inputs (3909, 3971) — these are inside bordered cells so the input chrome shows. OK.
  - DayEntryForm Date field (4402) — gated by `!fixedDate`, only renders for new-day creation in DayEditModal. May render empty briefly. Could benefit from overlay treatment.
  - **ProductionSettingsSheet Start date (6329)** — appears in BASICS, can be empty on new productions. Empty state renders awkwardly on iOS. **Worth applying the V3-17 overlay pattern here.**
  - DateEditModal targetDate (6973) — used during bulk-edit flow, usually has a value.
- ✓ `lockBodyScroll` / `unlockBodyScroll` — paired in `useEffect` cleanup across modals (verified: DayEditModal, DateEditModal, DiscountModal, CancellationCalcModal, ProductionPicker). ✓
- ✓ `WebkitTapHighlightColor: 'transparent'` consistently applied to buttons that need it.

---

## 10. Accessibility quick pass

- ✓ Icon-only buttons have aria-labels (sampled — back arrows, kebab buttons, remove ✕, share, etc.).
- **(P2)** Best-boy grid date-cell tiny remove buttons (~5187) have `text-[9px]` and no aria-label. Worth adding.
- ✓ Toggle accepts `ariaLabel` prop and most callers pass it.
- **(P2)** Color contrast: `text-neutral-600` on `bg-neutral-900` is borderline (around 4.0:1). Used for hints — sub-AA. `text-neutral-500` is the v3 hint colour and is fine. The few neutral-600 spots (kebab buttons, dim secondary text) could benefit from a bump to 500 if they carry semantic content.
- ✓ Focus styles: shared `Input` and `Select` both have `focus:ring-1 focus:ring-sky-500/40` and `focus:border-sky-500`. Reaches everything that uses the component.
- ✓ No `<form>` wrappers around interactive content (verified by grep).

---

## 11. Calculation / logic spot-checks

- ✓ `cancellationPercent` — 13 May notice, 17 May shoot: `days = round((17 - 13) / 1) = 4`. Falls into `days <= 6 → 0.5` (50%). Matches APA §7's 6–4 day bracket. ✓
- ✓ Block calculation — `planned.length > 0 && planned.length <= 3` triggers `isBlock`. Cells then recomputed at `blockPct = cancellationPercent(noticeDate, earliest.col.date)`. ✓ (line 3856 region)
- ✓ OT 11-hour day: `basicHrs = isElevenHourDay ? 12 : 11` (line 897). Workers go on OT after `workedHrs - lunchDeduct > basicHrs`. With a 1h lunch, basicHrs=11 means OT after 10h actual work; basicHrs=12 means OT after 11h actual work. Toggle UI text "OT after 11h worked instead of 10h" — consistent with code. ✓
- ✓ Weekend rate — `satMult` default 1.5, `sunMult` default 2; custom from `satRateMode === 'custom'`. Applied to `bdr * satMult` line and `satOtRate = ceilHalf(otHrs)`. ✓
- ✓ Bank holiday — `if (isBH) effectiveDayType = "Sunday Day"` equivalent → Sunday rate path activates. Verified via `cancellationPercent` is not used here; BH directly drives day-type override. Per APA §2.4. ✓
- ✓ VAT — invoice subtotal × rate / 100. Renders only when `vatRegistered`. ✓
- ✓ Favourable rounding — `applyRateRounding` at line 1408 area. Activated by `production.favourableRounding`. ✓

**(P1) Float-precision OT line.** Found the source: `qty: toc.tocHours` (~1614) and `qty: chargeableTravel` (~1027) and `qty: preUnitHrs` (~858) and `qty: paidHrs` (~903) — none are `ceilHalf`'d. When rendered raw (e.g. in DayEditModal's lines table or in the breakdown's expanded day rows), these produce values like `1.0833333333333321 × £66.60`. The `formatOTDuration` helper only fires for labels matching `/\bot\b|\bovertime\b/i`, so TOC / Travel Time / Pre-call / paidHrs lines render fractional raw. Fix: either ceilHalf at the calc source, or apply `formatOTDuration`-style rounding to all numeric qty in the line-row renderer.

---

## 12. Performance red flags

- **(P3)** `crewCalcs` useMemo in CancellationCalcModal (line 3851) depends on `[crew, columns, agreedFees, noticeDate]` — all stable identities. ✓
- **(P3)** Hero card's `tickNow` interval re-renders the whole `ProductionsScreen` every 30s (V3-A). Acceptable cost — re-rendering downstream components is fine. Watch for jank with many productions.
- **(P3)** Stats `enrichedDays` (sampled) walks every production, every day, every crew. For a power user with 100+ productions × 50 days, this is N×M but still cheap.
- **(P2)** ProductionsScreen `productionTotals`, `productionHours`, `productionOTHours` are three separate `useMemo`s each looping all productions and calling `calcForDisplay` per day. Could be merged to one pass. Not a launch blocker.
- **(P3)** No virtualisation anywhere. Acceptable for current dataset sizes.

---

## 13. Code quality / maintainability

- **(P2)** Unused `taxYearTotal` reference — already removed in V3-12.
- **(P2)** Three identical kebab action-sheet implementations (production, invoice row, day actions) ~50–80 lines each. Could be extracted into a shared `<ActionSheet>` component.
- **(P2)** Three identical filter-pill row implementations across InvoiceListView / AllInvoicesView / StatsScreen. Could be extracted.
- **(P2)** Two identical "+ Add X" dashed buttons. Could be a shared `<AddItemButton>` component.
- **(P3)** Inconsistent naming: `bestBoyMode` (production-level), `isElevenHourDay` (production-level), `linesEdited` (invoice-level) — mixed conventions. Minor.
- **(P3)** `Disclosure` shipped (line 8159) but only used in Settings + Production Settings. Invoice editor's Notes/Bank/From collapsibles could fold into it for consistency.

---

## 14. Bugs spotted

- **(P0)** **CancellationCalcModal grid mode totals row has dangling `<td>` count mismatch after V3-17.** I removed the empty `<td className="bg-neutral-950" />` placeholders from the body rows and the totals row, but the totals row still has `{setCrew && <td className="border-r border-neutral-700 bg-neutral-950" />}` at line 4061 — this matches the header's "Day rate" column. Then `colTotals.map(...)` for each day. Then the GrandTotal cell. Without the removed trailing td, the row should still align — but verify with a real `crew.length===2` test. **Needs runtime verification.**
- **(P0?)** **TOC line qty raw float.** As called out in §11 — produces ugly `1.0833333333333321` displays in some breakdown views. Either ceilHalf at source or format at render.
- **(P1)** **DayEntryForm Date `Input type="date"`** at line 4402 will render with iOS native chrome on iOS Safari, which becomes invisible-feeling when empty. Most often it has a value so not critical.
- **(P1)** **`InvoiceListView` (per-production) sticky header uses `border-neutral-800`** while every other top-level header uses `border-sky-500`. Inconsistency.
- **(P2)** **Stats ComparisonContent ignores `userPrefs.comparisonUnit`.** Either should honour the setting or doc that Stats is the "everything" view (currently has no doc note).
- **(P2)** **`bg-amber-900/40 text-amber-400` "custom weekend" pill** on the non-current production card (~3435) — stale token, see §1.
- **(P2)** **Best-boy grid colour scheme** still pre-v3 tokens throughout — see §1.
- **(P2)** **DayEditModal calc-table inside the modal** still uses amber/red pre-v3 tokens — see §1.
- **(P3)** Unused / leftover comment fragments inline in some components (`{/* end ... */}`) from earlier refactors. Cosmetic.

---

## 15. Suggested launch-blockers vs follow-ups

### Must fix before push (P0/P1)

1. **TOC / chargeableTravel / preCall / paidHrs line qty float rounding** — applies wherever the calc breakdown renders, including the expanded day rows in the breakdown view, the day edit modal, and exports. Single-source fix preferred (round at calc) over per-render formatting.
2. **CancellationCalcModal grid mode** — verify the totals row column count after the V3-17 td removal didn't leave a misalignment. Smoke test with 2+ crew members.
3. **InvoiceListView sticky header** — `border-neutral-800` → `border-sky-500` to match every other top-level header.
4. **InvoiceEditorView sticky header** — confirm intent on the `border-neutral-800` choice (was it deliberate per V3-3?). If matching the rest of the app is preferred, swap to sky-500.
5. **DayEditModal amber/red token sweep** — high-traffic surface (every day edit in best-boy mode opens it). Easy 20-line PR.
6. **GridCell flag chips token sweep** — best-boy grid is the most data-dense view; the wrong tokens here are visible all the time.
7. **DiscountModal token sweep** — small but user-facing on every discount/waive flow.
8. **SectionCard `accent="red"` branch** — shared component; CWD Breaks card renders with the legacy red palette.
9. **ProductionSettingsSheet Start date** — apply V3-17 overlay pattern so the empty state isn't iOS-invisible.
10. **Stats Pill comparison preference handling** — confirm with user whether Stats should honour the setting.

### Can ship and follow up (P2/P3)

- Filter-pill size standardisation (Stats vs Invoices).
- Primary-CTA shadow extension to onboarding wizard, save buttons, AllInvoicesView CTA, ProductionsScreen empty CTA.
- Section header hairline rollout beyond Stats.
- Sub-44 tap targets on secondary kebabs.
- Component extractions (action sheet, filter-pill row, dashed-add button).
- Remaining red-400 → tm-pen colour sweep on hover states and char counters.
- BottomMoneyPill inline-colour cleanup.
- Stats useMemo consolidation.
- Better empty-state cards on the breakdown's "no days" message.
- `aria-label`s on small text-only remove buttons in the grid.
- Misc neutral-600 contrast bumps to 500 where the text carries content.
- Disclosure component consolidation for invoice editor collapsibles.
