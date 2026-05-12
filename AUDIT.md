# TimeMachine Pre-launch Audit
Date: 2026-05-11
File audited: index.html (9,112 lines)

## Summary
- P0 findings: 4
- P1 findings: 34
- P2 findings: ~28 (sampled — visual-consistency and copy nits sampled, not exhaustive)
- Top 5 highest-impact items:
  1. **Missing PWA/icon assets** — all `<link rel="icon" / manifest>` paths point to files that don't exist on disk (favicon.svg, favicon.ico, favicon-96x96.png, apple-touch-icon.png, site.webmanifest). App will boot but iOS/PWA install will fall back to generic icon and the manifest will 404.
  2. **Wrong-brand export filename** — `derricks-timemachine-backup-<date>.json` ships a stale brand name in every backup file users download.
  3. **Bank-holiday coverage stops at 2030** — `UK_BANK_HOLIDAYS` has no entries for 2031+; future shoots silently pay weekday rates on actual bank holidays.
  4. **No ESC-key handling on any modal** — modals (Crew, Day, Cancellation, Discount, Line edit, Confirm, Wizard, etc.) only close on backdrop tap or explicit Cancel. iPad/keyboard users have no ESC.
  5. **GridCell bypasses `calcForDisplay`** — uses raw `calculateDay` so TOC, kit money, per diem, expenses, and favourable/APA rounding are missing from the in-app grid totals only (PDF grid is correct via `calcForDisplay`). Numbers in the grid won't match the day list or breakdown.
- Rough effort estimate for P0+P1: **~14–18 hours** (P0 trivial fixes ~1h; P1 mix of copy/visual nits 4–6h, real behaviour fixes 8–10h).

## P0 — Must Fix Pre-launch

### Pre-launch hooks
**[P0]** Referenced icon/manifest assets do not exist on disk
- Location: index.html lines 15–19 (head)
- Issue: `favicon.svg`, `favicon-96x96.png`, `favicon.ico`, `apple-touch-icon.png`, `site.webmanifest` are all referenced but the working tree contains only `favicon-16.png`, `favicon-32.png`, `icon-180.png`, `icon-192.png`, `icon-512.png`, `icon-1024.png`, `icon.svg`, and `manifest.json`. Every PWA/iOS install will 404 these resources.
- Suggestion: Either rename existing assets (icon.svg→favicon.svg, icon-180.png→apple-touch-icon.png, manifest.json→site.webmanifest) or update the HTML to point at the names that exist. Pick one and unify.

### Wording & copy
**[P0]** Backup filename uses legacy brand "derricks"
- Location: line 9028
- Issue: `a.download = \`derricks-timemachine-backup-${date}.json\`` — every user who exports a backup gets a file named "derricks-timemachine-…". Brand inconsistency that ships to every customer disk.
- Suggestion: `timemachine-backup-${date}.json`.

### Calc engine correctness
**[P0]** Bank holiday detection silently fails from 2031-01-01
- Location: lines 197–238 (`UK_BANK_HOLIDAYS`)
- Issue: Hard-coded table ends at 2030-12-26. From 2031 onwards `isBankHoliday()` returns `false` for genuine UK BHs, so 2× Sunday rate is not applied, the BH chip won't render, and `getBankHolidayName` returns null. No warning to user. Date pickers happily accept 2031+ dates.
- Suggestion: Either auto-compute via algorithm (Easter formula + fixed dates with weekend substitution), warn explicitly when a shoot date is past the table end, or extend the table at build time. At minimum: surface a warning in Settings/About when the table is within 12 months of expiring.

### Behavioral consistency
**[P0]** Calc inconsistency: in-app grid vs PDF/list show different totals when extras are present
- Location: `GridCell` at line 4109 calls `calculateDay(resolved, member, production)` directly — bypasses `augmentCalc` (Kit Money, Per Diem, Expenses), TOC, and rounding.
- Issue: A day with £75/day kit money + an expense + a TOC breach shows the bare base total in the in-app TimesheetGrid cell, but the PDF, breakdown view, list view, and totals pill all show the augmented total. Users will see different numbers in two places at once.
- Suggestion: Replace with `calcForDisplay(production, day, member, prevDay)` and pass through the same prevDay logic used elsewhere; or document deliberately why this view excludes extras.

## P1 — Should Fix Pre-launch

### Mobile UX
**[P1]** `<input type="date">` overrides global 16px font with 14px → iOS zoom risk
- Location: line 2775 (`Input` primitive): `style={isDate ? { WebkitAppearance: 'none', fontSize: 14, ...style } : style}`
- Issue: The global stylesheet forces `input { font-size: 16px !important }` at line 40 to prevent iOS zoom. Inline `fontSize:14` for date inputs is overridden by `!important` so the 14px doesn't actually win — making this dead/misleading code AND if a future devhouse removes the `!important` it becomes an iOS zoom bug.
- Suggestion: Delete the inline `fontSize:14`. Keep WebkitAppearance only.

**[P1]** `user-scalable=no` blocks accessibility zoom
- Location: line 5 viewport meta
- Issue: Users with low vision cannot pinch-zoom the app. Apple App Review can flag this; it also violates WCAG.
- Suggestion: Remove `user-scalable=no` and rely on the 16px input rule to prevent zoom-on-focus.

**[P1]** Bottom money pill / bottom nav can hide content; pages add `pb-32` ad-hoc
- Location: 6050 (`SoloDayPage` style.paddingBottom), 6445 (ProductionApp `pb-32`), 8664 (ProductionsScreen `pb-32`)
- Issue: Inconsistent. SoloDayPage uses `calc(env(safe-area-inset-bottom) + 80px)`, others use Tailwind `pb-32` which doesn't add safe-area on top of itself. On older iPhones with home indicator, the FAB ("+ New Production") visually overlaps the home indicator area despite using `env(safe-area-inset-bottom)+24px` — fine — but list content under it may still be partly obscured.
- Suggestion: Use a single `pb-[calc(env(safe-area-inset-bottom)+5rem)]` token across all scroll containers that host a bottom-pinned UI.

**[P1]** No `-webkit-overflow-scrolling: touch` on inner-scroll containers
- Location: Modal scroll bodies (lines 3055, 3269, 4008, 4419, etc. use `overflow-y-auto` without the property). DayJumpSheet at 5791, WeekPickerSheet at 5057, etc.
- Issue: On iOS, nested-scroll containers without `-webkit-overflow-scrolling:touch` get jankier-than-momentum scrolling.
- Suggestion: Add a CSS rule like `.overflow-y-auto, .overflow-auto { -webkit-overflow-scrolling: touch; }` once in the global style block.

**[P1]** Number inputs for money fields don't declare `inputMode="decimal"`
- Location: ~40 `type="number"` inputs (mileage, BDR, kit-money amount, VAT rate, etc.)
- Issue: On iOS, `type="number"` brings up a number pad without a decimal separator by default in some locales. `inputMode="decimal"` is the iOS-correct opt-in.
- Suggestion: For currency fields, add `inputMode="decimal"`; for purely whole-number fields like miles, `inputMode="numeric"`.

**[P1]** Tap target audit: Many ghost icon buttons are under 44×44
- Location: throughout — e.g. `IUp`/`IDown` reorder arrows in CrewManager (line 2975/2976, p-1 around a 14px icon = ~22px); `IX` close buttons (p-0.5 around 16px); "+all" link in TimesheetGrid (line 4323, font-size 8px); `✕` column-remove in CancellationCalcModal (line 3295, leading-none px-0.5); date-cell "+all" / IGrip (line 4322).
- Issue: Apple HIG and most accessibility tooling require ≥44×44pt for primary controls. Many touch targets in dense grids are well under that.
- Suggestion: At minimum, bump buttons in primary flows (close, delete, reorder). For dense grids accept the tradeoff but flag in docs. Two-finger tappers will fat-finger these.

### Dead code & cleanup
**[P1]** `weekOTHrs` is declared and rendered but never accumulated
- Location: line 2138 (`let weekTotal = 0, weekHrs = 0, weekOTHrs = 0;`); used in line 2187 and 2284. The summation loop at 2143–2151 never adds to `weekOTHrs`.
- Issue: PDF GridPage week-total breakdown will never show "Xh OT" because the var is always 0. Subtle data omission.
- Suggestion: Inside the inner forEach, also `weekOTHrs += calc.meta?.otHrs || 0;`.

**[P1]** `GridCell.isWeekEnd` prop wired but always passed `false`
- Location: GridCell signature line 4094; only call site at 4358 passes `isWeekEnd={false}`. The component picks a `border-neutral-500` style only when true → that style never triggers.
- Issue: Dead branch.
- Suggestion: Either thread the real "is week end" (i.e. is this Sunday column) or remove the prop entirely.

**[P1]** `WrapNowBtn` / `LunchNowBtn` `compact` prop never used
- Location: function signatures at 4653 and 4694; usages at 8616, 8617, 8646, 8647 all omit `compact`. Compact-variant Tailwind classes (text-orange-700 / text-sky-700) are dead.
- Suggestion: Either start using the compact form in production cards or drop the prop and the conditional class string.

**[P1]** `COMPARISON_ITEMS` ships an emoji-heavy 11-entry table only used by StatsScreen
- Location: lines 58–70
- Issue: Used only once. Not a bug, but flagged as cleanup target if size matters.
- Suggestion: Acceptable to keep; just ensure the "lost walkie-talkies" / "years of mortgage" wording matches your tone.

**[P1]** `migrateInvoice` runs only inside `migrateProduction` — newly created invoices skip it
- Location: line 828 def; only called at 856.
- Issue: A new invoice from `createNewInvoice` has all fields set explicitly, so this is okay today, but the API surface is asymmetric (one path migrates, the other doesn't). Future field additions will only flow through migrations on load.
- Suggestion: Either move the defaults into `createNewInvoice` (already done) or call `migrateInvoice` everywhere an invoice enters state.

### Visual consistency
**[P1]** Mixed border-radius scale across similar UI
- Location: `rounded-xl` (~12px), `rounded-lg` (~8px), `rounded-md` (~6px), `rounded-[10px]`, `rounded-[12px]`, `rounded-[16px]`, `rounded-[6px]`, `rounded-full`, `rounded-[20px]` (Btn sm), `rounded-sm`. Card backgrounds variously use rounded-[10px] vs rounded-[12px] vs rounded-xl.
- Issue: Visual inconsistency that's noticeable in side-by-side cards (e.g. an empty-state card with rounded-[10px] next to a SectionCard with rounded-[12px]).
- Suggestion: Pick two radii (small ~8, large ~12) and replace all card backgrounds with one of those.

**[P1]** Btn `sm` variant uses `rounded-[20px]` (pill) while other sizes use `rounded-lg` (8px)
- Location: line 2756
- Issue: Small buttons look very different from medium/large variants on the same screen, which is jarring in DayEntryForm action rows.
- Suggestion: Use `rounded-lg` (or `rounded-md`) for `sm` too; the pill should be reserved for action chips and toggles.

**[P1]** Orange palette appears only in `WrapNowBtn` and one Btn `orange` variant — off-palette
- Location: 2843 (`Btn.orange` definition), 4682/4683 (WrapNowBtn `orange-400`/`orange-500`/`orange-700`)
- Issue: Stated palette is sky/neutral/red/amber/green. Orange is a one-off.
- Suggestion: Migrate WrapNowBtn to amber (existing palette) so all wrap-related accents are consistent.

**[P1]** `border-l-4` stripe colors on day cards use raw hex `#ef4444 / #f59e0b / #22c55e`
- Location: line 4965 in DaysManager list view
- Issue: Hard-coded hex bypasses the Tailwind palette and is in sRGB, not in the `red-500/amber-500/green-500` tokens used elsewhere — values are however identical to those tokens, but the literal-vs-token discrepancy makes future palette swap painful.
- Suggestion: Use `red-500`/`amber-500`/`green-500` Tailwind classes or named CSS vars.

**[P1]** Inconsistent modal heading sizes
- Location: `text-sm font-bold` (most), `text-2xl font-bold` (NewProductionScreen line 6509, Shoots heading 8734), `text-lg font-semibold` (CrewManager 2948), `text-2xl font-extrabold` (Onboarding)
- Issue: Three weights and four sizes for similar-level headings.
- Suggestion: Define a heading scale: h1 = text-2xl/bold, h2 = text-lg/semibold, modal title = text-sm/bold. Apply consistently.

**[P1]** SectionCard radius mismatch with surrounding cards
- Location: 6726 (`rounded-[12px]`); 7458 etc. use rounded-[12px], but day cards/modals use rounded-[10px] or rounded-[16px].
- Issue: Subtle but visible in lists where SectionCard sits beside another card style.

**[P1]** Day-card stripe vs PDF colors disagree
- Location: List view uses red/amber/green hex; PDF (.day.sat, .day.sun) uses amber-50/red-50 backgrounds.
- Issue: Stripe color in the in-app list (red = penalty) does NOT correspond to anything in the printed timesheet. Some users will assume "if I see a green stripe in the app it'll print green".
- Suggestion: Either suppress or document.

### Behavioral consistency
**[P1]** No ESC-key handling on any modal/dialog
- Location: every modal — CrewEditModal (3033), CancellationCalcModal (3248), DayEditModal (3968), date-edit dialog (4392), ConfirmDialog (5670), DuplicateDateDialog (5722), DayJumpSheet (5775), Pickers (5048/5085), DiscountModal (7566), LineEditModal (7637), LineItemActionSheet (7682), InvoiceRowActionSheet (8191), ProductionPickerSheet (8254), InvoiceSetupWizard (8316).
- Issue: Keyboard-only users (iPad with smart keyboard, web users) can't dismiss any dialog without mousing.
- Suggestion: Add a single `useEffect` hook factory `useEscape(onClose)` and wire it into every modal.

**[P1]** No swipe-down-to-dismiss on bottom sheets
- Location: WeekPickerSheet, CrewPickerSheet, DayJumpSheet, LineItemActionSheet, InvoiceRowActionSheet, ProductionPickerSheet, action sheets at 8832 etc.
- Issue: iOS users expect to swipe a bottom sheet down. None implemented.
- Suggestion: Optional drag-down gesture; acceptable to defer if you want a tight launch.

**[P1]** Modal scroll-lock leaks if two modals mount simultaneously
- Location: Every modal sets `document.body.style.overflow = "hidden"` on mount and `""` on unmount (e.g. 3021, 3142, 3961). If two modals are open at once (e.g. ConfirmDialog inside CrewManager removal flow), the inner unmount resets `body.style.overflow = ""` while the outer modal is still open.
- Issue: Edge case — body scrolls when it shouldn't, behind the still-open outer modal.
- Suggestion: Reference-count the scroll lock, or use a Set-based body-class lock.

**[P1]** "Save" / "Confirm" / "Save all" / "Apply" / "Done" — confusing button vocabulary
- Location: CrewEdit "Save" (3116), DayEdit "Save" (4074), date-edit "Save all" (4611), Discount "Apply" / "Waive" / "Re-waive" (7607), LineEdit "Save" (7674), Wizard step-3 "Done" (8371), Confirm dialog uses `confirmLabel` prop ("Replace"/"Remove"/"Delete"/etc.).
- Issue: Modal-confirm verbs are inconsistent — Save vs Save all vs Apply vs Done all map to "commit and close".
- Suggestion: Pick one: "Save" everywhere except destructive (use red Delete/Remove) and a wizard's terminal step (Done).

**[P1]** Modal close iconography mixes "× icon" with "Back arrow"
- Location: DayEditModal has BOTH a back arrow at 3982 ("← All Days") AND a top-right X at 4003. ProductionSettingsSheet and SettingsScreen use back arrow only. CrewEditModal uses X only.
- Issue: Two affordances for the same action on the same screen.
- Suggestion: One or the other per modal.

### Wording & copy
**[P1]** Date formatting inconsistent on screen
- Location: `fmtDate` (full weekday + month name) vs `fmtDateShort` (DD/MM/YYYY) vs ad-hoc `toLocaleDateString` with custom options scattered everywhere (TimesheetPage 1935, GridPage 2125, DayJumpSheet 5796, etc.).
- Issue: User sees "Mon, 4 May" in one place, "04/05/2026" in another, "Mon 4 May 2026" in a third.
- Suggestion: Standardise on three helpers (`fmtDateShort`, `fmtDateMed`, `fmtDateLong`) and replace inline `toLocaleDateString` calls.

**[P1]** "TIMEMACHINE" branding inconsistent
- Location: text "TimeMachine" (lines 6, 10), "TIMEMACHINE" (8670, 2112, 2298, 2665), "Time Machine" (6585, onboarding step 1 title).
- Issue: Three capitalisations of the brand name.
- Suggestion: Pick one rendering rule (e.g. TimeMachine in body, TIMEMACHINE in tracking/logo). Apply consistently — especially the onboarding hero "Welcome to / Time Machine" (line 6585) which is two words.

**[P1]** "Best Boy" terminology unexplained for non-electricians
- Location: line 6529 onboarding tooltip "Manage a crew with the grid view". Tooltip never explains the term.
- Issue: A 2nd AD or sound mixer enabling Best Boy mode won't know why it's called that.
- Suggestion: Rename to "Crew mode" or "Multi-crew mode", or add an info tooltip explaining the term comes from the lighting department.

**[P1]** PWA title "TimeMachine" while in-product hero says "TIMEMACHINE"
- Location: line 6 `<title>` vs 8670 hero.
- Issue: Minor brand inconsistency.

**[P1]** "APA Sept 2025" footer in product (line 6468) and "Rates per APA Sept 2025" string
- Location: 6468 (ProductionApp), 7105 (Settings About card)
- Issue: Two places hardcode the rate-card date. When 2026 APA arrives, both must change.
- Suggestion: Hoist to a single constant near `APP_VERSION`.

### Edge cases
**[P1]** Generating an invoice with zero working days produces empty line items + draft
- Location: `buildInvoiceLineItems` (line 950) returns `[]` if no days, but `createNewInvoice` still proceeds to push an invoice into state with empty line items, invoice number consumed, status="draft".
- Issue: User accidentally taps Invoice button → silently created invoice with subtotal £0 and consumed the next invoice number.
- Suggestion: Guard in `createNewInvoice` (or in the calling button handler) to refuse creation when there are no payable lines, surfacing a toast.

**[P1]** Productions screen "sort by startDate" tiebreak is `return 0` — productions without startDate land at the end out of insertion order
- Location: 8552–8556
- Issue: If two productions have no startDate, their relative order becomes whatever the array ended up at.

**[P1]** `findPrevDay` uses string comparison `d.date < currDay.date` — works for ISO but only because dates always have year-month-day. If a corrupt date sneaks in (e.g. "01-05-2026") TOC silently breaks.
- Location: 1100
- Suggestion: Validate date strings on read.

**[P1]** Crew member with no name can be saved if the trim is removed: `save()` in CrewManager guards via `!form.name.trim()` (good); but ConfirmDelete on PMPA roles and crew with empty role fall back to "Crew" string from the cancellation crew (line 3417). On Production-page CancellationCalcModal `setCrew` path, crew member is created with role: "Crew" which is not a real ROLE_DEFAULTS key.
- Location: 3417
- Issue: Outside the cancellation modal that fabricated crew would carry an unknown role.
- Suggestion: Stick to defaultRole.

**[P1]** localStorage quota: logo upload allows 500 KB base64 (~666 KB stored). With multiple productions and many invoices each carrying their own copy of `logoBase64`, plus the user's logoBase64, plus POSTCODE_DISTANCES, a busy user can approach 5 MB.
- Location: 1051 (createNewInvoice copies logo into each invoice), 6964 (500KB cap on upload)
- Issue: Logo is duplicated per-invoice, not stored once and referenced. Twenty invoices × ~500 KB = 10 MB of duplicated logo data in storage.
- Suggestion: Either store the logo by reference (look up from userPrefs at render time) or strip it from the invoice on save and re-apply at render.

**[P1]** Two days with same date for same crew: nothing prevents creation
- Location: `save` at 4860 just `[...prev, form]` if no `exists` matches `form.id`
- Issue: User can create duplicates (intentional in some workflows but no warning). Day total then doubles.
- Suggestion: Detect and warn or block.

### Calc engine correctness
**[P1]** `calcForDisplay` defaults `production?.favourableRounding ?? true`, but `migrateProduction` defaults to `false`
- Location: 1134 (`useFavourableRounding = production?.favourableRounding ?? true`); 849 (`p.favourableRounding ?? false`)
- Issue: For any code path that passes a non-migrated production object (rare but possible — see e.g. CancellationCalcModal's standalone calcProd), rounding behaviour flips relative to migrated stored productions.
- Suggestion: Align defaults to `false`.

**[P1]** `calcTOC` uses `production?.apaRounding ?? false` in one path and just `false` in another
- Location: 1106 signature accepts `apaRounding = false`; 1122 (`calcForDisplay`) passes the production setting; 4201 (`tocMap`) calls `calcTOC(prevR, currR, member)` without passing apaRounding.
- Issue: Grid TOC uses APA-rounding-false even when the production has it on. Pence-level discrepancy between grid and breakdown.
- Suggestion: Always pass `production.apaRounding` from caller.

**[P1]** Mileage shown as round-trip but APA paid amount is per-mile flat — clarity needed
- Location: 506 (Travel Day mileage line), 766, 649 — all multiply by 0.5 with hint "outside M25"
- Issue: Postcode mode roundTrip flag doubles the miles via `lookupPostcodeMiles` but the resulting `miles` is just stored as a number with no audit trail. If user toggles roundTrip after setting manually, miles silently changes.
- Suggestion: Already partially handled — verify the `onMilesBlur` rounding doesn't double-apply with the lookup's pre-rounded value (which it can, since the lookup result is already `entry.d * 2` and then `Math.ceil` is applied again on blur if user types in the manual mode).

**[P1]** PMPA roles do not apply rounding (`if (calc.meta?.isPmpa) return calc;`)
- Location: `applyRateRounding` at 1076
- Issue: Production-managed PMPA roles never get favourable rounding applied. Likely intentional (PMPA is flat) but undocumented.

**[P1]** Truck call before midnight not handled when truck call < callH but wrap is also `+1`
- Location: 471–475
- Issue: `preUnitHrs = callH - truckCallH` works only when both are same-day numerically. If truck call is 23:30 and callH is 01:00 the next day, math goes negative.
- Suggestion: Apply the same `absTime` logic used for lunch.

### Performance smells
**[P1]** O(N²) prev-day lookups inside list renders
- Location: `findPrevDay(days, e)` is called for every entry in every render path: ProductionApp 6349, DaysManager 4946 + 4962, etc. Each call sorts/filters all days.
- Issue: With 30+ days × 10 crew = 300 days, every render does ~90,000 comparisons.
- Suggestion: Precompute a `prevDayMap` once via `useMemo`.

**[P1]** Per-component `useMemo` doesn't help where parent re-renders
- Location: `byCrew` memo in ExportTab (5134), `index` memo in TimesheetGrid (4220), `weeks` memo (4190). These depend on `production` which changes on every Day edit, defeating memo benefit.
- Suggestion: Memo on more granular slices (production.days, production.crew separately).

**[P1]** SVG `Icon` re-creates a new element tree on every render
- Location: line 2702
- Issue: Many icons rendered per row × many rows = lots of inline SVG nodes. Acceptable today, but worth noting for the 30-day production-grid scroll.

**[P1]** `crewCalcs` in CancellationCalcModal depends on `agreedFees` object identity → recomputes on every keystroke
- Location: 3198, 3215 dep array
- Issue: Real-time fee table recomputes for entire crew on every digit typed into any cell. Acceptable for 5–10 crew, noticeable at 30+.

### iOS-specific (Capacitor prep)
**[P1]** `.app-loading` uses `min-height: 100vh` — Capacitor/iOS Safari status-bar-area inset
- Location: line 44
- Issue: On notch devices the splash is offset by the safe area.
- Suggestion: `100dvh` or include `env(safe-area-inset-top)` math.

**[P1]** `<input type="time">` and `<input type="date">` keep native iOS pickers
- Location: TimeInput 2779, Input 2768
- Issue: iOS native pickers render a wheel that ignores `step="300"`. The 5-min rounding only happens onBlur. Users can pick 12:37 in the wheel.
- Suggestion: Document or replace with custom picker pre-launch — but acceptable to ship with onBlur rounding.

**[P1]** `box-shadow` on bottom money pill (`0 20px 60px rgba(0,0,0,0.7)`) on dark background — barely visible, costs paint
- Location: 5521, 6125
- Issue: Unnecessary GPU paint cost on every scroll.

**[P1]** Pull-to-refresh on iOS is disabled via `overscroll-behavior: none` (good) — but only on `body`. Inner scroll containers can still rubber-band.
- Location: line 31

### Settings & preferences sanity check
**[P1]** Settings → "Reset all data" reloads the page; no confirmation step beyond the ConfirmDialog already shown
- Location: 9045
- Issue: If localStorage is corrupted or quota-exceeded, the reload doesn't necessarily clear it; the user might end up in a stuck loop.
- Suggestion: Wrap in try/catch and surface a fallback message.

**[P1]** Onboarding "Skip setup" leaves `onboardingComplete = false` is set true only via completeOnboarding. But existing-user migration in Root at 8923 patches `onboardingComplete: true` on any user without that field — so technically the skip flow does work. Verify no race condition on a brand-new install.

**[P1]** Onboarding doesn't capture invoicing fields (address, bank) — those are deferred to `InvoiceSetupWizard`. A user who completes the 3-step onboarding then tries to create an invoice will land in the wizard. Discover flow risk.
- Location: 6577 onboarding vs 8297 wizard
- Suggestion: At minimum, add a sentence at the end of onboarding step 3 "Invoicing setup happens when you make your first invoice."

### Pre-launch hooks
**[P1]** No privacy policy, terms of service, or support link
- Location: Settings → About (lines 7097–7112) only shows app version, APA version, feedback email.
- Issue: App Store submission requires a privacy policy URL (even for fully-local apps).
- Suggestion: Add at minimum a "Privacy" link pointing to a brief stub (data stays on device, no telemetry).

**[P1]** No way to see app version on the splash/loading screen if app crashes pre-render
- Location: line 49 loading div is plain text.
- Suggestion: Add `vX.Y.Z` to the loading message.

## P2 — Post-launch Backlog
(Sampled, not exhaustive — focusing on representative findings.)

### Dead code & cleanup
- **[P2]** `truncate text-base font-semibold` etc duplicated card pattern — extract a `ProductionCard` component (lines 8602 / 8632).
- **[P2]** `ROLE_DEFAULTS["Spark"] = ROLE_DEFAULTS["Lighting Technician"]` legacy alias (line 177) — eventually deletable when migrations have run on all stored data.
- **[P2]** `_setUserPrefs` parameter in `InvoiceListView` is destructured but unused. (Verify; line 8110 — `userCrewId`, `setUserPrefs` both passed, only some used in render.)
- **[P2]** `useUserCrewIdsInProduction` returns array but most callers take `[0]` — change return to scalar.
- **[P2]** Many anonymous arrow function body components defined inside other components (e.g. `ComparisonContent`, `MonthTableContent`, `SectionHdr`, `StatCard`, `TappableCard` inside StatsScreen at 7280–7361) — re-creating on every render. Hoist to module scope.
- **[P2]** `renderCard` in ProductionsScreen (line 8591) is recreated each render — `useCallback` candidate.
- **[P2]** Static class strings like `"max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-3 flex-wrap"` repeated dozens of times — could extract.
- **[P2]** `dayTypeChipClass` (line 1198) doesn't include `"Rest Day"` → defaults to "shoot" — harmless because Rest Day is short-circuited before chip rendering, but confusing.
- **[P2]** `migrateCrew` is so minimal it could be inlined (line 812).

### Visual consistency (sampled)
- **[P2]** Toggle widths are 56×30 — different from 44×24 used implicitly elsewhere via Tailwind defaults. Document the standard.
- **[P2]** Border colours `border-neutral-700` vs `border-neutral-800` used interchangeably for card edges.
- **[P2]** `text-[10px]`, `text-[11px]`, `text-[9px]`, `text-xs`, `text-sm`, etc. — too granular a type scale. Pick three.
- **[P2]** `bg-neutral-800` vs `bg-neutral-900` vs `bg-neutral-950` — five-step scale used inconsistently.

### Wording (sampled)
- **[P2]** "Couldn't find that postcode — try the first part only, like NW1." (line 3531) — good; consider a link to a list of valid outcodes.
- **[P2]** "Best Boy mode" tooltip uses sentence case while most labels use title case.
- **[P2]** Onboarding "You're ready, X." has period; other screen headlines don't.
- **[P2]** Toast wording: "Wrapped 3 entries at 19:35" vs "Lunch logged at 12:45" — different verb tenses.
- **[P2]** "DAY {n}" header counts days globally for solo user — once a user has 20+ days across multiple shoots this number becomes meaningless. Solo page should reset to 1 per production.

### Edge cases (sampled)
- **[P2]** `restHoursBetween` uses `Math.round` for `daysDiff` — for a 24-hour gap that crosses DST, this rounding is fine for UK but documented assumption.
- **[P2]** PDF page break: if a crew has 1 day, the timesheet PDF renders 1 page with 6 rest rows — visually heavy.
- **[P2]** Cancellation: "Block" rule fires at exactly 3 planned days, which matches APA but could be a surprise; the help line at 3434 explains.
- **[P2]** Adding 100+ crew members in BB mode: drag-drop reorder gets sluggish (no react-beautiful-dnd virtualization).

### Performance (sampled)
- **[P2]** Productions screen iterates all productions × all days × all crew for the top totals (8528) — fine until N>20.
- **[P2]** `printTarget` cleanup runs on a 30s fallback timeout — leak if user backgrounds the app mid-print.
- **[P2]** `useEffect(() => setUserPrefs(p => p.onboardingComplete === undefined ? ...)` runs on every mount (8923) — should check before triggering setter to avoid initial re-render.

### iOS / Capacitor (sampled)
- **[P2]** `theme-color` is `#0e1729` (line 13) but the app's bg is `#0a0a0a` — slight mismatch in iOS status bar.
- **[P2]** No `apple-mobile-web-app-status-bar-style` accommodation for light mode users — but app is dark-only.
- **[P2]** `pinch-to-zoom` images: invoice logo preview is `<img>` only; no full-screen view.

### Pre-launch hooks (sampled)
- **[P2]** Feedback email `feedback@timemachineapp.co.uk` — verify the inbox exists and is monitored.
- **[P2]** No keyboard shortcut hint for power users (Cmd-S etc.).

## Notes & observations

### Architecture
- Single-file React+Babel: ~9k lines, fully readable, well-sectioned with `═` banners. Sectioning is excellent.
- Three storage keys: `bigals_productions`, `bigals_user_prefs`, plus one-time migration of `bigals_production`/`bigals_crew`/`bigals_days`. The "bigals" prefix is legacy from an earlier app name — keeping it avoids data-loss migration, but a future major version should namespace under `timemachine_*`.
- `useStoredState` hook is clean — JSON-serialised, with an `initial` merge for shape evolution. Note: it does `JSON.stringify` on every state change in an effect — for large `productions` arrays the cost is real (consider debouncing or moving to a worker).
- All money math uses Number (float). `fmtGBP` uses `.toFixed(2)`. Accumulation through `reduce((s,l)=>s+l.amount, 0)` accumulates floating-point error. Acceptable for UK currency at the day/week scale (errors < £0.01) but worth a note.

### Surprising findings
- **No tests** in the repo (no `__tests__`, `test/`, `*.test.js`). Pre-launch is risky without at least snapshot tests of the calc engine — APA rules are subtle and a regression would silently underpay crew.
- **Excellent calc engine** — `deriveBreakState` + `calculateDay` + `calcTOC` are well-factored, APA citations inline. PMPA path is correctly separated. BWD override list is data-driven.
- **Two parallel "data entry" surfaces** — `DayEntryForm` and the inline `dateEdit` form in TimesheetGrid (~line 4419) — keep diverging. The date-edit form lacks Travel Time info popover gating, doesn't render the BWD/PMPA status messages, etc. Maintenance burden.
- **Invoice editor auto-rebuilds line items on open** (line 7749) for unedited drafts — clever and correct, but the `eslint-disable-line react-hooks/exhaustive-deps` hides a real subtlety: if you edit a day in one tab and open the invoice in another, the auto-rebuild will wipe edits depending on which mount fires first.
- **No undo for invoice deletion** — the in-product undo flow only covers crew/day removal.
- **`Btn` primitive is light on accessibility** — `aria-label` only present at call sites; no focus ring styling. Default browser ring on dark background is hard to see.

### Structural concerns
- The file at 9,112 lines (570 KB) is at the edge of what Babel-standalone parses comfortably. Cold start on a mid-tier Android can take 1–3 seconds. iOS Safari is fine.
- POSTCODE_DISTANCES inline at ~82 KB is fine. No other large inline blobs.
- `Print*` styles are duplicated for timesheet vs invoice — they could share base typography. ~400 lines of duplicated CSS.
- No service worker / no offline cache — Capacitor wrap will solve, but PWA install is sub-optimal until then.

### Quick wins
1. Fix the 5 broken asset references (10 min — rename or update HTML).
2. Fix the backup filename (1 line).
3. Add ESC handler to a single `useModalDismiss(onClose)` hook (30 min, covers ~14 modals).
4. Replace `calculateDay` with `calcForDisplay` in GridCell (5 min).
5. Drop `user-scalable=no` and the inline `fontSize:14` on date inputs (2 min).
6. Bump `fixed false` `isWeekEnd` prop and fix `weekOTHrs` accumulation (10 min).
7. Extend `UK_BANK_HOLIDAYS` to 2035 (15 min of data entry).
8. Rename "Time Machine" → "TimeMachine" on the onboarding hero (1 line).

These eight items alone close all 4 P0 findings plus ~10 of the P1s.
