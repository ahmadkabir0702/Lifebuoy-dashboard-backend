function colName(n) {
    let ordA = 'A'.charCodeAt(0), ordZ = 'Z'.charCodeAt(0), len = ordZ - ordA + 1, s = "";
    while(n >= 0) { s = String.fromCharCode(n % len + ordA) + s; n = Math.floor(n / len) - 1; }
    return s;
}

const parseNum = (val) => {
    if (typeof val === 'number') return val;
    if (!val || val === 'Not Found' || val === '-') return 0;
    return parseFloat(String(val).replace(/[^0-9.-]+/g, "")) || 0;
};

let META = [], TT = [], ALL = [];
let IG_ORG = {}, FB_ORG = {}, TT_ORG = {};
let META_RECS = {}, TT_RECS = {};
let ALL_CONTENT = [], PAID_IDS = new Set();
let ACCOUNT_OVERVIEW = [];
let CAMPAIGNS = [];
let currentPlatform = 'both', currentSort = 'hook', sortAscending = false, selectedId = null;
let currentPage = 'creatives';
let chartsInit = {};

async function loadData() {
  document.getElementById('kpi-row').innerHTML = `<div style="grid-column:1/-1;padding:20px;color:var(--c-muted)">⏳ Loading data...</div>`;
  try {
    const response = await fetch('/api/dashboard-data');
    if (!response.ok) throw new Error("Backend connection failed.");
    const [mR, tR, mRecR, tRecR, bsR, osR, igR, fbR, ttOrgR, aoR, filtersR] = await response.json();

    META_RECS = parseRecs(mRecR || [], 'Recommendation - Meta');
    TT_RECS   = parseRecs(tRecR || [], 'Recommendation - Tiktok');
    META = parsePaid(mR || [], 'meta');
    TT   = parsePaid(tR || [], 'tiktok');
    IG_ORG = parseOrganic(igR || [], 'ig');
    FB_ORG = parseOrganic(fbR || [], 'fb');
    TT_ORG = parseOrganic(ttOrgR || [], 'tt');
    ACCOUNT_OVERVIEW = parseAccountOverview(aoR || []);
    CAMPAIGNS = parseFilters(filtersR || []);
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
    if (!e.duration && c.duration) e.duration = c.duration;
    const order = {Good:0, Average:1, Poor:2, Invalid:3};
    if ((order[c.cqr] || 4) < (order[e.cqr] || 4)) e.cqr = c.cqr;
    if (source === 'meta') e._meta = c;
    if (source === 'tiktok') e._tt = c;
  };

  metaData.forEach(c => addPaid(c, 'meta'));
  ttData.forEach(c => addPaid(c, 'tiktok'));

  return Object.values(mergedMap).map(d => {
    if (d.type === 'Others Say') {
      const igCqr = d.igOrganic?.cqr;
      const ttCqr = d.ttOrganic?.cqr;
      d.isValidated = ['Good', 'Average'].includes(igCqr) || ['Good', 'Average'].includes(ttCqr);
      d.bestOrgCqr = (igCqr === 'Good' || ttCqr === 'Good') ? 'Good' : (d.isValidated ? 'Average' : null);
    } else {
      d.isValidated = !!(d.igOrganic?.meets24hr || d.fbOrganic?.meets24hr || d.ttOrganic?.meets24hr);
      const order = {Good:0, Average:1, Poor:2};
      let minCqr = 3;
      ['igOrganic', 'fbOrganic', 'ttOrganic'].forEach(p => {
        if (d[p] && order[d[p].cqr] !== undefined) minCqr = Math.min(minCqr, order[d[p].cqr]);
      });
      if (!d.isValidated && minCqr <= 1) d.isValidated = true;
      d.bestOrgCqr = minCqr === 0 ? 'Good' : (minCqr === 1 ? 'Average' : null);
    }

    d.isBoosted = d.spend > 0;
    d.needsBoostWarning = false;
    if (d.isValidated && !d.isBoosted) {
      const m = d.id.match(/_(\d{8})$/);
      if (m) {
        const postDate = new Date(`${m[1].slice(0,4)}-${m[1].slice(4,6)}-${m[1].slice(6,8)}`);
        if ((new Date() - postDate) / 3600000 > 48) d.needsBoostWarning = true;
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
    if (name.includes('hook rate') && !name.includes('quality')) h['Hook Rate %'] = i;
    if (name.includes('hook') && name.includes('quality')) h['Hook Rate (Quality)'] = i;
    if (name.includes('hold rate') && !name.includes('quality')) h['Hold Rate'] = i;
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
    if (name.includes('video duration') || name === 'duration (s)' || name === 'duration(s)') h['Duration'] = i;
  });

  const cqrOrder = {Good:0, Average:1, Poor:2, Invalid:3};
  const avg = arr => arr.length ? arr.reduce((s,v)=>s+v,0)/arr.length : 0;
  const isActive = s => { const u = String(s).toUpperCase(); return u==='ACTIVE'||u==='ENABLE'; };
  const map = {};

  rows.slice(1).forEach(row => {
    const creativeId = String(row[h['Creative ID']] || '').trim();
    if (!creativeId || creativeId === 'Not Found' || !creativeId.startsWith('Lifebuoy')) return;

    const spend = parseNum(row[h['Spend']]);
    const reach = parseNum(row[h['Reach']]);
    const impr  = parseNum(row[h['Impressions']]);
    const hookRate = parseNum(row[h['Hook Rate %']]);
    const hookQual = String(row[h['Hook Rate (Quality)']] || '');
    const holdRate = parseNum(row[h['Hold Rate']]);
    const holdQual = String(row[h['Hold Rate (Quality)']] || '');
    const vtr      = parseNum(row[h['VTR %']]);
    const watchTime= parseNum(row[h['Avg Watch Time (sec)']]);
    const cqr      = String(row[h['CQR']] || '');
    const adSt     = String(row[h['Ad Status']] || '');
    const vp       = parseNum(row[h['Video Plays']]) || 1;
    const w25 = parseNum(row[h['25% Watched']]);
    const w50 = parseNum(row[h['50% Watched']]);
    const w75 = parseNum(row[h['75% Watched']]);
    const w100= parseNum(row[h['100% Watched']]);
    const durRaw = h['Duration'] !== undefined ? String(row[h['Duration']] || '').replace(/[^0-9.]/g, '') : '';

    if (!map[creativeId]) {
      map[creativeId] = {
        creativeId, spend:0, reach:0, impressions:0, hookRates:[], holdRates:[], vtrs:[], watchTimes:[],
        cqr:'', hookQual:'', holdQual:'', vp:0, w25:0, w50:0, w75:0, w100:0, hasActive:false, duration:null
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
    if (!d.duration && durRaw) d.duration = parseFloat(durRaw) || null;
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
      hookRate: r1(avg(d.hookRates)), hookQual: d.hookQual,
      holdRate: r1(avg(d.holdRates)), holdQual: d.holdQual,
      vtr: r1(avg(d.vtrs)), watchTime: r1(avg(d.watchTimes)), cqr: d.cqr,
      adStatus: d.hasActive ? 'ACTIVE' : 'STOPPED',
      ret: [100, r1(avg(d.hookRates)), r1(d.w25/vp*100), r1(d.w50/vp*100), r1(d.w75/vp*100), r1(d.w100/vp*100)],
      platform, month: getMonthFromId(d.creativeId), campaign: getCampaignFromId(d.creativeId),
      duration: d.duration,
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
    if (name.includes('24hr') || name.includes('24 hr') || name.includes('criteria')) h['24hr'] = i;
    if (name.includes('avg watch') || name.includes('average watch')) h['AvgWatch'] = i;
  });

  const map = {};
  rows.slice(1).forEach(row => {
    const id = String(row[h['Creative ID']] || '').trim();
    if (!id || !id.startsWith('Lifebuoy')) return;
    const cqr = String(row[h['CQR']] || '');
    const criteriaRaw = h['24hr'] !== undefined ? String(row[h['24hr']] || '').trim().toLowerCase() : '';
    const meets24hr = criteriaRaw === 'yes' || criteriaRaw === '✓' || criteriaRaw === '1' || criteriaRaw === 'true' || criteriaRaw === 'validated';

    if (platform === 'ig') {
      const views = parseNum(row[h['Views']]);
      if (views > 0) map[id] = { views, reach: parseNum(row[h['Reach']]), likes: parseNum(row[h['Likes']]), comments: parseNum(row[h['Comments']]), saves: parseNum(row[h['Saves']]), shares: parseNum(row[h['Shares']]), avgWatchTime: parseNum(row[h['AvgWatch']]), cqr, meets24hr };
    } else if (platform === 'fb') {
      const videoViews = parseNum(row[h['Video Views']]);
      const reactions  = parseNum(row[h['Reactions']]);
      if (videoViews > 0 || reactions > 0) map[id] = { videoViews, reactions, comments: parseNum(row[h['Comments']]), shares: parseNum(row[h['Shares']]), cqr, meets24hr };
    } else if (platform === 'tt') {
      const views = parseNum(row[h['Views']]);
      if (views > 0) map[id] = { views, likes: parseNum(row[h['Likes']]), comments: parseNum(row[h['Comments']]), shares: parseNum(row[h['Shares']]), saves: parseNum(row[h['Saves']]), avgWatchTime: parseNum(row[h['AvgWatch']]), cqr, meets24hr };
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
      status: String(row[h['Ad Status']] || '').trim(),
      recommendation: String(row[h['Recommendations']] || '').trim(),
      actionStatus: String(row[h['Action Status']] || '').trim(),
      actionBy: String(row[h['Actioned By']] || '').trim(),
      actionDate: String(row[h['Action Date']] || '').trim(),
      agency: String(row[h['Assigned Agency']] || '').trim(),
      sheetName, rowNum: index + 2,
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

  const commonHeaders = (headers, h) => {
    headers.forEach((name, i) => {
      if (name.includes('creative id')) h['Creative ID'] = i;
      if (name.includes('campaign')) h['Campaign'] = i;
      if (name === 'ig') h['IG'] = i;
      if (name === 'fb') h['FB'] = i;
      if (name === 'tt') h['TT'] = i;
      if (name.includes('repurposed') && !name.includes('original')) h['Is Repurposed'] = i;
      if (name.includes('original creative')) h['Original Creative ID'] = i;
      if (name.includes('content hook')) h['Content Hook'] = i;
      if (name.includes('1st') || name.includes('0-25') || name.includes('0–25')) h['Seg1'] = i;
      if (name.includes('2nd') || name.includes('25-50') || name.includes('25–50')) h['Seg2'] = i;
      if (name.includes('3rd') || name.includes('50-75') || name.includes('50–75')) h['Seg3'] = i;
      if (name.includes('4th') || name.includes('75-100') || name.includes('75–100')) h['Seg4'] = i;
      if (name.includes('content type')) h['Content Type'] = i;
      if (name === 'duration' || name.includes('duration (s') || name.includes('duration(s')) h['Duration'] = i;
    });
  };

  if (bsRows && bsRows.length > 1) {
    const headers = bsRows[0].map(h => String(h).trim().toLowerCase());
    const h = {};
    commonHeaders(headers, h);
    bsRows.slice(1).forEach(row => {
      const id = String(row[h['Creative ID']] || '').trim();
      if (!id || !id.startsWith('Lifebuoy')) return;
      const isRep = String(row[h['Is Repurposed']] || '').trim().toLowerCase() === 'yes';
      const duration = h['Duration'] !== undefined ? parseNum(row[h['Duration']]) || null : null;
      const m = id.match(/Video(\d+)_(BrandSay|OthersSay)/);
      const shortName = m ? `Video${m[1]} ${m[2]==='BrandSay'?'Brand Say':'Others Say'}` : id;
      ALL_CONTENT.push({
        id, short: shortName, campaign: String(row[h['Campaign']] || '').trim() || getCampaignFromId(id),
        type: 'Brand Say', month: getMonthFromId(id), isPaid: PAID_IDS.has(id),
        igLink: String(row[h['IG']]||''), fbLink: String(row[h['FB']]||''), ttLink: String(row[h['TT']]||''),
        isRepurposed: isRep, originalId: String(row[h['Original Creative ID']] || '').trim(),
        contentHook: String(row[h['Content Hook']] || '').trim(),
        segments: [String(row[h['Seg1']]||'').trim(), String(row[h['Seg2']]||'').trim(), String(row[h['Seg3']]||'').trim(), String(row[h['Seg4']]||'').trim()].filter(Boolean),
        contentType: String(row[h['Content Type']] || '').trim(),
        duration, creatorProfile: null,
        igOrganic: null, fbOrganic: null, ttOrganic: null
      });
    });
  }

  if (osRows && osRows.length > 1) {
    const headers = osRows[0].map(h => String(h).trim().toLowerCase());
    const h = {};
    commonHeaders(headers, h);
    headers.forEach((name, i) => {
      if (name.includes('creator profile') || name === 'creator') h['Creator Profile'] = i;
      if (name === 'ttviews') h['TTViews'] = i;
      if (name === 'ttlikes') h['TTLikes'] = i;
      if (name === 'ttcomments') h['TTComments'] = i;
      if (name === 'ttshares') h['TTShares'] = i;
      if (name === 'ttsaves') h['TTSaves'] = i;
      if (name.includes('ttavg') || (name.startsWith('tt') && name.includes('watch'))) h['TTAvgWatch'] = i;
      if (name === 'ttcqr') h['TTCQR'] = i;
      if (name === 'igviews') h['IGViews'] = i;
      if (name === 'iglikes') h['IGLikes'] = i;
      if (name === 'igcomments') h['IGComments'] = i;
      if (name === 'igshares') h['IGShares'] = i;
      if (name === 'igsaves') h['IGSaves'] = i;
      if (name.includes('igavg') || (name.startsWith('ig') && name.includes('watch'))) h['IGAvgWatch'] = i;
      if (name === 'igcqr') h['IGCQR'] = i;
      if (name === 'fbviews') h['FBViews'] = i;
      if (name === 'fblikes') h['FBLikes'] = i;
      if (name === 'fbcomments') h['FBComments'] = i;
      if (name === 'fbshares') h['FBShares'] = i;
      if (name === 'fbsaves') h['FBSaves'] = i;
    });

    osRows.slice(1).forEach(row => {
      const id = String(row[h['Creative ID']] || '').trim();
      if (!id || !id.startsWith('Lifebuoy')) return;
      const isRep = String(row[h['Is Repurposed']] || '').trim().toLowerCase() === 'yes';
      const duration = h['Duration'] !== undefined ? parseNum(row[h['Duration']]) || null : null;
      const creatorRaw = h['Creator Profile'] !== undefined ? String(row[h['Creator Profile']] || '').trim() : '';

      const ttViews = h['TTViews'] !== undefined ? parseNum(row[h['TTViews']]) : 0;
      const ttOrganic = ttViews > 0 ? {
        views: ttViews, likes: parseNum(row[h['TTLikes']]), comments: parseNum(row[h['TTComments']]),
        shares: parseNum(row[h['TTShares']]), saves: parseNum(row[h['TTSaves']]),
        avgWatchTime: parseNum(row[h['TTAvgWatch']]), cqr: String(row[h['TTCQR']] || '').trim()
      } : null;

      const igViews = h['IGViews'] !== undefined ? parseNum(row[h['IGViews']]) : 0;
      const igOrganic = igViews > 0 ? {
        views: igViews, likes: parseNum(row[h['IGLikes']]), comments: parseNum(row[h['IGComments']]),
        shares: parseNum(row[h['IGShares']]), saves: parseNum(row[h['IGSaves']]),
        avgWatchTime: parseNum(row[h['IGAvgWatch']]), cqr: String(row[h['IGCQR']] || '').trim()
      } : null;

      const fbViews = h['FBViews'] !== undefined ? parseNum(row[h['FBViews']]) : 0;
      const fbOrganic = fbViews > 0 ? {
        videoViews: fbViews, reactions: parseNum(row[h['FBLikes']]),
        comments: parseNum(row[h['FBComments']]), shares: parseNum(row[h['FBShares']]),
        saves: parseNum(row[h['FBSaves']]), cqr: ''
      } : null;

      const m = id.match(/Video(\d+)_(BrandSay|OthersSay)/);
      const shortName = m ? `Video${m[1]} ${m[2]==='BrandSay'?'Brand Say':'Others Say'}` : id;

      ALL_CONTENT.push({
        id, short: shortName, campaign: String(row[h['Campaign']] || '').trim() || getCampaignFromId(id),
        type: 'Others Say', month: getMonthFromId(id), isPaid: PAID_IDS.has(id),
        igLink: String(row[h['IG']]||''), fbLink: String(row[h['FB']]||''), ttLink: String(row[h['TT']]||''),
        isRepurposed: isRep, originalId: String(row[h['Original Creative ID']] || '').trim(),
        contentHook: String(row[h['Content Hook']] || '').trim(),
        segments: [String(row[h['Seg1']]||'').trim(), String(row[h['Seg2']]||'').trim(), String(row[h['Seg3']]||'').trim(), String(row[h['Seg4']]||'').trim()].filter(Boolean),
        contentType: String(row[h['Content Type']] || '').trim(),
        duration, creatorProfile: creatorRaw,
        igOrganic, fbOrganic, ttOrganic
      });
    });
  }
}

function parseAccountOverview(rows) {
  if (!rows || rows.length < 2) return [];
  const headers = rows[0].map(h => String(h).trim().toLowerCase());
  const h = {};
  headers.forEach((name, i) => {
    if (name === 'actmonth' || name === 'month') h['ActMonth'] = i;
    if (name === 'actspend') h['ActSpend'] = i;
    if (name === 'actreach') h['ActReach'] = i;
    if (name === 'actimpressions') h['ActImpressions'] = i;
    if (name === 'actfrequency') h['ActFrequency'] = i;
    if (name.includes('actengagement') || name.includes('engagement rate')) h['ActEngagement'] = i;
    if (name === 'kpimonth') h['KpiMonth'] = i;
    if (name === 'kpispend') h['KpiSpend'] = i;
    if (name === 'kpireach') h['KpiReach'] = i;
    if (name === 'kpiimpressions') h['KpiImpressions'] = i;
    if (name === 'kpifrequency') h['KpiFrequency'] = i;
  });


  const seen = new Set();
  return rows.slice(1).map(row => {
    const actMonth = String(row[h['ActMonth']] || '').trim();
    if (!actMonth || seen.has(actMonth)) return null;
    seen.add(actMonth);
    const r = {
      month: actMonth,
      actSpend: parseNum(row[h['ActSpend']]), actReach: parseNum(row[h['ActReach']]),
      actImpressions: parseNum(row[h['ActImpressions']]), actFrequency: parseNum(row[h['ActFrequency']]),
      actEngagement: parseNum(row[h['ActEngagement']]),
      kpiSpend: parseNum(row[h['KpiSpend']]), kpiReach: parseNum(row[h['KpiReach']]),
      kpiImpressions: parseNum(row[h['KpiImpressions']]), kpiFrequency: parseNum(row[h['KpiFrequency']])
    };
    return (r.actSpend > 0 || r.kpiSpend > 0) ? r : null;
  }).filter(Boolean);
}

function parseFilters(rows) {
  const campaigns = [];
  rows.forEach(row => {
    const val = String(row[4] || '').trim();
    if (val && val !== 'Campaign FIlters' && val !== 'Campaign Filters') {
      campaigns.push(val);
    }
  });
  return campaigns;
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
      const content = contentMap[c.id];
      c.isRepurposed   = content.isRepurposed;
      c.creativeLink   = content.igLink || content.ttLink || content.fbLink || '';
      c.contentHook    = content.contentHook || '';
      c.segments       = content.segments || [];
      c.contentType    = content.contentType || '';
      c.duration       = c.duration || content.duration;
      c.creatorProfile = content.creatorProfile || null;
      c.ttLink         = content.ttLink || '';

      const rawOrig = content.originalId || '';
      c.originalName = rawOrig; c.originalUrl = ''; c.extractedOrigId = null;
      if (rawOrig) {
        const m = rawOrig.match(/(https?:\/\/[^\s_]+)/);
        if (m) c.originalUrl = m[1];
        if (rawOrig.includes('http')) c.originalName = rawOrig.split('_http')[0].replace(/_/g, ' ');
        const parts = rawOrig.split('_');
        if (parts.length >= 2) c.extractedOrigId = parts[0] + '_' + parts[1];
      }
    }

    if (c.type === 'Others Say' && contentMap[c.id]) {
      c.igOrganic = contentMap[c.id].igOrganic || null;
      c.fbOrganic = contentMap[c.id].fbOrganic || null;
      c.ttOrganic = contentMap[c.id].ttOrganic || null;
    } else {
      c.igOrganic = IG_ORG[c.id] || null;
      c.fbOrganic = FB_ORG[c.id] || null;
      c.ttOrganic = TT_ORG[c.id] || null;
    }
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

function extractCreatorInfo(creatorProfile, ttLink) {
  if (creatorProfile) {
    const ttM = creatorProfile.match(/tiktok\.com\/(@[^/?&#\s]+)/i);
    if (ttM) return { username: ttM[1], profileUrl: `https://www.tiktok.com/${ttM[1]}` };
    const igM = creatorProfile.match(/instagram\.com\/([^/?&#\s]+)/i);
    if (igM) return { username: `@${igM[1]}`, profileUrl: `https://www.instagram.com/${igM[1]}` };
    if (creatorProfile.startsWith('http')) return { username: creatorProfile.split('/').filter(Boolean).pop() || creatorProfile, profileUrl: creatorProfile };
    if (creatorProfile.trim()) return { username: creatorProfile.trim(), profileUrl: null };
  }
  if (ttLink) {
    const ttM = ttLink.match(/tiktok\.com\/(@[^/?&#\s]+)/i);
    if (ttM) return { username: ttM[1], profileUrl: `https://www.tiktok.com/${ttM[1]}` };
  }
  return null;
}

function populateFilters() {
  const months       = [...new Set(ALL.map(d=>d.month))].filter(Boolean).sort();
  const campaigns    = [...new Set(ALL.map(d=>d.campaign))].filter(Boolean).sort();
  const contentTypes = [...new Set(ALL.map(d=>d.contentType).filter(Boolean))].sort();

  const mSel = document.getElementById('month-filter');
  if (mSel) { mSel.innerHTML = '<option value="all">All months</option>'; months.forEach(m => { const o = document.createElement('option'); o.value=m; o.textContent=m; mSel.appendChild(o); }); }

  const cSel = document.getElementById('campaign-filter');
  if (cSel) { cSel.innerHTML = '<option value="all">All campaigns</option>'; campaigns.forEach(c => { const o = document.createElement('option'); o.value=c; o.textContent=c; cSel.appendChild(o); }); }

  const ctSel = document.getElementById('content-type-filter');
  if (ctSel) { ctSel.innerHTML = '<option value="all">All content types</option>'; contentTypes.forEach(ct => { const o = document.createElement('option'); o.value=ct; o.textContent=ct; ctSel.appendChild(o); }); }
}

function setNav(page, element) {
    const creativePage = document.getElementById('page-creatives');
    const kpiPage = document.getElementById('page-kpi');
    if (creativePage) creativePage.classList.add('hidden');
    if (kpiPage) kpiPage.classList.add('hidden');
    const selectedPage = document.getElementById(`page-${page}`);
    if (selectedPage) selectedPage.classList.remove('hidden');
    const titles = { 'creatives': 'Creative Hub', 'kpi': 'Campaign KPIs' };
    const titleEl = document.getElementById('topbar-title');
    if (titleEl) titleEl.innerText = titles[page] || '';
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    if (element) {
        element.classList.add('active');
    } else {
        const navLink = document.querySelector(`[onclick="setNav('${page}',this)"]`);
        if (navLink) navLink.classList.add('active');
    }
    if (page === 'kpi' && typeof renderKPIDashboard === 'function') {
        renderKPIDashboard();
    }
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

function getData() {
  let data = ALL;
  if (currentPlatform === 'meta')   data = ALL.filter(d => d.platform === 'meta'   || d.platform === 'both').map(d => d.platform === 'both' ? d._meta : d);
  if (currentPlatform === 'tiktok') data = ALL.filter(d => d.platform === 'tiktok' || d.platform === 'both').map(d => d.platform === 'both' ? d._tt   : d);

  const searchQ = (document.getElementById('search-filter')       || {}).value?.toLowerCase() || '';
  const tf      = (document.getElementById('type-filter')         || {}).value || 'all';
  const mf      = (document.getElementById('month-filter')        || {}).value || 'all';
  const campf   = (document.getElementById('campaign-filter')     || {}).value || 'all';
  const sf      = (document.getElementById('status-filter')       || {}).value || 'all';
  const vf      = (document.getElementById('validation-filter')   || {}).value || 'all';
  const ctf     = (document.getElementById('content-type-filter') || {}).value || 'all';
  const af      = (document.getElementById('action-filter')       || {}).value || 'all';

  if (tf !== 'all')   data = data.filter(d => d.type === tf);
  if (mf !== 'all')   data = data.filter(d => d.month === mf);
  if (campf !== 'all') data = data.filter(d => d.campaign === campf);
  if (ctf !== 'all')  data = data.filter(d => d.contentType === ctf);
  if (af === 'actioned') {
    data = data.filter(d => {
      const actRoot = d.actionStatus ? d.actionStatus.toLowerCase() : '';
      const actMeta = (d._meta && d._meta.actionStatus) ? d._meta.actionStatus.toLowerCase() : '';
      const actTt   = (d._tt && d._tt.actionStatus) ? d._tt.actionStatus.toLowerCase() : '';
      return actRoot === 'actioned' || actMeta === 'actioned' || actTt === 'actioned';
    });
  }
  if (af === 'not_actioned') {
    data = data.filter(d => {
      const hasRec  = d.recommendation || (d._meta && d._meta.recommendation) || (d._tt && d._tt.recommendation);
      const actRoot = d.actionStatus ? d.actionStatus.toLowerCase() : '';
      const actMeta = (d._meta && d._meta.actionStatus) ? d._meta.actionStatus.toLowerCase() : '';
      const actTt   = (d._tt && d._tt.actionStatus) ? d._tt.actionStatus.toLowerCase() : '';
      const isActed = actRoot === 'actioned' || actMeta === 'actioned' || actTt === 'actioned';
      return hasRec && !isActed;
    });
  }
  if (sf === 'ACTIVE')               data = data.filter(d => d.adStatus === 'ACTIVE');
  if (sf === 'STOPPED')              data = data.filter(d => d.adStatus === 'STOPPED');
  if (sf === 'VALIDATED_NOT_BOOSTED') data = data.filter(d => d.isValidated && !d.isBoosted);
  if (vf === 'validated')     data = data.filter(d => d.isValidated);
  if (vf === 'not_validated') data = data.filter(d => !d.isValidated);
  if (searchQ) data = data.filter(d => d.id.toLowerCase().includes(searchQ) || (d.short||'').toLowerCase().includes(searchQ));

  return [...data].sort((a,b) => {
    let valA = 0, valB = 0;
    if (currentSort==='hook')  { valA = a.hookRate; valB = b.hookRate; }
    else if (currentSort==='hold')  { valA = a.holdRate; valB = b.holdRate; }
    else if (currentSort==='reach') { valA = a.reach; valB = b.reach; }
    else if (currentSort==='spend') { valA = a.spend; valB = b.spend; }
    else if (currentSort==='cqr')   { const o={Good:0,Average:1,Poor:2,Invalid:3}; valB=(o[a.cqr]??4); valA=(o[b.cqr]??4); }
    return sortAscending ? valA - valB : valB - valA;
  });
}

function hookColor(v) { return v>=40?'#16a34a':v>=20?'#d97706':'#dc2626'; }
function cqrClass(c)  { return {Good:'good-bg',Average:'avg-bg',Poor:'poor-bg',Invalid:'inv-bg'}[c]||'inv-bg'; }
function fmt(n)  { return n>=1000000?'$'+(n/1000000).toFixed(1)+'M':n>=1000?'$'+(n/1000).toFixed(0)+'K':'$'+n; }
function fmtN(n) { return n>=1000000?(n/1000000).toFixed(1)+'M':n>=1000?(n/1000).toFixed(0)+'K':String(n); }

function render() {
  const data = getData();
  if (currentPage === 'creatives') {
    renderKPIs(data);
    renderCards(data);
  } else if (currentPage === 'kpi') {
    if (typeof renderKpiTab === 'function') renderKpiTab(data);
  }
}

function renderKPIs(data) {
  const totalAssets = data.length;
  const bsCount = data.filter(d=>d.type==='Brand Say').length;
  const osCount = data.filter(d=>d.type==='Others Say').length;
  const valCount = data.filter(d=>d.isValidated).length;
  const totalImp = data.reduce((s,d)=>s+(d.impressions||0),0);
  let totalOrgViews = 0;
  data.forEach(d => {
    if (d.igOrganic) totalOrgViews += (d.igOrganic.views||0);
    if (d.fbOrganic) totalOrgViews += (d.fbOrganic.videoViews||0);
    if (d.ttOrganic) totalOrgViews += (d.ttOrganic.views||0);
  });
  const row = document.getElementById('kpi-row');
  if (!row) return;
  row.innerHTML=`
    <div class="kpi"><div class="kpi-label">Total Assets</div><div class="kpi-val">${totalAssets}</div></div>
    <div class="kpi"><div class="kpi-label">BS vs OS Split</div><div class="kpi-val">${Math.round(bsCount/(totalAssets||1)*100)}% / ${Math.round(osCount/(totalAssets||1)*100)}%</div></div>
    <div class="kpi"><div class="kpi-label">Validated Assets</div><div class="kpi-val" style="color:var(--c-good)">${valCount}</div><div class="kpi-sub">Met 24hr Criteria</div></div>
    <div class="kpi"><div class="kpi-label">Total Org Views</div><div class="kpi-val" style="color:var(--c-os)">${fmtN(totalOrgViews)}</div><div class="kpi-sub">IG, FB, TT Combined</div></div>
    <div class="kpi"><div class="kpi-label">Total Paid Impr.</div><div class="kpi-val">${fmtN(totalImp)}</div></div>`;
}

function renderCards(data) {
  const maxHook  = Math.max(...data.map(d=>d.hookRate||0),1);
  const maxHold  = Math.max(...data.map(d=>d.holdRate||0),1);
  const maxReach = Math.max(...data.map(d=>d.reach||0),1);

  document.getElementById('grid-count').textContent = `${data.length} creatives`;
  document.getElementById('card-grid').innerHTML = data.map(d => {
    const hkPct  = Math.round((d.hookRate/maxHook)*100);
    const hdPct  = Math.round((d.holdRate/maxHold)*100);
    const rchPct = Math.round((d.reach/maxReach)*100);
    const isAct  = d.adStatus === 'ACTIVE';

    const platHTML = d.platform === 'both'
      ? `<span style="color:var(--c-meta);font-weight:700;font-size:10px">META</span> <span style="color:var(--c-muted)">&amp;</span> <span style="color:var(--c-tt);font-weight:700;font-size:10px">TT</span>`
      : `<span style="color:${d.platform==='tiktok'?'var(--c-tt)':'var(--c-meta)'};font-weight:700;font-size:10px">${d.platform==='tiktok'?'TT':'META'}</span>`;

    const hlValFormatted = d.holdRate >= 1000 ? (d.holdRate/1000).toFixed(1)+'K' : (d.holdRate||0).toFixed(1);
    const repTag  = d.isRepurposed ? `<span class="tag-repurposed">REPURPOSED</span>` : '';
    const valTag  = d.isValidated  ? `<span class="tag-validated">✓ Validated</span>` : '';
    const durTag  = d.duration     ? `<span class="tag-duration">${d.duration}s</span>` : '';
    const ctTag   = d.contentType  ? `<span class="tag-content-type">${d.contentType}</span>` : '';

    return `<div class="card ${d.id===selectedId?'selected':''}" onclick="selectCard('${d.id}')">
      <div class="card-top">
        <div class="card-plat"><div class="status-dot ${isAct?'status-active-dot':'status-stopped-dot'}"></div>${platHTML}</div>
        <div style="display:flex;align-items:center;gap:3px;flex-wrap:wrap;justify-content:flex-end">
          <span class="card-type ${d.type==='Brand Say'?'bs-tag':'os-tag'}">${d.type==='Brand Say'?'BS':'OS'}</span>${repTag}
        </div>
      </div>
      <div class="card-name">${d.short || d.id}</div>
      <div class="card-campaign">${d.campaign} · ${d.month}</div>
      <div class="card-tags">${durTag}${ctTag}${valTag}</div>
      <div class="mini-bars">
        <div class="mini-bar-row"><div class="mini-bar-label">Reach</div><div class="mini-bar-track"><div class="mini-bar-fill" style="width:${rchPct}%;background:#8b5cf6"></div></div><div class="mini-bar-val">${fmtN(d.reach)}</div></div>
        <div class="mini-bar-row"><div class="mini-bar-label">Hook</div><div class="mini-bar-track"><div class="mini-bar-fill" style="width:${hkPct}%;background:${hookColor(d.hookRate)}"></div></div><div class="mini-bar-val" style="color:${hookColor(d.hookRate)}">${(d.hookRate||0).toFixed(1)}%</div></div>
        <div class="mini-bar-row"><div class="mini-bar-label">Hold</div><div class="mini-bar-track"><div class="mini-bar-fill" style="width:${hdPct}%;background:#3b82f6"></div></div><div class="mini-bar-val">${hlValFormatted}</div></div>
      </div>
      <div class="card-footer"><span class="cqr-badge ${cqrClass(d.cqr)}">${d.cqr}</span><div class="spend-info"><div class="spend-label">Spend</div><div class="spend-val">${fmt(d.spend)}</div></div></div>
    </div>`;
  }).join('');
}

let retChart = null, radarChart = null;

function selectCard(id) {
  const item = ALL.find(d=>d.id===id);
  if (item) { document.getElementById('creativeModalOverlay').style.display = 'flex'; renderDetail(item); }
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
  const durLabel = item.duration ? `<div style="font-size:10px;color:var(--c-muted);margin-top:3px;">Duration: ${item.duration}s</div>` : '';
  return `
    <div style="margin-bottom:12px;">
      <div style="font-size:11px;font-weight:700;color:var(--c-muted);margin-bottom:6px;text-transform:uppercase;">${titleLabel} Paid Stats</div>
      <div class="detail-metrics" style="margin-bottom:6px;">
        <div class="dm"><div class="dm-label">CQR Rating</div><div class="dm-val big-cqr ${cqrColorClass}">${item.cqr||'—'}</div>${durLabel}</div>
        <div class="dm"><div class="dm-label">Spend &amp; Reach</div><div class="dm-val">${fmt(item.spend)}</div><div style="font-size:10px;color:var(--c-muted);margin-top:2px;">Reach: ${fmtN(item.reach)} | Impr: ${fmtN(item.impressions)}</div></div>
        <div class="dm"><div class="dm-label">Hook Rate</div><div class="dm-val" style="color:${hookColor(item.hookRate)}">${(item.hookRate||0).toFixed(1)}%</div><div><span class="kpi-pill ${cqrClass(item.hookQual)}">${item.hookQual||'—'}</span></div></div>
        <div class="dm"><div class="dm-label">Hold Rate</div><div class="dm-val" style="color:#3b82f6">${hlValFormatted}</div><div><span class="kpi-pill ${cqrClass(item.holdQual)}">${item.holdQual||'—'}</span></div></div>
      </div>
    </div>`;
}

function getRecHTML(item, titleLabel) {
  if (!item) return '';
  if (item.recommendation) {
    const isActioned = item.actionStatus && item.actionStatus.toLowerCase() === 'actioned';
    const actionBadge = isActioned
      ? `<div class="sheet-rec-action">Actioned by ${item.actionBy||'Unknown'} on ${item.actionDate||'Date unknown'} (${item.agency||'Agency unassigned'})</div>`
      : `<div class="sheet-rec-action" style="color:#b45309">Pending action (${item.agency||'Agency unassigned'}) <button class="action-btn" onclick="openActionModal('${item.id}', '${titleLabel}')">Mark Actioned</button></div>`;
    return `<div class="sheet-rec"><div class="sheet-rec-content"><div class="sheet-rec-label">${titleLabel} Live Recommendation</div><div class="sheet-rec-text">${item.recommendation}</div>${actionBadge}</div></div>`;
  } else {
    return `<div class="sheet-rec" style="opacity:0.6;border-color:var(--c-border);background:var(--c-surface);"><div class="sheet-rec-content"><div class="sheet-rec-label" style="color:var(--c-muted);">${titleLabel} Live Recommendation</div><div class="sheet-rec-text" style="color:var(--c-muted);">No recommendation provided.</div></div></div>`;
  }
}

function buildOrganicHTML(d) {
  const ig = d.igOrganic, fb = d.fbOrganic, tt = d.ttOrganic;
  if (!ig && !fb && !tt) return `<div class="organic-empty">No organic data available.</div>`;

  const met24Badge = (meets) => meets ? `<div style="margin-top:4px"><span class="tag-validated" style="font-size:9px;padding:1px 5px;">✓ 24hr Met</span></div>` : '';

  const igBox = !ig ? `<div class="organic-box"><div class="organic-platform">Instagram</div><div class="organic-empty">No data</div></div>` : `<div class="organic-box">
    <div class="organic-platform">Instagram</div>
    <div class="organic-stat-row"><span class="organic-stat-label">Views</span><span class="organic-stat-val">${fmtN(ig.views||0)}</span></div>
    <div class="organic-stat-row"><span class="organic-stat-label">Likes</span><span class="organic-stat-val">${fmtN(ig.likes||0)}</span></div>
    <div class="organic-stat-row"><span class="organic-stat-label">Comments</span><span class="organic-stat-val">${fmtN(ig.comments||0)}</span></div>
    <div class="organic-stat-row"><span class="organic-stat-label">Saves</span><span class="organic-stat-val">${fmtN(ig.saves||0)}</span></div>
    <div class="organic-stat-row"><span class="organic-stat-label">Shares</span><span class="organic-stat-val">${fmtN(ig.shares||0)}</span></div>
    ${ig.avgWatchTime ? `<div class="organic-stat-row"><span class="organic-stat-label">Avg Watch</span><span class="organic-stat-val">${ig.avgWatchTime.toFixed(1)}s</span></div>` : ''}
    ${ig.cqr ? `<div style="margin-top:8px"><span class="val-badge ${ig.cqr==='Good'?'val-good':(ig.cqr==='Average'?'val-avg':'inv-bg')}">CQR: ${ig.cqr}</span></div>` : ''}
    ${met24Badge(ig.meets24hr)}
  </div>`;

  const fbBox = !fb ? `<div class="organic-box"><div class="organic-platform">Facebook</div><div class="organic-empty">No data</div></div>` : `<div class="organic-box">
    <div class="organic-platform">Facebook</div>
    <div class="organic-stat-row"><span class="organic-stat-label">Video Views</span><span class="organic-stat-val">${fmtN(fb.videoViews||0)}</span></div>
    <div class="organic-stat-row"><span class="organic-stat-label">Reactions</span><span class="organic-stat-val">${fmtN(fb.reactions||0)}</span></div>
    <div class="organic-stat-row"><span class="organic-stat-label">Comments</span><span class="organic-stat-val">${fmtN(fb.comments||0)}</span></div>
    <div class="organic-stat-row"><span class="organic-stat-label">Shares</span><span class="organic-stat-val">${fmtN(fb.shares||0)}</span></div>
    ${fb.cqr ? `<div style="margin-top:8px"><span class="val-badge ${fb.cqr==='Good'?'val-good':(fb.cqr==='Average'?'val-avg':'inv-bg')}">CQR: ${fb.cqr}</span></div>` : ''}
    ${met24Badge(fb.meets24hr)}
  </div>`;

  const ttBox = !tt ? `<div class="organic-box"><div class="organic-platform">TikTok</div><div class="organic-empty">No data</div></div>` : `<div class="organic-box">
    <div class="organic-platform">TikTok</div>
    <div class="organic-stat-row"><span class="organic-stat-label">Views</span><span class="organic-stat-val">${fmtN(tt.views||0)}</span></div>
    <div class="organic-stat-row"><span class="organic-stat-label">Likes</span><span class="organic-stat-val">${fmtN(tt.likes||0)}</span></div>
    <div class="organic-stat-row"><span class="organic-stat-label">Comments</span><span class="organic-stat-val">${fmtN(tt.comments||0)}</span></div>
    <div class="organic-stat-row"><span class="organic-stat-label">Saves</span><span class="organic-stat-val">${fmtN(tt.saves||0)}</span></div>
    <div class="organic-stat-row"><span class="organic-stat-label">Shares</span><span class="organic-stat-val">${fmtN(tt.shares||0)}</span></div>
    ${tt.avgWatchTime ? `<div class="organic-stat-row"><span class="organic-stat-label">Avg Watch</span><span class="organic-stat-val">${tt.avgWatchTime.toFixed(1)}s</span></div>` : ''}
    ${tt.cqr ? `<div style="margin-top:8px"><span class="val-badge ${tt.cqr==='Good'?'val-good':(tt.cqr==='Average'?'val-avg':'inv-bg')}">CQR: ${tt.cqr}</span></div>` : ''}
    ${met24Badge(tt.meets24hr)}
  </div>`;

  return `<div class="organic-grid">${igBox}${fbBox}${ttBox}</div>`;
}

function buildCreativeBriefHTML(d) {
  if (!d.contentHook && (!d.segments || d.segments.length === 0)) return '';
  const segLabels = ['0–25%', '25–50%', '50–75%', '75–100%'];
  const segsHTML = d.segments && d.segments.length > 0
    ? `<div class="brief-segs">${d.segments.map((s,i) => `<div class="seg-row"><div class="seg-label">${segLabels[i]||`Seg ${i+1}`}</div><div class="seg-text">${s}</div></div>`).join('')}</div>`
    : '';
  return `
    <details class="org-details" style="margin-top:12px;">
      <summary class="org-summary">Creative Brief <span style="color:var(--c-muted);font-size:10px;">Click to expand ▼</span></summary>
      <div class="org-content">
        ${d.contentHook ? `<div class="brief-hook"><span class="brief-hook-label">Hook</span><div class="brief-hook-text">${d.contentHook}</div></div>` : ''}
        ${segsHTML}
      </div>
    </details>`;
}

function renderDetail(d) {
  const platLabel = d.platform === 'both' ? 'Meta & TikTok' : (d.platform==='tiktok'?'TikTok':'Meta');
  let statsHTML = '', recsHTML = '';
  if (d.platform === 'both') {
    statsHTML = getMetricsHTML(d._meta, 'Meta') + getMetricsHTML(d._tt, 'TikTok');
    recsHTML  = getRecHTML(d._meta, 'Meta') + getRecHTML(d._tt, 'TikTok');
  } else {
    statsHTML = getMetricsHTML(d, d.platform==='meta'?'Meta':'TikTok');
    recsHTML  = getRecHTML(d, d.platform==='meta'?'Meta':'TikTok');
  }

  let linkBtns = `<div class="btn-group">`;
  if (d.creativeLink || d.originalUrl) linkBtns += `<button class="view-btn primary" onclick="window.open('${d.creativeLink||d.originalUrl}','_blank')">View Creative ↗</button>`;
  if (d.isRepurposed && d.extractedOrigId && ALL.find(x=>x.id===d.extractedOrigId)) linkBtns += `<button class="view-btn" onclick="selectCard('${d.extractedOrigId}')">View Original Stats</button>`;
  linkBtns += `</div>`;

  let valUI = '';
  if (d.isValidated) {
    const cls = d.bestOrgCqr === 'Good' ? 'val-good' : 'val-avg';
    valUI = `<span class="val-badge ${cls}">✓ Validated (${d.bestOrgCqr||'24hr Met'})</span>`;
    if (d.needsBoostWarning) valUI += `<div class="warning-badge">Alert: Validated > 48h, Not Boosted</div>`;
  }

  const repText = d.isRepurposed && d.originalName
    ? `<div style="font-size:11px;color:var(--c-muted);font-weight:600;margin-top:8px;">Original Asset: <span style="color:var(--c-text);">${d.originalName}</span></div>` : '';

  let creatorHTML = '';
  if (d.type === 'Others Say') {
    const creator = extractCreatorInfo(d.creatorProfile, d.ttLink);
    if (creator) {
      const linkEl = creator.profileUrl
        ? `<a href="${creator.profileUrl}" target="_blank" class="creator-link">${creator.username} ↗</a>`
        : `<span class="creator-name">${creator.username}</span>`;
      creatorHTML = `<div class="creator-row">Creator: ${linkEl}</div>`;
    }
  }

  const metaParts = [platLabel, d.campaign, d.month];
  if (d.duration) metaParts.push(`${d.duration}s`);
  if (d.contentType) metaParts.push(d.contentType);

  document.getElementById('creativeModalContent').innerHTML = `
    <div class="cm-body">
      <div class="detail-header">
        <div>
          <div class="detail-title">${d.short}<span class="card-type ${d.type==='Brand Say'?'bs-tag':'os-tag'}" style="margin-left:6px">${d.type}</span>${valUI}</div>
          <div class="detail-meta">${metaParts.join(' · ')}</div>
          ${creatorHTML}${repText}${linkBtns}
        </div>
        <button class="close-btn" onclick="closeCreativeModal({target:{id:'creativeModalOverlay'}})">×</button>
      </div>

      ${statsHTML}
      ${buildCreativeBriefHTML(d)}

      <details class="org-details" style="margin-top:12px;">
        <summary class="org-summary">Organic Performance <span style="color:var(--c-muted);font-size:10px;">Click to expand ▼</span></summary>
        <div class="org-content">${buildOrganicHTML(d)}</div>
      </details>

      <div style="margin-top:14px">${recsHTML}</div>

      <div class="charts-row" style="margin-top:14px;">
        <div class="chart-box"><div class="chart-box-title">Retention drop-off</div><div class="chart-container" style="height:160px"><canvas id="retChart"></canvas></div></div>
        <div class="chart-box"><div class="chart-box-title">Performance radar</div><div class="chart-container" style="height:160px"><canvas id="radarChart"></canvas></div></div>
      </div>
    </div>`;

  if (retChart)   retChart.destroy();
  if (radarChart) radarChart.destroy();

  const isDark = matchMedia('(prefers-color-scheme:dark)').matches;
  const gc = isDark?'rgba(255,255,255,0.08)':'rgba(0,0,0,0.07)';
  const tc = isDark?'#aaa':'#666';
  const norm = v => Math.min(Math.round(v), 100);

  const retDatasets = [], radDatasets = [];
  let hookPointLabel = 'Hook Point';

  if (d.platform === 'both') {
    hookPointLabel = 'Hook (3s/2s)';
    retDatasets.push({label:'Meta %',   data:d._meta.ret, borderColor:'#1877f2', backgroundColor:'rgba(24,119,242,0.1)', fill:true, tension:0.3, pointBackgroundColor:'#1877f2', pointRadius:4, borderWidth:2});
    retDatasets.push({label:'TikTok %', data:d._tt.ret,   borderColor:'#ff0050', backgroundColor:'rgba(255,0,80,0.1)',   fill:true, tension:0.3, pointBackgroundColor:'#ff0050', pointRadius:4, borderWidth:2});

    // Radar: Eng Rate, Hook Rate, Hold Rate, CPM Efficiency, Reach
    const metaEngRate = d._meta.impressions > 0 ? norm((d._meta.reach / d._meta.impressions) * 200) : 0;
    const ttEngRate   = d._tt.impressions   > 0 ? norm((d._tt.reach   / d._tt.impressions)   * 200) : 0;
    const metaCPMEff  = (d._meta.spend > 0 && d._meta.reach > 0) ? norm(Math.max(0, 100 - (d._meta.spend / d._meta.reach * 1000))) : 0;
    const ttCPMEff    = (d._tt.spend   > 0 && d._tt.reach   > 0) ? norm(Math.max(0, 100 - (d._tt.spend   / d._tt.reach   * 1000))) : 0;
    const metaReachN  = norm(d._meta.reach / 50000 * 100);
    const ttReachN    = norm(d._tt.reach   / 50000 * 100);

    radDatasets.push({label:'Meta',   data:[metaEngRate, norm(d._meta.hookRate*2), norm(d._meta.holdRate*2), metaCPMEff, metaReachN], borderColor:'#1877f2', backgroundColor:'rgba(24,119,242,0.15)', borderWidth:2, pointRadius:3});
    radDatasets.push({label:'TikTok', data:[ttEngRate,   norm(d._tt.hookRate*2),   norm(d._tt.holdRate*2),   ttCPMEff,   ttReachN],   borderColor:'#ff0050', backgroundColor:'rgba(255,0,80,0.15)',   borderWidth:2, pointRadius:3});
  } else {
    hookPointLabel = d.platform==='tiktok'?'2s hook':'3s hook';
    const color  = d.platform==='tiktok'?'#ff0050':'#1877f2';
    const bgLine = d.platform==='tiktok'?'rgba(255,0,80,0.1)':'rgba(24,119,242,0.1)';
    const bgRad  = d.platform==='tiktok'?'rgba(255,0,80,0.15)':'rgba(24,119,242,0.15)';
    retDatasets.push({label:'%', data:d.ret, borderColor:color, backgroundColor:bgLine, fill:true, tension:0.3, pointBackgroundColor:color, pointRadius:4, borderWidth:2});

    const engRate = d.impressions > 0 ? norm((d.reach / d.impressions) * 200) : 0;
    const cpmEff  = (d.spend > 0 && d.reach > 0) ? norm(Math.max(0, 100 - (d.spend / d.reach * 1000))) : 0;
    const reachN  = norm(d.reach / 50000 * 100);

    radDatasets.push({label:d.platform, data:[engRate, norm(d.hookRate*2), norm(d.holdRate*2), cpmEff, reachN], borderColor:color, backgroundColor:bgRad, borderWidth:2, pointRadius:3});
  }

  retChart = new Chart(document.getElementById('retChart'), {
    type:'line', data:{labels:['Start',hookPointLabel,'25%','50%','75%','100%'], datasets:retDatasets},
    options:{responsive:true,maintainAspectRatio:false,scales:{y:{min:0,max:105,grid:{color:gc},ticks:{color:tc,callback:v=>v+'%'}},x:{grid:{color:gc},ticks:{color:tc,font:{size:10}}}},plugins:{legend:{display:d.platform==='both',labels:{color:tc,font:{size:10},boxWidth:10}},tooltip:{callbacks:{label:ctx=>`${ctx.dataset.label}: ${ctx.raw.toFixed(1)}%`}}}}
  });

  radarChart = new Chart(document.getElementById('radarChart'), {
    type:'radar',
    data:{
      labels:['Eng. Rate','Hook Rate','Hold Rate','CPM Eff.','Reach'],
      datasets:radDatasets
    },
    options:{
      responsive:true, maintainAspectRatio:false,
      scales:{r:{min:0,max:100,grid:{color:gc},ticks:{display:false},pointLabels:{color:tc,font:{size:10}},angleLines:{color:gc}}},
      plugins:{
        legend:{display:d.platform==='both',labels:{color:tc,font:{size:10},boxWidth:10}},
        tooltip:{callbacks:{label:ctx=>`${ctx.dataset.label}: ${ctx.raw}`}}
      }
    }
  });
}

let pendingAction = null;

function openActionModal(creativeId, platform) {
  pendingAction = { id: creativeId, platform };
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
  const name   = document.getElementById('actionNameInput').value.trim();
  const agency = document.getElementById('actionAgencyInput').value.trim();
  if (!name) return alert("Please enter your name.");
  const btn = document.getElementById('modalConfirmBtn');
  const origText = btn.innerText;
  btn.innerText = 'Updating...'; btn.disabled = true;
  try {
    const creative  = ALL.find(c=>c.id===pendingAction.id);
    const sourceItem = pendingAction.platform === 'Meta' ? (creative._meta||creative) : (creative._tt||creative);
    const rec = sourceItem.recDetails;
    if (!rec || !rec.sheetName || !rec.colStatus) throw new Error("Could not map recommendation to Sheet.");
    const dateStr = new Date().toLocaleDateString('en-GB', {day:'numeric',month:'short',year:'numeric'});
    const updateData = [];
    if (rec.colStatus) updateData.push({ range:`${rec.sheetName}!${rec.colStatus}${rec.rowNum}`, values:[['Actioned']] });
    if (rec.colBy)     updateData.push({ range:`${rec.sheetName}!${rec.colBy}${rec.rowNum}`,     values:[[name]] });
    if (rec.colDate)   updateData.push({ range:`${rec.sheetName}!${rec.colDate}${rec.rowNum}`,   values:[[dateStr]] });
    if (rec.colAgency) updateData.push({ range:`${rec.sheetName}!${rec.colAgency}${rec.rowNum}`, values:[[agency]] });
    const res = await fetch('/api/update-action', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({updateData}) });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    sourceItem.actionStatus = 'Actioned'; sourceItem.actionBy = name; sourceItem.actionDate = dateStr; sourceItem.agency = agency;
    rec.actionStatus = 'Actioned'; rec.actionBy = name; rec.actionDate = dateStr; rec.agency = agency;
    closeActionModal();
    renderDetail(creative);
  } catch(err) {
    alert("Failed to update sheet: " + err.message);
  } finally {
    btn.innerText = origText; btn.disabled = false;
  }
}

function openAddCreativeModal() {
  document.getElementById('addCreativeModal').style.display = 'flex';
  const campaignSelect = document.getElementById('ac-campaign');
  const campaigns = CAMPAIGNS.length > 0
    ? CAMPAIGNS
    : [...new Set(ALL_CONTENT.map(c => c.campaign).filter(c => c && c !== 'Unknown'))];
  campaignSelect.innerHTML = '<option value="" disabled selected>Select Campaign</option>';
  campaigns.forEach(c => { campaignSelect.innerHTML += `<option value="${c}">${c}</option>`; });
  const orgIdSelect = document.getElementById('ac-original-id');
  const creativeIds = [...new Set(ALL_CONTENT.map(c => c.id).filter(id => id))];
  orgIdSelect.innerHTML = '<option value="" disabled selected>Select Original Creative ID</option>';
  creativeIds.forEach(id => { orgIdSelect.innerHTML += `<option value="${id}">${id}</option>`; });
}

function closeAddCreativeModal() {
  document.getElementById('addCreativeModal').style.display = 'none';
  document.getElementById('addCreativeForm').reset();
  toggleCreativeFields();
}

function toggleCreativeFields() {
  const type = document.getElementById('ac-type').value;
  const repurposedSelect = document.getElementById('ac-repurposed');
  const originalIdSelect = document.getElementById('ac-original-id');
  if (type === 'Brand Say') {
    repurposedSelect.style.display = 'block';
    repurposedSelect.required = true;
  } else {
    repurposedSelect.style.display = 'none';
    repurposedSelect.required = false;
    repurposedSelect.value = "";
    originalIdSelect.style.display = 'none';
    originalIdSelect.required = false;
    originalIdSelect.value = "";
  }
}

function toggleOriginalIdField() {
  const repurposed = document.getElementById('ac-repurposed').value;
  const originalIdSelect = document.getElementById('ac-original-id');
  if (repurposed === 'Yes') {
    originalIdSelect.style.display = 'block';
    originalIdSelect.required = true;
  } else {
    originalIdSelect.style.display = 'none';
    originalIdSelect.required = false;
    originalIdSelect.value = "";
  }
}

async function submitCreative(e) {
  e.preventDefault();
  const campaign = document.getElementById('ac-campaign').value;
  const type = document.getElementById('ac-type').value;
  const date = document.getElementById('ac-date').value;
  const ig = document.getElementById('ac-ig').value;
  const fb = document.getElementById('ac-fb').value;
  const tt = document.getElementById('ac-tt').value;
  const repurposed = document.getElementById('ac-repurposed').value || "No";
  const originalId = document.getElementById('ac-original-id').value || "";
  const btnConfirm = document.getElementById('ac-confirm-btn');
  const btnCancel = document.getElementById('ac-cancel-btn');
  const progressContainer = document.getElementById('ac-progress-container');
  const progressText = document.getElementById('ac-progress-text');
  const progressBar = document.getElementById('ac-progress-bar');

  btnConfirm.disabled = true;
  btnCancel.disabled = true;
  document.getElementById('addCreativeModal').style.pointerEvents = 'none';
  progressContainer.style.display = 'block';

  const setProgress = (pct, msg, color) => {
    progressBar.style.width = pct + '%';
    progressBar.style.background = color || '#4f46e5';
    progressText.innerText = msg;
  };

setProgress(10, '⏳ Submitting creative details...', '#4f46e5');

  try {
    const t1 = setTimeout(() => setProgress(30, '📥 Downloading video...', '#4f46e5'), 800);
    const t2 = setTimeout(() => setProgress(55, '🤖 AI is analysing content...', '#4f46e5'), 4000);
    const t3 = setTimeout(() => setProgress(75, '✍️ Generating hook & segment descriptions...', '#4f46e5'), 15000);
    const t4 = setTimeout(() => setProgress(90, '📊 Writing to Google Sheet...', '#4f46e5'), 35000);

    const res = await fetch('/api/add-creative', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ campaign, type, date, ig, fb, tt, repurposed, originalId }),
      signal: AbortSignal.timeout(120000)
    });
    clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); clearTimeout(t4);

  if (result.success) {
      const aiMsg = result.aiGenerated ? ' AI descriptions generated.' : ' (No AI — video may be unsupported.)';
      setProgress(100, 'Done! Creative added.' + aiMsg, '#16a34a');
      progressBar.style.background = '#16a34a';
      setTimeout(() => { closeAddCreativeModal(); location.reload(); }, 3000);
    } else {
      setProgress(100, 'Failed: ' + (result.error || 'Unknown error'), '#dc2626');
      progressBar.style.background = '#dc2626';
      resetSubmitUI(3000);
    }
  } catch (err) {
    console.error(err);
    setProgress(100, 'Network error — could not reach server.', '#dc2626');
    progressBar.style.background = '#dc2626';
    resetSubmitUI(3000);
  }
}

function resetSubmitUI(delay = 0) {
  setTimeout(() => {
    document.getElementById('ac-confirm-btn').disabled = false;
    document.getElementById('ac-cancel-btn').disabled = false;
    document.getElementById('ac-progress-container').style.display = 'none';
    document.getElementById('ac-progress-bar').style.width = '0%';
    document.getElementById('addCreativeModal').style.pointerEvents = 'auto';
  }, delay);
}

loadData();
