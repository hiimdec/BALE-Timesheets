/*
 * load-engines.js
 *
 * Loads the TimeMachine pay engine TWICE:
 *   1. SOURCE — from index.html's <script type="text/babel"> body. JSX-transformed
 *      via esbuild (same transform build.js uses), but WITHOUT the IIFE wrap, so
 *      that an appended `globalThis.__engine = {...}` line at script scope can
 *      see the function/const declarations.
 *   2. BUILT — from dist/assets/app.js as-is. Already IIFE-wrapped; we splice
 *      `globalThis.__engine = {...}` in just before the closing `})();` so the
 *      engine names are visible inside the IIFE scope.
 *
 * Both run in their own Node `vm` sandbox with React/ReactDOM/document/localStorage
 * stubbed. Engine functions are PURE JS (no JSX, no DOM, no React) — the stubs
 * exist only so the surrounding component code can be DEFINED without throwing
 * at script load time. None of the React component bodies execute unless someone
 * renders them.
 *
 * Exports: { loadSourceEngine, loadBuiltEngine, ENGINE_NAMES }
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const esbuild = require('esbuild');

const ROOT = path.resolve(__dirname, '..', '..');
const SRC_HTML = path.join(ROOT, 'index.html');
const BUILT_JS = path.join(ROOT, 'dist', 'assets', 'app.js');

// The functions we want both engines to expose for comparison testing.
const ENGINE_NAMES = [
  'calcForDisplay',
  'calculateDay',
  'calculatePmpaDay',
  'resolveDay',
  'resolveCrewForDay',
  'calcTOC',
  'augmentCalc',
  'computeAPArate',
  'dayOfWeek',
  // Stage 2 (Kit Inventory): spot-checks read the categoriser to confirm
  // itemised kit lines bucket via the bucket:'kit' marker, not the regex.
  'categorizeBreakdownLine',
  // Stage 2b auto-apply helper. Pure function: given a day + userPrefs,
  // returns the day with kitItems snapshotted from default-on inventory
  // items IFF the day's dayType is kit-bearing AND kitItems is empty.
  'applyKitAutoApply',
  // Stage 2c: auto-remove + cascade-resolved effective type.
  'applyKitAutoRemove',
  'resolveEffectiveDayType',
  // Stage 2d: user-crew-id resolver for kit scoping (combines
  // resolveUserCrewId with a solo single-crew fallback).
  'getEffectiveUserCrewId',
  // Stage 3: shoot-level kit aggregation (days-on, usual total,
  // negotiated total + computed % discount).
  'aggregateKitForShoot',
  // Stage 4: end-to-end invoice line generation. Spot-checks build a
  // production, call buildInvoiceLineItems, and assert deal application,
  // detail formatting, double-counting safety, and rate-variation handling.
  'buildInvoiceLineItems',
  // Stage 6: per-production kit discount = Σ max(0, usual − negotiatedTotal)
  // over the user's dealt items. Same helper / same user-crew-id resolution
  // as the invoice path → stats-vs-invoice reconcile by construction.
  'computeProductionKitDiscount',
  // Shoot-share wire codec (v1, frozen): the share-link-assertions suite
  // pins the canonical fixture, the round-trip, and the refusal paths.
  'encodeShareLink',
  'decodeShareLink',
  // BB individual-share extraction (feeds the frozen encoder above): the
  // suite's B-pins prove a BB-extracted link is byte-identical to a solo
  // link of the same days and that the legacy truckCallTime pre-call
  // travels.
  'extractCrewShareDays',
  // Night-shoot display split (presentation-only restructure of the plain
  // night line): exposed so the re-sum property is provable against the
  // engine's own output.
  'splitNightLinesForDisplay',
  // Live Activity drain→sweep ordering (the re-mint race fix): pure,
  // dependency-injected control flow — la-ordering-assertions.js executes
  // its four race cases with stubbed drain/sweep in this sandbox.
  'laDrainThenSweep',
  // BB per-day variance detector (fuchsia highlight / VARIANCES accordion):
  // variance-detection-assertions.js executes the cascade-feed fixtures so
  // the crew-list highlight can never silently starve again.
  'getCrewVariances',
  // Quick set (BB): the batched one-field multi-crew write —
  // quick-set-assertions.js proves it is the single-edit write over N
  // (sparse, collapse rule mirrored, purity, totals re-derive).
  'applyQuickSet',
  // Day-off model (ruled 2026-07-30): the un-tick/remove write + the
  // day-off-assertions suite (true-zero calc, blank-times resolution,
  // un-tick produces Day off not the paid Rest Day, wire omission).
  'applyRemoveFromDay',
  // Who's-on-today (the BB day ticker): the batched presence write in both
  // directions — day-presence-assertions.js proves tick/un-tick round-trips,
  // never double-appends, and leaves the turnaround feed correct.
  'applyDayPresence',
  // Rate-card resolution primitives: construction-assertions.js runs the
  // card-refresh rule against the REAL cards, not fixture copies.
  'resolveRateCard',
  'flattenRateCard',
  // The card-boundary crew refresh itself — module scope since Phase 7, so
  // the suite executes it directly (the extract-and-evaluate era is over).
  'applyRateCardToCrew',
  // The card-less-role grade fallback: S1's crew-editor mirrors reproduce the
  // onRoleChange expression character-faithfully, which names it.
  'autoOtCoef',
  // The ONE role-change OT profile write and the ONE step-up write (Phase 8
  // collapse) — executed directly by construction-assertions, which is the
  // point of collapsing three copies of each into a helper.
  'applyRoleOtProfile',
  'stepUpPatch',
];

const EXPORT_LINE =
  `\n;globalThis.__engine = { ${ENGINE_NAMES.join(', ')} };\n`;

// ---------------------------------------------------------------------------
// Sandbox: generous stubs so the whole script can load without throwing.
// ---------------------------------------------------------------------------

function makeSandbox() {
  const noop = () => {};
  const noopComponent = function () { return null; };

  const stubStorage = () => {
    const store = new Map();
    return {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => { store.set(k, String(v)); },
      removeItem: (k) => { store.delete(k); },
      clear: () => { store.clear(); },
      get length() { return store.size; },
      key: (i) => Array.from(store.keys())[i] || null,
    };
  };

  const stubElement = () => ({
    style: {},
    setAttribute: noop,
    getAttribute: () => null,
    appendChild: noop,
    removeChild: noop,
    addEventListener: noop,
    removeEventListener: noop,
    classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
    children: [],
    childNodes: [],
    parentNode: null,
    innerHTML: '',
    textContent: '',
    focus: noop,
    blur: noop,
    click: noop,
    dispatchEvent: noop,
  });

  const sandbox = {
    console,
    setTimeout, clearTimeout, setInterval, clearInterval,
    setImmediate, clearImmediate,
    queueMicrotask,
    Date, Math, JSON, RegExp, Number, String, Array, Object, Map, Set,
    WeakMap, WeakSet, Symbol, Promise, Error, TypeError, RangeError,
    SyntaxError, ReferenceError, EvalError, URIError,
    parseInt, parseFloat, isNaN, isFinite, NaN, Infinity, undefined,
    Boolean, ArrayBuffer, Uint8Array, Int8Array, Uint16Array, Int16Array,
    Uint32Array, Int32Array, Float32Array, Float64Array, DataView,
    Intl, encodeURIComponent, decodeURIComponent, encodeURI, decodeURI,
    Proxy, Reflect,
    // Shoot-share codec dependencies — Node's own WHATWG globals passed
    // through so encode/decode (CompressionStream deflate-raw, base64url)
    // run in the sandbox exactly as they do in the browser.
    TextEncoder, TextDecoder, atob, btoa, Blob, Response,
    CompressionStream, DecompressionStream,
  };

  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.global = sandbox;

  sandbox.localStorage = stubStorage();
  sandbox.sessionStorage = stubStorage();

  sandbox.navigator = {
    userAgent: 'TimeMachine-audit-harness/1.0 (Node)',
    language: 'en-GB',
    languages: ['en-GB', 'en'],
    onLine: true,
    serviceWorker: undefined,
    platform: 'MacIntel',
    standalone: false,
  };

  sandbox.location = {
    href: 'file:///audit-harness/index.html',
    origin: 'file://',
    protocol: 'file:',
    host: '', hostname: '', port: '',
    pathname: '/audit-harness/index.html',
    search: '', hash: '',
    reload: noop, replace: noop, assign: noop,
  };

  sandbox.document = {
    addEventListener: noop,
    removeEventListener: noop,
    querySelector: () => null,
    querySelectorAll: () => [],
    getElementById: () => stubElement(),
    getElementsByClassName: () => [],
    getElementsByTagName: () => [],
    createElement: () => stubElement(),
    createTextNode: () => stubElement(),
    createDocumentFragment: () => stubElement(),
    body: stubElement(),
    head: stubElement(),
    documentElement: stubElement(),
    title: '',
    readyState: 'complete',
    cookie: '',
    visibilityState: 'visible',
    hidden: false,
    referrer: '',
    dispatchEvent: noop,
    execCommand: () => false,
  };

  sandbox.matchMedia = () => ({
    matches: false,
    media: '',
    addListener: noop,
    removeListener: noop,
    addEventListener: noop,
    removeEventListener: noop,
    dispatchEvent: noop,
  });

  sandbox.requestAnimationFrame = (cb) => setTimeout(cb, 0);
  sandbox.cancelAnimationFrame = clearTimeout;
  sandbox.requestIdleCallback = (cb) => setTimeout(() => cb({ didTimeout: false, timeRemaining: () => 0 }), 0);
  sandbox.cancelIdleCallback = clearTimeout;

  sandbox.fetch = () => Promise.reject(new Error('fetch is not available in the audit harness'));
  sandbox.XMLHttpRequest = function () {
    throw new Error('XHR is not available in the audit harness');
  };

  sandbox.crypto = {
    randomUUID: () => 'stub-uuid-0000-0000-0000-000000000000',
    getRandomValues: (buf) => { for (let i = 0; i < buf.length; i++) buf[i] = 0; return buf; },
  };

  sandbox.alert = noop;
  sandbox.confirm = () => true;
  sandbox.prompt = () => '';
  sandbox.print = noop;
  sandbox.scrollTo = noop;
  sandbox.scrollBy = noop;
  sandbox.getComputedStyle = () => ({ getPropertyValue: () => '' });

  // React: every hook returns something innocuous; createElement returns null.
  sandbox.React = {
    createElement: () => null,
    cloneElement: (el) => el,
    isValidElement: () => false,
    Fragment: 'Fragment',
    StrictMode: noopComponent,
    Suspense: noopComponent,
    Children: {
      map: () => [],
      forEach: noop,
      count: () => 0,
      toArray: () => [],
      only: () => null,
    },
    useState: (initial) => [
      typeof initial === 'function' ? initial() : initial,
      noop,
    ],
    useEffect: noop,
    useLayoutEffect: noop,
    useInsertionEffect: noop,
    useMemo: (fn) => fn(),
    useCallback: (fn) => fn,
    useRef: (initial) => ({ current: initial === undefined ? null : initial }),
    useReducer: (reducer, initial, init) => [
      init ? init(initial) : initial,
      noop,
    ],
    useContext: () => null,
    createContext: () => ({
      Provider: noopComponent,
      Consumer: noopComponent,
      _currentValue: null,
      displayName: '',
    }),
    memo: (fn) => fn,
    forwardRef: (fn) => fn,
    lazy: () => noopComponent,
    useImperativeHandle: noop,
    useDebugValue: noop,
    useId: () => 'stub-id',
    useTransition: () => [false, noop],
    useDeferredValue: (v) => v,
    useSyncExternalStore: (subscribe, getSnapshot) => getSnapshot(),
    version: '18.3.1-stub',
  };

  sandbox.ReactDOM = {
    render: noop,
    hydrate: noop,
    createRoot: () => ({ render: noop, unmount: noop }),
    hydrateRoot: () => ({ render: noop, unmount: noop }),
    unmountComponentAtNode: noop,
    findDOMNode: () => null,
    createPortal: (children) => children,
    flushSync: (fn) => fn(),
    version: '18.3.1-stub',
  };

  return sandbox;
}

// ---------------------------------------------------------------------------
// Source engine: extract the babel script body, JSX-transform, append export.
// ---------------------------------------------------------------------------

function extractBabelScriptBody(html) {
  const startMarker = '<script type="text/babel" data-type="module">';
  const startIdx = html.indexOf(startMarker);
  if (startIdx === -1) {
    throw new Error('load-engines: could not find <script type="text/babel"> in index.html');
  }
  const bodyStart = startIdx + startMarker.length;
  const endIdx = html.indexOf('</script>', bodyStart);
  if (endIdx === -1) {
    throw new Error('load-engines: could not find closing </script>');
  }
  return html.slice(bodyStart, endIdx);
}

async function loadSourceEngine() {
  const html = fs.readFileSync(SRC_HTML, 'utf8');
  const appSource = extractBabelScriptBody(html);

  // Append the engine-export at the same top-level script scope. esbuild's
  // JSX transform does not move or wrap statements — it only rewrites JSX
  // expressions — so the appended line stays adjacent to the function/const
  // declarations and can read them as siblings in scope.
  const sourceWithExport = appSource + EXPORT_LINE;

  // Same transform options as scripts/build.js, EXCEPT no IIFE wrap.
  const { code } = await esbuild.transform(sourceWithExport, {
    loader: 'jsx',
    jsx: 'transform',
    jsxFactory: 'React.createElement',
    jsxFragment: 'React.Fragment',
    target: 'es2017',
    // format: NOT 'iife' — we want a flat script so the appended line is
    // in the same scope as the engine consts.
  });

  const sandbox = makeSandbox();
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, {
    filename: 'source-engine.js',
    displayErrors: true,
  });

  if (!sandbox.__engine) {
    throw new Error('load-engines: source engine did not expose __engine');
  }
  return sandbox.__engine;
}

// ---------------------------------------------------------------------------
// Built engine: read dist/assets/app.js, inject export INSIDE the IIFE close.
// ---------------------------------------------------------------------------

function injectExportIntoIIFE(jsText) {
  // The IIFE produced by esbuild looks like:  (() => {\n ... \n})();
  // We inject the export line just before the closing `})();`.
  const closeMarker = '})();';
  const closeIdx = jsText.lastIndexOf(closeMarker);
  if (closeIdx === -1) {
    throw new Error('load-engines: could not find IIFE close `})();` in built bundle');
  }
  return jsText.slice(0, closeIdx) + EXPORT_LINE + jsText.slice(closeIdx);
}

function loadBuiltEngine() {
  const jsText = fs.readFileSync(BUILT_JS, 'utf8');
  const injected = injectExportIntoIIFE(jsText);

  const sandbox = makeSandbox();
  vm.createContext(sandbox);
  vm.runInContext(injected, sandbox, {
    filename: 'built-engine.js',
    displayErrors: true,
  });

  if (!sandbox.__engine) {
    throw new Error('load-engines: built engine did not expose __engine');
  }
  return sandbox.__engine;
}

module.exports = { loadSourceEngine, loadBuiltEngine, ENGINE_NAMES };

// CLI smoke test: `node scripts/build-vs-source-audit/load-engines.js`
if (require.main === module) {
  (async () => {
    const src = await loadSourceEngine();
    const built = loadBuiltEngine();
    console.log('source engine exposes:', Object.keys(src).join(', '));
    console.log('built  engine exposes:', Object.keys(built).join(', '));
    for (const name of ENGINE_NAMES) {
      const okSrc = typeof src[name] === 'function';
      const okBlt = typeof built[name] === 'function';
      console.log(`  ${okSrc && okBlt ? '✓' : '✗'} ${name}  (src=${typeof src[name]}, built=${typeof built[name]})`);
    }
  })().catch((e) => { console.error(e); process.exit(1); });
}
