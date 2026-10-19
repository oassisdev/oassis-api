import {expect,it,vi} from 'vitest';
import {createRequire} from 'node:module';
import {readFileSync,readdirSync} from 'node:fs';
import {startPublicTask,publicTask} from '../src/agent/public-access';
import {agentRoutes} from '../src/agent/routes';
import {mcp} from '../src/mcp';
import type {Env} from '../src/types';
const {DatabaseSync}=createRequire(import.meta.url)('node:sqlite');
vi.mock('../src/billing/x402',()=>({x402:()=>async(c:any,next:any)=>{
 if(!c.req.header('payment-signature'))return c.json({error:'payment_required'},402);
 await next();
 if(c.req.header('x-test-settle')==='fail')return c.json({error:'settlement_failed'},503);
 c.header('payment-response',btoa(JSON.stringify({success:true,transaction:'0x'+'ab'.repeat(32),network:'eip155:8453'})));
 return c.res;
}}));
function setup(){
 const db=new DatabaseSync(':memory:');
 const dir=new URL('../migrations/',import.meta.url);for(const f of readdirSync(decodeURIComponent(dir.pathname)).filter(f=>f.endsWith('.sql')).sort())db.exec(readFileSync(decodeURIComponent(new URL(f,dir).pathname),'utf8'));
 const kicks:string[]=[];
 const wrap=(sql:string,args:any[]=[])=>({bind:(...v:any[])=>wrap(sql,v),first:async()=>db.prepare(sql).get(...args)||null,all:async()=>({results:db.prepare(sql).all(...args)}),run:async()=>({meta:{changes:Number(db.prepare(sql).run(...args).changes)}})});
 const env={BASE_URL:'https://api.oassis.dev',BILLING:{prepare:wrap,batch:async(xs:any[])=>{db.exec('BEGIN');try{const out=[];for(const x of xs)out.push(await x.run());db.exec('COMMIT');return out;}catch(e){db.exec('ROLLBACK');throw e;}}},AGENT_TASKS:{idFromName:(id:string)=>id,get:()=>({fetch:async(url:string)=>{kicks.push(url);return new Response('{}');}})}} as unknown as Env;
 return {db,env,kicks};
}
const body={task:'Compare public hosting providers',urls:['https://example.com']};
it('MCP tasks require an API key and never run against anonymous execution balances',async()=>{
 const {db,env}=setup();
 const r=await mcp.request('/mcp',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'web_task_start',arguments:body}})},env);
 const result=await r.json() as any;expect(result.result.isError).toBe(true);expect(result.result.content[0].text).toContain('api_key_required');expect(db.prepare('SELECT COUNT(*) n FROM agent_tasks').get().n).toBe(0);
});
it('task tokens authorize status and cancellation; API keys never do',async()=>{
 const {env}=setup();const r=await startPublicTask(env,body,'mcp');expect(r.ok).toBe(true);if(!r.ok)return;
 expect((await publicTask(env,r.taskId,'oas_invalid')).status).toBe(401);
 expect((await publicTask(env,r.taskId,r.accessToken,true)).status).toBe(202);
});
it('start rejects malformed input and supports an idempotent retry with the same task token',async()=>{
 const {env}=setup();expect((await startPublicTask(env,{},'mcp')).ok).toBe(false);
 const r=await startPublicTask(env,body,'mcp',undefined,'retry');if(!r.ok)throw Error(r.error.message);
 const retry=await startPublicTask(env,body,'mcp',r.accessToken,'retry');expect(retry.ok&&retry.taskId).toBe(r.taskId);
 const conflict=await startPublicTask(env,{...body,task:'Different research request'},'mcp',r.accessToken,'retry');expect(conflict.ok).toBe(false);
});
const payment=btoa(JSON.stringify({payload:{authorization:{from:'0x1111111111111111111111111111111111111111'}}}));
it('HTTP tasks issue 402 without keys and start only after x402 settlement',async()=>{
 const {env,db,kicks}=setup();
 const request={method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)};
 expect((await agentRoutes.request('/tasks/v1/research',request,env)).status).toBe(402);expect(kicks).toHaveLength(0);
 const r=await agentRoutes.request('/tasks/v1/research',{...request,headers:{...request.headers,'payment-signature':payment}},env);expect(r.status).toBe(202);const p=await r.json() as any;expect(p.access_token).toBeTruthy();expect(kicks.filter(x=>x.endsWith('/start'))).toHaveLength(1);
 expect(db.prepare("SELECT COUNT(*) n FROM transactions WHERE account LIKE 'wallet:%'").get().n).toBe(1);
 const status=await agentRoutes.request('/tasks/v1/research/'+p.task_id,{headers:{'Task-Token':p.access_token}},env);expect(status.status).toBe(200);expect((await status.json() as any).billing.paid).toBe('$0.1');

 const again=await agentRoutes.request('/tasks/v1/research',{...request,headers:{...request.headers,'Task-Token':p.access_token,'Idempotency-Key':'new-key'}},env);expect(again.status).toBe(409);
});
it('failed settlement never starts the task or records a paid transaction',async()=>{
 const {env,db,kicks}=setup();const r=await agentRoutes.request('/tasks/v1/research',{method:'POST',headers:{'content-type':'application/json','payment-signature':payment,'x-test-settle':'fail'},body:JSON.stringify(body)},env);expect(r.status).toBe(503);expect(kicks.some(x=>x.endsWith('/start'))).toBe(false);expect(db.prepare("SELECT COUNT(*) n FROM transactions WHERE account LIKE 'wallet:%'").get().n).toBe(0);
});
