/*
 * theme-parity.js
 *
 *   $ node scripts/build-vs-source-audit/theme-parity.js
 *
 * Theme-token lockstep suite. Three permanent invariants:
 *
 *   1. CONFIG PARITY — the colour palette in index.html's inline
 *      tailwind.config (the web app, Play CDN) and tailwind.config.js at the
 *      repo root (the native build's static stylesheet) are deep-equal. The
 *      two blocks are maintained as verbatim copies by hand; if they drift,
 *      web and native render different colours with every other audit still
 *      green — no assertion elsewhere can see it.
 *
 *   2. VAR RESOLUTION — every CSS variable referenced by either config
 *      (the `var(--tm-…)` form) is defined exactly once in index.html as a
 *      space-separated RGB channel triplet ("14 165 233"). An undefined or
 *      malformed variable does not error at runtime — the utility silently
 *      renders as transparent/invalid, which no build step catches.
 *
 *   3. PRINT ISOLATION — PRINT_STYLES and INVOICE_PRINT_STYLES contain no
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

// Brace-match an object literal starting at the `{` at (or after) `from`.
// Values are plain strings / nested objects; no braces occur inside the
// string values, so raw counting is exact. Comments are legal JS and pass
// straight through to the evaluator.
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

// The inline config's colours: locate `tailwind.config = {`, then its
// `colors:` key, then evaluate the object literal. Evaluation (rather than
// regex scraping) means comments and formatting can change freely without
// breaking the audit — only the actual values are compared.
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

// Template-literal extractor for the two print stylesheets. The literals are
// pure CSS with no interior backticks; fail loudly if a marker ever moves so
// the audit can never silently skip the isolation check.
function extractTemplateLiteral(html, constName) {
  const marker = `const ${constName} = \``;
  const at = html.indexOf(marker);
  if (at === -1) throw new Error(`\`${marker}\` not found in index.html`);
  const start = at + marker.length;
  const end = html.indexOf('`', start);
  if (end === -1) throw new Error(`unterminated template literal for ${constName}`);
  return html.slice(start, end);
}

// Collect every var(--tm-…) name referenced anywhere in a config colours
// object (flat values and one level of nested family objects).
function collectThemeVars(colors, out = new Set()) {
  for (const v of Object.values(colors)) {
    if (v && typeof v === 'object') { collectThemeVars(v, out); continue; }
    if (typeof v !== 'string') continue;
    for (const m of v.matchAll(/var\((--tm-[a-z0-9-]+)\)/g)) out.add(m[1]);
  }
  return out;
}

// Stable deep-compare with a path trail for readable failure output.
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

  console.log('\ntheme-parity — config lockstep, var resolution, print isolation\n');

  // ── 1. CONFIG PARITY ──────────────────────────────────────────────────────
  console.log('1. Config parity (inline web config vs tailwind.config.js)');
  const inline = inlineConfigColors(html);
  const native = require(path.join(ROOT, 'tailwind.config.js')).theme.extend.colors;
  const diffs = [];
  deepDiff(inline, native, 'colors', diffs);
  ok('inline tailwind.config colours deep-equal tailwind.config.js colours',
    diffs.length === 0, diffs.slice(0, 5).join(' | '));

  // ── 2. VAR RESOLUTION ─────────────────────────────────────────────────────
  console.log('2. Var resolution (every referenced --tm-* var defined once, as channels)');
  const vars = [...collectThemeVars(inline)].concat([...collectThemeVars(native)])
    .filter((v, i, arr) => arr.indexOf(v) === i)
    .sort();
  if (vars.length === 0) {
    ok('no theme variables referenced by either config (pre-refactor state) — nothing to resolve', true);
  }
  for (const name of vars) {
    // Definition form: `--tm-x: R G B;` — the colon anchors the exact name.
    const defs = [...html.matchAll(new RegExp(`${name}:\\s*([^;\\n]+);`, 'g'))].map(m => m[1].trim());
    const triplet = defs.length === 1 && /^\d{1,3} \d{1,3} \d{1,3}$/.test(defs[0]) &&
      defs[0].split(' ').every(c => Number(c) <= 255);
    ok(`${name} defined exactly once as an RGB channel triplet`,
      triplet,
      defs.length !== 1 ? `${defs.length} definitions found` : `value "${defs[0]}"`);
  }

  // ── 3. PRINT ISOLATION ────────────────────────────────────────────────────
  console.log('3. Print isolation (PRINT_STYLES / INVOICE_PRINT_STYLES never theme)');
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
