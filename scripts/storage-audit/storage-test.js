/*
 * storage-test.js — automated checks for the Preferences storage adapter.
 *
 *   $ node scripts/storage-audit/storage-test.js
 *
 * Loads the ACTUAL app code (index.html's babel script, JSX-transformed by the
 * same esbuild options the build uses) into a Node `vm` sandbox, twice over,
 * under controlled conditions, and asserts the storage adapter behaves:
 *
 *   A. WEB regression — window.Capacitor undefined → adapter is localStorage-
 *      only; the Preferences plugin is NEVER consulted; get/set/remove round-trip
 *      through localStorage exactly as before.
 *   B. NATIVE fresh install — empty Preferences + empty localStorage → clean
 *      start, migrated flag set, no data invented.
 *   C. NATIVE upgrade — empty Preferences + localStorage holding an older build's
 *      data → one-time copy lifts every key into Preferences; reads then come
 *      back synchronously.
 *   D. NATIVE already-migrated — Preferences authoritative; stale localStorage is
 *      IGNORED (never re-imported) and never shadows Preferences.
 *   E. NATIVE durability — rapid writes are ordered (last-write-wins) and flush()
 *      awaits them; this is what flush-before-reload and flush-on-background rely on.
 *
 * Exit code 0 = all pass, non-zero = a failure (details printed).
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const esbuild = require('esbuild');

const ROOT = path.resolve(__dirname, '..', '..');
const SRC_HTML = path.join(ROOT, 'index.html');

// ---- tiny assert ----------------------------------------------------------
let failures = 0;
const results = [];
function check(name, cond, detail) {
  const ok = !!cond;
  if (!ok) failures++;
  results.push({ name, ok, detail: ok ? '' : (detail || '') });
}

// ---- recording localStorage stub -----------------------------------------
function makeLocalStorage(seed = {}) {
  const store = new Map(Object.entries(seed));
  const calls = { get: 0, set: 0, remove: 0 };
  return {
    _store: store,
    _calls: calls,
    getItem(k) { calls.get++; return store.has(k) ? store.get(k) : null; },
    setItem(k, v) { calls.set++; store.set(k, String(v)); },
    removeItem(k) { calls.remove++; store.delete(k); },
    clear() { store.clear(); },
    key(i) { return Array.from(store.keys())[i] ?? null; },
    get length() { return store.size; },
  };
}

// ---- fake @capacitor/preferences (async, in-memory) -----------------------
function makePreferences(seed = {}) {
  const store = new Map(Object.entries(seed));
  const calls = { get: 0, set: 0, remove: 0 };
  return {
    _store: store,
    _calls: calls,
    async get({ key }) { calls.get++; return { value: store.has(key) ? store.get(key) : null }; },
    async set({ key, value }) { calls.set++; store.set(key, String(value)); },
    async remove({ key }) { calls.remove++; store.delete(key); },
    async keys() { return { keys: Array.from(store.keys()) }; },
    async clear() { store.clear(); },
  };
}

// ---- fake @capacitor/app --------------------------------------------------
function makeAppPlugin() {
  const listeners = [];
  return {
    _listeners: listeners,
    addListener(event, cb) { listeners.push({ event, cb }); return { remove() {} }; },
    fire(event, payload) { listeners.filter((l) => l.event === event).forEach((l) => l.cb(payload)); },
  };
}

// ---- sandbox --------------------------------------------------------------
function makeSandbox({ capacitor, localStorage }) {
  const noop = () => {};
  const el = () => ({
    style: {}, setAttribute: noop, appendChild: noop, removeChild: noop,
    addEventListener: noop, removeEventListener: noop, focus: noop, click: noop,
    classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
  });
  const React = {
    createElement: () => null, Fragment: 'Fragment', createContext: () => ({ Provider: noop, Consumer: noop }),
    useState: (i) => [typeof i === 'function' ? i() : i, noop], useEffect: noop, useLayoutEffect: noop,
    useMemo: (f) => f(), useCallback: (f) => f, useRef: (i) => ({ current: i ?? null }),
    useReducer: (r, i, init) => [init ? init(i) : i, noop], useContext: () => null, memo: (f) => f,
    forwardRef: (f) => f, useImperativeHandle: noop, useId: () => 'id',
  };
  const sandbox = {
    console, setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask,
    Date, Math, JSON, RegExp, Number, String, Array, Object, Map, Set, WeakMap, Symbol,
    Promise, Error, TypeError, RangeError, parseInt, parseFloat, isNaN, isFinite,
    NaN, Infinity, undefined, Boolean, Proxy, Reflect, encodeURIComponent, decodeURIComponent,
    React,
    ReactDOM: { createRoot: () => ({ render: noop, unmount: noop }), version: 'stub' },
    localStorage,
    navigator: { userAgent: 'storage-test', language: 'en-GB', onLine: true },
    location: { href: 'file:///t/index.html', reload: noop, protocol: 'file:' },
    document: {
      getElementById: () => el(), querySelector: () => null, querySelectorAll: () => [],
      createElement: () => el(), addEventListener: noop, removeEventListener: noop,
      body: el(), head: el(), documentElement: el(), hidden: false, readyState: 'complete',
    },
    matchMedia: () => ({ matches: false, addEventListener: noop, removeEventListener: noop, addListener: noop, removeListener: noop }),
    requestAnimationFrame: (cb) => setTimeout(cb, 0), cancelAnimationFrame: clearTimeout,
    alert: noop, prompt: () => '', confirm: () => true,
  };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  if (capacitor) sandbox.Capacitor = capacitor; // window.Capacitor
  return sandbox;
}

// ---- load the app script, exposing `storage` ------------------------------
let cachedCode = null;
async function transformedAppCode() {
  if (cachedCode) return cachedCode;
  const html = fs.readFileSync(SRC_HTML, 'utf8');
  const startMarker = '<script type="text/babel" data-type="module">';
  const s = html.indexOf(startMarker) + startMarker.length;
  const e = html.indexOf('</script>', s);
  const body = html.slice(s, e) + '\n;globalThis.__storage = storage;\n';
  const { code } = await esbuild.transform(body, {
    loader: 'jsx', jsx: 'transform', jsxFactory: 'React.createElement',
    jsxFragment: 'React.Fragment', target: 'es2017',
  });
  cachedCode = code;
  return code;
}

async function runApp(sandboxOpts) {
  const code = await transformedAppCode();
  const sandbox = makeSandbox(sandboxOpts);
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: 'app-under-test.js', displayErrors: true });
  return sandbox;
}

// Let pending microtasks/timers (the async boot chain) settle.
function settle(ms = 30) { return new Promise((r) => setTimeout(r, ms)); }

// ---------------------------------------------------------------------------
async function main() {
  // ===== A. WEB regression =====
  {
    const localStorage = makeLocalStorage();
    const sb = await runApp({ capacitor: undefined, localStorage });
    await settle();
    const storage = sb.__storage;
    check('A1 web: adapter is non-native', storage && storage.isNative === false, `isNative=${storage && storage.isNative}`);
    // round-trip through localStorage
    storage.set('probe_key', 'probe_val');
    check('A2 web: set hit localStorage', localStorage._store.get('probe_key') === 'probe_val');
    check('A3 web: get reads localStorage', storage.get('probe_key') === 'probe_val');
    storage.remove('probe_key');
    check('A4 web: remove hit localStorage', !localStorage._store.has('probe_key'));
    check('A5 web: no Capacitor object present', sb.Capacitor === undefined);
    // boot ran migrations through localStorage (schema version set to current)
    check('A6 web: migrations ran via localStorage', localStorage._store.has('bigals_schema_version'),
      `keys=${Array.from(localStorage._store.keys())}`);
  }

  // ===== B. NATIVE fresh install =====
  {
    const localStorage = makeLocalStorage();           // empty
    const Preferences = makePreferences();             // empty
    const App = makeAppPlugin();
    const capacitor = { isNativePlatform: () => true, Plugins: { Preferences, App } };
    const sb = await runApp({ capacitor, localStorage });
    await settle();
    const storage = sb.__storage;
    check('B1 native fresh: adapter is native', storage && storage.isNative === true);
    check('B2 native fresh: no productions invented', storage.get('bigals_productions') === null,
      `got=${JSON.stringify(storage.get('bigals_productions'))}`);
    check('B3 native fresh: migrated flag set once', Preferences._store.get('bigals_native_migrated') === '1');
    check('B4 native fresh: background flush listener installed', App._listeners.some((l) => l.event === 'appStateChange'));
  }

  // ===== C. NATIVE upgrade — one-time localStorage → Preferences copy =====
  {
    const seededProductions = JSON.stringify([{ id: 'p1', title: 'Old Gig', days: [], crew: [] }]);
    const seededPrefs = JSON.stringify({ displayName: 'Dec', defaultBDR: 444 });
    const localStorage = makeLocalStorage({
      bigals_productions: seededProductions,
      bigals_user_prefs: seededPrefs,
      bigals_schema_version: '2',
    });
    const Preferences = makePreferences(); // empty — simulates first launch of new build
    const App = makeAppPlugin();
    const capacitor = { isNativePlatform: () => true, Plugins: { Preferences, App } };
    const sb = await runApp({ capacitor, localStorage });
    await settle();
    const storage = sb.__storage;
    check('C1 upgrade: productions copied to Preferences', Preferences._store.get('bigals_productions') === seededProductions,
      `prefs=${Preferences._store.get('bigals_productions')}`);
    check('C2 upgrade: prefs copied to Preferences', Preferences._store.get('bigals_user_prefs') === seededPrefs);
    check('C3 upgrade: schema version copied', Preferences._store.get('bigals_schema_version') === '2');
    check('C4 upgrade: synchronous read returns copied data', storage.get('bigals_productions') === seededProductions);
    check('C5 upgrade: migrated flag set', Preferences._store.get('bigals_native_migrated') === '1');
    check('C6 upgrade: localStorage left intact as fallback', localStorage._store.get('bigals_productions') === seededProductions);
  }

  // ===== D. NATIVE already-migrated — stale localStorage ignored =====
  {
    const prefsProductions = JSON.stringify([{ id: 'p2', title: 'Current Gig', days: [], crew: [] }]);
    const staleLocal = JSON.stringify([{ id: 'pX', title: 'STALE should be ignored', days: [], crew: [] }]);
    const localStorage = makeLocalStorage({ bigals_productions: staleLocal });
    const Preferences = makePreferences({
      bigals_productions: prefsProductions,
      // Seed the current schema version so boot's runMigrations() is a no-op and
      // leaves the value byte-identical — otherwise migrations legitimately
      // rewrite it (which would be the correct behaviour, just not what this
      // particular "stale localStorage is ignored" assertion is checking).
      bigals_schema_version: '2',
      bigals_native_migrated: '1',
    });
    const App = makeAppPlugin();
    const capacitor = { isNativePlatform: () => true, Plugins: { Preferences, App } };
    const sb = await runApp({ capacitor, localStorage });
    await settle();
    const storage = sb.__storage;
    check('D1 migrated: reads Preferences not localStorage', storage.get('bigals_productions') === prefsProductions,
      `got=${storage.get('bigals_productions')}`);
    check('D2 migrated: stale localStorage NOT copied over Preferences', Preferences._store.get('bigals_productions') === prefsProductions);
  }

  // ===== E. NATIVE durability — ordered writes + flush =====
  {
    const localStorage = makeLocalStorage();
    const Preferences = makePreferences({ bigals_productions: '[]', bigals_native_migrated: '1' });
    const App = makeAppPlugin();
    const capacitor = { isNativePlatform: () => true, Plugins: { Preferences, App } };
    const sb = await runApp({ capacitor, localStorage });
    await settle();
    const storage = sb.__storage;
    // rapid-fire writes to the same key
    storage.set('bigals_productions', 'v1');
    storage.set('bigals_productions', 'v2');
    storage.set('bigals_productions', 'v3');
    check('E1 durability: cache reflects last write immediately', storage.get('bigals_productions') === 'v3');
    await storage.flush();
    check('E2 durability: flush persists last-write-wins', Preferences._store.get('bigals_productions') === 'v3',
      `persisted=${Preferences._store.get('bigals_productions')}`);
    // simulate app backgrounding → should trigger a flush of any later write
    storage.set('bigals_user_prefs', '{"x":1}');
    App.fire('appStateChange', { isActive: false });
    await settle();
    check('E3 durability: background flush persisted the write', Preferences._store.get('bigals_user_prefs') === '{"x":1}');
  }

  // ---- report ----
  console.log('');
  console.log('============================================================');
  console.log(' Storage adapter test — web regression + native logic');
  console.log('============================================================');
  for (const r of results) {
    console.log(`  ${r.ok ? '✓' : '✗'} ${r.name}${r.ok ? '' : '   << ' + r.detail}`);
  }
  console.log('============================================================');
  if (failures === 0) {
    console.log(` ✅ PASS — all ${results.length} storage assertions passed.`);
  } else {
    console.log(` ❌ FAIL — ${failures} of ${results.length} assertions failed.`);
  }
  console.log('============================================================');
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(2); });
