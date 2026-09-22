/* 저장소 복원 회귀 테스트
 * 배경: IndexedDB가 늦게 열리거나 값을 못 주면 빈 상태로 판단해
 * 실행할 때마다 "조사 YYYY-MM-DD"가 새로 생성돼 목록이 불어나던 버그.
 * node tests/storage.test.js
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ok  ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + '\n       ' + (e && e.message)); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const dict = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'taxa.json'), 'utf8'));
const subset = ['소나무', '개망초'].map((n) => dict.taxa.find((x) => x.n === n));
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

/**
 * 앱을 한 번 구동한다.
 * @param {string|null} lsState localStorage에 미리 넣어둘 상태 JSON
 * @param {string} idbMode 'ok' | 'missing'(열리지만 값 없음) | 'hang'(응답 없음) | 'none'(미지원)
 */
async function boot(lsState, idbMode) {
  const vc = new VirtualConsole();
  const errors = [];
  vc.on('jsdomError', (e) => errors.push(e.message));
  const dom = new JSDOM(html, { url: 'http://localhost/', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc });
  const { window } = dom;
  if (lsState) window.localStorage.setItem('field_flora_state', lsState);

  // IndexedDB 동작을 모드별로 흉내낸다
  const store = new Map();
  if (idbMode === 'none') {
    Object.defineProperty(window, 'indexedDB', { value: undefined, configurable: true });
  } else {
    // 'missing' = 열리기는 하지만 읽기가 언제나 빈 값을 준다(쓰기는 조용히 버려진다).
    //             iOS Safari에서 스토리지가 비워졌는데 DB 핸들만 열리는 상황.
    const fakeGet = (key) => ({ _cb: null,
      set onsuccess(f) {
        this._cb = f;
        if (idbMode === 'hang') return;                 // 영영 콜백 없음
        setTimeout(() => {
          this.result = idbMode === 'missing' ? undefined : store.get(key);
          f();
        }, 0);
      },
      set onerror(_f) {}, result: undefined });
    Object.defineProperty(window, 'indexedDB', {
      configurable: true,
      value: {
        open() {
          const req = {};
          setTimeout(() => {
            req.result = {
              transaction: () => ({
                objectStore: () => ({
                  get: fakeGet,
                  put: (v, k) => { if (idbMode !== 'missing') store.set(k, JSON.parse(JSON.stringify(v))); },
                }),
                set oncomplete(f) { setTimeout(f, 0); }, set onerror(_f) {}, set onabort(_f) {},
              }),
            };
            if (req.onsuccess) req.onsuccess();
          }, 0);
          return req;
        },
      },
    });
  }

  window.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({ taxa: subset }) });
  for (const f of ['core.js', 'app.js']) {
    const s = window.document.createElement('script');
    s.textContent = fs.readFileSync(path.join(ROOT, f), 'utf8');
    window.document.body.appendChild(s);
  }
  window.document.dispatchEvent(new window.Event('DOMContentLoaded', { bubbles: true }));
  await sleep(idbMode === 'hang' ? 3200 : 400);
  return { window, errors, ls: () => JSON.parse(window.localStorage.getItem('field_flora_state') || 'null') };
}

function makeState(surveyCount, withRecords) {
  const surveys = [];
  for (let i = 0; i < surveyCount; i++) {
    surveys.push({
      id: 's' + i, title: withRecords ? '한림읍 조사' : '조사 2026-09-22', date: '2026-09-22',
      surveyor: '', sites: [{ id: 'site' + i, name: 'St.1', lat: null, lon: null, alt: null }],
      records: withRecords ? [{ id: 'r' + i, siteId: 'site' + i, taxonId: subset[0].i, name: '소나무', scientific: subset[0].s, family: subset[0].f, count: 1, cover: '', note: '', at: Date.now() }] : [],
      currentSiteId: 'site' + i, createdAt: Date.now() - i * 1000,
    });
  }
  return JSON.stringify({ surveys, currentId: 's0', recent: [] });
}

async function main() {
  console.log('[IndexedDB가 값을 못 줄 때 기존 조사를 잃지 않는가]');
  {
    const saved = makeState(1, true);
    const a = await boot(saved, 'missing');
    t('IDB 비어도 localStorage 조사를 복원', () => {
      assert.strictEqual(a.ls().surveys.length, 1, '조사 수');
      assert.strictEqual(a.ls().surveys[0].records.length, 1, '기록 수');
    });
    t('새 빈 조사를 만들지 않음', () => {
      assert.ok(!a.ls().surveys.some((s) => /^조사 \d{4}/.test(s.title)), JSON.stringify(a.ls().surveys.map((s) => s.title)));
    });
    t('제목이 화면에 복원', () => {
      assert.ok(a.window.document.getElementById('surveyTitle').textContent.includes('한림읍'));
    });
  }

  console.log('[IndexedDB가 응답 없이 멈출 때]');
  {
    const a = await boot(makeState(1, true), 'hang');
    t('멈춰도 localStorage로 복원(무한대기 안 함)', () => {
      assert.strictEqual(a.ls().surveys.length, 1);
      assert.strictEqual(a.ls().surveys[0].records.length, 1);
    });
    t('앱이 조사명을 표시', () => {
      assert.ok(a.window.document.getElementById('surveyTitle').textContent.includes('한림읍'));
    });
  }

  console.log('[IndexedDB 미지원 기기]');
  {
    const a = await boot(makeState(1, true), 'none');
    t('localStorage만으로 정상 복원', () => assert.strictEqual(a.ls().surveys.length, 1));
  }

  console.log('[빈 조사 누적 정리]');
  {
    const a = await boot(makeState(5, false), 'ok');
    t('빈 자동생성 조사 5개 → 1개로 정리', () => {
      assert.strictEqual(a.ls().surveys.length, 1, JSON.stringify(a.ls().surveys.map((s) => s.title)));
    });
  }
  {
    // 기록이 있는 조사는 절대 지우지 않는다
    const mixed = JSON.parse(makeState(3, true));
    mixed.surveys[1].title = '조사 2026-09-22'; mixed.surveys[1].records = [];
    mixed.surveys[2].title = '조사 2026-09-22'; mixed.surveys[2].records = [];
    const a = await boot(JSON.stringify(mixed), 'ok');
    t('기록 있는 조사는 보존하고 빈 것만 정리', () => {
      const titles = a.ls().surveys.map((s) => s.title);
      assert.strictEqual(a.ls().surveys.filter((s) => s.records.length).length, 1, '기록 있는 조사 유실: ' + titles);
      assert.strictEqual(a.ls().surveys.length, 2, titles.join(','));
    });
  }

  console.log('[최초 실행]');
  {
    const a = await boot(null, 'ok');
    t('저장된 게 없으면 조사 1개만 생성', () => assert.strictEqual(a.ls().surveys.length, 1));
    t('기본 지점 St.1 포함', () => assert.strictEqual(a.ls().surveys[0].sites.length, 1));
  }

  console.log('[재실행 반복]');
  {
    // 같은 localStorage로 3번 연속 실행해도 조사가 늘지 않아야 한다
    let cur = makeState(1, true);
    for (let i = 0; i < 3; i++) {
      const a = await boot(cur, 'missing');
      cur = JSON.stringify(a.ls());
    }
    t('3회 재실행 후에도 조사 1개 유지', () => {
      const st = JSON.parse(cur);
      assert.strictEqual(st.surveys.length, 1, JSON.stringify(st.surveys.map((s) => s.title)));
      assert.strictEqual(st.surveys[0].records.length, 1);
    });
  }

  console.log(`\n결과: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
