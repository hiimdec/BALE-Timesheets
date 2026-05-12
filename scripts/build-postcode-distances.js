#!/usr/bin/env node
/**
 * Build script: postcode-distances.json
 *
 * Generates a lookup map of UK outcode districts → road distance in miles from
 * W1F 9SE (the APA's standard origin point) and an inside-M25 boolean.
 *
 * Data source: GeoNames UK postal-code data, mirrored on GitHub:
 *   https://raw.githubusercontent.com/symerio/postal-codes-data/master/data/geonames/GB.txt
 * This mirrors the freely available GeoNames postal-code dataset (no API key needed).
 * ~27 000 place/postcode entries → ~3 000 unique UK outcode district centroids.
 *
 * If that URL ever becomes unavailable, the script will fall back to the
 * postcodes.io API (throttled to 5 req/s, ~10–20 min for ~3 000 outcodes).
 *
 * Usage:
 *   node scripts/build-postcode-distances.js
 *
 * Output:
 *   postcode-distances.json  (repo root)
 *
 * To regenerate the postcode/distance dataset:
 *   node scripts/build-postcode-distances.js
 */

'use strict';

const { writeFileSync } = require('fs');
const { join }          = require('path');

// ── Origin ────────────────────────────────────────────────────────────────────
// W1F 9SE — APA standard origin, Wardour Street, Soho, London.
// Verified via: curl -s 'https://api.postcodes.io/postcodes/W1F9SE' | jq '.result|{latitude,longitude}'
const ORIGIN_LAT = 51.5128;
const ORIGIN_LON = -0.1374;

// ── Config ────────────────────────────────────────────────────────────────────
const M25_RADIUS_MILES = 14.5; // haversine cut-off; M25 sits ~14–15 mi from central London
const ROAD_BUFFER      = 1.3;  // straight-line → approximate driving distance multiplier

// Primary data source: GeoNames UK data, hosted on GitHub raw
const GEONAMES_URL = 'https://raw.githubusercontent.com/symerio/postal-codes-data/master/data/geonames/GB.txt';

// Fallback: postcodes.io individual outcode lookups (slow: ~10–20 min)
const POSTCODES_IO_BASE  = 'https://api.postcodes.io/outcodes';
const FALLBACK_BATCH_SIZE = 5;
const FALLBACK_DELAY_MS   = 1000; // 5 req/s

// UK postal areas (used only for the postcodes.io fallback candidate generation)
const UK_AREAS = [
  'AB','AL',
  'B','BA','BB','BD','BH','BL','BN','BR','BS','BT',
  'CA','CB','CF','CH','CM','CO','CR','CT','CV','CW',
  'DA','DD','DE','DG','DH','DL','DN','DT','DY',
  'E','EC','EH','EN','EX',
  'FK','FY',
  'G','GL','GU',
  'HA','HD','HG','HP','HR','HS','HU','HX',
  'IG','IP','IV',
  'KA','KT','KW','KY',
  'L','LA','LD','LE','LL','LN','LS','LU',
  'M','ME','MK','ML',
  'N','NE','NG','NN','NP','NR','NW',
  'OL','OX',
  'PA','PE','PH','PL','PO','PR',
  'RG','RH','RM',
  'S','SA','SE','SG','SK','SL','SM','SN','SO','SP','SR','SS','ST','SW','SY',
  'TA','TD','TF','TN','TQ','TR','TS','TW',
  'UB',
  'W','WA','WC','WD','WF','WN','WR','WS','WV',
  'YO','ZE',
];
const HIGH_DISTRICT_AREAS = new Set([
  'AB','B','BN','BS','BT','CF','CH','CV','DD','DE','DN',
  'E','EH','EX','FK','G','GL','GU','HU','IV','KA',
  'L','LE','LL','LS','M','ME','MK','N','NE','NG','NP','NR',
  'PA','PE','PH','PL','PO','RG','RM','S','SA','SE','SK',
  'SN','SS','SW','SY','TA','TN','TQ','TR','TS','W','WA','YO',
]);

// ── Maths ─────────────────────────────────────────────────────────────────────
function haversineMiles(lat1, lon1, lat2, lon2) {
  const R   = 3958.8; // Earth radius in miles
  const rad = x => x * Math.PI / 180;
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a   = Math.sin(dLat / 2) ** 2
              + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function computeEntry(lat, lon) {
  const straight = haversineMiles(ORIGIN_LAT, ORIGIN_LON, lat, lon);
  return {
    d:   Math.ceil(straight * ROAD_BUFFER),
    m25: straight < M25_RADIUS_MILES,
  };
}

// ── Primary: GeoNames data via GitHub raw ─────────────────────────────────────
async function buildFromGeoNames() {
  console.log('Fetching GeoNames UK postcode data from GitHub…');
  const res  = await fetch(GEONAMES_URL, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching GeoNames data`);
  const text = await res.text();
  const lines = text.trim().split('\n');

  // Accumulate lat/lon points per outcode, then take the centroid.
  const acc = new Map(); // outcode → {sumLat, sumLon, count}

  for (const line of lines) {
    const cols = line.split('\t');
    if (cols.length < 11) continue;
    const outcode = cols[1].trim().replace(/\s+/g, '').toUpperCase();
    const lat = parseFloat(cols[9]);
    const lon = parseFloat(cols[10]);
    if (!outcode || isNaN(lat) || isNaN(lon)) continue;
    const prev = acc.get(outcode);
    if (prev) { prev.sumLat += lat; prev.sumLon += lon; prev.count++; }
    else       { acc.set(outcode, { sumLat: lat, sumLon: lon, count: 1 }); }
  }

  const result = {};
  for (const [oc, { sumLat, sumLon, count }] of acc) {
    result[oc] = computeEntry(sumLat / count, sumLon / count);
  }
  return result;
}

// ── Fallback: postcodes.io individual outcode lookups ─────────────────────────
function generateFallbackCandidates() {
  const cands = [];
  for (const area of UK_AREAS) {
    const max = HIGH_DISTRICT_AREAS.has(area) ? 80 : 25;
    for (let d = 0; d <= max; d++) cands.push(`${area}${d}`);
  }
  // Central London alphanumeric districts
  const ALPHA = 'ABCDEFGHJKLMNPRSTUVWXY';
  for (const [area, nums] of Object.entries({ EC: [1,2,3,4], WC: [1,2], W: [1], SW: [1] })) {
    for (const n of nums) for (const ch of ALPHA) cands.push(`${area}${n}${ch}`);
  }
  return cands;
}

async function fetchOutcodeIO(outcode) {
  const res = await fetch(`${POSTCODES_IO_BASE}/${outcode}`, { signal: AbortSignal.timeout(10_000) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  return json.result ?? null;
}

async function buildFromPostcodesIO() {
  console.log('Falling back to postcodes.io API (this will take ~10–20 minutes)…');
  const candidates = generateFallbackCandidates();
  console.log(`Generated ${candidates.length} candidate outcodes.`);

  const result = {};
  let found = 0, notFound = 0, errors = 0;

  for (let i = 0; i < candidates.length; i += FALLBACK_BATCH_SIZE) {
    const batch   = candidates.slice(i, i + FALLBACK_BATCH_SIZE);
    const settled = await Promise.allSettled(batch.map(oc => fetchOutcodeIO(oc)));

    for (let j = 0; j < batch.length; j++) {
      const s  = settled[j];
      const oc = batch[j];
      if (s.status === 'rejected') {
        errors++;
        console.warn(`  WARN ${oc}: ${s.reason?.message}`);
      } else if (!s.value || s.value.latitude == null) {
        notFound++;
      } else {
        result[oc] = computeEntry(s.value.latitude, s.value.longitude);
        found++;
      }
    }

    if (((i + FALLBACK_BATCH_SIZE) % 500) < FALLBACK_BATCH_SIZE) {
      const pct = ((i + FALLBACK_BATCH_SIZE) / candidates.length * 100).toFixed(1);
      console.log(`  ${i + FALLBACK_BATCH_SIZE}/${candidates.length} (${pct}%)  found=${found}`);
    }

    await new Promise(r => setTimeout(r, FALLBACK_DELAY_MS));
  }

  console.log(`  Done: ${found} found, ${notFound} not found, ${errors} errors.`);
  return result;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const t0 = Date.now();
  console.log('\n── Build: postcode-distances.json ─────────────────────────────────────');
  console.log(`   Origin: W1F 9SE  lat=${ORIGIN_LAT}  lon=${ORIGIN_LON}`);
  console.log(`   M25 radius: ${M25_RADIUS_MILES} mi (haversine)  Road buffer: ×${ROAD_BUFFER}\n`);

  let result;
  try {
    result = await buildFromGeoNames();
    console.log(`GeoNames build complete: ${Object.keys(result).length} outcodes.`);
  } catch (err) {
    console.warn(`GeoNames fetch failed (${err.message}); falling back to postcodes.io API.`);
    result = await buildFromPostcodesIO();
  }

  const outPath  = join(__dirname, '..', 'postcode-distances.json');
  const jsonStr  = JSON.stringify(result);
  writeFileSync(outPath, jsonStr);

  const sizeKB   = (jsonStr.length / 1024).toFixed(1);
  const elapsed  = ((Date.now() - t0) / 1000).toFixed(1);

  console.log(`\n── Output ──────────────────────────────────────────────────────────────`);
  console.log(`   Outcodes : ${Object.keys(result).length}`);
  console.log(`   File     : ${sizeKB} KB  →  ${outPath}`);
  console.log(`   Time     : ${elapsed}s`);

  const SAMPLES = ['W1F','NW1','SE1','RH7','BS1','EH1','M1','G1','BT1'];
  console.log('\n── Verification samples ────────────────────────────────────────────────');
  for (const oc of SAMPLES) {
    const e = result[oc];
    if (e) console.log(`   ${oc.padEnd(5)} → d=${String(e.d).padStart(4)},  m25=${e.m25}`);
    else   console.log(`   ${oc.padEnd(5)} → (not in dataset)`);
  }
  console.log('');
}

main().catch(err => {
  console.error('\nBuild FAILED:', err.message);
  process.exit(1);
});
