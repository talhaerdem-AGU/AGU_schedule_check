import express from 'express';
import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = Number(process.env.PORT || 3000);
const PRIMARY_URL = 'https://calendars.agu.edu.tr/timetable';
const FALLBACK_URL = 'https://cat.agu.edu.tr/Lesson/GetLessons';

app.use(express.json({limit:'200kb'}));
app.use(express.static(path.join(__dirname,'public')));

const norm=(v='')=>String(v).replace(/İ/g,'I').replace(/ı/g,'i').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ').trim().toLowerCase();
const compact=(v='')=>norm(v).replace(/[^a-z0-9]/g,'');
const secNorm=(v='')=>String(v).replace(/^\s*(şube|sube|section|grup|group|branch)\s*[:#-]?\s*/i,'').trim();

function scalars(obj,p=''){
  const out=[]; if(!obj||typeof obj!=='object') return out;
  for(const [k,v] of Object.entries(obj)){
    const key=p?`${p}.${k}`:k;
    if(v==null) continue;
    if(['string','number','boolean'].includes(typeof v)) out.push([key,String(v)]);
    else if(typeof v==='object'&&!Array.isArray(v)) out.push(...scalars(v,key));
  }
  return out;
}
function pick(obj, regs){
  for(const [k,v] of scalars(obj)){
    const kk=norm(k).replace(/[^a-z0-9]/g,'');
    if(regs.some(re=>re.test(kk))) return v;
  }
  return '';
}
const K={
  code:[/^(course|lesson|ders)?code$/,/derskodu/,/coursecode/,/lessoncode/],
  section:[/section/,/sube/,/grup/,/group/,/branch/],
  name:[/coursename/,/lessonname/,/dersadi/,/^name$/],
  instructor:[/instructor/,/lecturer/,/teacher/,/academician/,/ogretimeleman/],
  day:[/^day$/,/weekday/,/^gun$/],
  start:[/starttime/,/baslangic/,/bassaat/,/^start$/],
  end:[/endtime/,/bitis/,/bitsaat/,/^end$/],
  room:[/classroom/,/^room$/,/derslik/,/location/],
  program:[/program/,/department/], faculty:[/faculty/,/fakulte/], classYear:[/classyear/,/grade/,/sinif/]
};
function fromObj(o){return {code:pick(o,K.code),section:pick(o,K.section),name:pick(o,K.name),instructor:pick(o,K.instructor),day:pick(o,K.day),start:pick(o,K.start),end:pick(o,K.end),room:pick(o,K.room),program:pick(o,K.program),faculty:pick(o,K.faculty),classYear:pick(o,K.classYear)}}
function containsCode(o,code){return scalars(o).some(([,v])=>compact(v)===compact(code));}
function collect(root,code,limit=1000){const out=[],seen=new WeakSet();function walk(x,d=0){if(!x||typeof x!=='object'||d>15||out.length>=limit||seen.has(x))return;seen.add(x);if(!Array.isArray(x)&&containsCode(x,code))out.push(x);if(Array.isArray(x))for(const v of x)walk(v,d+1);else for(const v of Object.values(x))walk(v,d+1);}walk(root);return out;}
function dedupe(rows){const m=new Map();for(const r of rows){const key=[compact(r.code),norm(secNorm(r.section)),norm(r.instructor),norm(r.day),norm(r.start),norm(r.end),norm(r.room)].join('|');if(!m.has(key))m.set(key,r);}return [...m.values()];}

async function scrapeSource(url,codes){
  const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  try{
    const page=await browser.newPage({locale:'tr-TR'});
    const payloads=[];
    page.on('response',async response=>{
      try{
        const ct=(response.headers()['content-type']||'').toLowerCase();
        const typ=response.request().resourceType();
        if(!(ct.includes('json')||typ==='xhr'||typ==='fetch'))return;
        const txt=await response.text(); if(!txt||txt.length>15_000_000)return;
        let data; try{data=JSON.parse(txt)}catch{return}
        payloads.push({url:response.url(),data});
      }catch{}
    });
    await page.goto(url,{waitUntil:'domcontentloaded',timeout:70000});
    await page.waitForTimeout(5000);

    // capture app state embedded in scripts as JSON-ish text where possible
    const scriptTexts=await page.locator('script').allTextContents().catch(()=>[]);
    const domRecords=await page.evaluate(()=>{
      const rows=[];
      for(const tr of document.querySelectorAll('tr')){
        const c=[...tr.querySelectorAll('th,td')].map(x=>(x.innerText||x.textContent||'').trim());
        if(c.length>=4) rows.push({cells:c,html:tr.outerHTML.slice(0,8000)});
      }
      // Also capture card/list items because current timetable may not use a table.
      const blocks=[];
      for(const el of document.querySelectorAll('[class*="course" i],[class*="lesson" i],[class*="event" i],[class*="schedule" i],[class*="timetable" i]')){
        const text=(el.innerText||'').trim(); if(text&&text.length<5000) blocks.push({text,html:el.outerHTML.slice(0,8000)});
      }
      return {rows,blocks,body:(document.body?.innerText||'').slice(0,500000)};
    });

    const byCode={};
    for(const code of codes){
      const objs=[];
      for(const p of payloads) objs.push(...collect(p.data,code));
      // direct rows from structured JSON
      let rows=objs.map(fromObj).filter(r=>compact(r.code)===compact(code));

      // DOM table heuristic: infer headers if present
      for(const rr of domRecords.rows){
        if(!rr.cells.some(x=>compact(x)===compact(code))) continue;
        const c=rr.cells; const idx=c.findIndex(x=>compact(x)===compact(code));
        const text=c.join(' | ');
        let section='';
        const sm=text.match(/(?:şube|sube|section|grup|group|branch)\s*[:#-]?\s*([A-Za-z0-9._-]+)/i);
        if(sm)section=sm[1];
        rows.push({code:c[idx]||code,section,name:'',instructor:'',day:'',start:'',end:'',room:'',program:'',faculty:'',classYear:'',_domText:text});
      }
      // blocks can expose section even when schedule object is elsewhere
      for(const b of domRecords.blocks){
        if(!new RegExp(`\\b${code.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}\\b`,'i').test(b.text))continue;
        const sm=b.text.match(/(?:şube|sube|section|grup|group|branch)\s*[:#-]?\s*([A-Za-z0-9._-]+)/i);
        if(sm) rows.push({code,section:sm[1],name:'',instructor:'',day:'',start:'',end:'',room:'',program:'',faculty:'',classYear:'',_domText:b.text});
      }
      byCode[code]=dedupe(rows);
    }
    return {url,payloadUrls:payloads.map(x=>x.url),byCode,bodyPreview:domRecords.body.slice(0,3000),scriptCount:scriptTexts.length};
  }finally{await browser.close()}
}

async function getPrimary(codes){
  try{return await scrapeSource(PRIMARY_URL,codes)}catch(e){return {url:PRIMARY_URL,error:e.message,byCode:Object.fromEntries(codes.map(c=>[c,[]])),payloadUrls:[]}}
}

async function getFallback(codes){
  // AGUCAT fallback for schedule details only; no section assumption.
  try{return await scrapeSource(FALLBACK_URL,codes)}catch(e){return {url:FALLBACK_URL,error:e.message,byCode:Object.fromEntries(codes.map(c=>[c,[]])),payloadUrls:[]}}
}

function merge(primaryRows,fallbackRows){
  if(!primaryRows.length) return fallbackRows;
  // If primary has section but no schedule, enrich by matching instructor when possible.
  const out=[];
  for(const p of primaryRows){
    if(p.day&&p.start&&p.end){out.push(p);continue;}
    const candidates=fallbackRows.filter(f=>!p.instructor||!f.instructor||norm(f.instructor)===norm(p.instructor));
    if(candidates.length){for(const f of candidates)out.push({...f,section:p.section||f.section,instructor:p.instructor||f.instructor});}
    else out.push(p);
  }
  return dedupe(out);
}

app.get('/api/health',(req,res)=>res.json({ok:true,primary:PRIMARY_URL,fallback:FALLBACK_URL}));

app.get('/api/sections',async(req,res)=>{
  const code=String(req.query.code||'').trim(); if(!code)return res.status(400).json({error:'Ders kodu gerekli.'});
  try{
    const p=await getPrimary([code]);
    const sections=[...new Set((p.byCode[code]||[]).map(r=>secNorm(r.section)).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'tr',{numeric:true}));
    if(sections.length) return res.json({code,sections:sections.map(s=>({value:s,label:`Şube ${s}`})),source:PRIMARY_URL,sectionDetected:true});
    return res.json({code,sections:[],source:PRIMARY_URL,sectionDetected:false,warning:'Güncel resmi timetable kaynağında bu ders için şube numarası okunamadı.'});
  }catch(e){res.status(502).json({error:'Şube bilgileri alınamadı.',detail:e.message});}
});

app.post('/api/schedule',async(req,res)=>{
  try{
    const courses=(Array.isArray(req.body?.courses)?req.body.courses:[]).map(x=>({code:String(x.code||'').trim(),section:String(x.section||'').trim()})).filter(x=>x.code);
    if(!courses.length)return res.status(400).json({error:'En az bir ders kodu girin.'});
    const codes=[...new Set(courses.map(x=>x.code))];
    const [p,f]=await Promise.all([getPrimary(codes),getFallback(codes)]);
    const rows=[],warnings=[],notFound=[];
    for(const q of courses){
      const prim=p.byCode[q.code]||[], fall=f.byCode[q.code]||[];
      let merged=merge(prim,fall).filter(r=>compact(r.code)===compact(q.code));
      if(q.section){
        const target=norm(secNorm(q.section));
        const withSec=merged.filter(r=>r.section&&norm(secNorm(r.section))===target);
        if(withSec.length) merged=withSec;
        else {merged=[];warnings.push(`${q.code}: Şube ${q.section} güncel resmi timetable kaynağında doğrulanamadı; başka şubeler gösterilmedi.`);}
      }
      // Calendar only renders records with real day/time.
      merged=merged.filter(r=>r.day&&r.start&&r.end);
      if(!merged.length)notFound.push({code:q.code,section:q.section,reason:'Ders/şube için gün-saat kaydı doğrulanamadı'});
      rows.push(...merged.map(r=>({...r,requestedSection:q.section})));
    }
    res.json({rows:dedupe(rows),warnings:[...new Set(warnings)],notFound,source:PRIMARY_URL,fallback:FALLBACK_URL,diagnostics:{primaryError:p.error||null,primaryPayloads:p.payloadUrls?.length||0,fallbackError:f.error||null,fallbackPayloads:f.payloadUrls?.length||0}});
  }catch(e){res.status(502).json({error:'Ders programı okunamadı.',detail:e.message});}
});

app.get('/api/debug',async(req,res)=>{
  const code=String(req.query.code||'').trim(); if(!code)return res.status(400).json({error:'code gerekli'});
  const p=await getPrimary([code]);
  const f=await getFallback([code]);
  res.json({primary:{url:p.url,error:p.error||null,payloadUrls:p.payloadUrls,rows:p.byCode[code],bodyPreview:p.bodyPreview},fallback:{url:f.url,error:f.error||null,payloadUrls:f.payloadUrls,rows:f.byCode[code]}});
});

app.listen(PORT,()=>console.log(`AGÜ Ders Programı v8: http://localhost:${PORT}`));
