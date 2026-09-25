/* 현장 시뮬레이션 — 실제 조사 흐름을 그대로 돌려 불편한 지점을 찾는다.
 * 이건 통과/실패 테스트가 아니라 "관찰 기록"이다. 막히는 곳을 출력한다.
 * node tools/sim.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const WEB = path.join(__dirname, '..');
const dict = JSON.parse(fs.readFileSync(path.join(WEB, 'data', 'taxa.json'), 'utf8'));
const issues = [];
const note = (where, msg) => { issues.push({ where, msg }); console.log(`  ⚠ [${where}] ${msg}`); };
const ok = (msg) => console.log(`  · ${msg}`);

(async () => {
  const html = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8');
  const dom = new JSDOM(html.replace('</head>', `<style>${fs.readFileSync(path.join(WEB, 'styles.css'), 'utf8')}</style></head>`),
    { runScripts: 'outside-only', url: 'http://localhost/', pretendToBeVisual: true });
  const { window } = dom;
  const doc = window.document;
  global.window = window; global.document = doc;
  try { global.navigator = window.navigator; } catch (e) {
    Object.defineProperty(global, 'navigator', { value: window.navigator, configurable: true });
  }

  const errors = [];
  window.addEventListener('error', (e) => errors.push(e.message));
  Object.defineProperty(window, 'indexedDB', { value: undefined, configurable: true });
  window.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve(dict) });
  window.navigator.vibrate = () => true;
  window.URL.createObjectURL = () => 'blob:x';
  window.URL.revokeObjectURL = () => {};

  // 현장: GPS는 자주 느리거나 실패한다
  let gpsMode = 'ok';
  Object.defineProperty(window.navigator, 'geolocation', {
    value: {
      getCurrentPosition: (okc, err) => {
        if (gpsMode === 'fail') return setTimeout(() => err({ code: 1, message: 'denied' }), 5);
        if (gpsMode === 'slow') return;   // 영영 응답 없음
        setTimeout(() => okc({ coords: { latitude: 33.3617, longitude: 126.3122, altitude: 320, accuracy: 8 } }), 5);
      },
    }, configurable: true,
  });

  const prompts = [];
  const confirms = [];
  window.prompt = (m) => { prompts.push(m); return null; };
  window.confirm = (m) => { confirms.push(m); return true; };

  window.eval(fs.readFileSync(path.join(WEB, 'core.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(WEB, 'app.js'), 'utf8'));

  const $ = (id) => doc.getElementById(id);
  const click = (el) => el && el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  const type = (el, v) => { el.value = v; el.dispatchEvent(new window.Event('input', { bubbles: true })); };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const S = () => { const st = JSON.parse(window.localStorage.getItem('field_flora_state')); return st.surveys.find((x) => x.id === st.currentId); };
  const tab = (n) => click($('tabbar').querySelector(`[data-tab="${n}"]`));
  const visible = (el) => el && !el.hidden && window.getComputedStyle(el).display !== 'none';
  const tapSize = (el) => {
    const s = window.getComputedStyle(el);
    return { h: parseInt(s.minHeight || s.height, 10) || 0, w: parseInt(s.minWidth || s.width, 10) || 0 };
  };

  await sleep(1800);

  console.log('\n═══ 1. 현장 도착 — 앱 켜기 ═══');
  ok(`첫 화면: ${[...$('tabbar').children].find((b) => b.classList.contains('on')).textContent}`);
  if (!S().sites.length) note('도착', '지점이 하나도 없어 바로 기록을 못 시작한다');
  else ok(`기본 지점 있음: ${S().sites[0].name}`);
  if (S().sites[0] && S().sites[0].lat == null) ok('기본 지점 좌표 없음 → GPS 측정 필요');

  console.log('\n═══ 2. 조사명 입력 ═══');
  // 조사명을 바꾸려면 어디로 가야 하나?
  tab('sum');
  await sleep(60);
  if (visible($('fTitle'))) ok('요약 탭에서 조사명 입력 가능');
  else note('조사명', '조사명 입력칸을 찾기 어렵다');
  type($('fTitle'), '한림읍 금악리 소규모환경영향평가');
  type($('fSurveyor'), '홍길동');
  await sleep(400);   // save()는 250ms 디바운스
  ok(`조사명 저장됨: ${S().title}`);
  if ($('surveyTitle').textContent !== S().title) {
    note('조사명', `상단 칩이 안 바뀜 (칩="${$('surveyTitle').textContent}")`);
  }

  console.log('\n═══ 3. 첫 지점 GPS 측정 ═══');
  tab('site');
  await sleep(60);
  click($('addSite'));
  await sleep(120);
  const s3 = S();
  ok(`지점 ${s3.sites.length}개, 최근 지점 좌표: ${s3.sites[s3.sites.length - 1].lat}`);

  console.log('\n═══ 4. 종 기록 — 20종 연속 입력 ═══');
  tab('rec');
  await sleep(80);
  const species = ['소나무', '곰솔', '억새', '띠', '찔레꽃', '청미래덩굴', '예덕나무', '사스레피나무',
    '자귀나무', '멍석딸기', '환삼덩굴', '쑥', '개망초', '쇠무릎', '주름조개풀', '맥문동',
    '생강나무', '팔손이', '콩짜개덩굴', '더덕'];
  let added = 0, failed = [];
  for (const sp of species) {
    type($('q'), sp);
    await sleep(90);
    const first = $('results').querySelector('li:not(.more)');
    if (!first) { failed.push(sp); continue; }
    click(first);
    await sleep(40);
    added++;
  }
  ok(`${added}종 추가, 검색 실패: ${failed.length ? failed.join(', ') : '없음'}`);
  if (failed.length) note('검색', `사전에 없거나 검색 안 되는 종: ${failed.join(', ')}`);

  // 20종을 넣은 뒤 목록이 얼마나 길어지는가
  const rows = $('recList').querySelectorAll('li').length;
  ok(`기록 목록 ${rows}행`);
  // 최신이 위로 와야 방금 넣은 걸 바로 확인할 수 있다
  const top = $('recList').children[0].textContent;
  const newest = S().records[S().records.length - 1].name;
  if (!top.includes(newest)) note('목록', `최신 기록(${newest})이 맨 위에 없다 — 방금 넣은 걸 확인하려면 스크롤해야 한다`);
  else ok(`최신 기록이 맨 위: ${newest}`);
  if (rows > 12) ok(`${rows}행 — 플로팅 검색 버튼으로 복귀 가능`);
  const firstRow = $('recList').children[0];
  ok(`목록 첫 행: ${firstRow.textContent.slice(0, 20)}`);

  console.log('\n═══ 5. 같은 종 중복 입력 시도 ═══');
  type($('q'), '소나무');
  await sleep(120);
  const dupLi = $('results').querySelector('li:not(.more)');
  ok(`이미 넣은 종 표시: ${dupLi.className || '(표시 없음)'}`);
  if (!dupLi.className.includes('added')) note('중복', '이미 기록한 종인지 검색 결과에서 구분이 안 된다');
  type($('q'), '');
  await sleep(60);

  console.log('\n═══ 6. 개체수·우점도 입력 ═══');
  click($('recList').children[0]);
  await sleep(40);
  if (!visible($('sheet'))) note('시트', '기록 행을 눌렀는데 입력 시트가 안 열린다');
  else {
    const plus = $('cPlus'), minus = $('cMinus');
    ok(`＋버튼 크기: ${JSON.stringify(tapSize(plus))}`);
    for (let i = 0; i < 5; i++) click(plus);
    ok(`5번 눌러 개체수: ${$('cNum').value}`);
    const covers = $('coverBtns').querySelectorAll('button');
    ok(`우점도 버튼 ${covers.length}개, 크기 ${JSON.stringify(tapSize(covers[0]))}`);
    click(covers[2]);
    click($('sheetOk'));
    await sleep(40);
    const r0 = S().records.find((r) => r.count === 6);
    ok(`저장 결과: ${r0 ? r0.name + ' ' + r0.count + '개체 / 우점도 ' + r0.cover : '실패'}`);
  }

  console.log('\n═══ 7. 두 번째 지점으로 이동 ═══');
  tab('site');
  await sleep(60);
  click($('addSite'));
  await sleep(120);
  tab('rec');
  await sleep(80);
  const rl = $('recList');
  const emptyRow = rl.querySelector('.empty');
  ok(`새 지점 기록: ${emptyRow ? '없음(안내문구)' : rl.querySelectorAll('li').length + '행'}`);
  ok(`  → 안내: "${rl.textContent.slice(0, 40)}"`);
  ok(`상단 지점 탭 개수: ${$('siteRow').querySelectorAll('button').length}`);
  const siteTabs = $('siteRow').querySelectorAll('button');
  if (siteTabs.length) ok(`지점 탭 크기: ${JSON.stringify(tapSize(siteTabs[0]))}`);

  // 1지점에서 넣었던 종을 2지점에도 넣기 — 가장 흔한 작업
  console.log('\n  [같은 종을 2지점에도 기록]');
  type($('q'), '소나무');
  await sleep(120);
  const li2 = $('results').querySelector('li:not(.more)');
  ok(`2지점에서 소나무 표시: ${li2.className || '(없음)'} ${li2.className.includes('added') ? '← 잘못됨! 다른 지점인데 추가됨으로 보임' : ''}`);
  click(li2);
  await sleep(40);
  ok(`2지점 기록: ${$('recList').querySelectorAll('li').length}행`);

  // 최근 입력 버튼으로 빠르게 넣기
  console.log('\n  [최근 입력 버튼 활용]');
  const recentBtns = $('recent').querySelectorAll('button');
  ok(`최근 입력 버튼 ${recentBtns.length}개`);
  if (!recentBtns.length) note('최근입력', '최근 입력 버튼이 없어 반복 입력이 느리다');
  else {
    ok(`버튼 크기: ${JSON.stringify(tapSize(recentBtns[0]))}`);
    const before = S().records.length;
    click(recentBtns[0]);
    await sleep(60);
    ok(`최근 버튼 탭 → 기록 ${before} → ${S().records.length}`);
  }

  console.log('\n═══ 8. 식생조사 (방형구) ═══');
  tab('veg');
  await sleep(60);
  click($('addPlot'));
  await sleep(120);
  const p = S().plots[0];
  if (!p) note('방형구', '방형구 추가가 안 된다');
  else {
    ok(`방형구 생성: ${p.name}, 좌표 ${p.lat}`);
    const addSp = doc.querySelectorAll('.add-sp');
    ok(`층위별 종추가 버튼 ${addSp.length}개 (T1/T2/S/H = 4여야 함)`);
    if (addSp.length) {
      click(addSp[0]);
      await sleep(80);
      ok(`종추가 누르면 이동한 탭: ${[...$('tabbar').children].find((b) => b.classList.contains('on')).dataset.tab}`);
      ok(`식생 배너 보임: ${visible($('vegBanner'))} "${$('vegBannerTxt').textContent}"`);
      type($('q'), '소나무');
      await sleep(120);
      click($('results').querySelector('li:not(.more)'));
      await sleep(60);
      const p2 = S().plots[0];
      ok(`방형구에 담김: ${(p2.items || []).length}종`);
      if (!visible($('vegBanner'))) note('식생', '종을 넣은 뒤 배너가 사라져 계속 넣는지 알 수 없다');
      // 식생 모드에서 여러 종 연속 입력
      for (const sp of ['곰솔', '사스레피나무']) {
        type($('q'), sp); await sleep(100);
        const f = $('results').querySelector('li:not(.more)');
        if (f) { click(f); await sleep(50); }
      }
      ok(`3종 연속 입력 후: ${(S().plots[0].items || []).length}종`);
      click($('vegBannerEnd'));
      await sleep(60);
      ok(`완료 후 탭: ${[...$('tabbar').children].find((b) => b.classList.contains('on')).dataset.tab}`);
    }
  }

  console.log('\n═══ 9. 훼손수목 조사 ═══');
  tab('tree');
  await sleep(60);
  click($('addTree'));
  await sleep(120);
  if (!visible($('tsheet'))) note('수목', '수목 기록 시트가 안 열린다');
  else {
    type($('tsQ'), '곰솔');
    await sleep(140);
    const hit = $('tsResults') && $('tsResults').querySelector('li');
    if (!hit) note('수목', '수종 검색 결과가 안 나온다');
    else {
      click(hit);
      await sleep(40);
      ok(`수종 선택: ${$('tsPicked').textContent}`);
    }
    // 규격 입력
    type($('tDbh'), '25'); type($('tHeight'), '8'); type($('tCrown'), '4');
    type($('tStems'), '3');
    ok(`규격 표기: ${$('tSpec').textContent}`);
    click($('tsOk'));
    await sleep(60);
    const tr = S().trees;
    ok(`수목 ${tr.length}본 기록: ${tr[0] ? JSON.stringify({ n: tr[0].name, dbh: tr[0].dbh, stems: tr[0].stems, act: tr[0].action }) : '-'}`);
  }

  console.log('\n═══ 10. GPS 실패 상황 ═══');
  gpsMode = 'fail';
  tab('site');
  await sleep(60);
  const nBefore = S().sites.length;
  click($('addSite'));
  await sleep(150);
  ok(`GPS 거부돼도 지점 추가됨: ${S().sites.length > nBefore}`);
  ok(`안내 문구: "${$('toast').textContent}"`);
  gpsMode = 'ok';

  console.log('\n═══ 11. 내보내기 ═══');
  tab('sum');
  await sleep(60);
  ['expRec', 'expMat', 'expVeg', 'expTree', 'expJson'].forEach((id) => {
    if (!$(id)) note('내보내기', `#${id} 버튼 없음`);
  });
  const sum = window.FFCore.summarize(S());
  ok(`요약: ${sum.totalTaxa}종 / ${sum.siteCount}지점 / ${sum.totalRecords}건`);
  const csv = window.FFCore.toRecordsCSV(S());
  ok(`기록 CSV ${csv.split('\r\n').length - 1}행`);

  console.log('\n═══ 12. 앱 재시작 (배터리 아웃 후 복구) ═══');
  const saved = window.localStorage.getItem('field_flora_state');
  ok(`저장 크기: ${(saved.length / 1024).toFixed(1)} KB`);
  const reparsed = JSON.parse(saved);
  const rs = reparsed.surveys.find((x) => x.id === reparsed.currentId);
  ok(`복구 확인: ${rs.records.length}기록 / ${rs.sites.length}지점 / ${rs.plots.length}방형구 / ${rs.trees.length}수목`);

  console.log('\n═══ 스크립트 오류 ═══');
  if (errors.length) errors.forEach((e) => note('JS오류', e));
  else ok('없음');

  console.log('\n═══ prompt/confirm 호출 (현장에서 성가신 것) ═══');
  ok(`prompt ${prompts.length}회, confirm ${confirms.length}회`);
  confirms.forEach((c) => ok(`  confirm: "${String(c).slice(0, 50)}"`));

  console.log('\n=== 13. 하루 종일 조사 - 5지점 대량입력 ===');
  const t0 = Date.now();
  const names = ['고사리','고비','수크령','바랭이','강아지풀','닭의장풀','괭이밥','토끼풀',
    '질경이','민들레','씀바귀','제비꽃','산딸기','복분자딸기','후박나무','동백나무',
    '붉가시나무','종가시나무','구실잣밤나무','참억새'];
  tab('site'); await sleep(50);
  for (let i = 0; i < 3; i++) { click($('addSite')); await sleep(60); }
  ok('지점 ' + S().sites.length + '개');
  tab('rec'); await sleep(60);
  let bulk = 0; const tR = [];
  for (const nm of names) {
    type($('q'), nm); await sleep(70);
    const f = $('results').querySelector('li:not(.more)');
    if (!f) continue;
    const t1 = Date.now(); click(f); await sleep(30);
    tR.push(Date.now() - t1); bulk++;
  }
  const avg = tR.length ? Math.round(tR.reduce(function(a,b){return a+b;},0)/tR.length) : 0;
  ok(bulk + '종 입력, 1종당 평균 ' + avg + 'ms');
  if (avg > 300) note('성능', '종 추가가 ' + avg + 'ms로 느리다');
  ok('총 기록 ' + S().records.length + '건, 목록 ' + $('recList').querySelectorAll('li').length + '행');
  ok('저장 크기 ' + (window.localStorage.getItem('field_flora_state').length/1024).toFixed(1) + ' KB');
  ok('소요 ' + ((Date.now()-t0)/1000).toFixed(1) + '초');

  console.log('\n=== 14. 장갑 낀 손 연타 ===');
  const beforeN = S().records.length;
  const rb = $('recent').querySelectorAll('button');
  for (let i = 0; i < 10 && i < rb.length; i++) { click(rb[i]); }
  await sleep(120);
  ok('최근버튼 10연타: ' + beforeN + ' -> ' + S().records.length);
  if (S().records.length < beforeN) note('오조작', '연타하면 기록이 사라진다');

  console.log('\n=== 15. CSV 무결성 ===');
  const csvOut = window.FFCore.toRecordsCSV(S());
  const ls = csvOut.split(String.fromCharCode(13,10)).filter(function(x){return x.trim();});
  const hdN = (ls[0].match(/,/g)||[]).length;
  const bad = ls.filter(function(l){ return (l.match(/,/g)||[]).length !== hdN; });
  if (bad.length) note('CSV', bad.length + '개 행의 열 수가 다르다: ' + bad[0].slice(0,50));
  else ok('모든 행 열 수 일치 (' + ls.length + '행)');

  console.log('\n=== 16. 요약 정확도 ===');
  tab('sum'); await sleep(80);
  const sm = window.FFCore.summarize(S());
  const shown = parseInt($('stTaxa').textContent, 10);
  ok('화면 ' + shown + '종 / 계산 ' + sm.totalTaxa + '종 ' + (shown === sm.totalTaxa ? '일치' : '<- 불일치!'));
  if (shown !== sm.totalTaxa) note('요약', '화면 종수와 집계가 다르다');
  ok('지점별 목록 ' + $('sumSites').querySelectorAll('li').length + '개 / 실제 ' + S().sites.length + '지점');

  console.log(`\n\n━━━ 발견된 개선점 ${issues.length}건 ━━━`);
  issues.forEach((i, n) => console.log(`${n + 1}. [${i.where}] ${i.msg}`));
  process.exit(0);
})().catch((e) => { console.error('시뮬레이션 오류:', e); process.exit(1); });
