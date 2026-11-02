import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseSearchPage, parseProductPage, parseUsedPage, parseStoreSearch, parseBranchPage } from "@/features/aladin/html";
import { aladinItemKey } from "@/features/aladin/item-key";
import { orderByPublicationDate } from "@/features/aladin/volume-order";
const fixture=(name:string)=>readFileSync(new URL(`../fixtures/aladin-html/${name}.html`,import.meta.url),'utf8');
describe('captured public Aladin pages',()=>{
 it('parses exact page/count and excludes recommendation containers',()=>{
  const result=parseSearchPage(fixture('search'),1);
  expect(result).toMatchObject({totalResults:524,pageSize:25,page:1});expect(result.items).toHaveLength(25);
  expect(result.items[0]).toMatchObject({itemId:'253997222',isbn:'8983928204',isbn13:'9788983928207',priceSales:34200,pubDate:'2020-10'});
 });
 it('keeps K product codes out of ISBN fields and selects by product ID',()=>{
  const result=parseSearchPage(fixture('title'),2);
  expect(result.items[0]).toMatchObject({isbn:null,isbn13:null});
  expect(aladinItemKey(result.items[0]!)).toMatch(/^item:\d+$/);
  expect(()=>parseSearchPage(fixture('title'),1)).toThrow();
 });
 it('accepts only a structurally confirmed zero search result',()=>{
  expect(parseSearchPage(fixture('empty'),1).totalResults).toBe(0);
  expect(()=>parseSearchPage('<html><body>점검 중</body></html>',1)).toThrow();
  expect(()=>parseSearchPage(fixture('search').replace('itemid="253997222"',''),1)).toThrow();
 });
 it('extracts exact product ISBN, summary and publication date',()=>{
  expect(parseProductPage(fixture('product'),'208556')).toMatchObject({isbn13:'9780590353427',pubDate:'1999-10-01',priceSales:7300});
  expect(()=>parseProductPage(fixture('product'),'226560')).toThrow();
 });
 it('discovers all offline branches for the exact edition',()=>{
  const result=parseStoreSearch(fixture('used'),'226560',1);
  expect(result.branches.map(b=>b.branch)).toEqual(['Geondae','magok','yatap','suyu']);
  expect(()=>parseStoreSearch(fixture('used'),'208556',1)).toThrow();
 });
 it('parses direct shipping and distinguishes a confirmed zero',()=>{
  expect(parseUsedPage(fixture('positive'),'40869703',2,1).stocks[0]).toMatchObject({branch:'ALADIN_DROPSHIPPING',price:'9,800',grade:'상'});
  expect(parseUsedPage(fixture('direct'),'208556',2,1)).toMatchObject({count:0,pages:0,stocks:[]});
  expect(()=>parseUsedPage(fixture('positive').replace('Ere_used_aladin','private_seller'),'40869703',2,1)).toThrow();
 });
 it('distinguishes advertised store counts from listed online offers',()=>{
  const result=parseUsedPage(fixture('allstores'),'208556',3,1);
  expect(result.count).toBe(29);expect(result.stocks).toHaveLength(15);
 });
 it('keeps only the five official stores from the requested eleven-offer page',()=>{
  const result=parseUsedPage(fixture('unified'),'378768331',0,1);
  expect(result).toMatchObject({count:11,pages:1,privateCount:6,totals:{direct:0,store:5,private:6}});
  expect(result.offers).toHaveLength(11);
  expect(result.stocks.map(s=>s.branchName)).toEqual(['부천점','범계점','천호점','이수역점','신림점']);
  expect(result.stocks.every(s=>s.price==='5,300'&&s.purchaseLink?.includes('/shop/wproduct.aspx?ItemId='))).toBe(true);
 });
 it('parses real first and last pages even when they contain only marketplace sellers',()=>{
  expect(parseUsedPage(fixture('unified-first'),'208556',0,1)).toMatchObject({count:244,pages:12,privateCount:20,stocks:[]});
  expect(parseUsedPage(fixture('unified-last'),'208556',0,12)).toMatchObject({count:244,pages:12,privateCount:11,stocks:[]});
 });
 it('rejects unknown seller markup, damaged official stores and missing pagination',()=>{
  const source=fixture('unified');
  for(const html of [source.replace('Ere_used_power','unknown_seller'),source.replace('SC=284872','SC=broken'),source.replaceAll('Ere_store_name','missing_store'),source.replaceAll('nright_text','missing_pages')]){
   expect(()=>parseUsedPage(html,'378768331',0,1)).toThrow();
  }
 });
 it('verifies branch totals against all condition groups',()=>{
  const branch={branch:'Geondae',branchName:'건대점',link:'https://www.aladin.co.kr/usedstore/wproduct.aspx?ItemId=208556&OffCode=Geondae'};
  expect(parseBranchPage(fixture('branch'),branch,'책')).toMatchObject([{grade:'중',price:'4,600'}]);
  expect(()=>parseBranchPage(fixture('branch').replace('1부','2부'),branch,'책')).toThrow();
 });
 it('orders month-precision dates without inventing stored days',()=>{
  const items=[{title:'권 10',pubDate:'2026-09'},{title:'권 2',pubDate:'2026-09'},{title:'권 1',pubDate:'2026-08'}];
  expect(orderByPublicationDate(items).map(i=>i.title)).toEqual(['권 1','권 2','권 10']);
  expect(items[0]!.pubDate).toBe('2026-09');
 });
});
