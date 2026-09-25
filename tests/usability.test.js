/* 현장 사용성 테스트 — 햇빛 모드, 플로팅 검색, 최근버튼 안전, GPS 재시도
 * node tests/usability.test.js
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
const css = fs.readFileSync(path.join(WEB, 'styles.css'), 'utf8');

/* ─── CSS 수치 (장갑 낀 손 기준) ─── */
console.log('[터치 타깃 — 장갑]');
function prop(sel, name) {
  const re = new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}');
  const m = css.match(re);
  if (!m) return null;
  const p = m[1].match(new RegExp('(?:^|;)\\s*' + name + '\\s*:\\s*([^;]+)'));
  return p ? p[1].trim() : null;
}
const px = (v) => (v ? parseInt(v, 10) || 0 : 0);

t('우점도 칸이 44px 이상 (장갑으로 누르는 핵심 버튼)', () => {
  const h = px(prop('.reclist .cv', 'height'));
  assert.ok(h >= 44, `.reclist .cv height=${h}px`);
});
t('지점 삭제 버튼이 44px 이상', () => {
  const h = px(prop('.sitelist .del', 'height'));
  assert.ok(h >= 44, `.sitelist .del height=${h}px`);
});
t('플로팅 검색 버튼이 50px 이상', () => {
  const h = px(prop('.fab', 'min-height'));
  assert.ok(h >= 50, `.fab min-height=${h}px`);
});
t('안내 문구가 13px 이상 (땡볕 가독성)', () => {
  const f = px(prop('.hint', 'font-size'));
  assert.ok(f >= 13, `.hint font-size=${f}px`);
});
t('지점 좌표가 13px 이상', () => {
  const f = px(prop('.sitelist .scoord', 'font-size'));
  assert.ok(f >= 13, `.scoord font-size=${f}px`);
});
t('body 기본 16px — iOS 입력 시 확대 방지', () => {
  const m = css.match(/body\s*\{[^}]*font\s*:\s*(\d+)px/);
  assert.ok(m && parseInt(m[1], 10) >= 16, 'body font-size < 16px면 입력할 때 화면이 확대된다');
});

console.log('\n[햇빛 모드 CSS]');
t('body.sun 테마 정의가 있다', () => {
  assert.ok(/body\.sun\s*\{[^}]*--bg\s*:\s*#f{3,6}/i.test(css), 'body.sun에 밝은 --bg 없음');
});
t('햇빛 모드 글자가 검정 (최대 대비)', () => {
  const m = css.match(/body\.sun\s*\{([^}]*)\}/);
  assert.ok(m && /--fg\s*:\s*#0{3,6}/i.test(m[1]), '--fg가 검정이 아님');
});
t('햇빛 모드에서 테두리가 굵어진다', () => {
  assert.ok(/body\.sun[^{]*\{[^}]*border-width\s*:\s*2px/.test(css), '테두리 강조 규칙 없음');
});

/* ─── 동작 ─── */
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
  window.confirm = () => true;
  window.URL.createObjectURL = () => 'blob:x';
  window.URL.revokeObjectURL = () => {};

  // GPS: 첫 호출은 신호 없음(code 2), 두 번째는 성공 — 재시도 검증
  let gpsCalls = 0;
  let gpsMode = 'retry';
  Object.defineProperty(window.navigator, 'geolocation', {
    value: {
      getCurrentPosition: (ok, err) => {
        gpsCalls++;
        if (gpsMode === 'denied') return setTimeout(() => err({ code: 1 }), 5);
        if (gpsMode === 'retry' && gpsCalls === 1) return setTimeout(() => err({ code: 2 }), 5);
        setTimeout(() => ok({ coords: { latitude: 33.3617, longitude: 126.3122, altitude: 320, accuracy: 12 } }), 5);
      },
    }, configurable: true,
  });

  window.eval(fs.readFileSync(path.join(WEB, 'core.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(WEB, 'app.js'), 'utf8'));

  const $ = (id) => doc.getElementById(id);
  const click = (el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  const type = (el, v) => { el.value = v; el.dispatchEvent(new window.Event('input', { bubbles: true })); };
  const readState = () => JSON.parse(window.localStorage.getItem('field_flora_state'));
  const S = () => { const st = readState(); return st.surveys.find((x) => x.id === st.currentId); };
  const tab = (n) => click($('tabbar').querySelector(`[data-tab="${n}"]`));

  await sleep(1800);

  console.log('\n[햇빛 모드 동작]');
  t('토글 버튼이 요약 탭에 있다', () => assert.ok($('sunToggle'), '#sunToggle 없음'));
  t('처음엔 어두운 모드', () => assert.ok(!doc.body.classList.contains('sun')));
  t('누르면 햇빛 모드로 바뀐다', () => {
    click($('sunToggle'));
    assert.ok(doc.body.classList.contains('sun'), 'sun 클래스 미적용');
  });
  t('버튼 문구가 되돌리기로 바뀐다', () => {
    assert.ok($('sunToggle').textContent.includes('어두운'), $('sunToggle').textContent);
  });
  t('상태표시줄 색도 함께 바뀐다', () => {
    const meta = doc.querySelector('meta[name="theme-color"]');
    assert.strictEqual(meta.getAttribute('content'), '#0a6b33');
  });
  t('설정이 저장된다 (다음에 켜도 유지)', () => {
    assert.strictEqual(window.localStorage.getItem('field_flora_sun'), '1');
  });
  t('다시 누르면 어두운 모드로', () => {
    click($('sunToggle'));
    assert.ok(!doc.body.classList.contains('sun'));
    assert.strictEqual(window.localStorage.getItem('field_flora_sun'), '0');
  });

  console.log('\n[최근 입력 버튼 — 연타해도 안 지워짐]');
  tab('rec');
  await sleep(80);
  for (const sp of ['소나무', '억새', '곰솔']) {
    type($('q'), sp); await sleep(120);
    const f = $('results').querySelector('li:not(.more)');
    if (f) { click(f); await sleep(50); }
  }
  t('3종 기록됨', () => assert.strictEqual(S().records.length, 3, JSON.stringify(S().records.map((r) => r.name))));

  const btns = $('recent').querySelectorAll('button');
  t('최근 입력 버튼이 생겼다', () => assert.ok(btns.length >= 3, btns.length + '개'));
  t('이미 넣은 종은 ✓ 표시', () => {
    const on = [...btns].filter((b) => b.classList.contains('on'));
    assert.ok(on.length >= 3, on.length + '개만 표시됨');
  });
  t('✓ 버튼을 눌러도 기록이 안 지워진다', () => {
    const before = S().records.length;
    click(btns[0]); click(btns[0]); click(btns[1]);
    assert.strictEqual(S().records.length, before, '연타로 기록이 삭제됨');
  });
  t('이미 기록됨 안내가 뜬다', () => {
    assert.ok($('toast').textContent.includes('이미 기록'), $('toast').textContent);
  });
  t('새 지점에서는 최근 버튼이 다시 추가로 동작', () => {
    tab('site');
    click($('addSite'));
    return sleep(200).then(() => {
      tab('rec');
      return sleep(80);
    }).then(() => {
      const nb = $('recent').querySelectorAll('button');
      const before = S().records.length;
      click(nb[0]);
      assert.strictEqual(S().records.length, before + 1, '새 지점에서 추가가 안 됨');
    });
  });

  console.log('\n[GPS — 실패해도 조사는 계속된다]');
  gpsCalls = 0; gpsMode = 'retry';
  tab('site');
  await sleep(60);
  const nSites = S().sites.length;
  click($('addSite'));
  await sleep(300);
  t('첫 시도 실패하면 자동 재시도한다', () => {
    assert.ok(gpsCalls >= 2, `getCurrentPosition ${gpsCalls}회만 호출됨`);
  });
  t('재시도로 좌표를 확보한다', () => {
    const last = S().sites[S().sites.length - 1];
    assert.strictEqual(last.lat, 33.3617, '좌표 미확보: ' + JSON.stringify(last));
  });
  t('지점 수는 정확히 1개만 늘어난다', () => {
    assert.strictEqual(S().sites.length, nSites + 1);
  });

  gpsMode = 'denied';
  const n2 = S().sites.length;
  click($('addSite'));
  await sleep(250);
  t('권한 거부여도 지점은 추가된다 (기록을 막지 않는다)', () => {
    assert.strictEqual(S().sites.length, n2 + 1);
  });
  t('권한 거부는 재시도하지 않는다', () => {
    const before = gpsCalls;
    return sleep(100).then(() => assert.strictEqual(gpsCalls, before, '거부인데 재시도함'));
  });
  t('좌표 없는 지점은 경고로 표시된다', () => {
    assert.ok($('siteList').innerHTML.includes('scoord warn'), '경고 클래스 없음');
    assert.ok($('siteList').textContent.includes('좌표 없음'), $('siteList').textContent.slice(0, 80));
  });
  t('측정중 상태가 저장에 남지 않는다', () => {
    const stuck = S().sites.filter((x) => x.locating);
    assert.strictEqual(stuck.length, 0, JSON.stringify(stuck));
  });

  console.log('\n[플로팅 검색 버튼]');
  t('버튼이 존재하고 처음엔 숨겨져 있다', () => {
    assert.ok($('fabSearch'), '#fabSearch 없음');
    assert.strictEqual($('fabSearch').hidden, true);
  });
  t('누르면 검색창에 포커스가 간다', () => {
    $('fabSearch').onclick();
    assert.strictEqual(doc.activeElement.id, 'q', '포커스: ' + doc.activeElement.id);
  });

  console.log('\n[전체 무결성]');
  t('실행 중 스크립트 오류 없음', () => assert.deepStrictEqual(errors, []));
  t('기록이 하나도 유실되지 않았다', () => {
    const s = S();
    assert.ok(s.records.length >= 4, s.records.length + '건');
    assert.ok(s.records.every((r) => r.name && r.siteId), '이름·지점 없는 기록 존재');
  });

  console.log(`\n결과: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('테스트 실행 오류:', e);
  process.exit(1);
});
