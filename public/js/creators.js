/* =====================================================================
   creators.js — Creator deep dive
   New file: public/js/creators.js

   Reads the same global ALL array the other tabs use. Nothing new is
   fetched, so no backend change is needed.

   Design notes:
   - The TABLE is the primary object, not the charts. Everything is
     searchable and sortable; nothing is capped at "top 8".
   - A minimum-videos filter exists because a creator with one lucky
     asset otherwise outranks one with eight consistent ones.
   - Consistency is shown as the CQR spread, not only the mean. Four
     assets scoring G/G/G/A is a different proposition from G/P/G/P at
     the same average.
   - Cost columns appear only when paid spend is actually attributed.
     With creative_id matching incomplete they would read zero, and a
     confident zero is worse than an honest gap.
   ===================================================================== */

let CREATOR_SORT = { key: 'totalViews', dir: 'desc' };
let CREATOR_SEARCH = '';
let CREATOR_MIN_VIDEOS = 1;
let CREATOR_PLATFORM = 'all';
let SELECTED_CREATOR = null;

// ---------------------------------------------------------------------
//  Aggregate ALL into one row per creator
// ---------------------------------------------------------------------
function buildCreators() {
  const src = (typeof ALL !== 'undefined' ? ALL : [])
    .filter(d => d.type === 'Others Say' && d.creatorProfile);

  const map = {};
  src.forEach(d => {
    const info = (typeof extractCreatorInfo === 'function')
      ? extractCreatorInfo(d.creatorProfile, d.ttLink) : null;
    const name = (info && info.username) || d.creatorProfile;
    if (!name) return;

    if (!map[name]) map[name] = {
      name, profileUrl: (info && info.profileUrl) || null,
      assets: [], igViews: 0, ttViews: 0, fbViews: 0,
      watch: [], hooks: [], holds: [],
      spend: 0, paidAssets: 0,
      cqr: { Good: 0, Average: 0, Poor: 0 },
      orgCqr: { Good: 0, Average: 0, Poor: 0 },
      igCount: 0, ttCount: 0, fbCount: 0,
      igEng: [], ttEng: []
    };
    const c = map[name];
    c.assets.push(d);

    if (d.igOrganic) {
      c.igViews += d.igOrganic.views || 0; c.igCount++;
      if (d.igOrganic.avgWatchTime > 0) c.watch.push(d.igOrganic.avgWatchTime);
      if (d.igOrganic.engagementRate) c.igEng.push(d.igOrganic.engagementRate);
      if (c.orgCqr[d.igOrganic.cqr] !== undefined) c.orgCqr[d.igOrganic.cqr]++;
    }
    if (d.ttOrganic) {
      c.ttViews += d.ttOrganic.views || 0; c.ttCount++;
      if (d.ttOrganic.avgWatchTime > 0) c.watch.push(d.ttOrganic.avgWatchTime);
      if (d.ttOrganic.engagementRate) c.ttEng.push(d.ttOrganic.engagementRate);
      if (c.orgCqr[d.ttOrganic.cqr] !== undefined) c.orgCqr[d.ttOrganic.cqr]++;
    }
    if (d.fbOrganic) {
      c.fbViews += d.fbOrganic.videoViews || d.fbOrganic.views || 0; c.fbCount++;
      if (c.orgCqr[d.fbOrganic.cqr] !== undefined) c.orgCqr[d.fbOrganic.cqr]++;
    }

    if (d.spend > 0) {
      c.spend += d.spend; c.paidAssets++;
      if (d.hookRate > 0) c.hooks.push(d.hookRate);
      if (d.holdRate > 0) c.holds.push(d.holdRate);
      if (c.cqr[d.cqr] !== undefined) c.cqr[d.cqr]++;
    }
  });

  const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;

  return Object.values(map).map(c => {
    const totalViews = c.igViews + c.ttViews + c.fbViews;
    const scored = c.orgCqr.Good + c.orgCqr.Average + c.orgCqr.Poor;
    // Share of scored organic posts that were Good or Average. This is
    // the number worth renewing a partnership on — a mean CQR hides
    // whether the good result was repeatable.
    const validRate = scored ? (c.orgCqr.Good + c.orgCqr.Average) / scored * 100 : null;
    return {
      ...c,
      videos: c.assets.length,
      totalViews,
      avgViews: c.assets.length ? totalViews / c.assets.length : 0,
      avgWatch: mean(c.watch),
      avgHook: mean(c.hooks),
      avgHold: mean(c.holds),
      avgIgEng: mean(c.igEng),
      avgTtEng: mean(c.ttEng),
      validRate,
      costPerView: c.spend > 0 && totalViews > 0 ? c.spend / totalViews * 1000 : null,
      platforms: [c.igCount ? 'IG' : '', c.ttCount ? 'TT' : '', c.fbCount ? 'FB' : ''].filter(Boolean)
    };
  });
}

function filteredCreators() {
  let list = buildCreators();
  if (CREATOR_SEARCH) {
    const q = CREATOR_SEARCH.toLowerCase();
    list = list.filter(c => c.name.toLowerCase().includes(q));
  }
  if (CREATOR_MIN_VIDEOS > 1) list = list.filter(c => c.videos >= CREATOR_MIN_VIDEOS);
  if (CREATOR_PLATFORM !== 'all') {
    list = list.filter(c => c.platforms.includes(CREATOR_PLATFORM));
  }
  const k = CREATOR_SORT.key, dir = CREATOR_SORT.dir === 'asc' ? 1 : -1;
  return list.sort((a, b) => {
    const av = a[k], bv = b[k];
    if (typeof av === 'string') return av.localeCompare(bv) * dir;
    return ((av ?? -1) - (bv ?? -1)) * dir;
  });
}

function sortCreators(key) {
  if (CREATOR_SORT.key === key) {
    CREATOR_SORT.dir = CREATOR_SORT.dir === 'desc' ? 'asc' : 'desc';
  } else {
    CREATOR_SORT = { key, dir: 'desc' };
  }
  renderCreatorTab();
}

function setCreatorSearch(v) { CREATOR_SEARCH = v; renderCreatorTab(); }
function setCreatorMinVideos(v) { CREATOR_MIN_VIDEOS = parseInt(v) || 1; renderCreatorTab(); }
function setCreatorPlatform(v) { CREATOR_PLATFORM = v; renderCreatorTab(); }

// ---------------------------------------------------------------------
//  Render
// ---------------------------------------------------------------------
function renderCreatorTab() {
  const page = document.getElementById('page-creators');
  if (!page) return;

  const all = buildCreators();
  const list = filteredCreators();

  if (all.length === 0) {
    page.innerHTML = `<div class="content"><div class="organic-empty">
      No creator content for ${typeof BRAND_NAME !== 'undefined' ? BRAND_NAME : 'this brand'} yet.
      Creators appear here once Others Say assets are added.
    </div></div>`;
    return;
  }

  const totalAssets = all.reduce((s, c) => s + c.videos, 0);
  const totalViews  = all.reduce((s, c) => s + c.totalViews, 0);
  const withPaid    = all.filter(c => c.spend > 0);
  const scoredAll   = all.filter(c => c.validRate !== null);
  const avgValid    = scoredAll.length
    ? scoredAll.reduce((s, c) => s + c.validRate, 0) / scoredAll.length : null;

  const th = (key, label, width) =>
    `<th style="${width ? `width:${width};` : ''}cursor:pointer" onclick="sortCreators('${key}')">
       ${label}${CREATOR_SORT.key === key ? (CREATOR_SORT.dir === 'desc' ? ' ↓' : ' ↑') : ''}
     </th>`;

  const maxViews = Math.max(...list.map(c => c.totalViews), 1);

  page.innerHTML = `
  <div class="content">

    <div class="kpi-row" style="grid-template-columns:repeat(4,1fr)">
      <div class="kpi">
        <div class="kpi-label">Creators</div>
        <div class="kpi-val">${all.length}</div>
        <div class="kpi-sub">${totalAssets} assets produced</div>
      </div>
      <div class="kpi">
        <div class="kpi-label">Creator Views</div>
        <div class="kpi-val">${fmtN(totalViews)}</div>
        <div class="kpi-sub">Across IG, TikTok and Facebook</div>
      </div>
      <div class="kpi">
        <div class="kpi-label">Validation Rate</div>
        <div class="kpi-val">${avgValid !== null ? avgValid.toFixed(0) + '%' : '—'}</div>
        <div class="kpi-sub">${avgValid !== null ? 'Posts scoring Good or Average' : 'No scored organic posts yet'}</div>
      </div>
      <div class="kpi">
        <div class="kpi-label">Amplified</div>
        <div class="kpi-val">${withPaid.length}</div>
        <div class="kpi-sub">Creators with paid spend behind them</div>
      </div>
    </div>

    <div class="grid-header">
      <div class="grid-header-title">${list.length} of ${all.length} creators</div>
      <div class="filters" style="flex:0 1 auto;margin-top:0">
        <input class="search-input" placeholder="Search creator..."
               value="${CREATOR_SEARCH}" oninput="setCreatorSearch(this.value)">
        <select onchange="setCreatorPlatform(this.value)">
          <option value="all"${CREATOR_PLATFORM === 'all' ? ' selected' : ''}>All platforms</option>
          <option value="IG"${CREATOR_PLATFORM === 'IG' ? ' selected' : ''}>Instagram</option>
          <option value="TT"${CREATOR_PLATFORM === 'TT' ? ' selected' : ''}>TikTok</option>
          <option value="FB"${CREATOR_PLATFORM === 'FB' ? ' selected' : ''}>Facebook</option>
        </select>
        <select onchange="setCreatorMinVideos(this.value)">
          <option value="1"${CREATOR_MIN_VIDEOS === 1 ? ' selected' : ''}>All creators</option>
          <option value="2"${CREATOR_MIN_VIDEOS === 2 ? ' selected' : ''}>2+ assets</option>
          <option value="3"${CREATOR_MIN_VIDEOS === 3 ? ' selected' : ''}>3+ assets</option>
          <option value="5"${CREATOR_MIN_VIDEOS === 5 ? ' selected' : ''}>5+ assets</option>
        </select>
      </div>
    </div>

    <div class="chart-box" style="padding:0;overflow-x:auto">
      <table class="kpi-table">
        <thead><tr>
          ${th('name','Creator')}
          ${th('videos','Assets','70px')}
          ${th('totalViews','Total Views','150px')}
          ${th('avgViews','Avg / Asset','100px')}
          ${th('avgWatch','Avg Watch','90px')}
          ${th('avgHook','Hook Rate','90px')}
          ${th('validRate','Validated','150px')}
          <th style="width:80px">Platforms</th>
        </tr></thead>
        <tbody>
          ${list.map(c => {
            const g = c.orgCqr.Good, a = c.orgCqr.Average, p = c.orgCqr.Poor;
            const nameEl = c.profileUrl
              ? `<a href="${c.profileUrl}" target="_blank" class="creator-link">${c.name}</a>`
              : c.name;
            // A single-asset creator's averages are not a track record.
            const thin = c.videos < 2
              ? `<span class="tag-duration" title="Single asset — not yet a pattern">1 asset</span>` : '';
            return `<tr style="cursor:pointer" onclick="openCreatorDetail('${c.name.replace(/'/g,"\\'")}')">
              <td><div style="display:flex;align-items:center;gap:6px">${nameEl}${thin}</div></td>
              <td>${c.videos}</td>
              <td>
                <div style="display:flex;align-items:center;gap:8px;justify-content:flex-end">
                  <div class="mini-bar-track" style="flex:1;max-width:70px">
                    <div class="mini-bar-fill" style="width:${Math.round(c.totalViews/maxViews*100)}%;background:var(--violet)"></div>
                  </div>
                  <span>${fmtN(c.totalViews)}</span>
                </div>
              </td>
              <td>${fmtN(Math.round(c.avgViews))}</td>
              <td>${c.avgWatch > 0 ? c.avgWatch.toFixed(1) + 's' : '—'}</td>
              <td>${c.avgHook > 0 ? c.avgHook.toFixed(1) + '%' : '—'}</td>
              <td>
                ${g + a + p > 0 ? `
                  <div style="display:flex;height:4px;border-radius:2px;overflow:hidden;min-width:60px">
                    ${g ? `<div style="flex:${g};background:var(--pos-ink)"></div>` : ''}
                    ${a ? `<div style="flex:${a};background:var(--warn-ink)"></div>` : ''}
                    ${p ? `<div style="flex:${p};background:var(--neg-ink)"></div>` : ''}
                  </div>
                  <div style="font:500 11px var(--font-mono);color:var(--ink-400);margin-top:4px">
                    ${g}G / ${a}A / ${p}P
                  </div>` : '<span class="kpi-muted">Not scored</span>'}
              </td>
              <td>${c.platforms.map(pl => `<span class="tag-duration">${pl}</span>`).join(' ')}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>

    <div class="charts-row" style="margin-top:24px">
      <div class="chart-box">
        <div class="chart-box-title">Platform split — views per creator</div>
        <div class="chart-container" style="height:260px"><canvas id="cr-platform"></canvas></div>
      </div>
      <div class="chart-box">
        <div class="chart-box-title">Consistency — assets vs validation rate</div>
        <div class="chart-container" style="height:260px"><canvas id="cr-consistency"></canvas></div>
      </div>
    </div>

  </div>`;

  drawCreatorCharts(list);
}

// ---------------------------------------------------------------------
//  Charts. Two, both answering questions the table cannot.
// ---------------------------------------------------------------------
let crPlatformChart = null, crConsistChart = null;

function drawCreatorCharts(list) {
  if (crPlatformChart) crPlatformChart.destroy();
  if (crConsistChart)  crConsistChart.destroy();

  const grid = '#E6E8F0', tick = '#6B7196';
  const top = list.slice(0, 10);

  crPlatformChart = new Chart(document.getElementById('cr-platform'), {
    type: 'bar',
    data: {
      labels: top.map(c => c.name.length > 14 ? c.name.slice(0, 12) + '…' : c.name),
      datasets: [
        { label: 'Instagram', data: top.map(c => c.igViews), backgroundColor: '#000050' },
        { label: 'TikTok',    data: top.map(c => c.ttViews), backgroundColor: '#31117C' },
        { label: 'Facebook',  data: top.map(c => c.fbViews), backgroundColor: '#6E5BD6' }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { labels: { color: tick, font: { size: 11 }, boxWidth: 10 } } },
      scales: {
        x: { stacked: true, grid: { display: false }, ticks: { color: tick, font: { size: 10 } } },
        y: { stacked: true, grid: { color: grid }, ticks: { color: tick, callback: v => fmtN(v) } }
      }
    }
  });

  // Volume on one axis, validation rate on the other. Top-right is a
  // creator worth renewing; bottom-right is volume without quality.
  const pts = list.filter(c => c.validRate !== null);
  crConsistChart = new Chart(document.getElementById('cr-consistency'), {
    type: 'scatter',
    data: {
      datasets: [{
        label: 'Creators',
        data: pts.map(c => ({ x: c.videos, y: c.validRate, name: c.name })),
        backgroundColor: '#31117C', pointRadius: 6, pointHoverRadius: 8
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: {
          label: ctx => `${ctx.raw.name}: ${ctx.raw.x} assets, ${ctx.raw.y.toFixed(0)}% validated`
        }}
      },
      scales: {
        x: { title: { display: true, text: 'Assets produced', color: tick, font: { size: 11 } },
             beginAtZero: true, grid: { color: grid }, ticks: { color: tick, precision: 0 } },
        y: { title: { display: true, text: '% validated', color: tick, font: { size: 11 } },
             min: 0, max: 100, grid: { color: grid }, ticks: { color: tick, callback: v => v + '%' } }
      }
    }
  });
}

// ---------------------------------------------------------------------
//  Detail — one creator's assets, so the conversation moves from
//  "this creator is good" to "this asset worked, and here is why"
// ---------------------------------------------------------------------
function openCreatorDetail(name) {
  const c = buildCreators().find(x => x.name === name);
  if (!c) return;
  SELECTED_CREATOR = name;

  const rows = c.assets.map(a => {
    const orgs = [
      a.igOrganic ? { p: 'IG', o: a.igOrganic } : null,
      a.ttOrganic ? { p: 'TT', o: a.ttOrganic } : null,
      a.fbOrganic ? { p: 'FB', o: a.fbOrganic } : null
    ].filter(Boolean);
    return `<tr>
      <td>${a.short || a.id}</td>
      <td>${a.campaign || '—'}</td>
      <td>${a.duration ? a.duration + 's' : '—'}</td>
      <td>${orgs.map(x => `${x.p} ${fmtN(x.o.views || 0)}`).join('<br>') || '—'}</td>
      <td>${orgs.map(x => `<span class="kpi-pill ${cqrClass(x.o.cqr)}">${x.o.cqr || '—'}</span>`).join(' ') || '—'}</td>
      <td>${a.spend > 0 ? fmt(a.spend) : '<span class="kpi-muted">Not boosted</span>'}</td>
      <td>${a.spend > 0 ? `<span class="kpi-pill ${cqrClass(a.cqr)}">${a.cqr}</span>` : '—'}</td>
    </tr>`;
  }).join('');

  document.getElementById('creativeModalContent').innerHTML = `
    <div class="cm-body">
      <div class="detail-header">
        <div>
          <div class="detail-title">${c.profileUrl ? `<a href="${c.profileUrl}" target="_blank" class="creator-link">${c.name}</a>` : c.name}</div>
          <div class="detail-meta">${c.videos} assets · ${fmtN(c.totalViews)} views · ${c.platforms.join(' · ')}</div>
        </div>
        <button class="close-btn" onclick="closeCreativeModal({target:{id:'creativeModalOverlay'}})">×</button>
      </div>

      <div class="detail-metrics" style="margin-bottom:20px">
        <div class="dm"><div class="dm-label">Avg views / asset</div><div class="dm-val">${fmtN(Math.round(c.avgViews))}</div></div>
        <div class="dm"><div class="dm-label">Avg watch time</div><div class="dm-val">${c.avgWatch > 0 ? c.avgWatch.toFixed(1) + 's' : '—'}</div></div>
        <div class="dm"><div class="dm-label">Validated</div><div class="dm-val">${c.validRate !== null ? c.validRate.toFixed(0) + '%' : '—'}</div>
          <div style="font:400 12px var(--font-ui);color:var(--ink-500);margin-top:4px">${c.orgCqr.Good}G / ${c.orgCqr.Average}A / ${c.orgCqr.Poor}P</div></div>
        <div class="dm"><div class="dm-label">Paid spend</div><div class="dm-val">${c.spend > 0 ? fmt(c.spend) : '—'}</div>
          <div style="font:400 12px var(--font-ui);color:var(--ink-500);margin-top:4px">${c.paidAssets} of ${c.videos} amplified</div></div>
      </div>

      <div class="chart-box" style="padding:0;overflow-x:auto">
        <table class="kpi-table">
          <thead><tr>
            <th>Asset</th><th>Campaign</th><th style="width:60px">Length</th>
            <th style="width:120px">Organic views</th><th style="width:140px">Organic CQR</th>
            <th style="width:100px">Spend</th><th style="width:90px">Paid CQR</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;

  document.getElementById('creativeModalOverlay').style.display = 'flex';
}
