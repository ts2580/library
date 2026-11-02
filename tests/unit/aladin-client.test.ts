import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
vi.mock("server-only",()=>({}));
const state=vi.hoisted(()=>({env:{dataDir:'',ALADIN_PAGE_INTERVAL_MS:0,ALADIN_INITIAL_BACKOFF_MS:1,ALADIN_MAX_BACKOFF_MS:5,ALADIN_MAX_ATTEMPTS:1}}));
vi.mock("@/lib/env",()=>({env:state.env}));
const {aladinHtml}=await import('@/features/aladin/client');
const {withRequestGate}=await import('@/features/aladin/request-gate');
beforeEach(()=>{state.env.dataDir=mkdtempSync(path.join(tmpdir(),'aladin-client-'));state.env.ALADIN_MAX_ATTEMPTS=1;vi.stubGlobal('fetch',vi.fn());});
afterEach(()=>{vi.unstubAllGlobals();rmSync(state.env.dataDir,{recursive:true,force:true});});
const url='https://www.aladin.co.kr/search/wsearchresult.aspx?SearchWord=test';
describe('public HTML transport',()=>{
 it.each(['https://example.com/','https://www.aladin.co.kr@evil.test/','https://www.aladin.co.kr:444/','https://www.aladin.co.kr/ttb/api/ItemSearch.aspx'])('rejects unsafe or retired endpoint %s',async address=>{
  await expect(aladinHtml(address)).rejects.toMatchObject({code:'ALADIN_INVALID_URL'});expect(fetch).not.toHaveBeenCalled();
 });
 it('does not retry a 200 XML shutdown response',async()=>{
  state.env.ALADIN_MAX_ATTEMPTS=3;
  vi.mocked(fetch).mockResolvedValue(new Response('<error>999</error>',{headers:{'content-type':'text/xml'}}));
  await expect(aladinHtml(url)).rejects.toMatchObject({code:'ALADIN_FORMAT_CHANGED'});expect(fetch).toHaveBeenCalledTimes(1);
 });
 it('rejects oversized streamed content and releases the gate after failure',async()=>{
  vi.mocked(fetch).mockResolvedValueOnce(new Response('x'.repeat(4*1024*1024+1),{headers:{'content-type':'text/html'}}))
    .mockResolvedValueOnce(new Response('<html>ok</html>',{headers:{'content-type':'text/html'}}));
  await expect(aladinHtml(url)).rejects.toMatchObject({code:'ALADIN_FORMAT_CHANGED'});
  expect(await aladinHtml(url)).toBe('<html>ok</html>');
 });
 it('shares Retry-After cooldown and never immediately requests again',async()=>{
  vi.mocked(fetch).mockResolvedValue(new Response('',{status:429,headers:{'retry-after':'60'}}));
  await expect(aladinHtml(url)).rejects.toMatchObject({code:'ALADIN_RATE_LIMIT'});
  await expect(aladinHtml(url)).rejects.toMatchObject({code:'ALADIN_RATE_LIMIT'});
  expect(fetch).toHaveBeenCalledTimes(1);
 });
 it('retries transient network errors and sends no credentials or redirects',async()=>{
  state.env.ALADIN_MAX_ATTEMPTS=2;
  vi.mocked(fetch).mockRejectedValueOnce(new TypeError('network')).mockResolvedValueOnce(new Response('<html>ok</html>',{headers:{'content-type':'text/html'}}));
  expect(await aladinHtml(url)).toBe('<html>ok</html>');
  expect(fetch).toHaveBeenLastCalledWith(expect.any(URL),expect.objectContaining({redirect:'error',headers:{'user-agent':'Bookshelf/4.0',accept:'text/html,application/xhtml+xml'}}));
 });
 it('does not retry an access denial',async()=>{
  state.env.ALADIN_MAX_ATTEMPTS=3;vi.mocked(fetch).mockResolvedValue(new Response('',{status:403}));
  await expect(aladinHtml(url)).rejects.toMatchObject({code:'ALADIN_HTTP_ERROR'});expect(fetch).toHaveBeenCalledTimes(1);
 });
 it('spaces starts of independent processes using the same sidecar',async()=>{
  const run=promisify(execFile);
  const runs=await Promise.all([1,2,3].map(()=>run(process.execPath,['--import','tsx','tests/fixtures/aladin-gate-child.ts',path.join(state.env.dataDir,'shared.sqlite')])));
  const spans=runs.map(r=>JSON.parse(r.stdout) as {start:number;end:number}).sort((a,b)=>a.start-b.start);
  for(let i=1;i<spans.length;i++){expect(spans[i]!.start-spans[i-1]!.start).toBeGreaterThanOrEqual(75);expect(spans[i]!.start).toBeGreaterThanOrEqual(spans[i-1]!.end);}
 });
 it('shares ten concurrent slots across independent processes',async()=>{
  const run=promisify(execFile);
  const filename=path.join(state.env.dataDir,'parallel.sqlite');
  const results=await Promise.all([1,2].map(()=>run(process.execPath,['--import','tsx','tests/fixtures/aladin-gate-parallel-child.ts',filename,'normal'])));
  const spans=results.flatMap(result=>JSON.parse(result.stdout) as Array<{start:number;end:number}>).sort((a,b)=>a.start-b.start);
  expect(spans).toHaveLength(12);
  const events=spans.flatMap(span=>[{time:span.start,delta:1},{time:span.end,delta:-1}]).sort((a,b)=>a.time-b.time||a.delta-b.delta);
  let active=0,peak=0;
  for(const event of events){active+=event.delta;peak=Math.max(peak,active);}
  expect(peak).toBeGreaterThan(1);expect(peak).toBeLessThanOrEqual(10);
  for(let i=1;i<spans.length;i++)expect(spans[i]!.start-spans[i-1]!.start).toBeGreaterThanOrEqual(18);
 });
 it('releases every concurrency slot after a process crash',async()=>{
  const filename=path.join(state.env.dataDir,'crash.sqlite');
  const child=spawn(process.execPath,['--import','tsx','tests/fixtures/aladin-gate-parallel-child.ts',filename,'crash'],{stdio:['ignore','pipe','pipe']});
  const exited=new Promise<void>(resolve=>child.once('exit',()=>resolve()));
  let output='';child.stdout.on('data',chunk=>{output+=String(chunk);});
  try{
   await vi.waitFor(()=>expect(output).toContain('ready'),{timeout:5000});
   child.kill('SIGKILL');await exited;
   await expect(withRequestGate(filename,0,async()=> 'recovered')).resolves.toBe('recovered');
  }finally{child.kill('SIGKILL');await exited;}
 });
});
