import { it,expect,beforeEach,afterEach,vi } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync,readdirSync } from 'node:fs';
import { Hono } from 'hono';
import type { Env } from '../src/types';
import { mountSiteAuth } from '../src/site-auth';
import { mountSitePayments } from '../src/site-payments';
import { fulfill,validSignature,automaticTopups,stripeReady } from '../src/billing/stripe';
import { settleTask } from '../src/agent/billing';
import { billing } from '../src/billing';
const {DatabaseSync}=createRequire(import.meta.url)('node:sqlite');
let sql:any,env:Env,app:Hono<{Bindings:Env}>,cookie:string,user:string;
beforeEach(async()=>{
 cookie='';sql=new DatabaseSync(':memory:');
 for(const file of readdirSync('migrations').filter(f=>f.endsWith('.sql')).sort())sql.exec(readFileSync('migrations/'+file,'utf8'));
 const prepare=(query:string)=>{const make=(args:any[])=>({bind:(...a:any[])=>make(a),all:async()=>({results:sql.prepare(query).all(...args),meta:{changes:1,last_row_id:0}}),first:async()=>sql.prepare(query).get(...args)||null,run:async()=>({meta:sql.prepare(query).run(...args)}),_run:()=>{const q=sql.prepare(query);return q.columns().length?{results:q.all(...args),meta:{changes:0,last_row_id:0}}:{results:[],meta:q.run(...args)};}});return make([]);};
 env={AUTH_SECRET:'test-random-long-secret-12345678901234567890',STRIPE_SECRET_KEY:'sk_live_fake',STRIPE_WEBHOOK_SECRET:'whsec_test',STRIPE_PAYMENTS_ENABLED:'true',BILLING:{prepare,batch:async(statements:any[])=>{sql.exec('BEGIN');try{const r=statements.map(s=>s._run());sql.exec('COMMIT');return r;}catch(e){sql.exec('ROLLBACK');throw e;}},exec:async(q:string)=>sql.exec(q)}} as unknown as Env;
 app=new Hono<{Bindings:Env}>();mountSiteAuth(app);mountSitePayments(app);app.use(billing);app.post('/web/v1/map',c=>c.json({ok:true}));
 const signup=await req('/api/auth/sign-up/email',{email:'test@example.com',name:'Test',password:'long-password-12345678'});
 cookie=signup.headers.get('set-cookie')!.split(';')[0]!;user=sql.prepare('SELECT id FROM site_user').get().id;sql.prepare('UPDATE site_user SET emailVerified=1').run();
 await req('/api/billing/status');
});
afterEach(()=>{vi.restoreAllMocks();sql.close();});
async function req(path:string,body?:unknown,headers:Record<string,string>={}){return app.fetch(new Request('https://oassis.dev'+path,{method:body?'POST':'GET',headers:{cookie:cookie||'',origin:'https://oassis.dev',...(body?{'content-type':'application/json'}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})}),env);}
function seedOrder(id='order1',cents=500){sql.prepare('UPDATE site_billing SET customer=? WHERE user_id=?').run('cus_test',user);sql.prepare("INSERT INTO billing_orders(id,user_id,cents,created_at,kind) VALUES(?,?,?,?,'manual')").run(id,user,cents,Date.now());}
const paid=(id='order1')=>({id:'pi_'+id,metadata:{oassis_order:id},currency:'usd',amount_received:500,customer:'cus_test',status:'succeeded'});
it('starts with zero balance and disables card payments without live activation',async()=>{env.STRIPE_PAYMENTS_ENABLED=undefined;expect(stripeReady(env)).toBe(false);const page=await req('/dashboard/billing');expect(page.status).toBe(200);expect(await page.text()).toContain('awaiting Stripe configuration');expect((await req('/api/billing/checkout',{cents:500,saveCard:false,requestId:crypto.randomUUID()})).status).toBe(503);});
it('credits once across duplicate webhooks and rejects mismatched amounts',async()=>{seedOrder();await fulfill(env,paid());await fulfill(env,paid());expect(sql.prepare('SELECT balance_micros FROM accounts WHERE id=?').get('site:'+user).balance_micros).toBe(7e6);expect(sql.prepare("SELECT count(*) n FROM transactions WHERE concept='Stripe top-up'").get().n).toBe(1);seedOrder('bad');await expect(fulfill(env,{...paid('bad'),amount_received:1})).rejects.toThrow();});
it('never credits a redirect or a forged webhook',async()=>{seedOrder();await req('/dashboard/billing?checkout=success');expect(sql.prepare('SELECT balance_micros FROM accounts WHERE id=?').get('site:'+user).balance_micros).toBe(2e6);expect((await req('/api/billing/webhook',{type:'payment_intent.succeeded',data:{object:paid()}})).status).toBe(400);});
it('verifies signed raw bodies and rejects expired signatures',async()=>{const raw='{"test":true}',timestamp=String(Math.floor(Date.now()/1000));const key=await crypto.subtle.importKey('raw',new TextEncoder().encode('secret'),{name:'HMAC',hash:'SHA-256'},false,['sign']);const bytes=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(timestamp+'.'+raw));const hash=Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');expect(await validSignature(raw,'t='+timestamp+',v1='+hash,'secret')).toBe(true);expect(await validSignature(raw+' ','t='+timestamp+',v1='+hash,'secret')).toBe(false);expect(await validSignature(raw,'t='+timestamp+',v1='+hash,'secret',Date.now()+600000)).toBe(false);});
it('charges the authenticated balance atomically and stops at insufficient funds',async()=>{seedOrder();await fulfill(env,paid());const headers={'x-oassis-payment':'balance'};const r=await req('/web/v1/map',{url:'https://example.com',includePage:false},headers);expect(r.status).toBe(200);expect(sql.prepare('SELECT balance_micros FROM accounts WHERE id=?').get('site:'+user).balance_micros).toBe(6998000);sql.prepare('UPDATE accounts SET balance_micros=0').run();expect((await req('/web/v1/map',{url:'https://example.com'},headers)).status).toBe(402);expect(sql.prepare('SELECT count(*) n FROM prepaid_debits').get().n).toBe(1);});
it('prevents cross-origin and anonymous spending',async()=>{expect((await req('/web/v1/map',{url:'https://example.com'},{'x-oassis-payment':'balance',origin:'https://evil.example'})).status).toBe(401);expect((await req('/api/billing/status',undefined,{cookie:''})).status).toBe(401);});
it('refuses automatic payments without a saved card and enforces the monthly cap',async()=>{const settings={enabled:true,cents:500,threshold:100,monthlyCap:500};expect((await req('/api/billing/automatic',settings)).status).toBe(409);sql.prepare('UPDATE site_billing SET customer=?,payment_method=?').run('cus_test','pm_test');expect((await req('/api/billing/automatic',settings)).status).toBe(409);sql.prepare('UPDATE site_billing SET auto_enabled=1,monthly_cap_cents=500').run();const fetch=vi.spyOn(globalThis,'fetch').mockImplementation(async(input)=>{const order=sql.prepare("SELECT id FROM billing_orders WHERE kind='auto'").get();if(String(input).endsWith('/pay'))return Response.json({id:'in_test',metadata:{oassis_order:order.id},customer:'cus_test',currency:'usd',subtotal:500,amount_paid:500,status:'paid',payment_intent:'pi_auto',hosted_invoice_url:'https://invoice.stripe.com/test'});return Response.json({id:'in_test'});});await automaticTopups(env);sql.prepare('UPDATE accounts SET balance_micros=0').run();await automaticTopups(env);expect(fetch).toHaveBeenCalledTimes(4);expect(sql.prepare("SELECT count(*) n FROM billing_orders WHERE kind='auto'").get().n).toBe(1);});
it('refund events only deduct the additional cumulative amount',async()=>{seedOrder();await fulfill(env,paid());sql.prepare('INSERT INTO billing_refunds VALUES(?,?,?,?)').run('pi_order1',user,100,Date.now());sql.prepare('UPDATE billing_refunds SET cents=100').run();expect(sql.prepare('SELECT balance_micros FROM accounts WHERE id=?').get('site:'+user).balance_micros).toBe(6e6);sql.prepare('UPDATE billing_refunds SET cents=300').run();expect(sql.prepare('SELECT balance_micros FROM accounts WHERE id=?').get('site:'+user).balance_micros).toBe(4e6);});

it('reserves a task maximum once, isolates its status and settles only the actual cost',async()=>{
 seedOrder();await fulfill(env,paid());
 const body={task:'Research the public documentation of example.com',limits:{max_cost_usd:0.1}};
 const headers={'idempotency-key':'task-test-1'};
 const first=await req('/api/billing/tasks',body,headers);expect(first.status).toBe(202);const started=await first.json() as any;
 const again=await req('/api/billing/tasks',body,headers);expect((await again.json() as any).taskId).toBe(started.taskId);
 expect(sql.prepare('SELECT reserved_micros FROM accounts WHERE id=?').get('site:'+user).reserved_micros).toBe(100000);
 expect((await req(started.location)).status).toBe(200);
 expect((await req(started.location,undefined,{cookie:''})).status).toBe(401);
 const task=sql.prepare('SELECT document FROM agent_tasks WHERE id=?').get(started.taskId);
 const settlement={taskId:started.taskId,account:'site:'+user,spentMicros:2000,now:Date.now(),finalStatus:'cancelled',finishedAt:Date.now(),document:task.document,errorCode:null,errorMessage:null};
 await settleTask(env.BILLING,settlement);await settleTask(env.BILLING,settlement);
 const account=sql.prepare('SELECT balance_micros,reserved_micros FROM accounts WHERE id=?').get('site:'+user);
 expect(account.balance_micros).toBe(6998000);expect(account.reserved_micros).toBe(0);
});
it('processes a signed live webhook once and ignores signed test-mode payments',async()=>{
 seedOrder();
 async function deliver(livemode:boolean){const event={id:'evt_test',livemode,type:'payment_intent.succeeded',data:{object:paid()}};const raw=JSON.stringify(event),timestamp=String(Math.floor(Date.now()/1000));const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(env.STRIPE_WEBHOOK_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign']);const signature=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(timestamp+'.'+raw));return req('/api/billing/webhook',event,{'stripe-signature':'t='+timestamp+',v1='+Array.from(new Uint8Array(signature),b=>b.toString(16).padStart(2,'0')).join('')});}
 expect((await deliver(false)).status).toBe(200);expect(sql.prepare('SELECT balance_micros FROM accounts').get().balance_micros).toBe(2000000);
 expect((await deliver(true)).status).toBe(200);expect((await deliver(true)).status).toBe(200);
 expect(sql.prepare('SELECT balance_micros FROM accounts').get().balance_micros).toBe(7000000);
});

it('grants welcome credits once per verified account and shares them across revocable keys',async()=>{
 const first=await req('/api/billing/keys',{label:'Agent one'});expect(first.status).toBe(201);const one=await first.json() as any;
 const second=await req('/api/billing/keys',{label:'Agent two'});const two=await second.json() as any;
 await req('/api/billing/status');
 expect(sql.prepare('SELECT balance_micros FROM accounts WHERE id=?').get('site:'+user).balance_micros).toBe(2000000);
 expect(sql.prepare('SELECT hash FROM api_keys').get().hash).not.toContain(one.key);
 const request=(key:string)=>app.fetch(new Request('https://api.oassis.dev/web/v1/map',{method:'POST',headers:{authorization:'Bearer '+key,'content-type':'application/json'},body:JSON.stringify({url:'https://example.com',includePage:false})}),env);
 expect((await request(one.key)).status).toBe(200);expect((await request(two.key)).status).toBe(200);
 expect(sql.prepare('SELECT balance_micros FROM accounts WHERE id=?').get('site:'+user).balance_micros).toBe(1996000);
 const status=await req('/api/billing/status');const data=await status.json() as any;expect(data.credits.available).toBe(998);expect(JSON.stringify(data)).not.toContain(one.key);
 await req('/api/billing/keys/revoke',{prefix:one.prefix});expect((await request(one.key)).status).toBe(401);expect((await request(two.key)).status).toBe(200);
});

it('trial usage is atomic, cannot reconnect for more credit, and refunds only unused work',async()=>{
 const {takeTrial,refundTrial,trialIdentity}=await import('../src/billing/trial');
 const identity=await trialIdentity(env,new Headers({'cf-connecting-ip':'203.0.113.5'}));expect(identity).toBeTruthy();expect(identity).not.toContain('203.0.113.5');
 const results=await Promise.all(Array.from({length:110},()=>takeTrial(env,identity!,2000)));
 expect(results.filter(Boolean)).toHaveLength(100);expect(await takeTrial(env,identity!,2000)).toBe(false);
 expect(await trialIdentity(env,new Headers({'cf-connecting-ip':'203.0.113.5','mcp-session-id':'different','user-agent':'Another client'}))).toBe(identity);
 await refundTrial(env,identity!,2000);expect(await takeTrial(env,identity!,2000)).toBe(true);expect(await takeTrial(env,identity!,2000)).toBe(false);
});

it('MCP trial runs map, requests a key after exhaustion, and never runs expensive tools anonymously',async()=>{
 const {mcp}=await import('../src/mcp');
 vi.spyOn(globalThis,'fetch').mockImplementation(async(input)=>new Response(String(input).endsWith('robots.txt')?'User-agent: *\nAllow: /':'<urlset><url><loc>https://example.com/a</loc></url></urlset>'));
 async function call(name:string,args:unknown,auth?:string){const r=await mcp.request('https://api.oassis.dev/mcp',{method:'POST',headers:{'content-type':'application/json','cf-connecting-ip':'203.0.113.10',...(auth?{authorization:'Bearer '+auth}:{})},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}})},env);return await r.json() as any;}
 const first=await call('web_map',{url:'https://example.com',includePage:false});expect(first.result.isError).not.toBe(true);
 expect(sql.prepare('SELECT spent_micros FROM mcp_trials').get().spent_micros).toBe(2000);
 sql.prepare('UPDATE mcp_trials SET spent_micros=200000').run();
 const exhausted=await call('web_map',{url:'https://example.com',includePage:false});expect(exhausted.result.isError).toBe(true);expect(exhausted.result.content[0].text).toContain('mcp_trial_exhausted');
 expect((await call('web_task_start',{task:'Research public hosting options'})).result.content[0].text).toContain('api_key_required');
 const created=await req('/api/billing/keys',{label:'MCP'});const {key}=await created.json() as any;
 expect((await call('web_map',{url:'https://example.com',includePage:false},key)).result.isError).not.toBe(true);
 expect(sql.prepare('SELECT balance_micros FROM accounts WHERE id=?').get('site:'+user).balance_micros).toBe(1998000);
});

it('monthly invoices credit once, validate package allocation, and preserve existing balance',async()=>{
 const {fulfillSubscription}=await import('../src/billing/subscriptions');
 sql.prepare("UPDATE site_billing SET customer='cus_test'").run();sql.prepare('INSERT INTO credit_subscriptions(id,user_id,cents,created_at) VALUES(?,?,500,?)').run('monthly',user,Date.now());
 const subscription={id:'sub_test',customer:'cus_test',status:'active',metadata:{oassis_subscription:'monthly'},cancel_at_period_end:false};
 const invoice={id:'in_monthly',subscription:'sub_test',customer:'cus_test',currency:'usd',status:'paid',subtotal:500,total:500,amount_paid:500,payment_intent:'pi_monthly',billing_reason:'subscription_cycle',lines:{data:[{quantity:1,price:{unit_amount:500,recurring:{interval:'month'}}}]}};
 vi.spyOn(globalThis,'fetch').mockImplementation(async(input)=>Response.json(String(input).includes('/subscriptions/')?subscription:invoice));
 await fulfillSubscription(env,invoice);await fulfillSubscription(env,invoice);
 expect(sql.prepare('SELECT balance_micros FROM accounts WHERE id=?').get('site:'+user).balance_micros).toBe(7000000);
 expect(sql.prepare("SELECT COUNT(*) n FROM billing_orders WHERE id='invoice:in_monthly'").get().n).toBe(1);
 invoice.lines.data[0]!.quantity=2;await expect(fulfillSubscription(env,invoice)).rejects.toThrow('allocation');
});

it('low-credit and exhausted notices are saved once and reset after a successful purchase',async()=>{
 const {creditNotices}=await import('../src/billing/notices');
 sql.prepare('UPDATE accounts SET balance_micros=300000 WHERE id=?').run('site:'+user);
 await creditNotices(env);await creditNotices(env);expect(sql.prepare('SELECT COUNT(*) n FROM credit_notices').get().n).toBe(1);
 sql.prepare('UPDATE accounts SET balance_micros=0 WHERE id=?').run('site:'+user);await creditNotices(env);expect(sql.prepare('SELECT COUNT(*) n FROM credit_notices').get().n).toBe(2);
 seedOrder();await fulfill(env,paid());expect(sql.prepare('SELECT alert_level FROM site_billing').get().alert_level).toBe(0);
});
