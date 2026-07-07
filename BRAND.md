# TimeMachine — brand & design system

The single source of truth for any surface built *off* the app: social, store
listings, decks, email. Every value here is lifted from the shipped app
(`index.html` tokens, `icon.svg`) and the marketing pages, not from memory. If
this file and the app ever disagree, the app wins — update this file.

The guiding principle, verbatim from the design tokens: **chrome cool, data
hot. Sky is brand only.** The interface is quiet neutrals; colour is reserved
for money and meaning.

---

## Colour

### Chrome — neutrals (backgrounds, surfaces, text)
The whole interface sits on a near-black neutral ramp. Cool, recessive, never competing with data.

| Token | Hex | Role |
|---|---|---|
| Background | `#0a0a0a` | neutral-950 — the page. Everything sits on this. |
| Background soft | `#0e0e0e` | faint lift under radial glows |
| Card | `#171717` | neutral-900 — cards, sheets, rows |
| Card lifted | `#1f1f1f` | neutral-800.5 — chips/pills that need to rise off a card |
| Border | `#262626` | neutral-800 — hairlines, dividers |
| Text primary | `#f5f5f5` | neutral-100 — headings, key values |
| Text secondary | `#a3a3a3` | neutral-400 — body copy |
| Text tertiary | `#737373` | neutral-500 — captions, hints (the workhorse muted tone) |
| Text faint | `#525252` | neutral-600 — footnotes, disabled |

### Brand — sky (and nothing else wears it)
| Token | Hex | Role |
|---|---|---|
| Sky | `#0ea5e9` | sky-500 — **the brand colour.** Wordmark, links, primary actions, active state, microlabels. |
| Sky light | `#7dd3fc` | sky-300 — hover/pressed on sky |

### Functional — data, never chrome
These colours mean something. They appear on figures, chips and breakdown segments, never on furniture.

| Token | Hex | Meaning |
|---|---|---|
| OT orange | `#ff8a3d` | overtime, warnings — the second bar of the mark |
| Penalty rose | `#f43f5e` | penalties, late-payment charges, overdue — the third bar of the mark |
| Positive green | `#4ade80` | extras, "ok / sent / paid" states |
| Kit violet | `#a78bfa` | kit-money segment in breakdown buckets |
| Variance fuchsia | `#e879f9` | variance / step-up / anomaly highlights |

### Usage rules (non-negotiable)
- **Sky is brand and interaction only.** A button, a link, the wordmark, an active tab, a microlabel. Never decorate a shape or fill a background with sky.
- **The functional palette is for data only.** Orange/rose/green/violet/fuchsia belong on numbers, chips and chart segments — never on chrome (bars, borders, backgrounds).
- **Chrome stays cool; data runs hot.** If a colour isn't carrying meaning, it's a neutral.
- **One accent per element.** Money is one colour, its context another; don't stack them.

---

## Typography

Two families, each with one job. TimeMachine does **not** ship a bespoke UI font — prose uses the OS system stack; the app's own wordmark/icon are set in Inter ExtraBold.

**Prose — system sans.** Everything readable.
```
-apple-system, BlinkMacSystemFont, ui-sans-serif, system-ui,
"Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif
```

**Figures — monospace.** Every number the user might check: money, times, hours, rates, dates, invoice totals. Tabular, aligned, unmistakably data.
```
ui-monospace, SFMono-Regular, Menlo, Monaco, monospace
```
> **Mono = money/data only.** If it's a figure a user reads as a value, it's mono. If it's a sentence, it's sans. Never set prose in mono or money in sans.

**Weights.** Body 400; emphasis/labels 600–700; headings and the wordmark 800–900.

**Microlabel** — the recurring section marker. Tiny, uppercase, wide-tracked, bold, in sky or muted neutral:
```
font-size: 10px; text-transform: uppercase;
letter-spacing: 0.22em; font-weight: 700; color: #0ea5e9;
```
Headings are tight the other way: `letter-spacing: -0.02em` to `-0.03em`, weight 900.

**Wordmark** — `TIMEMACHINE`, uppercase, Inter/system weight 900, `letter-spacing: -0.02em`, sky. An optional owner prefix (`DECLAN'S`) sits above it in the microlabel style (10px, 0.22em, 700, muted).

### Copy rules
- **Sentence case** everywhere — headings, buttons, labels. Not Title Case.
- **British English** — organise, colour, cancelled, licence.
- **No em dashes.** Use a spaced hyphen ` - `, a comma, or two sentences. (This holds on every surface, app and marketing alike.)
- Plain words over jargon. A number the user can check beats an adjective.

---

## Logo assets

In this directory, regenerable via `node brand/make_logos.js` (reuses the app's real SVG-plus-sharp icon toolchain — see `scripts/generate-icons.js`):

| File | What | Background |
|---|---|---|
| `wordmark.svg` · `wordmark-1024.png` | `TIMEMACHINE` sky wordmark | transparent |
| `mark.svg` · `mark-1024.png` | the three-bar mark | transparent |
| `app-icon.svg` · `app-icon-1024.png` | the mark on the dark rounded square (the App Store icon) | `#0a0a0a` |

**The mark** is three descending rounded bars — full, ~64%, ~32% width — in sky, OT orange, penalty rose, top to bottom. It reads as a timesheet/bar-chart shrinking down, and the three colours are the app's own semantic order (brand, overtime, penalty).

**Clear space:** keep at least one bar-height of empty space around the mark and the wordmark. **Minimum wordmark width** 120px on screen. Place on `#0a0a0a` or a near-black neutral; the transparent PNGs also sit cleanly on dark photography. Don't recolour the wordmark, don't add effects, don't set the mark's bars to a single colour, don't stretch (the wordmark aspect is ~9.1:1).

---

## Voice

- **Built by crew, for crew.** The register is a focus puller who can do the maths, not a marketer. It assumes you know what a BDR and an OT break are.
- **Dry, plain, never salesy.** Short sentences. A joke lands because it's true (Greggs, biro on the back of a call sheet), never because it's trying. No exclamation marks, no "revolutionise", no "seamless".
- **Confident because it's correct.** The tool does the sums; the copy states what happens and gets out of the way.

Example captions:
> Overdue invoice? The Act says you're owed interest and a fixed fee. Two taps, it's on the invoice, PDF attached to the chase email. Go on then.

> Sunday rate, bank holidays for the next decade, the 11-hour turnaround - all caught before you'd have spotted them. You just log the times.

---

## Social templates

Instagram post (1080×1350) and story (1080×1920) templates live in `brand/`,
generated by `brand/make_social.py` (Pillow + segno) — two variants each:

- **Title card** — sky wordmark, sky rule, a headline in Inter on the dark canvas.
- **Screenshot frame** — a phone frame holding an app screenshot, small wordmark above.

Regenerate with a new headline (nothing else moves):
```
python3 brand/make_social.py --format post --variant title \
    --headline "Your line here." --out brand/examples/post-title.png
python3 brand/make_social.py --format story --variant screenshot \
    --screenshot shot.png --out brand/examples/story-screenshot.png
python3 brand/make_social.py --all        # rebuild every example
```
`--qr` adds a QR to timemachineapp.co.uk. Worked examples are in `brand/examples/`.
