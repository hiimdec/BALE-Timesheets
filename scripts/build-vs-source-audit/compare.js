/*
 * compare.js — the audit driver.
 *
 *   $ node scripts/build-vs-source-audit/compare.js
 *
 * Runs every scenario through both the SOURCE and BUILT pay engines and
 * deep-compares the resulting calc objects. Exits non-zero on any divergence.
 *
 * Notes:
 *   • Comparison is strict-equal across the whole calc tree (total, lines,
 *     meta). Numeric fields are compared exactly (no tolerance) because the
 *     build is documented as a purely mechanical JSX → JS transform — any
 *     non-zero divergence is a real finding.
 *   • Output is structured for both humans (the summary at the end) and
 *     machine-readers (a JSON report written to /tmp).
 */

const fs = require('fs');
const path = require('path');
const { loadSourceEngine, loadBuiltEngine } = require('./load-engines');
const { scenarios } = require('./scenarios');

// ---- Deep equality with structured diff ----------------------------------

function describe(value) {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (Array.isArray(value)) return `Array(${value.length})`;
  return typeof value;
}

function diffWalk(a, b, pathStr, diffs) {
  if (a === b) return;
  if (typeof a !== typeof b || a === null || b === null) {
    diffs.push({ path: pathStr || '<root>', src: a, built: b, kind: `type/value mismatch (${describe(a)} vs ${describe(b)})` });
    return;
  }
  if (typeof a === 'number') {
    // Catch NaN-vs-NaN and the like.
    if (Number.isNaN(a) && Number.isNaN(b)) return;
    diffs.push({ path: pathStr, src: a, built: b, kind: 'number differs' });
    return;
  }
  if (typeof a !== 'object') {
    diffs.push({ path: pathStr, src: a, built: b, kind: 'primitive differs' });
    return;
  }
  if (Array.isArray(a) !== Array.isArray(b)) {
    diffs.push({ path: pathStr, src: a, built: b, kind: 'array vs object' });
    return;
  }
  if (Array.isArray(a)) {
    if (a.length !== b.length) {
      diffs.push({ path: pathStr + '.length', src: a.length, built: b.length, kind: 'array length differs' });
    }
    const n = Math.max(a.length, b.length);
    for (let i = 0; i < n; i++) diffWalk(a[i], b[i], `${pathStr}[${i}]`, diffs);
    return;
  }
  // Plain object.
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) diffWalk(a[k], b[k], pathStr ? `${pathStr}.${k}` : k, diffs);
}

function diffCalcs(src, built) {
  const diffs = [];
  diffWalk(src, built, '', diffs);
  return diffs;
}

// ---- Driver --------------------------------------------------------------

async function main() {
  process.stdout.write('Loading engines… ');
  const source = await loadSourceEngine();
  const built = loadBuiltEngine();
  process.stdout.write('OK\n');

  const results = [];
  for (const s of scenarios) {
    const out = { id: s.id, label: s.label };
    let srcCalc, builtCalc, srcErr, builtErr;
    try { srcCalc = source.calcForDisplay(s.production, s.day, s.crewMember, s.prevDay); }
    catch (e) { srcErr = e.stack || String(e); }
    try { builtCalc = built.calcForDisplay(s.production, s.day, s.crewMember, s.prevDay); }
    catch (e) { builtErr = e.stack || String(e); }

    if (srcErr && builtErr) {
      // Both threw — same kind of error?
      if (srcErr === builtErr) {
        out.status = 'both-threw-same';
        out.error = srcErr.split('\n')[0];
      } else {
        out.status = 'both-threw-differently';
        out.srcError = srcErr.split('\n')[0];
        out.builtError = builtErr.split('\n')[0];
      }
    } else if (srcErr || builtErr) {
      out.status = 'one-threw';
      out.srcError = srcErr ? srcErr.split('\n')[0] : null;
      out.builtError = builtErr ? builtErr.split('\n')[0] : null;
    } else {
      const diffs = diffCalcs(srcCalc, builtCalc);
      if (diffs.length === 0) {
        out.status = 'match';
        out.total = srcCalc.total;
        out.lineCount = srcCalc.lines?.length ?? 0;
      } else {
        out.status = 'mismatch';
        out.diffs = diffs;
        out.srcTotal = srcCalc.total;
        out.builtTotal = builtCalc.total;
      }
    }
    results.push(out);
  }

  // ---- Summarize --------------------------------------------------------
  const match = results.filter((r) => r.status === 'match');
  const mismatch = results.filter((r) => r.status === 'mismatch');
  const bothThrewSame = results.filter((r) => r.status === 'both-threw-same');
  const bothThrewDiff = results.filter((r) => r.status === 'both-threw-differently');
  const oneThrew = results.filter((r) => r.status === 'one-threw');

  console.log('');
  console.log('============================================================');
  console.log(' TimeMachine pay engine: SOURCE vs BUILT audit');
  console.log('============================================================');
  console.log(` Total scenarios:           ${results.length}`);
  console.log(` ✓ Match (penny-equal):     ${match.length}`);
  console.log(` ✗ Mismatch:                ${mismatch.length}`);
  console.log(` ⚠ Both threw, same error:  ${bothThrewSame.length}`);
  console.log(` ✗ Both threw, differently: ${bothThrewDiff.length}`);
  console.log(` ✗ One threw, other didn't: ${oneThrew.length}`);
  console.log('');

  if (mismatch.length) {
    console.log('--- MISMATCHES (build changed pay output) ---');
    for (const r of mismatch) {
      console.log(`\n[${r.id}] ${r.label}`);
      console.log(`   src.total=${r.srcTotal}  built.total=${r.builtTotal}`);
      for (const d of r.diffs.slice(0, 10)) {
        console.log(`   • ${d.path || '<root>'}: ${d.kind}`);
        console.log(`        src   = ${JSON.stringify(d.src)}`);
        console.log(`        built = ${JSON.stringify(d.built)}`);
      }
      if (r.diffs.length > 10) console.log(`   … (${r.diffs.length - 10} more)`);
    }
    console.log('');
  }

  if (oneThrew.length) {
    console.log('--- ONE ENGINE THREW (asymmetric error) ---');
    for (const r of oneThrew) {
      console.log(`\n[${r.id}] ${r.label}`);
      console.log(`   srcError   = ${r.srcError}`);
      console.log(`   builtError = ${r.builtError}`);
    }
    console.log('');
  }

  if (bothThrewDiff.length) {
    console.log('--- BOTH THREW BUT DIFFERENT MESSAGES ---');
    for (const r of bothThrewDiff) {
      console.log(`\n[${r.id}] ${r.label}`);
      console.log(`   src   = ${r.srcError}`);
      console.log(`   built = ${r.builtError}`);
    }
    console.log('');
  }

  if (bothThrewSame.length) {
    console.log('--- BOTH THREW (same error — engines agree on rejection) ---');
    for (const r of bothThrewSame) console.log(`   [${r.id}] ${r.label}\n        ${r.error}`);
    console.log('');
  }

  // Plain-English pass/fail
  const buildIntegrityPass =
    mismatch.length === 0 && bothThrewDiff.length === 0 && oneThrew.length === 0;
  console.log('============================================================');
  if (buildIntegrityPass) {
    console.log(' ✅ PASS — built engine is calc-identical to the source engine.');
    console.log(`    All ${results.length} scenarios produced byte-equal calc objects.`);
    if (bothThrewSame.length) {
      console.log(`    (${bothThrewSame.length} scenarios threw on both engines with`);
      console.log('     the same error message — engines still agree.)');
    }
  } else {
    console.log(' ❌ FAIL — built engine diverged from source.');
    console.log(`    Mismatches:                ${mismatch.length}`);
    console.log(`    Asymmetric errors:         ${oneThrew.length}`);
    console.log(`    Both threw, differently:   ${bothThrewDiff.length}`);
  }
  console.log('============================================================');

  // Write JSON report for the record.
  const reportPath = path.join(__dirname, 'last-run-report.json');
  fs.writeFileSync(reportPath, JSON.stringify({
    when: new Date().toISOString(),
    pass: buildIntegrityPass,
    counts: {
      total: results.length,
      match: match.length,
      mismatch: mismatch.length,
      bothThrewSame: bothThrewSame.length,
      bothThrewDiff: bothThrewDiff.length,
      oneThrew: oneThrew.length,
    },
    results,
  }, null, 2));
  console.log(`Report: ${path.relative(process.cwd(), reportPath)}`);

  process.exit(buildIntegrityPass ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(2); });
