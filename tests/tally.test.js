/* 제주고사리삼 실야장 기반 다지점 계수 회귀 테스트. 원본은 읽기 전용. */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const C = require('../core.js');
const ff = require('../vendor/fflate.min.js');
const root = path.join(__dirname, '..');
const realBook = process.env.FIELD_FLORA_TALLY_XLSX;
const useReal = Boolean(realBook && fs.existsSync(realBook));
const fixture = () => {
  const enc = (s) => new TextEncoder().encode(s);
  return ff.zipSync({
    'xl/workbook.xml': enc('<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="예시 지점" sheetId="1" r:id="rId1"/><sheet name="새 차수" sheetId="2" r:id="rId2"/></sheets></workbook>'),
    'xl/_rels/workbook.xml.rels': enc('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>'),
    'xl/sharedStrings.xml': enc('<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>이름</t></si><si><t>예시-1</t></si><si><t>예시-2</t></si><si><t>예시-3</t></si></sst>'),
    'xl/worksheets/sheet1.xml': enc('<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row><row r="2"><c r="A2" t="s"><v>1</v></c></row><row r="3"><c r="A3" t="s"><v>2</v></c></row><row r="4"><c r="A4" t="s"><v>3</v></c></row></sheetData></worksheet>'),
    'xl/worksheets/sheet2.xml': enc('<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>이름</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>예시-1</t></is></c></row><row r="3"><c r="A3" t="inlineStr"><is><t>예시-2</t></is></c></row><row r="4"><c r="A4" t="inlineStr"><is><t>예시-3</t></is></c></row></sheetData></worksheet>'),
  });
};
const workbook = useReal ? fs.readFileSync(realBook) : fixture();
const sheetName = useReal ? '조사표 26년1분기' : '새 차수';
const expected = useReal ? 105 : 3;
const firstNames = useReal ? ['Mj 1','Mj 2'] : ['예시-1','예시-2'];
const lastName = useReal ? 'Ma-11' : '예시-3';
const dict = JSON.parse(fs.readFileSync(path.join(root, 'data/taxa.json'), 'utf8'));
const mk = () => ({ title:'2026 1분기', date:'2026-01-10', sites:[], records:[] });
let passed = 0, failed = 0;
const test = (name, fn) => { try { fn(); passed++; console.log('OK',name); } catch (e) { failed++; console.error('FAIL',name,e.stack); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dom = new JSDOM(fs.readFileSync(path.join(root,'index.html'),'utf8'), { url:'https://example.test/', runScripts:'outside-only', pretendToBeVisual:true });
const {window} = dom;
global.DOMParser = window.DOMParser;
const reader = C.xlsxSiteReader(new Uint8Array(workbook),ff.unzipSync);
const names = reader.sites(sheetName);
const species = C.search(C.buildIndex(dict.taxa),'제주고사리삼',5)[0];

test('XLSX에서 원본 지점명만 읽음', () => {
  assert.strictEqual(names.length,expected);
  assert.strictEqual(new Set(names).size,expected);
  assert.deepStrictEqual(names.slice(0,2),firstNames);
  assert.strictEqual(names.at(-1),lastName);
});
test('과거 2025년 수량은 2026 지점명으로 흡수하지 않음', () => {
  const s=mk(); s.sites=names.map((n,i)=>({id:'s'+i,name:n}));
  assert.strictEqual(s.records.length,0);
  assert.strictEqual(C.tallyCount(s,species.i,'s0'),null);
});
test('미조사 / 0 / 1 구분과 합계', () => {
  const s=mk(); s.sites=names.map((n,i)=>({id:'s'+i,name:n}));
  C.setTallyCount(s,species,'s0',0);
  C.setTallyCount(s,species,'s1',1);
  C.setTallyCount(s,species,'s1',4);
  assert.strictEqual(C.tallyCount(s,species.i,'s0'),0);
  assert.strictEqual(C.tallyCount(s,species.i,'s1'),4);
  assert.strictEqual(C.tallyCount(s,species.i,'s2'),null);
  assert.strictEqual(s.records.length,1);
  const rows=C.parseCSV(C.toTallyCSV(s,species));
  assert.deepStrictEqual(rows[1].slice(3,6),[names[0],'미발견','0']);
  assert.deepStrictEqual(rows[2].slice(3,6),[names[1],'확인','4']);
  assert.deepStrictEqual(rows[3].slice(3,6),[names[2],'미조사','']);
  assert.strictEqual(rows.length,expected+2);
  assert.strictEqual(rows.at(-1)[5],'4');
});
test('0으로 바꿔도 출현종수에 포함되지 않고 재시작 시 유지', () => {
  const s=mk();s.sites=[{id:'a',name:'Mj 1'}];
  C.setTallyCount(s,species,'a',2); C.setTallyCount(s,species,'a',0);
  const restored=JSON.parse(JSON.stringify(s));
  assert.strictEqual(restored.records.length,0);
  assert.strictEqual(C.summarize(restored).totalTaxa,0);
  assert.strictEqual(C.tallyCount(restored,species.i,'a'),0);
});
test('CSV 지점열은 실제 값만, 중복 지점 거부', () => {
  assert.deepStrictEqual(C.parseSiteNames('\ufeff지점,비고\r\nMj 1,ma3\r\nMa-1,'),['Mj 1','Ma-1']);
  assert.throws(()=>C.parseSiteNames('지점\nMj 1\nMj 1'),/중복/);
});
test('이중탭 확대 방지 CSS와 핀치 확대 허용', () => {
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  const css=fs.readFileSync(path.join(root,'styles.css'),'utf8');
  assert.match(css,/touch-action:manipulation/);
  assert.doesNotMatch(html,/user-scalable=no|maximum-scale=1/);
});

(async()=>{
  const errors=[];
  window.addEventListener('error',e=>errors.push(e.message));
  global.window=window;global.document=window.document;
  try {global.navigator=window.navigator;} catch(e) {Object.defineProperty(global,'navigator',{value:window.navigator,configurable:true});}
  Object.defineProperty(window,'indexedDB',{value:undefined,configurable:true});
  window.fetch=()=>Promise.resolve({ok:true,json:()=>Promise.resolve(dict)});
  window.navigator.vibrate=()=>true;
  window.fflate=ff;
  window.confirm=()=>true;
  window.prompt=()=> '제주고사리삼 새 분기';
  window.URL.createObjectURL=()=> 'blob:test';window.URL.revokeObjectURL=()=>{};
  window.eval(fs.readFileSync(path.join(root,'core.js'),'utf8'));
  window.eval(fs.readFileSync(path.join(root,'app.js'),'utf8'));
  const $=id=>window.document.getElementById(id);
  const click=el=>el.dispatchEvent(new window.MouseEvent('click',{bubbles:true}));
  const type=(el,text)=>{el.value=text;el.dispatchEvent(new window.Event('input',{bubbles:true}));};
  const state=()=>JSON.parse(window.localStorage.getItem('field_flora_state'));
  const current=()=>{const s=state();return s.surveys.find(x=>x.id===s.currentId);};
  await sleep(1600);
  click($('openTally'));
  test('순회 모드 진입, 기존 종 입력은 숨음',()=>{
    assert.strictEqual($('tallyPanel').hidden,false);
    assert.ok($('tab-rec').classList.contains('tally-mode'));
  });
  type($('tallyQuery'),'제주고사리삼');
  test('제주고사리삼이 실제 사전에서 선택 가능',()=>{
    assert.match($('tallyHits').textContent,/제주고사리삼/);
    click($('tallyHits').querySelector('button'));
    assert.match($('tallySpecies').textContent,/제주고사리삼/);
  });
  const f={name:'site-list.xlsx',size:workbook.length,arrayBuffer:async()=>workbook.buffer.slice(workbook.byteOffset,workbook.byteOffset+workbook.byteLength)};
  $('tallySiteFile').onchange({target:{files:[f],value:'x'}});
  await sleep(80);
  test('XLSX 업로드 후 시트 선택 가능',()=>{
    assert.strictEqual($('tallySheetPicker').hidden,false);
    assert.strictEqual($('tallySheet').options.length,reader.sheets.length);
    assert.strictEqual($('tallySheet').value,sheetName);
  });
  click($('tallyUseSheet'));
  test('지점명만 입력, 과거 개체수는 0건',()=>{
    assert.strictEqual(current().sites.length,expected);
    assert.strictEqual(current().records.length,0);
    assert.strictEqual($('tallySites').querySelectorAll('.tally-row').length,expected);
    assert.match($('tallyStats').textContent,new RegExp('0/'+expected+'지점'));
  });
  test('첫 지점 0, 둘째 지점 + +, 숫자 직접 수정, 비고 즉시 저장',()=>{
    const row=()=>$('tallySites').querySelectorAll('.tally-row');
    click(row()[0].querySelector('.zero'));
    click(row()[1].querySelector('.plus'));
    click(row()[1].querySelector('.plus'));
    assert.strictEqual(current().records.length,1);
    assert.strictEqual(current().records[0].count,2);
    assert.match($('tallyStats').textContent,new RegExp('2/'+expected+'지점'));
    const amount=row()[1].querySelector('.amount');amount.value='12';amount.dispatchEvent(new window.Event('change',{bubbles:true}));
    const note=row()[1].querySelector('.tally-note');type(note,'노루똥');
    assert.strictEqual(current().records[0].count,12);
    assert.strictEqual(current().tallyNotes[species.i+':'+current().sites[1].id],'노루똥');
    assert.match(C.toTallyCSV(current(),species),/노루똥/);
  });
  test('필터와 스크롤 후 검색 버튼은 main을 사용',()=>{
    type($('tallyFilter'),lastName);
    assert.strictEqual($('tallySites').querySelectorAll('.tally-row').length,1);
    type($('tallyFilter'),'');
    click($('closeTally'));
    window.document.querySelector('main').scrollTop=300;
    window.document.querySelector('main').dispatchEvent(new window.Event('scroll'));
    assert.strictEqual($('fabSearch').hidden,false);
    click($('fabSearch'));
    assert.strictEqual(window.document.querySelector('main').scrollTop,0);
    click($('openTally'));
  });
  test('미조사 필터에서 연속 탭해도 다음 지점 오기록 없음',()=>{
    const pending=$('tallyPending'); pending.checked=true;
    pending.dispatchEvent(new window.Event('change',{bubbles:true}));
    const visible=()=>$('tallySites').querySelectorAll('.tally-row');
    assert.strictEqual(visible().length,expected-2);
    const stableRow=visible()[0];
    const nextRow=visible()[1] || null;
    click(stableRow.querySelector('.plus'));
    click(stableRow.querySelector('.plus'));
    assert.strictEqual(visible()[0],stableRow,'연타 중 누른 행 DOM이 유지되어야 함');
    if (nextRow) assert.strictEqual(visible()[1],nextRow,'다음 지점 DOM이 이동하면 안 됨');
    assert.strictEqual(visible().length,expected-2);
    assert.strictEqual(current().records.find((r)=>r.siteId===current().sites[2].id).count,2);
    assert.strictEqual(C.tallyCount(current(),species.i,current().sites[1].id),12);
    assert.strictEqual(current().records.length,2);
    pending.checked=false;pending.dispatchEvent(new window.Event('change',{bubbles:true}));
  });
  test('다음 분기는 이름만 복사, 기존 기록은 별도 보존',()=>{
    click($('tallyNextRound'));
    assert.strictEqual(current().sites.length,expected);
    assert.strictEqual(current().records.length,0);
    assert.strictEqual(Object.keys(current().tallyVisits||{}).length,0);
    assert.strictEqual(state().surveys.length,2);
    assert.strictEqual(state().surveys[0].records[0].count,12);
    assert.match($('tallyStats').textContent,new RegExp('0/'+expected+'지점'));
  });
  test('실행 오류 없음',()=>assert.deepStrictEqual(errors,[]));
  console.log(`결과: ${passed} passed, ${failed} failed`);
  process.exit(failed?1:0);
})().catch(e=>{console.error('FAIL test runtime',e);process.exit(1);});
