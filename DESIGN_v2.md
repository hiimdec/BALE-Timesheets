# TimeMachine — Design Spec v2

Version: 1.0 · Last updated: 12 May 2026

This document is the source of truth for the v2 design refresh. Claude Code should read this file before making any visual or structural change. When the doc and the codebase conflict, the doc wins — update the code, not the doc.

Visual references live in `/docs/mockups/v2.html` (the interactive day-switch mockup) and `/docs/mockups/blues.html` (palette reference). Open them when in doubt about a treatment.

---

## How to use this document

- Every prompt that touches UI should begin with: *"Read `/docs/DESIGN_v2.md` first."*
- Reference components by name (e.g. `ProductionsScreen`, `DayEntryForm`), not line numbers — the file is monolithic and lines drift.
- This app is a single-file React app (`index.html`) with no build step. All components live in a `<script type="text/babel">` block. Do not create new `.jsx` files.
- One feature per commit. Do not bundle.
- If a change touches the data shape (Production / Day / Crew / Invoice), bump `SCHEMA_VERSION` and add a numbered `MIGRATIONS[v]` entry. The machinery exists, use it.

---

## Guiding principle: chrome cool, data hot

The UI chrome — backgrounds, borders, dividers, neutral text, brand accent — is cool, restrained, and quiet so the data can shout.

The functional palette — categorical chart segments, warnings, penalties, success states — is warm and spread around the colour wheel so the eye reads it instantly.

**When tempted to add a new sky-blue shade to a status indicator or chart segment: stop.** Pull from the functional palette instead. Sky is for chrome and brand only.

---

## Colour tokens

### Brand & chrome — Sky 500

The brand accent moves from `sky-400` (`#38bdf8`) to `sky-500` (`#0ea5e9`). Slightly deeper, slightly more confident. Same temperature, same role.

A global find-and-replace of `sky-400` → `sky-500` across all Tailwind utility classes will land most of this change. Watch for these specific patterns:

- `text-sky-400` → `text-sky-500`
- `bg-sky-400` → `bg-sky-500`
- `border-sky-400` → `border-sky-500`
- `bg-sky-400/10`, `bg-sky-400/30`, `ring-sky-400/40` → swap the number, keep the alpha
- `focus:border-sky-400`, `focus:ring-sky-400/40` → same
- The native select arrow SVG embedded in CSS (`stroke='%2338bdf8'`) → change hex to `%230ea5e9`

For lighter sky tones used as secondary highlights (e.g. the Best Boy badge), use `sky-300` (`#7dd3fc`).

### Functional palette — extend Tailwind

Add this to the CDN Tailwind config in `<head>`:

```html
<script>
  tailwind.config = {
    theme: {
      extend: {
        colors: {
          'tm-warn': '#ff8a3d',    // warm orange — warnings, OT segment
          'tm-pen':  '#f43f5e',    // hot pink-red — penalties
          'tm-good': '#4ade80',    // vibrant green — kit money, "ok" states
        }
      }
    }
  }
</script>
```

This makes `text-tm-warn`, `bg-tm-warn/10`, `border-tm-warn/25` etc. available as utility classes following the existing pattern.

### CSS variables — for inline styles and gradients

Add to the `<style>` block at the top of the file:

```css
:root {
  --tm-accent: #0ea5e9;        /* sky-500 */
  --tm-accent-2: #7dd3fc;      /* sky-300 — soft */
  --tm-warn: #ff8a3d;
  --tm-pen: #f43f5e;
  --tm-good: #4ade80;
  --tm-pill-paper: #e6e9ed;    /* cool light grey — was warm cream */
  --tm-pill-ink: #15171a;
}
```

### Where each functional colour goes

| Token | Used for |
|---|---|
| `tm-warn` (warm orange) | `StatusMsg kind="warn"` background and text; meter OT segment; warning chips |
| `tm-pen` (hot pink) | `StatusMsg kind="bad"` text; meter penalty segment |
| `tm-good` (green) | `StatusMsg kind="ok"`; meter kit segment; "ON CALL" live indicator |
| `tm-accent` (sky-500) | Brand wordmark; primary CTAs; section labels; active chip outlines; meter basic segment |
| `tm-accent-2` (sky-300) | Best Boy badge outline; soft highlights |

The existing `StatusMsg` component currently uses `amber-*` for warnings — replace with `tm-warn`. `red-*` for bad — replace with `tm-pen`. `green-*` for ok — replace with `tm-good`.

---

## Typography

**No new typefaces.** Keep the existing system font stack:

```css
font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
```

For numerals, monospace stays (`font-mono` in Tailwind, which maps to `ui-monospace, SFMono-Regular, Menlo, monospace`).

The "TIMEMACHINE" wordmark stays in the brand colour (sky-500), font-black, uppercase, with `tracking-tight`. No display face change.

---

## Home Screen — `ProductionsScreen`

### Header

Three icons only, in this order: **Stats · Search · Settings**.

Remove the Cancellation Calculator icon from the header. It moves into Settings (see below).

### Tabs

The current pill-style toggle (`Productions / Invoices`) stays in its current form for now — defer the tab-strip-with-counts to a later iteration.

### Current shoot — hero card

When `currentShoot` is non-null, render the pinned card as a **hero variant** with the following structure (not the standard `renderCard` layout):

1. **Live indicator row** at the top: a pulsing 6px dot in `tm-good` + uppercase label *"ON CALL · DAY X OF Y"* in `tm-good`, weight 700, tracking 0.18em, size 10px.
   - Only show this row when the current day has a `callTime` but no `wrapTime` (i.e. you're between call and wrap).
   - If both call and wrap exist, show *"WRAPPED · DAY X OF Y"* in `text-neutral-400` instead. No pulse.
   - If neither, show standard "Current Shoot" label in sky-500 (as today).

2. **Title row**: production title (text-base, font-semibold) + Best Boy badge if applicable. No production company on this line.

3. **Meta line**: production company · today's date · location (if available) in `text-neutral-400`, size 12px.

4. **Stats grid** (three columns, divided from above by a 1px top border):
   - **CLOCKED** — time since call, format "Xh Ym" — derive from `callTime` and current time. If wrapped, show the total worked instead.
   - **TODAY** — money earned today, in sky-500.
   - **SHOOT** — total for the production so far, in default text colour.
   - Each has a small subline: "since 06:00" / "+£72 OT" / "X days".

5. **Actions row**: LUNCH NOW + WRAP NOW as full-width buttons split 50/50. The existing `LunchNowBtn` and `WrapNowBtn` components should slot in. WRAP NOW gets the primary sky-500 background; LUNCH NOW gets the ghost treatment.

### Best Boy badge

Replace the current sky-on-sky chip with a transparent background + `border-sky-300/35` + `text-sky-300`. No fill. Reads as a mode indicator, not a status.

### Standard production cards (non-current)

No structural change. Just apply the colour token sweep.

### Month groups

No structural change.

---

## Day Entry — `DayEntryForm` + `SoloDayPage`

This is the largest refactor. The current structure (Day · Times · Lunch · 2nd Break · Travel · Mileage · Extras · Notes — each a same-weight `SectionCard`) becomes a two-tier structure:

### Tier 1 — Primary block (always open)

A single `SectionCard` containing:

- **Times row** (two columns, large): Call and Wrap. Each rendered with the time at 24px in monospace, the "NOW" button as a small chip inside the label.
- **Lunch row**: single horizontal row showing start → end + duration, plus a status chip on the right (ON TIME / CURTAILED / LATE / MISSED). The existing lunch fields collapse into this compact display, with tap to expand for editing.

This block contains Call, Wrap, Lunch Start, Lunch Duration. Nothing else.

### Inline status messages

When `bs` (break state) returns a warning, the `StatusMsg` renders **inside the primary block, directly below the field that triggered it**, not at the bottom of a section. The component itself doesn't change — just where it's placed.

### Tier 2 — Conditions as chips

Below the primary block, a conditions row:

```
CONDITIONS  [Step-up]  [Pre-call]  [Mileage]  [Kit money]  [Travel time]  [Per diem]  [Expenses]
```

Each chip:
- **Default state**: dashed border, `text-neutral-400`, `bg-neutral-900`.
- **Active state**: solid `border-sky-500`, `text-sky-500`, slight fill `bg-sky-500/10`, with a small `×` to remove.

When a chip is activated, an expanded card appears below the chip row containing only that condition's fields. Cards stack in activation order. Tap the chip again (or the `×` on the expanded card) to collapse and clear.

This means: the existing conditional sections (Pre-call, Mileage, Travel time, etc.) all collapse from "always-visible empty cards" to "tap-to-add." Don't change the data fields inside — just the gating.

### Which sections become chips

- Step-up role → chip (was: toggle inside Extras). Persist + ignore via existing `stepUpEnabled` flag.
- Pre-call → chip (was: pre-call subsection). New `preCallEnabled` flag with legacy fallback to value-presence; deactivation clears `preCallTime` / `truckCallTime`.
- Mileage → chip (was: separate `MileageInput` section). New `mileageEnabled` flag with legacy fallback to `miles > 0 || mileagePostcode`; deactivation clears both.
- Kit money → chip (was: toggle inside Extras). Persist + ignore via existing `kitMoneyEnabled` flag.
- Travel time → chip (was: section inside Extras). New `travelTimeEnabled` flag with legacy fallback to `travelOutMins > 0 || travelBackMins > 0`; deactivation clears both. Hidden when day type is Travel Day.
- Per diem → chip (was: toggle inside Extras). Persist + ignore via existing `perDiemEnabled` flag (calc already honours it).
- Expenses → chip (was: section inside Extras). New `expensesEnabled` flag with legacy fallback to `expenses.length > 0`; deactivation clears the array.
- Travel day → **not** a chip — it's a `dayType` value selected via the existing Day Type dropdown. Treating it as a chip duplicates a dropdown option.
- Standby → **not** built — no existing Standby section or fields exist in `DayEntryForm` (only the "Standby Rigger" role name). Implementing it would require new data fields and calc logic, deferred until needed.
- Bank holiday → automatic from date, not a chip (keep as `StatusMsg`).

Activation policy: for chips backed by a calc-honoured enabled flag (Step-up, Kit money, Per diem), data values are preserved across enable/disable cycles (persist + ignore). For chips backed by value-presence (Pre-call, Mileage, Travel time, Expenses), the new `*Enabled` flag keeps the chip stable but `calcForDisplay` reads the value fields directly, so deactivation clears those values to drop them from totals.

Notes stays as its own section below conditions — not a chip — since it's free text. After this restructure the Extras Disclosure only wraps the Notes field.

### Day-switch animation

Replace the current `tm-day-switch` keyframe (small lift + scale) with a horizontal slide + fade.

The animation triggers on prev/next day navigation. Wrap the entire `DayEntryForm` body in a stage div with id or ref.

```css
.tm-day-stage {
  transition: transform 240ms cubic-bezier(0.22, 1, 0.36, 1),
              opacity 200ms ease;
  will-change: transform, opacity;
}
.tm-day-stage.exiting-left  { transform: translateX(-24px); opacity: 0; transition-duration: 180ms; }
.tm-day-stage.exiting-right { transform: translateX(24px);  opacity: 0; transition-duration: 180ms; }
.tm-day-stage.entering-left,
.tm-day-stage.entering-right { opacity: 0; transition: none; }
.tm-day-stage.entering-left  { transform: translateX(-24px); }
.tm-day-stage.entering-right { transform: translateX(24px); }
```

JS sequence on day switch:
1. Add `exiting-left` (next) or `exiting-right` (prev) — 180ms.
2. After 180ms: update `currentDayId`, add `entering-right` (next) or `entering-left` (prev) without transition.
3. Next frame: remove the entering class to animate back to neutral.

Total round-trip: ~260ms. See `/docs/mockups/v2.html` for the live interactive reference.

The pill total / counter should also swap with a quick opacity fade (140ms) during the transition.

---

## Calc Breakdown — `CalcBreakdownView`

### Big total card

The total at the top displays in `font-mono`, weight 800, size 42px, letter-spacing -0.02em. The pence portion (e.g. `.40`) renders at 22px in `text-neutral-400` weight 700 — same line, smaller scale.

Below the amount: a **6px earnings meter** showing the breakdown as a single segmented bar:

- BASIC — sky-500
- OT — tm-warn (warm orange)
- PEN — tm-pen (hot pink)
- KIT / Extras — tm-good (green)

Below the meter: a horizontal legend with swatch + label + value for each segment, in monospace.

### Greggs comparison — front and centre

Surface this as a dedicated card below the big total. Title: *"In real money"* in sky-500 weight 700. Show 5–6 items from `COMPARISON_ITEMS`, ordered roughly small → large, formatted as:

```
🥖  1,677  Greggs sausage rolls
🍺    335  pints in London
📼    145  rolls of gaffer tape
🪛     21  Leathermans
📻    4.8  lost walkie-talkies
🏠   0.09  years of London mortgage
```

Quantities in monospace, weight 700. Items in default font, `text-neutral-400`. Use existing `COMPARISON_ITEMS` constant.

### Day list

Compact rows below the comparison. Each row: date · times · flags (OT / CWD / BH as small tm-warn or tm-pen chips) · amount.

---

## Settings — `SettingsScreen`

Add a row for the Cancellation Calculator, placed near the top of the settings list. Tapping it opens the existing `CancellationCalcModal` (which is already wired up — just call it from here instead of from the home header).

---

## Animations — summary

| Element | Animation | Duration |
|---|---|---|
| Day switch (form body) | horizontal slide ±24px + fade | 180ms out / 240ms in |
| Pill total swap | opacity fade | 140ms |
| Live indicator dot | pulse (existing) | 2s loop |
| Chip activation | colour + border transition | 150ms |
| Hero card actions | active scale (existing) | unchanged |

No new animation libraries. All CSS-only.

---

## Implementation order

Recommended sequence — each phase is a separate prompt and a separate commit on the `design-v2` branch.

1. **Tokens.** Add Tailwind config extension + CSS variables. No visible change. Defines the vocabulary for everything that follows.
2. **Functional palette sweep.** Update `StatusMsg` colour mappings (amber → tm-warn, red → tm-pen, green → tm-good). Update the existing meter in `CalcBreakdownView` if one exists, or add it. Update the pill paper colour to `--tm-pill-paper`. First visible change.
3. **Sky 400 → Sky 500.** Find and replace `sky-400` across the file. Watch for the embedded SVG hex (`%2338bdf8` → `%230ea5e9`). Watch for any inline styles using the old hex.
4. **Calculator → Settings.** Remove the icon from `ProductionsScreen` header. Add the row to `SettingsScreen`.
5. **Home hero card.** Rebuild the `isCurrent` branch of `renderCard` in `ProductionsScreen`. Add clocked-time derivation logic.
6. **Best Boy badge restyle.** One small change, can fold into the hero card commit or stand alone.
7. **Day entry — conditions as chips (part 1).** Build the chip row and the activation/collapse logic. Wrap the existing conditional sections so they only render when their chip is active. Don't touch data flow.
8. **Day entry — conditions as chips (part 2).** Polish chip styling, transitions, and the expanded card treatment.
9. **Day entry — primary block restructure.** Compress the Lunch section into the single-row format. Move status messages inline.
10. **Day switch animation.** Replace the keyframe, wrap form body in a stage div, wire up the prev/next handlers in `SoloDayPage` to trigger the slide.
11. **Greggs comparison surface.** Add the dedicated card to `CalcBreakdownView`.
12. **Earnings meter.** Add the segmented bar + legend to `CalcBreakdownView` if not already present.

---

## Out of scope (deliberately deferred)

These were discussed but are not part of v2:

- **Grain / noise overlay** across the whole app. Maybe later, but not now.
- **Background colour shift through the day** (cool → warm between call and wrap). Gimmicky.
- **Haptic feedback** on NOW buttons. Goes with the Capacitor wrap in Phase 3, not now.
- **Empty state illustration** for "No shoots yet." Polish item for after launch.
- **Custom display typeface** (Anton, etc.). Decided against.
- **Yellow accent.** Decided against. Sky stays the only brand colour.
- **Tab strip replacing the home toggle.** Deferred — current pill toggle stays for v2.

---

## Open questions / things to check during implementation

- **Clocked time derivation**: confirm whether the existing `calcForDisplay` or `deriveBreakState` exposes a clean "minutes since call" value. If not, add a small helper. Format: less than 1 hour → "Xm"; 1+ hours → "Xh Ym".
- **Live indicator state**: define the rule for when "ON CALL" vs "WRAPPED" vs neither shows. Proposed: ON CALL if today's day has `callTime` set and no `wrapTime`; WRAPPED if both set; neither otherwise.
- **Chip persistence**: when a condition chip is deactivated, does its data persist (e.g. step-up role still stored but ignored) or is it cleared? Recommend persist + ignore — easier to re-enable mid-edit without re-typing.

Resolve these on first implementation, document the resolution back into this file.
