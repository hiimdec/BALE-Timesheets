/*
 * theme-parity.js
 *
 *   $ node scripts/build-vs-source-audit/theme-parity.js
 *
 * Theme-token lockstep suite. Four permanent invariants:
 *
 *   1. CONFIG PARITY — the colour palette in index.html's inline
 *      tailwind.config (the web app, Play CDN) and tailwind.config.js at the
 *      repo root (the native build's static stylesheet) are deep-equal. The
 *      two blocks are maintained as verbatim copies by hand; if they drift,
 *      web and native render different colours with every other audit still
 *      green — no assertion elsewhere can see it.
 *
 *   2. VAR RESOLUTION, PER THEME SCOPE — every CSS variable referenced by
 *      either config (the `var(--tm-…)` form) is defined exactly once in the
 *      :root block AND exactly once in the html.tm-theme-poppy block, as a
 *      space-separated RGB channel triplet ("14 165 233"). An undefined or
 *      malformed variable does not error at runtime — the utility silently
 *      renders as transparent/invalid, which no build step catches. The pill
 *      vars (paper hex + ink triplet + digit derivations) are checked for
 *      per-scope presence too, though the configs never reference them.
 *
 *   3. POPPY PALETTE PINS — the poppy scope's 26 palette triplets plus the
 *      pill paper/ink resolve to EXACTLY the hexes Derrick supplied on
 *      2026-07-24 (single-curve, gamut-checked, ruled "do not adjust").
 *      Any drift — a typo, a helpful rounding, a stray re-derivation — goes
 *      red here. Assertion added with the approved stage-2 theme commit.
 *
 *   4. PRINT ISOLATION — PRINT_STYLES and INVOICE_PRINT_STYLES contain no
 *      `var(--tm-` reference. Invoices and timesheets are documents sent to
 *      production companies; they are raw-hex stylesheets by design and must
 *      never resolve through the theme system, in any theme, ever.
 *
 * Landed GREEN before the stage-1 variable refactor (its own commit), so a
 * red result always isolates to the change that caused it — the same
 * bisectability rule as the stage-1/stage-2 split itself.
 *
 * Wiring:
 *   - Standalone:               npm run audit:theme
 *   - Auto-runs in the gate:    npm run audit:build
 *
 * Exit code: 0 if all assertions pass, 1 if any fail, 2 on harness error.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

// The poppy palette as ruled (hex, verbatim from Derrick 2026-07-24).
const POPPY_PINS = {
  '--tm-neutral-950': '#160a10', '--tm-neutral-900': '#2a1420',
  '--tm-neutral-800': '#452438', '--tm-neutral-700': '#5d3b4b',
  '--tm-neutral-600': '#6d4a58', '--tm-neutral-500': '#9a6f85',
  '--tm-neutral-400': '#cfa0b9', '--tm-neutral-300': '#ebcfdf',
  '--tm-neutral-200': '#f4e0eb', '--tm-neutral-100': '#fdeff7',
  '--tm-sky-100': '#fce7f1', '--tm-sky-200': '#fccee5',
  '--tm-sky-300': '#f9a8d4', '--tm-sky-400': '#fc88c7',
  '--tm-sky-500': '#f472b6', '--tm-sky-600': '#ce5897',
  '--tm-sky-700': '#a8467b', '--tm-sky-800': '#8e3f68',
  '--tm-sky-900': '#783658', '--tm-sky-950': '#52243c',
  '--tm-fuchsia-400': '#8be6f5',
  '--tm-warn': '#ffcb7d', '--tm-pen': '#ff7d6e',
  '--tm-good': '#c5e79c', '--tm-kit': '#c3b1fc',
  '--tm-card-2': '#351a2a',
};
const POPPY_PILL = { paper: '#f7e3ee', ink: '#2a1420' };

// ---- Pass/fail collector (kit-assertions house pattern) --------------------

function makeCollector() {
  let pass = 0, fail = 0;
  const failures = [];
  const ok = (label, cond, detail) => {
    if (cond) { pass++; console.log(`  ✓ ${label}`); }
    else      { fail++; failures.push({ label, detail }); console.log(`  ✗ FAIL ${label}${detail ? ' — ' + detail : ''}`); }
  };
  const summary = () => ({ pass, fail, failures });
  return { ok, summary };
}

// ---- Extraction helpers ----------------------------------------------------

function extractBraceBlock(src, from) {
  const open = src.indexOf('{', from);
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  return null;
}

function inlineConfigColors(html) {
  const cfgAt = html.indexOf('tailwind.config = {');
  if (cfgAt === -1) throw new Error('inline `tailwind.config = {` not found in index.html');
  const cfgBlock = extractBraceBlock(html, cfgAt);
  if (!cfgBlock) throw new Error('could not brace-match the inline tailwind.config block');
  const colorsAt = cfgBlock.indexOf('colors:');
  if (colorsAt === -1) throw new Error('no `colors:` key inside the inline tailwind.config');
  const colorsBlock = extractBraceBlock(cfgBlock, colorsAt);
  if (!colorsBlock) throw new Error('could not brace-match the inline colors block');
  return new Function(`return (${colorsBlock});`)();
}

function extractTemplateLiteral(html, constName) {
  const marker = `const ${constName} = \``;
  const at = html.indexOf(marker);
  if (at === -1) throw new Error(`\`${marker}\` not found in index.html`);
  const start = at + marker.length;
  const end = html.indexOf('`', start);
  if (end === -1) throw new Error(`unterminated template literal for ${constName}`);
  return html.slice(start, end);
}

// Theme scope blocks. Both markers are unique: ':root {' appears once (the
// print stylesheets define no :root), and 'html.tm-theme-poppy {' with the
// brace matches only the override block (the hairline rule's selector
// continues past the class before its brace).
function themeScope(html, marker) {
  const at = html.indexOf(marker);
  if (at === -1) throw new Error(`\`${marker}\` not found in index.html`);
  const block = extractBraceBlock(html, at);
  if (!block) throw new Error(`could not brace-match the ${marker} block`);
  return block;
}

function collectThemeVars(colors, out = new Set()) {
  for (const v of Object.values(colors)) {
    if (v && typeof v === 'object') { collectThemeVars(v, out); continue; }
    if (typeof v !== 'string') continue;
    for (const m of v.matchAll(/var\((--tm-[a-z0-9-]+)\)/g)) out.add(m[1]);
  }
  return out;
}

// All definitions of `name` inside a scope block, values trimmed.
function defsIn(scope, name) {
  return [...scope.matchAll(new RegExp(`${name}:\\s*([^;\\n]+);`, 'g'))].map(m => m[1].trim());
}

const isTriplet = v => /^\d{1,3} \d{1,3} \d{1,3}$/.test(v) && v.split(' ').every(c => Number(c) <= 255);
const hexToTriplet = hex => {
  const v = parseInt(hex.slice(1), 16);
  return `${(v >> 16) & 255} ${(v >> 8) & 255} ${v & 255}`;
};

function deepDiff(a, b, trail, diffs) {
  const isObjA = a && typeof a === 'object';
  const isObjB = b && typeof b === 'object';
  if (isObjA !== isObjB) { diffs.push(`${trail}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`); return; }
  if (!isObjA) {
    if (a !== b) diffs.push(`${trail}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
    return;
  }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    if (!(k in a)) { diffs.push(`${trail}.${k}: missing in inline config`); continue; }
    if (!(k in b)) { diffs.push(`${trail}.${k}: missing in tailwind.config.js`); continue; }
    deepDiff(a[k], b[k], `${trail}.${k}`, diffs);
  }
}

// ---- Main ------------------------------------------------------------------

function main() {
  const { ok, summary } = makeCollector();
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

  console.log('\ntheme-parity — config lockstep, per-scope resolution, poppy pins, print isolation\n');

  // ── 1. CONFIG PARITY ──────────────────────────────────────────────────────
  console.log('1. Config parity (inline web config vs tailwind.config.js)');
  const inline = inlineConfigColors(html);
  const native = require(path.join(ROOT, 'tailwind.config.js')).theme.extend.colors;
  const diffs = [];
  deepDiff(inline, native, 'colors', diffs);
  ok('inline tailwind.config colours deep-equal tailwind.config.js colours',
    diffs.length === 0, diffs.slice(0, 5).join(' | '));

  // Parity is NOT just the palette. `future: { hoverOnlyWhenSupported: true }`
  // lived only in the inline web config for the whole life of the static
  // stylesheet, so the native build emitted every `hover:*` utility ungated.
  // On iOS a tap sets :hover and leaves it set until the next touch lands
  // elsewhere, so the last thing tapped kept its hover colour — on a solid
  // button that reads as the button going pale, because hover:bg-sky-300 is a
  // LIGHTER tint than the bg-sky-500 under it. Nothing could see it: the
  // palette matched, so this assertion stayed green while web and native
  // behaved differently on touch. Any non-colour key that changes emitted CSS
  // belongs here.
  const inlineFuture = (() => {
    const m = html.match(/future: \{([^}]*)\}/);
    if (!m) return null;
    const out = {};
    for (const pair of m[1].split(',')) {
      const kv = pair.split(':').map(x => x.trim());
      if (kv.length === 2 && kv[0]) out[kv[0]] = kv[1] === 'true';
    }
    return out;
  })();
  const nativeFuture = require(path.join(ROOT, 'tailwind.config.js')).future || null;
  const futureDiffs = [];
  deepDiff(inlineFuture, nativeFuture, 'future', futureDiffs);
  ok('inline tailwind.config `future` flags deep-equal tailwind.config.js `future` flags — the hover gate must reach the NATIVE stylesheet, or iOS keeps every tapped element in its hover colour',
    inlineFuture !== null && nativeFuture !== null && futureDiffs.length === 0,
    futureDiffs.slice(0, 5).join(' | ') || `inline=${JSON.stringify(inlineFuture)} native=${JSON.stringify(nativeFuture)}`);
  ok('the hover gate is actually ON in both configs (hoverOnlyWhenSupported)',
    !!(inlineFuture && inlineFuture.hoverOnlyWhenSupported) && !!(nativeFuture && nativeFuture.hoverOnlyWhenSupported),
    `inline=${inlineFuture && inlineFuture.hoverOnlyWhenSupported} native=${nativeFuture && nativeFuture.hoverOnlyWhenSupported}`);

  // ── 2. VAR RESOLUTION, PER THEME SCOPE ────────────────────────────────────
  console.log('2. Var resolution (each var defined exactly once per theme scope, as channels)');
  const rootScope = themeScope(html, ':root {');
  const poppyScope = themeScope(html, 'html.tm-theme-poppy {');
  const vars = [...collectThemeVars(inline)].sort();
  if (vars.length === 0) {
    ok('no theme variables referenced by either config — nothing to resolve', true);
  }
  for (const name of vars) {
    const inRoot = defsIn(rootScope, name);
    const inPoppy = defsIn(poppyScope, name);
    ok(`${name} defined once per scope as an RGB channel triplet`,
      inRoot.length === 1 && isTriplet(inRoot[0]) && inPoppy.length === 1 && isTriplet(inPoppy[0]),
      `root=${JSON.stringify(inRoot)} poppy=${JSON.stringify(inPoppy)}`);
  }
  // Pill system: not config-referenced, but part of the theme contract.
  ok('--tm-pill-paper defined once per scope (whole-colour hex)',
    defsIn(rootScope, '--tm-pill-paper').length === 1 && defsIn(poppyScope, '--tm-pill-paper').length === 1);
  ok('--tm-pill-ink defined once per scope as an RGB channel triplet',
    defsIn(rootScope, '--tm-pill-ink').filter(isTriplet).length === 1 &&
    defsIn(poppyScope, '--tm-pill-ink').filter(isTriplet).length === 1);
  ok('--tm-pill-digit-ink / --tm-pill-digit-faint / --tm-pill-caption defined once per scope',
    defsIn(rootScope, '--tm-pill-digit-ink').length === 1 && defsIn(poppyScope, '--tm-pill-digit-ink').length === 1 &&
    defsIn(rootScope, '--tm-pill-digit-faint').length === 1 && defsIn(poppyScope, '--tm-pill-digit-faint').length === 1 &&
    defsIn(rootScope, '--tm-pill-caption').length === 1 && defsIn(poppyScope, '--tm-pill-caption').length === 1);

  // ── 3. POPPY PALETTE PINS ─────────────────────────────────────────────────
  console.log('3. Poppy pins (the ruled palette, exact — do not adjust)');
  let pinned = 0;
  const wrong = [];
  for (const [name, hex] of Object.entries(POPPY_PINS)) {
    const got = defsIn(poppyScope, name)[0];
    if (got === hexToTriplet(hex)) pinned++;
    else wrong.push(`${name}: expected ${hexToTriplet(hex)} (${hex}), got "${got}"`);
  }
  ok(`all 26 poppy palette triplets match the ruled hexes exactly (${pinned}/26)`,
    pinned === 26, wrong.slice(0, 4).join(' | '));
  ok(`poppy pill paper is ${POPPY_PILL.paper} and pill ink is ${POPPY_PILL.ink}`,
    defsIn(poppyScope, '--tm-pill-paper')[0] === POPPY_PILL.paper &&
    defsIn(poppyScope, '--tm-pill-ink')[0] === hexToTriplet(POPPY_PILL.ink));

  // ── 4. PRINT ISOLATION ────────────────────────────────────────────────────
  console.log('4. Print isolation (PRINT_STYLES / INVOICE_PRINT_STYLES never theme)');
  for (const name of ['PRINT_STYLES', 'INVOICE_PRINT_STYLES']) {
    const css = extractTemplateLiteral(html, name);
    ok(`${name} found and contains no var(--tm- reference (${css.length} chars)`,
      css.length > 1000 && !css.includes('var(--tm-'));
  }

  // ── 5. LITERAL LEAK SCAN ──────────────────────────────────────────────────
  // The class of miss that let the select chevron ship blue in poppy: a token
  // VALUE hardcoded in an encoding a literal grep for "#hex" cannot see. The
  // scan hunts all 26 default token values in three encodings — #hex (any
  // case), %23hex (URL-encoded, the chevron's data URI), and rgb/rgba
  // comma-triplets (the overdue-glow form) — and requires ZERO occurrences
  // outside the documented exempt zones, which are exactly the deliberate
  // static faces of the palette:
  //   the two print stylesheets (raw-hex documents by design), the :root and
  //   poppy definition blocks (the tokens' homes), the two select chevron
  //   rules (data URIs cannot resolve var(); one static URI per theme), the
  //   boot-mark fallback fill= attributes, the crash fallback (must survive a
  //   broken stylesheet), the two parked bespoke banners, the theme-color
  //   meta (flipped by JS), and the GridPage print-header inline style (print
  //   DOM that renders outside the print stylesheets' literals).
  // Deliberately NOT scanned: space-form rgb(R G B ...) triplets — that is
  // the var-resolved output form and scanning it would need var-context
  // awareness for no known leak vector.
  console.log('5. Literal leak scan (no token value in any encoding outside the exempt zones)');
  {
    const DEFAULT_TOKENS = {
      '--tm-neutral-100': '#f5f5f5', '--tm-neutral-200': '#e5e5e5', '--tm-neutral-300': '#d4d4d4',
      '--tm-neutral-400': '#a3a3a3', '--tm-neutral-500': '#737373', '--tm-neutral-600': '#525252',
      '--tm-neutral-700': '#404040', '--tm-neutral-800': '#262626', '--tm-neutral-900': '#171717',
      '--tm-neutral-950': '#0a0a0a',
      '--tm-sky-100': '#e0f2fe', '--tm-sky-200': '#bae6fd', '--tm-sky-300': '#7dd3fc',
      '--tm-sky-400': '#38bdf8', '--tm-sky-500': '#0ea5e9', '--tm-sky-600': '#0284c7',
      '--tm-sky-700': '#0369a1', '--tm-sky-800': '#075985', '--tm-sky-900': '#0c4a6e',
      '--tm-sky-950': '#082f49',
      '--tm-fuchsia-400': '#e879f9', '--tm-warn': '#ff8a3d', '--tm-pen': '#f43f5e',
      '--tm-good': '#4ade80', '--tm-kit': '#a78bfa', '--tm-card-2': '#1f1f1f',
    };
    const literalRange = (constName) => {
      const marker = `const ${constName} = \``;
      const at = html.indexOf(marker);
      if (at === -1) throw new Error(`leak scan: ${constName} marker missing`);
      return [at, html.indexOf('`', at + marker.length) + 1];
    };
    const blockRange = (marker) => {
      const at = html.indexOf(marker);
      if (at === -1) throw new Error(`leak scan: ${marker} missing`);
      const open = html.indexOf('{', at);
      let depth = 0;
      for (let i = open; i < html.length; i++) {
        if (html[i] === '{') depth++;
        else if (html[i] === '}') { depth--; if (depth === 0) return [at, i + 1]; }
      }
      throw new Error(`leak scan: unclosed block for ${marker}`);
    };
    const regexRanges = (re) => [...html.matchAll(re)].map(m => [m.index, m.index + m[0].length]);
    // Start-marker → end-marker span (for regions that aren't a brace block).
    const spanBetween = (s, e) => {
      const a = html.indexOf(s);
      if (a === -1) throw new Error(`leak scan: span start missing: ${s}`);
      const b = html.indexOf(e, a);
      if (b === -1) throw new Error(`leak scan: span end missing: ${e}`);
      return [a, b];
    };
    const exempt = [
      literalRange('PRINT_STYLES'),
      literalRange('INVOICE_PRINT_STYLES'),
      blockRange(':root {'),
      blockRange('html.tm-theme-poppy {'),
      // Both chevron rules (base + poppy) — static data-URI SVGs.
      ...regexRanges(/select \{[^}]*data:image\/svg[^}]*\}/g),
      // Boot-mark fallback fills (style= carries the var; fill= is the fallback).
      ...regexRanges(/<rect [^>]*fill="#(?:0ea5e9|ff8a3d|f43f5e)"[^>]*>/g),
      // Crash fallback — deliberately var-free; span the WHOLE concatenated
      // statement (its second line carries #f5f5f5).
      ...regexRanges(/root\.innerHTML = '<div style="position:fixed;inset:0;background:#0a0a0a[\s\S]*?<\/div>';/g),
      // The theme-color meta's runtime WRITER (the reconcile effect) — the
      // mechanism that flips the meta necessarily holds both bg literals.
      ...regexRanges(/poppy \? '#160a10' : '#0a0a0a'/g),
      // Print-DOM inline styles that render OUTSIDE the print stylesheets'
      // literals: the rate-row separators and the empty-cell dash (PrintView /
      // GridPage JSX — print documents, deliberately raw like the stylesheets).
      ...regexRanges(/<span style=\{\{color:'#d4d4d4'\}\}>/g),
      // The two parked bespoke banners (KNOWN POPPY CLASH comments nearby).
      ...regexRanges(/background: '#0c1e33'[^\n]*/g),
      ...regexRanges(/background: '#052e16'[^\n]*/g),
      // theme-color meta — flipped by JS at runtime; the attribute is static.
      ...regexRanges(/<meta name="theme-color" content="#0a0a0a">/g),
      // GridPage print-header meta line — print DOM outside the print literals.
      ...regexRanges(/className="meta" style=\{\{fontSize:'10\.5px',color:'#525252',marginTop:6\}\}/g),
      // The print COMPONENT blocks. PRINT_STYLES / INVOICE_PRINT_STYLES cover
      // the stylesheets, but the redesigned timesheet and invoice also carry
      // raw colour in JSX — the SVG chip tables, the segment-bar segment
      // fills, the summary swatches and the repeat-strip ink. These are
      // FINANCIAL DOCUMENTS sent to clients: they must render identically in
      // every theme, so their literals are deliberate and permanent. (The
      // matching print-isolation guarantee is invariant 4 plus the fact that
      // the native PDF packager ships a bare <html> with no theme class.)
      spanBetween('/* ══════════ TSD — the redesigned timesheet document ══════════', '/* ── PrintView portal ── */'),
      spanBetween('// ── Invoice presentation helpers ─────', '/* ── Portal wrapper for window.print() flow ── */'),
      // The crash screen stays RAW on purpose: if the theme system itself is
      // what broke, a themed error screen renders invisible. Same reasoning as
      // the pre-existing root.innerHTML crash fallback above.
      ...regexRanges(/class RootErrorBoundary[\s\S]*?\n      \}\n/g),
      ...regexRanges(/className="meta" style=\{\{fontSize:'10\.5px',color:'#525252',marginTop:6\}\}/g),
    ];
    const inExempt = (i) => exempt.some(([a, b]) => i >= a && i < b);
    const leaks = [];
    for (const [name, hex] of Object.entries(DEFAULT_TOKENS)) {
      const h = hex.slice(1);
      const v = parseInt(h, 16), r = (v >> 16) & 255, g = (v >> 8) & 255, b = v & 255;
      const res = [
        new RegExp(`#${h}`, 'gi'),
        new RegExp(`%23${h}`, 'gi'),
        new RegExp(`rgba?\\(\\s*${r}\\s*,\\s*${g}\\s*,\\s*${b}\\b`, 'g'),
      ];
      for (const re of res) {
        for (const m of html.matchAll(re)) {
          if (!inExempt(m.index)) {
            const line = html.slice(0, m.index).split('\n').length;
            leaks.push(`${name} ${m[0]} @line ${line}`);
          }
        }
      }
    }
    ok(`zero token-value literals outside the exempt zones (26 tokens × 3 encodings)`,
      leaks.length === 0, leaks.slice(0, 6).join(' | '));
  }

  // ── 6. CLASS-FAMILY GUARD ─────────────────────────────────────────────────
  // The leak scan (5) catches raw token VALUES. This catches the other way a
  // colour escapes the theme: a Tailwind utility from a family the theme
  // system never remaps. `bg-orange-500` renders identically in both themes
  // and no other assertion can see it — it simply ships un-themed.
  //
  // Every colour utility in index.html must therefore resolve to one of:
  //   REMAPPED  — neutral / sky / fuchsia / tm-* (these read the CSS vars, so
  //               poppy re-colours them for free);
  //   ACHROMATIC— white / black / transparent / current / inherit (deliberately
  //               theme-invariant: on-accent ink, scrims, dividers);
  //   ALLOWLIST — semantic stock colours that MUST NOT follow the brand hue,
  //               because their meaning is the colour: destructive red, warning
  //               amber, the named orange button variant, and the long form
  //               beta's highlighter yellow (ruled Phase 2d: the one bright
  //               hue the system doesn't already use — visible without
  //               reading as OT orange). A pink "delete" would be actively
  //               harmful, so these are pinned, not themed.
  // A new family outside all three fails here rather than shipping unnoticed.
  console.log('6. Class-family guard (no colour utility outside remapped / achromatic / allowlist)');
  {
    const REMAPPED   = new Set(['neutral', 'sky', 'fuchsia']);
    const ACHROMATIC = new Set(['white', 'black', 'transparent', 'current', 'inherit']);
    const ALLOWLIST  = new Set(['red', 'amber', 'orange', 'yellow']);
    const PROPS = 'bg|text|border|ring|divide|from|to|via|placeholder|caret|accent|decoration|outline|shadow|fill|stroke';
    const FAMILIES = 'slate|gray|zinc|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|blue|indigo|violet|purple|pink|rose|neutral|sky|fuchsia|white|black|transparent|current|inherit';
    const re = new RegExp(`\\b(?:${PROPS})-(${FAMILIES})(?:-\\d{2,3})?(?:\\/\\d{1,3})?\\b`, 'g');
    const seen = new Map();
    for (const m of html.matchAll(re)) {
      const fam = m[1];
      if (REMAPPED.has(fam) || ACHROMATIC.has(fam) || ALLOWLIST.has(fam)) continue;
      const line = html.slice(0, m.index).split('\n').length;
      if (!seen.has(m[0])) seen.set(m[0], line);
    }
    // tm-* utilities are matched separately: they are custom names, not families.
    const offenders = [...seen].map(([cls, line]) => `${cls} @line ${line}`);
    ok('every colour utility belongs to a remapped family, the achromatic set, or the pinned allowlist',
      offenders.length === 0, offenders.slice(0, 8).join(' | '));
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  const { pass, fail, failures } = summary();
  console.log(`\n${fail === 0 ? 'ALL GREEN' : 'FAILURES'} — ${pass} passed, ${fail} failed\n`);
  if (fail > 0) {
    for (const f of failures) console.log(`  ✗ ${f.label}${f.detail ? ' — ' + f.detail : ''}`);
    process.exit(1);
  }
}

try {
  main();
} catch (err) {
  console.error(`theme-parity harness error: ${err.message}`);
  process.exit(2);
}
