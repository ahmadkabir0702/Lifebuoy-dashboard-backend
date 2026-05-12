// Helper for Excel column letters
function colName(n) {
    let ordA = 'A'.charCodeAt(0);
    let ordZ = 'Z'.charCodeAt(0);
    let len = ordZ - ordA + 1;
    let s = "";
    while(n >= 0) { s = String.fromCharCode(n % len + ordA) + s; n = Math.floor(n / len) - 1; }
    return s;
}

// Bulletproof number parser (strips out currency symbols, %, etc)
const parseNum = (val) => {
    if (typeof val === 'number') return val;
    if (!val || val === 'Not Found' || val === '-') return 0;
    const cleaned = String(val).replace(/[^0-9.-]+/g, "");
    return parseFloat(cleaned) || 0;
};

let META = [], TT = [], ALL = [];
let IG_ORG = {}, FB_ORG = {}, TT_ORG = {};
let META_RECS = {}, TT_RECS = {};
let ALL_CONTENT = [], PAID_IDS = new Set();
let currentPlatform = 'both', currentSort = 'hook', sortAscending = false, selectedId = null;
let chartsInit = {};

async function loadData() {
  document.getElementById('kpi-row').innerHTML = `<div style="grid-column:1/-1;padding:20px;color:var(--c-muted)">⏳ Loading data...</div>`;

  try {
    const response = await fetch('/api/dashboard-data');
    if (!response.ok) throw new Error("Backend connection failed.");
    
    // Explicit array mapping matches server.js exactly
    const [mR, tR, mRecR, tRecR, bsR, osR, igR, fbR, ttOrgR] = await response.json();

    META_RECS = parseRecs(mRecR || [], 'Recommendation - Meta');
    TT_RECS   = parseRecs(tRecR || [], 'Recommendation - Tiktok');

    META = parsePaid(mR || [], 'meta');
    TT   = parsePaid(tR || [], 'tiktok');

    IG_ORG = parseOrganic(igR || [], 'ig');
    FB_ORG = parseOrganic(fbR || [], 'fb');
    TT_ORG = parseOrganic(ttOrgR || [], 'tt');

    processContent(bsR || [], osR || []);
    enrichCreatives();

    ALL = mergeAllCreatives(META, TT);

    if (ALL.length === 0) {
      document.getElementById('kpi-row').innerHTML = `<div style="grid-column:1/-1;padding:20px;color:var(--c-avg)">No creatives found in data.</div>`;
      return;
    }

    populateFilters();
    render();
  } catch(err) {
    document.getElementById('kpi-row').innerHTML = `<div style="grid-column:1/-1;padding:20px;color:var(--c-poor)">Error: ${err.message}</div>`;
    console.error(err);
  }
}

function mergeAllCreatives(metaData, ttData) {
  const mergedMap = {};

  ALL_CONTENT.forEach(c => {
      mergedMap[c.id] = { 
          ...c, platforms: [], _meta: null, _tt: null, 
          spend: 0, reach: 0, impressions: 0, hookRate: 0, holdRate: 0, watchTime: 0, vtr: 0, vp: 1, 
          ret: [100, 0, 0, 0, 0, 0], adStatus: 'STOPPED', cqr: 'Invalid' 
      };
  });

  const addPaid = (c, source) => {
    if (!mergedMap[c.id]) mergedMap[c.id] = { ...c, platforms: [] }; 
    const e = mergedMap[c.id];
    e.platforms.push(c.platform);
    if (e.platform !== 'both') e.platform = e.platforms.length > 1 ? 'both' : c.platform;
    
    e.spend += c.spend;
    e.reach += c.reach;
    e.impressions += c.impressions;
    e.holdRate = Math.max(e.holdRate, c.holdRate); 
    e.hookRate = e.hookRate ? (e.hookRate + c.hookRate) / 2 : c.hookRate;
    e.watchTime = e.watchTime ? (e.watchTime + c.watchTime) / 2 : c.watchTime;
    e.vtr = e.vtr ? (e.vtr + c.vtr) / 2 : c.vtr;
    e.adStatus = (e.adStatus === 'ACTIVE' || c.adStatus === 'ACTIVE') ? 'ACTIVE' : 'STOPPED';
    
    const order = {Good:0, Average:1, Poor:2, Invalid:3};
    if ((order[c.cqr] || 4) < (order[e.cqr] || 4)) e.cqr = c.cqr;

    if (source === 'meta') e._meta = c;
    if (source === 'tiktok') e._tt = c;
  };

  metaData.forEach(c => addPaid(c, 'meta'));
  ttData.forEach(c => addPaid(c, 'tiktok'));

  return Object.values(mergedMap).map(d => {
      let minCqr = 3; 
      const order = {Good:0, Average:1, Poor:2};
      ['igOrganic', 'fbOrganic', 'ttOrganic'].forEach(p => {
          if (d[p] && d[p].cqr && order[d[p].cqr] !== undefined) {
              minCqr = Math.min(minCqr, order[d[p].cqr]);
          }
      });
      
      d.isValidated = minCqr <= 1;
      d.bestOrgCqr = minCqr === 0 ? 'Good' : (minCqr === 1 ? 'Average' : null);
      d.isBoosted = d.spend > 0;
      d.needsBoostWarning = false;

      if (d.isValidated && !d.isBoosted) {
          const m = d.id.match(/_(\d{8})$/); 
          if (m) {
              const postDate = new Date(`${m[1].slice(0,4)}-${m[1].slice(4,6)}-${m[1].slice(6,8)}`);
              const hoursDiff = (new Date() - postDate) / (1000 * 60 * 60);
              if (hoursDiff > 48) d.needsBoostWarning = true;
          }
      }
      return d;
  });
}

function parsePaid(rows, platform) {
  if (!rows || rows.length < 2) return [];
  const headers = rows[0].map(h => String(h).trim().toLowerCase());
  const h = {};
  
  headers.forEach((name, i) => { 
      if (name.includes('creative id') || name.includes('ad name')) h['Creative ID'] = i;
      if (name.includes('spend') || name.includes('amount')) h['Spend'] = i;
      if (name.includes('reach')) h['Reach'] = i;
      if (name.includes('impressions')) h['Impressions'] = i;
      if (name.includes('hook rate')) h['Hook Rate %'] = i;
      if (name.includes('hook') && name.includes('quality')) h['Hook Rate (Quality)'] = i;
      if (name.includes('hold rate')) h['Hold Rate'] = i;
      if (name.includes('hold') && name.includes('quality')) h['Hold Rate (Quality)'] = i;
      if (name.includes('vtr')) h['VTR %'] = i;
      if (name.includes('watch time') || name.includes('play time')) h['Avg Watch Time (sec)'] = i;
      if (name === 'cqr' || name.includes('creative quality')) h['CQR'] = i;
      if (name.includes('status') || name.includes('delivery')) h['Ad Status'] = i;
      if (name.includes('video plays')) h['Video Plays'] = i;
      if (name.includes('25%')) h['25% Watched'] = i;
      if (name.includes('50%')) h['50% Watched'] = i;
      if (name.includes('75%')) h['75% Watched'] = i;
      if (name.includes('100%')) h['100% Watched'] = i;
  });

  const cqrOrder  = {Good:0, Average:1, Poor:2, Invalid:3};
  const avg       = arr => arr.length ? arr.reduce((s,v)=>s+v,0)/arr.length : 0;
  const isActive  = s => { const u=String(s).toUpperCase(); return u==='ACTIVE'||u==='ENABLE'; };
  const map       = {};

  rows.slice(1).forEach(row => {
    const creativeId = String(row[h['Creative ID']] || '').trim();
    if (!creativeId || creativeId==='Not Found' || !creativeId.startsWith('Lifebuoy')) return;

    const spend     = parseNum(row[h['Spend']]);
    const reach     = parseNum(row[h['Reach']]);
    const impr      = parseNum(row[h['Impressions']]);
    const hookRate  = parseNum(row[h['Hook Rate %']]);
    const hookQual  = String(row[h['Hook Rate (Quality)']] || '');
    const holdRate  = parseNum(row[h['Hold Rate']]);
    const holdQual  = String(row[h['Hold Rate (Quality)']] || '');
    const vtr       = parseNum(row[h['VTR %']]);
    const watchTime = parseNum(row[h['Avg Watch Time (sec)']]);
    const cqr       = String(row[h['CQR']] || '');
    const adSt      = String(row[h['Ad Status']] || '');
    const vp        = parseNum(row[h['Video Plays']]) || 1;
    const w25       = parseNum(row[h['25% Watched']]);
    const w50       = parseNum(row[h['50% Watched']]);
    const w75       = parseNum(row[h['75% Watched']]);
    const w100      = parseNum(row[h['100% Watched']]);

    if (!map[creativeId]) {
      map[creativeId] = {
        creativeId, spend:0, reach:0, impressions:0, hookRates:[], holdRates:[], vtrs:[], watchTimes:[],
        cqr:'', hookQual:'', holdQual:'', vp:0, w25:0, w50:0, w75:0, w100:0, hasActive:false
      };
    }
    const d = map[creativeId];
    d.spend += spend; d.reach = Math.max(d.reach, reach); d.impressions += impr;
    if (hookRate > 0) d.hookRates.push(hookRate);
    if (holdRate > 0) d.holdRates.push(holdRate);
    if (vtr > 0) d.vtrs.push(vtr);
    if (watchTime > 0) d.watchTimes.push(watchTime);
    d.vp += vp; d.w25 += w25; d.w50 += w50; d.w75 += w75; d.w100 += w100;
    if (isActive(adSt)) d.hasActive = true;
    if (!d.cqr || (cqrOrder[cqr]??9) < (cqrOrder[d.cqr]??9)) {
      d.cqr = cqr; d.hookQual = hookQual; d.holdQual = holdQual;
    }
  });

  const r1 = v => Math.round(v*10)/10;
  return Object.values(map).filter(d=>d.spend>0).map(d => {
    const vp = d.vp || 1;
    const m  = d.creativeId.match(/Video(\d+)_(BrandSay|OthersSay)/);
    return {
      id: d.creativeId, short: m ? `Video${m[1]} ${m[2]==='BrandSay'?'Brand Say':'Others Say'}` : d.creativeId,
      type: d.creativeId.includes('BrandSay') ? 'Brand Say' : 'Others Say',
      spend: Math.round(d.spend), reach: d.reach, impressions: d.impressions,
      hookRate: r1(avg(d.hookRates)), hookQual: d.hookQual, holdRate: r1(avg(d.holdRates)), holdQual: d.holdQual, 
      vtr: r1(avg(d.vtrs)), watchTime: r1(avg(d.watchTimes)), cqr: d.cqr, adStatus: d.hasActive ? 'ACTIVE' : 'STOPPED',
      ret: [100, r1(avg(d.hookRates)), r1(d.w25/vp*100), r1(d.w50/vp*100), r1(d.w75/vp*100), r1(d.w100/vp*100)],
      platform, month: getMonthFromId(d.creativeId), campaign: getCampaignFromId(d.creativeId),
      recommendation: '', actionStatus: '', actionBy: '', actionDate: '', agency: ''
    };
  });
}

function parseOrganic(rows, platform) {
  if (!rows || rows.length < 2) return {};
  const headers = rows[0].map(h => String(h).trim().toLowerCase());
  const h = {};
  headers.forEach((name, i) => { 
      if (name.includes('creative id')) h['Creative ID'] = i;
      if (name.includes('views') && !name.includes('video')) h['Views'] = i;
      if (name.includes('video views')) h['Video Views'] = i;
      if (name.includes('reach')) h['Reach'] = i;
      if (name.includes('likes')) h['Likes'] = i;
      if (name.includes('reactions')) h['Reactions'] = i;
      if (name.includes('comments')) h['Comments'] = i;
      if (name.includes('saves')) h['Saves'] = i;
      if (name.includes('shares')) h['Shares'] = i;
      if (name === 'cqr') h['CQR'] = i;
  });

  const map = {};
  rows.slice(1).forEach(row => {
    const id = String(row[h['Creative ID']] || '').trim();
    if (!id || !id.startsWith('Lifebuoy')) return;

    if (platform === 'ig') {
      const views = parseNum(row[h['Views']]);
      if (views > 0) map[id] = { views, reach: parseNum(row[h['Reach']]), likes: parseNum(row[h['Likes']]), comments: parseNum(row[h['Comments']]), saves: parseNum(row[h['Saves']]), shares: parseNum(row[h['Shares']]), cqr: String(row[h['CQR']] || '') };
    } else if (platform === 'fb') {
      const videoViews = parseNum(row[h['Video Views']]);
      const reactions  = parseNum(row[h['Reactions']]);
      if (videoViews > 0 || reactions > 0) map[id] = { videoViews, reactions, comments: parseNum(row[h['Comments']]), shares: parseNum(row[h['Shares']]), cqr: String(row[h['CQR']] || '') };
    } else if (platform === 'tt') {
      const views = parseNum(row[h['Views']]);
      if (views > 0) map[id] = { views, likes: parseNum(row[h['Likes']]), comments: parseNum(row[h['Comments']]), shares: parseNum(row[h['Shares']]), cqr: String(row[h['CQR']] || '') };
    }
  });
  return map;
}

function parseRecs(rows, sheetName) {
  if (!rows || rows.length < 2) return {};
  const headers = rows[0].map(h => String(h).trim().toLowerCase());
  const h = {};
  
  headers.forEach((name, i) => { 
    if (name.includes('recommendation')) h['Recommendations'] = i;
    if (name.includes('status') && !name.includes('action')) h['Ad Status'] = i;
    if (name.includes('action status')) h['Action Status'] = i;
    if (name.includes('actioned by')) h['Actioned By'] = i;
    if (name.includes('action date')) h['Action Date'] = i;
    if (name.includes('agency')) h['Assigned Agency'] = i;
    if (!h[name]) h[name] = i; 
  });

  const map = {};
  rows.slice(1).forEach((row, index) => {
    const id = String(row[0] || '').trim(); 
    if (!id || id === 'Not Found' || !id.startsWith('Lifebuoy')) return;
    map[id] = {
      status: String(row[h['Ad Status']] || '').trim(), recommendation: String(row[h['Recommendations']] || '').trim(),
      actionStatus: String(row[h['Action Status']] || '').trim(), actionBy: String(row[h['Actioned By']] || '').trim(),
      actionDate: String(row[h['Action Date']] || '').trim(), agency: String(row[h['Assigned Agency']] || '').trim(),
      sheetName: sheetName, rowNum: index + 2, 
      colStatus: h['Action Status'] !== undefined ? colName(h['Action Status']) : null,
      colBy: h['Actioned By'] !== undefined ? colName(h['Actioned By']) : null,
      colDate: h['Action Date'] !== undefined ? colName(h['Action Date']) : null,
      colAgency: h['Assigned Agency'] !== undefined ? colName(h['Assigned Agency']) : null
    };
  });
  return map;
}

function processContent(bsRows, osRows) {
  ALL_CONTENT = [];
  PAID_IDS = new Set([...META.map(c=>c.id), ...TT.map(c=>c.id)]);

  const parseSheet = (rows, type) => {
    if (!rows || rows.length < 2) return;
    const headers = rows[0].map(h => String(h).trim().toLowerCase());
    const h = {};
    headers.forEach((name, i) => { 
        if (name.includes('creative id')) h['Creative ID'] = i;
        if (name.includes('campaign')) h['Campaign'] = i;
        if (name === 'ig') h['IG'] = i;
        if (name === 'fb') h['FB'] = i;
        if (name === 'tt') h['TT'] = i;
        if (name.includes('repurposed')) h['Is Repurposed'] = i;
        if (name.includes('original creative')) h['Original Creative ID'] = i;
    });

    rows.slice(1).forEach(row => {
      const id = String(row[h['Creative ID']] || '').trim();
      if (!id || !id.startsWith('Lifebuoy')) return;
      
      const isRep = String(row[h['Is Repurposed']] || '').trim().toLowerCase() === 'yes';
      ALL_CONTENT.push({
        id, campaign: String(row[h['Campaign']] || '').trim() || getCampaignFromId(id),
        type, month: getMonthFromId(id), isPaid: PAID_IDS.has(id),
        igLink: String(row[h['IG']]||''), fbLink: String(row[h['FB']]||''), ttLink: String(row[h['TT']]||''),
        isRepurposed: isRep, originalId: String(row[h['Original Creative ID']] || '').trim()
      });
    });
  };

  parseSheet(bsRows, 'Brand Say');
  parseSheet(osRows, 'Others Say');
}

function enrichCreatives() {
  const contentMap = {};
  ALL_CONTENT.forEach(c => { contentMap[c.id] = c; });

  [...META, ...TT, ...ALL_CONTENT].forEach(c => {
    if (c.spend !== undefined) {
        const recs = c.platform === 'meta' ? META_RECS : TT_RECS;
        if (recs[c.id]) {
          if (recs[c.id].status) c.adStatus = recs[c.id].status;
          if (recs[c.id].recommendation) c.recommendation = recs[c.id].recommendation;
          c.actionStatus = recs[c.id].actionStatus; c.actionBy = recs[c.id].actionBy; 
          c.actionDate = recs[c.id].actionDate; c.agency = recs[c.id].agency; c.recDetails = recs[c.id]; 
        }
    }
    
    if (contentMap[c.id]) {
        c.isRepurposed = contentMap[c.id].isRepurposed;
        c.creativeLink = contentMap[c.id].igLink || contentMap[c.id].ttLink || contentMap[c.id].fbLink || '';
        
        const rawOrig = contentMap[c.id].originalId || '';
        c.originalName = rawOrig; c.originalUrl = ''; c.extractedOrigId = null;

        if (rawOrig) {
            const m = rawOrig.match(/(https?:\/\/[^\s_]+)/);
            if (m) c.originalUrl = m[1];
            if (rawOrig.includes('http')) c.originalName = rawOrig.split('_http')[0].replace(/_/g, ' ');
            const parts = rawOrig.split('_');
            if (parts.length >= 2) c.extractedOrigId = parts[0] + '_' + parts[1];
        }
    }
    c.igOrganic = IG_ORG[c.id] || null;
    c.fbOrganic = FB_ORG[c.id] || null;
    c.ttOrganic = TT_ORG[c.id] || null;
  });
}

function getMonthFromId(id) {
  const match = id.match(/_(\d{8})$/);
  if (!match) return 'Unknown';
  const d = match[1];
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[parseInt(d.substring(4,6))-1]} ${d.substring(0,4)}`;
}

function getCampaignFromId(id) {
  const parts = id.split('_');
  if (parts.length < 2) return 'Unknown';
  return parts[1].replace(/([A-Z])/g,' $1').trim();
}

function populateFilters() {
  const months    = [...new Set(ALL.map(d=>d.month))].filter(Boolean).sort();
  const campaigns = [...new Set(ALL.map(d=>d.campaign))].filter(Boolean).sort();

  const mSel = document.getElementById('month-filter');
  if(mSel) {
      mSel.innerHTML = '<option value="all">All months</option>';
      months.forEach(m => { const o = document.createElement('option'); o.value=m; o.textContent=m; mSel.appendChild(o); });
  }

  const cSel = document.getElementById('campaign-filter');
  if(cSel) {
      cSel.innerHTML = '<option value="all">All campaigns</option>';
      campaigns.forEach(c => { const o = document.createElement('option'); o.value=c; o.textContent=c; cSel.appendChild(o); });
  }
}

function setNav(page, el) {
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
  el.classList.add('active');
  currentPage = page;
  document.querySelectorAll('[id^=page-]').forEach(p=>p.classList.add('hidden'));
  document.getElementById('page-'+page).classList.remove('hidden');
  document.getElementById('topbar-title').textContent =
    {creatives:'Creative Hub',content:'Content Overview',overview:'Overview',meta:'Meta Paid',tiktok:'TikTok Paid'}[page]||page;
  if (page==='creatives') render();
}

function setPlatform(p, el) {
  currentPlatform = p;
  document.querySelectorAll('.pt').forEach(b=>b.classList.remove('active'));
  el.classList.add('active');
  selectedId = null;
  render();
}

function setSort(s, el) {
  currentSort = s;
  document.querySelectorAll('.sort-btn').forEach(b=>b.classList.remove('active'));
  el.classList.add('active');
  render();
}

function toggleSortDir() {
  sortAscending = !sortAscending;
  document.getElementById('sort-dir-btn').innerHTML = sortAscending ? '⬆ Asc' : '⬇ Desc';
  render();
}

// SAFE DOM RETRIEVAL 
function getData() {
  let data = ALL;

  if (currentPlatform === 'meta') data = ALL.filter(d => d.platform === 'meta' || d.platform === 'both').map(d => d.platform === 'both' ? d._meta : d);
  if (currentPlatform === 'tiktok') data = ALL.filter(d => d.platform === 'tiktok' || d.platform === 'both').map(d => d.platform === 'both' ? d._tt : d);

  const searchEl = document.getElementById('search-filter');
  const typeEl   = document.getElementById('type-filter');
  const monthEl  = document.getElementById('month-filter');
  const campEl   = document.getElementById('campaign-filter');
  const statEl   = document.getElementById('status-filter');

  const searchQ = searchEl ? searchEl.value.toLowerCase() : "";
  const tf      = typeEl   ? typeEl.value   : "all";
  const mf      = monthEl  ? monthEl.value  : "all";
  const campf   = campEl   ? campEl.value   : "all";
  const sf      = statEl   ? statEl.value   : "all";

  if (tf !== 'all') data = data.filter(d => d.type === tf);
  if (mf !== 'all') data = data.filter(d => d.month === mf);
  if (campf !== 'all') data = data.filter(d => d.campaign === campf);
  
  if (sf === 'ACTIVE') data = data.filter(d => d.adStatus === 'ACTIVE');
  if (sf === 'STOPPED') data = data.filter(d => d.adStatus === 'STOPPED');
  if (sf === 'VALIDATED_NOT_BOOSTED') data = data.filter(d => d.isValidated && !d.isBoosted);

  if (searchQ) data = data.filter(d => d.id.toLowerCase().includes(searchQ) || d.short.toLowerCase().includes(searchQ));

  return [...data].sort((a,b) => {
    let valA = 0, valB = 0;
    if (currentSort==='hook') { valA = a.hookRate; valB = b.hookRate; }
    else if (currentSort==='hold') { valA = a.holdRate; valB = b.holdRate; }
    else if (currentSort==='reach') { valA = a.reach; valB = b.reach; }
    else if (currentSort==='spend') { valA = a.spend; valB = b.spend; }
    else if (currentSort==='cqr') { const o={Good:0,Average:1,Poor:2,Invalid:3}; valB = (o[a.cqr]??4); valA = (o[b.cqr]??4); }
    return sortAscending ? valA - valB : valB - valA;
  });
}

function hookColor(v) { return v>=40?'#16a34a':v>=20?'#d97706':'#dc2626'; }
function cqrClass(c) { return {Good:'good-bg',Average:'avg-bg',Poor:'poor-bg',Invalid:'inv-bg'}[c]||'inv-bg'; }
function fmt(n) { return n>=1000000?'$'+(n/1000000).toFixed(1)+'M':n>=1000?'$'+(n/1000).toFixed(0)+'K':'$'+n; }
function fmtN(n) { return n>=1000000?(n/1000000).toFixed(1)+'M':n>=1000?(n/1000).toFixed(0)+'K':String(n); }

function render() {
  const data = getData();
  renderKPIs(data);
  renderCards(data);
}

function renderKPIs(data) {
  const totalAssets = data.length;
  const bsCount = data.filter(d=>d.type==='Brand Say').length;
  const osCount = data.filter(d=>d.type==='Others Say').length;
  const valCount = data.filter(d=>d.isValidated).length;
  const totalImp = data.reduce((s,d)=>s+(d.impressions||0), 0);
  
  let totalOrgViews = 0;
  data.forEach(d => {
      if (d.igOrganic) totalOrgViews += (d.igOrganic.views || 0);
      if (d.fbOrganic) totalOrgViews += (d.fbOrganic.videoViews || 0);
      if (d.ttOrganic) totalOrgViews += (d.ttOrganic.views || 0);
  });

  const row = document.getElementById('kpi-row');
  if(!row) return;

  row.innerHTML=`
    <div class="kpi"><div class="kpi-label">Total Assets</div><div class="kpi-val">${totalAssets}</div></div>
    <div class="kpi"><div class="kpi-label">BS vs OS Split</div><div class="kpi-val">${Math.round(bsCount/(totalAssets||1)*100)}% / ${Math.round(osCount/(totalAssets||1)*100)}%</div></div>
    <div class="kpi"><div class="kpi-label">Validated Assets</div><div class="kpi-val" style="color:var(--c-good)">${valCount}</div><div class="kpi-sub">Avg/Good Organic</div></div>
    <div class="kpi"><div class="kpi-label">Total Org Views</div><div class="kpi-val" style="color:var(--c-os)">${fmtN(totalOrgViews)}</div><div class="kpi-sub">IG, FB, TT Combined</div></div>
    <div class="kpi"><div class="kpi-label">Total Paid Impr.</div><div class="kpi-val">${fmtN(totalImp)}</div></div>`;
}

function renderCards(data) {
  const maxHook = Math.max(...data.map(d=>d.hookRate||0),1);
  const maxHold = Math.max(...data.map(d=>d.holdRate||0),1); 
  const maxReach = Math.max(...data.map(d=>d.reach||0),1);

  document.getElementById('grid-count').textContent = `${data.length} creatives`;
  document.getElementById('card-grid').innerHTML = data.map(d=>{
    const hkPct     = Math.round((d.hookRate/maxHook)*100);
    const hdPct     = Math.round((d.holdRate/maxHold)*100);
    const rchPct    = Math.round((d.reach/maxReach)*100);
    const isAct     = d.adStatus==='ACTIVE';
    
    let platHTML = d.platform === 'both' 
      ? `<span style="color:var(--c-meta);font-weight:700;font-size:10px">META</span> <span style="color:var(--c-muted)">&amp;</span> <span style="color:var(--c-tt);font-weight:700;font-size:10px">TT</span>`
      : `<span style="color:${d.platform==='tiktok'?'var(--c-tt)':'var(--c-meta)'};font-weight:700;font-size:10px">${d.platform==='tiktok'?'TT':'META'}</span>`;
    
    const hlValFormatted = d.holdRate >= 1000 ? (d.holdRate/1000).toFixed(1)+'K' : (d.holdRate||0).toFixed(1);
    const repTag = d.isRepurposed ? `<span style="background:#fef3c7;color:#b45309;padding:2px 5px;border-radius:4px;font-size:9px;font-weight:700;margin-left:4px;">REPURPOSED</span>` : '';

    return `<div class="card ${d.id===selectedId?'selected':''}" onclick="selectCard('${d.id}')">
      <div class="card-top"><div class="card-plat"><div class="status-dot ${isAct?'status-active-dot':'status-stopped-dot'}"></div>${platHTML}</div>
        <div><span class="card-type ${d.type==='Brand Say'?'bs-tag':'os-tag'}">${d.type==='Brand Say'?'BS':'OS'}</span>${repTag}</div>
      </div>
      <div class="card-name">${d.short}</div><div class="card-campaign">${d.campaign} · ${d.month}</div>
      <div class="mini-bars">
        <div class="mini-bar-row"><div class="mini-bar-label">Reach</div><div class="mini-bar-track"><div class="mini-bar-fill" style="width:${rchPct}%;background:#8b5cf6"></div></div><div class="mini-bar-val">${fmtN(d.reach)}</div></div>
        <div class="mini-bar-row"><div class="mini-bar-label">Hook</div><div class="mini-bar-track"><div class="mini-bar-fill" style="width:${hkPct}%;background:${hookColor(d.hookRate)}"></div></div><div class="mini-bar-val" style="color:${hookColor(d.hookRate)}">${(d.hookRate||0).toFixed(1)}%</div></div>
        <div class="mini-bar-row"><div class="mini-bar-label">Hold</div><div class="mini-bar-track"><div class="mini-bar-fill" style="width:${hdPct}%;background:#3b82f6"></div></div><div class="mini-bar-val">${hlValFormatted}</div></div>
      </div>
      <div class="card-footer"><span class="cqr-badge ${cqrClass(d.cqr)}">${d.cqr}</span><div class="spend-info"><div class="spend-label">Spend</div><div class="spend-val">${fmt(d.spend)}</div></div></div>
    </div>`;
  }).join('');
}

let retChart=null, radarChart=null;

function selectCard(id) {
  const item = ALL.find(d=>d.id===id);
  if (item) {
      document.getElementById('creativeModalOverlay').style.display = 'flex';
      renderDetail(item);
  }
}

function closeCreativeModal(e) {
  if (e && e.target.id === 'creativeModalOverlay') {
      document.getElementById('creativeModalOverlay').style.display = 'none';
      document.getElementById('creativeModalContent').innerHTML = '';
  }
}

function getMetricsHTML(item, titleLabel) {
  if (!item || !item.spend) return '';
  const cqrColorClass = item.cqr === 'Good' ? 'cqr-good' : (item.cqr === 'Average' ? 'cqr-avg' : 'cqr-poor');
  const hlValFormatted = item.holdRate >= 1000 ? (item.holdRate/1000).toFixed(1)+'K' : (item.holdRate||0).toFixed(1);
  return `
    <div style="margin-bottom:12px;">
      <div style="font-size:11px;font-weight:700;color:var(--c-muted);margin-bottom:6px;text-transform:uppercase;">${titleLabel} Paid Stats</div>
      <div class="detail-metrics" style="margin-bottom:6px;">
        <div class="dm"><div class="dm-label">CQR Rating</div><div class="dm-val big-cqr ${cqrColorClass}">${item.cqr||'—'}</div></div>
        <div class="dm"><div class="dm-label">Spend & Reach</div><div class="dm-val">${fmt(item.spend)}</div><div style="font-size:10px;color:var(--c-muted);margin-top:2px;">Reach: ${fmtN(item.reach)} | Impr: ${fmtN(item.impressions)}</div></div>
        <div class="dm"><div class="dm-label">Hook Rate</div><div class="dm-val" style="color:${hookColor(item.hookRate)}">${(item.hookRate||0).toFixed(1)}%</div><div><span class="kpi-pill ${cqrClass(item.hookQual)}">${item.hookQual||'—'}</span></div></div>
        <div class="dm"><div class="dm-label">Hold Rate</div><div class="dm-val" style="color:#3b82f6">${hlValFormatted}</div><div><span class="kpi-pill ${cqrClass(item.holdQual)}">${item.holdQual||'—'}</span></div></div>
      </div>
    </div>`;
}

function getRecHTML(item, titleLabel) {
  if (!item) return '';
  if (item.recommendation) {
      const isActioned = item.actionStatus && item.actionStatus.toLowerCase() === 'actioned';
      let actionBadge = isActioned 
        ? `<div class="sheet-rec-action">Actioned by ${item.actionBy||'Unknown'} on ${item.actionDate||'Date unknown'} (${item.agency||'Agency unassigned'})</div>`
        : `<div class="sheet-rec-action" style="color:#b45309">Pending action (${item.agency||'Agency unassigned'}) <button class="action-btn" onclick="openActionModal('${item.id}', '${titleLabel}')">Mark Actioned</button></div>`;
      
      return `<div class="sheet-rec"><div class="sheet-rec-content"><div class="sheet-rec-label">${titleLabel} Live Recommendation</div><div class="sheet-rec-text">${item.recommendation}</div>${actionBadge}</div></div>`;
  } else {
      return `<div class="sheet-rec" style="opacity: 0.6; border-color: var(--c-border); background: var(--c-surface);"><div class="sheet-rec-content"><div class="sheet-rec-label" style="color: var(--c-muted);">${titleLabel} Live Recommendation</div><div class="sheet-rec-text" style="color: var(--c-muted);">No recommendation provided.</div></div></div>`;
  }
}

function buildOrganicHTML(d) {
  const ig = d.igOrganic, fb = d.fbOrganic, tt = d.ttOrganic;
  if (!ig && !fb && !tt) return `<div class="organic-empty">No organic data available.</div>`;

  const box = (title, data, viewLbl, views) => {
    if(!data) return `<div class="organic-box"><div class="organic-platform">${title}</div><div class="organic-empty">No data</div></div>`;
    return `<div class="organic-box">
      <div class="organic-platform">${title}</div>
      <div class="organic-stat-row"><span class="organic-stat-label">${viewLbl}</span><span class="organic-stat-val">${fmtN(views)}</span></div>
      <div class="organic-stat-row"><span class="organic-stat-label">Likes/Reacts</span><span class="organic-stat-val">${fmtN(data.likes || data.reactions || 0)}</span></div>
      <div class="organic-stat-row"><span class="organic-stat-label">Shares</span><span class="organic-stat-val">${fmtN(data.shares || 0)}</span></div>
      <div style="margin-top:8px"><span class="val-badge ${data.cqr==='Good'?'val-good':(data.cqr==='Average'?'val-avg':'inv-bg')}">CQR: ${data.cqr}</span></div>
    </div>`;
  };

  return `<div class="organic-grid">${box('Instagram', ig, 'Views', ig?.views)}${box('Facebook', fb, 'Video Views', fb?.videoViews)}${box('TikTok', tt, 'Views', tt?.views)}</div>`;
}

function renderDetail(d) {
  const platLabel = d.platform === 'both' ? 'Meta & TikTok' : (d.platform==='tiktok'?'TikTok':'Meta');
  let statsHTML = '', recsHTML = '';
  
  if (d.platform === 'both') {
      statsHTML = getMetricsHTML(d._meta, 'Meta') + getMetricsHTML(d._tt, 'TikTok');
      recsHTML = getRecHTML(d._meta, 'Meta') + getRecHTML(d._tt, 'TikTok');
  } else {
      statsHTML = getMetricsHTML(d, d.platform==='meta'?'Meta':'TikTok');
      recsHTML = getRecHTML(d, d.platform==='meta'?'Meta':'TikTok');
  }

  let linkBtns = `<div class="btn-group">`;
  if (d.creativeLink || d.originalUrl) {
     linkBtns += `<button class="view-btn primary" onclick="window.open('${d.creativeLink || d.originalUrl}', '_blank')">View Creative ↗</button>`;
  }
  if (d.isRepurposed && d.extractedOrigId && ALL.find(x => x.id === d.extractedOrigId)) {
      linkBtns += `<button class="view-btn" onclick="selectCard('${d.extractedOrigId}')">View Original Stats</button>`;
  }
  linkBtns += `</div>`;

  let valUI = '';
  if (d.isValidated) {
      const cls = d.bestOrgCqr === 'Good' ? 'val-good' : 'val-avg';
      valUI = `<span class="val-badge ${cls}">Validated (${d.bestOrgCqr})</span>`;
      if (d.needsBoostWarning) valUI += `<div class="warning-badge">Alert: Validated > 48h, Not Boosted</div>`;
  }

  const repText = d.isRepurposed && d.originalName 
    ? `<div style="font-size:11px; color:var(--c-muted); font-weight:600; margin-top:8px;">Original Asset: <span style="color:var(--c-text);">${d.originalName}</span></div>` : '';

  document.getElementById('creativeModalContent').innerHTML=`
    <div class="cm-body">
      <div class="detail-header">
        <div>
           <div class="detail-title">${d.short}<span class="card-type ${d.type==='Brand Say'?'bs-tag':'os-tag'}" style="margin-left:6px">${d.type}</span>${valUI}</div>
           <div class="detail-meta">${platLabel} · ${d.campaign} · ${d.month}</div>
           ${repText}
           ${linkBtns}
        </div>
        <button class="close-btn" onclick="closeCreativeModal({target:{id:'creativeModalOverlay'}})">×</button>
      </div>
      
      ${statsHTML}

      <details class="org-details">
        <summary class="org-summary">Organic Performance Stats <span style="color:var(--c-muted);font-size:10px;">Click to expand ▼</span></summary>
        <div class="org-content">${buildOrganicHTML(d)}</div>
      </details>
      
      <div style="margin-top:14px">${recsHTML}</div>
      
      <div class="charts-row" style="margin-top:14px;">
        <div class="chart-box"><div class="chart-box-title">Retention drop-off</div><div class="chart-container" style="height:160px"><canvas id="retChart"></canvas></div></div>
        <div class="chart-box"><div class="chart-box-title">Performance radar</div><div class="chart-container" style="height:160px"><canvas id="radarChart"></canvas></div></div>
      </div>
    </div>`;

  if (retChart) retChart.destroy();
  if (radarChart) radarChart.destroy();

  const isDark = matchMedia('(prefers-color-scheme:dark)').matches;
  const gc = isDark?'rgba(255,255,255,0.08)':'rgba(0,0,0,0.07)';
  const tc = isDark?'#aaa':'#666';
  const norm=v=>Math.min(Math.round(v),100);

  const retDatasets = [];
  const radDatasets = [];
  let hookPointLabel = 'Hook Point';

  if (d.platform === 'both') {
      hookPointLabel = 'Hook (3s/2s)';
      retDatasets.push({label:'Meta %', data:d._meta.ret, borderColor:'#1877f2', backgroundColor:'rgba(24,119,242,0.1)', fill:true, tension:0.3, pointBackgroundColor:'#1877f2', pointRadius:4, borderWidth:2});
      retDatasets.push({label:'TikTok %', data:d._tt.ret, borderColor:'#ff0050', backgroundColor:'rgba(255,0,80,0.1)', fill:true, tension:0.3, pointBackgroundColor:'#ff0050', pointRadius:4, borderWidth:2});
      radDatasets.push({label:'Meta', data:[norm(d._meta.hookRate*1.5),norm((d._meta.holdRate/(d._meta.vp||1))*100*1.5),norm(d._meta.vtr*10),norm(d._meta.watchTime*8),norm(d._meta.reach/(d._meta.spend||1)*5)], borderColor:'#1877f2', backgroundColor:'rgba(24,119,242,0.15)', borderWidth:2, pointRadius:3});
      radDatasets.push({label:'TikTok', data:[norm(d._tt.hookRate*1.5),norm((d._tt.holdRate/(d._tt.vp||1))*100*1.5),norm(d._tt.vtr*10),norm(d._tt.watchTime*8),norm(d._tt.reach/(d._tt.spend||1)*5)], borderColor:'#ff0050', backgroundColor:'rgba(255,0,80,0.15)', borderWidth:2, pointRadius:3});
  } else {
      hookPointLabel = d.platform==='tiktok'?'2s hook':'3s hook';
      const color = d.platform==='tiktok'?'#ff0050':'#1877f2';
      const bgLine = d.platform==='tiktok'?'rgba(255,0,80,0.1)':'rgba(24,119,242,0.1)';
      const bgRad = d.platform==='tiktok'?'rgba(255,0,80,0.15)':'rgba(24,119,242,0.15)';
      retDatasets.push({label:'%', data:d.ret, borderColor:color, backgroundColor:bgLine, fill:true, tension:0.3, pointBackgroundColor:color, pointRadius:4, borderWidth:2});
      radDatasets.push({label:d.platform, data:[norm(d.hookRate*1.5),norm((d.holdRate/(d.vp||1))*100*1.5),norm(d.vtr*10),norm(d.watchTime*8),norm(d.reach/(d.spend||1)*5)], borderColor:color, backgroundColor:bgRad, borderWidth:2, pointRadius:3});
  }

  retChart = new Chart(document.getElementById('retChart'),{
    type:'line', data:{labels:['Start',hookPointLabel,'25%','50%','75%','100%'], datasets:retDatasets},
    options:{responsive:true,maintainAspectRatio:false,scales:{y:{min:0,max:105,grid:{color:gc},ticks:{color:tc,callback:v=>v+'%'}},x:{grid:{color:gc},ticks:{color:tc,font:{size:10}}}},plugins:{legend:{display: d.platform === 'both', labels:{color:tc, font:{size:10}, boxWidth:10}},tooltip:{callbacks:{label:ctx=>`${ctx.dataset.label}: ${ctx.raw.toFixed(1)}%`}}}}
  });

  radarChart = new Chart(document.getElementById('radarChart'),{
    type:'radar', data:{labels:['Hook','Hold','VTR','Watch','Reach/Spend'], datasets:radDatasets},
    options:{responsive:true,maintainAspectRatio:false,scales:{r:{min:0,max:100,grid:{color:gc},ticks:{display:false},pointLabels:{color:tc,font:{size:10}},angleLines:{color:gc}}},plugins:{legend:{display: d.platform === 'both', labels:{color:tc, font:{size:10}, boxWidth:10}}}}
  });
}

let pendingAction = null;
function openActionModal(creativeId, platform) {
    pendingAction = { id: creativeId, platform: platform };
    document.getElementById('actionModal').style.display = 'flex';
    document.getElementById('actionNameInput').value = '';
    document.getElementById('actionAgencyInput').value = '';
    document.getElementById('actionNameInput').focus();
}

function closeActionModal() {
    document.getElementById('actionModal').style.display = 'none';
    pendingAction = null;
}

async function confirmAction() {
    const name = document.getElementById('actionNameInput').value.trim();
    const agency = document.getElementById('actionAgencyInput').value.trim();
    if (!name) return alert("Please enter your name.");
    
    const btn = document.getElementById('modalConfirmBtn');
    const origText = btn.innerText;
    btn.innerText = 'Updating...';
    btn.disabled = true;

    try {
        const creative = ALL.find(c => c.id === pendingAction.id);
        const sourceItem = pendingAction.platform === 'Meta' ? (creative._meta || creative) : (creative._tt || creative);
        const rec = sourceItem.recDetails;

        if (!rec || !rec.sheetName || !rec.colStatus) throw new Error("Could not map recommendation to Sheet.");

        const dateStr = new Date().toLocaleDateString('en-GB', {day: 'numeric', month: 'short', year: 'numeric'}); 
        
        const updateData = [];
        if (rec.colStatus) updateData.push({ range: `${rec.sheetName}!${rec.colStatus}${rec.rowNum}`, values: [['Actioned']] });
        if (rec.colBy)     updateData.push({ range: `${rec.sheetName}!${rec.colBy}${rec.rowNum}`,     values: [[name]] });
        if (rec.colDate)   updateData.push({ range: `${rec.sheetName}!${rec.colDate}${rec.rowNum}`,   values: [[dateStr]] });
        if (rec.colAgency) updateData.push({ range: `${rec.sheetName}!${rec.colAgency}${rec.rowNum}`, values: [[agency]] });

        const response = await fetch('/api/update-action', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ updateData: updateData })
        });

        const data = await response.json();
        if (data.error) throw new Error(data.error);

        sourceItem.actionStatus = 'Actioned'; sourceItem.actionBy = name; sourceItem.actionDate = dateStr; sourceItem.agency = agency;
        rec.actionStatus = 'Actioned'; rec.actionBy = name; rec.actionDate = dateStr; rec.agency = agency;

        closeActionModal();
        renderDetail(creative); 
    } catch(err) {
        alert("Failed to update sheet: " + err.message);
    } finally {
        btn.innerText = origText;
        btn.disabled = false;
    }
}

loadData();
