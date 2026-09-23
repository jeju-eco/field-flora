/* 엑셀 왕복(round-trip) 테스트
 * 내보낸 CSV를 엑셀에서 고쳐 다시 올리는 흐름을 검증한다.
 * node tests/import.test.js
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
const CRLF = String.fromCharCode(13, 10);

const C = require(path.join(WEB, 'core.js'));
const dict = JSON.parse(fs.readFileSync(path.join(WEB, 'data', 'taxa.json'), 'utf8'));
const realIdx = C.buildIndex(dict.taxa);
const lookup = (n) => {
  const hits = C.search(realIdx, n, 5);
  const key = C.norm(n);
  return hits.find((h) => C.norm(h.n) === key) || null;
};

/* ─────────── CSV 파서 ─────────── */
console.log('[CSV 파서]');
t('따옴표 안의 쉼표를 지킴', () => {
  const rows = C.parseCSV('a,"b,c",d');
  assert.deepStrictEqual(rows[0], ['a', 'b,c', 'd']);
});
t('따옴표 안의 줄바꿈을 지킴', () => {
  const rows = C.parseCSV('a,"1' + CRLF + '2",c');
  assert.strictEqual(rows.length, 1, JSON.stringify(rows));
  assert.strictEqual(rows[0][1], '1' + CRLF + '2');
});
t('"" 는 따옴표 한 개', () => {
  assert.strictEqual(C.parseCSV('a,"say ""hi""",b')[0][1], 'say "hi"');
});
t('BOM 제거', () => {
  assert.strictEqual(C.parseCSV('\ufeff국명,개체수')[0][0], '국명');
});
t('빈 줄은 버림', () => {
  assert.strictEqual(C.parseCSV('a,b' + CRLF + CRLF + 'c,d').length, 2);
});
t('CRLF와 LF 모두 처리', () => {
  assert.strictEqual(C.parseCSV('a,b\nc,d').length, 2);
  assert.strictEqual(C.parseCSV('a,b' + CRLF + 'c,d').length, 2);
});

/* ─────────── 왕복 ─────────── */
console.log('\n[내보내기 → 엑셀 → 되돌리기]');
const survey = {
  title: '금악리 소규모환경영향평가', date: '2026-09-22', surveyor: '홍길동',
  sites: [
    { id: 'a', name: 'St.1', lat: 33.361700, lon: 126.312200, alt: 320 },
    { id: 'b', name: 'St.2', lat: 33.365000, lon: 126.315000, alt: 280 },
  ],
  records: [
    { siteId: 'a', taxonId: 1, name: '소나무', scientific: 'Pinus densiflora', family: '소나무과', count: 3, cover: '2', note: '수형 양호, 임연부' },
    { siteId: 'a', taxonId: 2, name: '억새', scientific: 'Miscanthus sinensis', family: '벼과', count: 12, cover: '3', note: '' },
    { siteId: 'b', taxonId: 3, name: '곰솔', scientific: 'Pinus thunbergii', family: '소나무과', count: 1, cover: 'r', note: '' },
  ],
  plots: [], trees: [],
};

const recCSV = C.toRecordsCSV(survey);
const back = C.parseRecordsCSV(recCSV, lookup, {});

t('행 수가 보존됨', () => assert.strictEqual(back.records.length, 3));
t('지점이 이름별로 복원됨', () => {
  assert.strictEqual(back.sites.length, 2);
  assert.deepStrictEqual(back.sites.map((s) => s.name), ['St.1', 'St.2']);
});
t('좌표·고도가 숫자로 복원됨', () => {
  const s1 = back.sites[0];
  assert.strictEqual(s1.lat, 33.3617);
  assert.strictEqual(s1.lon, 126.3122);
  assert.strictEqual(s1.alt, 320);
});
t('개체수가 숫자로 복원됨', () => {
  assert.strictEqual(back.records[0].count, 3);
  assert.strictEqual(back.records[1].count, 12);
});
t('우점도가 그대로', () => {
  assert.deepStrictEqual(back.records.map((r) => r.cover), ['2', '3', 'r']);
});
t('쉼표 든 비고가 안 깨짐', () => {
  assert.strictEqual(back.records[0].note, '수형 양호, 임연부');
});
t('국명으로 사전 재연결(taxonId 복구)', () => {
  assert.ok(back.records[0].taxonId, '소나무 taxonId 없음');
  assert.strictEqual(back.records[0].name, '소나무');
  assert.ok(back.records[0].scientific.startsWith('Pinus'), back.records[0].scientific);
});
t('기록이 올바른 지점에 붙음', () => {
  const s1 = back.sites[0].id, s2 = back.sites[1].id;
  assert.strictEqual(back.records.filter((r) => r.siteId === s1).length, 2);
  assert.strictEqual(back.records.filter((r) => r.siteId === s2).length, 1);
});

console.log('\n[엑셀에서 직접 고친 경우]');
t('개체수를 고치면 반영됨', () => {
  const edited = recCSV.replace(',3,2,"수형 양호, 임연부"', ',7,2,"수형 양호, 임연부"');
  assert.notStrictEqual(edited, recCSV, '치환 실패 — 테스트 전제 확인 필요');
  const r = C.parseRecordsCSV(edited, lookup, {});
  assert.strictEqual(r.records[0].count, 7);
});
t('행을 지우면 그만큼 줄어듦', () => {
  const lines = recCSV.split(CRLF);
  const r = C.parseRecordsCSV([lines[0], lines[1], lines[3]].join(CRLF), lookup, {});
  assert.strictEqual(r.records.length, 2);
});
t('행을 추가하면 늘어남', () => {
  const extra = recCSV + CRLF + '금악리,2026-09-22,홍길동,St.1,33.3617,126.3122,320,개망초,,,5,+,추가분,';
  const r = C.parseRecordsCSV(extra, lookup, {});
  assert.strictEqual(r.records.length, 4);
  const last = r.records[3];
  assert.strictEqual(last.name, '개망초');
  assert.strictEqual(last.count, 5);
  assert.ok(last.taxonId, '추가한 개망초가 사전에 연결 안 됨');
  assert.ok(last.scientific, '학명이 비어 있음 — 사전에서 채워야 함');
});

console.log('\n[국명만 적은 목록]');
t('한 줄에 종 이름만 있어도 읽힘', () => {
  const r = C.parseRecordsCSV('소나무\n억새\n개망초', lookup, {});
  assert.strictEqual(r.records.length, 3);
  assert.deepStrictEqual(r.records.map((x) => x.name), ['소나무', '억새', '개망초']);
  assert.ok(r.records.every((x) => x.taxonId), '사전 연결 실패');
});
t('헤더가 있는 목록도 읽힘', () => {
  const r = C.parseRecordsCSV('국명,개체수\n소나무,4\n억새,9', lookup, {});
  assert.strictEqual(r.records.length, 2);
  assert.strictEqual(r.records[0].count, 4);
});
t("'종명'·'식물명' 헤더도 인식", () => {
  assert.strictEqual(C.parseRecordsCSV('종명\n소나무', lookup, {}).records.length, 1);
  assert.strictEqual(C.parseRecordsCSV('식물명\n억새', lookup, {}).records.length, 1);
});
t('개체수 없으면 1', () => {
  assert.strictEqual(C.parseRecordsCSV('소나무', lookup, {}).records[0].count, 1);
});
t('빈 줄은 건너뜀', () => {
  const r = C.parseRecordsCSV('소나무\n\n억새\n', lookup, {});
  assert.strictEqual(r.records.length, 2);
});

console.log('\n[사전에 없는 이름 — 절대 버리지 않는다]');
t('모르는 이름도 기록으로 들어감', () => {
  const r = C.parseRecordsCSV('소나무\n엉터리종이름xyz', lookup, {});
  assert.strictEqual(r.records.length, 2, '모르는 종이 삭제됨');
  assert.strictEqual(r.records[1].name, '엉터리종이름xyz');
  assert.strictEqual(r.records[1].taxonId, null);
});
t('모르는 이름을 따로 보고', () => {
  const r = C.parseRecordsCSV('소나무\n엉터리종이름xyz', lookup, {});
  assert.deepStrictEqual(r.unknown, ['엉터리종이름xyz']);
});
t('CSV의 학명·과를 그대로 살림', () => {
  const r = C.parseRecordsCSV('국명,학명,과\n미기재종A,Genus sp.,벼과', lookup, {});
  assert.strictEqual(r.records[0].scientific, 'Genus sp.');
  assert.strictEqual(r.records[0].family, '벼과');
});

console.log('\n[훼손수목 조서 왕복]');
const treeSurvey = {
  title: 't', date: '2026-09-22', surveyor: '홍', sites: [], records: [], plots: [],
  trees: [
    { name: '곰솔', scientific: 'Pinus thunbergii', family: '소나무과', dbh: 25, height: 8, crown: 4, stems: 2, action: 'move', lat: 33.3617, lng: 126.3122, note: '이식 가능' },
    { name: '예덕나무', scientific: 'Mallotus japonicus', family: '대극과', dbh: 8, height: 3, stems: 3, action: 'cut', note: '' },
  ],
};
const treeCSV = C.toTreeCSV(treeSurvey);
const tback = C.parseTreeCSV(treeCSV, lookup, {});

t('수목 건수 보존 (합계 행 제외)', () => {
  assert.strictEqual(tback.trees.length, 2, JSON.stringify(tback.trees.map((x) => x.name)));
});
t('규격 수치가 복원됨', () => {
  assert.strictEqual(tback.trees[0].dbh, 25);
  assert.strictEqual(tback.trees[0].height, 8);
  assert.strictEqual(tback.trees[0].crown, 4);
});
t('본수·조치가 복원됨', () => {
  assert.strictEqual(tback.trees[0].stems, 2);
  assert.strictEqual(tback.trees[0].action, 'move');
  assert.strictEqual(tback.trees[1].stems, 3);
  assert.strictEqual(tback.trees[1].action, 'cut');
});
t('좌표가 복원됨', () => {
  assert.strictEqual(tback.trees[0].lat, 33.3617);
  assert.strictEqual(tback.trees[1].lat, null);
});
t('합계·소계 행이 수목으로 들어오지 않음', () => {
  const names = tback.trees.map((x) => x.name);
  ['합계', '이식', '벌채', '존치'].forEach((w) => {
    assert.ok(!names.includes(w), w + ' 행이 수목으로 들어옴');
  });
});
t('왕복 후 합계가 같음', () => {
  const a = C.summarizeTrees(treeSurvey.trees);
  const b = C.summarizeTrees(tback.trees);
  assert.strictEqual(b.stems, a.stems, `${b.stems} != ${a.stems}`);
  assert.strictEqual(b.taxaCount, a.taxaCount);
});

/* ─────────── UI 통합 ─────────── */
(async () => {
  console.log('\n[앱에서 불러오기]');
  const html = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8');
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost/', pretendToBeVisual: true });
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
  window.confirm = () => true;   // '대체할까요?' → 예
  const blobs = [];
  window.URL.createObjectURL = (b) => { blobs.push(b); return 'blob:x'; };
  window.URL.revokeObjectURL = () => {};

  window.eval(fs.readFileSync(path.join(WEB, 'core.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(WEB, 'app.js'), 'utf8'));

  const $ = (id) => doc.getElementById(id);
  const readState = () => JSON.parse(window.localStorage.getItem('field_flora_state'));
  await sleep(1800);

  t('불러오기 버튼이 CSV를 받음', () => {
    assert.ok($('importFile'), '버튼 없음');
    assert.ok($('fileInput').accept.includes('.csv'), $('fileInput').accept);
  });

  // FileReader를 통하지 않고 onchange 경로를 직접 태운다
  const feed = (text, name) => {
    const orig = window.FileReader;
    window.FileReader = function () {
      this.readAsText = () => { this.result = text; setTimeout(() => this.onload(), 0); };
    };
    Object.defineProperty($('fileInput'), 'files', {
      value: [{ name: name || 'x.csv' }], configurable: true,
    });
    $('fileInput').onchange({ target: { files: [{ name: name || 'x.csv' }], value: '' } });
    window.FileReader = orig;
  };

  feed('국명,개체수\n소나무,5\n억새,3\n개망초,1', 'list.csv');
  await sleep(200);
  t('종 목록 CSV를 불러오면 기록이 생김', () => {
    const st = readState();
    assert.strictEqual(st.surveys[0].records.length, 3, JSON.stringify(st.surveys[0].records.map((r) => r.name)));
  });
  t('개체수가 반영됨', () => {
    const st = readState();
    const pine = st.surveys[0].records.find((r) => r.name === '소나무');
    assert.strictEqual(pine.count, 5);
  });
  t('불러온 뒤 식물상 탭으로 이동', () => assert.ok($('tab-rec').classList.contains('active')));
  t('화면 집계에 반영됨', () => assert.ok($('siteCount').textContent.startsWith('3종'), $('siteCount').textContent));

  // 내보낸 CSV를 그대로 되먹여도 같은 수가 나와야 한다
  const exported = window.FFCore.toRecordsCSV(readState().surveys[0]);
  feed(exported, 'again.csv');
  await sleep(200);
  t('내보낸 CSV를 그대로 다시 올려도 3건', () => {
    assert.strictEqual(readState().surveys[0].records.length, 3);
  });

  feed(treeCSV, 'tree.csv');
  await sleep(200);
  t('훼손수목 조서를 불러오면 수목 탭으로', () => {
    assert.ok($('tab-tree').classList.contains('active'), '수목 탭 아님');
    assert.strictEqual(readState().surveys[0].trees.length, 2);
  });
  t('수목 규격이 화면에 표시', () => assert.ok($('treeList').textContent.includes('B25'), $('treeList').textContent));

  feed('소나무\n엉터리종xyz', 'unknown.csv');
  await sleep(200);
  t('사전에 없는 종도 들어가고 안내됨', () => {
    const st = readState();
    assert.strictEqual(st.surveys[0].records.length, 2);
    assert.ok($('toast').textContent.includes('사전에 없는'), $('toast').textContent);
  });

  t('실행 중 스크립트 오류 없음', () => assert.deepStrictEqual(errors, []));

  console.log(`\n결과: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('테스트 실행 오류:', e);
  process.exit(1);
});
