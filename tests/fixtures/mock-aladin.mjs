// Loaded only by isolated E2E web/worker commands.
import { createHash } from "node:crypto";
import { decodeHTMLStrict } from 'entities';
import { searchPage, productPage, usedPage } from './aladin-pages.mjs';
const originalFetch=globalThis.fetch, failedSearches=new Set(), products=new Map();
const html=body=>new Response(body,{headers:{'content-type':'text/html; charset=utf-8'}});
function item(isbn13){return {itemId:isbn13,isbn13,title:'갱신된 테스트 재고',author:'테스트 저자',description:'fixture',priceSales:1000,pubDate:'2026-01-01'};}
globalThis.fetch=async function(input,init){
 const url=new URL(input instanceof Request?input.url:String(input));
 if(url.hostname!=='www.aladin.co.kr')return originalFetch(input,init);
 if(url.pathname==='/search/wsearchresult.aspx'){
  const query=['SearchWord','KeyTitle','KeyAuthor','KeyPublisher'].map(k=>url.searchParams.get(k)).find(Boolean)??'';
  if(query.startsWith('검색재시도검증')&&!failedSearches.has(query)){failedSearches.add(query);return html('<p>점검 중</p>');}
  const page=Number(url.searchParams.get('page')??1);
  if(query.startsWith('검색결과없음'))return html(searchPage([],{page,total:0}));
  if(query.startsWith('상세필터검증')){
   const expected={SearchTarget:'Foreign',SortOrder:'2',ViewRowCount:'10',KeyRecentPublish:'3',CategorySearch:'123',OutStock:'1'};
   if(!url.searchParams.has('KeyPublisher')||Object.entries(expected).some(([k,v])=>url.searchParams.get(k)!==v))return html('<p>Lost search filters</p>');
  }
  if(/^(?:\d{13}|\d{9}[\dX])$/.test(query)){
   const prefix=`978${query.slice(0,9)}`;
   const canonical=query.length===13?query:prefix+((10-[...prefix].reduce((n,c,i)=>n+Number(c)*(i%2?3:1),0)%10)%10);
   const value=products.get(canonical)??item(canonical);products.set(value.itemId,value);
   return html(searchPage([value],{page,pageSize:25,total:1,stores:url.searchParams.get('SearchTarget')==='UsedStore'}));
  }
  const ns=String(parseInt(createHash('sha256').update(query).digest('hex').slice(0,8),16)%1000000).padStart(6,'0');
  const same=query.startsWith('동일출간일역순검증'), ordered=query.startsWith('권차순서검증');
  const items=(same?[33,32,31,30]:ordered?[1,2,3,4]:[1,2]).map(index=>{
   const isbn13=`978${ns}${String(same?index:page*10+index).padStart(4,'0')}`;
   const value={itemId:isbn13,isbn13,title:same?`츠구모모 ${index}`:`선택 샘플 ${page}-${index}`,author:'테스트 저자',
    description:query==='선택 샘플 1-1'?decodeHTMLStrict('fixture &lt;책&gt; &amp; &#34;설명&#34; &#x1F4DA; &lt;img src=x onerror=alert(1)&gt; &amp;lt;literal&amp;gt; AT&amp;amp;T'):'fixture',priceSales:1000,
    pubDate:same?(index===30?'2026-09-29':'2026-09-30'):ordered?['2026-07-31','2026-05-29','2026-05-29','2026-03-20'][index-1]:new Date(Date.UTC(2025,0,1)-(page*20+index)*86400000).toISOString().slice(0,10)};
   products.set(value.itemId,value);return value;
  });
  return html(searchPage(items,{page,pageSize:items.length,total:same?4:query.startsWith('페이지검증')?20:items.length*2}));
 }
 if(url.pathname==='/shop/wproduct.aspx'){
  const id=url.searchParams.get('ItemId');return html(productPage(products.get(id)??item(id)));
 }
 if(url.pathname.toLowerCase()==='/shop/usedshop/wuseditemall.aspx'){
  await new Promise(r=>setTimeout(r,150));return html(usedPage(url.searchParams.get('ItemId')));
 }
 throw new Error('Unexpected Aladin request in isolated HTML fixture');
};
