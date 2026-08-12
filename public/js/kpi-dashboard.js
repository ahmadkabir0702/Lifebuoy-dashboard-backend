/**
 * Lifebuoy BW – Campaign KPI Dashboard (v2)
 * Adds: own campaign/month/type filters at top of KPI tab
 * Place in public/js/ and load after dashboard.js
 */

// ── Utility ───────────────────────────────────────────────────────────────────
const kpi = {
  instances: {},
  destroyAll() { Object.values(this.instances).forEach(c => { try { c.destroy(); } catch(e){} }); this.instances = {}; },
  make(id, type, data, options = {}) {
    try {
      if (this.instances[id]) { this.instances[id].destroy(); delete this.instances[id]; }
      const el = document.getElementById(id);
      if (!el) return;
      this.instances[id] = new Chart(el, { type, data, options });
    } catch(e) { console.warn('Chart error', id, e); }
  },
  isDark: () => false,
  colors() {
    return {
      grid:  '#DCDCE6',   // line-200
      tick:  '#6B6B90',   // ink-400
      text:  '#5A5A85',   // ink-500
      navy:  '#000050',
      violet:'#000050',
      violet400:'#5A5A9E',
      aqua:  '#000050',
      aquaDeep:'#04785C',
      neutral:'#8A8ABF',
      crimson:'#A32040'
    };
  },

  scaleDefaults(c) { return { grid: { color: c.grid }, ticks: { color: c.tick, font: { size: 11 } } }; },
  legendDefaults(c) { return { labels: { color: c.text, font: { size: 11 }, boxWidth: 10, padding: 10 } }; },
  safeNum(v) {
    if (typeof v === 'number' && !isNaN(v)) return v;
    const n = parseFloat(String(v || '').replace(/[^0-9.-]+/g, ''));
    return isNaN(n) ? 0 : n;
  },
  avg(arr, key) {
    const vals = arr.map(d => this.safeNum(d[key])).filter(n => n > 0);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
  },
  fmtMoney(n) { if (!n) return '$0'; if (n>=1e6) return 'Rs'+(n/1e6).toFixed(2)+'M'; if (n>=1e3) return 'Rs'+(n/1e3).toFixed(1)+'K'; return 'Rs'+n.toFixed(2); },
  fmtNum(n)   { if (!n) return '0'; if (n>=1e6) return (n/1e6).toFixed(1)+'M'; if (n>=1e3) return (n/1e3).toFixed(0)+'K'; return String(Math.round(n)); },
  pct(v)      { return (v||0).toFixed(1)+'%'; },
};

// ── Filter state (KPI tab owns its own filters) ───────────────────────────────
const kpiFilters = { campaign: 'all', month: 'all', type: 'all' };

function kpiFilteredData() {
  let data = typeof ALL !== 'undefined' ? ALL : [];
  if (kpiFilters.campaign !== 'all') data = data.filter(d => d.campaign === kpiFilters.campaign);
  if (kpiFilters.month    !== 'all') data = data.filter(d => d.month    === kpiFilters.month);
  if (kpiFilters.type     !== 'all') data = data.filter(d => d.type     === kpiFilters.type);
  return data;
}

function kpiFilteredContent() {
  let data = typeof ALL !== 'undefined' ? ALL : [];
  if (kpiFilters.campaign !== 'all') data = data.filter(d => d.campaign === kpiFilters.campaign);
  if (kpiFilters.month    !== 'all') data = data.filter(d => d.month    === kpiFilters.month);
  if (kpiFilters.type     !== 'all') data = data.filter(d => d.type     === kpiFilters.type);
  return data;
}

function applyKpiFilter(key, value) {
  kpiFilters[key] = value;
  // Re-render only sections 1-4 (not the shell/filters bar)
  kpi.destroyAll();
  const allData    = kpiFilteredData();
  const allContent = kpiFilteredContent();
  const accOverview = typeof ACCOUNT_OVERVIEW !== 'undefined' ? ACCOUNT_OVERVIEW : [];
  renderSection1(accOverview, allData, allContent);
  renderSection2(allData, allContent);
  renderSection3(allContent);
  renderSection4(allData);
  // Update active pill styles. Each pill reflects its OWN group's current
  // value — comparing against the key just clicked would clear every other group.
  document.querySelectorAll('[data-kfi]').forEach(el => {
    el.classList.toggle('kfi-active', kpiFilters[el.dataset.kfk] === el.dataset.kfv);
  });
}

// ── Main render entry ─────────────────────────────────────────────────────────
function renderKPIDashboard() {
  const page = document.getElementById('page-kpi');
  if (!page || page.classList.contains('hidden')) return;
  kpi.destroyAll();

  const allData    = kpiFilteredData();
  const allContent = kpiFilteredContent();
  const accOverview = typeof ACCOUNT_OVERVIEW !== 'undefined' ? ACCOUNT_OVERVIEW : [];

  renderKPIShell(page);
  renderKPIFilters();
  renderSection1(accOverview, allData, allContent);
  renderSection2(allData, allContent);
  renderSection3(allContent);
  renderSection4(allData);
}

function renderKpiTab(filteredData) { renderKPIDashboard(); }

// ── Filters bar ───────────────────────────────────────────────────────────────
function renderKPIFilters() {
  const wrap = document.getElementById('kpi-filters-bar');
  if (!wrap) return;

  const allData    = typeof ALL         !== 'undefined' ? ALL         : [];
  const allContent = typeof ALL !== 'undefined' ? ALL : [];

  const campaigns = ['all', ...new Set([...allData, ...allContent].map(d => d.campaign).filter(Boolean)).values()].sort();
  const months    = ['all', ...new Set([...allData, ...allContent].map(d => d.month).filter(Boolean)).values()].sort()
                      .filter(m => m !== 'Unknown');
  const types     = ['all', 'Brand Say', 'Others Say'];

  const pillGroup = (key, values, labels) => `
    <div class="kfi-group">
      <span class="kfi-label">${key === 'campaign' ? 'Campaign' : key === 'month' ? 'Month' : 'Content type'}</span>
      <div class="kfi-pills">
        ${values.map((v, i) => `
          <button class="kfi-pill ${kpiFilters[key] === v ? 'kfi-active' : ''}"
            data-kfi data-kfk="${key}" data-kfv="${v}"
            onclick="applyKpiFilter('${key}','${v}')">
            ${v === 'all' ? 'All' : (labels ? labels[i] : v)}
          </button>`).join('')}
      </div>
    </div>`;

  // Campaign grows with every new campaign, so it is a select rather
  // than a pill row. Month and type stay as pills — short, fixed lists.
  const selectGroup = (key, values, label, allLabel) => `
    <div class="kfi-group">
      <span class="kfi-label">${label}</span>
      <select class="kfi-select" id="kfi-${key}" onchange="applyKpiFilter('${key}', this.value)">
        ${values.map(v => `
          <option value="${v}"${kpiFilters[key] === v ? ' selected' : ''}>
            ${v === 'all' ? allLabel : v}
          </option>`).join('')}
      </select>
    </div>`;

  wrap.innerHTML =
    selectGroup('campaign', campaigns, 'Campaign', 'All campaigns') +
    pillGroup('month',    months) +
    pillGroup('type',     types);

  // The bar is rebuilt from scratch on every render, so the select is a new
  // element each time and has to be re-enhanced.
  if (typeof enhanceSelectsIn === 'function') enhanceSelectsIn(wrap);
}
// ── Shell ─────────────────────────────────────────────────────────────────────
function renderKPIShell(page) {
  page.innerHTML = `
    <style>
      /* Campaign KPIs — aligned to the v2 system used by Creative Hub.
         Sentence case, 400/500 weights, borderless white on the canvas. */
      #page-kpi { padding: 0; }

      /* Section titles */
      .kpi-section-title {
        font: 500 18px/26px var(--font, 'Rubik', sans-serif);
        letter-spacing: 0; text-transform: none; color: var(--ink-900, #1A1A4F);
        margin: 32px 0 14px;
      }
      .kpi-section-title:first-of-type { margin-top: 0; }
      .kpi-section-title::after { content: none; }

      /* Stat cards */
      .kpi-stat-row { display: grid; gap: 14px; margin-bottom: 20px; }
      .kpi-stat-row.cols-5 { grid-template-columns: repeat(5, 1fr); }
      .kpi-stat-row.cols-4 { grid-template-columns: repeat(4, 1fr); }

      .ks { background: #fff; border: 0; border-radius: 8px; padding: 18px 20px; position: relative; }
      .ks::before { content: none; }
      .ks-label { font: 400 13px/18px var(--font, 'Rubik', sans-serif); text-transform: none;
        letter-spacing: 0; color: var(--ink-600, #4A4A75); margin-bottom: 8px; }
      .ks-val { font: 400 28px/34px var(--font, 'Rubik', sans-serif); letter-spacing: 0;
        color: var(--ink-900, #1A1A4F); font-variant-numeric: tabular-nums; }
      .ks-sub { font: 400 13px/19px var(--font, 'Rubik', sans-serif); color: var(--ink-600, #4A4A75); margin-top: 4px; }
      .ks-prog-track { height: 4px; background: #EAEFF3; border-radius: 3px; margin-top: 12px; overflow: hidden; }
      .ks-prog-fill  { height: 4px; border-radius: 3px; background: var(--kpi-accent, #000050); transition: width .4s; }

      /* Chart cards */
      .kpi-chart-row { display: grid; gap: 14px; margin-bottom: 14px; }
      .kpi-chart-row.cols-2 { grid-template-columns: 1fr 1fr; }
      .kpi-chart-row.cols-1 { grid-template-columns: 1fr; }

      .kc { background: #fff; border: 0; border-radius: 8px; padding: 20px; }
      .kc-title { font: 500 15px/22px var(--font, 'Rubik', sans-serif); color: var(--ink-900, #1A1A4F);
        margin-bottom: 16px; display: flex; align-items: center; gap: 8px; }
      .kc-title .kc-badge { font: 400 12px/1 var(--font, 'Rubik', sans-serif); padding: 3px 8px;
        border-radius: 999px; background: #F4F6F8; color: var(--ink-600, #4A4A75); }
      .kc-wrap { position: relative; height: 230px; }
      .kc-wrap.tall { height: 290px; }

      /* Creator table */
      .creator-leaderboard { width: 100%; border-collapse: collapse; }
      .creator-leaderboard th { text-align: left; padding: 11px 12px;
        font: 400 13px/18px var(--font, 'Rubik', sans-serif); text-transform: none; letter-spacing: 0;
        color: var(--ink-600, #4A4A75); border-bottom: 1px solid #DCDCE6; }
      .creator-leaderboard td { padding: 11px 12px; border-bottom: 1px solid #EDEDF2; vertical-align: middle;
        font: 400 14px/20px var(--font, 'Rubik', sans-serif); color: var(--ink-700, #33335F); }
      .creator-leaderboard tr:hover td { background: #F4F6F8; }
      .creator-leaderboard tr:last-child td { border-bottom: none; }
      .cl-rank { font: 400 14px var(--font, 'Rubik', sans-serif); color: var(--ink-400, #6B6B90);
        font-variant-numeric: tabular-nums; }
      .cl-rank.gold, .cl-rank.silver, .cl-rank.bronze { color: var(--ink-900, #1A1A4F); font-weight: 500; }
      .cl-name { font-weight: 500; font-size: 14px; color: var(--ink-900, #1A1A4F); }
      .cl-name a { color: var(--ink-900, #1A1A4F); text-decoration: none; border-bottom: 1px solid #DCDCE6; }
      .cl-name a:hover { border-bottom-color: var(--ink-400, #6B6B90); }
      .cl-platform-pills { display: flex; gap: 5px; flex-wrap: wrap; }
      .cl-pill { font: 500 11px/1 var(--font, 'Rubik', sans-serif); padding: 4px 8px; border-radius: 999px; }
      .cl-pill.ig { background: #FDEBF3; color: #B32567; }
      .cl-pill.tt { background: #FFE9EF; color: #C4003C; }
      .cl-pill.fb { background: #E9EEF9; color: #12509E; }
      .cl-bar-wrap { display: flex; align-items: center; gap: 8px; }
      .cl-bar-track { flex: 1; height: 5px; background: #EAEFF3; border-radius: 3px; overflow: hidden; }
      .cl-bar-fill { height: 5px; border-radius: 3px; }
      .cl-val { font: 400 13px var(--font, 'Rubik', sans-serif); min-width: 44px; text-align: right;
        font-variant-numeric: tabular-nums; color: var(--ink-900, #1A1A4F); }
      .cqr-mini-bar { display: flex; height: 6px; border-radius: 3px; overflow: hidden; width: 88px; gap: 1px; }
      .cqr-mini-bar div { border-radius: 2px; }

      /* Duration grid */

      /* Platform table */
      .plat-table { width: 100%; border-collapse: collapse; }
      .plat-table th { text-align: center; padding: 11px 12px;
        font: 400 13px/18px var(--font, 'Rubik', sans-serif); text-transform: none; letter-spacing: 0;
        color: var(--ink-600, #4A4A75); border-bottom: 1px solid #DCDCE6; }
      .plat-table th:first-child { text-align: left; }
      .plat-table td { padding: 11px 12px; border-bottom: 1px solid #EDEDF2; text-align: center;
        font: 400 14px/20px var(--font, 'Rubik', sans-serif); color: var(--ink-900, #1A1A4F);
        font-variant-numeric: tabular-nums; }
      .plat-table td:first-child { text-align: left; font-weight: 500; }
      .plat-table tr:last-child td { border-bottom: none; }
      .plat-win  { color: #04785C; font-weight: 500; }
      .plat-lose { color: var(--ink-400, #6B6B90); }

      @media (max-width: 1200px) {
        .kpi-stat-row.cols-5 { grid-template-columns: repeat(3, 1fr); }
      }
      @media (max-width: 800px) {
        .kpi-stat-row.cols-5, .kpi-stat-row.cols-4 { grid-template-columns: 1fr 1fr; }
        .kpi-chart-row.cols-2 { grid-template-columns: 1fr; }
      }
    </style>


    <!-- S1 -->
    <div class="kpi-section-title">Executive Summary</div>
    <div class="kpi-stat-row cols-5" id="kpi-s1-budget"></div>

    <!-- S2 -->
    <div class="kpi-section-title">Content Breakdown</div>
    <div class="kpi-stat-row cols-4" id="kpi-s2-pipeline"></div>
    <div class="kpi-chart-row cols-2">
      <div class="kc">
        <div class="kc-title">Performance Head-to-Head <span class="kc-badge">Paid Avg</span></div>
        <div class="kc-wrap"><canvas id="chart-head2head"></canvas></div>
      </div>
      <div class="kc">
        <div class="kc-title">Spend by CQR <span class="kc-badge">Media Waste</span></div>
        <div class="kc-wrap"><canvas id="chart-cqr-spend"></canvas></div>
      </div>
    </div>

    <!-- S3 -->
    <div class="kpi-section-title">Creator Content</div>
    <div class="kpi-stat-row cols-4" id="creator-summary-tiles"></div>
    <div class="kpi-chart-row cols-2">
      <div class="kc">
        <div class="kc-title">Creator vs Brand Say <span class="kc-badge">CQR mix</span></div>
        <div class="kc-wrap"><canvas id="chart-cr-vs-bs"></canvas></div>
      </div>
      <div class="kc">
        <div class="kc-title">Signal comparison <span class="kc-badge">Hook, hold, watch time</span></div>
        <div class="kc-wrap"><canvas id="chart-cr-signals"></canvas></div>
      </div>
    </div>
    <div style="margin:-8px 0 28px">
      <button class="kpi-tab-btn" onclick="setNav('creators')">Open Creators →</button>
    </div>

    <!-- S4 -->
    <div class="kpi-section-title">Paid Platform Efficiency</div>
    <div class="kpi-chart-row cols-2">
      <div class="kc">
        <div class="kc-title">Cost Efficiency <span class="kc-badge">CPM by Reach &amp; Impressions</span></div>
        <div class="kc-wrap"><canvas id="chart-cost-eff"></canvas></div>
      </div>
      <div class="kc">
        <div class="kc-title">Attention Metrics <span class="kc-badge">Watch Time &amp; VTR%</span></div>
        <div class="kc-wrap"><canvas id="chart-attention"></canvas></div>
      </div>
    </div>
    <div class="kpi-chart-row cols-1">
      <div class="kc">
        <div class="kc-title">Platform Comparison Table <span class="kc-badge">Meta vs TikTok</span></div>
        <div id="plat-table-wrap"></div>
      </div>
    </div>
  `;
}

// ── Section 1 ─────────────────────────────────────────────────────────────────
function renderSection1(accOverview, allData, allContent) {
  const actRow = accOverview[0] || {};
  const totalSpend = kpi.safeNum(actRow.actSpend)  || allData.reduce((s,d) => s+(d.spend||0), 0);
  const totalReach = kpi.safeNum(actRow.actReach)  || allData.reduce((s,d) => s+(d.reach||0), 0);
  const totalImpr  = kpi.safeNum(actRow.actImpressions) || allData.reduce((s,d) => s+(d.impressions||0), 0);
  const frequency  = kpi.safeNum(actRow.actFrequency)   || (totalReach ? (totalImpr/totalReach).toFixed(2) : 0);
  const kpiSpend   = kpi.safeNum(actRow.kpiSpend);
  const kpiReach   = kpi.safeNum(actRow.kpiReach);
  const kpiImpr    = kpi.safeNum(actRow.kpiImpressions);

  const spendPct = kpiSpend ? Math.min(100, totalSpend/kpiSpend*100) : null;
  const reachPct = kpiReach ? Math.min(100, totalReach/kpiReach*100) : null;
  const imprPct  = kpiImpr  ? Math.min(100, totalImpr /kpiImpr *100) : null;
  const budgetColor = spendPct===null ? '#6B6B90' : spendPct>90 ? '#A32040' : spendPct>70 ? '#8A5A12' : '#04785C';

  const card = (label, actual, target, pct, fmt, accent) => `
    <div class="ks" style="--kpi-accent:${accent}">
      <div class="ks-label">${label}</div>
      <div class="ks-val">${fmt(actual)}</div>
      ${pct!==null
        ? `<div class="ks-sub">${target?'KPI: '+fmt(target):'No KPI'} · ${pct.toFixed(0)}% achieved</div>
           <div class="ks-prog-track"><div class="ks-prog-fill" style="width:${pct}%"></div></div>`
        : `<div class="ks-sub">No KPI target set</div>`}
    </div>`;

  document.getElementById('kpi-s1-budget').innerHTML =
    card('Budget Spend', totalSpend, kpiSpend, spendPct, kpi.fmtMoney, budgetColor) +
    card('Reach',        totalReach, kpiReach, reachPct, kpi.fmtNum,   '#000050') +
    card('Impressions',  totalImpr,  kpiImpr,  imprPct,  kpi.fmtNum,   '#5A5A9E') +
    card('Frequency', parseFloat(frequency)||0, kpi.safeNum(actRow.kpiFrequency)||null, kpi.safeNum(actRow.kpiFrequency) ? Math.min(100, (parseFloat(frequency)||0) / kpi.safeNum(actRow.kpiFrequency) * 100) : null, v=>(v||0).toFixed(2)+'x', '#8A5A12') +
    `<div class="ks" style="--kpi-accent:#04785C">
      <div class="ks-label">Active Assets</div>
      <div class="ks-val" style="color:#04785C">${allData.filter(d=>d.adStatus==='ACTIVE').length}</div>
      <div class="ks-sub">of ${allData.length} in filter</div>
    </div>`;
}

// ── Section 2 ─────────────────────────────────────────────────────────────────
function renderSection2(allData, allContent) {
  const co = kpi.colors();
  const bsCount  = allContent.filter(d=>d.type==='Brand Say').length;
  const osCount  = allContent.filter(d=>d.type==='Others Say').length;
  const origAssets = allContent.filter(d=>!d.isRepurposed).length;
  const repAssets  = allContent.filter(d=>d.isRepurposed).length;

  document.getElementById('kpi-s2-pipeline').innerHTML = `
    <div class="ks" style="--kpi-accent:#000050">
      <div class="ks-label">Brand Say Assets</div>
      <div class="ks-val" style="color:#000050">${bsCount}</div>
      <div class="ks-sub">${allContent.length?Math.round(bsCount/allContent.length*100):0}% of pipeline</div>
    </div>
    <div class="ks" style="--kpi-accent:#5A5A9E">
      <div class="ks-label">Others Say Assets</div>
      <div class="ks-val" style="color:#5A5A9E">${osCount}</div>
      <div class="ks-sub">${allContent.length?Math.round(osCount/allContent.length*100):0}% of pipeline</div>
    </div>
    <div class="ks" style="--kpi-accent:#04785C">
      <div class="ks-label">Original Assets</div>
      <div class="ks-val">${origAssets}</div>
      <div class="ks-sub">New content</div>
    </div>
    <div class="ks" style="--kpi-accent:#8A5A12">
      <div class="ks-label">Repurposed Assets</div>
      <div class="ks-val">${repAssets}</div>
      <div class="ks-sub">${allContent.length?Math.round(repAssets/allContent.length*100):0}% repurpose rate</div>
    </div>`;

  const durTiers = [
    { label:'< 10s',  min:0,  max:10 },
    { label:'10–14s', min:10, max:15 },
    { label:'15–59s', min:15, max:60 },
    { label:'60s+',   min:60, max:Infinity },
  ];

  kpi.make('chart-head2head','bar',{
    labels:['Avg Hook Rate','Avg VTR %','Avg Watch Time'],
    datasets:[
      {label:'Brand Say',  data:[kpi.avg(bsData,'hookRate'),kpi.avg(bsData,'vtr'),kpi.avg(bsData,'watchTime')], backgroundColor:'#000050',borderRadius:0},
      {label:'Others Say', data:[kpi.avg(osData,'hookRate'),kpi.avg(osData,'vtr'),kpi.avg(osData,'watchTime')], backgroundColor:'#5A5A9E',borderRadius:0},
    ]
  },{responsive:true,maintainAspectRatio:false,plugins:{legend:kpi.legendDefaults(co)},scales:{y:{...kpi.scaleDefaults(co),beginAtZero:true},x:{...kpi.scaleDefaults(co)}}});

  const cqrSpend={Good:0,Average:0,Poor:0,Invalid:0};
  allData.forEach(d=>{if(cqrSpend[d.cqr]!==undefined) cqrSpend[d.cqr]+=(d.spend||0);});
  // Spend by CQR as a single 100% stacked bar rather than a donut.
  // Comparing arc lengths is unreliable; segment widths on one axis are
  // directly comparable and take a third of the vertical space.
  const totalCqrSpend = cqrSpend.Good + cqrSpend.Average + cqrSpend.Poor + cqrSpend.Invalid;
  const pctOf = v => totalCqrSpend ? v / totalCqrSpend * 100 : 0;
  kpi.make('chart-cqr-spend','bar',{
    labels:['Spend'],
    datasets:[
      {label:'Good',   data:[pctOf(cqrSpend.Good)],    backgroundColor:'#04785C'},
      {label:'Average',data:[pctOf(cqrSpend.Average)], backgroundColor:'#8A5A12'},
      {label:'Poor',   data:[pctOf(cqrSpend.Poor)],    backgroundColor:'#A32040'},
      {label:'Invalid',data:[pctOf(cqrSpend.Invalid)], backgroundColor:'#6B6B90'}
    ]
  },{responsive:true,maintainAspectRatio:false,indexAxis:'y',
     plugins:{legend:{...kpi.legendDefaults(co),position:'bottom'},
       tooltip:{callbacks:{label:ctx=>{
         const raw={Good:cqrSpend.Good,Average:cqrSpend.Average,Poor:cqrSpend.Poor,Invalid:cqrSpend.Invalid}[ctx.dataset.label];
         return ` ${ctx.dataset.label}: ${kpi.fmtMoney(raw)} (${ctx.raw.toFixed(0)}%)`;
       }}}},
     scales:{x:{...kpi.scaleDefaults(co),stacked:true,max:100,
                ticks:{...kpi.scaleDefaults(co).ticks,callback:v=>v+'%'}},
             y:{...kpi.scaleDefaults(co),stacked:true,grid:{display:false}}}});
}

// ── Section 3 ─────────────────────────────────────────────────────────────────
function renderSection3(allContent) {
  const co = kpi.colors();
  const os = allContent.filter(d => d.type === 'Others Say' && d.creatorProfile);
  const bs = allContent.filter(d => d.type === 'Brand Say');

  const tiles = document.getElementById('creator-summary-tiles');

  if (os.length === 0) {
    if (tiles) tiles.innerHTML =
      `<div class="organic-empty">No creator content in this selection.</div>`;
    return;
  }

  // Organic CQR is the primary measure here. It is a composite of both
  // signals rather than hook rate alone, and unlike paid CQR it does not
  // depend on creative_id matching, so it is populated today.
  const orgCqr = (arr) => {
    const t = { Good: 0, Average: 0, Poor: 0 };
    arr.forEach(d => ['igOrganic','fbOrganic','ttOrganic'].forEach(k => {
      const o = d[k]; if (o && t[o.cqr] !== undefined) t[o.cqr]++;
    }));
    return t;
  };
  const views = (arr) => arr.reduce((s2, d) => s2 +
    ((d.igOrganic?.views || 0) + (d.ttOrganic?.views || 0) +
     (d.fbOrganic?.videoViews || d.fbOrganic?.views || 0)), 0);

  const osC = orgCqr(os), bsC = orgCqr(bs);
  const osScored = osC.Good + osC.Average + osC.Poor;
  const bsScored = bsC.Good + bsC.Average + bsC.Poor;
  const osValid = osScored ? (osC.Good + osC.Average) / osScored * 100 : null;
  const bsValid = bsScored ? (bsC.Good + bsC.Average) / bsScored * 100 : null;

  const osViews = views(os), bsViews = views(bs);
  const share = (osViews + bsViews) ? osViews / (osViews + bsViews) * 100 : 0;

  // Best creator by organic CQR, then views as the tie-break — ranking on
  // views alone rewards reach rather than quality.
  const byCreator = {};
  os.forEach(d => {
    const info = (typeof extractCreatorInfo === 'function')
      ? extractCreatorInfo(d.creatorProfile, d.ttLink) : null;
    const n = (info && info.username) || d.creatorProfile;
    if (!n) return;
    if (!byCreator[n]) byCreator[n] = { name: n, good: 0, scored: 0, views: 0 };
    ['igOrganic','fbOrganic','ttOrganic'].forEach(k => {
      const o = d[k]; if (!o || !o.cqr) return;
      byCreator[n].scored++;
      if (o.cqr === 'Good') byCreator[n].good++;
      byCreator[n].views += o.views || o.videoViews || 0;
    });
  });
  const ranked = Object.values(byCreator)
    .filter(c => c.scored > 0)
    .sort((a, b) => (b.good / b.scored) - (a.good / a.scored) || b.views - a.views);
  const top = ranked[0];

  const creators = Object.keys(byCreator).length;

  const tile = (label, val, sub, colour) => `
    <div class="ks">
      <div class="ks-title">${label}</div>
      <div class="ks-value"${colour ? ` style="color:${colour}"` : ''}>${val}</div>
      <div class="ks-sub">${sub}</div>
    </div>`;

  const deltaTxt = (osValid !== null && bsValid !== null)
    ? ((osValid - bsValid >= 0 ? '+' : '') + (osValid - bsValid).toFixed(0) + 'pt')
    : '—';
  const deltaCol = (osValid !== null && bsValid !== null)
    ? (osValid >= bsValid ? '#04785C' : '#A32040') : null;

  if (tiles) tiles.innerHTML =
    tile('Creator Share of Views', share.toFixed(0) + '%',
         `${kpi.fmtNum(osViews)} of ${kpi.fmtNum(osViews + bsViews)} organic views`) +
    tile('Validated', osValid !== null ? osValid.toFixed(0) + '%' : '—',
         `${osC.Good} Good · ${osC.Average} Average · ${osC.Poor} Poor`) +
    tile('vs Brand Say', deltaTxt,
         bsValid !== null ? `Owned content validates at ${bsValid.toFixed(0)}%` : 'No owned content scored',
         deltaCol) +
    tile('Top Creator', top ? top.name : '—',
         top ? `${Math.round(top.good / top.scored * 100)}% Good · ${kpi.fmtNum(top.views)} views`
             : `${creators} creators active`);

  // CQR mix, creator against owned — the holistic comparison
  kpi.make('chart-cr-vs-bs', 'bar', {
    labels: ['Creator', 'Brand Say'],
    datasets: [
      { label: 'Good',    data: [osC.Good, bsC.Good],       backgroundColor: '#04785C' },
      { label: 'Average', data: [osC.Average, bsC.Average], backgroundColor: '#8A5A12' },
      { label: 'Poor',    data: [osC.Poor, bsC.Poor],       backgroundColor: '#A32040' }
    ]
  }, { responsive: true, maintainAspectRatio: false, indexAxis: 'y',
       plugins: { legend: kpi.legendDefaults(co) },
       scales: { x: { ...kpi.scaleDefaults(co), stacked: true, beginAtZero: true,
                      ticks: { ...kpi.scaleDefaults(co).ticks, precision: 0 } },
                 y: { ...kpi.scaleDefaults(co), stacked: true } } });

  // The underlying signals, so the CQR mix can be read rather than trusted
  const mean = (arr, f) => { const v = arr.map(f).filter(n => n > 0);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0; };
  const watch = (arr) => mean(arr, d =>
    d.igOrganic?.avgWatchTime || d.ttOrganic?.avgWatchTime || d.fbOrganic?.avgWatchTime || 0);

  kpi.make('chart-cr-signals', 'bar', {
    labels: ['Hook rate %', 'Hold rate %', 'Avg watch (s)'],
    datasets: [
      { label: 'Creator',   data: [mean(os, d => d.hookRate), mean(os, d => d.holdRate), watch(os)],
        backgroundColor: '#31117C' },
      { label: 'Brand Say', data: [mean(bs, d => d.hookRate), mean(bs, d => d.holdRate), watch(bs)],
        backgroundColor: '#A3A8C2' }
    ]
  }, { responsive: true, maintainAspectRatio: false,
       plugins: { legend: kpi.legendDefaults(co) },
       scales: { x: kpi.scaleDefaults(co),
                 y: { ...kpi.scaleDefaults(co), beginAtZero: true } } });
}

// ── Section 4 ─────────────────────────────────────────────────────────────────
function renderSection4(allData) {
  const co = kpi.colors();
  const getPlat = plat => allData.filter(d=>{
    if(plat==='meta')   return d.platform==='meta'||(d.platform==='both'&&d._meta);
    if(plat==='tiktok') return d.platform==='tiktok'||(d.platform==='both'&&d._tt);
    return false;
  }).map(d=>{
    if(plat==='meta'   &&d.platform==='both') return d._meta;
    if(plat==='tiktok' &&d.platform==='both') return d._tt;
    return d;
  }).filter(Boolean);

  const meta=getPlat('meta'), tt=getPlat('tiktok');
  const sum=(arr,k)=>arr.reduce((s,d)=>s+kpi.safeNum(d[k]),0);
  const safe=(n,d)=>d?n/d:0;

  const mSpend=sum(meta,'spend'), mReach=sum(meta,'reach'), mImpr=sum(meta,'impressions');
  const tSpend=sum(tt,'spend'),   tReach=sum(tt,'reach'),   tImpr=sum(tt,'impressions');
  const mCPR=safe(mSpend,mReach)*1000, tCPR=safe(tSpend,tReach)*1000;
  const mCPI=safe(mSpend,mImpr)*1000,  tCPI=safe(tSpend,tImpr)*1000;
  const mWatch=kpi.avg(meta.filter(d=>d.watchTime>0),'watchTime'), tWatch=kpi.avg(tt.filter(d=>d.watchTime>0),'watchTime');
  const mVtr=kpi.avg(meta.filter(d=>d.vtr>0),'vtr'),               tVtr=kpi.avg(tt.filter(d=>d.vtr>0),'vtr');
  const mHook=kpi.avg(meta.filter(d=>d.hookRate>0),'hookRate'),     tHook=kpi.avg(tt.filter(d=>d.hookRate>0),'hookRate');
  const mHold=kpi.avg(meta.filter(d=>d.holdRate>0),'holdRate'),     tHold=kpi.avg(tt.filter(d=>d.holdRate>0),'holdRate');

  kpi.make('chart-cost-eff','bar',{
    labels:['CPM by Reach ($)','CPM by Impressions ($)'],
    datasets:[
      {label:'Meta',  data:[parseFloat(mCPR.toFixed(2)),parseFloat(mCPI.toFixed(2))],backgroundColor:'#1877f2',borderRadius:0},
      {label:'TikTok',data:[parseFloat(tCPR.toFixed(2)),parseFloat(tCPI.toFixed(2))],backgroundColor:'#ff0050',borderRadius:0},
    ]
  },{responsive:true,maintainAspectRatio:false,plugins:{legend:kpi.legendDefaults(co)},scales:{y:{...kpi.scaleDefaults(co),beginAtZero:true,ticks:{...kpi.scaleDefaults(co).ticks,callback:v=>'Rs'+v.toFixed(2)}},x:{...kpi.scaleDefaults(co)}}});

  kpi.make('chart-attention','bar',{
    labels:['Avg Watch Time (s)','Avg VTR %'],
    datasets:[
      {label:'Meta',  data:[parseFloat(mWatch.toFixed(1)),parseFloat(mVtr.toFixed(1))],backgroundColor:'#1877f2',borderRadius:0},
      {label:'TikTok',data:[parseFloat(tWatch.toFixed(1)),parseFloat(tVtr.toFixed(1))],backgroundColor:'#ff0050',borderRadius:0},
    ]
  },{responsive:true,maintainAspectRatio:false,plugins:{legend:kpi.legendDefaults(co)},scales:{y:{...kpi.scaleDefaults(co),beginAtZero:true},x:{...kpi.scaleDefaults(co)}}});

  const win=(a,b,low=false)=>{
    if(!a&&!b) return['—','—'];
    const aW=low?a<b:a>b;
    const fmt=v=>typeof v==='number'?v.toFixed(2):v;
    return[`<span class="${aW?'plat-win':'plat-lose'}">${fmt(a)}</span>`,`<span class="${!aW?'plat-win':'plat-lose'}">${fmt(b)}</span>`];
  };
  const rows=[
    ['Total Spend',     kpi.fmtMoney(mSpend),kpi.fmtMoney(tSpend),false,false],
    ['Total Reach',     kpi.fmtNum(mReach),  kpi.fmtNum(tReach),  false,false],
    ['Total Impressions',kpi.fmtNum(mImpr),  kpi.fmtNum(tImpr),   false,false],
    ['CPM by Reach ($)', mCPR, tCPR, true, true],
    ['CPM by Impr. ($)', mCPI, tCPI, true, true],
    ['Avg Watch Time (s)',mWatch,tWatch,false,true],
    ['Avg VTR %',        mVtr,  tVtr,  false,true],
    ['Avg Hook Rate %',  mHook, tHook, false,true],
    ['Avg Hold Rate',    mHold, tHold, false,true],
    ['Active Ads',       meta.filter(d=>d.adStatus==='ACTIVE').length, tt.filter(d=>d.adStatus==='ACTIVE').length, false,false],
  ];
  const pw=document.getElementById('plat-table-wrap');
  if(pw) pw.innerHTML=`
    <table class="plat-table">
      <thead><tr><th>Metric</th><th style="color:#1877f2">📘 Meta</th><th style="color:#ff0050">📱 TikTok</th></tr></thead>
      <tbody>${rows.map(([l,a,b,low,isN])=>{
        if(!isN) return `<tr><td>${l}</td><td>${a}</td><td>${b}</td></tr>`;
        const[av,bv]=win(a,b,low);
        return`<tr><td>${l}</td><td>${av}</td><td>${bv}</td></tr>`;
      }).join('')}</tbody>
    </table>
    <div style="font-size:13px;color:var(--c-muted);margin-top:10px;padding:0 4px">Green marks the stronger platform for that metric</div>`;
}
