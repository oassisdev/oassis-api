import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync,readdirSync } from 'node:fs';
import type { Env } from '../src/types';
import { hashKey } from '../src/billing/accounts';

// The real Worker router and billing run here; browsers and asynchronous execution are stubs.
vi.mock('../src/session/do',()=>({BrowserSession:class {}}));
vi.mock('../src/jobs/do',()=>({BatchJob:class {}}));
vi.mock('../src/jobs/crawl',()=>({CrawlJob:class {}}));
vi.mock('../src/agent/do',()=>({AgentTask:class {}}));
vi.mock('../src/billing/x402',()=>({x402:()=>async(c:any)=>c.json({error:'payment_required'},402)}));
const {default:worker}=await import('../src/index');
const {DatabaseSync}=createRequire(import.meta.url)('node:sqlite');
let sql:any,env:Env;
const key='oas_routeowner';
beforeEach(async()=>{
 sql=new DatabaseSync(':memory:');
 for(const file of readdirSync('migrations').filter(f=>f.endsWith('.sql')).sort())sql.exec(readFileSync('migrations/'+file,'utf8'));
 const wrap=(query:string,args:unknown[]=[])=>({bind:(...values:unknown[])=>wrap(query,values),first:async()=>sql.prepare(query).get(...args)||null,all:async()=>({results:sql.prepare(query).all(...args)}),run:async()=>({meta:sql.prepare(query).run(...args)})});
 const jobs={newUniqueId:()=>({toString:()=> 'job-id'}),idFromString:(id:string)=>id,get:()=>({fetch:async(_url:string,options:RequestInit)=>Response.json({status:'ok',message:JSON.parse(String(options.body))})})};
 env={BASE_URL:'https://api.oassis.dev',BILLING:{prepare:wrap},JOBS:jobs,CRAWLS:jobs} as unknown as Env;
 sql.prepare('INSERT INTO accounts(id,created_at,balance_micros) VALUES(?,?,?)').run('owner',Date.now(),1_000_000);
 sql.prepare('INSERT INTO accounts(id,created_at,balance_micros) VALUES(?,?,?)').run('other',Date.now(),1_000_000);
 sql.prepare('INSERT INTO api_keys(hash,account,prefix,created_at) VALUES(?,?,?,?)').run(await hashKey(key),'owner','owner',Date.now());
 sql.prepare('INSERT INTO api_keys(hash,account,prefix,created_at) VALUES(?,?,?,?)').run(await hashKey('oas_other'),'other','other',Date.now());
});
afterEach(()=>sql.close());
const request=(path:string,method='GET',body?:unknown,token?:string)=>worker.fetch(new Request('https://api.oassis.dev'+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})}),env);

it('rejects every retired URL and cancellation variant with 404, without charging',async()=>{
 for(const path of ['/v1/scrape','/v1/account','/v1/feedback','/web/v1/crawl','/web/v1/scrape/batch','/agent/v1/tasks','/agent/v1/tasks/id','/web/v1/crawl/id','/web/v1/scrape/batch/id']){
  for(const method of ['GET','POST'])expect((await request(path,method,method==='POST'?{}:undefined,key)).status,path).toBe(404);
 }
 for(const path of ['/tasks/v1/crawl/id','/tasks/v1/scrape/batch/id','/agents/v1/services/id'])expect((await request(path,'DELETE',undefined,key)).status,path).toBe(404);
 expect(sql.prepare('SELECT COUNT(*) n FROM prepaid_debits').get().n).toBe(0);
});

it('guards extraction starts on their final paths, charging exactly once per accepted job',async()=>{
 const body={urls:['https://example.com/a','https://example.com/b'],formats:['markdown']};
 expect((await request('/tasks/v1/scrape/batch','POST',body)).status).toBe(402);
 expect((await request('/tasks/v1/scrape/batch','POST',body,'oas_wrong')).status).toBe(401);
 expect((await request('/tasks/v1/scrape/batch','POST',body,key)).status).toBe(200);
 expect(sql.prepare('SELECT balance_micros FROM accounts WHERE id=?').get('owner').balance_micros).toBe(996000);
 expect(sql.prepare('SELECT COUNT(*) n FROM prepaid_debits').get().n).toBe(1);
 expect((await request('/tasks/v1/research','POST',{},'oas_wrong')).status).toBe(401);
});

it('only the owner can collect or cancel extraction jobs and cancellation is free',async()=>{
 for(const [path,gate] of [['scrape/batch','key'],['crawl','key']]){
  sql.prepare('INSERT OR REPLACE INTO jobs(id,account,gate,created_at,urls,charged_micros) VALUES(?,?,?,?,?,?)').run('job-id','owner',gate,Date.now(),2,4000);
  expect((await request('/tasks/v1/'+path+'/job-id','GET',undefined,key)).status).toBe(200);
  expect((await request('/tasks/v1/'+path+'/job-id/cancel','POST',{},key)).status).toBe(200);
  expect((await request('/tasks/v1/'+path+'/job-id/cancel','POST',{},'oas_other')).status).toBe(404);
 }
 expect(sql.prepare('SELECT COUNT(*) n FROM prepaid_debits').get().n).toBe(0);
});

it('lists only owned services and explicitly cancels an agent registration without losing its report',async()=>{
 expect((await request('/agents/v1')).status).toBe(200);
 expect((await request('/agents/v1/services')).status).toBe(401);
 const created=await request('/agents/v1/price-watch','POST',{urls:['https://shop.example.com/item']},key);expect(created.status).toBe(202);
 const data=await created.json() as any;const id=data.service.id;
 sql.prepare('UPDATE agent_services SET last_report=? WHERE id=?').run(JSON.stringify({summary:'retained report'}),id);
 expect((await (await request('/agents/v1/services','GET',undefined,key)).json() as any).services).toHaveLength(1);
 expect((await (await request('/agents/v1/services','GET',undefined,'oas_other')).json() as any).services).toHaveLength(0);
 expect((await request('/agents/v1/services/'+id+'/cancel','POST',{},'oas_other')).status).toBe(404);
 expect((await request('/agents/v1/services/'+id+'/cancel','POST',{},key)).status).toBe(200);
 expect((await request('/agents/v1/services/'+id+'/cancel','POST',{},key)).status).toBe(200);
 const out=await (await request('/agents/v1/services/'+id,'GET',undefined,key)).json() as any;
 expect(out.service.status).toBe('cancelled');expect(out.service.next_run_at).toBeNull();expect(out.service.last_report.summary).toBe('retained report');
});

it('publishes every definitive family and its cancellations without retired paths',async()=>{
 const response=await request('/openapi.json');expect(response.status).toBe(200);const spec=await response.json() as any;
 for(const path of ['/tasks/v1/research/{id}/cancel','/tasks/v1/crawl/{id}/cancel','/tasks/v1/scrape/batch/{id}/cancel','/agents/v1/services/{id}/cancel'])expect(spec.paths[path]?.post,path).toBeDefined();
 for(const path of Object.keys(spec.paths))expect(path).not.toMatch(/^\/v1\/|^\/agent\/|^\/web\/v1\/(?:crawl|scrape\/batch)/);
 const catalog=await (await request('/')).json() as any;expect(catalog.endpoints).toContain('POST /agents/v1/services/:id/cancel');expect(catalog.endpoints).toContain('POST /tasks/v1/crawl/{id}/cancel');
});

it('closes only an owned session with POST /close, with no DELETE alias or extra debit',async()=>{
 const calls:unknown[]=[];
 (env as any).SESSIONS={idFromString:(id:string)=>id,get:(id:string)=>({fetch:async(_url:string,options:RequestInit)=>{
  calls.push(JSON.parse(String(options.body)));sql.prepare('UPDATE sessions SET closed_at=? WHERE id=?').run(Date.now(),id);return Response.json({sessionId:id,closed:true});
 }})};
 sql.prepare('INSERT INTO sessions(id,account,gate,opened_at) VALUES(?,?,?,?)').run('close-test','owner','key',Date.now());
 for(const method of ['DELETE','POST'])expect((await request('/web/v1/session/close-test',method,undefined,key)).status).toBe(404);
 expect((await request('/web/v1/session/close-test/close','DELETE',undefined,key)).status).toBe(404);
 expect((await request('/web/v1/session/close-test/close','POST')).status).toBe(404);
 expect((await request('/web/v1/session/close-test/close','POST',undefined,'oas_other')).status).toBe(404);
 expect((await request('/web/v1/session/close-test/close','POST',undefined,'oas_wrong')).status).toBe(401);expect(calls).toEqual([]);
 const r=await request('/web/v1/session/close-test/close','POST',undefined,key);expect(r.status).toBe(200);expect(await r.json()).toMatchObject({sessionId:'close-test',closed:true});expect(calls).toEqual([{kind:'close'}]);
 expect(sql.prepare('SELECT COUNT(*) n FROM prepaid_debits').get().n).toBe(0);
 expect((await request('/web/v1/session/close-test/close','POST',undefined,key)).status).toBe(404);
 const spec=await (await request('/openapi.json')).json() as any;expect(spec.paths['/web/v1/session/{id}/close'].post.operationId).toBe('web_session_close');expect(spec.paths['/web/v1/session/{id}']).toBeUndefined();
 const catalog=await (await request('/')).json() as any;expect(catalog.endpoints).toContain('POST /web/v1/session/{id}/close');expect(catalog.endpoints).not.toContain('DELETE /web/v1/session/:id');
});
