/* CSS 회귀 테스트 — hidden 속성이 실제로 화면에서 감추는지 검증한다.
 * 배경: .sheet{display:flex}가 [hidden]의 기본 display:none을 덮어써
 * 시트가 항상 전체화면을 덮고 모든 탭을 가로채는 버그가 있었다.
 * node tests/css.test.js
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ok  ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + '\n       ' + (e && e.message)); }
}

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');

/* 주의: jsdom은 브라우저 기본 스타일시트와 작성자 스타일의 우선순위를 실제 브라우저와
   다르게 처리한다. 실제 Safari/Chrome에서는 작성자 규칙이 UA의 [hidden]{display:none}을
   항상 이기므로, getComputedStyle 검사만으로는 이 버그를 잡을 수 없다(거짓 통과).
   따라서 CSS 소스에 명시적 [hidden] 규칙이 있는지 직접 검증한다. */
console.log('[UA [hidden] 무력화 방지 — 실제 브라우저 기준]');
t('CSS에 명시적 [hidden]{display:none !important} 규칙 존재', () => {
  const re = /\[hidden\]\s*\{[^}]*display\s*:\s*none\s*!important/;
  assert.ok(re.test(css),
    'styles.css에 [hidden]{display:none !important}가 없다. ' +
    '작성자 규칙이 UA의 [hidden]을 덮어써 시트가 화면을 덮는다.');
});
t('display를 지정하는 오버레이보다 [hidden] 규칙이 먼저 선언되지 않았는지 무관하게 !important로 보장', () => {
  // !important가 붙어 있으면 선언 순서와 무관하게 이긴다
  const idx = css.search(/\[hidden\]\s*\{[^}]*!important/);
  assert.ok(idx !== -1);
});

// 실제 스타일시트를 인라인으로 주입해 계산된 스타일을 검사한다
const dom = new JSDOM(html.replace('</head>', `<style>${css}</style></head>`), {
  pretendToBeVisual: true,
});
const { window } = dom;
const doc = window.document;
const disp = (el) => window.getComputedStyle(el).display;

console.log('[hidden 요소가 실제로 숨겨지는가]');
for (const id of ['sheet', 'ssheet', 'toast']) {
  t(`#${id}: hidden일 때 display:none`, () => {
    const el = doc.getElementById(id);
    assert.ok(el, `#${id} 없음`);
    assert.ok(el.hasAttribute('hidden'), `#${id}에 hidden 속성이 없음`);
    assert.strictEqual(disp(el), 'none',
      `#${id}가 hidden인데도 display:${disp(el)} — 화면을 덮어 탭을 가로챈다`);
  });
}

console.log('[hidden 해제 시 정상 표시]');
// 주의: 검사 후 hidden을 되돌린다. 안 그러면 뒤따르는 테스트가 열린 시트를 보게 된다.
for (const id of ['sheet', 'ssheet']) {
  t(`#${id}: hidden 제거하면 flex로 표시`, () => {
    const el = doc.getElementById(id);
    el.removeAttribute('hidden');
    const d = disp(el);
    el.setAttribute('hidden', '');
    assert.strictEqual(d, 'flex', '시트가 열려야 하는데 display:' + d);
  });
}

console.log('[전면 오버레이가 기본 상태에서 화면을 막지 않는가]');
t('기본 상태에서 position:fixed 전면 오버레이 없음', () => {
  const blockers = [...doc.querySelectorAll('body *')].filter((el) => {
    const s = window.getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden') return false;
    if (s.position !== 'fixed') return false;
    // inset:0 으로 화면 전체를 덮는 요소
    return s.top === '0px' && s.left === '0px' && s.right === '0px' && s.bottom === '0px';
  }).map((el) => el.id || el.className);
  assert.deepStrictEqual(blockers, [], '화면 전체를 덮는 요소: ' + blockers.join(', '));
});

console.log('[터치 대상 크기]');
t('탭 타겟 최소 크기 변수 44px 이상 (iOS 권장)', () => {
  const v = window.getComputedStyle(doc.documentElement).getPropertyValue('--tap').trim();
  const px = parseInt(v, 10);
  assert.ok(px >= 44, '--tap=' + v);
});

console.log('[시트 숨김]');
t('모든 시트가 초기에 숨겨져 있다', () => {
  const open = [...doc.querySelectorAll('.sheet')]
    .filter((el) => window.getComputedStyle(el).display !== 'none')
    .map((el) => el.id);
  assert.deepStrictEqual(open, [], '열린 채로 시작하는 시트: ' + open.join(', '));
});
t('지점 편집 시트에 필요한 요소가 모두 있다', () => {
  ['gsheet', 'gsName', 'gsPresets', 'gsCoord', 'gsLocate', 'gsDel', 'gsOk']
    .forEach((id) => assert.ok(doc.getElementById(id), '#' + id + ' 없음'));
});
t('삭제 버튼 색이 위험색으로 구분된다', () => {
  assert.ok(/\.ghost\.danger\s*\{[^}]*--danger/.test(css), '.ghost.danger 규칙 없음');
});

console.log(`\n결과: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
