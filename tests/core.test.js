/* 코어 로직 테스트 — node tests/core.test.js */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const C = require('../core.js');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ok  ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + '\n       ' + e.message); }
}

console.log('[norm/chosung]');
t('norm: 대소문자·공백·기호 제거', () => {
  assert.strictEqual(C.norm('Pinus  densiflora'), 'pinusdensiflora');
  assert.strictEqual(C.norm('개-망초 '), '개망초');
});
t('chosung: 한글 초성 추출', () => {
  assert.strictEqual(C.chosung('소나무'), 'ㅅㄴㅁ');
  assert.strictEqual(C.chosung('개망초'), 'ㄱㅁㅊ');
});
t('isChosungQuery', () => {
  assert.strictEqual(C.isChosungQuery('ㅅㄴㅁ'), true);
  assert.strictEqual(C.isChosungQuery('소나'), false);
});

console.log('[search]');
const sample = [
  { i: 1, n: '소나무', s: 'Pinus densiflora', f: '소나무과', a: ['솔나무', '육송'] },
  { i: 2, n: '곰솔', s: 'Pinus thunbergii', f: '소나무과', a: ['해송'] },
  { i: 3, n: '개망초', s: 'Erigeron annuus', f: '국화과', a: [] },
  { i: 4, n: '망초', s: 'Erigeron canadensis', f: '국화과', a: [] },
  { i: 5, n: '소나무겨우살이', s: 'Usnea longissima', f: '송라과', a: [] },
];
const idx = C.buildIndex(sample);

t('완전일치가 최상위', () => {
  const r = C.search(idx, '소나무');
  assert.strictEqual(r[0].n, '소나무');
});
t('짧은 이름이 부분일치보다 우선(망초 < 개망초)', () => {
  const r = C.search(idx, '망초');
  assert.strictEqual(r[0].n, '망초');
  assert.ok(r.some((x) => x.n === '개망초'));
});
t('별칭 검색', () => {
  const r = C.search(idx, '육송');
  assert.strictEqual(r[0].n, '소나무');
  assert.strictEqual(r[0].matched, '육송');
});
t('학명 접두 검색', () => {
  const r = C.search(idx, 'pinus');
  assert.strictEqual(r.length, 2);
  assert.ok(r.every((x) => x.f === '소나무과'));
});
t('학명 공백 무시', () => {
  const r = C.search(idx, 'Pinus dens');
  assert.strictEqual(r[0].n, '소나무');
});
t('초성 검색', () => {
  const r = C.search(idx, 'ㄱㅁㅊ');
  assert.strictEqual(r[0].n, '개망초');
});
t('빈 쿼리는 결과 없음', () => {
  assert.deepStrictEqual(C.search(idx, '   '), []);
});
t('limit 적용', () => {
  assert.strictEqual(C.search(idx, '소', 1).length, 1);
});

console.log('[좌표]');
t('toDMS 북위/동경', () => {
  assert.strictEqual(C.toDMS(33.5, true), 'N 33°30\'00.0"');
  assert.strictEqual(C.toDMS(126.25, false), 'E 126°15\'00.0"');
});
t('toDMS 빈값', () => assert.strictEqual(C.toDMS(null, true), ''));

console.log('[집계/내보내기]');
const survey = {
  title: '테스트조사', date: '2026-09-22', surveyor: '홍길동',
  sites: [
    { id: 's1', name: 'St.1', lat: 33.5, lon: 126.5, alt: 120 },
    { id: 's2', name: 'St.2', lat: 33.6, lon: 126.6, alt: 240 },
  ],
  records: [
    { id: 'r1', siteId: 's1', taxonId: 1, name: '소나무', scientific: 'Pinus densiflora', family: '소나무과', count: 5, cover: '3', note: '', at: 1758500000000 },
    { id: 'r2', siteId: 's1', taxonId: 3, name: '개망초', scientific: 'Erigeron annuus', family: '국화과', count: 1, cover: '+', note: '길가, "인용"부호', at: 1758500001000 },
    { id: 'r3', siteId: 's2', taxonId: 1, name: '소나무', scientific: 'Pinus densiflora', family: '소나무과', count: 2, cover: '2', note: '', at: 1758500002000 },
  ],
};

t('summarize 전체 출현종수는 중복 제거', () => {
  const s = C.summarize(survey);
  assert.strictEqual(s.totalTaxa, 2);
  assert.strictEqual(s.totalRecords, 3);
  assert.strictEqual(s.siteCount, 2);
});
t('summarize 지점별 종수', () => {
  const s = C.summarize(survey);
  assert.strictEqual(s.bySite[0].count, 2);
  assert.strictEqual(s.bySite[1].count, 1);
});
t('summarize 과별 종수 합 = 전체 종수', () => {
  const s = C.summarize(survey);
  const sum = s.families.reduce((a, b) => a + b.count, 0);
  assert.strictEqual(sum, s.totalTaxa);
});
t('빈 조사 집계', () => {
  const s = C.summarize({ sites: [], records: [] });
  assert.strictEqual(s.totalTaxa, 0);
  assert.strictEqual(s.families.length, 0);
});

t('기록 CSV 행수 = 기록수 + 헤더', () => {
  const rows = C.toRecordsCSV(survey).split('\r\n');
  assert.strictEqual(rows.length, 4);
  assert.ok(rows[0].startsWith('조사명,조사일'));
});
t('기록 CSV 쉼표·따옴표 이스케이프', () => {
  const csv = C.toRecordsCSV(survey);
  assert.ok(csv.includes('"길가, ""인용""부호"'), 'RFC4180 이스케이프 실패');
});
t('매트릭스 CSV: 종 행 + 출현종수 행', () => {
  const rows = C.toMatrixCSV(survey).split('\r\n');
  assert.strictEqual(rows.length, 4); // header + 2종 + 합계
  assert.strictEqual(rows[0], '연번,과,국명,학명,St.1,St.2');
  assert.ok(rows[3].endsWith('2,1'), '지점별 출현종수 불일치: ' + rows[3]);
});
t('매트릭스 셀은 우점도 값', () => {
  const rows = C.toMatrixCSV(survey).split('\r\n');
  const pine = rows.find((r) => r.includes('소나무'));
  assert.ok(pine.endsWith('3,2'), pine);
});
t('fileStamp 금지문자 제거', () => {
  assert.strictEqual(C.fileStamp({ title: 'A/B:C', date: '2026-09-22' }), 'A_B_C_20260922');
});

console.log('[실제 사전]');
const dictPath = path.join(__dirname, '..', 'data', 'taxa.json');
if (fs.existsSync(dictPath)) {
  const dict = JSON.parse(fs.readFileSync(dictPath, 'utf8'));
  const real = C.buildIndex(dict.taxa);
  t('사전 1만종 이상', () => assert.ok(dict.taxa.length > 10000, String(dict.taxa.length)));
  t('실제 검색: 소나무', () => {
    const r = C.search(real, '소나무');
    assert.strictEqual(r[0].n, '소나무');
    assert.ok(r[0].s.startsWith('Pinus'), r[0].s);
  });
  t('실제 검색: 학명 Quercus', () => {
    const r = C.search(real, 'Quercus');
    assert.ok(r.length >= 5, String(r.length));
    assert.ok(r.every((x) => x.s.toLowerCase().startsWith('quercus')), JSON.stringify(r.map(x=>x.s)));
  });
  // 앱이 limit=2000으로 부르므로, 초성 검색 결과가 25개에서 잘리면 안 된다
  t('초성 ㅅㄴㅁ 결과가 25종을 넘음', () => {
    const n = C.search(real, 'ㅅㄴㅁ', 2000).length;
    assert.ok(n > 25, '초성 결과가 ' + n + '종뿐 — 더보기가 필요 없어짐');
  });
  t('초성 검색이 limit에 맞춰 더 준다', () => {
    const few = C.search(real, 'ㅅㄴㅁ', 25).length;
    const many = C.search(real, 'ㅅㄴㅁ', 2000).length;
    assert.strictEqual(few, 25);
    assert.ok(many > few, `limit을 올려도 ${many}종 — 검색이 결과를 더 못 준다`);
  });
  t("'나무' 검색은 수천 종", () => {
    const n = C.search(real, '나무', 5000).length;
    assert.ok(n > 1000, String(n));
  });
  t('실제 검색 속도 < 150ms', () => {
    const t0 = Date.now();
    C.search(real, '나무');
    const dt = Date.now() - t0;
    assert.ok(dt < 150, dt + 'ms');
  });
  t('모든 taxon에 국명 존재', () => {
    assert.ok(dict.taxa.every((x) => x.n && x.n.length > 0));
  });
} else {
  console.log('  skip (taxa.json 없음 — tools/build_dict.py 먼저 실행)');
}

console.log(`\n결과: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
