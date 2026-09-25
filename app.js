/* 현장 식물상 빠른입력기 — 앱 로직
 * 저장: IndexedDB(주) + localStorage(거울). 저장 버튼 없이 변경 즉시 저장.
 */
'use strict';
(function () {
  const C = window.FFCore;
  const $ = (id) => document.getElementById(id);
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const todayISO = () => {
    const d = new Date();
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  };

  /* ───────── 저장소 ───────── */
  const DB_NAME = 'field_flora', STORE = 'kv', LS_KEY = 'field_flora_state';
  let dbp = null;
  function idb() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      if (!window.indexedDB) return rej(new Error('no idb'));
      const r = indexedDB.open(DB_NAME, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    }).catch(() => null);
    return dbp;
  }
  async function kvSet(k, v) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(v)); } catch (e) { /* 용량초과 무시 */ }
    const db = await idb();
    if (!db) return;
    await new Promise((res) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(v, k);
      tx.oncomplete = res; tx.onerror = res; tx.onabort = res;
    });
  }
  function readLS() {
    try { const s = localStorage.getItem(LS_KEY); if (s) return JSON.parse(s); } catch (e) {}
    return undefined;
  }
  /** 상태의 '내용량' — 어느 저장소가 더 온전한지 비교하는 척도 */
  function weigh(st) {
    if (!st || !Array.isArray(st.surveys)) return -1;
    let n = 0;
    for (const s of st.surveys) n += (s.records ? s.records.length : 0) * 10 + (s.sites ? s.sites.length : 0);
    return st.surveys.length + n;
  }
  async function kvGet(k) {
    const ls = readLS();
    let idbVal;
    const db = await idb();
    if (db) {
      idbVal = await new Promise((res) => {
        let done = false;
        const finish = (v) => { if (!done) { done = true; res(v); } };
        // IndexedDB 트랜잭션이 멈추는 기기가 있다 — 무한 대기하지 않는다
        setTimeout(() => finish(undefined), 2500);
        try {
          const tx = db.transaction(STORE, 'readonly');
          const rq = tx.objectStore(STORE).get(k);
          rq.onsuccess = () => finish(rq.result);
          rq.onerror = () => finish(undefined);
          tx.onabort = tx.onerror = () => finish(undefined);
        } catch (e) { finish(undefined); }
      });
    }
    // 두 저장소 중 내용이 더 많은 쪽을 채택한다.
    // (한쪽만 살아있거나 뒤처진 경우에 기록을 잃지 않기 위함)
    return weigh(idbVal) >= weigh(ls) ? (idbVal || ls) : (ls || idbVal);
  }

  /* ───────── 상태 ───────── */
  let state = null;        // { surveys:[], currentId, recent:[] }
  let index = null;        // 종 사전 검색 인덱스
  let sheetCtx = null;     // 우점도 시트 대상
  let flashId = null;      // 방금 추가/변경된 기록 — 잠깐 강조 표시
  let undoAction = null;   // 한 단계 되돌리기 — { label, apply }. apply()가 원상복구한다

  function newSurvey(title) {
    const s = {
      id: uid(), title: title || ('조사 ' + todayISO()), date: todayISO(), surveyor: '',
      sites: [], records: [], plots: [], trees: [], currentSiteId: null, createdAt: Date.now(),
    };
    const site = { id: uid(), name: 'St.1', lat: null, lon: null, alt: null, acc: null, at: Date.now() };
    s.sites.push(site); s.currentSiteId = site.id;
    return s;
  }
  /** 예전 조사에는 plots·trees가 없다. 읽을 때 채워 넣는다. */
  function migrate(st) {
    (st.surveys || []).forEach((s) => {
      if (!Array.isArray(s.plots)) s.plots = [];
      if (!Array.isArray(s.trees)) s.trees = [];
      // 측정 중에 앱이 꺼지면 'measuring' 상태로 굳는다. 부팅 때 푼다.
      (s.sites || []).forEach((x) => { delete x.locating; });
    });
    return st;
  }
  const cur = () => state.surveys.find((s) => s.id === state.currentId);
  /** 자동생성된 채 한 번도 안 쓴 조사인지 — 기록 0건이고 제목을 바꾸지 않았다 */
  const isEmptySurvey = (s) =>
    (!s.records || s.records.length === 0) && /^조사 \d{4}-\d{2}-\d{2}$/.test(s.title || '');
  const curSite = () => { const s = cur(); return s.sites.find((x) => x.id === s.currentSiteId) || s.sites[0]; };

  let saveTimer = null;
  function save(immediate) {
    clearTimeout(saveTimer);
    const doIt = () => kvSet('state', state);
    if (immediate) doIt(); else saveTimer = setTimeout(doIt, 250);
  }

  /* ───────── 화면 꺼짐 방지 ─────────
   * 조사 중 화면이 꺼지면 장갑을 벗고 다시 켜야 한다. 앱이 떠 있는 동안은 유지한다. */
  let wakeLock = null;
  async function keepAwake() {
    if (!('wakeLock' in navigator)) return;
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } catch (e) { /* 배터리 부족 등 — 조사에는 지장 없음 */ }
  }
  function bindWakeLock() {
    keepAwake();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && !wakeLock) keepAwake();
    });
  }


  function toast(msg) {
    const el = $('toast');
    el.textContent = msg; el.hidden = false;
    el.classList.remove('withbtn');
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.hidden = true; }, 1800);
  }
  /**
   * 되돌릴 방법을 등록하고 [취소] 버튼이 달린 토스트를 띄운다.
   * 현장에서 장갑 낀 손으로 잘못 누른 추가·삭제를 한 단계 되돌린다.
   * apply()는 원상복구를 수행한다. 4초 안에 안 누르면 확정된다.
   */
  function pushUndo(label, apply) {
    undoAction = { label, apply };
    const el = $('toast');
    el.innerHTML = '';
    el.classList.add('withbtn');
    const span = document.createElement('span');
    span.textContent = label;
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'undo'; btn.textContent = '취소';
    btn.onclick = (ev) => { ev.stopPropagation(); clearTimeout(el._t); el.hidden = true; undoLast(); };
    el.appendChild(span); el.appendChild(btn);
    el.hidden = false;
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.hidden = true; undoAction = null; }, 4000);
  }
  function buzz(ms) { if (navigator.vibrate) navigator.vibrate(ms || 12); }
  /** 화면 맨 위로. jsdom 등 scrollTo 미구현 환경에서는 조용히 넘어간다. */
  function scrollTop(smooth) {
    if (typeof window.scrollTo !== 'function') return;
    if (window.navigator.userAgent.includes('jsdom')) return;
    try { window.scrollTo(smooth ? { top: 0, behavior: 'smooth' } : 0, 0); } catch (e) {}
  }

  /* ───────── 음성 입력 ─────────
   * 장갑을 낀 채로는 타이핑이 어렵다. 말로 종명을 넣는다.
   * 주의: iOS Safari의 웹 음성인식은 애플 서버를 쓰므로 인터넷이 필요하다.
   * 오프라인 현장에서는 키보드의 마이크(받아쓰기)를 안내한다. */
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const micSupported = !!SR;
  let rec = null, micTarget = null;

  function micAvailable() { return micSupported && navigator.onLine; }

  function setMicHint(msg) {
    const el = $('micHint');
    if (!el) return;
    if (!msg) { el.hidden = true; el.textContent = ''; return; }
    el.textContent = msg; el.hidden = false;
  }

  /** 인식된 말에서 종명 후보를 뽑는다. "소나무요", "소나무 세 개체" 같은 군더더기를 턴다. */
  function cleanSpeech(raw) {
    let s = String(raw || '').trim();
    s = s.replace(/[.,!?]/g, ' ');
    s = s.replace(/\s*(요|입니다|이요|있어요|있습니다|같아요|추가|기록)\s*$/g, '');
    return s.trim();
  }

  function startMic(inputEl, btn) {
    if (!micSupported) {
      setMicHint('이 브라우저는 음성인식을 지원하지 않습니다. 키보드의 마이크(받아쓰기)를 쓰세요.');
      return;
    }
    if (!navigator.onLine) {
      setMicHint('음성인식은 인터넷이 필요합니다. 오프라인에서는 키보드 마이크(받아쓰기)를 쓰세요.');
      buzz(30);
      return;
    }
    if (rec) { stopMic(); return; }   // 다시 누르면 중지

    try { rec = new SR(); } catch (e) { setMicHint('음성인식을 시작할 수 없습니다.'); rec = null; return; }
    micTarget = inputEl;
    rec.lang = 'ko-KR';
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 3;

    if (btn) btn.classList.add('on');
    setMicHint('듣는 중… 종명을 말하세요');
    buzz(20);

    rec.onresult = (ev) => {
      let txt = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) txt += ev.results[i][0].transcript;
      const v = cleanSpeech(txt);
      micTarget.value = v;
      micTarget.dispatchEvent(new Event('input', { bubbles: true }));
      const last = ev.results[ev.results.length - 1];
      if (last && last.isFinal) setMicHint(`“${v}” — 결과에서 고르세요`);
    };
    rec.onerror = (ev) => {
      const map = {
        'not-allowed': '마이크 권한이 거부됐습니다. 설정에서 허용해 주세요.',
        'no-speech': '소리가 안 들렸습니다. 다시 눌러 말해 주세요.',
        'network': '인터넷이 끊겨 음성인식을 못 했습니다.',
      };
      setMicHint(map[ev.error] || '음성인식 오류: ' + ev.error);
      stopMic();
    };
    rec.onend = () => { if (btn) btn.classList.remove('on'); rec = null; };

    try { rec.start(); } catch (e) { setMicHint('음성인식 시작 실패'); stopMic(); }
  }

  function stopMic() {
    if (rec) { try { rec.stop(); } catch (e) {} rec = null; }
    document.querySelectorAll('.icon-btn.mic.on').forEach((b) => b.classList.remove('on'));
  }


  /* ───────── 렌더 ───────── */
  function renderTop() {
    const s = cur();
    $('surveyTitle').textContent = s.title;
    const row = $('siteRow'); row.innerHTML = '';
    s.sites.forEach((site) => {
      const n = new Set(s.records.filter((r) => r.siteId === site.id).map((r) => r.taxonId)).size;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'site-tab' + (site.id === s.currentSiteId ? ' on' : '');
      b.innerHTML = `${esc(site.name)}<span class="n">${n}</span>`;
      b.onclick = () => { s.currentSiteId = site.id; save(); renderAll(); buzz(); };
      row.appendChild(b);
    });
    const plus = document.createElement('button');
    plus.type = 'button'; plus.className = 'site-tab'; plus.textContent = '＋';
    plus.onclick = addSite;
    row.appendChild(plus);
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  const PAGE = 25;          // 한 번에 보여줄 검색 결과 수
  let shownCount = PAGE;    // 현재 몇 개까지 펼쳤는지
  let lastHits = [];        // 마지막 검색의 전체 결과

  /** 검색 결과를 그린다. 전체 중 shownCount개만 보이고 나머지는 [더보기]로 펼친다. */
  function renderResults(hits) {
    lastHits = hits || [];
    const ul = $('results'); ul.innerHTML = '';
    if (!lastHits.length) return;

    const s = cur(); const site = curSite();
    // 식생 입력 중이면 '이미 넣음' 판정을 해당 방형구·층위 기준으로 한다
    const have = vegCtx
      ? new Set((vegCtx.plot.items || []).filter((it) => it.layer === vegCtx.layer).map((it) => it.taxonId))
      : new Set(s.records.filter((r) => r.siteId === site.id).map((r) => r.taxonId));
    lastHits.slice(0, shownCount).forEach((t) => {
      const on = have.has(t.i);
      const li = document.createElement('li');
      if (on) li.className = 'added';
      li.innerHTML =
        `<div class="meta"><div class="nm">${esc(t.n)}${on ? ' ✓' : ''}</div>` +
        `<div class="sc">${esc(t.s)}</div><div class="fm">${esc(t.f)}${t.matched && t.matched !== t.n ? ' · ' + esc(t.matched) : ''}</div></div>` +
        `<button class="add" type="button" aria-label="${on ? '취소' : '추가'}">${on ? '✓' : '＋'}</button>`;
      li.querySelector('.add').onclick = (ev) => { ev.stopPropagation(); addRecord(t); };
      li.onclick = () => addRecord(t);
      ul.appendChild(li);
    });

    const rest = lastHits.length - shownCount;
    if (rest > 0) {
      const li = document.createElement('li');
      li.className = 'more';
      li.innerHTML = `<button type="button">＋ ${rest}종 더보기 <span>(전체 ${lastHits.length}종)</span></button>`;
      li.querySelector('button').onclick = (ev) => {
        ev.stopPropagation();
        shownCount += PAGE * 3;
        renderResults(lastHits);
      };
      ul.appendChild(li);
    } else if (lastHits.length > PAGE) {
      const li = document.createElement('li');
      li.className = 'more done';
      li.textContent = `전체 ${lastHits.length}종 모두 표시`;
      ul.appendChild(li);
    }
  }

  function renderRecent() {
    const wrap = $('recent'); wrap.innerHTML = '';
    const ids = (state.recent || []).slice(0, 14);
    if (!ids.length) { wrap.innerHTML = '<p class="hint" style="padding:0 2px">종을 추가하면 여기에 쌓여 한 번에 다시 넣을 수 있습니다.</p>'; return; }
    const s = cur(); const site = curSite();
    const have = new Set(s.records.filter((r) => r.siteId === site.id).map((r) => r.taxonId));
    ids.forEach((id) => {
      const t = index && index.byId.get(id);
      if (!t) return;
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = have.has(t.i) ? '✓ ' + t.n : t.n;
      if (have.has(t.i)) b.className = 'on';
      // 빠른 입력용 버튼이므로 이미 넣은 종을 다시 눌러도 지우지 않는다.
      // (검색 결과에서는 토글이 맞지만, 여기서는 연타하다 기록을 날리기 쉽다)
      b.onclick = () => {
        if (have.has(t.i)) { toast(`${t.n}은 이미 기록됨`); buzz(8); return; }
        addRecord(t);
      };
      wrap.appendChild(b);
    });
  }

  function renderRecList() {
    const s = cur(); const site = curSite();
    const rows = s.records.filter((r) => r.siteId === site.id).slice().reverse();
    const nTaxa = new Set(rows.map((r) => r.taxonId)).size;
    const nInd = rows.reduce((a, r) => a + (r.count || 1), 0);
    $('siteCount').textContent = nTaxa ? `${nTaxa}종 / ${nInd}개체` : '0종';

    // 이 지점에서 나온 종을 한 줄로 죽 보여준다 (현장에서 "뭐 나왔지?" 확인용)
    const namesEl = $('siteNames');
    if (namesEl) {
      const uniq = [];
      const seen = new Set();
      for (const r of rows) if (!seen.has(r.taxonId)) { seen.add(r.taxonId); uniq.push(r.name); }
      namesEl.textContent = uniq.join(', ');
      namesEl.hidden = !uniq.length;
    }

    const ul = $('recList'); ul.innerHTML = '';
    if (!rows.length) { ul.innerHTML = '<li class="empty" style="display:block">아직 기록이 없습니다. 위에서 종을 검색해 추가하세요.</li>'; return; }
    rows.forEach((r, i) => {
      const li = document.createElement('li');
      if (r.id === flashId) li.className = 'flash';
      const cnt = (r.count || 1) > 1 ? `<span class="ct">×${r.count}</span>` : '';
      li.innerHTML =
        `<span class="idx">${rows.length - i}</span>` +
        `<div class="meta"><div class="nm">${esc(r.name)}${cnt}</div>` +
        `<div class="sc">${esc(r.scientific)}${r.family ? ' · ' + esc(r.family) : ''}</div></div>` +
        `<button class="cv${r.cover ? '' : ' unset'}" type="button">${r.cover ? esc(r.cover) : '–'}</button>`;
      li.querySelector('.cv').onclick = (ev) => { ev.stopPropagation(); openSheet(r); };
      li.onclick = () => openSheet(r);
      ul.appendChild(li);
    });
    if (flashId) {
      const el = ul.querySelector('.flash');
      if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
      setTimeout(() => { flashId = null; const f = ul.querySelector('.flash'); if (f) f.classList.remove('flash'); }, 1200);
    }
  }

  function renderSites() {
    const s = cur(); const ul = $('siteList'); ul.innerHTML = '';
    s.sites.forEach((site) => {
      const n = new Set(s.records.filter((r) => r.siteId === site.id).map((r) => r.taxonId)).size;
      const li = document.createElement('li');
      const coord = site.locating
        ? '측정중…'
        : site.lat != null
          ? `${C.toDMS(site.lat, true)}  ${C.toDMS(site.lon, false)}${site.alt != null ? '  ' + Math.round(site.alt) + 'm' : ''}`
          : '⚠ 좌표 없음 (탭하여 재측정)';
      li.innerHTML = `<div class="meta"><div class="sname">${esc(site.name)}</div><div class="scoord${site.lat == null && !site.locating ? ' warn' : ''}">${esc(coord)}</div></div><span class="sn">${n}종</span>`;
      li.onclick = () => editSite(site);
      ul.appendChild(li);
    });
  }

  function renderSummary() {
    const s = cur();
    const sum = C.summarize(s);
    $('stTaxa').textContent = sum.totalTaxa;
    $('stSites').textContent = sum.siteCount;
    $('stRecs').textContent = sum.totalRecords;
    $('stFam').textContent = sum.families.length;
    $('sumSites').innerHTML = sum.bySite.map((b) =>
      `<li>${esc(b.site.name)}<b>${b.count}종</b></li>`).join('') || '<li class="empty">없음</li>';

    // 전체 출현종을 과·국명 순으로 나열 (보고서 목록 확인용)
    const namesEl = $('sumNames');
    if (namesEl) {
      const seen = new Map();
      for (const r of s.records) if (!seen.has(r.taxonId)) seen.set(r.taxonId, r);
      const list = [...seen.values()]
        .sort((a, b) => (a.family || '').localeCompare(b.family || '', 'ko') || a.name.localeCompare(b.name, 'ko'))
        .map((r) => r.name);
      namesEl.textContent = list.join(', ');
      namesEl.hidden = !list.length;
    }

    $('sumFam').innerHTML = sum.families.slice(0, 40).map((f) =>
      `<li>${esc(f.name)}<b>${f.count}</b></li>`).join('') || '<li class="empty">없음</li>';
    $('fTitle').value = s.title; $('fDate').value = s.date; $('fSurveyor').value = s.surveyor || '';
  }

  function renderAll() { renderTop(); renderRecList(); renderRecent(); renderSites(); renderVeg(); renderTrees(); renderSummary(); }

  /* ───────── 동작 ───────── */
  /** 검색 결과를 탭하면 추가, 같은 종을 다시 탭하면 취소(토글) */
  function addRecord(t) {
    const s = cur(); const site = curSite();
    const clearSearch = () => { const q = $('q'); q.value = ''; renderResults([]); q.focus(); };

    // 식생 탭에서 '＋종'으로 넘어온 상태면 방형구 층위에 넣는다
    if (vegCtx) {
      const { plot, layer } = vegCtx;
      const dup = (plot.items || []).find((it) => it.taxonId === t.i && it.layer === layer);
      if (dup) {
        plot.items = plot.items.filter((it) => it.id !== dup.id);
        save(true); buzz(20); toast(`${t.n} 취소됨`);
      } else {
        plot.items = plot.items || [];
        plot.items.push({ id: uid(), taxonId: t.i, name: t.n, scientific: t.s || '', family: t.f || '',
          layer, cover: '', note: '', at: Date.now() });
        state.recent = [t.i].concat((state.recent || []).filter((x) => x !== t.i)).slice(0, 30);
        save(true); buzz(15);
        toast(`${t.n} → ${plot.name} ${C.LAYER_LABEL[layer]}층`);
      }
      renderVegBanner(); renderRecent();
      const q = $('q'); q.value = ''; renderResults([]); q.focus();
      return;
    }

    const exist = s.records.find((r) => r.siteId === site.id && r.taxonId === t.i);

    if (exist) {
      // 개체수·우점도·비고를 입력해둔 기록은 실수로 날리지 않도록 확인한다
      const hasData = (exist.count || 1) > 1 || exist.cover || exist.note;
      if (hasData && !confirm(`${t.n}에 입력한 내용이 있습니다. 기록을 삭제할까요?`)) { clearSearch(); return; }
      const idx = s.records.indexOf(exist);
      s.records = s.records.filter((r) => r.id !== exist.id);
      pushUndo(`${t.n} 삭제`, () => s.records.splice(Math.min(idx, s.records.length), 0, exist));
      buzz(20); save(true);
      renderAll();
      clearSearch();
      return;
    }

    const addedId = uid();
    s.records.push({
      id: addedId, siteId: site.id, taxonId: t.i, name: t.n,
      scientific: t.s || '', family: t.f || '', count: 1, cover: '', note: '', at: Date.now(),
    });
    const n = new Set(s.records.filter((r) => r.siteId === site.id).map((r) => r.taxonId)).size;
    pushUndo(`${t.n} 추가 · ${site.name} ${n}종`, () => {
      s.records = s.records.filter((r) => r.id !== addedId);
    });

    state.recent = [t.i].concat((state.recent || []).filter((x) => x !== t.i)).slice(0, 30);
    buzz(15); save(true);   // 기록은 절대 유실되면 안 된다 — 즉시 저장
    flashId = addedId;
    renderTop(); renderRecList(); renderRecent(); renderSummary();
    clearSearch();          // 다음 종을 바로 칠 수 있게
  }

  /* ───────── 되돌리기 ─────────
   * 현장에서 장갑 낀 손으로 삭제를 잘못 누르면 자료가 그대로 날아간다.
   * 추가·삭제 모두 한 단계 되돌릴 수 있게 한다. 등록은 pushUndo() 참조. */

  /** 등록된 되돌리기를 실행한다 */
  function undoLast() {
    if (!undoAction) return;
    const { label, apply } = undoAction;
    undoAction = null;
    apply();
    save(true); renderAll();
    toast(`${label} 되돌림`);
    buzz(20);
  }

  function openSheet(rec) {
    sheetCtx = rec;
    $('sheetTitle').textContent = rec.name;
    $('cNum').value = rec.count || 1;
    $('cNote').value = rec.note || '';
    [...$('coverBtns').children].forEach((b) => b.classList.toggle('on', b.dataset.v === rec.cover));
    $('sheet').hidden = false;
  }
  function closeSheet() { $('sheet').hidden = true; sheetCtx = null; }

  /** 현재 위치를 한 번 읽어 콜백에 넘긴다. 실패해도 조사는 계속된다. */
  function getPos(cb) {
    if (!navigator.geolocation) { cb(null, '이 기기는 위치를 지원하지 않습니다'); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => cb(p.coords, null),
      (e) => cb(null, e.code === 1 ? '위치 권한이 거부됨' : '위치를 못 잡음'),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 10000 }
    );
  }

  /* ───────── 식생조사(방형구) ───────── */
  function addPlot() {
    const s = cur();
    const p = {
      id: uid(), name: 'Q' + (s.plots.length + 1), size: '10×10',
      slope: '', aspect: '', elev: '', note: '',
      lat: null, lng: null, cover: {}, items: [], at: Date.now(),
    };
    s.plots.push(p);
    save(true); renderVeg(); buzz(20);
    toast(p.name + ' 추가 · GPS 측정중…');
    getPos((c, err) => {
      if (c) { p.lat = +c.latitude.toFixed(6); p.lng = +c.longitude.toFixed(6); if (!p.elev && c.altitude != null) p.elev = Math.round(c.altitude); }
      save(true); renderVeg();
      toast(c ? `${p.name} 좌표 기록` : `${p.name} 추가 (${err})`);
    });
  }

  function renderVeg() {
    const s = cur();
    const wrap = $('plotWrap'); wrap.innerHTML = '';
    if (!s.plots.length) {
      wrap.innerHTML = '<p class="hint pad">방형구를 추가하면 층위별로 종을 기록할 수 있습니다.</p>';
      return;
    }
    s.plots.forEach((p) => {
      const card = document.createElement('section');
      card.className = 'plot';
      const total = (p.items || []).length;
      card.innerHTML =
        `<header class="plot-h"><b>${esc(p.name)}</b>` +
        `<span class="meta">${esc(p.size || '')}${p.slope ? ' · ' + esc(p.slope) + '°' : ''}${p.aspect ? ' · ' + esc(p.aspect) : ''}</span>` +
        `<span class="n">${total}종</span>` +
        `<button class="edit" type="button" aria-label="방형구 설정">⚙</button></header>`;
      card.querySelector('.edit').onclick = () => openPlotSheet(p);

      C.LAYERS.forEach((L) => {
        const items = (p.items || []).filter((it) => it.layer === L.v);
        const c = (p.cover || {})[L.v] || {};
        const box = document.createElement('div');
        box.className = 'layer';
        box.innerHTML =
          `<div class="layer-h"><b>${L.label}</b>` +
          `<label>식피 <input class="lr" type="number" inputmode="numeric" min="0" max="100" value="${c.rate == null ? '' : c.rate}">%</label>` +
          `<label>수고 <input class="lh" type="number" inputmode="decimal" min="0" step="0.5" value="${c.height == null ? '' : c.height}">m</label>` +
          `<button class="add-sp" type="button">＋ 종</button></div>` +
          `<ul class="layer-list"></ul>`;
        const setCov = (k, v) => {
          p.cover = p.cover || {}; p.cover[L.v] = p.cover[L.v] || {};
          p.cover[L.v][k] = v === '' ? null : Number(v);
          save(true);
        };
        const lr = box.querySelector('.lr'), lh = box.querySelector('.lh');
        lr.onchange = () => setCov('rate', lr.value);
        lr.onblur = () => setCov('rate', lr.value);
        lh.onchange = () => setCov('height', lh.value);
        lh.onblur = () => setCov('height', lh.value);
        box.querySelector('.add-sp').onclick = () => { setVegCtx({ plot: p, layer: L.v }); goTab('rec'); toast(`${p.name} ${L.label}층 — 종을 고르세요`); };

        const ul = box.querySelector('.layer-list');
        items.forEach((it) => {
          const li = document.createElement('li');
          li.innerHTML = `<span class="nm">${esc(it.name)}</span>` +
            `<button class="cv${it.cover ? '' : ' unset'}" type="button">${it.cover ? esc(it.cover) : '–'}</button>` +
            `<button class="del" type="button" aria-label="삭제">✕</button>`;
          li.querySelector('.cv').onclick = () => openSheet({ _veg: { plot: p, item: it }, name: it.name, cover: it.cover, note: it.note, count: 1 });
          li.querySelector('.del').onclick = () => {
            const i = p.items.indexOf(it);
            p.items = p.items.filter((x) => x.id !== it.id);
            pushUndo(`${it.name} 삭제`, () => p.items.splice(Math.min(i, p.items.length), 0, it));
            save(true); renderVeg(); buzz(20);
          };
          ul.appendChild(li);
        });
        card.appendChild(box);
      });
      wrap.appendChild(card);
    });
  }

  let vegCtx = null;   // 식생 탭에서 '＋종'을 눌러 식물상 탭으로 넘어온 상태

  /** 식생 입력 모드임을 검색창 위에 계속 보여준다 (어디에 넣는 중인지 헷갈리지 않게) */
  function renderVegBanner() {
    const el = $('vegBanner');
    if (!el) return;
    if (!vegCtx) { el.hidden = true; return; }
    const n = (vegCtx.plot.items || []).filter((it) => it.layer === vegCtx.layer).length;
    $('vegBannerTxt').textContent = `${vegCtx.plot.name} · ${C.LAYER_LABEL[vegCtx.layer]}층 입력중 (${n}종)`;
    el.hidden = false;
  }
  function setVegCtx(v) { vegCtx = v; renderVegBanner(); renderResults(lastHits); }

  function openPlotSheet(p) {
    plotCtx = p;
    $('psTitle').textContent = p.name;
    $('pName').value = p.name || '';
    $('pSlope').value = p.slope || '';
    $('pAspect').value = p.aspect || '';
    $('pElev').value = p.elev || '';
    $('pNote').value = p.note || '';
    const row = $('pSizes'); row.innerHTML = '';
    C.PLOT_SIZES.forEach((sz) => {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = sz;
      if (sz === p.size) b.className = 'on';
      b.onclick = () => { p.size = sz; save(true); openPlotSheet(p); renderVeg(); buzz(); };
      row.appendChild(b);
    });
    $('psheet').hidden = false;
  }
  let plotCtx = null;

  /* ───────── 훼손수목 ───────── */
  function addTree() {
    treeCtx = { id: uid(), name: '', scientific: '', family: '', taxonId: null,
      dbh: '', height: '', crown: '', stems: 1, action: 'move', note: '',
      lat: null, lng: null, at: Date.now(), _new: true };
    openTreeSheet(treeCtx);
    getPos((c) => {
      if (c && treeCtx) { treeCtx.lat = +c.latitude.toFixed(6); treeCtx.lng = +c.longitude.toFixed(6); renderTreeSpec(); }
    });
  }
  let treeCtx = null;

  function openTreeSheet(t) {
    treeCtx = t;
    $('tsTitle').textContent = t._new ? '수목 기록' : '수목 수정';
    $('tsQ').value = '';
    $('tsResults').innerHTML = '';
    $('tsPicked').textContent = t.name ? `${t.name}${t.family ? ' · ' + t.family : ''}` : '수종을 먼저 고르세요';
    $('tsPicked').className = 'picked' + (t.name ? ' ok' : '');
    $('tDbh').value = t.dbh || '';
    $('tHeight').value = t.height || '';
    $('tCrown').value = t.crown || '';
    $('tStems').value = Math.max(1, Number(t.stems) || 1);
    $('tNote').value = t.note || '';
    $('tsDel').hidden = !!t._new;
    const row = $('tActions'); row.innerHTML = '';
    C.TREE_ACTIONS.forEach((a) => {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = a.label;
      b.dataset.v = a.v;
      if (a.v === t.action) b.className = 'on';
      b.onclick = () => { t.action = a.v; openTreeSheetActions(); buzz(); };
      row.appendChild(b);
    });
    renderTreeSpec();
    $('tsheet').hidden = false;
  }
  function openTreeSheetActions() {
    [...$('tActions').children].forEach((b) => {
      b.className = b.dataset.v === treeCtx.action ? 'on' : '';
    });
  }
  function renderTreeSpec() {
    if (!treeCtx) return;
    const t = { height: $('tHeight').value, dbh: $('tDbh').value, crown: $('tCrown').value };
    const spec = C.treeSpec(t);
    const cls = C.dbhClass($('tDbh').value);
    const gps = treeCtx.lat != null ? ` · GPS ✓` : ' · GPS 대기';
    $('tSpec').textContent = (spec || '규격 미입력') + (cls ? ` (${cls})` : '') + gps;
  }

  function renderTrees() {
    const s = cur();
    const sum = C.summarizeTrees(s.trees);
    $('treeStat').innerHTML =
      `<div class="stat"><b>${sum.stems}</b><span>총 본수</span></div>` +
      `<div class="stat"><b>${sum.taxaCount}</b><span>수종</span></div>` +
      C.TREE_ACTIONS.map((a) => `<div class="stat"><b>${sum.byAction[a.v].stems}</b><span>${a.label}</span></div>`).join('');

    const ul = $('treeList'); ul.innerHTML = '';
    if (!s.trees.length) {
      ul.innerHTML = '<li class="empty">이식·벌채 대상 수목을 기록하세요.</li>';
      return;
    }
    s.trees.slice().reverse().forEach((t) => {
      const li = document.createElement('li');
      if (t.id === flashId) li.className = 'flash';
      const spec = C.treeSpec(t);
      li.innerHTML =
        `<div class="meta"><div class="nm">${esc(t.name || '(수종 미지정)')}` +
        `<span class="tag ${t.action}">${esc(C.TREE_ACTION_LABEL[t.action] || '')}</span></div>` +
        `<div class="sc">${esc(spec || '규격 미입력')}${t.stems > 1 ? ' · ' + t.stems + '본' : ''}` +
        `${t.lat != null ? ' · GPS✓' : ''}</div>` +
        `${t.note ? `<div class="fm">${esc(t.note)}</div>` : ''}</div>`;
      li.onclick = () => openTreeSheet(Object.assign({}, t, { _new: false }));
      ul.appendChild(li);
    });
  }

  function addSite() {
    const s = cur();
    const site = { id: uid(), name: 'St.' + (s.sites.length + 1), lat: null, lon: null, alt: null, acc: null, at: Date.now() };
    s.sites.push(site); s.currentSiteId = site.id;
    save(); renderAll(); buzz(20);
    toast(site.name + ' 추가 · GPS 측정중…');
    locate(site);
  }

  /**
   * 지점 좌표를 측정한다. 산속·수관 아래에서는 첫 시도가 자주 실패하므로
   * 권한 거부가 아닌 한 한 번 더 시도한다(정확도 조건을 낮춰서).
   */
  function locate(site, retry) {
    if (!navigator.geolocation) { toast('이 기기는 위치를 지원하지 않습니다'); return; }
    site.locating = true; renderSites();
    navigator.geolocation.getCurrentPosition(
      (p) => {
        site.lat = p.coords.latitude; site.lon = p.coords.longitude;
        site.alt = p.coords.altitude; site.acc = p.coords.accuracy; site.at = Date.now();
        site.locating = false;
        save(true); renderSites();
        toast(`${site.name} 좌표 기록 (±${Math.round(p.coords.accuracy)}m)`);
        buzz(20);
      },
      (err) => {
        if (err.code !== 1 && !retry) { locate(site, true); return; }   // 권한 거부가 아니면 재시도
        site.locating = false;
        save(true); renderSites();
        toast(err.code === 1
          ? '위치 권한이 꺼져 있습니다 · 좌표 없이 기록됩니다'
          : '위치를 못 잡았습니다 · 지점을 눌러 다시 측정하세요');
      },
      retry
        ? { enableHighAccuracy: false, timeout: 30000, maximumAge: 60000 }
        : { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
    );
  }

  /* ───────── 지점 편집 ─────────
   * prompt/confirm을 연달아 띄우면 장갑 낀 손으로 매번 통과해야 한다.
   * 한 시트에서 이름·좌표·삭제를 모두 처리한다. */

  // 제주 조사에서 자주 쓰는 지점명. 탭 한 번으로 넣는다.
  const SITE_PRESETS = ['오름 북사면', '오름 남사면', '계곡부', '농로변', '임연부', '초지', '해안가', '하천변'];
  let siteCtx = null;

  function editSite(site) {
    siteCtx = site;
    $('gsTitle').textContent = site.name;
    $('gsName').value = site.name;
    $('gsCoord').textContent = site.lat != null
      ? `${C.toDMS(site.lat, true)}  ${C.toDMS(site.lon, false)}` +
        (site.alt != null ? `  ${Math.round(site.alt)}m` : '') +
        (site.acc != null ? `  ±${Math.round(site.acc)}m` : '')
      : '좌표 없음';

    const s = cur();
    const used = s.records.some((r) => r.siteId === site.id);
    const del = $('gsDel');
    del.disabled = s.sites.length <= 1;
    del.textContent = used ? `지점 삭제 (기록 ${s.records.filter((r) => r.siteId === site.id).length}건)` : '지점 삭제';

    const box = $('gsPresets'); box.innerHTML = '';
    SITE_PRESETS.forEach((p) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'chip'; b.textContent = p;
      b.onclick = () => { $('gsName').value = p; buzz(10); };
      box.appendChild(b);
    });

    $('gsheet').hidden = false;
  }

  function bindSiteSheet() {
    const close = () => { siteCtx = null; $('gsheet').hidden = true; };
    $('gsheet').querySelector('.sheet-bg').onclick = close;

    $('gsOk').onclick = () => {
      if (!siteCtx) return close();
      const v = $('gsName').value.trim();
      if (v) siteCtx.name = v;
      cur().currentSiteId = siteCtx.id;   // 연 지점으로 전환 — 목록에서 눌렀으면 거기서 이어 적는다
      save(true); renderAll(); close();
    };

    $('gsLocate').onclick = () => {
      if (!siteCtx) return;
      const v = $('gsName').value.trim();
      if (v) siteCtx.name = v;
      locate(siteCtx); close();
    };

    $('gsDel').onclick = () => {
      if (!siteCtx) return;
      const s = cur();
      if (s.sites.length <= 1) { toast('마지막 지점은 지울 수 없습니다'); return; }
      const recs = s.records.filter((r) => r.siteId === siteCtx.id);
      if (recs.length && !confirm(`${siteCtx.name}의 기록 ${recs.length}건도 함께 지워집니다. 계속할까요?`)) return;

      const site = siteCtx;
      const idx = s.sites.indexOf(site);
      pushUndo(`${site.name} 삭제`, () => {
        s.sites.splice(Math.min(idx, s.sites.length), 0, site);
        s.records = s.records.concat(recs);
      });
      s.sites = s.sites.filter((x) => x.id !== site.id);
      s.records = s.records.filter((r) => r.siteId !== site.id);
      if (s.currentSiteId === site.id) s.currentSiteId = s.sites[0].id;
      save(true); renderAll(); close();
    };
  }

  /* ───────── 내보내기 ───────── */
  function download(name, text, mime) {
    // BOM이 없을 때만 붙인다. 두 번 붙으면 엑셀 첫 셀에 깨진 문자가 들어간다.
    const body = String(text).charCodeAt(0) === 0xFEFF ? String(text) : '\ufeff' + text;
    const blob = new Blob([body], { type: (mime || 'text/csv') + ';charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    toast(name + ' 저장');
  }
  async function shareCSV() {
    const s = cur();
    const name = C.fileStamp(s) + '_기록.csv';
    const file = new File(['\ufeff' + C.toRecordsCSV(s)], name, { type: 'text/csv' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: s.title }); return; }
      catch (e) { if (e && e.name === 'AbortError') return; }
    }
    download(name, C.toRecordsCSV(s));
    toast('공유 미지원 — 파일로 저장했습니다');
  }

  /* ───────── 초기화 ───────── */
  /** 탭 전환을 한 곳에서 처리한다 (코드에서도 부를 수 있게) */
  function goTab(name) {
    document.querySelectorAll('#tabbar button').forEach((x) => x.classList.toggle('on', x.dataset.tab === name));
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
    const sec = $('tab-' + name);
    if (sec) sec.classList.add('active');
    if (name === 'sum') renderSummary();
    if (name === 'site') renderSites();
    if (name === 'veg') renderVeg();
    if (name === 'tree') renderTrees();
    scrollTop();
    document.dispatchEvent(new CustomEvent('tabchange', { detail: name }));
  }

  function bindTabs() {
    document.querySelectorAll('#tabbar button').forEach((b) => {
      b.onclick = () => { goTab(b.dataset.tab); buzz(8); };
    });
  }

  /** 우점도 시트가 식생 항목을 편집 중이면 방형구 쪽 원본에 반영한다 */
  function syncVegItem() {
    if (!sheetCtx || !sheetCtx._veg) return;
    const it = sheetCtx._veg.item;
    it.cover = sheetCtx.cover;
    it.note = sheetCtx.note;
    save(true);
  }

  function bindSheet() {
    const cb = $('coverBtns');
    C.COVER.forEach((c) => {
      const b = document.createElement('button');
      b.type = 'button'; b.dataset.v = c.v;
      b.innerHTML = `<b>${c.label}</b><small>${c.desc}</small>`;
      b.onclick = () => {
        [...cb.children].forEach((x) => x.classList.toggle('on', x === b));
        if (sheetCtx) { sheetCtx.cover = c.v; syncVegItem(); save(true); }
        buzz();
      };
      cb.appendChild(b);
    });
    const none = document.createElement('button');
    none.type = 'button'; none.dataset.v = ''; none.innerHTML = '<b>–</b><small>미기재</small>';
    none.onclick = () => {
      [...cb.children].forEach((x) => x.classList.toggle('on', x === none));
      if (sheetCtx) { sheetCtx.cover = ''; syncVegItem(); save(true); }
    };
    cb.appendChild(none);

    const setCount = (v) => {
      const n = Math.max(0, v);
      $('cNum').value = n;
      if (sheetCtx) { sheetCtx.count = n; save(true); }
    };
    $('cMinus').onclick = () => { setCount(parseInt($('cNum').value || '1', 10) - 1); buzz(); };
    $('cPlus').onclick = () => { setCount(parseInt($('cNum').value || '0', 10) + 1); buzz(); };
    $('cNum').oninput = () => setCount(parseInt($('cNum').value || '0', 10));
    $('cNote').oninput = () => { if (sheetCtx) { sheetCtx.note = $('cNote').value; syncVegItem(); save(); } };
    $('cNote').onblur = () => { syncVegItem(); save(true); };

    const closeAndPaint = () => {
      const wasVeg = !!(sheetCtx && sheetCtx._veg);
      syncVegItem();
      closeSheet();
      if (wasVeg) renderVeg(); else { renderRecList(); renderTop(); }
      renderSummary();
    };
    $('sheetOk').onclick = closeAndPaint;
    $('sheetDel').onclick = () => {
      if (!sheetCtx) return closeSheet();
      if (sheetCtx._veg) {
        const { plot, item } = sheetCtx._veg;
        const i = plot.items.indexOf(item);
        plot.items = plot.items.filter((x) => x.id !== item.id);
        pushUndo(`${item.name} 삭제`, () => plot.items.splice(Math.min(i, plot.items.length), 0, item));
        save(true); closeSheet(); renderVeg();
        return;
      }
      const s = cur();
      const rec = sheetCtx;
      const i = s.records.indexOf(rec);
      s.records = s.records.filter((r) => r.id !== rec.id);
      pushUndo(`${rec.name} 삭제`, () => s.records.splice(Math.min(i, s.records.length), 0, rec));
      save(true); closeSheet(); renderAll();
    };
    $('sheet').querySelector('.sheet-bg').onclick = closeAndPaint;
    $('ssheet').querySelector('.sheet-bg').onclick = () => { $('ssheet').hidden = true; };
  }

  function bindSurveySheet() {
    $('surveyBtn').onclick = () => {
      const ul = $('surveyList'); ul.innerHTML = '';
      state.surveys.slice().sort((a, b) => b.createdAt - a.createdAt).forEach((s) => {
        const n = new Set(s.records.map((r) => r.taxonId)).size;
        const li = document.createElement('li');
        const isCur = s.id === state.currentId;
        li.innerHTML =
          `<div class="meta"><div class="sname">${isCur ? '● ' : ''}${esc(s.title)}</div>` +
          `<div class="scoord">${esc(s.date)} · ${s.sites.length}지점 · 기록 ${s.records.length}건</div></div>` +
          `<span class="sn">${n}종</span>` +
          `<button class="del" type="button" aria-label="삭제">✕</button>`;
        li.querySelector('.del').onclick = (ev) => {
          ev.stopPropagation();
          if (state.surveys.length <= 1) { toast('마지막 조사는 삭제할 수 없습니다'); return; }
          const msg = s.records.length
            ? `"${s.title}"에 기록 ${s.records.length}건이 있습니다. 정말 삭제할까요?`
            : `"${s.title}"을(를) 삭제할까요?`;
          if (!confirm(msg)) return;
          const i = state.surveys.indexOf(s);
          const wasCurrent = state.currentId === s.id;
          state.surveys = state.surveys.filter((x) => x.id !== s.id);
          if (wasCurrent) state.currentId = state.surveys[0].id;
          pushUndo(`"${s.title}" 삭제`, () => {
            state.surveys.splice(Math.min(i, state.surveys.length), 0, s);
            if (wasCurrent) state.currentId = s.id;
          });
          save(true); renderAll();
          $('surveyBtn').onclick();   // 목록 갱신
        };
        li.onclick = () => { state.currentId = s.id; save(true); $('ssheet').hidden = true; renderAll(); };
        ul.appendChild(li);
      });
      $('ssheet').hidden = false;
    };
    $('ssNew').onclick = () => { $('ssheet').hidden = true; doNewSurvey(); };
  }

  function doNewSurvey() {
    const title = prompt('새 조사명', '조사 ' + todayISO());
    if (title === null) return;
    const s = newSurvey(title.trim() || ('조사 ' + todayISO()));
    state.surveys.push(s); state.currentId = s.id;
    save(true); renderAll(); toast('새 조사 시작');
  }

  /** 훼손수목 시트 배선 — 수종 검색, 숫자 스테퍼, 저장/삭제 */
  function bindTreeSheet() {
    $('addTree').onclick = addTree;

    const tq = $('tsQ');
    let tmr = null;
    tq.oninput = () => {
      clearTimeout(tmr);
      tmr = setTimeout(() => {
        const ul = $('tsResults'); ul.innerHTML = '';
        if (!index || !tq.value.trim()) return;
        C.search(index, tq.value, 20).forEach((t) => {
          const li = document.createElement('li');
          li.innerHTML = `<div class="meta"><div class="nm">${esc(t.n)}</div><div class="sc">${esc(t.s)}</div></div>`;
          li.onclick = () => {
            treeCtx.taxonId = t.i; treeCtx.name = t.n;
            treeCtx.scientific = t.s || ''; treeCtx.family = t.f || '';
            $('tsPicked').textContent = `${t.n}${t.f ? ' · ' + t.f : ''}`;
            $('tsPicked').className = 'picked ok';
            tq.value = ''; ul.innerHTML = ''; buzz(15);
          };
          ul.appendChild(li);
        });
      }, 60);
    };
    $('tsMic').onclick = () => startMic(tq, $('tsMic'));

    // 장갑 낀 손으로도 누를 수 있는 큰 ± 버튼
    $('tsheet').querySelectorAll('.stepper button').forEach((b) => {
      b.onclick = () => {
        const f = b.dataset.f, d = parseFloat(b.dataset.d);
        const el = { dbh: $('tDbh'), height: $('tHeight'), crown: $('tCrown'), stems: $('tStems') }[f];
        const min = f === 'stems' ? 1 : 0;
        const v = Math.max(min, Math.round(((parseFloat(el.value) || 0) + d) * 10) / 10);
        el.value = v; renderTreeSpec(); buzz();
      };
    });
    ['tDbh', 'tHeight', 'tCrown'].forEach((id) => { $(id).oninput = renderTreeSpec; });

    $('tsOk').onclick = () => {
      if (!treeCtx) return;
      if (!treeCtx.name) { toast('수종을 먼저 고르세요'); buzz(30); return; }
      const s = cur();
      Object.assign(treeCtx, {
        dbh: $('tDbh').value, height: $('tHeight').value, crown: $('tCrown').value,
        stems: Math.max(1, parseInt($('tStems').value, 10) || 1),
        note: $('tNote').value,
      });
      const isNew = treeCtx._new;
      const rec = Object.assign({}, treeCtx);
      delete rec._new;
      if (isNew) s.trees.push(rec);
      else s.trees = s.trees.map((x) => (x.id === rec.id ? rec : x));
      flashId = rec.id;
      save(true);
      $('tsheet').hidden = true; treeCtx = null;
      renderTrees(); buzz(20);
      toast(`${rec.name} ${isNew ? '기록' : '수정'}됨 · 총 ${C.summarizeTrees(s.trees).stems}본`);
    };
    $('tsDel').onclick = () => {
      if (!treeCtx || treeCtx._new) { $('tsheet').hidden = true; treeCtx = null; return; }
      const s = cur();
      const tree = treeCtx;
      const i = s.trees.indexOf(tree);
      s.trees = s.trees.filter((x) => x.id !== tree.id);
      pushUndo(`${tree.name || '수목'} 삭제`, () => s.trees.splice(Math.min(i, s.trees.length), 0, tree));
      save(true); $('tsheet').hidden = true; treeCtx = null;
      renderTrees();
    };
    $('tsheet').querySelector('.sheet-bg').onclick = () => { $('tsheet').hidden = true; treeCtx = null; };
  }

  /** 방형구 시트 배선 */
  function bindPlotSheet() {
    $('addPlot').onclick = addPlot;
    const fields = { pName: 'name', pSlope: 'slope', pAspect: 'aspect', pElev: 'elev', pNote: 'note' };
    Object.keys(fields).forEach((id) => {
      const el = $(id);
      const apply = () => { if (plotCtx) { plotCtx[fields[id]] = el.value; save(true); } };
      el.oninput = apply; el.onchange = apply; el.onblur = apply;
    });
    $('psOk').onclick = () => { $('psheet').hidden = true; plotCtx = null; renderVeg(); };
    $('psDel').onclick = () => {
      if (!plotCtx) return;
      const n = (plotCtx.items || []).length;
      if (n && !confirm(`${plotCtx.name} 방형구를 삭제할까요? (기록 ${n}종도 함께)`)) return;
      const s = cur();
      const plot = plotCtx;
      const i = s.plots.indexOf(plot);
      s.plots = s.plots.filter((x) => x.id !== plot.id);
      pushUndo(`${plot.name} 삭제`, () => s.plots.splice(Math.min(i, s.plots.length), 0, plot));
      save(true); $('psheet').hidden = true; plotCtx = null;
      renderVeg();
    };
    $('psheet').querySelector('.sheet-bg').onclick = () => { $('psheet').hidden = true; plotCtx = null; renderVeg(); };

    $('vegBannerEnd').onclick = () => {
      const p = vegCtx && vegCtx.plot;
      setVegCtx(null);
      toast('식생 입력 종료');
      if (p) goTab('veg');
    };
  }

  /* ───────── 불러오기 ─────────
   * 백업 JSON뿐 아니라 엑셀에서 고쳐 온 CSV도 받는다.
   * 사전에 없는 이름도 버리지 않는다 — 현장에서 적은 종을 임의로 삭제하면 안 된다. */

  /** 국명으로 사전을 찾는다. 공백·괄호를 무시해 느슨하게 맞춘다. */
  function lookupByName(name) {
    if (!index) return null;
    const hits = C.search(index, name, 5);
    const key = C.norm(name);
    return hits.find((h) => C.norm(h.n) === key) || hits.find((h) => C.norm(h.matched || '') === key) || null;
  }

  function importText(text) {
    const t = String(text || '').replace(/^\ufeff/, '').trim();
    if (!t) { toast('빈 파일입니다'); return; }

    // JSON 백업
    if (t[0] === '{' || t[0] === '[') {
      try {
        const data = JSON.parse(t);
        const list = data.surveys || (data.records ? [data] : null);
        if (!list) throw new Error('형식 불일치');
        const ids = new Set(state.surveys.map((s) => s.id));
        let added = 0;
        list.forEach((s) => { if (!ids.has(s.id)) { state.surveys.push(s); added++; } });
        migrate(state); save(true); renderAll();
        toast(`조사 ${added}건 불러옴`);
      } catch (err) { toast('불러오기 실패: ' + err.message); }
      return;
    }

    // 훼손수목 조서인지 먼저 본다
    if (/훼손수목|수종/.test(t.split('\n').slice(0, 8).join('\n'))) {
      const r = C.parseTreeCSV(t, lookupByName, { uid });
      if (r.trees.length) {
        const s = cur();
        if (s.trees.length && !confirm(`수목 ${r.trees.length}건을 불러옵니다.\n기존 ${s.trees.length}건을 대체할까요?\n(취소를 누르면 뒤에 덧붙입니다)`)) {
          s.trees = s.trees.concat(r.trees);
        } else {
          s.trees = r.trees;
        }
        save(true); renderAll(); goTab('tree');
        reportImport(`수목 ${r.trees.length}건`, r.unknown);
        return;
      }
    }

    // 기록 CSV / 종 목록
    const r = C.parseRecordsCSV(t, lookupByName, { uid, defaultSite: 'St.1' });
    if (!r.records.length) { toast('읽을 수 있는 행이 없습니다'); return; }

    const s = cur();
    const replace = !s.records.length ||
      confirm(`종 ${r.records.length}건을 불러옵니다.\n기존 기록 ${s.records.length}건을 대체할까요?\n(취소를 누르면 현재 지점에 덧붙입니다)`);

    if (replace) {
      s.sites = r.sites;
      s.records = r.records;
      s.currentSiteId = r.sites[0] ? r.sites[0].id : null;
    } else {
      // 덧붙이기: 전부 현재 지점으로 모은다
      const site = curSite();
      r.records.forEach((rec) => { rec.siteId = site.id; });
      s.records = s.records.concat(r.records);
    }
    save(true); renderAll(); goTab('rec');
    reportImport(`${r.records.length}건`, r.unknown);
  }

  /** 불러온 결과를 알린다. 사전에 없던 이름은 반드시 사용자에게 보여준다. */
  function reportImport(what, unknown) {
    buzz(25);
    if (!unknown || !unknown.length) { toast(`${what} 불러옴`); return; }
    const uniq = [...new Set(unknown)];
    const head = uniq.slice(0, 5).join(', ');
    toast(`${what} 불러옴 · 사전에 없는 ${uniq.length}종: ${head}${uniq.length > 5 ? ' 외' : ''}`);
  }

  /* ───────── 햇빛 모드 ─────────
   * 땡볕 아래서는 어두운 화면이 안 보인다. 흰 배경·검은 글씨로 바꾼다.
   * 조사 데이터가 아니라 기기 설정이므로 localStorage에 따로 둔다. */
  function bindSunMode() {
    const KEY = 'field_flora_sun';
    const btn = $('sunToggle');
    const paint = (on) => {
      document.body.classList.toggle('sun', on);
      btn.textContent = on ? '🌙 어두운 모드로' : '☀️ 햇빛 모드 (밝게)';
      const meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute('content', on ? '#0a6b33' : '#14532d');
    };
    let on = false;
    try { on = localStorage.getItem(KEY) === '1'; } catch (e) { /* 사생활 보호 모드 */ }
    paint(on);
    btn.onclick = () => {
      on = !on;
      paint(on);
      try { localStorage.setItem(KEY, on ? '1' : '0'); } catch (e) {}
      buzz(12);
      toast(on ? '햇빛 모드 — 밝은 곳에서 잘 보입니다' : '어두운 모드');
    };
  }

  /* ───────── 플로팅 검색 버튼 ─────────
   * 기록이 쌓이면 목록을 한참 내려보게 된다. 그때 검색창은 화면 위로 사라져
   * 한 손으로는 닿지 않는다. 스크롤을 내리면 엄지 위치에 버튼을 띄운다. */
  function bindFab() {
    const fab = $('fabSearch');
    const onRecTab = () => $('tab-rec').classList.contains('active');
    const update = () => {
      fab.hidden = !(onRecTab() && window.scrollY > 240);
    };
    fab.onclick = () => {
      scrollTop(true);
      const q = $('q');
      q.focus();
      if (q.value) q.select();
      buzz(10);
    };
    window.addEventListener('scroll', update, { passive: true });
    document.addEventListener('tabchange', update);
    update();
  }

  function bindRest() {
    const q = $('q');
    let tmr = null;
    q.oninput = () => {
      clearTimeout(tmr);
      tmr = setTimeout(() => {
        if (!index) return;
        shownCount = PAGE;          // 새 검색이면 다시 25개부터
        renderResults(q.value.trim() ? C.search(index, q.value, 99999) : []);
      }, 60);
    };
    q.onkeydown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const first = $('results').querySelector('li:not(.more)');
        if (first) first.click();   // addRecord가 검색창을 비우고 포커스를 유지한다
      }
    };
    // 검색창을 다시 누르면 남은 글자를 통째로 선택해 바로 덮어쓸 수 있게 한다
    q.onfocus = () => { if (q.value) q.select(); };
    $('qClear').onclick = () => { q.value = ''; renderResults([]); setMicHint(''); q.focus(); };
    $('qMic').onclick = () => startMic(q, $('qMic'));

    $('addSite').onclick = addSite;
    $('expRec').onclick = () => download(C.fileStamp(cur()) + '_기록.csv', C.toRecordsCSV(cur()));
    $('expMat').onclick = () => download(C.fileStamp(cur()) + '_조사표.csv', C.toMatrixCSV(cur()));
    $('expVeg').onclick = () => {
      const s = cur();
      if (!s.plots.length) { toast('방형구가 없습니다'); return; }
      download(C.fileStamp(s) + '_식생조사표.csv', C.toVegCSV(s));
    };
    $('expTree').onclick = () => {
      const s = cur();
      if (!s.trees.length) { toast('기록된 수목이 없습니다'); return; }
      download(C.fileStamp(s) + '_훼손수목조서.csv', C.toTreeCSV(s));
    };
    $('shareRec').onclick = shareCSV;
    $('expJson').onclick = () => download(C.fileStamp(cur()) + '_백업.json', JSON.stringify(state, null, 1), 'application/json');
    $('newSurvey').onclick = doNewSurvey;
    $('importFile').onclick = () => $('fileInput').click();
    $('fileInput').onchange = (e) => {
      const f = e.target.files[0]; if (!f) return;
      const rd = new FileReader();
      rd.onload = () => importText(String(rd.result));
      rd.readAsText(f, 'utf-8');
      e.target.value = '';
    };

    const bindField = (id, key) => {
      const el = $(id);
      el.oninput = () => { cur()[key] = el.value; save(); renderTop(); };
      el.onblur = el.onchange = () => { cur()[key] = el.value; save(true); };
    };
    bindField('fTitle', 'title'); bindField('fDate', 'date'); bindField('fSurveyor', 'surveyor');

    const net = () => {
      const on = navigator.onLine;
      $('netBadge').textContent = on ? '온라인' : '오프라인';
      $('netBadge').className = 'badge' + (on ? '' : ' off');
    };
    window.addEventListener('online', net); window.addEventListener('offline', net); net();
    window.addEventListener('pagehide', () => save(true));
    document.addEventListener('visibilitychange', () => { if (document.hidden) save(true); });
  }

  async function boot() {
    bindTabs(); bindSheet(); bindSurveySheet(); bindSiteSheet(); bindTreeSheet(); bindPlotSheet(); bindRest(); bindWakeLock(); bindSunMode(); bindFab();

    state = await kvGet('state');
    if (!state || !state.surveys || !state.surveys.length) {
      state = { surveys: [], currentId: null, recent: [] };
      const s = newSurvey(null);
      state.surveys.push(s); state.currentId = s.id;
      save(true);
    }
    // 기록이 하나도 없는 자동생성 조사가 여러 개 쌓이면 하나만 남긴다.
    // (IndexedDB가 늦게 열리던 시절 실행할 때마다 빈 조사가 생기던 흔적 정리)
    const empties = state.surveys.filter(isEmptySurvey);
    if (empties.length > 1) {
      const keep = state.surveys.find((s) => s.id === state.currentId && isEmptySurvey(s)) || empties[empties.length - 1];
      state.surveys = state.surveys.filter((s) => !isEmptySurvey(s) || s.id === keep.id);
      if (!state.surveys.some((s) => s.id === state.currentId)) state.currentId = keep.id;
      save(true);
    }
    if (!cur()) state.currentId = state.surveys[0].id;
    migrate(state);   // 예전 조사에 plots/trees 채우기
    renderAll();

    try {
      const res = await fetch('data/taxa.json');
      const dict = await res.json();
      index = C.buildIndex(dict.taxa);
      $('dictInfo').textContent = `종 사전 ${dict.taxa.length.toLocaleString('ko-KR')}종 탑재 (출처: 로컬 식물 도감 색인)`;
      renderRecent();
    } catch (e) {
      $('dictInfo').textContent = '종 사전 로드 실패 — 온라인에서 한 번 열어야 사전이 저장됩니다.';
      toast('종 사전을 불러오지 못했습니다');
    }

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
