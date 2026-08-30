#!/usr/bin/env node
/*
 * RENDER SMOKE — the gate's fourth stage.
 *
 * Mounts the app with the REAL React renderer (react/react-dom 18.3.1, the
 * exact pair the CDN and dist vendor) inside jsdom, walks the real user path
 * onto the shoot page, and asserts the page reached a sane VISUAL state after
 * mount + effects — not merely that nothing threw. This app's worst failures
 * (the Sheet #310 freeze, the carousel park) threw nothing; a boundary-trip
 * smoke test would have stayed green through both.
 *
 * Assertions (gate mode):
 *   R1  #root holds non-trivial content after boot (the blank-screen catch-all)
 *   R2  the error boundary card is NOT showing
 *   R3  FRAME 0 of the shoot page (sampled synchronously after the card click,
 *       before passive effects can run — React 18 commits discrete events
 *       synchronously): the carousel track's basePercent is NEVER positive.
 *       Positive percent IS the parked-off-screen state f842101 fixed.
 *   R4  steady state (after effects): the track basePercent is a sane windowed
 *       position and the CURRENT slot shows the day anchorDayIdFor names —
 *       asserted against the rule's own answer, never a hardcoded day.
 *   R5  COMPOSITION with the boundary breadcrumb (ruled): a second, poisoned
 *       mount whose render genuinely throws must show the boundary card AND
 *       persist bigals_last_render_error through the adapter. The smoke stage
 *       fails at gate time on what the breadcrumb only records on device —
 *       and catches a future change that stops the breadcrumb being written.
 *
 * Proof mode (--proof --html <path>): runs ONLY the boot + click + R3 frame-0
 * check and reports PARKED/NOT-PARKED without judging. The acceptance
 * criterion for this stage was: R3 goes RED against f842101^ and GREEN on
 * HEAD (see the commit message for the recorded run).
 */
const fs = require('fs');
const path = require('path');
const { performance } = require('perf_hooks');

const args = process.argv.slice(2);
const argVal = (flag) => { const i = args.indexOf(flag); return i === -1 ? null : args[i + 1]; };
const PROOF = args.includes('--proof');
const SRC_HTML = argVal('--html') || path.join(__dirname, '..', '..', 'index.html');

let failures = 0;
const results = [];
function check(name, cond, detail) {
  const ok = !!cond;
  if (!ok) failures++;
  results.push({ name, ok, detail: ok ? '' : (detail || '') });
}

// ── fixture ────────────────────────────────────────────────────────────────
// Three FIXED June 2026 weekdays (the weekday-lottery lesson), one crew, APA.
// All past relative to any plausible run date, so the anchor rule has real
// work to do and every day counts as finished.
const CREW = { id: 'me', name: 'Me', role: 'Spark', bdr: 720, otCoef: 1.5, noOT: false, pmpa: false };
const DAYS = [
  { id: 'd1', crewId: 'me', date: '2026-06-10', dayType: 'Shoot', callTime: '08:00', wrapTime: '19:00', lunchStartTime: '13:00', lunchDurationMins: 60 },
  { id: 'd2', crewId: 'me', date: '2026-06-11', dayType: 'Shoot', callTime: '08:00', wrapTime: '19:00', lunchStartTime: '13:00', lunchDurationMins: 60 },
  { id: 'd3', crewId: 'me', date: '2026-06-12', dayType: 'Shoot', callTime: '08:00', wrapTime: '21:00', lunchStartTime: '13:00', lunchDurationMins: 60 },
];
const PRODUCTION = (title) => ({ id: 'pSMOKE', title, prodCo: 'Smoke Films', crew: [CREW], iAmCrewId: 'me', dayDefaults: {}, days: DAYS, invoices: [] });
const USER_PREFS = { displayName: 'Me', onboardingComplete: true, seenTutorialVersion: '99', legalName: 'Me' };

// ── app extraction (the storage suite's approach, shared verbatim) ─────────
function appCodeFrom(htmlPath) {
  const html = fs.readFileSync(htmlPath, 'utf8');
  const startMarker = '<script type="text/babel" data-type="module">';
  const s = html.indexOf(startMarker) + startMarker.length;
  const e = html.indexOf('</script>', s);
  // anchorDayIdFor is exposed for R4 (assert against the rule's own answer).
  // try/catch because proof-mode trees predate the helper.
  return html.slice(s, e) + '\n;try { globalThis.__anchorDayIdFor = anchorDayIdFor; } catch (_) {}\n';
}

async function transform(code) {
  const esbuild = require('esbuild');
  const out = await esbuild.transform(code, {
    loader: 'jsx', jsx: 'transform', jsxFactory: 'React.createElement', jsxFragment: 'React.Fragment',
  });
  return out.code;
}

// ── one mounted app instance ───────────────────────────────────────────────
async function mountApp(code, { poison = false } = {}) {
  const { JSDOM, VirtualConsole } = require('jsdom');
  // The poisoned mount throws ON PURPOSE - keep jsdom's uncaught-error spew
  // out of the gate output unless debugging.
  const vc = new VirtualConsole();
  if (process.env.SMOKE_DEBUG) vc.sendTo(console);
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'https://localhost/', pretendToBeVisual: true, virtualConsole: vc,
  });
  const { window } = dom;
  // jsdom gaps the app touches: ResizeObserver is constructed unguarded
  // (carousel width tracking); a no-op class keeps trackW at 0, which the
  // percent-based assertions never read. matchMedia for the theme queries.
  window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  if (!window.matchMedia) {
    window.matchMedia = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  }
  window.scrollTo = () => {};
  if (window.HTMLElement && !window.HTMLElement.prototype.scrollIntoView) {
    window.HTMLElement.prototype.scrollIntoView = () => {};
  }

  const title = poison
    // An object as a React child throws in render — a genuine render crash
    // reaching the real RootErrorBoundary, not a simulated one.
    ? { thisObjectIsNotARenderableChild: true }
    : 'Smoke Job';
  window.localStorage.setItem('bigals_schema_version', '4');
  window.localStorage.setItem('bigals_productions', JSON.stringify([PRODUCTION(title)]));
  window.localStorage.setItem('bigals_user_prefs', JSON.stringify(USER_PREFS));

  // react-dom (required in the HOST realm) reads bare globals itself —
  // window.event for event priority, document for a few paths — which the
  // Function-parameter shadowing below cannot reach. This stage owns its
  // process, so pointing the host globals at the active jsdom window is safe;
  // each mount re-points them.
  globalThis.window = window;
  try { globalThis.document = window.document; } catch (_) {}
  try { globalThis.navigator = window.navigator; } catch (_) {}

  const React = require('react');
  const ReactDOMClient = require('react-dom/client');
  const ReactDOM = {
    createRoot: (el) => ReactDOMClient.createRoot(el),
    version: ReactDOMClient.version || '18',
  };

  // Host-realm execution with the browser globals as parameters — the app
  // script reads them bare (no globalThis use in the app, verified). Console
  // noise from the app is muted; real errors still fail assertions.
  const quiet = process.env.SMOKE_DEBUG ? console : { log() {}, warn() {}, error() {}, info() {}, debug() {} };
  const fn = new Function(
    'window', 'self', 'document', 'localStorage', 'navigator', 'location', 'history',
    'matchMedia', 'requestAnimationFrame', 'cancelAnimationFrame', 'ResizeObserver',
    'alert', 'confirm', 'prompt', 'React', 'ReactDOM', 'console', 'getComputedStyle',
    code
  );
  fn(
    window, window, window.document, window.localStorage, window.navigator, window.location, window.history,
    window.matchMedia.bind(window), window.requestAnimationFrame.bind(window), window.cancelAnimationFrame.bind(window),
    window.ResizeObserver, () => {}, () => true, () => '', React, ReactDOM, quiet,
    window.getComputedStyle.bind(window)
  );

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const settle = async (ticks = 12) => { for (let i = 0; i < ticks; i++) await sleep(10); };
  const root = window.document.getElementById('root');
  // Boot is async (storage preload → migrations → startRender).
  for (let i = 0; i < 200 && root.childElementCount === 0; i++) await sleep(10);
  await settle();
  return { window, root, settle };
}

// ── carousel helpers ───────────────────────────────────────────────────────
function findTrack(window) {
  return [...window.document.querySelectorAll('*')].find((el) => (el.style && el.style.transform || '').includes('translate3d(calc('));
}
function basePercentOf(track) {
  const m = /translate3d\(calc\((-?[\d.]+)% \+ (-?[\d.]+)px\)/.exec(track.style.transform || '');
  return m ? parseFloat(m[1]) : null;
}

async function main() {
  const t0 = performance.now();
  const code = await transform(appCodeFrom(SRC_HTML));

  // ── healthy mount → home → click onto the shoot page ──
  const { window, root, settle } = await mountApp(code);
  const bodyText = () => root.textContent || '';

  if (!PROOF) {
    check('R1 boot: #root renders non-trivial content (the blank-screen catch-all)',
      root.childElementCount > 0 && bodyText().length > 40, `children=${root.childElementCount} textLen=${bodyText().length}`);
    check('R2 boot: the error boundary card is not showing',
      !bodyText().includes('Something went wrong on this screen'), 'boundary tripped during a healthy boot');
  }

  const card = [...window.document.querySelectorAll('*')].find((el) =>
    el.textContent === 'Smoke Job' || (el.textContent || '').trim() === 'Smoke Job');
  if (!card) {
    check('R0 the home screen shows the fixture production card', false, `no element renders "Smoke Job"; page text: ${bodyText().slice(0, 200)}`);
  } else {
    let clickable = card;
    while (clickable && clickable !== root && typeof clickable.click !== 'function') clickable = clickable.parentElement;
    // EVERY committed frame, not a polled sample. The parked frame on the
    // pre-fix tree is TRANSIENT when effects run (mount commit -> re-anchor
    // effect -> corrected commit, all inside React's scheduler tasks), so a
    // setTimeout poll races the scheduler and can only see the settled value.
    // A MutationObserver fires as a MICROTASK after each mutation batch:
    // childList catches the track's insertion frame (its initial inline
    // style), attributeFilter:['style'] catches every later transform write.
    // The asserted property: NO committed frame ever holds a positive
    // basePercent - positive percent IS the parked-off-screen state f842101
    // fixed, and on-device the "transient" was the whole failure whenever the
    // correcting effects never ran.
    const seenTransforms = [];
    const recordEl = (el) => {
      const t = (el && el.style && el.style.transform) || '';
      if (t.includes('translate3d(calc(')) seenTransforms.push(t);
    };
    const mo = new window.MutationObserver((muts) => {
      for (const m of muts) {
        if (m.type === 'childList') {
          for (const n of m.addedNodes) {
            if (n.nodeType !== 1) continue;
            recordEl(n);
            if (n.querySelectorAll) [...n.querySelectorAll('*')].forEach(recordEl);
          }
        } else if (m.type === 'attributes') {
          recordEl(m.target);
        }
      }
    });
    mo.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['style'] });
    clickable.click();
    let ticks0 = 0;
    while (seenTransforms.length === 0 && ticks0 < 100) { await new Promise((r) => setTimeout(r, 0)); ticks0++; }
    await new Promise((r) => setTimeout(r, 0));
    mo.disconnect();
    const percents = seenTransforms.map((t) => { const m = /translate3d\(calc\((-?[\d.]+|NaN)% \+/.exec(t); return m ? parseFloat(m[1]) : NaN; });
    const everBad = percents.some((v) => !(v <= 0));   // positive OR NaN = parked/insane
    const seenBrief = [...new Set(percents.map((v) => `${v}%`))].join(' -> ');

    if (PROOF) {
      const parked = percents.length === 0 || everBad;
      console.log(`PROOF committed track frames (${percents.length} writes): ${seenBrief || 'NONE'} verdict=${parked ? 'PARKED FRAME COMMITTED (red)' : 'never off-screen (green)'}`);
      const t1 = performance.now();
      console.log(`proof run: ${((t1 - t0) / 1000).toFixed(2)}s`);
      process.exit(parked ? 2 : 0);
    }

    check('R3 NO committed frame of the carousel track ever holds a positive (or NaN) basePercent - a positive percent is the parked-off-screen state f842101 fixed; observed via MutationObserver so a transient parked commit cannot hide between polls',
      percents.length > 0 && !everBad, `frames=${percents.length} sequence=${seenBrief || 'NONE'}`);

    await settle();
    const track = findTrack(window);
    const p = track ? basePercentOf(track) : null;
    const slots = track ? track.children.length : 0;
    const anchorFn = globalThis.__anchorDayIdFor;
    const sorted = [...DAYS].sort((a, b) => a.date.localeCompare(b.date));
    const anchorId = typeof anchorFn === 'function' ? anchorFn(sorted) : null;
    const anchorDay = sorted.find((d) => d.id === anchorId) || null;
    const slotIdx = (p != null && slots > 0) ? Math.round((-p * slots) / 100) : -1;
    const slotEl = (track && slotIdx >= 0 && slotIdx < slots) ? track.children[slotIdx] : null;
    // The page's own vocabulary for the current day is "DAY N / M" - derive
    // N from the anchor rule's answer, never hardcode it.
    const anchorPos = anchorDay ? sorted.findIndex((d) => d.id === anchorDay.id) + 1 : -1;
    const slotText = slotEl ? (slotEl.textContent || '').replace(/\s+/g, ' ') : '';
    const dayLabel = new RegExp(`DAY\\s*${anchorPos}\\s*/\\s*${sorted.length}`);
    check('R4 steady state: basePercent is a sane windowed position (<=0, >-100), the slot index resolves inside the window, and the CURRENT slot is the day anchorDayIdFor names (its DAY N / M position derived from the rule\'s own answer, never hardcoded)',
      p != null && p <= 0 && p > -100 && slotEl != null && anchorDay != null && anchorPos > 0 &&
      dayLabel.test(slotText),
      `basePercent=${p} slots=${slots} slotIdx=${slotIdx} anchor=${anchorDay && anchorDay.date} pos=${anchorPos}/${sorted.length} slotText=${slotText.slice(0, 80) || 'NO SLOT'}`);
  }

  // ── R5: the poisoned mount — render throws, boundary catches, breadcrumb persists ──
  {
    // react-dom's dev build logs every caught error via the HOST console -
    // the throw below is deliberate, so mute host console.error for this
    // mount (kept under SMOKE_DEBUG like the rest).
    const hostErr = console.error;
    if (!process.env.SMOKE_DEBUG) console.error = () => {};
    const { window: w2, root: r2 } = await mountApp(code, { poison: true });
    console.error = hostErr;
    const text2 = r2.textContent || '';
    let crumb = null;
    try { crumb = JSON.parse(w2.localStorage.getItem('bigals_last_render_error') || 'null'); } catch (_) {}
    check('R5 composition: a render that genuinely throws shows the boundary card AND persists the bigals_last_render_error breadcrumb through the adapter (message + appVersion + date) - the smoke stage fails at gate time on what the breadcrumb records on device',
      text2.includes('Something went wrong on this screen') &&
      crumb != null && typeof crumb.message === 'string' && crumb.message.length > 0 &&
      typeof crumb.appVersion === 'string' && crumb.appVersion.length > 0 &&
      typeof crumb.date === 'string' && crumb.date.length > 0,
      `boundaryShown=${text2.includes('Something went wrong on this screen')} crumb=${JSON.stringify(crumb).slice(0, 160)}`);
  }

  const t1 = performance.now();
  for (const r of results) {
    console.log(` ${r.ok ? '✓' : '✗'} ${r.name}${r.ok ? '' : `   << ${r.detail}`}`);
  }
  console.log('='.repeat(60));
  if (failures) {
    console.log(` ❌ FAIL — ${failures} of ${results.length} render-smoke assertions failed.`);
  } else {
    console.log(` ✅ PASS — all ${results.length} render-smoke assertions passed. (${((t1 - t0) / 1000).toFixed(2)}s)`);
  }
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error('RENDER SMOKE ERROR:', (e && e.stack) || e); process.exit(1); });
