# TimeMachine Pre-launch Audit v2
Date: 2026-05-12
File audited: index.html (9533 lines)
Scope: ship-readiness check after Phase 1.7 + migration safety infrastructure

---

## Summary
- P0 findings: 1
- P1 findings: 5
- P2 findings: 8
- Confidence in ship-readiness: MEDIUM

  The core calculation engine is structurally sound: `calculateDay` / `calcForDisplay` work correctly for all main day types, pre-call hours are computed correctly in the normal case, and the migration infrastructure is safe for single-tab use. The one P0 is a calculation edge-case where a user who accidentally enters a pre-call time *later* than the main call will silently be charged 23+ hours of pre-call at BHR, producing a wildly wrong total with no warning. The five P1 issues are: a data-loss window during import+migration failure, the CDN privacy claim gap, the JSON backup download not working in WKWebView, `window.print()` PDF not working in WKWebView, and the CHANGELOG listing day-types (`Office Day`, `Fitting`) that don't exist in the app. None of these individually blocks the web launch, but the P0 calc regression and the two iOS issues should be fixed before the Capacitor wrap ships.

- Top items to address before shipping (ranked):
  1. [P0] Pre-call time after call-time miscalculation: add validation or clamp
  2. [P1] Import backup data-loss: take original snapshot before overwriting
  3. [P1] CHANGELOG lists `Office Day` and `Fitting` day types that are not implemented
  4. [P1] Privacy policy omits CDN network requests on every page load
  5. [P1] `URL.createObjectURL + a.click()` download silently fails in WKWebView
  6. [P1] `window.print()` PDF export silently fails in WKWebView

- Network calls confirmed:
  - `https://cdn.tailwindcss.com` — Tailwind CSS (on every page load)
  - `https://unpkg.com/react@18/umd/react.production.min.js` — React 18 (on every page load)
  - `https://unpkg.com/react-dom@18/umd/react-dom.production.min.js` — React DOM 18 (on every page load)
  - `https://unpkg.com/@babel/standalone/babel.min.js` — Babel (on every page load)
  - No unexpected outbound calls during normal app use. No analytics, no telemetry, no beacons, no XHR.
  - `postcodes.io` is NOT used; the postcode dataset is fully bundled inline.

---

## P0 — Must Fix Pre-launch

### [Lens 4 / Lens 1] Pre-call time greater than call time — silent 23-hour mis-charge

**Location:** `calculateDay`, lines 630–639

```js
const preCallH = preCallTime ? parseHHMM(preCallTime) : null;
const preUnitHrs = (() => {
  if (preCallH === null) return 0;
  if (preCallH < callH) return callH - preCallH;           // same day
  if (preCallH > callH) return (24 - preCallH) + callH;   // treats as overnight
  return 0;
})();
```

**Failure mode:** The overnight-wrap branch (`preCallH > callH`) was added to handle a legitimate scenario where a driver starts at (e.g.) 22:00 and the main unit calls at 06:00. However, it activates for *any* case where `preCallH > callH`, including the common user error of entering a pre-call time that is slightly after the main call (e.g. pre-call `09:00`, main call `08:00`). In that case:

```
preUnitHrs = (24 - 9) + 8 = 23 hours
```

This silently calculates 23 hours of pre-call at BHR, inflating the day total by 23 × BHR (e.g. ~£175 for a LT). The user receives no warning, and the breakdown shows `Pre-call: 09:00 – 08:00` which looks plausibly formatted but is wrong.

There is no upper-bound guard and no UI-level validation on the TimeInput at line 4065.

**The only case where `preCallH > callH` is legitimate is an overnight pre-call.** The threshold is ambiguous, but a pre-call more than 12 hours before the main call is almost certainly a user error. A simple validation guard — e.g. if `preUnitHrs > 12`, show a warning and/or clamp — would prevent this.

---

## P1 — Should Fix Pre-launch

### [Lens 2 / Lens 5] Import-backup data loss if migration fails

**Location:** `importBackup`, lines 1067–1087; `runMigrations`, lines 1048–1063

**Failure mode:** `importBackup()` writes the new data to localStorage at line 1079 *before* the pre-migration snapshot is taken. The snapshot is taken inside `runMigrations()` at line 1052 — by that point, the original user data has already been overwritten. If a migration throws:

1. `restoreFromPreMigrationSnapshot()` runs — but this restores the just-imported data, not the user's original data.
2. `importBackup` returns `{ ok: false, error: "Migration failed: ..." }`.
3. The user's original productions are permanently gone with no recovery path.

In practice with only SCHEMA_VERSION 1 and `MIGRATIONS[1]` calling the safe `migrateProduction`, this is unlikely to trigger. But the pattern is wrong and will become a real risk when SCHEMA_VERSION is incremented. The fix is to take a snapshot of the original data before line 1079.

### [Lens 3] Privacy policy does not mention CDN network requests

**Location:** Settings screen, lines 7426–7433

The policy states: "We use **no third-party services** for data processing, analytics, or storage." This is accurate for data processing, but the app unconditionally loads 4 scripts from external CDNs on every page open:

- `cdn.tailwindcss.com` (Tailwind CSS)
- `unpkg.com` (React 18, React DOM 18, Babel standalone)

These requests reveal the user's IP address to Tailwind Labs and npm (the unpkg operator) on every launch. This is standard practice for CDN-hosted web apps and is not a privacy *violation*, but the privacy policy as written implies no third-party network contact of any kind. Before shipping, either add a sentence like "The app loads its UI framework (React, Tailwind) from public CDNs on first load" or vendor the scripts locally.

### [Lens 6 / P1] File download via `URL.createObjectURL + a.click()` fails in WKWebView

**Location:** `handleExport`, lines 9425–9430

```js
const url = URL.createObjectURL(blob);
const a = document.createElement('a');
a.href = url; a.download = `timemachine-backup-${date}.json`;
document.body.appendChild(a); a.click(); document.body.removeChild(a);
```

`a.download` with `URL.createObjectURL` is not supported in WKWebView (Capacitor iOS). The click silently does nothing — no error, no file. This is the only way to export a backup, which means iOS users have no data escape hatch unless this is fixed before wrapping in Capacitor. Recommend either using the Capacitor Filesystem plugin or sharing the JSON blob via `navigator.share({ files: [...] })`.

### [Lens 6 / P1] `window.print()` PDF export fails in WKWebView

**Location:** Lines 5442, 6292, 8097

`window.print()` is silently ignored in WKWebView. The PDF/print export flow used in `CalcBreakdownView` (line 5442), `SoloDayPage` export (line 6292), and `InvoiceEditorView` (line 8097) will appear to do nothing when running inside Capacitor on iOS. No error is thrown, no feedback is given to the user. Recommend using the Capacitor Share plugin to open the print dialog, or implementing PDF generation via a library and downloading via the Filesystem plugin.

### [Lens 7] CHANGELOG lists day types that do not exist in the app

**Location:** `CHANGELOG.md`, line 24

```
- Day-type support: Shoot, Pre-light, Travel Day, Office Day, Prep Day, Fitting
```

`Office Day` and `Fitting` are listed but do not appear anywhere in `index.html`. The actual supported day types (line 275) are: `Shoot`, `Pre-light`, `Prep Day`, `Recce`, `Build Day`, `De-rig`, `Travel Day`, `Rest Day`. The CHANGELOG omits `Recce`, `Build Day`, `De-rig`, and `Rest Day`, and adds two types that were never shipped. This is a user-trust issue — the changelog is the public record of what's in the product.

---

## P2 — Post-launch Backlog

### [Lens 4] Pre-call silently ignored on Rest Day — not surfaced as user feedback

**Location:** `calculateDay`, lines 607–613

If a user enters a `preCallTime` on a Rest Day, it is silently discarded. The Rest Day early-return at line 607 happens before `preCallTime` is read at line 630. The user gets no indication that the pre-call was ignored. This is technically correct (no APA pre-call on Rest Days) but could confuse users. A note in the UI or a calc note would help.

### [Lens 4] Pre-call included in Travel Day total without APA citation

**Location:** `calculateDay`, lines 638–673

Pre-call hours are computed and pushed to `lines[]` at line 638, before the Travel Day branch at line 666. The Travel Day total at line 672 is `lines.reduce(...)` which includes the pre-call line. The APA terms for pre-call on Travel Days are less clear than on Shoot days. This could be intentional but should be verified against the APA spec. No crash risk.

### [Lens 4] `navigator.share` non-AbortError exceptions are swallowed silently

**Location:** `shareTextOrCopy`, lines 1122–1124

```js
try { await navigator.share({ text, title }); return 'shared'; } catch (e) {
  if (e.name === 'AbortError') return 'cancelled';
  // falls through to clipboard — but this is NOT a `return`, so execution continues
}
```

If `navigator.share` throws a non-`AbortError` (e.g. `NotAllowedError` on some browsers), the catch block does not return, and execution falls through to the clipboard path. This is actually fine for UX (clipboard fallback fires) but returns `'copied'` when share was the intended operation. No crash, minor UX ambiguity.

### [Lens 2] Crew deletion while DayEditModal is open creates orphan days

**Location:** `ProductionApp` / `ProductionListView` edit state, lines 5003–5157

The `editing` state is in the parent `ProductionListView`. If a user in Best Boy mode goes to the Crew tab and deletes a crew member while a day edit modal is open for that crew member, then saves the day form, the saved day will have a `crewId` that no longer exists in `production.crew`. The day will be invisible in all views (no crew to match) but will persist in localStorage, silently wasting storage and potentially confusing future data exports. Add a guard in the `save()` function at line 5129 to validate that `form.crewId` still exists in `crew`.

### [Lens 2] Two-tab migration collision is unhandled

**Location:** `runMigrations`, lines 1048–1063; no `storage` event listener

If a user has the app open in two tabs and one tab runs a migration (first load on a new schema version), the other tab's `useStoredState` will have already loaded and initialised React state from the pre-migration data. If the user makes an edit in the second tab and it is persisted, `useStoredState`'s `useEffect` at line 1110 will write the in-memory value back to localStorage, potentially overwriting the migrated data with the un-migrated copy. There is no `window.addEventListener('storage', ...)` listener to detect cross-tab changes. For v0.1.0 with only one migration and no real cross-tab users, this is low risk but worth documenting.

### [Lens 5] Action-sheet overlays missing `lockBodyScroll`

**Location:** `LineItemActionSheet` (line 8037), `InvoiceRowActionSheet` (line 8547), `ProductionPickerSheet` (line 8614), `InvoiceSetupWizard` (line 8669), `CalcBreakdownView` (line 5874)

These overlays render `position: fixed; inset: 0` but do not call `lockBodyScroll()`. On iOS Safari, users can still scroll the body behind the overlay (rubber-band scroll). `CalcBreakdownView` is full-screen so this is mostly imperceptible. The action sheets are bottom sheets and the body scroll-through is more noticeable. Not a crash or data-integrity issue.

### [Lens 4] Deep-link to non-existent invoice shows "Invoice not found" with no back navigation

**Location:** `InvoiceEditorView`, lines 8127–8132

```js
if (!invoice) {
  return (
    <div className="min-h-screen bg-neutral-950 flex items-center justify-center text-neutral-500 text-sm">
      Invoice not found
    </div>
  );
}
```

If `initialInvoiceId` points to an invoice that no longer exists (e.g. was deleted), the component renders a dead end with no back button. The user is stuck unless they reload. Add an `onBack()` button to this fallback render.

### [Lens 7] Privacy policy does not mention migration infrastructure

**Location:** Settings privacy section, lines 7426–7433

The privacy policy accurately describes data as stored locally only. It does not mention the migration system, which stores a `bigals_pre_migration_backup` key in localStorage alongside user data. While this is purely local and benign, it could surprise a privacy-conscious user inspecting browser storage. Minor point, but worth a single sentence explaining backup keys.

---

## Notes & Observations

**Calc engine correctness:**
- `calculateDay` is only called from one place: inside `calcForDisplay` at line 1350. There are no raw `calculateDay` call sites outside of `calcForDisplay`. This is clean — the wrapper is used consistently throughout.
- `calcForDisplay` consistently receives `prevDay` in all call sites that chain days sequentially (invoice builder at line 1192, generate crew text at line 1379, grid cell at line 4368). The TOC calculation is therefore always applied where appropriate.
- `GridCell` correctly calls `calcForDisplay` (not raw `calculateDay`) at line 4368.
- `preUnitHrs` feeds correctly into the travel gap calculation at line 805 (`travelGap = basicHrs - (workedHrs + preUnitHrs)`), ensuring travel time is not double-counted when pre-call work fills the basic hours.
- `migrateProduction` is idempotent: all fields use `??` null-coalescing, and `migrateCrew` spreads `{ isDriver: false }` before the real value. Double migration on load is safe.

**Migration safety:**
- `runMigrations()` is called at module level (line 9527), before `ReactDOM.createRoot`. A throw inside a migration is caught and rolls back via snapshot. This cannot prevent the app from mounting since the try/catch returns `{ ran: false, error }` rather than rethrowing.
- `useStoredState` calls `migrateProduction` on every item again on initialisation. This double-run is safe.
- The two `useStoredState` call sites (lines 9287–9288) both properly destructure all three returned values `[value, setValue, storageError]`. No silent third-element drops.
- `handleImport` was removed from Root; `SettingsScreen` handles import locally via `handleFileSelect`. There are no callers that pass `onImport` to `SettingsScreen` — the prop signature change is clean.

**Data integrity:**
- Breakdown overlay + edit: `CalcBreakdownView` is a read-only overlay that reads from `production.days` (passed by reference from parent). The user cannot edit via the breakdown view. `SoloDayPage` shows CalcBreakdownView while also showing the day editor, but these are sequential screens (breakdown replaces the day editor at `zIndex: 60` vs editor's `zIndex: 50`). No race; edits through the form update state, and the breakdown re-reads that state.
- Crew switch mid-edit: Best Boy mode's `DayEditModal` uses `fixedCrewId` at mount time. If the crew list is mutated externally while the modal is open, `activeCrew` recalculates at line 4194 and could become `undefined`. The save at line 5152 writes `form` which still has the original `crewId`. This creates an orphan day (see P2 above).
- `linesEdited` flag sync: Set to `true` on line edit, line delete, or line add. Set to `false` only on "Refresh from shoot" confirm (line 8471). The auto-sync in `InvoiceEditorView` (lines 8105–8125) is correctly gated: `if (!inv || inv.status !== "draft" || inv.linesEdited) return;`. Once `linesEdited` is `true`, no further auto-sync occurs. The flag cannot get stuck `false` after manual edits; it cannot get stuck `true` after an explicit refresh reset. Logic is sound.

**Wizard state:**
- `OnboardingScreen` (line 6872) and `InvoiceSetupWizard` (line 8669) both store step state in component-local `useState`. If the user closes without completing, step resets to 1 on next open. No partial state persists. This is acceptable UX for a setup wizard.

**iOS/Capacitor:**
- `viewport-fit=cover` is present (line 5). Safe-area insets are used consistently throughout.
- `window.location.reload()` after import works in Capacitor.
- `mailto:` link is used correctly (line 2935); fine in Capacitor.
- `navigator.share` has clipboard and `prompt()` fallbacks.
- `indexedDB`, `sessionStorage`, `cookies`, and `Cache API` are not used. Only `localStorage`.
- No hardcoded `localhost` URLs.

**Overall readiness for web launch:** The app is solid. The P0 (pre-call miscalculation) needs a validation guard. The four P1s should be addressed — the CHANGELOG fix is trivial, the import snapshot fix is a few lines, and the two iOS download/print issues block the Capacitor path but not the PWA web launch. Ship the web version after fixing P0 and P1s.
