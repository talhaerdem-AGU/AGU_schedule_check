import express from 'express';
import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = Number(process.env.PORT || 3000);
const SOURCE_URL = 'https://cat.agu.edu.tr/Lesson/GetLessons';

app.use(express.json({ limit: '200kb' }));
app.use(express.static(path.join(__dirname, 'public')));

const norm = (v='') => String(v)
  .replace(/İ/g,'I').replace(/ı/g,'i')
  .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
  .replace(/\s+/g,' ').trim().toLowerCase();
const compactCode = (v='') => norm(v).replace(/[^a-z0-9]/g,'');
const normalizeSection = (v='') => String(v)
  .replace(/^\s*(şube|sube|section|grup|group|branch)\s*[:#-]?\s*/i,'').trim();

function dedupe(rows) {
  const m = new Map();
  for (const r of rows) {
    const key = [compactCode(r.code),norm(r.section),norm(r.day),norm(r.start),norm(r.end),norm(r.room),norm(r.instructor)].join('|');
    if (!m.has(key)) m.set(key, r);
  }
  return [...m.values()];
}

function scalarEntries(obj, prefix='') {
  const out = [];
  if (!obj || typeof obj !== 'object') return out;
  for (const [k,v] of Object.entries(obj)) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (v == null) continue;
    if (['string','number','boolean'].includes(typeof v)) out.push([p, String(v)]);
    else if (typeof v === 'object' && !Array.isArray(v)) out.push(...scalarEntries(v,p));
  }
  return out;
}

function pickByKey(obj, regexes) {
  const entries = scalarEntries(obj);
  for (const re of regexes) {
    const hit = entries.find(([k]) => re.test(norm(k).replace(/[^a-z0-9]/g,'')));
    if (hit) return hit[1];
  }
  return '';
}

function objectContainsCode(obj, code) {
  const cc = compactCode(code);
  return scalarEntries(obj).some(([,v]) => compactCode(v) === cc);
}

function collectMatchingObjects(root, code, limit=300) {
  const out=[]; const seen=new WeakSet();
  function walk(x, depth=0) {
    if (out.length>=limit || depth>12 || x==null) return;
    if (typeof x !== 'object') return;
    if (seen.has(x)) return; seen.add(x);
    if (!Array.isArray(x) && objectContainsCode(x, code)) out.push(x);
    if (Array.isArray(x)) for (const v of x) walk(v,depth+1);
    else for (const v of Object.values(x)) walk(v,depth+1);
  }
  walk(root);
  return out;
}

const K = {
  code:[/^(ders|course|lesson)?code$/,/derskodu/,/coursecode/,/lessoncode/],
  section:[/sube/,/section/,/grup/,/group/,/branch/],
  name:[/dersadi/,/coursename/,/lessonname/,/^name$/],
  day:[/^gun$/,/day/,/weekday/],
  start:[/baslangic/,/bas.*saat/,/start.*time/,/^start$/],
  end:[/bitis/,/bit.*saat/,/end.*time/,/^end$/],
  room:[/derslik/,/classroom/,/^room$/,/location/],
  instructor:[/ogretim.*eleman/,/instructor/,/lecturer/,/teacher/,/academician/],
  faculty:[/fakulte/,/faculty/],
  program:[/program/,/department/],
  classYear:[/sinif/,/classyear/,/grade/]
};

function rowFromObject(o, fallback={}) {
  return {
    code: pickByKey(o,K.code) || fallback.code || '',
    section: pickByKey(o,K.section) || fallback.section || '',
    name: pickByKey(o,K.name) || fallback.name || '',
    instructor: pickByKey(o,K.instructor) || fallback.instructor || '',
    day: pickByKey(o,K.day) || fallback.day || '',
    start: pickByKey(o,K.start) || fallback.start || '',
    end: pickByKey(o,K.end) || fallback.end || '',
    room: pickByKey(o,K.room) || fallback.room || '',
    faculty: pickByKey(o,K.faculty) || fallback.faculty || '',
    program: pickByKey(o,K.program) || fallback.program || '',
    classYear: pickByKey(o,K.classYear) || fallback.classYear || ''
  };
}

async function extractVisibleRows(page) {
  return await page.evaluate(() => {
    const table = document.querySelector('table');
    if (!table) return [];
    return [...table.querySelectorAll('tbody tr')].map(tr => {
      const td = [...tr.querySelectorAll('td')].map(x => (x.innerText || x.textContent || '').trim());
      if (td.length < 6) return null;
      const html = tr.outerHTML || '';
      let section = '';
      const patterns = [
        /(?:section|sube|şube|group|grup|branch)\s*[=:"'\s-]+([A-Za-z0-9._-]+)/i,
        /[?&](?:section|sube|şube|group|grup|branch)=([^&"']+)/i,
        /data-(?:section|sube|group|grup|branch)=["']([^"']+)/i
      ];
      for (const re of patterns) { const m = html.match(re); if (m) { section = decodeURIComponent(m[1]); break; } }
      return {
        code: td[0] || '', name: td[1] || '', instructor: td[2] || '', day: td[3] || '',
        start: td[4] || '', end: td[5] || '', room: td[6] || '', faculty: td[7] || '',
        program: td[8] || '', classYear: td[9] || '', section,
        _html: html.slice(0,5000)
      };
    }).filter(Boolean);
  });
}

async function extractDataTablesRaw(page) {
  return await page.evaluate(() => {
    try {
      const table = document.querySelector('table');
      const jq = window.jQuery || window.$;
      if (!table || !jq || !jq.fn || !jq.fn.dataTable || !jq.fn.dataTable.isDataTable(table)) return [];
      const dt = jq(table).DataTable();
      return dt.rows({ search:'applied' }).data().toArray();
    } catch { return []; }
  });
}

async function findSearchInput(page) {
  const selectors = ['input[type="search"]','.dataTables_filter input','input[placeholder*="Ara" i]','input[placeholder*="Search" i]'];
  for (const sel of selectors) { const loc=page.locator(sel).first(); if (await loc.count()) return loc; }
  return null;
}

async function setMaxPageLength(page) {
  for (const sel of ['select[name$="_length"]','.dataTables_length select']) {
    const loc=page.locator(sel).first();
    if (await loc.count()) {
      const values=await loc.locator('option').evaluateAll(opts=>opts.map(o=>o.value));
      const preferred=['-1','1000','500','250','100'].find(v=>values.includes(v));
      if (preferred) { await loc.selectOption(preferred).catch(()=>{}); await page.waitForTimeout(500); }
      return;
    }
  }
}

function bestRawMatch(objects, visibleRow, requestedSection='') {
  const req = norm(normalizeSection(requestedSection));
  const scored = objects.map(o => {
    const r=rowFromObject(o);
    let score=0;
    if (compactCode(r.code)===compactCode(visibleRow.code)) score+=8;
    if (r.day && norm(r.day)===norm(visibleRow.day)) score+=4;
    if (r.start && norm(r.start)===norm(visibleRow.start)) score+=4;
    if (r.end && norm(r.end)===norm(visibleRow.end)) score+=4;
    if (r.room && norm(r.room)===norm(visibleRow.room)) score+=3;
    if (r.instructor && norm(r.instructor)===norm(visibleRow.instructor)) score+=2;
    if (req && r.section && norm(normalizeSection(r.section))===req) score+=10;
    return {o,r,score};
  }).sort((a,b)=>b.score-a.score);
  return scored[0] || null;
}

async function fetchRequestedLessons(courses, debugCode='') {
  const browser = await chromium.launch({ headless:true });
  try {
    const page=await browser.newPage({ locale:'tr-TR' });
    const jsonPayloads=[];
    page.on('response', async response => {
      try {
        const ct=(response.headers()['content-type']||'').toLowerCase();
        const rt=response.request().resourceType();
        if (!(ct.includes('json') || rt==='xhr' || rt==='fetch')) return;
        const txt=await response.text();
        if (!txt || txt.length>8_000_000) return;
        let data; try { data=JSON.parse(txt); } catch { return; }
        jsonPayloads.push({ url:response.url(), data });
      } catch {}
    });

    await page.goto(SOURCE_URL,{waitUntil:'domcontentloaded',timeout:60000});
    await page.waitForFunction(()=>document.querySelectorAll('table tbody tr td').length>=6,{timeout:90000});
    await page.waitForTimeout(1200);
    await setMaxPageLength(page);
    const search=await findSearchInput(page);

    const allRows=[], notFound=[], warnings=[];
    let sectionDetected=false;
    const debug={ code:debugCode, payloadUrls:jsonPayloads.map(x=>x.url), candidates:[] };

    for (const q of courses) {
      if (search) { await search.fill(''); await search.fill(q.code); await page.waitForTimeout(800); }
      let visible=(await extractVisibleRows(page)).filter(r=>compactCode(r.code)===compactCode(q.code));
      const rawDt=await extractDataTablesRaw(page);
      const sources=[...rawDt, ...jsonPayloads.map(x=>x.data)];
      let rawObjects=[];
      for (const src of sources) rawObjects.push(...collectMatchingObjects(src,q.code));

      // DataTables can return array rows; hidden columns may contain section. Preserve those too.
      const dtArrayMatches=rawDt.filter(x=>Array.isArray(x) && x.some(v=>compactCode(v)===compactCode(q.code)));
      const reqSec=norm(normalizeSection(q.section));

      const enriched=visible.map(v=>{
        if (v.section) return v;
        const best=bestRawMatch(rawObjects,v,q.section);
        if (best && best.score>=8 && best.r.section) return {...v,section:best.r.section,_rawScore:best.score};
        // If DataTables raw row has hidden extra columns and exactly one equals requested section, use it.
        if (q.section) {
          for (const arr of dtArrayMatches) {
            const vals=arr.map(x=>String(x??''));
            const extra=vals.slice(10);
            const hit=extra.find(x=>norm(normalizeSection(x))===reqSec);
            if (hit) return {...v,section:hit,_rawScore:7};
          }
        }
        return v;
      });

      // Also build full rows directly from JSON objects when they contain schedule fields.
      const direct=rawObjects.map(o=>rowFromObject(o)).filter(r=>
        compactCode(r.code)===compactCode(q.code) && r.day && r.start && r.end
      );
      let rows=dedupe([...enriched,...direct]);
      sectionDetected ||= rows.some(r=>r.section);
      const codeMatches=rows.length;

      if (q.section) {
        const sectionRows=rows.filter(r=>r.section && norm(normalizeSection(r.section))===reqSec);
        if (sectionRows.length) rows=sectionRows;
        else {
          rows=[];
          warnings.push(`${q.code}: Şube ${q.section} kaynak veride doğrulanamadığı için diğer şubelerin kayıtları gösterilmedi. /api/debug?code=${encodeURIComponent(q.code)} adresinden AGUCAT ham alanlarını kontrol edebilirsiniz.`);
        }
      }

      if (!rows.length) notFound.push({...q,reason:codeMatches && q.section?'Şube eşleşmedi veya şube alanı bulunamadı':'Ders kodu bulunamadı'});
      allRows.push(...rows.map(r=>({...r,requestedSection:q.section})));

      if (debugCode && compactCode(debugCode)===compactCode(q.code)) {
        debug.candidates=rawObjects.slice(0,40).map(o=>({
          fields:Object.fromEntries(scalarEntries(o).slice(0,80)),
          inferred:rowFromObject(o)
        }));
        debug.visible=visible.map(v=>({...v,_html:undefined}));
        debug.dataTablesArrays=dtArrayMatches.slice(0,20);
      }
    }

    if (search) await search.fill('').catch(()=>{});
    return {rows:dedupe(allRows),warnings:[...new Set(warnings)],notFound,debug,
      diagnostics:{source:SOURCE_URL,mode:'DOM + DataTables ham veri + AJAX/JSON şube çözümleme',searchInputDetected:!!search,sectionDetected,jsonResponseCount:jsonPayloads.length}};
  } finally { await browser.close(); }
}

app.get('/api/health',(req,res)=>res.json({ok:true,source:SOURCE_URL}));

app.get('/api/sections', async (req,res)=>{
  const code=String(req.query.code||'').trim();
  if(!code) return res.status(400).json({error:'Ders kodu gerekli.'});
  try {
    const data=await fetchRequestedLessons([{code,section:''}]);
    const sections=[...new Set((data.rows||[])
      .map(r=>normalizeSection(r.section||''))
      .filter(Boolean))]
      .sort((a,b)=>String(a).localeCompare(String(b),'tr',{numeric:true,sensitivity:'base'}));
    res.json({
      code,
      sections,
      sectionDetected:sections.length>0,
      rowCount:(data.rows||[]).length,
      warning:sections.length?null:'Bu ders için şube bilgisi AGUCAT kaynak verisinde doğrulanamadı.'
    });
  } catch(e) {
    console.error(e);
    res.status(502).json({error:'Şube bilgileri alınamadı.',detail:e?.message||String(e)});
  }
});

app.get('/api/debug', async (req,res)=>{
  const code=String(req.query.code||'').trim();
  if(!code) return res.status(400).json({error:'code parametresi gerekli. Örn: /api/debug?code=EE3999'});
  try {
    const data=await fetchRequestedLessons([{code,section:''}],code);
    res.json({diagnostics:data.diagnostics,debug:data.debug});
  } catch(e) { res.status(502).json({error:e?.message||String(e)}); }
});

app.post('/api/schedule',async(req,res)=>{
  try {
    const courses=(Array.isArray(req.body?.courses)?req.body.courses:[])
      .map(x=>({code:String(x.code||'').trim(),section:String(x.section||'').trim()})).filter(x=>x.code);
    if(!courses.length) return res.status(400).json({error:'En az bir ders kodu girin.'});
    if(courses.length>40) return res.status(400).json({error:'Tek sorguda en fazla 40 ders girilebilir.'});
    const data=await fetchRequestedLessons(courses);
    res.json({source:SOURCE_URL,fetchedAt:new Date().toISOString(),sourceHasSection:data.diagnostics.sectionDetected,warnings:data.warnings,notFound:data.notFound,rows:data.rows,diagnostics:data.diagnostics});
  } catch(e) {
    console.error(e);
    res.status(502).json({error:'AGÜ ders programı şu anda okunamadı.',detail:e?.message||String(e),hint:'cat.agu.edu.tr erişimini ve Playwright Chromium kurulumunu kontrol edin.'});
  }
});

app.listen(PORT,()=>console.log(`AGÜ Ders Programı v6: http://localhost:${PORT}`));
