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
  ok('--tm-pill-digit-ink / --tm-pill-digit-faint defined once per scope',
    defsIn(rootScope, '--tm-pill-digit-ink').length === 1 && defsIn(poppyScope, '--tm-pill-digit-ink').length === 1 &&
    defsIn(rootScope, '--tm-pill-digit-faint').length === 1 && defsIn(poppyScope, '--tm-pill-digit-faint').length === 1);

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
