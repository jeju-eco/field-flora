/* 현장 식물상 빠른입력기 - 순수 로직 (브라우저/Node 공용)
 * DOM·저장소에 의존하지 않는 부분만 둔다. Node에서 그대로 테스트한다.
 */
(function (root, factory) {
  const mod = factory();
  if (typeof module === 'object' && module.exports) module.exports = mod;
  else root.FFCore = mod;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** 검색 키 정규화: 소문자 + 영숫자/한글만 남김. build_dict.py의 norm()과 동일 규칙. */
  function norm(s) {
    if (!s) return '';
    return String(s).normalize('NFC').toLowerCase().replace(/[^0-9a-z\uac00-\ud7a3\u3131-\u318e]/g, '');
  }

  /** 초성 추출(한글). '소나무' -> 'ㅅㄴㅁ' */
  const CHO = ['ㄱ','ㄲ','ㄴ','ㄷ','ㄸ','ㄹ','ㅁ','ㅂ','ㅃ','ㅅ','ㅆ','ㅇ','ㅈ','ㅉ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];
  function chosung(s) {
    let out = '';
    for (const ch of String(s || '')) {
      const c = ch.charCodeAt(0);
      if (c >= 0xac00 && c <= 0xd7a3) out += CHO[Math.floor((c - 0xac00) / 588)];
      else out += ch;
    }
    return out;
  }

  function isChosungQuery(q) {
    return q.length > 0 && /^[\u3131-\u314e]+$/.test(q);
  }

  /** 검색 인덱스 구축. taxa: [{i,n,s,f,a}] */
  function buildIndex(taxa) {
    const entries = [];
    for (const t of taxa) {
      const names = [t.n].concat(t.a || []);
      const nk = names.map(norm);
      entries.push({
        t: t,
        keys: nk,                       // 국명 + 별칭 (정규화)
        cho: chosung(t.n),              // 국명 초성
        sci: norm(t.s || ''),           // 학명 (정규화)
        sciRaw: (t.s || '').toLowerCase(),
      });
    }
    return { taxa: taxa, entries: entries, byId: new Map(taxa.map((t) => [t.i, t])) };
  }

  /**
   * 종 검색. 점수: 국명 완전일치 > 국명 접두 > 초성 접두 > 학명 접두 > 별칭 접두 > 부분포함
   * @returns {Array} 상위 limit개 taxon 객체 (matched: 매칭된 표기)
   */
  function search(index, query, limit) {
    limit = limit || 20;
    const q = norm(query);
    if (!q) return [];
    const useCho = isChosungQuery(query.trim());
    const qcho = query.trim();
    const hits = [];

    for (const e of index.entries) {
      let score = -1;
      let matched = null;

      if (useCho) {
        if (e.cho.startsWith(qcho)) { score = 300 - e.t.n.length; matched = e.t.n; }
      } else {
        for (let k = 0; k < e.keys.length; k++) {
          const key = e.keys[k];
          if (!key) continue;
          const isAlias = k > 0;
          let s = -1;
          if (key === q) s = isAlias ? 900 : 1000;
          else if (key.startsWith(q)) s = (isAlias ? 700 : 800) - key.length;
          else if (key.includes(q)) s = (isAlias ? 400 : 500) - key.length;
          if (s > score) { score = s; matched = isAlias ? e.t.a[k - 1] : e.t.n; }
        }
        if (e.sci) {
          let s = -1;
          if (e.sci === q) s = 950;
          else if (e.sci.startsWith(q)) s = 750 - e.sci.length;
          else if (e.sci.includes(q)) s = 350 - e.sci.length;
          if (s > score) { score = s; matched = e.t.s; }
        }
      }

      if (score > 0) hits.push({ score: score, taxon: e.t, matched: matched });
    }

    hits.sort((a, b) => b.score - a.score || a.taxon.n.localeCompare(b.taxon.n, 'ko'));
    return hits.slice(0, limit).map((h) => ({ ...h.taxon, matched: h.matched }));
  }

  /** Braun-Blanquet 우점도 등급 */
  const COVER = [
    { v: 'r', label: 'r', desc: '고립 1개체' },
    { v: '+', label: '+', desc: '드물게, 피도 <1%' },
    { v: '1', label: '1', desc: '다수, 피도 1~5%' },
    { v: '2', label: '2', desc: '피도 5~25%' },
    { v: '3', label: '3', desc: '피도 25~50%' },
    { v: '4', label: '4', desc: '피도 50~75%' },
    { v: '5', label: '5', desc: '피도 75~100%' },
  ];

  /* ── 식생조사(방형구) ──
   * 층위는 국립생태원 자연환경조사 지침의 교목/아교목/관목/초본 4층 체계. */
  const LAYERS = [
    { v: 'T1', label: '교목', desc: '상층 수관' },
    { v: 'T2', label: '아교목', desc: '중층' },
    { v: 'S', label: '관목', desc: '2m 이하 목본' },
    { v: 'H', label: '초본', desc: '초본층' },
  ];
  const LAYER_LABEL = LAYERS.reduce((m, x) => { m[x.v] = x.label; return m; }, {});

  /** 방형구 규격 프리셋 — 층위별 표준 조사구 크기 */
  const PLOT_SIZES = ['2×2', '5×5', '10×10', '20×20', '100㎡', '400㎡'];

  /* ── 훼손수목(이식/벌채 대상) ──
   * 흉고직경(DBH)은 지상 1.2m 기준. 수고는 m. */
  const TREE_ACTIONS = [
    { v: 'keep', label: '존치' },
    { v: 'move', label: '이식' },
    { v: 'cut', label: '벌채' },
  ];
  const TREE_ACTION_LABEL = TREE_ACTIONS.reduce((m, x) => { m[x.v] = x.label; return m; }, {});

  /** 흉고직경으로 대략의 규격 등급 — 이식 난이도 가늠용 */
  function dbhClass(dbh) {
    const d = Number(dbh) || 0;
    if (d <= 0) return '';
    if (d < 10) return '소경목';
    if (d < 20) return '중경목';
    if (d < 40) return '대경목';
    return '노거수급';
  }

  /** 수관폭·수고·흉고직경으로 표준 수목 규격 표기 (예: H4.0×B15) */
  function treeSpec(t) {
    const p = [];
    if (Number(t.height) > 0) p.push('H' + Number(t.height).toFixed(1));
    if (Number(t.dbh) > 0) p.push('B' + Number(t.dbh));
    if (Number(t.crown) > 0) p.push('W' + Number(t.crown).toFixed(1));
    return p.join('×');
  }

  /** 훼손수목 집계 — 조치별 본수와 수종 수 */
  function summarizeTrees(trees) {
    const list = trees || [];
    const byAction = {};
    TREE_ACTIONS.forEach((a) => { byAction[a.v] = { count: 0, stems: 0 }; });
    const taxa = new Set();
    let stems = 0;
    list.forEach((t) => {
      const n = Math.max(1, Number(t.stems) || 1);
      const a = byAction[t.action] || (byAction[t.action] = { count: 0, stems: 0 });
      a.count += 1; a.stems += n;
      stems += n;
      if (t.name) taxa.add(t.name);
    });
    return { total: list.length, stems, taxaCount: taxa.size, byAction };
  }

  /** 좌표 십진도 -> 도분초 문자열 */
  function toDMS(deg, isLat) {
    if (deg === null || deg === undefined || isNaN(deg)) return '';
    const hemi = isLat ? (deg >= 0 ? 'N' : 'S') : (deg >= 0 ? 'E' : 'W');
    const a = Math.abs(deg);
    const d = Math.floor(a);
    const mFloat = (a - d) * 60;
    const m = Math.floor(mFloat);
    const s = (mFloat - m) * 60;
    return `${hemi} ${d}°${String(m).padStart(2, '0')}'${s.toFixed(1).padStart(4, '0')}"`;
  }

  /** 조사 요약 집계: 지점별 종수, 전체 출현종수, 과별 통계 */
  function summarize(survey) {
    const sites = survey.sites || [];
    const records = survey.records || [];
    const bySite = new Map(sites.map((s) => [s.id, { site: s, count: 0, taxa: [] }]));
    const allTaxa = new Map();
    const families = new Map();

    for (const r of records) {
      const b = bySite.get(r.siteId);
      if (b && !b.taxa.some((t) => t.taxonId === r.taxonId)) {
        b.taxa.push(r);
        b.count += 1;
      }
      if (!allTaxa.has(r.taxonId)) allTaxa.set(r.taxonId, r);
      const fam = r.family || '미상';
      families.set(fam, (families.get(fam) || 0) + (allTaxa.has(r.taxonId) ? 0 : 1));
    }

    const famCount = new Map();
    for (const r of allTaxa.values()) {
      const fam = r.family || '미상';
      famCount.set(fam, (famCount.get(fam) || 0) + 1);
    }

    return {
      totalTaxa: allTaxa.size,
      totalRecords: records.length,
      siteCount: sites.length,
      bySite: sites.map((s) => bySite.get(s.id)),
      families: [...famCount.entries()]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'ko')),
    };
  }

  function csvCell(v) {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  /** 기록 상세 CSV (엑셀 호환: BOM은 저장 시 부여) */
  function toRecordsCSV(survey) {
    const siteById = new Map((survey.sites || []).map((s) => [s.id, s]));
    const head = ['조사명', '조사일', '조사자', '지점', '위도', '경도', '고도(m)', '국명', '학명', '과', '개체수', '우점도', '비고', '기록시각'];
    const lines = [head.map(csvCell).join(',')];
    for (const r of survey.records || []) {
      const s = siteById.get(r.siteId) || {};
      lines.push([
        survey.title || '', survey.date || '', survey.surveyor || '',
        s.name || '', s.lat ?? '', s.lon ?? '', s.alt ?? '',
        r.name || '', r.scientific || '', r.family || '',
        r.count ?? '', r.cover || '', r.note || '',
        r.at ? new Date(r.at).toISOString() : '',
      ].map(csvCell).join(','));
    }
    return lines.join('\r\n');
  }

  /* ── CSV 읽기 (엑셀에서 고쳐 온 파일을 되돌려 받는다) ── */

  /** RFC4180 CSV 파서. 따옴표 안의 쉼표·줄바꿈·"" 이스케이프를 지킨다. */
  function parseCSV(text) {
    const s = String(text || '').replace(/^\ufeff/, '');
    const rows = [];
    let row = [], cell = '', q = false, i = 0;
    while (i < s.length) {
      const c = s[i];
      if (q) {
        if (c === '"') {
          if (s[i + 1] === '"') { cell += '"'; i += 2; continue; }
          q = false; i++; continue;
        }
        cell += c; i++; continue;
      }
      if (c === '"') { q = true; i++; continue; }
      if (c === ',') { row.push(cell); cell = ''; i++; continue; }
      if (c === '\r') { i++; continue; }
      if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i++; continue; }
      cell += c; i++;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows.filter((r) => r.some((x) => String(x).trim() !== ''));
  }

  /** 헤더 행을 열이름→번호 맵으로. 공백·괄호 단위를 무시해 느슨하게 맞춘다. */
  function headerMap(head) {
    const norm = (x) => String(x || '').replace(/\s|\(.*?\)/g, '').trim();
    const m = {};
    head.forEach((h, i) => { const k = norm(h); if (k && !(k in m)) m[k] = i; });
    return m;
  }

  /**
   * 기록 CSV(또는 국명만 있는 종 목록)를 읽어 기록 배열로 바꾼다.
   * lookup(name) → 사전의 종 객체({i,n,s,f}) 또는 null.
   * 사전에 없는 이름도 버리지 않고 taxonId=null로 살려 둔다(직접 입력한 종).
   */
  function parseRecordsCSV(text, lookup, opts) {
    const o = opts || {};
    const rows = parseCSV(text);
    if (!rows.length) return { records: [], sites: [], unknown: [], skipped: 0 };

    const H = headerMap(rows[0]);
    const iName = H['국명'] != null ? H['국명'] : (H['종명'] != null ? H['종명'] : (H['식물명'] != null ? H['식물명'] : 0));
    const hasHeader = H['국명'] != null || H['종명'] != null || H['식물명'] != null;
    const body = hasHeader ? rows.slice(1) : rows;

    const get = (r, key) => (H[key] != null && r[H[key]] != null ? String(r[H[key]]).trim() : '');
    const sites = [];
    const siteByName = new Map();
    const ensureSite = (name, lat, lon, alt) => {
      const n = name || o.defaultSite || 'St.1';
      if (siteByName.has(n)) return siteByName.get(n);
      const site = {
        id: o.uid ? o.uid() : 'S' + (sites.length + 1),
        name: n,
        lat: lat === '' ? null : Number(lat),
        lon: lon === '' ? null : Number(lon),
        alt: alt === '' ? null : Number(alt),
        acc: null, at: Date.now(),
      };
      if (isNaN(site.lat)) site.lat = null;
      if (isNaN(site.lon)) site.lon = null;
      if (isNaN(site.alt)) site.alt = null;
      sites.push(site); siteByName.set(n, site);
      return site;
    };

    const records = [];
    const unknown = [];
    let skipped = 0;

    body.forEach((r) => {
      const name = String(r[iName] || '').trim();
      if (!name) { skipped++; return; }
      const site = ensureSite(get(r, '지점'), get(r, '위도'), get(r, '경도'), get(r, '고도'));
      const hit = lookup ? lookup(name) : null;
      if (!hit) unknown.push(name);

      const cnt = get(r, '개체수');
      records.push({
        id: o.uid ? o.uid() : 'R' + (records.length + 1),
        siteId: site.id,
        taxonId: hit ? hit.i : null,
        name: hit ? hit.n : name,
        scientific: hit ? (hit.s || '') : get(r, '학명'),
        family: hit ? (hit.f || '') : get(r, '과'),
        count: cnt === '' ? 1 : Math.max(0, Number(cnt) || 0),
        cover: get(r, '우점도'),
        note: get(r, '비고'),
        at: Date.now(),
      });
    });

    return { records, sites, unknown, skipped };
  }


  /** 훼손수목 조서 CSV를 읽어 수목 배열로. 엑셀에서 규격을 정리해 온 경우. */
  function parseTreeCSV(text, lookup, opts) {
    const o = opts || {};
    const rows = parseCSV(text);
    // 조서는 머리말 몇 줄 뒤에 표 헤더가 온다. '수종'이 있는 줄을 헤더로 본다.
    const hi = rows.findIndex((r) => r.some((c) => String(c).replace(/\s/g, '') === '수종'));
    if (hi < 0) return { trees: [], unknown: [], skipped: 0 };

    const H = headerMap(rows[hi]);
    const get = (r, key) => (H[key] != null && r[H[key]] != null ? String(r[H[key]]).trim() : '');
    const byLabel = {};
    TREE_ACTIONS.forEach((a) => { byLabel[a.label] = a.v; });

    const trees = [];
    const unknown = [];
    let skipped = 0;

    rows.slice(hi + 1).forEach((r) => {
      const name = get(r, '수종');
      // 합계·소계 행은 건너뛴다
      if (!name || name === '합계' || byLabel[name] !== undefined && !get(r, '흉고직경')) { skipped++; return; }
      const hit = lookup ? lookup(name) : null;
      if (!hit) unknown.push(name);
      const num = (k) => { const v = get(r, k); return v === '' ? '' : (Number(v) || ''); };
      trees.push({
        id: o.uid ? o.uid() : 'T' + (trees.length + 1),
        taxonId: hit ? hit.i : null,
        name: hit ? hit.n : name,
        scientific: hit ? (hit.s || '') : get(r, '학명'),
        family: hit ? (hit.f || '') : get(r, '과'),
        dbh: num('흉고직경'), height: num('수고'), crown: num('수관폭'),
        stems: Math.max(1, Number(get(r, '본수')) || 1),
        action: byLabel[get(r, '조치')] || 'move',
        lat: get(r, '위도') === '' ? null : Number(get(r, '위도')) || null,
        lng: get(r, '경도') === '' ? null : Number(get(r, '경도')) || null,
        note: get(r, '비고'), at: Date.now(),
      });
    });
    return { trees, unknown, skipped };
  }

  /** 지점 x 종 출현 매트릭스 CSV (조사표 서식) */
  function toMatrixCSV(survey) {
    const sites = survey.sites || [];
    const records = survey.records || [];
    const taxa = [];
    const seen = new Map();
    for (const r of records) {
      if (!seen.has(r.taxonId)) { seen.set(r.taxonId, r); taxa.push(r); }
    }
    taxa.sort((a, b) => (a.family || '').localeCompare(b.family || '', 'ko') || a.name.localeCompare(b.name, 'ko'));

    const cell = new Map();
    for (const r of records) cell.set(r.siteId + '|' + r.taxonId, r.cover || String(r.count || 1));

    const head = ['연번', '과', '국명', '학명'].concat(sites.map((s) => s.name));
    const lines = [head.map(csvCell).join(',')];
    taxa.forEach((t, i) => {
      const row = [i + 1, t.family || '', t.name, t.scientific || ''];
      for (const s of sites) row.push(cell.get(s.id + '|' + t.taxonId) || '');
      lines.push(row.map(csvCell).join(','));
    });
    const tail = ['', '', '출현종수', ''].concat(
      sites.map((s) => new Set(records.filter((r) => r.siteId === s.id).map((r) => r.taxonId)).size)
    );
    lines.push(tail.map(csvCell).join(','));
    return lines.join('\r\n');
  }

  /** 식생조사표 CSV — 방형구별 층위·우점도. 실제 식생조사야장 형식. */
  function toVegCSV(survey) {
    const CRLF = '\r\n';
    const plots = (survey.plots || []);
    const head = [
      ['식생조사표'],
      ['조사명', survey.title || ''],
      ['조사일', survey.date || ''],
      ['조사자', survey.surveyor || ''],
      [],
    ];
    const lines = head.map((r) => r.map(csvCell).join(','));
    plots.forEach((p) => {
      lines.push([`■ ${p.name || '방형구'}`].map(csvCell).join(','));
      lines.push([
        '방형구크기', p.size || '', '경사(°)', p.slope || '', '방위', p.aspect || '',
        '해발(m)', p.elev || '', '위도', p.lat == null ? '' : p.lat, '경도', p.lng == null ? '' : p.lng,
      ].map(csvCell).join(','));
      if (p.note) lines.push(['비고', p.note].map(csvCell).join(','));
      lines.push(['층위', '식피율(%)', '평균수고(m)'].map(csvCell).join(','));
      LAYERS.forEach((L) => {
        const c = (p.cover || {})[L.v] || {};
        lines.push([L.label, c.rate == null ? '' : c.rate, c.height == null ? '' : c.height].map(csvCell).join(','));
      });
      lines.push(['층위', '국명', '학명', '과명', '우점도', '비고'].map(csvCell).join(','));
      LAYERS.forEach((L) => {
        (p.items || []).filter((it) => it.layer === L.v).forEach((it) => {
          lines.push([L.label, it.name || '', it.scientific || '', it.family || '', it.cover || '', it.note || '']
            .map(csvCell).join(','));
        });
      });
      lines.push('');
    });
    return '\ufeff' + lines.join(CRLF);
  }

  /** 훼손수목 조서 CSV — 이식/벌채 대상 목록. 수량 합계를 자동 계산한다. */
  function toTreeCSV(survey) {
    const CRLF = '\r\n';
    const trees = survey.trees || [];
    const lines = [
      ['훼손수목 조서'],
      ['조사명', survey.title || ''],
      ['조사일', survey.date || ''],
      ['조사자', survey.surveyor || ''],
      [],
      ['연번', '수종', '학명', '과명', '흉고직경(cm)', '수고(m)', '수관폭(m)', '규격', '본수', '조치', '위도', '경도', '비고'],
    ].map((r) => r.map(csvCell).join(','));

    trees.forEach((t, i) => {
      lines.push([
        i + 1, t.name || '', t.scientific || '', t.family || '',
        t.dbh || '', t.height || '', t.crown || '', treeSpec(t),
        Math.max(1, Number(t.stems) || 1), TREE_ACTION_LABEL[t.action] || '',
        t.lat == null ? '' : t.lat, t.lng == null ? '' : t.lng, t.note || '',
      ].map(csvCell).join(','));
    });

    const sum = summarizeTrees(trees);
    lines.push('');
    lines.push(['합계', '', '', '', '', '', '', '', sum.stems, '', '', '', `${sum.taxaCount}종`].map(csvCell).join(','));
    TREE_ACTIONS.forEach((a) => {
      const b = sum.byAction[a.v];
      if (b && b.count) lines.push([a.label, '', '', '', '', '', '', '', b.stems, `${b.count}건`, '', '', ''].map(csvCell).join(','));
    });
    return '\ufeff' + lines.join(CRLF);
  }

  function fileStamp(survey) {
    const d = (survey.date || new Date().toISOString().slice(0, 10)).replace(/-/g, '');
    const t = (survey.title || '조사').replace(/[\\/:*?"<>|]/g, '_');
    return `${t}_${d}`;
  }

  return {
    norm, chosung, isChosungQuery, buildIndex, search,
    COVER, toDMS, summarize, toRecordsCSV, toMatrixCSV, fileStamp, csvCell,
    LAYERS, LAYER_LABEL, PLOT_SIZES, TREE_ACTIONS, TREE_ACTION_LABEL,
    dbhClass, treeSpec, summarizeTrees, toVegCSV, toTreeCSV,
    parseCSV, parseRecordsCSV, parseTreeCSV,
  };
});
