/*
 * web-regression.js — prove the native iOS fixes don't touch the web build.
 *
 *   $ node scripts/native-audit/web-regression.js
 *
 * Loads the SHIPPING web bundle (dist/assets/app.js) in a Node vm sandbox under
 * WEB conditions (window.Capacitor undefined) and asserts:
 *   1. IS_NATIVE resolves to false.
 *   2. No vendored PDF library script (html2canvas / jspdf) is ever injected —
 *      i.e. the web build never downloads or executes them.
 *   3. window.html2canvas / window.jspdf remain undefined after boot.
 *   4. No Capacitor bridge is touched (window.Capacitor stays undefined).
 *
 * This is the automated half of the web-regression check. The manual half
 * (window.print / mailto / <a download> still behave as before in a real
 * browser) is a quick human smoke test.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');
const BUILT = path.join(ROOT, 'dist', 'assets', 'app.js');

let failures = 0;
const results = [];
function check(name, cond, detail) {
  if (!cond) failures++;
  results.push({ name, ok: !!cond, detail: cond ? '' : (detail || '') });
}

// Track any <script> injected into <head>.
const injectedScripts = [];

// ── OUTBOUND NETWORK (clause 7) ─────────────────────────────────────────────
// Every host the bundle contacts DURING BOOT, recorded by API. The sandbox
// previously defined no fetch, XMLHttpRequest or sendBeacon at all, so an
// analytics call would have hit a ReferenceError inside one of this codebase's
// many `catch (_) {}` blocks and the gate would have stayed green - a leak
// indistinguishable from a pass, which is the false-green shape this project
// keeps meeting. Six APIs because five is a loophole: new Image().src is the
// classic beacon that evades fetch/XHR/sendBeacon entirely.
//
// EXTERNAL HOSTNAMES ONLY, deliberately. The print path legitimately fetches
// './assets/tailwind.css', which resolves to the sandbox's own origin; failing
// on that would be a false red that teaches people to loosen the clause. The
// question this asks is "did anything reach ANOTHER party", not "did any I/O
// happen".
const outbound = [];   // { host, via }
const SANDBOX_ORIGIN = 'https://timemachineapp.co.uk';
function recordUrl(u, via) {
  let host;
  try { host = new URL(String(u), SANDBOX_ORIGIN).hostname; } catch (_) { return; }
  if (!host || host === 'timemachineapp.co.uk') return;   // same-origin / relative
  outbound.push({ host, via });
}

function makeSandbox() {
  const noop = () => {};
  const el = (tag) => {
    const node = {
      tagName: tag, style: {}, _src: '',
      setAttribute: noop, appendChild: noop, removeChild: noop,
      addEventListener: noop, removeEventListener: noop, focus: noop, click: noop,
      classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
    };
    Object.defineProperty(node, 'src', { get() { return node._src; }, set(v) { node._src = v; } });
    return node;
  };
  const head = {
    appendChild: (n) => { if (n && n.tagName === 'script' && n._src) injectedScripts.push(n._src); },
    removeChild: noop,
  };
  const React = {
    createElement: () => null, Fragment: 'F', createContext: () => ({ Provider: noop, Consumer: noop }),
    useState: (i) => [typeof i === 'function' ? i() : i, noop], useEffect: noop, useLayoutEffect: noop,
    useMemo: (f) => f(), useCallback: (f) => f, useRef: (i) => ({ current: i ?? null }),
    useReducer: (r, i, init) => [init ? init(i) : i, noop], useContext: () => null, memo: (f) => f,
    forwardRef: (f) => f, useImperativeHandle: noop, useId: () => 'id',
  };
  const lsStore = new Map();
  const sandbox = {
    console, setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask,
    Date, Math, JSON, RegExp, Number, String, Array, Object, Map, Set, WeakMap, Symbol,
    Promise, Error, TypeError, RangeError, parseInt, parseFloat, isNaN, isFinite,
    NaN, Infinity, undefined, Boolean, Proxy, Reflect, encodeURIComponent, decodeURIComponent, URLSearchParams,
    React,
    ReactDOM: { createRoot: () => ({ render: noop, unmount: noop }), version: 'stub' },
    localStorage: {
      getItem: (k) => (lsStore.has(k) ? lsStore.get(k) : null),
      setItem: (k, v) => lsStore.set(k, String(v)), removeItem: (k) => lsStore.delete(k),
    },
    fetch: (input, _init) => { recordUrl(typeof input === 'string' ? input : (input && input.url), 'fetch'); return Promise.reject(new Error('web-regression: network blocked')); },
    XMLHttpRequest: class { open(_m, u) { recordUrl(u, 'XMLHttpRequest'); } send() {} setRequestHeader() {} addEventListener() {} },
    WebSocket: class { constructor(u) { recordUrl(u, 'WebSocket'); } send() {} close() {} addEventListener() {} },
    EventSource: class { constructor(u) { recordUrl(u, 'EventSource'); } close() {} addEventListener() {} },
    Image: class { set src(u) { recordUrl(u, 'Image'); this._src = u; } get src() { return this._src; } },
    navigator: {
      userAgent: 'web-regression', language: 'en-GB', onLine: true,
      sendBeacon: (u) => { recordUrl(u, 'sendBeacon'); return true; },
    },
    location: { href: 'https://hiimdec.github.io/x/', reload: noop, protocol: 'https:' },
    document: {
      getElementById: () => el('div'), querySelector: () => null, querySelectorAll: () => [],
      createElement: (t) => el(t), addEventListener: noop, removeEventListener: noop,
      head, body: el('body'), documentElement: el('html'), hidden: false, readyState: 'complete',
    },
    matchMedia: () => ({ matches: false, addEventListener: noop, removeEventListener: noop, addListener: noop, removeListener: noop }),
    requestAnimationFrame: (cb) => setTimeout(cb, 0), cancelAnimationFrame: clearTimeout,
    alert: noop, prompt: () => '', confirm: () => true,
  };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  // NB: window.Capacitor intentionally left undefined → web conditions.
  return sandbox;
}

async function main() {
  let code = fs.readFileSync(BUILT, 'utf8');
  // Expose IS_NATIVE + the HealthSteps bridge for assertion (built bundle is
  // an IIFE; splice before close).
  const close = '})();';
  const at = code.lastIndexOf(close);
  code = code.slice(0, at)
    + '\n;globalThis.__IS_NATIVE = (typeof IS_NATIVE !== "undefined") ? IS_NATIVE : "undefined-symbol";'
    + '\nglobalThis.__HealthSteps = (typeof HealthSteps !== "undefined") ? HealthSteps : null;'
    + '\nglobalThis.__ICloudBackup = (typeof ICloudBackup !== "undefined") ? ICloudBackup : null;'
    + '\nglobalThis.__trackEvent = (typeof trackEvent !== "undefined") ? trackEvent : null;'
    + '\nglobalThis.__analyticsSetChoice = (typeof analyticsSetChoice !== "undefined") ? analyticsSetChoice : null;\n'
    + code.slice(at);

  const sandbox = makeSandbox();
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: 'dist-app-web.js', displayErrors: true });

  check('1. IS_NATIVE is false on web', sandbox.__IS_NATIVE === false, `__IS_NATIVE=${sandbox.__IS_NATIVE}`);
  check('2. no PDF library script injected', injectedScripts.length === 0, `injected=${JSON.stringify(injectedScripts)}`);
  check('3a. window.html2canvas undefined', typeof sandbox.html2canvas === 'undefined');
  check('3b. window.jspdf undefined', typeof sandbox.jspdf === 'undefined');
  check('4. window.Capacitor never defined', typeof sandbox.Capacitor === 'undefined');

  // 7. NOTHING REACHES A THIRD PARTY DURING BOOT. Asserts the HOSTNAME LIST,
  //    not a count: "1 outbound call" sends the next reader hunting, while
  //    "us.aptabase.com via fetch" names the culprit and the API it used.
  //    LIMITS, stated so nobody assumes more (also in MAINTENANCE.md): this
  //    sees BOOT ONLY - a call fired later by a user action is outside its
  //    reach - and it cannot see static HTML, which is audit:publish's job.
  const outboundList = [...new Set(outbound.map((o) => `${o.host} via ${o.via}`))].sort();
  check('7. no outbound request to any external host during boot (fetch / XMLHttpRequest / sendBeacon / WebSocket / EventSource / Image)',
    outboundList.length === 0, `outbound hosts: ${JSON.stringify(outboundList)}`);

  // 8. THE THIRD GUARD — analytics is USER-TRIGGERED, so clause 7 is blind to
  //    it by construction: boot never fires it. This calls the real wrapper
  //    directly under WEB conditions, with consent forced ON and the app key
  //    injected, i.e. every gate open EXCEPT IS_NATIVE. Nothing may leave.
  //    audit:publish covers the static-HTML shape; clause 7 covers boot; this
  //    covers the one shape neither can see.
  const track = sandbox.__trackEvent;
  const setChoice = sandbox.__analyticsSetChoice;
  let webTrackSent = null;
  if (typeof track === 'function' && typeof setChoice === 'function') {
    if (typeof setChoice === 'function') setChoice('on');
    const spy = [];
    webTrackSent = await track('shoot_5', undefined, {
      appKey: 'A-EU-0000000000',
      transport: async (url) => { spy.push(url); },
    });
    if (spy.length) outbound.push({ host: 'via-injected-transport', via: 'trackEvent' });
  }
  const after8 = [...new Set(outbound.map((o) => `${o.host} via ${o.via}`))].sort();
  check('8. analytics cannot fire on web even when every other gate is open (consent forced ON, app key injected): the IS_NATIVE guard alone stops it, and no outbound host appears',
    typeof track === 'function' && webTrackSent === false && after8.length === 0,
    `trackEvent returned ${webTrackSent}; outbound: ${JSON.stringify(after8)}`);

  // 8b. STRUCTURAL: the gate must be the FIRST statement of the wrapper, and
  //     the analytics host must appear exactly once in the whole bundle.
  const bundleSrc = fs.readFileSync(BUILT, 'utf8');
  // Count the ENDPOINT PATH, not the host string. The MA6 mutation added a
  // second call site written as `ANALYTICS_HOST + '/api/v0/event'`, which left
  // the literal host appearing exactly once and sailed past the earlier form of
  // this clause. Every call site must name the path, whatever it does with the
  // host, so the path is what bounds them.
  const hostHits = (bundleSrc.match(/eu\.aptabase\.com/g) || []).length;
  const endpointHits = (bundleSrc.match(/\/api\/v0\/event/g) || []).length;
  check('8b. the web bundle names the analytics ENDPOINT exactly once (inside the gated wrapper) and the host exactly once, and the wrapper opens with the IS_NATIVE guard - the path is counted because a second call site can reach the host through the constant',
    endpointHits === 1 && hostHits === 1 && /trackEvent\(name, props, opts\)\s*\{\s*if\s*\(!IS_NATIVE\)\s*return false;/.test(bundleSrc),
    `endpoint occurrences: ${endpointHits}, host occurrences: ${hostHits}`);

  // 5. HealthKit unreachable on web: the bridge exists but EVERY method
  //    resolves its web-safe default (false/'unknown'/false/0) without ever
  //    touching a plugin layer — Capacitor stays undefined even after the
  //    calls actually run under web conditions.
  const HS = sandbox.__HealthSteps;
  let hsDefaults = false;
  if (HS) {
    const a = await HS.isAvailable();
    const s = await HS.getRequestStatus();
    const r = await HS.requestRead();
    const q = await HS.querySteps(0, 1000);
    hsDefaults = a === false && s === 'unknown' && r === false && q === 0;
  }
  check('5a. HealthSteps bridge exposed with web-safe defaults (isAvailable=false, status=unknown, requestRead=false, querySteps=0)', !!HS && hsDefaults);
  check('5b. calling the health bridge touches no plugin layer (window.Capacitor still undefined after the calls)', !!HS && typeof sandbox.Capacitor === 'undefined');

  // 6. iCloud backup unreachable on web: every bridge method resolves its
  //    web-safe default (unavailable / false / [] / null) without touching a
  //    plugin layer — the backup machinery is entirely absent from web.
  const IB = sandbox.__ICloudBackup;
  let ibDefaults = false;
  if (IB) {
    const st = await IB.status();
    const w = await IB.write('snapshot-2026-01-01.json', '{}');
    const l = await IB.list();
    const r = await IB.read('snapshot-2026-01-01.json');
    const d = await IB.remove('snapshot-2026-01-01.json');
    ibDefaults = st && st.available === false && w === false && Array.isArray(l) && l.length === 0 && r === null && d === false;
  }
  check('6a. ICloudBackup bridge exposed with web-safe defaults (unavailable, write=false, list=[], read=null, remove=false)', !!IB && ibDefaults);
  check('6b. calling the iCloud bridge touches no plugin layer (window.Capacitor still undefined after the calls)', !!IB && typeof sandbox.Capacitor === 'undefined');

  console.log('');
  console.log('============================================================');
  console.log(' Web regression — native fixes do not affect the web build');
  console.log('============================================================');
  for (const r of results) console.log(`  ${r.ok ? '✓' : '✗'} ${r.name}${r.ok ? '' : '   << ' + r.detail}`);
  console.log('============================================================');
  console.log(failures === 0
    ? ` ✅ PASS — web build loads clean: no Capacitor, no PDF libs, no HealthKit, IS_NATIVE=false.`
    : ` ❌ FAIL — ${failures} assertion(s) failed.`);
  console.log('============================================================');
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
