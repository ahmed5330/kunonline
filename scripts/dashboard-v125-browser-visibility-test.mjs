import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

const js=readFileSync('public/v2/modules-v125-dashboard-section-periods.js','utf8');
const chrome=[
  process.env.CHROME_PATH,'/usr/bin/google-chrome','/usr/bin/google-chrome-stable',
  '/usr/bin/chromium','/usr/bin/chromium-browser'
].find(p=>p&&existsSync(p));
assert.ok(chrome,'Chromium is required to verify actual visible date filters');
const dir=mkdtempSync(join(tmpdir(),'kun-dashboard-dates-'));
try{
  const html=`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
    *{box-sizing:border-box}body{margin:0;direction:rtl;font-family:Arial}
    #root{width:min(880px,calc(100vw - 32px));margin:auto}
    .v33-dashboard{display:grid;gap:12px}
    .dash-section{border:1px solid #ddd;padding:15px;background:#fff}
    .dash-section-head,.dash-f126-headline{display:flex;justify-content:space-between}
    .dash-section-actions{display:flex}
  </style></head><body><nav class="nav"><button class="active" data-view="dashboard">داشبورد</button></nav>
  <div id="root"><div class="v33-dashboard">
  <section class="dash-section" id="finance" data-dash-section="finance"><div class="dash-section-head"><div><h2>المالية</h2></div><div class="dash-section-actions"><button>↻</button></div></div><div>بطاقات مالية</div></section>
  <section class="dash-section" id="ads" data-dash-section="ads"><div class="dash-section-head"><div><h2>الإعلانات</h2></div></div><div>بطاقات إعلانية</div></section>
  <section class="dash-section dash-f126" id="summary" data-dashboard-finance-top="126"><div class="dash-f126-headline"><h2>ملخص الأداء</h2></div><div>أهم المؤشرات</div></section>
  </div></div><output id="test-result"></output>
  <script>window.KunDashboardPeriodsProvinceV124={selected:()=>'today',rangeForPreset:()=>({from:'2026-10-12',to:'2026-10-12'}),apply:()=>{}};</script>
  <script>${js}</script>
  <script>
  setTimeout(()=>{
    const results={};
    const isVisible=(id)=>{
      const section=document.getElementById(id);
      const bar=section?.querySelector(':scope > .dash-v125-period-bar');
      const select=bar?.querySelector('select[data-v125-period]');
      if(!bar||!select)return false;
      const bounds=bar.getBoundingClientRect(),parent=section.getBoundingClientRect();
      const cs=getComputedStyle(bar);
      return cs.display!=='none'&&bounds.width>150&&bounds.height>=35
        &&bounds.left>=parent.left-1&&bounds.right<=parent.right+1
        &&select.getBoundingClientRect().height>20
        &&section.firstElementChild===bar;
    };
    results.finance=isVisible('finance');
    results.ads=isVisible('ads');
    results.summary=isVisible('summary');
    document.querySelector('.nav button').classList.remove('active');
    document.querySelector('#finance .dash-v125-period-bar')?.remove();
    window.KunDashboardSectionPeriodsV125.refresh();
    results.navigationIndependence=isVisible('finance');
    results.count=document.querySelectorAll('.dash-v125-period-bar').length;
    results.noDocumentOverflow=document.documentElement.scrollWidth<=window.innerWidth+1;
    results.ok=results.finance&&results.ads&&results.summary&&results.navigationIndependence&&results.count===3&&results.noDocumentOverflow;
    document.getElementById('test-result').textContent=JSON.stringify(results);
  },750);
  </script></body></html>`;
  const file=join(dir,'index.html');writeFileSync(file,html);
  const r=spawnSync(chrome,['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--no-first-run','--virtual-time-budget=1700','--window-size=1191,841','--dump-dom','file://'+file],{encoding:'utf8',timeout:35000,maxBuffer:2_000_000});
  assert.equal(r.status,0,`Chromium did not complete visibility QA: ${r.stderr?.slice(-1200)}`);
  const match=r.stdout.match(/<output id="test-result">([^<]*)<\/output>/);
  assert.ok(match,'Chromium did not execute dashboard date bar mounting');
  const results=JSON.parse(match[1].replace(/&quot;/g,'"'));
  assert.ok(results.ok,`Visible date selector fixture failed: ${JSON.stringify(results)}`);
  console.log('Dashboard v125 real-browser date bar visibility: '+JSON.stringify(results));
}finally{rmSync(dir,{recursive:true,force:true});}
