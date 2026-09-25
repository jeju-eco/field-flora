/* 지점 편집 · 되돌리기 테스트
 * 자료 손실 방지가 목적이므로 "지운 게 정말 돌아오는지"를 본다.
 * node tests/undo.test.js
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
const dict = JSON.parse(fs.readFileSync(path.join(WEB, 'data', 'taxa.json'), 'utf8'));

(async () => {
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
  window.URL.createObjectURL = () => 'blob:x';
  window.URL.revokeObjectURL = () => {};

  let confirmAnswer = true;
  window.confirm = () => confirmAnswer;

  Object.defineProperty(window.navigator, 'geolocation', {
    value: {
      getCurrentPosition: (ok) => setTimeout(() => ok({
        coords: { latitude: 33.3617, longitude: 126.3122, altitude: 320, accuracy: 8 },
      }), 5),
    }, configurable: true,
  });

  window.eval(fs.readFileSync(path.join(WEB, 'core.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(WEB, 'app.js'), 'utf8'));

  const $ = (id) => doc.getElementById(id);
  const readState = () => JSON.parse(window.localStorage.getItem('field_flora_state'));
  const curSurvey = () => { const st = readState(); return st.surveys.find((s) => s.id === st.currentId); };
  const click = (el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  const type = (el, v) => { el.value = v; el.dispatchEvent(new window.Event('input', { bubbles: true })); };
  const undoBtn = () => $('toast').querySelector('.undo');

  await sleep(1800);

  /* ─────────── 지점 편집 시트 ─────────── */
  console.log('[지점 편집 시트]');

  click($('tabbar').querySelector('[data-tab="site"]'));
  await sleep(80);

  t('지점을 탭하면 시트가 열린다 (prompt 아님)', () => {
    assert.ok($('siteList').children.length, '지점 목록이 비었음');
    click($('siteList').children[0]);
    assert.ok(!$('gsheet').hidden, '지점 시트가 안 열림');
  });
  t('현재 이름이 입력칸에 들어있다', () => {
    assert.strictEqual($('gsName').value, 'St.1');
  });
  t('자주 쓰는 지점명이 버튼으로 나온다', () => {
    const n = $('gsPresets').querySelectorAll('button').length;
    assert.ok(n >= 6, n + '개');
  });
  t('프리셋을 누르면 이름칸에 들어간다', () => {
    click($('gsPresets').querySelector('button'));
    assert.strictEqual($('gsName').value, '오름 북사면');
  });
  t('확인을 누르면 이름이 바뀐다', () => {
    click($('gsOk'));
    assert.strictEqual(curSurvey().sites[0].name, '오름 북사면');
    assert.ok($('gsheet').hidden, '시트가 안 닫힘');
  });
  t('바뀐 이름이 화면에 반영된다', () => {
    assert.ok($('siteList').textContent.includes('오름 북사면'), $('siteList').textContent);
  });
  t('직접 입력한 이름도 저장된다', () => {
    click($('siteList').children[0]);
    $('gsName').value = '  동백동산 임연부  ';
    click($('gsOk'));
    assert.strictEqual(curSurvey().sites[0].name, '동백동산 임연부', '앞뒤 공백 미제거');
  });
  t('이름을 비우면 기존 이름 유지', () => {
    click($('siteList').children[0]);
    $('gsName').value = '';
    click($('gsOk'));
    assert.strictEqual(curSurvey().sites[0].name, '동백동산 임연부');
  });
  t('지점이 하나뿐이면 삭제 버튼이 잠긴다', () => {
    click($('siteList').children[0]);
    assert.strictEqual($('gsDel').disabled, true);
    click($('gsOk'));
  });

  /* ─────────── 종 추가 후 지점 삭제 되돌리기 ─────────── */
  console.log('\n[지점 삭제 되돌리기]');

  type($('q'), '소나무'); await sleep(150);
  click($('results').children[0]); await sleep(60);
  type($('q'), '억새'); await sleep(150);
  click($('results').children[0]); await sleep(60);

  t('첫 지점에 2종 기록됨', () => {
    assert.strictEqual(curSurvey().records.length, 2, JSON.stringify(curSurvey().records.map((r) => r.name)));
  });

  click($('tabbar').querySelector('[data-tab="site"]'));
  click($('addSite')); await sleep(80);
  t('지점이 2개가 됨', () => assert.strictEqual(curSurvey().sites.length, 2));

  t('기록 있는 지점은 삭제 버튼에 건수가 표시된다', () => {
    click($('siteList').children[0]);
    assert.ok($('gsDel').textContent.includes('2'), $('gsDel').textContent);
    assert.strictEqual($('gsDel').disabled, false);
  });

  t('삭제하면 지점과 기록이 함께 사라진다', () => {
    confirmAnswer = true;
    click($('gsDel'));
    const s = curSurvey();
    assert.strictEqual(s.sites.length, 1, '지점이 안 지워짐');
    assert.strictEqual(s.records.length, 0, '기록이 남아 있음');
  });

  t('되돌리기 버튼이 나타난다', () => assert.ok(undoBtn(), '되돌리기 버튼 없음'));

  t('되돌리면 지점과 기록이 모두 복구된다', () => {
    click(undoBtn());
    const s = curSurvey();
    assert.strictEqual(s.sites.length, 2, '지점 복구 실패');
    assert.strictEqual(s.records.length, 2, '기록 복구 실패');
    const names = s.records.map((r) => r.name).sort();
    assert.deepStrictEqual(names, ['소나무', '억새']);
  });

  t('복구된 지점이 원래 자리에 들어간다', () => {
    assert.strictEqual(curSurvey().sites[0].name, '동백동산 임연부');
  });

  t('삭제 확인창에서 취소하면 안 지워진다', () => {
    confirmAnswer = false;
    click($('siteList').children[0]);
    click($('gsDel'));
    assert.strictEqual(curSurvey().sites.length, 2);
    confirmAnswer = true;
    click($('gsOk'));
  });

  /* ─────────── 시트에서 기록 삭제 되돌리기 ─────────── */
  console.log('\n[기록 삭제 되돌리기]');

  // 앞 단계에서 지점을 추가해 현재 지점이 2번으로 바뀌어 있다.
  // 기록이 있는 1번 지점으로 되돌아가야 기록 목록이 보인다.
  click($('tabbar').querySelector('[data-tab="site"]'));
  await sleep(60);
  click($('siteList').children[0]);
  click($('gsOk'));                      // 시트를 닫으며 해당 지점을 현재 지점으로
  click($('tabbar').querySelector('[data-tab="rec"]'));
  await sleep(80);

  t('기록 행을 탭하면 우점도 시트가 열린다', () => {
    assert.strictEqual($('recList').children.length, 2, $('recList').children.length + '행');
    click($('recList').children[0]);
    assert.ok(!$('sheet').hidden);
  });

  let deletedName = '';
  t('시트에서 삭제하면 기록이 사라진다', () => {
    deletedName = $('sheetTitle').textContent;
    click($('sheetDel'));
    const s = curSurvey();
    assert.strictEqual(s.records.length, 1, '삭제 안 됨');
    assert.ok(!s.records.some((r) => r.name === deletedName));
  });

  t('삭제한 기록을 되돌릴 수 있다', () => {
    assert.ok(undoBtn(), '되돌리기 버튼 없음');
    click(undoBtn());
    const s = curSurvey();
    assert.strictEqual(s.records.length, 2, '복구 실패');
    assert.ok(s.records.some((r) => r.name === deletedName), deletedName + ' 없음');
  });

  t('입력해둔 개체수·비고까지 그대로 복구된다', () => {
    click($('recList').children[0]);
    const name = $('sheetTitle').textContent;      // 화면 순서와 배열 순서는 다를 수 있다
    type($('cNum'), '7');
    type($('cNote'), '군락 형성');
    click($('sheetOk'));
    const saved = curSurvey().records.find((r) => r.name === name);
    assert.strictEqual(saved.count, 7, '개체수 저장 실패');

    click($('recList').children[0]);
    assert.strictEqual($('sheetTitle').textContent, name, '다른 행이 열림');
    click($('sheetDel'));
    click(undoBtn());

    const back = curSurvey().records.find((r) => r.name === name);
    assert.ok(back, '복구 실패');
    assert.strictEqual(back.count, 7, '개체수가 사라짐');
    assert.strictEqual(back.note, '군락 형성', '비고가 사라짐');
  });

  /* ─────────── 되돌리기 경계 ─────────── */
  console.log('\n[되돌리기 경계]');

  t('되돌리기는 한 번만 동작한다', () => {
    const before = curSurvey().records.length;
    click($('recList').children[0]);
    click($('sheetDel'));
    const btn = undoBtn();
    click(btn); click(btn); click(btn);
    assert.strictEqual(curSurvey().records.length, before, '중복 복구됨');
  });

  t('새 작업을 하면 이전 되돌리기는 사라진다', () => {
    type($('q'), '곰솔');
    return sleep(150).then(() => {
      click($('results').children[0]);
      return sleep(60);
    }).then(() => {
      const n = curSurvey().records.length;
      click(undoBtn());   // 곰솔 추가만 취소돼야 한다
      assert.strictEqual(curSurvey().records.length, n - 1);
    });
  });

  await sleep(250);

  t('실행 중 스크립트 오류 없음', () => assert.deepStrictEqual(errors, []));

  console.log(`\n결과: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('테스트 실행 오류:', e);
  process.exit(1);
});
