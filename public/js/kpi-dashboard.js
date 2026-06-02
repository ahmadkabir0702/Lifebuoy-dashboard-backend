/**
 * =========================================================
 *  Lifebuoy BW – Campaign KPI Dashboard
 *  Drop-in replacement for the renderKpiTab / renderKPIDashboard logic
 *  Paste this entire file BEFORE the closing </script> tag in dashboard.js,
 *  and make sure the HTML section below (page-kpi) is also replaced.
 * =========================================================
 */

// ── Utility ──────────────────────────────────────────────────────────────────
const kpi = {
  instances: {},

  destroyAll() {
    Object.values(this.instances).forEach(c => { try { c.destroy(); } catch(e) {} });
    this.instances = {};
  },

  make(id, type, data, options = {}) {
    try {
      if (this.instances[id]) { this.instances[id].destroy(); delete this.instances[id]; }
      const el = document.getElementById(id);
      if (!el) return;
      this.instances[id] = new Chart(el, { type, data, options });
    } catch(e) { console.warn('Chart error', id, e); }
  },

  isDark: () => matchMedia('(prefers-color-scheme:dark)').matches,

  colors() {
    const dark = this.isDark();
    return {
      grid:  dark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.06)',
      tick:  dark ? '#9a9a9a' : '#6b6b6b',
      text:  dark ? '#f0f0f0' : '#1a1a1a',
      meta:  '#1877f2',
      tt:    '#ff0050',
      bs:    '#7c3aed',
      os:    '#0891b2',
      good:  '#16a34a',
      avg:   '#d97706',
      poor:  '#dc2626',
      inv:   '#6b7280',
    };
  },

  scaleDefaults(c) {
    return {
      grid: { color: c.grid },
      ticks: { color: c.tick, font: { size: 11 } },
    };
  },

  legendDefaults(c) {
    return { labels: { color: c.text, font: { size: 11 }, boxWidth: 10, padding: 10 } };
  },

  safeNum(v) {
    if (typeof v === 'number' && !isNaN(v)) return v;
    const n = parseFloat(String(v || '').replace(/[^0-9.-]+/g, ''));
    return isNaN(n) ? 0 : n;
  },

  avg(arr, key) {
    const vals = arr.map(d => this.safeNum(d[key])).filter(n => n > 0);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
  },

  fmtMoney(n) {
    if (!n) return '$0';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + n.toFixed(2);
  },

  fmtNum(n) {
    if (!n) return '0';
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(0) + 'K';
    return String(Math.round(n));
  },

  pct(v) { return (v || 0).toFixed(1) + '%'; },
};

// ── Main render entry ─────────────────────────────────────────────────────────
function renderKPIDashboard() {
  const page = document.getElementById('page-kpi');
  if (!page || page.classList.contains('hidden')) return;
  kpi.destroyAll();

  // pull the full unfiltered dataset so KPI tab always shows campaign totals
  const allData = typeof ALL !== 'undefined' ? ALL : [];
  const allContent = typeof ALL_CONTENT !== 'undefined' ? ALL_CONTENT : [];
  const accOverview = typeof ACCOUNT_OVERVIEW !== 'undefined' ? ACCOUNT_OVERVIEW : [];

  renderKPIShell(page);
  renderSection1(accOverview, allData, allContent);
  renderSection2(allData, allContent);
  renderSection3(allContent);
  renderSection4(allData);
}

// Also wire this up as renderKpiTab so the nav call works too
function renderKpiTab(filteredData) {
  renderKPIDashboard();
}

// ── Shell HTML ────────────────────────────────────────────────────────────────
function renderKPIShell(page) {
  page.innerHTML = `
    <style>
      #page-kpi { padding: 20px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }

      /* Section titles */
      .kpi-section-title {
        font-size: 11px; font-weight: 700; letter-spacing: .1em;
        text-transform: uppercase; color: var(--c-accent);
        margin: 28px 0 14px; display: flex; align-items: center; gap: 8px;
      }
      .kpi-section-title::after {
        content: ''; flex: 1; height: 1px; background: var(--c-border);
      }

      /* Stat cards */
      .kpi-stat-row { display: grid; gap: 10px; margin-bottom: 16px; }
      .kpi-stat-row.cols-5 { grid-template-columns: repeat(5, 1fr); }
      .kpi-stat-row.cols-3 { grid-template-columns: repeat(3, 1fr); }
      .kpi-stat-row.cols-4 { grid-template-columns: repeat(4, 1fr); }

      .ks { background: var(--c-surface); border: 1px solid var(--c-border);
        border-radius: 10px; padding: 14px 16px; position: relative; overflow: hidden; }
      .ks::before { content: ''; position: absolute; top: 0; left: 0; right: 0;
        height: 3px; background: var(--kpi-accent, var(--c-accent)); }
      .ks-label { font-size: 10px; font-weight: 700; text-transform: uppercase;
        letter-spacing: .07em; color: var(--c-muted); margin-bottom: 6px; }
      .ks-val { font-size: 22px; font-weight: 800; letter-spacing: -.5px; color: var(--c-text); }
      .ks-sub { font-size: 10px; color: var(--c-muted); margin-top: 3px; }
      .ks-prog-track { height: 5px; background: var(--c-border); border-radius: 3px;
        margin-top: 8px; overflow: hidden; }
      .ks-prog-fill { height: 5px; border-radius: 3px; background: var(--kpi-accent, var(--c-accent));
        transition: width .6s ease; }

      /* Chart cards */
      .kpi-chart-row { display: grid; gap: 12px; margin-bottom: 14px; }
      .kpi-chart-row.cols-2 { grid-template-columns: 1fr 1fr; }
      .kpi-chart-row.cols-3 { grid-template-columns: repeat(3, 1fr); }
      .kpi-chart-row.cols-1 { grid-template-columns: 1fr; }

      .kc { background: var(--c-surface); border: 1px solid var(--c-border);
        border-radius: 10px; padding: 16px; }
      .kc-title { font-size: 12px; font-weight: 700; margin-bottom: 12px;
        color: var(--c-text); display: flex; align-items: center; gap: 6px; }
      .kc-title .kc-badge { font-size: 9px; font-weight: 700; padding: 2px 6px;
        border-radius: 3px; background: var(--c-border); color: var(--c-muted); }
      .kc-wrap { position: relative; height: 220px; }
      .kc-wrap.tall { height: 280px; }
      .kc-wrap.short { height: 170px; }

      /* Creator table */
      .creator-leaderboard { width: 100%; border-collapse: collapse; font-size: 11px; }
      .creator-leaderboard th { text-align: left; padding: 8px 10px; font-size: 10px;
        font-weight: 700; text-transform: uppercase; letter-spacing: .05em;
        color: var(--c-muted); border-bottom: 2px solid var(--c-border); }
      .creator-leaderboard td { padding: 10px 10px; border-bottom: 1px solid var(--c-border);
        vertical-align: middle; }
      .creator-leaderboard tr:hover td { background: rgba(37,99,235,.03); }
      .creator-leaderboard tr:last-child td { border-bottom: none; }
      .cl-rank { font-size: 12px; font-weight: 800; color: var(--c-muted); }
      .cl-rank.gold { color: #f59e0b; }
      .cl-rank.silver { color: #9ca3af; }
      .cl-rank.bronze { color: #b45309; }
      .cl-name { font-weight: 700; font-size: 12px; }
      .cl-name a { color: var(--c-accent); text-decoration: none; }
      .cl-name a:hover { text-decoration: underline; }
      .cl-platform-pills { display: flex; gap: 4px; flex-wrap: wrap; margin-top: 3px; }
      .cl-pill { font-size: 9px; font-weight: 700; padding: 1px 5px; border-radius: 3px; }
      .cl-pill.ig { background: #fce7f3; color: #9d174d; }
      .cl-pill.tt { background: #fef2f2; color: #991b1b; }
      .cl-pill.fb { background: #eff6ff; color: #1e40af; }
      .cl-bar-wrap { display: flex; align-items: center; gap: 6px; }
      .cl-bar-track { flex: 1; height: 6px; background: var(--c-border); border-radius: 3px; overflow: hidden; }
      .cl-bar-fill { height: 6px; border-radius: 3px; }
      .cl-val { font-size: 11px; font-weight: 700; min-width: 36px; text-align: right; }
      .cqr-mini-bar { display: flex; height: 8px; border-radius: 4px; overflow: hidden; width: 80px; gap: 1px; }
      .cqr-mini-bar div { border-radius: 2px; }

      /* Duration grid */
      .dur-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
      .dur-card { background: var(--c-bg); border: 1px solid var(--c-border);
        border-radius: 8px; padding: 10px 12px; }
      .dur-card-title { font-size: 10px; font-weight: 700; text-transform: uppercase;
        letter-spacing: .06em; color: var(--c-muted); margin-bottom: 8px; }
      .dur-row { display: flex; align-items: center; gap: 8px; margin-bottom: 5px; }
      .dur-label { font-size: 10px; color: var(--c-muted); width: 60px; flex-shrink: 0; }
      .dur-bar-track { flex: 1; height: 14px; background: var(--c-border);
        border-radius: 4px; overflow: hidden; position: relative; }
      .dur-bar-fill { height: 14px; border-radius: 4px; display: flex;
        align-items: center; justify-content: flex-end; padding-right: 5px; }
      .dur-bar-label { font-size: 9px; font-weight: 700; color: #fff; }

      /* Platform efficiency table */
      .plat-table { width: 100%; border-collapse: collapse; font-size: 11px; }
      .plat-table th { text-align: center; padding: 7px 10px; font-size: 10px;
        font-weight: 700; text-transform: uppercase; letter-spacing: .05em;
        color: var(--c-muted); border-bottom: 1px solid var(--c-border); }
      .plat-table th:first-child { text-align: left; }
      .plat-table td { padding: 8px 10px; border-bottom: 1px solid var(--c-border); text-align: center; }
      .plat-table td:first-child { text-align: left; font-weight: 600; }
      .plat-table tr:last-child td { border-bottom: none; }
      .plat-win { color: var(--c-good); font-weight: 700; }
      .plat-lose { color: var(--c-muted); }

      @media (max-width: 800px) {
        .kpi-stat-row.cols-5, .kpi-stat-row.cols-4, .kpi-stat-row.cols-3 { grid-template-columns: 1fr 1fr; }
        .kpi-chart-row.cols-2, .kpi-chart-row.cols-3 { grid-template-columns: 1fr; }
        .dur-grid { grid-template-columns: 1fr; }
      }
    </style>

    <!-- Section 1: Executive Summary -->
    <div class="kpi-section-title">Section 1 — Executive Summary</div>
    <div class="kpi-stat-row cols-5" id="kpi-s1-budget"></div>

    <!-- Section 2: Content Breakdown -->
    <div class="kpi-section-title">Section 2 — Content Breakdown</div>
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
        <div class="kc-title">Spend by Content Quality (CQR) <span class="kc-badge">Media Waste</span></div>
        <div class="kc-wrap"><canvas id="chart-cqr-donut"></canvas></div>
      </div>
    </div>

    <!-- Section 3: Creator Insights -->
    <div class="kpi-section-title">Section 3 — Creator Insights</div>
    <div class="kpi-chart-row cols-1">
      <div class="kc">
        <div class="kc-title">Platform Synergy <span class="kc-badge">Views per Creator across IG, TT, FB</span></div>
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
        <div class="kc-title">Creator Consistency <span class="kc-badge">Volume vs CQR Quality — Others Say</span></div>
        <div style="overflow-x:auto;" id="creator-leaderboard-wrap"></div>
      </div>
    </div>

    <!-- Section 4: Paid Platform Efficiency -->
    <div class="kpi-section-title">Section 4 — Paid Platform Efficiency</div>
    <div class="kpi-chart-row cols-2">
      <div class="kc">
        <div class="kc-title">Cost Efficiency <span class="kc-badge">Spend vs Reach &amp; Impressions</span></div>
        <div class="kc-wrap"><canvas id="chart-cost-eff"></canvas></div>
      </div>
      <div class="kc">
        <div class="kc-title">Attention Metrics <span class="kc-badge">Avg Watch Time &amp; VTR%</span></div>
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

// ── Section 1: Executive Summary ─────────────────────────────────────────────
function renderSection1(accOverview, allData, allContent) {
  const c = kpi.colors();

  // Planned vs Actual from Account Overview
  const actRow = accOverview[0] || {};
  const kpiRow = accOverview[1] || accOverview[0] || {};

  const actSpend = kpi.safeNum(actRow.actSpend);
  const kpiSpend = kpi.safeNum(actRow.kpiSpend || kpiRow.kpiSpend);
  const actReach = kpi.safeNum(actRow.actReach);
  const kpiReach = kpi.safeNum(actRow.kpiReach || kpiRow.kpiReach);
  const actImpr  = kpi.safeNum(actRow.actImpressions);
  const kpiImpr  = kpi.safeNum(actRow.kpiImpressions || kpiRow.kpiImpressions);
  const actFreq  = kpi.safeNum(actRow.actFrequency);
  const kpiFreq  = kpi.safeNum(actRow.kpiFrequency || kpiRow.kpiFrequency);

  // Fallback: sum from paid data if overview is empty
  const totalSpend  = actSpend  || allData.reduce((s,d) => s + (d.spend || 0), 0);
  const totalReach  = actReach  || allData.reduce((s,d) => s + (d.reach || 0), 0);
  const totalImpr2  = actImpr   || allData.reduce((s,d) => s + (d.impressions || 0), 0);
  const frequency   = actFreq   || (totalImpr2 && totalReach ? (totalImpr2 / totalReach).toFixed(2) : 0);

  const spendPct  = kpiSpend  ? Math.min(100, (totalSpend  / kpiSpend  * 100)) : null;
  const reachPct  = kpiReach  ? Math.min(100, (totalReach  / kpiReach  * 100)) : null;
  const imprPct   = kpiImpr   ? Math.min(100, (totalImpr2  / kpiImpr   * 100)) : null;

  const budgetHealthColor = spendPct === null ? '#6b7280' : spendPct > 90 ? '#dc2626' : spendPct > 70 ? '#d97706' : '#16a34a';

  function statCard(label, actual, target, pct, fmt, accent) {
    const progHTML = pct !== null ? `
      <div class="ks-sub">${target ? 'KPI: ' + fmt(target) : 'No KPI set'} · ${pct !== null ? pct.toFixed(0) + '% achieved' : ''}</div>
      <div class="ks-prog-track"><div class="ks-prog-fill" style="width:${pct || 0}%"></div></div>
    ` : `<div class="ks-sub">No KPI target set</div>`;
    return `<div class="ks" style="--kpi-accent:${accent}">
      <div class="ks-label">${label}</div>
      <div class="ks-val">${fmt(actual)}</div>
      ${progHTML}
    </div>`;
  }

  document.getElementById('kpi-s1-budget').innerHTML =
    statCard('Budget Spend', totalSpend, kpiSpend, spendPct, kpi.fmtMoney, budgetHealthColor) +
    statCard('Reach', totalReach, kpiReach, reachPct, kpi.fmtNum, '#7c3aed') +
    statCard('Impressions', totalImpr2, kpiImpr, imprPct, kpi.fmtNum, '#0891b2') +
    statCard('Frequency', parseFloat(frequency) || 0, kpiFreq || null, null, v => (v||0).toFixed(2) + 'x', '#f59e0b') +
    `<div class="ks" style="--kpi-accent:#16a34a">
      <div class="ks-label">Active Assets</div>
      <div class="ks-val" style="color:#16a34a">${allData.filter(d=>d.adStatus==='ACTIVE').length}</div>
      <div class="ks-sub">of ${allData.length} total paid</div>
    </div>`;
}

// ── Section 2: Content Breakdown ─────────────────────────────────────────────
function renderSection2(allData, allContent) {
  const c = kpi.colors();

  const origAssets   = allContent.filter(d => !d.isRepurposed).length;
  const repAssets    = allContent.filter(d => d.isRepurposed).length;
  const validAssets  = allData.filter(d => d.isValidated).length;
  const bsCount      = allContent.filter(d => d.type === 'Brand Say').length;
  const osCount      = allContent.filter(d => d.type === 'Others Say').length;

  document.getElementById('kpi-s2-pipeline').innerHTML = `
    <div class="ks" style="--kpi-accent:#7c3aed">
      <div class="ks-label">Brand Say Assets</div>
      <div class="ks-val" style="color:#7c3aed">${bsCount}</div>
      <div class="ks-sub">${allContent.length ? Math.round(bsCount/allContent.length*100) : 0}% of total pipeline</div>
    </div>
    <div class="ks" style="--kpi-accent:#0891b2">
      <div class="ks-label">Others Say Assets</div>
      <div class="ks-val" style="color:#0891b2">${osCount}</div>
      <div class="ks-sub">${allContent.length ? Math.round(osCount/allContent.length*100) : 0}% of total pipeline</div>
    </div>
    <div class="ks" style="--kpi-accent:#16a34a">
      <div class="ks-label">Original Assets</div>
      <div class="ks-val">${origAssets}</div>
      <div class="ks-sub">New content created</div>
    </div>
    <div class="ks" style="--kpi-accent:#d97706">
      <div class="ks-label">Repurposed Assets</div>
      <div class="ks-val">${repAssets}</div>
      <div class="ks-sub">${allContent.length ? Math.round(repAssets/allContent.length*100) : 0}% repurpose rate</div>
    </div>
  `;

  // Duration tiers
  const durTiers = [
    { label: '< 10s',     min: 0,  max: 10 },
    { label: '10–14s',    min: 10, max: 15 },
    { label: '15–59s',    min: 15, max: 60 },
    { label: '60s+',      min: 60, max: Infinity },
  ];

  function buildDurSection(assets, containerId, accent) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const tierData = durTiers.map(t => {
      const group = assets.filter(d => {
        const dur = kpi.safeNum(d.duration);
        return dur > 0 && dur >= t.min && dur < t.max;
      });
      const cqrCounts = { Good: 0, Average: 0, Poor: 0, Invalid: 0 };
      group.forEach(d => { const q = d.cqr || 'Invalid'; if (cqrCounts[q] !== undefined) cqrCounts[q]++; });
      return { label: t.label, total: group.length, cqrCounts,
        avgHook: kpi.avg(group, 'hookRate'),
        avgHold: kpi.avg(group, 'holdRate'),
      };
    });

    const maxTotal = Math.max(...tierData.map(t => t.total), 1);

    container.innerHTML = `<div class="dur-grid">${tierData.map(t => {
      const g = t.cqrCounts.Good, a = t.cqrCounts.Average, p = t.cqrCounts.Poor, inv = t.cqrCounts.Invalid;
      const tot = g + a + p + inv || 1;
      const fillPct = Math.round(t.total / maxTotal * 100);
      const barColor = g > 0 ? '#16a34a' : (a > 0 ? '#d97706' : '#dc2626');
      return `<div class="dur-card">
        <div class="dur-card-title">${t.label} <span style="font-size:10px;color:var(--c-muted);font-weight:400">(${t.total} videos)</span></div>
        <div class="dur-row">
          <div class="dur-label">Volume</div>
          <div class="dur-bar-track">
            <div class="dur-bar-fill" style="width:${fillPct}%;background:${accent}">
              <span class="dur-bar-label">${t.total}</span>
            </div>
          </div>
        </div>
        ${t.total > 0 ? `
        <div style="margin-top:6px;">
          <div style="font-size:9px;color:var(--c-muted);margin-bottom:4px;font-weight:600;">CQR SPLIT</div>
          <div class="cqr-mini-bar" style="width:100%;">
            ${g > 0 ? `<div style="flex:${g};background:#16a34a;" title="${g} Good"></div>` : ''}
            ${a > 0 ? `<div style="flex:${a};background:#d97706;" title="${a} Average"></div>` : ''}
            ${p > 0 ? `<div style="flex:${p};background:#dc2626;" title="${p} Poor"></div>` : ''}
            ${inv > 0 ? `<div style="flex:${inv};background:#6b7280;" title="${inv} Invalid"></div>` : ''}
          </div>
          <div style="font-size:9px;color:var(--c-muted);margin-top:3px;">
            <span style="color:#16a34a;">●${g}G</span> 
            <span style="color:#d97706;">●${a}A</span> 
            <span style="color:#dc2626;">●${p}P</span>
            ${inv > 0 ? `<span style="color:#6b7280;">●${inv}?</span>` : ''}
          </div>
        </div>
        <div style="margin-top:6px;display:flex;gap:12px;">
          <div style="font-size:10px;"><span style="color:var(--c-muted);">Hook:</span> <strong>${kpi.pct(t.avgHook)}</strong></div>
          <div style="font-size:10px;"><span style="color:var(--c-muted);">Hold:</span> <strong>${t.avgHold.toFixed(1)}</strong></div>
        </div>` : '<div style="font-size:10px;color:var(--c-muted);padding:4px 0;">No data in this tier</div>'}
      </div>`;
    }).join('')}</div>`;
  }

  const bsData = allData.filter(d => d.type === 'Brand Say');
  const osData = allData.filter(d => d.type === 'Others Say');

  buildDurSection(bsData, 'kpi-dur-bs', '#7c3aed');
  buildDurSection(osData, 'kpi-dur-os', '#0891b2');

  // Head-to-head chart
  const metrics = ['Avg Hook Rate', 'Avg VTR %', 'Avg Watch Time'];
  const bsVals  = [kpi.avg(bsData, 'hookRate'), kpi.avg(bsData, 'vtr'), kpi.avg(bsData, 'watchTime')];
  const osVals  = [kpi.avg(osData, 'hookRate'), kpi.avg(osData, 'vtr'), kpi.avg(osData, 'watchTime')];

  const co = kpi.colors();
  kpi.make('chart-head2head', 'bar', {
    labels: metrics,
    datasets: [
      { label: 'Brand Say', data: bsVals, backgroundColor: '#7c3aed', borderRadius: 5 },
      { label: 'Others Say', data: osVals, backgroundColor: '#0891b2', borderRadius: 5 },
    ]
  }, {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: kpi.legendDefaults(co) },
    scales: { y: { ...kpi.scaleDefaults(co), beginAtZero: true }, x: { ...kpi.scaleDefaults(co) } }
  });

  // CQR Donut
  const cqrSpend = { Good: 0, Average: 0, Poor: 0, Invalid: 0 };
  allData.forEach(d => { if (cqrSpend[d.cqr] !== undefined) cqrSpend[d.cqr] += (d.spend || 0); });

  kpi.make('chart-cqr-donut', 'doughnut', {
    labels: ['Good', 'Average', 'Poor', 'Invalid'],
    datasets: [{
      data: [cqrSpend.Good, cqrSpend.Average, cqrSpend.Poor, cqrSpend.Invalid],
      backgroundColor: ['#16a34a', '#d97706', '#dc2626', '#6b7280'],
      borderWidth: 0,
    }]
  }, {
    responsive: true, maintainAspectRatio: false, cutout: '62%',
    plugins: {
      legend: { ...kpi.legendDefaults(co), position: 'right' },
      tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${kpi.fmtMoney(ctx.raw)}` } }
    }
  });
}

// ── Section 3: Creator Insights ───────────────────────────────────────────────
function renderSection3(allContent) {
  const co = kpi.colors();

  // Build creator map from Others Say
  const osContent = allContent.filter(d => d.type === 'Others Say' && d.creatorProfile);
  const creatorMap = {};

  osContent.forEach(d => {
    const info = extractCreatorInfo(d.creatorProfile, d.ttLink);
    const name = info ? (info.username || d.creatorProfile) : d.creatorProfile;
    const profileUrl = info ? info.profileUrl : null;
    if (!name) return;
    if (!creatorMap[name]) creatorMap[name] = {
      name, profileUrl, videos: 0,
      igViews: 0, ttViews: 0, fbViews: 0,
      igWatch: [], ttWatch: [],
      hookRates: [], holdRates: [],
      cqr: { Good: 0, Average: 0, Poor: 0 },
    };
    const cm = creatorMap[name];
    cm.videos++;
    if (d.igOrganic) {
      cm.igViews += (d.igOrganic.views || 0);
      if (d.igOrganic.avgWatchTime > 0) cm.igWatch.push(d.igOrganic.avgWatchTime);
    }
    if (d.ttOrganic) {
      cm.ttViews += (d.ttOrganic.views || 0);
      if (d.ttOrganic.avgWatchTime > 0) cm.ttWatch.push(d.ttOrganic.avgWatchTime);
    }
    if (d.fbOrganic) cm.fbViews += (d.fbOrganic.videoViews || 0);
    // hook/hold from paid data if available
    const paid = (typeof ALL !== 'undefined' ? ALL : []).find(p => p.id === d.id);
    if (paid) {
      if (paid.hookRate > 0) cm.hookRates.push(paid.hookRate);
      if (paid.holdRate > 0) cm.holdRates.push(paid.holdRate);
      if (cm.cqr[paid.cqr] !== undefined) cm.cqr[paid.cqr]++;
    }
  });

  const creators = Object.values(creatorMap)
    .map(c => ({
      ...c,
      totalViews:  c.igViews + c.ttViews + c.fbViews,
      avgWatch:    [...c.igWatch, ...c.ttWatch].reduce((a,b)=>a+b,0) / (c.igWatch.length + c.ttWatch.length || 1),
      avgHook:     c.hookRates.reduce((a,b)=>a+b,0) / (c.hookRates.length || 1),
      avgHold:     c.holdRates.reduce((a,b)=>a+b,0) / (c.holdRates.length || 1),
    }))
    .filter(c => c.videos > 0)
    .sort((a,b) => b.totalViews - a.totalViews);

  const top10 = creators.slice(0, 10);
  const top5Watch = [...creators].sort((a,b) => b.avgWatch - a.avgWatch).slice(0, 8);
  const top5Hook  = [...creators].filter(c => c.avgHook > 0).sort((a,b) => b.avgHook - a.avgHook).slice(0, 8);

  // Platform Synergy
  kpi.make('chart-synergy', 'bar', {
    labels: top10.map(c => c.name.length > 18 ? c.name.slice(0, 16) + '…' : c.name),
    datasets: [
      { label: 'IG Views', data: top10.map(c => c.igViews), backgroundColor: '#e1306c', borderRadius: 4 },
      { label: 'TT Views', data: top10.map(c => c.ttViews), backgroundColor: '#ff0050', borderRadius: 4 },
      { label: 'FB Views', data: top10.map(c => c.fbViews), backgroundColor: '#1877f2', borderRadius: 4 },
    ]
  }, {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: kpi.legendDefaults(co) },
    scales: {
      x: { ...kpi.scaleDefaults(co), stacked: true },
      y: { ...kpi.scaleDefaults(co), stacked: true, beginAtZero: true,
        ticks: { ...kpi.scaleDefaults(co).ticks, callback: v => kpi.fmtNum(v) }
      },
    }
  });

  // Watch Time chart
  kpi.make('chart-watch-time', 'bar', {
    labels: top5Watch.map(c => c.name.length > 16 ? c.name.slice(0, 14) + '…' : c.name),
    datasets: [{
      label: 'Avg Watch Time (s)',
      data: top5Watch.map(c => parseFloat(c.avgWatch.toFixed(1))),
      backgroundColor: top5Watch.map((_, i) => `hsl(${180 + i * 12},70%,45%)`),
      borderRadius: 5,
    }]
  }, {
    responsive: true, maintainAspectRatio: false, indexAxis: 'y',
    plugins: { legend: { display: false } },
    scales: {
      x: { ...kpi.scaleDefaults(co), beginAtZero: true,
        ticks: { ...kpi.scaleDefaults(co).ticks, callback: v => v + 's' }
      },
      y: { ...kpi.scaleDefaults(co) },
    }
  });

  // Hook Masters chart
  kpi.make('chart-hook-masters', 'bar', {
    labels: top5Hook.map(c => c.name.length > 16 ? c.name.slice(0, 14) + '…' : c.name),
    datasets: [{
      label: 'Avg Hook Rate %',
      data: top5Hook.map(c => parseFloat(c.avgHook.toFixed(1))),
      backgroundColor: top5Hook.map((_, i) => `hsl(${260 + i * 8},65%,55%)`),
      borderRadius: 5,
    }]
  }, {
    responsive: true, maintainAspectRatio: false, indexAxis: 'y',
    plugins: { legend: { display: false } },
    scales: {
      x: { ...kpi.scaleDefaults(co), beginAtZero: true,
        ticks: { ...kpi.scaleDefaults(co).ticks, callback: v => v + '%' }
      },
      y: { ...kpi.scaleDefaults(co) },
    }
  });

  // Creator Leaderboard Table
  const maxViews = Math.max(...creators.map(c => c.totalViews), 1);
  const rankLabels = ['gold', 'silver', 'bronze'];

  const leaderboardHTML = `
    <table class="creator-leaderboard">
      <thead>
        <tr>
          <th style="width:28px">#</th>
          <th>Creator</th>
          <th style="width:50px">Videos</th>
          <th style="width:160px">Total Views</th>
          <th style="width:90px">Hook Rate</th>
          <th style="width:100px">CQR Quality</th>
          <th style="width:60px">Platforms</th>
        </tr>
      </thead>
      <tbody>
        ${creators.slice(0, 15).map((c, i) => {
          const g = c.cqr.Good, a = c.cqr.Average, p = c.cqr.Poor;
          const cqrTotal = g + a + p || 1;
          const nameEl = c.profileUrl
            ? `<a href="${c.profileUrl}" target="_blank">${c.name}</a>`
            : c.name;
          const platformPills = [
            c.igViews > 0 ? '<span class="cl-pill ig">IG</span>' : '',
            c.ttViews > 0 ? '<span class="cl-pill tt">TT</span>' : '',
            c.fbViews > 0 ? '<span class="cl-pill fb">FB</span>' : '',
          ].join('');
          const viewBarPct = Math.round(c.totalViews / maxViews * 100);
          const hookColor = c.avgHook >= 30 ? '#16a34a' : c.avgHook >= 20 ? '#d97706' : '#dc2626';
          return `<tr>
            <td class="cl-rank ${rankLabels[i] || ''}">${i + 1}</td>
            <td class="cl-name">${nameEl}</td>
            <td style="text-align:center;font-weight:700;">${c.videos}</td>
            <td>
              <div class="cl-bar-wrap">
                <div class="cl-bar-track">
                  <div class="cl-bar-fill" style="width:${viewBarPct}%;background:#7c3aed;"></div>
                </div>
                <div class="cl-val">${kpi.fmtNum(c.totalViews)}</div>
              </div>
            </td>
            <td style="text-align:center;font-weight:700;color:${hookColor}">${c.avgHook > 0 ? kpi.pct(c.avgHook) : '—'}</td>
            <td>
              ${g + a + p > 0 ? `
              <div class="cqr-mini-bar">
                ${g > 0 ? `<div style="flex:${g};background:#16a34a;" title="${g} Good"></div>` : ''}
                ${a > 0 ? `<div style="flex:${a};background:#d97706;" title="${a} Avg"></div>` : ''}
                ${p > 0 ? `<div style="flex:${p};background:#dc2626;" title="${p} Poor"></div>` : ''}
              </div>
              <div style="font-size:9px;color:var(--c-muted);margin-top:2px;">${g}G / ${a}A / ${p}P</div>
              ` : '<span style="color:var(--c-muted);font-size:10px;">No paid data</span>'}
            </td>
            <td><div class="cl-platform-pills">${platformPills}</div></td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
  `;
  const lbWrap = document.getElementById('creator-leaderboard-wrap');
  if (lbWrap) lbWrap.innerHTML = leaderboardHTML;
}

// ── Section 4: Paid Platform Efficiency ──────────────────────────────────────
function renderSection4(allData) {
  const co = kpi.colors();

  const getPlat = (plat) => allData.filter(d => {
    if (plat === 'meta')   return d.platform === 'meta'   || (d.platform === 'both' && d._meta);
    if (plat === 'tiktok') return d.platform === 'tiktok' || (d.platform === 'both' && d._tt);
    return false;
  }).map(d => {
    if (plat === 'meta'   && d.platform === 'both') return d._meta;
    if (plat === 'tiktok' && d.platform === 'both') return d._tt;
    return d;
  }).filter(Boolean);

  const meta = getPlat('meta');
  const tt   = getPlat('tiktok');

  const sum = (arr, k) => arr.reduce((s, d) => s + kpi.safeNum(d[k]), 0);
  const safe = (n, d) => d ? n / d : 0;

  const metaSpend = sum(meta, 'spend');
  const metaReach = sum(meta, 'reach');
  const metaImpr  = sum(meta, 'impressions');
  const ttSpend   = sum(tt,   'spend');
  const ttReach   = sum(tt,   'reach');
  const ttImpr    = sum(tt,   'impressions');

  const metaCPR = safe(metaSpend, metaReach) * 1000;   // CPM reach
  const ttCPR   = safe(ttSpend,   ttReach)   * 1000;
  const metaCPI = safe(metaSpend, metaImpr)  * 1000;   // CPM impr
  const ttCPI   = safe(ttSpend,   ttImpr)    * 1000;

  const metaWatch = kpi.avg(meta.filter(d => d.watchTime > 0), 'watchTime');
  const ttWatch   = kpi.avg(tt.filter(d => d.watchTime > 0),   'watchTime');
  const metaVtr   = kpi.avg(meta.filter(d => d.vtr > 0),       'vtr');
  const ttVtr     = kpi.avg(tt.filter(d => d.vtr > 0),         'vtr');

  // Cost efficiency chart (grouped bar)
  kpi.make('chart-cost-eff', 'bar', {
    labels: ['CPM by Reach ($)', 'CPM by Impressions ($)'],
    datasets: [
      { label: 'Meta', data: [parseFloat(metaCPR.toFixed(2)), parseFloat(metaCPI.toFixed(2))],
        backgroundColor: '#1877f2', borderRadius: 5 },
      { label: 'TikTok', data: [parseFloat(ttCPR.toFixed(2)), parseFloat(ttCPI.toFixed(2))],
        backgroundColor: '#ff0050', borderRadius: 5 },
    ]
  }, {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: kpi.legendDefaults(co) },
    scales: {
      y: { ...kpi.scaleDefaults(co), beginAtZero: true,
        ticks: { ...kpi.scaleDefaults(co).ticks, callback: v => '$' + v.toFixed(2) }
      },
      x: { ...kpi.scaleDefaults(co) }
    }
  });

  // Attention metrics chart
  kpi.make('chart-attention', 'bar', {
    labels: ['Avg Watch Time (s)', 'Avg VTR %'],
    datasets: [
      { label: 'Meta',   data: [parseFloat(metaWatch.toFixed(1)), parseFloat(metaVtr.toFixed(1))],
        backgroundColor: '#1877f2', borderRadius: 5 },
      { label: 'TikTok', data: [parseFloat(ttWatch.toFixed(1)),   parseFloat(ttVtr.toFixed(1))],
        backgroundColor: '#ff0050', borderRadius: 5 },
    ]
  }, {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: kpi.legendDefaults(co) },
    scales: {
      y: { ...kpi.scaleDefaults(co), beginAtZero: true },
      x: { ...kpi.scaleDefaults(co) }
    }
  });

  // Platform comparison table
  const win = (a, b, lowerIsBetter = false) => {
    if (!a && !b) return ['—', '—'];
    const aWins = lowerIsBetter ? a < b : a > b;
    return [
      a ? `<span class="${aWins ? 'plat-win' : 'plat-lose'}">${typeof a === 'number' ? a.toFixed(2) : a}</span>` : '—',
      b ? `<span class="${!aWins ? 'plat-win' : 'plat-lose'}">${typeof b === 'number' ? b.toFixed(2) : b}</span>` : '—',
    ];
  };

  const metaHook = kpi.avg(meta.filter(d => d.hookRate > 0), 'hookRate');
  const ttHook   = kpi.avg(tt.filter(d => d.hookRate > 0),   'hookRate');
  const metaHold = kpi.avg(meta.filter(d => d.holdRate > 0), 'holdRate');
  const ttHold   = kpi.avg(tt.filter(d => d.holdRate > 0),   'holdRate');

  const rows = [
    ['Total Spend',            kpi.fmtMoney(metaSpend), kpi.fmtMoney(ttSpend), false, false],
    ['Total Reach',            kpi.fmtNum(metaReach),   kpi.fmtNum(ttReach),   false, false],
    ['Total Impressions',      kpi.fmtNum(metaImpr),    kpi.fmtNum(ttImpr),    false, false],
    ['CPM by Reach ($)',       metaCPR, ttCPR, true, true],
    ['CPM by Impressions ($)', metaCPI, ttCPI, true, true],
    ['Avg Watch Time (s)',     metaWatch, ttWatch, false, true],
    ['Avg VTR %',              metaVtr, ttVtr, false, true],
    ['Avg Hook Rate %',        metaHook, ttHook, false, true],
    ['Avg Hold Rate',          metaHold, ttHold, false, true],
    ['Active Ads',             meta.filter(d=>d.adStatus==='ACTIVE').length, tt.filter(d=>d.adStatus==='ACTIVE').length, false, false],
  ];

  const platTableWrap = document.getElementById('plat-table-wrap');
  if (platTableWrap) {
    platTableWrap.innerHTML = `
      <table class="plat-table">
        <thead>
          <tr>
            <th>Metric</th>
            <th style="color:#1877f2">📘 Meta</th>
            <th style="color:#ff0050">📱 TikTok</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(([label, a, b, lowerIsBetter, isNum]) => {
            if (!isNum) return `<tr><td>${label}</td><td>${a}</td><td>${b}</td></tr>`;
            const [av, bv] = win(a, b, lowerIsBetter);
            return `<tr><td>${label}</td><td>${av}</td><td>${bv}</td></tr>`;
          }).join('')}
        </tbody>
      </table>
      <div style="font-size:10px;color:var(--c-muted);margin-top:8px;padding:0 4px;">
        ✅ Green = better performing platform for that metric
      </div>
    `;
  }
}
