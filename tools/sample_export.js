/* 실제 CSV 산출물 생성 — 사람이 열어 확인할 샘플.
 * node tools/sample_export.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const C = require('../core.js');

const dict = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'taxa.json'), 'utf8'));
const find = (n) => {
  const t = dict.taxa.find((x) => x.n === n);
  if (!t) throw new Error('사전에 없음: ' + n);
  return t;
};

const sites = [
  { id: 's1', name: 'St.1', lat: 33.40712, lon: 126.26985, alt: 312 },
  { id: 's2', name: 'St.2', lat: 33.41055, lon: 126.27431, alt: 287 },
  { id: 's3', name: 'St.3', lat: 33.41498, lon: 126.28002, alt: 401 },
];
const plan = {
  s1: [['소나무', 12, '4'], ['곰솔', 3, '2'], ['억새', 40, '3'], ['개망초', 8, '+'], ['쑥', 15, '2']],
  s2: [['신갈나무', 9, '3'], ['소나무', 5, '2'], ['고사리', 22, '2'], ['칡', 4, '1']],
  s3: [['신갈나무', 14, '4'], ['조릿대', 60, '5'], ['비목나무', 2, '+']],
};

const records = [];
let ts = Date.parse('2026-09-22T09:10:00+09:00');
for (const [sid, rows] of Object.entries(plan)) {
  for (const [name, count, cover] of rows) {
    const t = find(name);
    records.push({
      id: sid + t.i, siteId: sid, taxonId: t.i, name: t.n, scientific: t.s,
      family: t.f, count, cover, note: '', at: (ts += 90000),
    });
  }
}

const survey = {
  title: '한림읍 금악리 소규모환경영향평가',
  date: '2026-09-22', surveyor: '홍길동', sites, records,
};

const out = path.join(__dirname, '..', 'samples');
fs.mkdirSync(out, { recursive: true });
const w = (n, s) => {
  const p = path.join(out, n);
  fs.writeFileSync(p, '\ufeff' + s, 'utf8');
  console.log(p);
};
w(C.fileStamp(survey) + '_기록.csv', C.toRecordsCSV(survey));
w(C.fileStamp(survey) + '_조사표.csv', C.toMatrixCSV(survey));

const sum = C.summarize(survey);
console.log(`\n총 출현종 ${sum.totalTaxa} / 기록 ${sum.totalRecords} / 지점 ${sum.siteCount} / 과 ${sum.families.length}`);
sum.bySite.forEach((b) => console.log(`  ${b.site.name}: ${b.count}종  ${C.toDMS(b.site.lat, true)} ${C.toDMS(b.site.lon, false)}`));
