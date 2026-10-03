const rowsEl = document.getElementById('courseRows');
const statusEl = document.getElementById('status');
const resultsEl = document.getElementById('results');
const warningsEl = document.getElementById('warnings');
const calendarEl = document.getElementById('calendar');
const summaryEl = document.getElementById('summary');

const defaultDays = ['Pazartesi','Salı','Çarşamba','Perşembe','Cuma'];
const dayAliases = {
  monday:'Pazartesi', pazartesi:'Pazartesi',
  tuesday:'Salı', sali:'Salı', salı:'Salı',
  wednesday:'Çarşamba', carsamba:'Çarşamba', çarşamba:'Çarşamba',
  thursday:'Perşembe', persembe:'Perşembe', perşembe:'Perşembe',
  friday:'Cuma', cuma:'Cuma', saturday:'Cumartesi', cumartesi:'Cumartesi', sunday:'Pazar', pazar:'Pazar'
};
const norm = s => String(s||'').toLocaleLowerCase('tr-TR').normalize('NFD').replace(/[\u0300-\u036f]/g,'');
const canonicalDay = d => dayAliases[norm(d)] || d;
const escapeHtml = (s='') => String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const normalizeCode = v => String(v||'').toUpperCase().replace(/\s+/g,'').trim();

function debounce(fn, ms=650){ let t; return (...args)=>{ clearTimeout(t); t=setTimeout(()=>fn(...args),ms); }; }

async function loadSectionsForRow(row){
  const codeInput=row.querySelector('.course-code');
  const sectionSelect=row.querySelector('.course-section');
  const hint=row.querySelector('.section-hint');
  const code=normalizeCode(codeInput.value);
  codeInput.value=code;
  sectionSelect.innerHTML='<option value="">Şube seçin</option>';
  sectionSelect.disabled=true;
  if(!code){ hint.textContent='Önce ders kodunu girin.'; hint.className='section-hint muted'; return; }

  hint.textContent='Şubeler getiriliyor…'; hint.className='section-hint loading';
  const requestId=String(Date.now())+Math.random(); row.dataset.requestId=requestId;
  try{
    const r=await fetch(`/api/sections?code=${encodeURIComponent(code)}`);
    const data=await r.json();
    if(row.dataset.requestId!==requestId) return;
    if(!r.ok) throw new Error(data.error||'Şubeler alınamadı.');
    const sections=data.sections||[];
    if(!sections.length){
      hint.textContent=data.warning||'Şube bilgisi bulunamadı.'; hint.className='section-hint error';
      return;
    }
    sectionSelect.innerHTML='<option value="">Şube seçin</option>'+sections.map(s=>`<option value="${escapeHtml(s)}">Şube ${escapeHtml(s)}</option>`).join('');
    sectionSelect.disabled=false;
    if(sections.length===1){ sectionSelect.value=sections[0]; hint.textContent='Tek şube bulundu ve otomatik seçildi.'; }
    else hint.textContent=`${sections.length} şube bulundu.`;
    hint.className='section-hint ok';
  }catch(e){
    if(row.dataset.requestId!==requestId) return;
    hint.textContent=e.message; hint.className='section-hint error';
  }
}

function addRow(code='', section=''){
  const row=document.createElement('div');
  row.className='course-row';
  row.innerHTML=`
    <div class="field-group">
      <label>Ders kodu</label>
      <input class="course-code" placeholder="Örn. EE3999" value="${escapeHtml(code)}" autocomplete="off" />
    </div>
    <div class="field-group">
      <label>Şube</label>
      <select class="course-section" disabled><option value="">Önce ders kodunu girin</option></select>
      <div class="section-hint muted">Önce ders kodunu girin.</div>
    </div>
    <button class="remove" title="Dersi sil" aria-label="Dersi sil">×</button>`;
  const delayed=debounce(()=>loadSectionsForRow(row),650);
  row.querySelector('.course-code').addEventListener('input',delayed);
  row.querySelector('.course-code').addEventListener('blur',()=>loadSectionsForRow(row));
  row.querySelector('.remove').onclick=()=>{ row.remove(); if(!rowsEl.children.length) addRow(); };
  rowsEl.appendChild(row);
  if(code){ loadSectionsForRow(row).then(()=>{ if(section) row.querySelector('.course-section').value=section; }); }
}

function readCourses(){
  return [...rowsEl.querySelectorAll('.course-row')].map(r=>({
    code:normalizeCode(r.querySelector('.course-code').value),
    section:r.querySelector('.course-section').value.trim()
  })).filter(x=>x.code);
}
function timeToMinutes(s){ const m=String(s||'').match(/(\d{1,2})[:.]?(\d{2})?/); return m?Number(m[1])*60+Number(m[2]||0):null; }
function formatMinutes(n){ return `${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`; }
function overlaps(a,b){
  if(canonicalDay(a.day)!==canonicalDay(b.day)) return false;
  const as=timeToMinutes(a.start),ae=timeToMinutes(a.end),bs=timeToMinutes(b.start),be=timeToMinutes(b.end);
  return ![as,ae,bs,be].some(v=>v===null) && as<be && bs<ae && !(a.code===b.code&&a.section===b.section);
}
function conflictSet(rows){ const set=new Set(); for(let i=0;i<rows.length;i++)for(let j=i+1;j<rows.length;j++)if(overlaps(rows[i],rows[j])){set.add(i);set.add(j)} return set; }
function renderWarnings(data){
  const messages=[...(data.warnings||[])];
  if(data.notFound?.length) messages.push('Bulunamayan dersler: '+data.notFound.map(x=>x.code+(x.section?` / Şube ${x.section}`:'')).join(', '));
  if(!messages.length){warningsEl.classList.add('hidden');return;}
  warningsEl.innerHTML='<strong>Notlar</strong><ul>'+messages.map(x=>`<li>${escapeHtml(x)}</li>`).join('')+'</ul>'; warningsEl.classList.remove('hidden');
}
function assignLanes(rows,days){
  const laneInfo=new Map();
  days.forEach(day=>{
    const dayRows=rows.map((r,i)=>({r,i,start:timeToMinutes(r.start),end:timeToMinutes(r.end)})).filter(x=>canonicalDay(x.r.day)===day&&x.start!==null&&x.end!==null).sort((a,b)=>a.start-b.start||a.end-b.end);
    const laneEnds=[];
    dayRows.forEach(x=>{ let lane=laneEnds.findIndex(end=>end<=x.start); if(lane<0){lane=laneEnds.length;laneEnds.push(x.end)}else laneEnds[lane]=x.end; laneInfo.set(x.i,{lane,lanes:1}); });
    const total=Math.max(1,laneEnds.length); dayRows.forEach(x=>laneInfo.get(x.i).lanes=total);
  }); return laneInfo;
}
function renderCalendar(rows,conflicts){
  calendarEl.innerHTML='';
  const valid=rows.filter(r=>timeToMinutes(r.start)!==null&&timeToMinutes(r.end)!==null&&canonicalDay(r.day));
  if(!valid.length){calendarEl.innerHTML='<div class="empty-state">Bu seçim için program kaydı bulunamadı.</div>';return;}
  const detectedDays=[...new Set(valid.map(r=>canonicalDay(r.day)))];
  const days=[...defaultDays]; ['Cumartesi','Pazar'].forEach(d=>{if(detectedDays.includes(d))days.push(d)}); detectedDays.forEach(d=>{if(!days.includes(d))days.push(d)});
  const boundaries=[...new Set(valid.flatMap(r=>[timeToMinutes(r.start),timeToMinutes(r.end)]))].sort((a,b)=>a-b);
  if(boundaries.length<2){calendarEl.innerHTML='<div class="empty-state">Program saat aralığı oluşturulamadı.</div>';return;}
  calendarEl.style.gridTemplateColumns=`90px repeat(${days.length}, minmax(150px, 1fr))`; calendarEl.style.gridTemplateRows=`52px repeat(${boundaries.length-1}, minmax(38px, auto))`;
  const corner=document.createElement('div'); corner.className='cal-head corner';corner.textContent='Saat';corner.style.gridColumn='1';corner.style.gridRow='1';calendarEl.appendChild(corner);
  days.forEach((d,idx)=>{const e=document.createElement('div');e.className='cal-head';e.textContent=d;e.style.gridColumn=String(idx+2);e.style.gridRow='1';calendarEl.appendChild(e)});
  for(let i=0;i<boundaries.length-1;i++){
    const tc=document.createElement('div');tc.className='time-cell';tc.innerHTML=`<strong>${formatMinutes(boundaries[i])}</strong><span>${formatMinutes(boundaries[i+1])}</span>`;tc.style.gridColumn='1';tc.style.gridRow=String(i+2);calendarEl.appendChild(tc);
    days.forEach((_,didx)=>{const bg=document.createElement('div');bg.className='day-cell';bg.style.gridColumn=String(didx+2);bg.style.gridRow=String(i+2);calendarEl.appendChild(bg)});
  }
  const lanes=assignLanes(valid,days);
  valid.forEach((r,visibleIndex)=>{
    const originalIndex=rows.indexOf(r),day=canonicalDay(r.day),dayIndex=days.indexOf(day),startIndex=boundaries.indexOf(timeToMinutes(r.start)),endIndex=boundaries.indexOf(timeToMinutes(r.end));
    if(dayIndex<0||startIndex<0||endIndex<=startIndex)return;
    const info=lanes.get(visibleIndex)||{lane:0,lanes:1}; const ev=document.createElement('div');ev.className='event'+(conflicts.has(originalIndex)?' conflict':'');ev.style.gridColumn=String(dayIndex+2);ev.style.gridRow=`${startIndex+2} / ${endIndex+2}`;ev.style.setProperty('--lane',info.lane);ev.style.setProperty('--lanes',info.lanes);
    ev.innerHTML=`<div class="event-code">${escapeHtml(r.code)}${r.section?` <span>Şube ${escapeHtml(r.section)}</span>`:''}</div><div class="event-time">${escapeHtml(r.start)} – ${escapeHtml(r.end)}</div><div class="event-room">${escapeHtml(r.room||'Derslik belirtilmemiş')}</div>${r.instructor?`<div class="event-instructor">${escapeHtml(r.instructor)}</div>`:''}${conflicts.has(originalIndex)?'<div class="conflict-badge">⚠ Çakışma</div>':''}`;
    calendarEl.appendChild(ev);
  });
}

async function loadSchedule(){
  const courses=readCourses();
  if(!courses.length){statusEl.textContent='En az bir ders kodu girin.';return;}
  const missing=courses.filter(x=>!x.section);
  if(missing.length){statusEl.textContent='Lütfen her ders için bir şube seçin.';return;}
  statusEl.textContent='Program hazırlanıyor…';resultsEl.classList.add('hidden');warningsEl.classList.add('hidden');document.getElementById('loadBtn').disabled=true;
  try{
    const r=await fetch('/api/schedule',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({courses})}); const data=await r.json();
    if(!r.ok) throw new Error(data.error+(data.detail?` — ${data.detail}`:''));
    const rows=data.rows||[],conflicts=conflictSet(rows);renderWarnings(data);renderCalendar(rows,conflicts);
    summaryEl.textContent=`${new Set(rows.map(x=>x.code)).size} ders · ${rows.length} oturum${conflicts.size?` · ${conflicts.size} çakışan oturum`:''}`;resultsEl.classList.remove('hidden');statusEl.textContent='Program hazır.';
  }catch(e){statusEl.textContent='Hata: '+e.message;} finally{document.getElementById('loadBtn').disabled=false;}
}

document.getElementById('addRow').onclick=()=>addRow();
document.getElementById('loadBtn').onclick=loadSchedule;
document.getElementById('clearBtn').onclick=()=>{rowsEl.innerHTML='';addRow();resultsEl.classList.add('hidden');warningsEl.classList.add('hidden');statusEl.textContent='';};
document.getElementById('printBtn').onclick=()=>window.print();
addRow();
