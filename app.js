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
  let lastAdded = null;    // 직전에 추가한 기록 — 취소(undo) 대상

  function newSurvey(title) {
    const s = {
      id: uid(), title: title || ('조사 ' + todayISO()), date: todayISO(), surveyor: '',
      sites: [], records: [], currentSiteId: null, createdAt: Date.now(),
    };
    const site = { id: uid(), name: 'St.1', lat: null, lon: null, alt: null, acc: null, at: Date.now() };
    s.sites.push(site); s.currentSiteId = site.id;
    return s;
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

  function toast(msg) {
    const el = $('toast');
    el.textContent = msg; el.hidden = false;
    el.classList.remove('withbtn');
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.hidden = true; }, 1800);
  }
  /** 취소 버튼이 달린 토스트 — 잘못 누른 기록을 바로 되돌린다 */
  function showUndo(msg) {
    const el = $('toast');
    el.innerHTML = '';
    el.classList.add('withbtn');
    const span = document.createElement('span');
    span.textContent = msg;
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'undo'; btn.textContent = '취소';
    btn.onclick = (ev) => { ev.stopPropagation(); clearTimeout(el._t); el.hidden = true; undoLast(); };
    el.appendChild(span); el.appendChild(btn);
    el.hidden = false;
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.hidden = true; lastAdded = null; }, 4000);
  }
  function buzz(ms) { if (navigator.vibrate) navigator.vibrate(ms || 12); }

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
    const have = new Set(s.records.filter((r) => r.siteId === site.id).map((r) => r.taxonId));
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
      b.onclick = () => addRecord(t);
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
      const coord = site.lat != null
        ? `${C.toDMS(site.lat, true)}  ${C.toDMS(site.lon, false)}${site.alt != null ? '  ' + Math.round(site.alt) + 'm' : ''}`
        : '좌표 없음 (탭하여 재측정)';
      li.innerHTML = `<div class="meta"><div class="sname">${esc(site.name)}</div><div class="scoord">${esc(coord)}</div></div><span class="sn">${n}종</span>`;
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

  function renderAll() { renderTop(); renderRecList(); renderRecent(); renderSites(); renderSummary(); }

  /* ───────── 동작 ───────── */
  /** 검색 결과를 탭하면 추가, 같은 종을 다시 탭하면 취소(토글) */
  function addRecord(t) {
    const s = cur(); const site = curSite();
    const clearSearch = () => { const q = $('q'); q.value = ''; renderResults([]); q.focus(); };
    const exist = s.records.find((r) => r.siteId === site.id && r.taxonId === t.i);

    if (exist) {
      // 개체수·우점도·비고를 입력해둔 기록은 실수로 날리지 않도록 확인한다
      const hasData = (exist.count || 1) > 1 || exist.cover || exist.note;
      if (hasData && !confirm(`${t.n}에 입력한 내용이 있습니다. 기록을 삭제할까요?`)) { clearSearch(); return; }
      s.records = s.records.filter((r) => r.id !== exist.id);
      lastAdded = null;
      buzz(20); save(true);
      renderAll();
      toast(`${t.n} 취소됨`);
      clearSearch();
      return;
    }

    const addedId = uid();
    s.records.push({
      id: addedId, siteId: site.id, taxonId: t.i, name: t.n,
      scientific: t.s || '', family: t.f || '', count: 1, cover: '', note: '', at: Date.now(),
    });
    const n = new Set(s.records.filter((r) => r.siteId === site.id).map((r) => r.taxonId)).size;
    lastAdded = { id: addedId, name: t.n, siteId: site.id };
    showUndo(`${t.n} 추가 · ${site.name} ${n}종`);

    state.recent = [t.i].concat((state.recent || []).filter((x) => x !== t.i)).slice(0, 30);
    buzz(15); save(true);   // 기록은 절대 유실되면 안 된다 — 즉시 저장
    flashId = addedId;
    renderTop(); renderRecList(); renderRecent(); renderSummary();
    clearSearch();          // 다음 종을 바로 칠 수 있게
  }

  /** 방금 추가한 기록을 되돌린다 (잘못 누른 경우) */
  function undoLast() {
    if (!lastAdded) return;
    const s = cur();
    const before = s.records.length;
    s.records = s.records.filter((r) => r.id !== lastAdded.id);
    if (s.records.length === before) { lastAdded = null; return; }
    const nm = lastAdded.name;
    lastAdded = null;
    save(true); renderAll();
    toast(`${nm} 취소됨`);
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

  function addSite() {
    const s = cur();
    const site = { id: uid(), name: 'St.' + (s.sites.length + 1), lat: null, lon: null, alt: null, acc: null, at: Date.now() };
    s.sites.push(site); s.currentSiteId = site.id;
    save(); renderAll(); buzz(20);
    toast(site.name + ' 추가 · GPS 측정중…');
    locate(site);
  }

  function locate(site) {
    if (!navigator.geolocation) { toast('이 기기는 위치를 지원하지 않습니다'); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => {
        site.lat = p.coords.latitude; site.lon = p.coords.longitude;
        site.alt = p.coords.altitude; site.acc = p.coords.accuracy; site.at = Date.now();
        save(true); renderSites();
        toast(`${site.name} 좌표 기록 (±${Math.round(p.coords.accuracy)}m)`);
      },
      (err) => toast('위치 실패: ' + (err.code === 1 ? '권한 거부' : err.code === 3 ? '시간초과' : '신호 없음')),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
    );
  }

  function editSite(site) {
    const s = cur();
    const name = prompt('지점명 (취소하면 변경 없음)', site.name);
    if (name !== null && name.trim()) { site.name = name.trim(); save(true); renderAll(); }
    if (confirm(site.name + ' 위치를 지금 GPS로 (재)측정할까요?')) locate(site);
    else if (s.sites.length > 1 && !s.records.some((r) => r.siteId === site.id)
             && confirm(site.name + ' 지점을 삭제할까요? (기록 없음)')) {
      s.sites = s.sites.filter((x) => x.id !== site.id);
      if (s.currentSiteId === site.id) s.currentSiteId = s.sites[0].id;
      save(true); renderAll();
    }
  }

  /* ───────── 내보내기 ───────── */
  function download(name, text, mime) {
    const blob = new Blob(['\ufeff' + text], { type: (mime || 'text/csv') + ';charset=utf-8' });
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
  function bindTabs() {
    document.querySelectorAll('#tabbar button').forEach((b) => {
      b.onclick = () => {
        document.querySelectorAll('#tabbar button').forEach((x) => x.classList.toggle('on', x === b));
        document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
        $('tab-' + b.dataset.tab).classList.add('active');
        if (b.dataset.tab === 'sum') renderSummary();
        if (b.dataset.tab === 'site') renderSites();
      };
    });
  }

  function bindSheet() {
    const cb = $('coverBtns');
    C.COVER.forEach((c) => {
      const b = document.createElement('button');
      b.type = 'button'; b.dataset.v = c.v;
      b.innerHTML = `<b>${c.label}</b><small>${c.desc}</small>`;
      b.onclick = () => {
        [...cb.children].forEach((x) => x.classList.toggle('on', x === b));
        if (sheetCtx) { sheetCtx.cover = c.v; save(true); }
        buzz();
      };
      cb.appendChild(b);
    });
    const none = document.createElement('button');
    none.type = 'button'; none.dataset.v = ''; none.innerHTML = '<b>–</b><small>미기재</small>';
    none.onclick = () => {
      [...cb.children].forEach((x) => x.classList.toggle('on', x === none));
      if (sheetCtx) { sheetCtx.cover = ''; save(true); }
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
    $('cNote').oninput = () => { if (sheetCtx) { sheetCtx.note = $('cNote').value; save(); } };
    $('cNote').onblur = () => save(true);
    $('sheetOk').onclick = () => { closeSheet(); renderRecList(); renderTop(); renderSummary(); };
    $('sheetDel').onclick = () => {
      if (!sheetCtx) return closeSheet();
      const s = cur();
      s.records = s.records.filter((r) => r.id !== sheetCtx.id);
      save(true); closeSheet(); renderAll(); toast('삭제됨');
    };
    $('sheet').querySelector('.sheet-bg').onclick = () => { closeSheet(); renderRecList(); renderTop(); renderSummary(); };
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
          state.surveys = state.surveys.filter((x) => x.id !== s.id);
          if (state.currentId === s.id) state.currentId = state.surveys[0].id;
          save(true); renderAll(); toast('조사 삭제됨');
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
    $('qClear').onclick = () => { q.value = ''; renderResults([]); q.focus(); };

    $('addSite').onclick = addSite;
    $('expRec').onclick = () => download(C.fileStamp(cur()) + '_기록.csv', C.toRecordsCSV(cur()));
    $('expMat').onclick = () => download(C.fileStamp(cur()) + '_조사표.csv', C.toMatrixCSV(cur()));
    $('shareRec').onclick = shareCSV;
    $('expJson').onclick = () => download(C.fileStamp(cur()) + '_백업.json', JSON.stringify(state, null, 1), 'application/json');
    $('newSurvey').onclick = doNewSurvey;
    $('importJson').onclick = () => $('fileInput').click();
    $('fileInput').onchange = (e) => {
      const f = e.target.files[0]; if (!f) return;
      const rd = new FileReader();
      rd.onload = () => {
        try {
          const data = JSON.parse(rd.result);
          const list = data.surveys || (data.records ? [data] : null);
          if (!list) throw new Error('형식 불일치');
          const ids = new Set(state.surveys.map((s) => s.id));
          let added = 0;
          list.forEach((s) => { if (!ids.has(s.id)) { state.surveys.push(s); added++; } });
          save(true); renderAll();
          toast(`조사 ${added}건 불러옴`);
        } catch (err) { toast('불러오기 실패: ' + err.message); }
      };
      rd.readAsText(f);
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
    bindTabs(); bindSheet(); bindSurveySheet(); bindRest();

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
