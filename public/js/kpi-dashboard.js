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
      <span class="kfi-label">${key === 'campaign' ? 'Campaign' : key === 'month' ? 'Month' : 'Content Type'}</span>
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
      <select class="kfi-select" onchange="applyKpiFilter('${key}', this.value)">
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
      .dur-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
      .dur-card { background: #F4F6F8; border: 0; border-radius: 8px; padding: 16px; }
      .dur-card-title { font: 400 13px/18px var(--font, 'Rubik', sans-serif); text-transform: none;
        letter-spacing: 0; color: var(--ink-600, #4A4A75); margin-bottom: 12px; }
      .dur-row { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
      .dur-label { font: 400 13px var(--font, 'Rubik', sans-serif); color: var(--ink-600, #4A4A75);
        width: 68px; flex-shrink: 0; }
      .dur-bar-track { flex: 1; height: 14px; background: #EAEFF3; border-radius: 4px; overflow: hidden; }
      .dur-bar-fill { height: 14px; border-radius: 4px; display: flex; align-items: center;
        justify-content: flex-end; padding-right: 7px; }
      .dur-bar-label { font: 500 11px var(--font, 'Rubik', sans-serif); color: #fff; }

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
        .dur-grid { grid-template-columns: 1fr; }
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
        <div class="kc-title">Duration Tier Insights — Brand Say <span class="kc-badge">CQR Distribution</span></div>
        <div id="kpi-dur-bs"></div>
      </div>
      <div class="kc">
        <div class="kc-title">Duration Tier Insights — Others Say <span class="kc-badge">CQR Distribution</span></div>
        <div id="kpi-dur-os"></div>
      </div>
    </div>
    <div class="kpi-chart-row cols-2">
      <div class="kc">
        <div class="kc-title">Performance Head-to-Head <span class="kc-badge">Paid Avg</span></div>
        <div class="kc-wrap"><canvas id="chart-head2head"></canvas></div>
      </div>
      <div class="kc">
        <div class="kc-title">Spend by CQR <span class="kc-badge">Media Waste</span></div>
        <div class="kc-wrap"><canvas id="chart-cqr-donut"></canvas></div>
      </div>
    </div>

    <!-- S3 -->
    <div class="kpi-section-title">Creator Insights</div>
    <div class="kpi-chart-row cols-1">
      <div class="kc">
        <div class="kc-title">Platform Synergy <span class="kc-badge">Views per Creator — IG, TT, FB</span></div>
        <div class="kc-wrap tall"><canvas id="chart-synergy"></canvas></div>
      </div>
    </div>
    <div class="kpi-chart-row cols-2">
      <div class="kc">
        <div class="kc-title">Retention Champions <span class="kc-badge">Avg Watch Time (s)</span></div>
        <div class="kc-wrap"><canvas id="chart-watch-time"></canvas></div>
      </div>
      <div class="kc">
        <div class="kc-title">Hook Masters <span class="kc-badge">Avg Hook Rate %</span></div>
        <div class="kc-wrap"><canvas id="chart-hook-masters"></canvas></div>
      </div>
    </div>
    <div class="kpi-chart-row cols-1">
      <div class="kc">
        <div class="kc-title">Creator Consistency <span class="kc-badge">Volume vs CQR Quality</span></div>
        <div style="overflow-x:auto;" id="creator-leaderboard-wrap"></div>
      </div>
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

  const buildDur = (assets, id, accent) => {
    const el = document.getElementById(id);
    if (!el) return;
    const tiers = durTiers.map(t => {
      const grp = assets.filter(d => { const dur=kpi.safeNum(d.duration); return dur>0&&dur>=t.min&&dur<t.max; });
      const cqr = {Good:0,Average:0,Poor:0,Invalid:0};
      grp.forEach(d=>{ if(cqr[d.cqr]!==undefined) cqr[d.cqr]++; });
      return { label:t.label, total:grp.length, cqr, avgHook:kpi.avg(grp,'hookRate'), avgHold:kpi.avg(grp,'holdRate') };
    });
    const maxT = Math.max(...tiers.map(t=>t.total),1);
    el.innerHTML = `<div class="dur-grid">${tiers.map(t=>{
      const {Good:g,Average:a,Poor:p,Invalid:inv} = t.cqr;
      const fp = Math.round(t.total/maxT*100);
      return `<div class="dur-card">
        <div class="dur-card-title">${t.label} <span style="font-size:13px;color:var(--c-muted);font-weight:400">(${t.total} videos)</span></div>
        <div class="dur-row">
          <div class="dur-label">Volume</div>
          <div class="dur-bar-track"><div class="dur-bar-fill" style="width:${fp}%;background:${accent}"><span class="dur-bar-label">${t.total}</span></div></div>
        </div>
        ${t.total>0?`
          <div style="margin-top:6px">
            <div style="font-size:12px;color:var(--c-muted);margin-bottom:5px">CQR split</div>
            <div class="cqr-mini-bar" style="width:100%">
              ${g>0?`<div style="flex:${g};background:#04785C" title="${g} Good"></div>`:''}
              ${a>0?`<div style="flex:${a};background:#8A5A12" title="${a} Avg"></div>`:''}
              ${p>0?`<div style="flex:${p};background:#A32040" title="${p} Poor"></div>`:''}
              ${inv>0?`<div style="flex:${inv};background:#6B6B90" title="${inv} Invalid"></div>`:''}
            </div>
            <div style="font-size:12px;color:var(--c-muted);margin-top:4px">
              <span style="color:#04785C">●${g}G</span> <span style="color:#8A5A12">●${a}A</span> <span style="color:#A32040">●${p}P</span>
            </div>
          </div>
          <div style="margin-top:6px;display:flex;gap:12px">
            <div style="font-size:13px"><span style="color:var(--c-muted)">Hook:</span> <strong>${kpi.pct(t.avgHook)}</strong></div>
            <div style="font-size:13px"><span style="color:var(--c-muted)">Hold:</span> <strong>${t.avgHold.toFixed(1)}</strong></div>
          </div>`
        :'<div style="font-size:13px;color:var(--c-muted);padding:4px 0">No data</div>'}
      </div>`;
    }).join('')}</div>`;
  };

  const bsData = allData.filter(d=>d.type==='Brand Say');
  const osData = allData.filter(d=>d.type==='Others Say');
  buildDur(bsData,'kpi-dur-bs','#000050');
  buildDur(osData,'kpi-dur-os','#5A5A9E');

  kpi.make('chart-head2head','bar',{
    labels:['Avg Hook Rate','Avg VTR %','Avg Watch Time'],
    datasets:[
      {label:'Brand Say',  data:[kpi.avg(bsData,'hookRate'),kpi.avg(bsData,'vtr'),kpi.avg(bsData,'watchTime')], backgroundColor:'#000050',borderRadius:0},
      {label:'Others Say', data:[kpi.avg(osData,'hookRate'),kpi.avg(osData,'vtr'),kpi.avg(osData,'watchTime')], backgroundColor:'#5A5A9E',borderRadius:0},
    ]
  },{responsive:true,maintainAspectRatio:false,plugins:{legend:kpi.legendDefaults(co)},scales:{y:{...kpi.scaleDefaults(co),beginAtZero:true},x:{...kpi.scaleDefaults(co)}}});

  const cqrSpend={Good:0,Average:0,Poor:0,Invalid:0};
  allData.forEach(d=>{if(cqrSpend[d.cqr]!==undefined) cqrSpend[d.cqr]+=(d.spend||0);});
  kpi.make('chart-cqr-donut','doughnut',{
    labels:['Good','Average','Poor','Invalid'],
    datasets:[{data:[cqrSpend.Good,cqrSpend.Average,cqrSpend.Poor,cqrSpend.Invalid],backgroundColor:['#04785C','#8A5A12','#A32040','#6B6B90'],borderWidth:0}]
  },{responsive:true,maintainAspectRatio:false,cutout:'62%',plugins:{legend:{...kpi.legendDefaults(co),position:'right'},tooltip:{callbacks:{label:ctx=>` ${ctx.label}: ${kpi.fmtMoney(ctx.raw)}`}}}});
}

// ── Section 3 ─────────────────────────────────────────────────────────────────
function renderSection3(allContent) {
  const co = kpi.colors();
  const osContent = allContent.filter(d=>d.type==='Others Say'&&d.creatorProfile);
  const cMap = {};

  osContent.forEach(d=>{
    const info = extractCreatorInfo(d.creatorProfile, d.ttLink);
    const name = info?(info.username||d.creatorProfile):d.creatorProfile;
    if (!name) return;
    if (!cMap[name]) cMap[name]={name,profileUrl:info?.profileUrl||null,videos:0,igViews:0,ttViews:0,fbViews:0,igWatch:[],ttWatch:[],hookRates:[],holdRates:[],cqr:{Good:0,Average:0,Poor:0}};
    const cm=cMap[name]; cm.videos++;
    if(d.igOrganic){cm.igViews+=(d.igOrganic.views||0); if(d.igOrganic.avgWatchTime>0) cm.igWatch.push(d.igOrganic.avgWatchTime);}
    if(d.ttOrganic){cm.ttViews+=(d.ttOrganic.views||0); if(d.ttOrganic.avgWatchTime>0) cm.ttWatch.push(d.ttOrganic.avgWatchTime);}
    if(d.fbOrganic) cm.fbViews+=(d.fbOrganic.videoViews||0);
    const paid=(typeof ALL!=='undefined'?ALL:[]).find(p=>p.id===d.id);
    if(paid){if(paid.hookRate>0)cm.hookRates.push(paid.hookRate);if(paid.holdRate>0)cm.holdRates.push(paid.holdRate);if(cm.cqr[paid.cqr]!==undefined)cm.cqr[paid.cqr]++;}
  });

  const creators = Object.values(cMap).map(c=>({
    ...c,
    totalViews:c.igViews+c.ttViews+c.fbViews,
    avgWatch:[...c.igWatch,...c.ttWatch].reduce((a,b)=>a+b,0)/([...c.igWatch,...c.ttWatch].length||1),
    avgHook:c.hookRates.reduce((a,b)=>a+b,0)/(c.hookRates.length||1),
    avgHold:c.holdRates.reduce((a,b)=>a+b,0)/(c.holdRates.length||1),
  })).filter(c=>c.videos>0).sort((a,b)=>b.totalViews-a.totalViews);

  const top10     = creators.slice(0,10);
  const top8Watch = [...creators].sort((a,b)=>b.avgWatch-a.avgWatch).slice(0,8);
  const top8Hook  = [...creators].filter(c=>c.avgHook>0).sort((a,b)=>b.avgHook-a.avgHook).slice(0,8);

  kpi.make('chart-synergy','bar',{
    labels:top10.map(c=>c.name.length>18?c.name.slice(0,16)+'…':c.name),
    datasets:[
      {label:'IG Views',data:top10.map(c=>c.igViews),backgroundColor:'#e1306c',borderRadius:0},
      {label:'TT Views',data:top10.map(c=>c.ttViews),backgroundColor:'#ff0050',borderRadius:0},
      {label:'FB Views',data:top10.map(c=>c.fbViews),backgroundColor:'#1877f2',borderRadius:0},
    ]
  },{responsive:true,maintainAspectRatio:false,plugins:{legend:kpi.legendDefaults(co)},scales:{x:{...kpi.scaleDefaults(co),stacked:true},y:{...kpi.scaleDefaults(co),stacked:true,beginAtZero:true,ticks:{...kpi.scaleDefaults(co).ticks,callback:v=>kpi.fmtNum(v)}}}});

  kpi.make('chart-watch-time','bar',{
    labels:top8Watch.map(c=>c.name.length>16?c.name.slice(0,14)+'…':c.name),
    datasets:[{label:'Avg Watch Time (s)',data:top8Watch.map(c=>parseFloat(c.avgWatch.toFixed(1))),backgroundColor:top8Watch.map((_,i)=>`hsl(${180+i*12},70%,45%)`),borderRadius:0}]
  },{responsive:true,maintainAspectRatio:false,indexAxis:'y',plugins:{legend:{display:false}},scales:{x:{...kpi.scaleDefaults(co),beginAtZero:true,ticks:{...kpi.scaleDefaults(co).ticks,callback:v=>v+'s'}},y:{...kpi.scaleDefaults(co)}}});

  kpi.make('chart-hook-masters','bar',{
    labels:top8Hook.map(c=>c.name.length>16?c.name.slice(0,14)+'…':c.name),
    datasets:[{label:'Avg Hook Rate %',data:top8Hook.map(c=>parseFloat(c.avgHook.toFixed(1))),backgroundColor:top8Hook.map((_,i)=>`hsl(${260+i*8},65%,55%)`),borderRadius:0}]
  },{responsive:true,maintainAspectRatio:false,indexAxis:'y',plugins:{legend:{display:false}},scales:{x:{...kpi.scaleDefaults(co),beginAtZero:true,ticks:{...kpi.scaleDefaults(co).ticks,callback:v=>v+'%'}},y:{...kpi.scaleDefaults(co)}}});

  const maxV = Math.max(...creators.map(c=>c.totalViews),1);
  const rl   = ['gold','silver','bronze'];
  const lbWrap = document.getElementById('creator-leaderboard-wrap');
  if (lbWrap) lbWrap.innerHTML = `
    <table class="creator-leaderboard">
      <thead><tr><th style="width:28px">#</th><th>Creator</th><th style="width:50px">Videos</th><th style="width:160px">Total Views</th><th style="width:90px">Hook Rate</th><th style="width:100px">CQR Quality</th><th style="width:60px">Platforms</th></tr></thead>
      <tbody>${creators.slice(0,15).map((c,i)=>{
        const {Good:g,Average:a,Poor:p}=c.cqr;
        const nameEl = c.profileUrl?`<a href="${c.profileUrl}" target="_blank">${c.name}</a>`:c.name;
        const pills = [c.igViews>0?'<span class="cl-pill ig">IG</span>':'',c.ttViews>0?'<span class="cl-pill tt">TT</span>':'',c.fbViews>0?'<span class="cl-pill fb">FB</span>':''].join('');
        const hc = c.avgHook>=30?'#04785C':c.avgHook>=20?'#8A5A12':'#A32040';
        return `<tr>
          <td class="cl-rank ${rl[i]||''}">${i+1}</td>
          <td class="cl-name">${nameEl}</td>
          <td style="text-align:center;font-weight:500">${c.videos}</td>
          <td><div class="cl-bar-wrap"><div class="cl-bar-track"><div class="cl-bar-fill" style="width:${Math.round(c.totalViews/maxV*100)}%;background:#000050"></div></div><div class="cl-val">${kpi.fmtNum(c.totalViews)}</div></div></td>
          <td style="text-align:center;font-weight:500;color:${hc}">${c.avgHook>0?kpi.pct(c.avgHook):'—'}</td>
          <td>${g+a+p>0?`<div class="cqr-mini-bar">${g>0?`<div style="flex:${g};background:#04785C"></div>`:''} ${a>0?`<div style="flex:${a};background:#8A5A12"></div>`:''} ${p>0?`<div style="flex:${p};background:#A32040"></div>`:''}</div><div style="font-size:12px;color:var(--c-muted);margin-top:3px">${g}G/${a}A/${p}P</div>`:'<span style="color:var(--c-muted);font-size:13px">No paid data</span>'}</td>
          <td><div class="cl-platform-pills">${pills}</div></td>
        </tr>`;
      }).join('')}</tbody>
    </table>`;
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
