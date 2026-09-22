/* 현장 시나리오 테스트 — 식생조사·훼손수목·음성입력
 * 현장 도착 → 방형구 설치 → 층위별 종 기록 → 훼손수목 조사 → 내보내기
 * node tests/field.test.js
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const WEB = path.join(__dirname, '..');
let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ok  ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + '\n       ' + (e && e.message)); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const C = require(path.join(WEB, 'core.js'));
const dict = JSON.parse(fs.readFileSync(path.join(WEB, 'data', 'taxa.json'), 'utf8'));

/* ─────────── 1. 순수 로직 (core.js) ─────────── */
console.log('[식생조사 로직]');
t('층위는 교목/아교목/관목/초본 4층', () => {
  assert.strictEqual(C.LAYERS.length, 4);
  assert.deepStrictEqual(C.LAYERS.map((x) => x.v), ['T1', 'T2', 'S', 'H']);
  assert.strictEqual(C.LAYER_LABEL.T1, '교목');
});
t('방형구 규격 프리셋 제공', () => {
  assert.ok(C.PLOT_SIZES.includes('10×10'), C.PLOT_SIZES.join(','));
});

console.log('[훼손수목 로직]');
t('흉고직경 등급 구분', () => {
  assert.strictEqual(C.dbhClass(5), '소경목');
  assert.strictEqual(C.dbhClass(15), '중경목');
  assert.strictEqual(C.dbhClass(30), '대경목');
  assert.strictEqual(C.dbhClass(50), '노거수급');
  assert.strictEqual(C.dbhClass(0), '');
});
t('수목 규격 표기 H×B×W', () => {
  assert.strictEqual(C.treeSpec({ height: 4, dbh: 15, crown: 3 }), 'H4.0×B15×W3.0');
  assert.strictEqual(C.treeSpec({ height: 4 }), 'H4.0');
  assert.strictEqual(C.treeSpec({}), '');
});
t('조치별 본수 합계', () => {
  const s = C.summarizeTrees([
    { name: '곰솔', stems: 3, action: 'move' },
    { name: '곰솔', stems: 1, action: 'cut' },
    { name: '팽나무', stems: 2, action: 'move' },
  ]);
  assert.strictEqual(s.total, 3, '건수');
  assert.strictEqual(s.stems, 6, '총 본수');
  assert.strictEqual(s.taxaCount, 2, '수종수');
  assert.strictEqual(s.byAction.move.stems, 5);
  assert.strictEqual(s.byAction.cut.stems, 1);
  assert.strictEqual(s.byAction.keep.stems, 0);
});
t('본수 미입력은 1본으로', () => {
  const s = C.summarizeTrees([{ name: 'a', action: 'cut' }]);
  assert.strictEqual(s.stems, 1);
});

console.log('[CSV 출력]');
const sampleSurvey = {
  title: '금악리 소규모환경영향평가', date: '2026-09-22', surveyor: '홍길동',
  sites: [], records: [],
  plots: [{
    name: 'Q1', size: '10×10', slope: '15', aspect: 'SW', elev: '320',
    note: '임연부', lat: 33.36, lng: 126.31,
    cover: { T1: { rate: 70, height: 12 }, H: { rate: 40, height: 0.3 } },
    items: [
      { id: '1', layer: 'T1', name: '곰솔', scientific: 'Pinus thunbergii', family: '소나무과', cover: '4', note: '' },
      { id: '2', layer: 'H', name: '억새', scientific: 'Miscanthus sinensis', family: '벼과', cover: '2', note: '' },
    ],
  }],
  trees: [
    { name: '곰솔', scientific: 'Pinus thunbergii', family: '소나무과', dbh: 25, height: 8, crown: 4, stems: 2, action: 'move', lat: 33.36, lng: 126.31, note: '수형 양호' },
    { name: '예덕나무', scientific: 'Mallotus japonicus', family: '대극과', dbh: 8, height: 3, stems: 1, action: 'cut', note: '' },
  ],
};

const vegCSV = C.toVegCSV(sampleSurvey);
t('식생조사표에 방형구 정보 포함', () => {
  assert.ok(vegCSV.includes('Q1'), '방형구명 없음');
  assert.ok(vegCSV.includes('10×10'), '규격 없음');
  assert.ok(vegCSV.includes('SW'), '방위 없음');
});
t('식생조사표에 층위별 식피율', () => {
  assert.ok(/교목,70,12/.test(vegCSV), '교목 식피율/수고 없음');
});
t('식생조사표에 층위별 종·우점도', () => {
  assert.ok(/교목,곰솔,Pinus thunbergii,소나무과,4/.test(vegCSV), '교목 종 없음');
  assert.ok(/초본,억새,Miscanthus sinensis,벼과,2/.test(vegCSV), '초본 종 없음');
});
t('식생조사표 BOM (엑셀 한글 깨짐 방지)', () => {
  assert.strictEqual(vegCSV.charCodeAt(0), 0xFEFF);
});

const treeCSV = C.toTreeCSV(sampleSurvey);
t('수목조서에 규격·조치 포함', () => {
  assert.ok(treeCSV.includes('H8.0×B25×W4.0'), '규격 계산 안 됨');
  assert.ok(treeCSV.includes('이식'), '조치 없음');
  assert.ok(treeCSV.includes('벌채'), '조치 없음');
});
t('수목조서 합계가 정확', () => {
  // 곰솔 2본 + 예덕나무 1본 = 3본, 2종
  const lines = treeCSV.split(String.fromCharCode(13, 10));
  const total = lines.find((l) => l.startsWith('합계'));
  assert.ok(total, '합계 행 없음');
  assert.ok(total.includes('3'), '총 본수 틀림: ' + total);
  assert.ok(total.includes('2종'), '수종수 틀림: ' + total);
});
t('수목조서에 조치별 소계', () => {
  const lines = treeCSV.split(String.fromCharCode(13, 10));
  assert.ok(lines.some((l) => l.startsWith('이식') && l.includes('2')), '이식 소계 없음');
  assert.ok(lines.some((l) => l.startsWith('벌채') && l.includes('1')), '벌채 소계 없음');
});
t('좌표가 있으면 조서에 기록', () => {
  assert.ok(treeCSV.includes('33.36'), '위도 없음');
});

/* ─────────── 2. 현장 시나리오 (UI) ─────────── */
(async () => {
  console.log('\n[현장 시나리오: 도착 → 방형구 → 수목 → 내보내기]');

  const html = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8');
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost/', pretendToBeVisual: true });
  const { window } = dom;
  const doc = window.document;
  global.window = window; global.document = doc;
  // Node 22의 global.navigator는 getter 전용이라 대입이 막힌다
  try { global.navigator = window.navigator; } catch (e) {
    Object.defineProperty(global, 'navigator', { value: window.navigator, configurable: true });
  }

  const errors = [];
  window.addEventListener('error', (e) => errors.push(e.message));

  // 저장소·네트워크·위치 목 (jsdom의 localStorage를 그대로 사용)
  Object.defineProperty(window, 'indexedDB', { value: undefined, configurable: true });
  const readState = () => JSON.parse(window.localStorage.getItem('field_flora_state'));
  window.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve(dict) });
  window.navigator.vibrate = () => true;
  Object.defineProperty(window.navigator, 'geolocation', {
    value: { getCurrentPosition: (ok) => ok({ coords: { latitude: 33.3617, longitude: 126.3122, altitude: 320, accuracy: 8 } }) },
    configurable: true,
  });
  window.confirm = () => true;
  const downloads = [];
  window.URL.createObjectURL = (b) => { downloads.push(b); return 'blob:x'; };
  window.URL.revokeObjectURL = () => {};

  window.eval(fs.readFileSync(path.join(WEB, 'core.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(WEB, 'app.js'), 'utf8'));

  const $ = (id) => doc.getElementById(id);
  const click = (el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  const type = (el, v) => {
    el.value = v;
    el.dispatchEvent(new window.Event('input', { bubbles: true }));
    el.dispatchEvent(new window.Event('change', { bubbles: true }));
  };
  const tab = (name) => click(doc.querySelector(`#tabbar button[data-tab="${name}"]`));

  await sleep(1800);   // 사전 로딩

  t('탭이 5개 (식물상·식생·수목·지점·요약)', () => {
    const tabs = [...doc.querySelectorAll('#tabbar button')].map((b) => b.dataset.tab);
    assert.deepStrictEqual(tabs, ['rec', 'veg', 'tree', 'site', 'sum']);
  });

  // ── 식생조사 ──
  tab('veg');
  await sleep(60);
  t('식생 탭이 열림', () => assert.ok($('tab-veg').classList.contains('active')));
  t('방형구 없으면 안내 표시', () => assert.ok($('plotWrap').textContent.includes('방형구')));

  click($('addPlot'));
  await sleep(150);
  t('방형구 Q1 생성', () => assert.ok($('plotWrap').textContent.includes('Q1'), $('plotWrap').textContent.slice(0, 80)));
  t('방형구에 GPS 좌표 자동 기록', () => {
    const raw = readState();
    const p = raw.surveys[0].plots[0];
    assert.ok(p.lat > 33 && p.lat < 34, '위도: ' + p.lat);
  });
  t('4개 층위가 모두 표시', () => {
    const txt = $('plotWrap').textContent;
    ['교목', '아교목', '관목', '초본'].forEach((L) => assert.ok(txt.includes(L), L + ' 없음'));
  });

  // 교목층에 종 추가
  const addSpBtns = $('plotWrap').querySelectorAll('.add-sp');
  t('층위마다 종추가 버튼', () => assert.strictEqual(addSpBtns.length, 4));
  click(addSpBtns[0]);          // 교목층
  await sleep(80);
  t('종추가 누르면 식물상 탭으로 이동', () => assert.ok($('tab-rec').classList.contains('active')));
  t('어느 층에 넣는지 배너로 표시', () => {
    assert.ok(!$('vegBanner').hidden, '배너 숨겨짐');
    assert.ok($('vegBannerTxt').textContent.includes('교목'), $('vegBannerTxt').textContent);
  });

  type($('q'), '곰솔');
  await sleep(200);
  click($('results').querySelector('li:not(.more)'));
  await sleep(100);
  t('고른 종이 방형구 교목층에 들어감', () => {
    const raw = readState();
    const items = raw.surveys[0].plots[0].items;
    assert.strictEqual(items.length, 1, JSON.stringify(items));
    assert.strictEqual(items[0].layer, 'T1');
  });
  t('식생 입력은 식물상 기록에 섞이지 않음', () => {
    const raw = readState();
    assert.strictEqual(raw.surveys[0].records.length, 0, '식물상 기록에 잘못 들어감');
  });
  t('배너 종수가 갱신됨', () => assert.ok($('vegBannerTxt').textContent.includes('1종'), $('vegBannerTxt').textContent));

  click($('vegBannerEnd'));
  await sleep(80);
  t('완료를 누르면 배너가 사라지고 식생 탭으로', () => {
    assert.ok($('vegBanner').hidden, '배너 남음');
    assert.ok($('tab-veg').classList.contains('active'), '식생 탭 아님');
  });
  t('식생 탭에 추가한 종이 보임', () => assert.ok($('plotWrap').textContent.includes('곰솔')));

  // 식피율 입력이 즉시 저장되는지
  const rate = $('plotWrap').querySelector('.lr');
  type(rate, '70');
  await sleep(80);
  t('식피율이 즉시 저장됨', () => {
    const raw = readState();
    assert.strictEqual(raw.surveys[0].plots[0].cover.T1.rate, 70);
  });

  // ── 훼손수목 ──
  tab('tree');
  await sleep(80);
  t('수목 탭이 열림', () => assert.ok($('tab-tree').classList.contains('active')));

  click($('addTree'));
  await sleep(150);
  t('수목 시트가 열림', () => assert.ok(!$('tsheet').hidden));
  t('수종 미선택 상태 안내', () => assert.ok($('tsPicked').textContent.includes('수종'), $('tsPicked').textContent));

  click($('tsOk'));
  await sleep(60);
  t('수종 없이 저장하면 막힘', () => {
    assert.ok(!$('tsheet').hidden, '시트가 닫힘');
    assert.ok($('toast').textContent.includes('수종'), $('toast').textContent);
  });

  type($('tsQ'), '곰솔');
  await sleep(200);
  click($('tsResults').querySelector('li'));
  await sleep(80);
  t('수종 선택됨', () => assert.ok($('tsPicked').classList.contains('ok'), $('tsPicked').textContent));

  // 장갑 낀 손으로 ± 버튼
  const dbhPlus = $('tsheet').querySelector('.stepper button[data-f="dbh"][data-d="1"]');
  for (let i = 0; i < 25; i++) click(dbhPlus);
  await sleep(60);
  t('＋ 버튼으로 흉고직경 입력', () => assert.strictEqual($('tDbh').value, '25'));
  t('규격·등급이 실시간 표시', () => {
    assert.ok($('tSpec').textContent.includes('B25'), $('tSpec').textContent);
    assert.ok($('tSpec').textContent.includes('대경목'), $('tSpec').textContent);
  });
  t('수목에도 GPS 자동 기록', () => assert.ok($('tSpec').textContent.includes('GPS ✓'), $('tSpec').textContent));

  const stemsMinus = $('tsheet').querySelector('.stepper button[data-f="stems"][data-d="-1"]');
  click(stemsMinus); click(stemsMinus);
  await sleep(40);
  t('본수는 1 미만으로 안 내려감', () => assert.strictEqual($('tStems').value, '1'));

  click($('tActions').querySelector('button[data-v="cut"]'));
  await sleep(40);
  t('조치 선택 반영', () => assert.ok($('tActions').querySelector('button[data-v="cut"]').classList.contains('on')));

  click($('tsOk'));
  await sleep(120);
  t('수목이 저장되고 시트가 닫힘', () => {
    assert.ok($('tsheet').hidden, '시트 남음');
    const raw = readState();
    assert.strictEqual(raw.surveys[0].trees.length, 1);
    assert.strictEqual(raw.surveys[0].trees[0].dbh, '25');
    assert.strictEqual(raw.surveys[0].trees[0].action, 'cut');
  });
  t('수목 목록에 규격·조치가 보임', () => {
    const txt = $('treeList').textContent;
    assert.ok(txt.includes('곰솔'), txt);
    assert.ok(txt.includes('B25'), txt);
    assert.ok(txt.includes('벌채'), txt);
  });
  t('상단에 본수 집계 표시', () => assert.ok($('treeStat').textContent.includes('1'), $('treeStat').textContent));

  // ── 내보내기 ──
  tab('sum');
  await sleep(80);
  const n0 = downloads.length;
  click($('expVeg'));
  await sleep(60);
  t('식생조사표 내보내기 동작', () => assert.ok(downloads.length > n0, '다운로드 안 됨'));
  const n1 = downloads.length;
  click($('expTree'));
  await sleep(60);
  t('훼손수목 조서 내보내기 동작', () => assert.ok(downloads.length > n1, '다운로드 안 됨'));

  // ── 앱 재시작 후에도 남아있는지 ──
  t('식생·수목 기록이 저장소에 남음', () => {
    const raw = readState();
    assert.strictEqual(raw.surveys[0].plots.length, 1, '방형구 유실');
    assert.strictEqual(raw.surveys[0].trees.length, 1, '수목 유실');
    assert.strictEqual(raw.surveys[0].plots[0].items.length, 1, '식생 종 유실');
  });

  console.log('\n[음성 입력]');
  t('음성 버튼이 검색창과 수목 시트에 있음', () => {
    assert.ok($('qMic'), '식물상 마이크 없음');
    assert.ok($('tsMic'), '수목 마이크 없음');
  });
  t('미지원 환경에서 눌러도 앱이 죽지 않음', () => {
    click($('qMic'));
    assert.ok(!$('micHint').hidden, '안내가 안 뜸');
    assert.ok($('micHint').textContent.length > 0);
  });

  t('실행 중 스크립트 오류 없음', () => assert.deepStrictEqual(errors, []));

  console.log(`\n결과: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('테스트 실행 오류:', e);
  process.exit(1);
});
