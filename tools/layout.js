/* 레이아웃 점검 — 아이폰 화면 크기 기준으로 실제 보이는 높이를 계산한다.
 * jsdom은 레이아웃을 계산하지 않으므로 CSS 수치를 직접 합산한다.
 * node tools/layout.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const WEB = path.join(__dirname, '..');
const css = fs.readFileSync(path.join(WEB, 'styles.css'), 'utf8');
const html = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8');

// 아이폰 기준 (Safari 주소창 표시 상태의 실사용 높이)
const PHONES = [
  { name: 'iPhone SE (2/3세대)', w: 375, h: 667, safeTop: 20, safeBot: 0 },
  { name: 'iPhone 13/14/15', w: 390, h: 844, safeTop: 47, safeBot: 34 },
  { name: 'iPhone 14/15 Pro Max', w: 430, h: 932, safeTop: 59, safeBot: 34 },
];

/** CSS에서 선택자의 특정 속성값을 뽑는다 (단순 규칙만 — 계산이 아니라 점검용) */
function prop(selector, name) {
  const re = new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}');
  const m = css.match(re);
  if (!m) return null;
  const p = m[1].match(new RegExp('(?:^|;)\\s*' + name + '\\s*:\\s*([^;]+)'));
  return p ? p[1].trim() : null;
}
const px = (v) => (v ? parseInt(v, 10) || 0 : 0);

console.log('━━━ 고정 영역이 화면을 얼마나 먹는가 ━━━\n');

const tap = px(prop(':root', '--tap')) || 56;
const tabbarH = px(prop('#tabbar', 'height')) || px(prop('#tabbar button', 'min-height')) || 56;
const searchH = px(prop('#q', 'min-height')) || tap;

console.log(`--tap (탭 최소 크기)   : ${tap}px`);
console.log(`탭바 높이              : ${tabbarH}px`);
console.log(`검색창 높이            : ${searchH}px\n`);

// 상단바 = 조사칩 행 + 지점 탭 행
const chipH = 34 + 8;              // .chip padding 7px*2 + 글자 ~20
const siteRowH = 9 * 2 + 20 + 8;   // .site-tab padding 9px*2 + 글자 + 하단 8
const topbarH = chipH + siteRowH + 16;

for (const p of PHONES) {
  const usable = p.h - p.safeTop - p.safeBot;
  const fixed = topbarH + searchH + tabbarH;
  const free = usable - fixed;
  const rowH = 56 + 6;             // .reclist li min-height + margin
  const rows = Math.floor(free / rowH);
  const flag = rows < 4 ? '  ⚠ 기록이 4행도 안 보인다' : '';
  console.log(`${p.name}  (${p.w}×${p.h})`);
  console.log(`  사용가능 ${usable}px − 고정 ${fixed}px = 목록 영역 ${free}px → 약 ${rows}행${flag}`);
}

console.log('\n━━━ 한 손 조작 — 엄지 닿는 범위 ━━━\n');
console.log('오른손 엄지 편한 영역: 화면 하단 55% (iPhone 13 기준 y > 380)');
const bottomOps = [];
const topOps = [];
// 주요 조작 요소가 위/아래 어디에 있는지
const layout = [
  ['조사 선택 칩', '최상단', 'top'],
  ['지점 전환 탭', '상단', 'top'],
  ['검색창', '상단', 'top'],
  ['음성 버튼', '상단(검색창 옆)', 'top'],
  ['검색 결과', '상단~중앙', 'mid'],
  ['최근 입력 버튼', '중앙', 'mid'],
  ['기록 목록', '중앙~하단', 'mid'],
  ['탭바(5개)', '최하단', 'bottom'],
];
layout.forEach(([n, where, z]) => {
  console.log(`  ${z === 'top' ? '▲' : z === 'bottom' ? '▼' : '·'} ${n.padEnd(16)} ${where}`);
  (z === 'top' ? topOps : bottomOps).push(n);
});
console.log(`\n  상단 조작 ${topOps.length}개 / 하단 ${bottomOps.length}개`);
if (topOps.length > 3) {
  console.log('  ⚠ 자주 쓰는 조작이 상단에 몰려 있다 — 한 손으로 잡고 쓰기 어렵다');
}

console.log('\n━━━ 터치 타깃 크기 점검 ━━━\n');
const targets = [
  ['#tabbar button', '탭바 버튼'],
  ['.site-tab', '지점 전환'],
  ['.results li', '검색 결과 행'],
  ['.quickgrid button', '최근 입력'],
  ['.reclist li', '기록 행'],
  ['.reclist .cv', '우점도 칸'],
  ['.icon-btn', '검색창 아이콘'],
  ['.chiprow button', '칩 버튼'],
  ['.sitelist .del', '삭제 버튼'],
];
let small = 0;
targets.forEach(([sel, label]) => {
  const h = px(prop(sel, 'min-height')) || px(prop(sel, 'height'));
  const w = px(prop(sel, 'min-width')) || px(prop(sel, 'width'));
  const size = h || w;
  const bad = size && size < 44;
  if (bad) small++;
  const mark = !size ? '?' : bad ? '⚠ 작음' : 'OK';
  console.log(`  ${label.padEnd(14)} ${String(size || '-').padStart(4)}px  ${mark}`);
});
if (small) console.log(`\n  ⚠ 44px 미만 ${small}개 — 장갑 끼면 누르기 어렵다`);

console.log('\n━━━ 글자 크기 ━━━\n');
const fonts = [
  ['.reclist .nm', '종명'],
  ['.reclist .sci', '학명'],
  ['.results li', '검색 결과'],
  ['.hint', '안내문구'],
  ['.scoord', '좌표'],
];
fonts.forEach(([sel, label]) => {
  const f = px(prop(sel, 'font-size'));
  const mark = f && f < 13 ? '⚠ 땡볕에서 안 보임' : f ? 'OK' : '?';
  console.log(`  ${label.padEnd(12)} ${String(f || '-').padStart(4)}px  ${mark}`);
});

console.log('\n━━━ 다크/라이트 ━━━\n');
console.log(`  prefers-color-scheme 대응: ${/prefers-color-scheme/.test(css) ? '있음' : '없음 (⚠ 땡볕에서 어두운 화면은 안 보인다)'}`);
console.log(`  고대비 모드 대응       : ${/prefers-contrast/.test(css) ? '있음' : '없음'}`);

console.log('\n━━━ 입력 요소 iOS 확대 방지 ━━━\n');
const inputFont = px(prop('input,textarea,select', 'font-size')) || px(prop('input', 'font-size'));
console.log(`  input font-size: ${inputFont || '?'}px ${inputFont && inputFont < 16 ? '⚠ 16px 미만 → 탭할 때 화면이 확대된다' : 'OK'}`);
const inputs = (html.match(/<input[^>]*>/g) || []);
const noInputMode = inputs.filter((i) => /type="(number|tel)"/.test(i) && !/inputmode/.test(i));
console.log(`  숫자 입력칸 ${inputs.filter((i)=>/type="(number|tel)"/.test(i)).length}개, inputmode 없는 것 ${noInputMode.length}개`);
if (noInputMode.length) console.log('  ⚠ inputmode 없으면 숫자 키패드가 안 뜬다');
