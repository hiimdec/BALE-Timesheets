// Generate the long form role registry + card reference rates from the
// Bectu/Pact CSV. Run: node scripts/rate-registry/generate.js
// Emits scripts/rate-registry/registry.gen.js (the JS embedded in index.html).
// Rulings (Phase 5a): filter Base/package; collapse Construction; bag-of-words
// dedup (Costume accepted at 48, no borderline merges); drop Electrical Rigging
// (rigging is a mode, not a department); Props standalone; Crane Technicians ->
// Grip; Production Transport -> the Driver entry; Intimacy Coordination and
// Post-Production Editorial are new departments. Script Supervisor stays a role
// (its ACH exception lives in seedAgreementClass, not here).
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
function parseCSV(text){const rows=[];let row=[],f='',q=false;for(let i=0;i<text.length;i++){const c=text[i];if(q){if(c==='"'){if(text[i+1]==='"'){f+='"';i++;}else q=false;}else f+=c;}else{if(c==='"')q=true;else if(c===','){row.push(f);f='';}else if(c==='\r'){}else if(c==='\n'){row.push(f);rows.push(row);row=[];f='';}else f+=c;}}if(f.length||row.length){row.push(f);rows.push(row);}return rows;}

const ABBR={jnr:'junior',snr:'senior',asst:'assistant',coord:'coordinator',dir:'director',desig:'designer',tech:'technician',supvr:'supervisor',supv:'supervisor',mistress:'master',costumier:'costume'};
const SPELL=[[/modeler/g,'modeller'],[/ilustrator/g,'illustrator'],[/co[-\s]*ordinator/g,'coordinator']];
const STOP=new Set(['daily','weekly','all','areas','or','and','the','a','of']);
function canonWords(role){let s=role.toLowerCase();for(const[re,to]of SPELL)s=s.replace(re,to);return s.split(/[^a-z0-9]+/).filter(Boolean).map(x=>ABBR[x]||x).filter(x=>!STOP.has(x));}
function canon(role){return [...new Set(canonWords(role))].sort().join(' ');}

// Display cleaning: spelling + abbreviation fixes, tidy whitespace/casing while
// preserving ALLCAPS acronyms (DIT, PA, FX, AC, AD, VFX) and ordinals.
function cleanDisplay(s){
  s=s.replace(/\s+/g,' ').trim();
  s=s.replace(/co[-\s]*ordinator/gi,'Coordinator').replace(/ilustrator/gi,'Illustrator');
  s=s.replace(/\bSnr\b/gi,'Senior').replace(/\bJnr\b/gi,'Junior').replace(/\bAsst\b/gi,'Assistant');
  s=s.replace(/\s*\/\s*/g,' / ');
  return s.split(/(\s+|\/)/).map(w=>{
    if(w==='/'||/^\s+$/.test(w))return w;
    if(/^[A-Z0-9&]{2,}$/.test(w))return w;                 // acronym
    if(/^\d/.test(w))return w;                             // ordinal
    if(/^[A-Za-z]/.test(w))return w.charAt(0).toUpperCase()+w.slice(1).toLowerCase();
    return w;
  }).join('');
}
function betterDisplay(a,b){if(!a)return b;if(!b)return a;if(b.length!==a.length)return b.length>a.length?b:a;const sc=s=>[...s].filter(c=>c>='A'&&c<='Z').length;return sc(b)>sc(a)?b:a;}

// CSV dept -> app dept (rulings). null = drop the department entirely.
const DEPT={
  'Art Department':'Art Dept','Assistant Directors':'Assistant Directors','Camera':'Camera',
  'Construction':'Construction','Costume':'Costume','Grips':'Grip','Hair & Make-up':'Hair & Makeup',
  'Intimacy Coordination':'Intimacy Coordination','Lighting':'Lighting','Locations':'Locations',
  'Post-Production Editorial':'Post-Production','Production':'Direction & Production','Production Sound':'Sound',
  'Production Transport':'Transport','Props':'Props','Special Effects':'SFX',
  'Crane Technicians':'Grip',                     // fold
  'Electrical Rigging':null,                      // drop - rigging is a mode (the ÷9 class), not a department
};
const normDept=d=>/^Construction\b/i.test(d)?'Construction':d;

// The Construction section of the CSV is an uplift schedule, not a rate card:
// its eligibility footnote paragraph got shredded across the rate columns into
// fake "roles" (rate values like "ey have completed"). These prose fragments
// are not roles - drop them. (Reported to the founder as the one deviation from
// the accepted counts: Construction 28 -> 22.)
const DROP_ROLE=/accumulated time served|only eligible|certified employment|responsibility to alert|provide evidence|can mean that|craft rate once|each year cons|remain in the same band/i;

// band code
function bandCode(b){
  const m=b.match(/TV Band (\d)/); if(m)return 'tv'+m[1];
  if(/^MMP/.test(b))return 'mmp';
  return null;                                    // other film budget tiers: not the app's band (MMP) - skipped for the reference line
}
const UNIT={day:'d',week:'w',hour:'h'};
const HP={'Included':'I','Excluded':'E','Unspecified':'U','Shown separately':'S'};

const rows=parseCSV(fs.readFileSync(path.join(ROOT,'bectu_pact_ai_rates.csv'),'utf8'));
const H={};rows[0].forEach((h,i)=>H[h.trim()]=i);
const data=rows.slice(1).filter(r=>r.length>=rows[0].length-2&&r[0]);
const col=(r,n)=>(r[H[n]]||'').trim();
const base=data.filter(r=>col(r,'Record Kind')==='Base / package rate');

// Build dept -> canonKey -> {display, tv, film, ref:{band:[v,u,h]}}
const reg={};
for(const r of base){
  let dept=normDept(col(r,'Department'));
  if(!(dept in DEPT)){ continue; }               // unknown source dept (shouldn't happen) - skip
  const appDept=DEPT[dept]; if(appDept===null) continue;   // dropped (Electrical Rigging)
  let role=col(r,'Role'); if(!role) continue;
  if(DROP_ROLE.test(role)) continue;             // shredded footnote prose, not a role
  const key=canon(role);
  const pt=col(r,'Production Type');
  reg[appDept]=reg[appDept]||{};
  const e=reg[appDept][key]||{display:'',tv:false,film:false,ref:{}};
  e.display=betterDisplay(e.display, cleanDisplay(role.replace(/\bDAILY\b|\bWEEKLY\b/g,'')));
  if(pt==='TV Drama'||pt==='Commercial'||pt==='Factual / Documentary / News / Corporate')e.tv=true;
  if(pt==='Film')e.film=true;
  if(pt==='General / Unbanded'){e.tv=true;e.film=true;}
  // reference rate. Skip 'percent' units: Construction's "3.2%" is a stated
  // uplift, not a recommended day/week/hour rate - showing it as one would mislead.
  const bc=bandCode(col(r,'Budget Band'));
  const rawUnit=col(r,'Rate Unit');
  if(bc && !/percent/i.test(rawUnit)){
    const rt=col(r,'Rate Text'), rv=col(r,'Rate Value');
    const unit=UNIT[rawUnit]||rawUnit||'';
    const hp=HP[col(r,'Holiday Pay Treatment')]||'U';
    let val=null;
    if(/negoti/i.test(rt)||/negoti/i.test(col(r,'Budget Band')))val='NEG';
    else if(rv&&!isNaN(Number(rv)))val=Number(rv);
    else if(rt)val=rt;
    if(val!=null&&!(bc in e.ref))e.ref[bc]=[val,unit,hp];    // first rate for a band wins
  }
  reg[appDept][key]=e;
}

// Drop pure-generic trainee CSV roles (subsumed by the synthetic dept trainee)
function isGenericTrainee(display, appDept){
  const w=new Set(canonWords(display));
  if(!w.has('trainee'))return false;
  const deptW=new Set(canonWords(appDept).concat(['apprentice','junior','grip','grips']));
  for(const x of w){ if(x!=='trainee'&&!deptW.has(x))return false; }
  return true;
}
for(const dept of Object.keys(reg)){
  for(const k of Object.keys(reg[dept])){ if(isGenericTrainee(reg[dept][k].display,dept)) delete reg[dept][k]; }
}

// Emit
const roles=[]; const ref={};
for(const dept of Object.keys(reg).sort()){
  for(const e of Object.values(reg[dept]).sort((a,b)=>a.display.localeCompare(b.display))){
    const a=(e.tv?1:0)|(e.film?2:0);
    roles.push({r:e.display,d:dept,a});
    if(Object.keys(e.ref).length) ref[e.display]=e.ref;
  }
}
// Counts report
const byDept={}; for(const x of roles) byDept[x.d]=(byDept[x.d]||0)+1;
console.log('== Registry departments and role counts (Phase 5a) ==');
let tot=0; for(const d of Object.keys(byDept).sort()){ tot+=byDept[d]; console.log('  '+String(byDept[d]).padStart(3)+'  '+d); }
console.log('  TOTAL long form roles: '+tot+'   departments: '+Object.keys(byDept).length);
console.log('  reference-priced roles: '+Object.keys(ref).length);

// Write the embeddable JS
const out='// GENERATED by scripts/rate-registry/generate.js from bectu_pact_ai_rates.csv - do not hand-edit.\n'+
  '// a: 1=tv, 2=film, 3=both. ref band codes: tv1..tv4, mmp -> [value|"NEG"|text, unit d/w/h, holidayPay I/E/U/S].\n'+
  'const LF_ROLE_REGISTRY = '+JSON.stringify(roles)+';\n'+
  'const LF_ROLE_REF = '+JSON.stringify(ref)+';\n';
fs.writeFileSync(path.join(__dirname,'registry.gen.js'),out);
console.log('\nwrote scripts/rate-registry/registry.gen.js ('+out.length+' bytes)');
