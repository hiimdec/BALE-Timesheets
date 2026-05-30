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
    navigator: { userAgent: 'web-regression', language: 'en-GB', onLine: true },
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

function main() {
  let code = fs.readFileSync(BUILT, 'utf8');
  // Expose IS_NATIVE for assertion (built bundle is an IIFE; splice before close).
  const close = '})();';
  const at = code.lastIndexOf(close);
  code = code.slice(0, at) + '\n;globalThis.__IS_NATIVE = (typeof IS_NATIVE !== "undefined") ? IS_NATIVE : "undefined-symbol";\n' + code.slice(at);

  const sandbox = makeSandbox();
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: 'dist-app-web.js', displayErrors: true });

  check('1. IS_NATIVE is false on web', sandbox.__IS_NATIVE === false, `__IS_NATIVE=${sandbox.__IS_NATIVE}`);
  check('2. no PDF library script injected', injectedScripts.length === 0, `injected=${JSON.stringify(injectedScripts)}`);
  check('3a. window.html2canvas undefined', typeof sandbox.html2canvas === 'undefined');
  check('3b. window.jspdf undefined', typeof sandbox.jspdf === 'undefined');
  check('4. window.Capacitor never defined', typeof sandbox.Capacitor === 'undefined');

  console.log('');
  console.log('============================================================');
  console.log(' Web regression — native fixes do not affect the web build');
  console.log('============================================================');
  for (const r of results) console.log(`  ${r.ok ? '✓' : '✗'} ${r.name}${r.ok ? '' : '   << ' + r.detail}`);
  console.log('============================================================');
  console.log(failures === 0
    ? ` ✅ PASS — web build loads clean: no Capacitor, no PDF libs, IS_NATIVE=false.`
    : ` ❌ FAIL — ${failures} assertion(s) failed.`);
  console.log('============================================================');
  process.exit(failures === 0 ? 0 : 1);
}

main();
