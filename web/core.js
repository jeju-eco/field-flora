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

  function fileStamp(survey) {
    const d = (survey.date || new Date().toISOString().slice(0, 10)).replace(/-/g, '');
    const t = (survey.title || '조사').replace(/[\\/:*?"<>|]/g, '_');
    return `${t}_${d}`;
  }

  return {
    norm, chosung, isChosungQuery, buildIndex, search,
    COVER, toDMS, summarize, toRecordsCSV, toMatrixCSV, fileStamp, csvCell,
  };
});
