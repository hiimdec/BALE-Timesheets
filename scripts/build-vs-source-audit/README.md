# Build-vs-Source pay-engine audit

This harness answers ONE question with high confidence:

> *Did the offline build (`npm run build`) change any pay-calculation behaviour
> compared to the pre-build source in `index.html`?*

It does **not** check pay calculations against the APA rulebook — that's a
separate, independent-reference effort. This is a build-integrity check.

## How to run

```sh
npm install                # once, if not already
npm run build              # produce dist/ from current index.html
npm run audit:build        # run both checks
```

Or run each check on its own:

```sh
npm run audit:build:exec       # execution audit (scenarios → both engines → compare)
npm run audit:build:textual    # textual audit (bundle reproducibility + presence)
```

Exit code is 0 on PASS, non-zero on any divergence.

## What the two checks do

### 1. Execution audit — `compare.js`

Loads the pay engine **twice** in two Node `vm` sandboxes:

- **Source engine** — `index.html`'s `<script type="text/babel">` body,
  JSX-transformed with the same esbuild options the build uses (minus the
  IIFE wrap, so an appended `globalThis.__engine = {...}` line at script
  scope can see the function declarations).
- **Built engine** — `dist/assets/app.js` exactly as it sits on disk; the
  same `globalThis.__engine = {...}` line is spliced in just before the
  closing `})();` of the IIFE.

Both sandboxes stub React, ReactDOM, `document`, `localStorage`, `navigator`,
etc., so the surrounding component code can be DEFINED without throwing.
None of the React components are rendered.

Then it runs `scenarios.js` — currently 84 cases covering:

| Group | What it probes |
|-------|-----------------|
| A | Continuous shoot days, varied call/wrap |
| B | Pre-light, including Saturday Pre-light bugfix region |
| C | Prep / Recce / Build / De-rig |
| D | Travel Day |
| E | Rest Day |
| F | Night shoots (overnight wrap) |
| G | Pre-call before/after 05:00 boundary |
| H | Missed/late breaks, second break tracking |
| I | CWD (continuous working day) breaks |
| J | Saturday / Sunday rate variations |
| K | Bank holidays (Jan 1, Good Friday, Easter Monday, Christmas) |
| L | Mileage / per diem / kit money / expenses |
| M | Step-up (Spark → Gaffer etc.) |
| N | PMPA roles (Floor Runner / PM / PA / Production Runner) |
| O | TOC (rest <11h, breach <10h) via `prevDay` |
| P | noOT roles (Director, Producer) |
| Q | BWD-override roles (DoP / Art Director / Location Manager) on non-Shoot days |
| R | Edge cases (zero BDR, APA rounding, favourable rounding, fixed OT rate) |

For each scenario it calls `calcForDisplay(production, day, crewMember, prevDay)`
on both engines and **deep-compares** the resulting calc object (total, lines,
meta) field by field. Float comparison is strict — any non-zero divergence is
a real finding because the build is documented as a purely mechanical
JSX → JS transform.

Per-run JSON detail: `scripts/build-vs-source-audit/last-run-report.json`
(git-ignored).

### 2. Textual audit — `textual-diff.js`

Two parts:

1. **Full-bundle reproducibility** — re-runs esbuild on the current
   `index.html` with the exact same options `scripts/build.js` uses and
   byte-compares the result to `dist/assets/app.js`. If equal, the file on
   disk is reproducible from source — no out-of-band edit could be hiding
   in it.
2. **Per-function presence** — extracts each named pay-calc function
   (`calcForDisplay`, `calculateDay`, `calculatePmpaDay`, `resolveDay`,
   `resolveCrewForDay`, `calcTOC`, `augmentCalc`) from both source and built
   bundles and confirms each is present in both. Reports raw and normalized
   byte sizes for visual sanity.

Because (1) shows bundle byte-equality, per-function byte-equality follows by
transitivity — so the per-function presence check is the right level of
detail; trying to byte-compare each function in isolation would re-transform
it with snippet-local helpers that aren't there at bundle scope.

Per-run JSON detail: `scripts/build-vs-source-audit/last-textual-diff.json`
(git-ignored).

## What a PASS means

- The built `dist/` is calc-identical to the source `index.html`, to the
  penny, across a broad sweep of varied scenarios.
- The built bundle is reproducible from the source by re-running the build.
- No pay-calc function was renamed, dropped, or quietly altered.

## What a PASS does NOT mean

- It does **not** prove the engine matches the APA rulebook. The engine
  could be wrong and both source and built could agree on the same wrong
  number. To check correctness against the spec, build an independent
  reference implementation and compare to that.

## Extending the scenario set

Add entries to `scenarios.js`. Each entry calls `mk(id, label, crewOverrides,
dayOverrides, productionOverrides, prevDayOverrides)`. Group with a letter
prefix and a stable ID so reports stay stable.
