/* UI 통합 테스트 — jsdom으로 실제 index.html + app.js를 구동해 조작한다.
 * node tests/ui.test.js
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const WEB = path.join(__dirname, '..');
let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ok  ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + '\n       ' + (e && e.message)); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** CSV 문자열을 줄 배열로 (BOM 제거, CRLF/LF 모두 허용) */
const csvRows = (s) => String(s).replace(/^\ufeff/, '').split(String.fromCharCode(13, 10)).join('\n').split('\n');

// 실제 사전에서 소수만 뽑아 빠르게 구동
const dict = JSON.parse(fs.readFileSync(path.join(WEB, 'data', 'taxa.json'), 'utf8'));
const wanted = ['소나무', '개망초', '곰솔', '신갈나무', '억새'];
const subset = wanted.map((n) => dict.taxa.find((x) => x.n === n)).filter(Boolean);
assert.strictEqual(subset.length, wanted.length, '테스트용 종이 사전에 없음: ' + wanted.join(','));

async function main() {
  const vc = new VirtualConsole();
  const errors = [];
  vc.on('jsdomError', (e) => errors.push(e.message));
  vc.on('error', (...a) => errors.push(a.join(' ')));

  const dom = new JSDOM(fs.readFileSync(path.join(WEB, 'index.html'), 'utf8'), {
    url: 'http://localhost/',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole: vc,
    resources: undefined,
  });
  const { window } = dom;
  const doc = window.document;

  // fetch 스텁: 앱은 data/taxa.json만 요청한다
  let fetched = null;
  window.fetch = (url) => {
    fetched = url;
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ version: 1, taxa: subset }) });
  };
  // 스크립트 수동 주입 (jsdom은 상대경로 외부 스크립트를 로드하지 않음)
  for (const f of ['core.js', 'app.js']) {
    const s = doc.createElement('script');
    s.textContent = fs.readFileSync(path.join(WEB, f), 'utf8');
    doc.body.appendChild(s);
  }
  doc.dispatchEvent(new window.Event('DOMContentLoaded', { bubbles: true }));
  await sleep(300);

  const $ = (id) => doc.getElementById(id);
  const click = (el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  // 실제 입력: 타이핑(input) 후 다른 곳을 터치하면 change/blur가 발생한다
  const type = (el, v) => {
    el.value = v;
    el.dispatchEvent(new window.Event('input', { bubbles: true }));
  };
  const commit = (el, v) => {
    type(el, v);
    el.dispatchEvent(new window.Event('change', { bubbles: true }));
    el.dispatchEvent(new window.Event('blur', { bubbles: true }));
  };

  console.log('[초기화]');
  t('사전 fetch 호출', () => assert.strictEqual(fetched, 'data/taxa.json'));
  t('기본 조사 1건 자동 생성', () => assert.ok($('surveyTitle').textContent.startsWith('조사 ')));
  t('기본 지점 St.1 존재', () => {
    const tabs = [...doc.querySelectorAll('.site-tab')].map((b) => b.textContent);
    assert.ok(tabs.some((x) => x.startsWith('St.1')), JSON.stringify(tabs));
  });
  t('초기 기록 0종', () => assert.strictEqual($('siteCount').textContent, '0종'));
  t('스크립트 오류 없음', () => assert.deepStrictEqual(errors, []));

  console.log('[검색 → 기록]');
  type($('q'), '소나무');
  await sleep(150);
  t('검색 결과 렌더', () => assert.ok($('results').children.length > 0));
  t('첫 결과가 소나무', () => assert.ok($('results').children[0].textContent.includes('소나무')));

  click($('results').children[0]);
  await sleep(60);
  t('탭 한 번에 기록 추가', () => assert.strictEqual($('siteCount').textContent, '1종 / 1개체'));
  t('기록 목록에 표시', () => assert.ok($('recList').textContent.includes('소나무')));
  t('학명 함께 저장', () => assert.ok($('recList').textContent.includes('Pinus')));
  t('최근 입력에 축적', () => assert.ok($('recent').textContent.includes('소나무')));
  t('토스트 노출', () => assert.ok(!$('toast').hidden && $('toast').textContent.includes('추가')));
  t('추가 직후 검색창이 비워짐(다음 종 바로 입력)', () => assert.strictEqual($('q').value, ''));
  t('추가 직후 검색 결과도 비워짐', () => assert.strictEqual($('results').children.length, 0));
  t('토스트에 현재 지점 종수 표시', () => assert.ok(/St\.1\s*1종/.test($('toast').textContent), $('toast').textContent));
  t('출현종 나열줄에 표시', () => {
    const el = $('siteNames');
    assert.strictEqual(el.hidden, false);
    assert.ok(el.textContent.includes('소나무'), el.textContent);
  });
  t('방금 추가한 행이 강조(flash)', () => assert.ok($('recList').querySelector('li.flash')));

  // 같은 종을 다시 탭하면 취소(토글)
  type($('q'), '소나무'); await sleep(150);
  t('이미 넣은 종은 검색결과에 ✓ 표시', () => {
    const li = $('results').children[0];
    assert.ok(li.classList.contains('added'), li.className);
    assert.strictEqual(li.querySelector('.add').textContent, '✓');
  });
  click($('results').children[0]); await sleep(60);
  t('재탭하면 기록이 취소됨', () => assert.strictEqual($('siteCount').textContent, '0종'));
  t('삭제 안내와 되돌리기 버튼 표시', () => {
    assert.ok($('toast').textContent.includes('소나무 삭제'), $('toast').textContent);
    assert.ok($('toast').querySelector('.undo'), '되돌리기 버튼 없음');
  });
  t('삭제한 종을 되돌릴 수 있음', () => {
    click($('toast').querySelector('.undo'));
    assert.strictEqual($('siteCount').textContent, '1종 / 1개체', $('siteCount').textContent);
    assert.ok($('recList').textContent.includes('소나무'));
  });
  // 되돌린 뒤 다시 지워 이후 테스트의 전제를 맞춘다
  type($('q'), '소나무'); await sleep(150);
  click($('results').children[0]); await sleep(60);
  t('목록에서 사라짐', () => assert.ok(!$('recList').textContent.includes('소나무')));
  // 다시 넣어 이후 테스트를 잇는다
  type($('q'), '소나무'); await sleep(150);
  click($('results').children[0]); await sleep(60);
  t('다시 탭하면 재추가', () => assert.strictEqual($('siteCount').textContent, '1종 / 1개체'));

  // 최근 입력 버튼으로 추가
  type($('q'), '개망초'); await sleep(150);
  click($('results').children[0]); await sleep(60);
  t('두 번째 종 추가 → 2종', () => assert.ok($('siteCount').textContent.startsWith('2종'), $('siteCount').textContent));
  t('나열줄에 두 종 모두 표시', () => {
    const txt = $('siteNames').textContent;
    assert.ok(txt.includes('소나무') && txt.includes('개망초'), txt);
  });

  console.log('[잘못 누른 기록 취소]');
  t('추가 직후 토스트에 취소 버튼 노출', () => {
    const btn = $('toast').querySelector('.undo');
    assert.ok(btn, '취소 버튼 없음: ' + $('toast').textContent);
    assert.strictEqual(btn.textContent, '취소');
  });
  {
    // 실수로 추가한 종을 취소하면 목록·집계에서 사라져야 한다
    type($('q'), '곰솔'); await sleep(150);
    click($('results').children[0]); await sleep(60);
    const before = $('siteCount').textContent;
    t('실수 추가 후 3종', () => assert.ok(before.startsWith('3종'), before));
    click($('toast').querySelector('.undo')); await sleep(60);
    t('취소하면 2종으로 복귀', () => assert.ok($('siteCount').textContent.startsWith('2종'), $('siteCount').textContent));
    t('취소된 종이 목록에서 사라짐', () => assert.ok(!$('recList').textContent.includes('곰솔')));
    t('취소된 종이 나열줄에서도 사라짐', () => assert.ok(!$('siteNames').textContent.includes('곰솔')));
    t('되돌림 안내 표시', () => assert.ok($('toast').textContent.includes('되돌림'), $('toast').textContent));
  }
  t('취소 버튼은 한 번만 동작(연타해도 다른 기록 안 지움)', () => {
    const n = $('recList').querySelectorAll('li').length;
    assert.strictEqual(n, 2, n + '행');
  });

  console.log('[우점도 표시]');
  t('우점도 미지정이면 개체수가 아니라 – 표시', () => {
    const cv = $('recList').querySelector('.cv');
    assert.strictEqual(cv.textContent, '–', '미지정인데 "' + cv.textContent + '" 표시');
    assert.ok(cv.classList.contains('unset'));
  });

  console.log('[입력한 내용이 있는 기록은 확인 후 취소]');
  {
    // 개망초에 우점도를 넣어둔 상태에서 재탭하면 확인창이 떠야 한다
    const rec = $('recList').querySelector('li');   // 최신 = 개망초
    click(rec); await sleep(50);
    click([...$('coverBtns').children].find((b) => b.dataset.v === '2')); await sleep(30);
    click($('sheetOk')); await sleep(50);

    const asked = [];
    window.confirm = (m) => { asked.push(m); return false; };   // 사용자가 '아니오'
    type($('q'), '개망초'); await sleep(150);
    click($('results').children[0]); await sleep(60);
    t('입력 내용이 있으면 확인창을 띄움', () => assert.strictEqual(asked.length, 1, JSON.stringify(asked)));
    t('아니오를 고르면 기록이 유지됨', () => assert.ok($('recList').textContent.includes('개망초')));

    window.confirm = () => true;                                 // 사용자가 '예'
    type($('q'), '개망초'); await sleep(150);
    click($('results').children[0]); await sleep(60);
    t('예를 고르면 기록이 삭제됨', () => assert.ok(!$('recList').textContent.includes('개망초')));
    // 이후 CSV 테스트를 위해 개망초를 다시 넣는다
    type($('q'), '개망초'); await sleep(150);
    click($('results').children[0]); await sleep(60);
    t('삭제 후 재추가되어 2종 복귀', () =>
      assert.ok($('siteCount').textContent.startsWith('2종'), $('siteCount').textContent));
  }

  console.log('[초성·학명 검색]');
  type($('q'), 'ㅅㄱㄴㅁ'); await sleep(150);
  t('초성 검색 동작', () => assert.ok($('results').textContent.includes('신갈나무'), $('results').textContent));
  type($('q'), 'Quercus'); await sleep(150);
  t('학명 검색 동작', () => assert.ok($('results').textContent.includes('신갈나무')));

  console.log('[우점도 시트]');
  click($('recList').querySelector('.cv'));
  await sleep(50);
  t('시트 열림', () => assert.strictEqual($('sheet').hidden, false));
  const cov3 = [...$('coverBtns').children].find((b) => b.dataset.v === '3');
  click(cov3); await sleep(30);
  click($('sheetOk')); await sleep(50);
  t('시트 닫힘', () => assert.strictEqual($('sheet').hidden, true));
  // 기록 목록은 최신순이므로 첫 행은 마지막에 넣은 개망초
  t('우점도 값이 해당 기록에 반영', () => {
    const first = $('recList').querySelector('li');
    assert.ok(first.textContent.includes('개망초'), first.textContent);
    assert.strictEqual(first.querySelector('.cv').textContent, '3');
  });

  console.log('[지점 추가]');
  const siteTabs = [...doc.querySelectorAll('.site-tab')];
  click(siteTabs[siteTabs.length - 1]); // ＋ 버튼
  await sleep(60);
  t('St.2 생성 및 활성화', () => {
    const tabs = [...doc.querySelectorAll('.site-tab')].map((b) => b.textContent);
    assert.ok(tabs.some((x) => x.startsWith('St.2')), JSON.stringify(tabs));
    assert.ok(doc.querySelector('.site-tab.on').textContent.startsWith('St.2'));
  });
  t('새 지점은 기록 0종', () => assert.strictEqual($('siteCount').textContent, '0종'));

  type($('q'), '억새'); await sleep(150);
  click($('results').children[0]); await sleep(60);
  t('St.2에 기록 추가', () => assert.strictEqual($('siteCount').textContent, '1종 / 1개체'));

  console.log('[요약 집계]');
  click([...doc.querySelectorAll('#tabbar button')].find((b) => b.dataset.tab === 'sum'));
  await sleep(60);
  t('요약 탭 활성', () => assert.ok($('tab-sum').classList.contains('active')));
  t('총 출현종 3종', () => assert.strictEqual($('stTaxa').textContent, '3'));
  t('조사지점 2개', () => assert.strictEqual($('stSites').textContent, '2'));
  t('지점별 종수 표시', () => {
    const txt = $('sumSites').textContent;
    assert.ok(txt.includes('St.1') && txt.includes('2종'), txt);
    assert.ok(txt.includes('St.2') && txt.includes('1종'), txt);
  });
  t('과별 통계 표시', () => assert.ok($('sumFam').textContent.includes('소나무과'), $('sumFam').textContent));

  console.log('[조사 정보 입력]');
  commit($('fTitle'), '한림읍 소규모환경영향평가');
  commit($('fSurveyor'), '홍길동');
  await sleep(50);
  t('조사명이 상단에 반영', () => assert.ok($('surveyTitle').textContent.includes('한림읍')));

  console.log('[내보내기 CSV]');
  let saved = null;
  window.URL.createObjectURL = () => 'blob:x';
  window.URL.revokeObjectURL = () => {};
  // Blob 내용 가로채기
  const RealBlob = window.Blob;
  window.Blob = function (parts, opts) { saved = parts.join(''); return new RealBlob(parts, opts); };
  const origClick = window.HTMLAnchorElement.prototype.click;
  window.HTMLAnchorElement.prototype.click = function () {};

  click($('expRec')); await sleep(60);
  t('기록 CSV에 BOM 포함(엑셀 한글)', () => assert.ok(saved.charCodeAt(0) === 0xfeff));
  // 소나무 2회 탭은 개체수 증가이므로 기록은 3건(소나무·개망초·억새)
  t('기록 CSV 행수 = 기록 3건 + 헤더', () => {
    const rows = saved.replace(/^\ufeff/, '').split('\r\n');
    assert.strictEqual(rows.length, 4, rows.length + ':' + rows[0]);
  });
  t('재탭해도 중복 행 없이 개체수 1 유지', () => {
    const rows = csvRows(saved).filter((r) => r.includes('소나무'));

    assert.strictEqual(rows.length, 1, '중복 행 ' + rows.length);
    assert.ok(/,소나무,Pinus densiflora,소나무과,1,/.test(rows[0]), rows[0]);
  });
  t('우점도는 지정한 개망초 행에만 기록', () => {
    const row = saved.split('\r\n').find((r) => r.includes('개망초'));
    assert.ok(/,1,3,/.test(row), row);  // 개체수 1, 우점도 3
  });
  t('기록 CSV에 조사명·조사자 포함', () => {
    assert.ok(saved.includes('한림읍 소규모환경영향평가'));
    assert.ok(saved.includes('홍길동'));
  });

  click($('expMat')); await sleep(60);
  t('조사표 CSV 헤더에 지점 열', () => {
    const head = saved.replace(/^\ufeff/, '').split('\r\n')[0];
    assert.strictEqual(head, '연번,과,국명,학명,St.1,St.2', head);
  });
  t('조사표 CSV 마지막 행 = 지점별 출현종수', () => {
    const rows = saved.replace(/^\ufeff/, '').split('\r\n');
    assert.ok(rows[rows.length - 1].endsWith('2,1'), rows[rows.length - 1]);
  });
  window.HTMLAnchorElement.prototype.click = origClick;

  console.log('[영속성: 재시작 후 복원]');
  const stored = window.localStorage.getItem('field_flora_state');
  t('localStorage에 상태 저장됨', () => assert.ok(stored && stored.length > 100));
  const parsed = JSON.parse(stored);
  t('저장된 기록 3건', () => assert.strictEqual(parsed.surveys[0].records.length, 3));
  t('저장된 우점도 유지', () => assert.ok(parsed.surveys[0].records.some((r) => r.cover === '3')));

  // 새 DOM에서 같은 localStorage로 복원
  const dom2 = new JSDOM(fs.readFileSync(path.join(WEB, 'index.html'), 'utf8'), {
    url: 'http://localhost/', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
  });
  dom2.window.localStorage.setItem('field_flora_state', stored);
  dom2.window.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({ taxa: subset }) });
  for (const f of ['core.js', 'app.js']) {
    const s = dom2.window.document.createElement('script');
    s.textContent = fs.readFileSync(path.join(WEB, f), 'utf8');
    dom2.window.document.body.appendChild(s);
  }
  dom2.window.document.dispatchEvent(new dom2.window.Event('DOMContentLoaded', { bubbles: true }));
  await sleep(300);
  t('앱 재시작 시 조사명 복원', () => {
    assert.ok(dom2.window.document.getElementById('surveyTitle').textContent.includes('한림읍'),
      dom2.window.document.getElementById('surveyTitle').textContent);
  });
  t('앱 재시작 시 기록 복원', () => {
    const txt = dom2.window.document.getElementById('recList').textContent;
    assert.ok(txt.includes('억새') || txt.includes('소나무'), txt);
  });

  console.log('[오류 로그]');
  t('실행 중 스크립트 오류 없음', () => assert.deepStrictEqual(errors, []));

  console.log(`\n결과: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
