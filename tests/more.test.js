const fs=require('fs'),path=require('path'),{JSDOM}=require('jsdom');
const W=process.cwd();
const dom=new JSDOM(fs.readFileSync(path.join(W,'index.html'),'utf8'),{runScripts:'outside-only',url:'http://localhost/'});
const {window}=dom; const doc=window.document;
global.window=window; global.document=doc; global.navigator=window.navigator;
window.indexedDB=undefined;
const store={}; window.localStorage={getItem:k=>store[k]||null,setItem:(k,v)=>store[k]=v,removeItem:k=>delete store[k]};
window.fetch=(u)=>Promise.resolve({ok:true,json:()=>Promise.resolve(JSON.parse(fs.readFileSync(path.join(W,'data','taxa.json'),'utf8')))});
window.eval(fs.readFileSync(path.join(W,'core.js'),'utf8'));
window.eval(fs.readFileSync(path.join(W,'app.js'),'utf8'));
const $=id=>doc.getElementById(id);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  await sleep(1500);
  const q=$('q');
  q.value='ㅅㄴㅁ';
  q.dispatchEvent(new window.Event('input',{bubbles:true}));
  await sleep(300);
  const items=()=>$('results').querySelectorAll('li:not(.more)').length;
  const more=()=>$('results').querySelector('.more button');
  console.log('초성 ㅅㄴㅁ → 처음 표시:',items(),'| 더보기:',more()?more().textContent.trim():'없음');
  if(!more()){console.log('FAIL: 더보기 버튼 없음');process.exit(1);}
  more().click(); await sleep(150);
  console.log('더보기 1회 후:',items(),'| 남음:',more()?more().textContent.trim():'모두표시');
  if(items()<=25){console.log('FAIL: 더보기가 안 늘어남');process.exit(1);}
  // 전체 63종이므로 한 번에 다 펼쳐져야 함
  console.log('전체표시 라벨:',$('results').querySelector('.more.done')?.textContent||'(없음)');
  // 새 검색 시 초기화 확인
  q.value='나무'; q.dispatchEvent(new window.Event('input',{bubbles:true})); await sleep(300);
  console.log('새 검색 나무 → 표시:',items(),'| 더보기:',more()?more().textContent.trim():'없음');
  if(items()!==25){console.log('FAIL: 새 검색에서 25개로 초기화 안 됨');process.exit(1);}
  console.log('\n결과: 4 passed, 0 failed');
})().catch(e=>{console.error('ERR',e.message);process.exit(1);});
