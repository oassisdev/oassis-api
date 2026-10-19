import {expect,it,vi} from 'vitest';
import {Hono} from 'hono';
import {createRequire} from 'node:module';
import {readFileSync,readdirSync} from 'node:fs';
import {billing} from '../src/billing';
import type {Env} from '../src/types';
const {DatabaseSync}=createRequire(import.meta.url)('node:sqlite');
const tx='0x'+'cd'.repeat(32);
vi.mock('../src/billing/x402',()=>({x402:()=>async(c:any,next:any)=>{
 await next();
 if(c.req.header('x-test-settle')==='fail')return c.json({error:'settlement_failed'},402);
 if(c.res.status<400)c.header('payment-response',btoa(JSON.stringify({success:true,transaction:'0x'+'cd'.repeat(32)})));
 // The real adapter updates c.res and returns undefined.
}}));
it('records wallet charges only after successful settlement and retains the receipt on retry',async()=>{
 const sql=new DatabaseSync(':memory:');
 for(const file of readdirSync('migrations').filter(f=>f.endsWith('.sql')).sort())sql.exec(readFileSync('migrations/'+file,'utf8'));
 const wrap=(query:string,args:unknown[]=[])=>({bind:(...values:unknown[])=>wrap(query,values),first:async()=>sql.prepare(query).get(...args)||null,run:async()=>({meta:sql.prepare(query).run(...args)})});
 const env={BILLING:{prepare:wrap}} as unknown as Env;
 const app=new Hono<{Bindings:Env}>();app.use(billing);app.post('/web/v1/map',c=>{
  expect(sql.prepare('SELECT count(*) n FROM transactions').get().n).toBe(c.req.header('x-test-retry')?1:0);
  return c.json({success:true},c.req.header('x-test-handler')==='fail'?400:200);
 });
 const request=(extra:Record<string,string>={})=>app.request('/web/v1/map',{method:'POST',headers:{'content-type':'application/json','payment-signature':btoa(JSON.stringify({payload:{authorization:{from:'0x'+'12'.repeat(20)}}})),...extra},body:JSON.stringify({url:'https://example.com',includePage:false})},env);
 try{
  expect((await request({'x-test-settle':'fail'})).status).toBe(402);expect(sql.prepare('SELECT count(*) n FROM transactions').get().n).toBe(0);
  expect((await request({'x-test-handler':'fail'})).status).toBe(400);expect(sql.prepare('SELECT count(*) n FROM transactions').get().n).toBe(0);
  expect((await request()).status).toBe(200);expect(sql.prepare('SELECT reference FROM transactions').get().reference).toBe(tx);
  expect((await request({'x-test-retry':'1'})).status).toBe(200);expect(sql.prepare('SELECT count(*) n FROM transactions').get().n).toBe(1);
 }finally{sql.close();}
});
