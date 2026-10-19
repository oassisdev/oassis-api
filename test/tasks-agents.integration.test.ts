/** Full HTTP/MCP lifecycle against real routers, SQLite and actual Durable Object code.
 * Only the Cloudflare runtime shell, browser and model transports are simulated.
 * Parameter options must reach the browser; scheduling, comparison and billing are real.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync,readdirSync } from 'node:fs';
import type { Env } from '../src/types';
import { hashKey } from '../src/billing/accounts';
import { batchRequest,crawlRequest } from '../src/schema';
import { runDueAgents } from '../src/agents/services';
vi.mock('cloudflare:workers',()=>({DurableObject:class {ctx:any;env:any;constructor(ctx:any,env:any){this.ctx=ctx;this.env=env;}}}));
vi.mock('../src/session/do',()=>({BrowserSession:class {}}));
vi.mock('../src/billing/x402',()=>({x402:()=>async(c:any)=>c.json({error:'payment_required'},402)}));
const {BatchJob}=await import('../src/jobs/do');
const {CrawlJob}=await import('../src/jobs/crawl');
const {AgentTask}=await import('../src/agent/do');
const {default:worker}=await import('../src/index');
const {DatabaseSync}=createRequire(import.meta.url)('node:sqlite');
const root='https://fixture.example.com/catalogue/start',child='https://fixture.example.com/catalogue/next';
const formats=['markdown','html','links','elements','controls','accessibility','json'];
const ownerKey='oas_fixtureowner',otherKey='oas_fixtureother';
let sql:any,env:Env,clock:number,objects:any[],renders:any[],pages:Map<string,{markdown:string;html:string;links:string[]}>;
const common={formats,selectors:['h1','.price'],json:{prompt:'Extract title',schema:{type:'object',properties:{title:{type:'string'}},required:['title']}},controls:{visibleOnly:true,limit:1},links:{visibleOnly:true,excludeExternal:true},wait:{until:'domcontentloaded',selector:'body',timeout:30000},request:{headers:{'X-Test':'all-parameters'},cookies:[{name:'fixture',value:'yes',domain:'fixture.example.com',path:'/',secure:true,httpOnly:true}],userAgent:'Oassis-Integration/1.0',auth:{username:'fixture',password:'synthetic'}},block:{resourceTypes:['image','font'],urlPatterns:['\\.png$']},maxAge:60000,binaryAs:'base64',viewport:{width:1280,height:720,deviceScaleFactor:1}};
function page(amount=100,extra=''){return {markdown:'Fixture product\nPrice $'+amount.toFixed(2)+'\n'+extra,html:'<title>Fixture</title><h1>Fixture product</h1><script type="application/ld+json">'+JSON.stringify({offers:{price:String(amount),priceCurrency:'USD'}})+'</script>',links:[child,'https://fixture.example.com/category/excluded','https://sub.fixture.example.com/catalogue/sub','https://external.example.org/']};}
beforeEach(async()=>{
 clock=Date.UTC(2026,9,18,10);vi.spyOn(Date,'now').mockImplementation(()=>clock);objects=[];renders=[];pages=new Map([[root,page()],[child,page(50)]]);
 sql=new DatabaseSync(':memory:');for(const file of readdirSync('migrations').filter(f=>f.endsWith('.sql')).sort())sql.exec(readFileSync('migrations/'+file,'utf8'));
 const prepare=(query:string,args:any[]=[])=>{const run=()=>{const st=sql.prepare(query);return st.columns().length?{results:st.all(...args),meta:{changes:0}}:{results:[],meta:st.run(...args)};};return {bind:(...values:any[])=>prepare(query,values),first:async()=>sql.prepare(query).get(...args)||null,all:async()=>({results:sql.prepare(query).all(...args)}),run:async()=>({meta:sql.prepare(query).run(...args)}),_run:run};};
 const namespace=(Ctor:any,kind:string)=>({newUniqueId:()=>({toString:()=>kind+'-'+crypto.randomUUID()}),idFromString:(id:string)=>id,idFromName:(id:string)=>id,get:(id:any)=>({fetch:async(url:string,init:RequestInit)=>{
  let object=objects.find(o=>o.id===String(id)&&o.kind===kind);if(!object){const data=new Map<string,any>();object={id:String(id),kind,alarmAt:null,data};const storage={get:async(key:string)=>data.has(key)?structuredClone(data.get(key)):undefined,put:async(key:string,value:any)=>{data.set(key,structuredClone(value));},getAlarm:async()=>object.alarmAt,setAlarm:async(value:number)=>{object.alarmAt=value;},deleteAlarm:async()=>{object.alarmAt=null;}};object.instance=new Ctor({id:{toString:()=>String(id)},storage},env);objects.push(object);}return object.instance.fetch(new Request(url,init));}})});
 env={BASE_URL:'https://api.oassis.dev',BILLING:{prepare,batch:async(stmts:any[])=>{sql.exec('BEGIN');try{const out=stmts.map(s=>s._run());sql.exec('COMMIT');return out;}catch(e){sql.exec('ROLLBACK');throw e;}}},BROWSER:{quickAction:async(action:string,options:any)=>{
  renders.push({action,options:structuredClone(options)});const p=pages.get(options.url);if(!p)return Response.json({error:'Fixture not found'},{status:404});let value:any;
  if(action==='markdown')value=p.markdown;else if(action==='content')value=p.html;else if(action==='links')value=p.links;else if(action==='json')value={title:'Fixture product'};else if(action==='accessibilityTree')value={accessibilityTree:{role:'document',name:'Fixture'}};else value=(options.elements||[]).map((e:any)=>({selector:e.selector,results:[{text:'Fixture',attributes:{href:child},top:0,left:0,width:50,height:20}]}));return Response.json({success:true,result:value});
 }},AI:{run:async(_model:string,input:any)=>{
  if(input.response_format.json_schema.properties.action){const text=input.messages[1].content;const already=(text.match(/Already read: ([^\n]*)/)||[])[1]||'';return {response:!already.includes(root)?{action:'read',url:root,reason:'read supplied page'}:{action:'finish',reason:'enough evidence'}};}
  return {response:{summary:'Fixture product is $100.',findings:[{claim:'Fixture product costs $100.',source_ids:['s1']}],missing:[]}};
 }}} as unknown as Env;
 env.JOBS=namespace(BatchJob,'batch') as any;env.CRAWLS=namespace(CrawlJob,'crawl') as any;env.AGENT_TASKS=namespace(AgentTask,'research') as any;
 for(const [id,key] of [['owner',ownerKey],['other',otherKey]]){sql.prepare('INSERT INTO accounts(id,created_at,balance_micros) VALUES(?,?,?)').run(id,clock,1_000_000);sql.prepare('INSERT INTO api_keys(hash,account,prefix,created_at) VALUES(?,?,?,?)').run(await hashKey(key!),id,id,clock);}
});
afterEach(()=>{vi.restoreAllMocks();sql.close();});
async function request(path:string,method='GET',body?:unknown,key:string|null=ownerKey,extra:Record<string,string>={}){return worker.fetch(new Request('https://api.oassis.dev'+path,{method,headers:{'content-type':'application/json',...(key?{authorization:'Bearer '+key}:{}),...extra},...(body===undefined?{}:{body:JSON.stringify(body)})}),env);}
async function data(path:string,method='GET',body?:unknown,key:string|null=ownerKey,extra:Record<string,string>={}){const r=await request(path,method,body,key,extra);expect(r.status).toBeLessThan(300);return await r.json() as any;}
async function mcp(name:string,args:unknown,key:string|null=ownerKey){const r=await data('/mcp','POST',{jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}},key);expect(r.error).toBeUndefined();expect(r.result.isError).not.toBe(true);return JSON.parse(r.result.content[0].text);}
async function drain(kind?:string){for(let i=0;i<30;i++){const ready=objects.filter(o=>o.alarmAt!==null&&(!kind||o.kind===kind));if(!ready.length)return;for(const o of ready){clock=Math.max(clock,o.alarmAt);o.alarmAt=null;await o.instance.alarm();}}throw Error('Alarm loop did not settle');}
function balance(){return sql.prepare('SELECT balance_micros FROM accounts WHERE id=\'owner\'').get().balance_micros;}

describe.each(['HTTP','MCP'])('%s extraction tasks with every supported parameter',channel=>{
 it.each(['batch','crawl'])('%s forwards every parameter, produces every requested format and protects results',async(kind)=>{
  const body=kind==='batch'?{...common,urls:[root,child]}:{...common,url:root,limit:2,maxDepth:1,includeSubdomains:false,includePaths:['/catalogue/'],excludePaths:['/category/']};
  const schema=kind==='batch'?batchRequest:crawlRequest;
  expect(Object.keys(body).sort()).toEqual(Object.keys(schema.innerType().shape).sort());
  const path='/tasks/v1/'+(kind==='batch'?'scrape/batch':'crawl');
  const created=channel==='HTTP'?await data(path,'POST',body):await mcp(kind==='batch'?'web_scrape_batch':'web_crawl',body);
  expect(sql.prepare("SELECT operation FROM jobs WHERE id=?").get(created.jobId).operation).toBe(kind);expect(balance()).toBe(966000);await drain(kind);
  const result=await data(path+'/'+created.jobId+'?limit=1');const collection=kind==='batch'?'results':'pages';expect(result.status).toBe('done');expect(result[collection]).toHaveLength(1);
  const all=await data(path+'/'+created.jobId+'?limit=50');expect(all[collection]).toHaveLength(2);
  for(const entry of all[collection]){expect(entry.ok).toBe(true);expect(Object.keys(entry.data).sort()).toEqual([...formats].sort());expect(entry.errors).toEqual({});expect(entry.data.controls.length).toBeLessThanOrEqual(1);expect(entry.data.links.every((url:string)=>new URL(url).host==='fixture.example.com')).toBe(true);}
  expect(renders).toHaveLength(14);
  for(const render of renders){const o=render.options;expect(o.viewport).toEqual(common.viewport);expect(o.gotoOptions).toEqual({waitUntil:common.wait.until,timeout:common.wait.timeout});expect(o.waitForSelector).toEqual({selector:'body',timeout:30000});expect(o.setExtraHTTPHeaders).toEqual(common.request.headers);expect(o.cookies).toEqual(common.request.cookies);expect(o.userAgent).toBe(common.request.userAgent);expect(o.authenticate).toEqual(common.request.auth);expect(o.rejectResourceTypes).toEqual(common.block.resourceTypes);expect(o.rejectRequestPattern).toEqual(common.block.urlPatterns);}
  expect(renders.find(r=>r.action==='json').options).toMatchObject({prompt:common.json.prompt,response_format:{type:'json_schema',json_schema:common.json.schema}});
  expect(renders.filter(r=>r.action==='scrape').some(r=>r.options.elements.map((x:any)=>x.selector).join(',')===common.selectors.join(','))).toBe(true);
  expect(renders.find(r=>r.action==='links').options.visibleLinksOnly).toBe(true);
  expect((await request(path+'/'+created.jobId,'GET',undefined,otherKey)).status).toBe(404);expect((await request(path+'/'+created.jobId+'/cancel','POST',{},otherKey)).status).toBe(404);
  const before=balance();await data(path+'/'+created.jobId+'/cancel','POST',{});expect(balance()).toBe(before);
  if(channel==='MCP'){const status=await mcp(kind==='batch'?'web_batch_status':'web_crawl_status',{jobId:created.jobId,limit:1,cancel:false});expect(status[collection]).toHaveLength(1);await mcp(kind==='batch'?'web_batch_status':'web_crawl_status',{jobId:created.jobId,limit:1,cancel:true});}
 });
});

it.each(['batch','crawl'])('%s cancellation before its alarm refunds exactly once and prevents any read',async(kind)=>{
 const path='/tasks/v1/'+(kind==='batch'?'scrape/batch':'crawl');const body=kind==='batch'?{urls:[root,child],formats:['markdown']}:{url:root,limit:2,maxDepth:1,formats:['markdown']};
 const created=await data(path,'POST',body);const stopped=await data(path+'/'+created.jobId+'/cancel','POST',{});expect(stopped.status).toBe('cancelled');expect(balance()).toBe(1000000);
 await data(path+'/'+created.jobId+'/cancel','POST',{});await drain(kind);expect(balance()).toBe(1000000);expect(renders).toHaveLength(0);expect((await data(path+'/'+created.jobId)).status).toBe('cancelled');
});

it('crawl honours depth, path filters, page cap and refunds undiscovered pages',async()=>{
 const created=await data('/tasks/v1/crawl','POST',{url:root,formats:['markdown'],limit:5,maxDepth:0,includeSubdomains:true,includePaths:['/catalogue/'],excludePaths:['/category/']});await drain('crawl');
 const result=await data('/tasks/v1/crawl/'+created.jobId);expect(result.read).toBe(1);expect(result.pages[0].depth).toBe(0);expect(result.refundedMicros).toBe(16000);expect(balance()).toBe(996000);
});

it.each(['HTTP','MCP'])('%s research runs actual planning, reading, synthesis, citations and settlement with every parameter',async(channel)=>{
 const body={task:'Read the supplied fixture page and report the product price with its source.',mode:'research',urls:[root],limits:{max_cost_usd:.06,max_duration_seconds:90,max_steps:4}};
 const created=channel==='HTTP'?await data('/tasks/v1/research','POST',body,ownerKey,{'Idempotency-Key':'all-parameters'}):await mcp('web_task_start',body);const id=created.task_id;
 const stored=sql.prepare('SELECT request FROM agent_tasks WHERE id=?').get(id);expect(JSON.parse(stored.request)).toEqual(body);expect(sql.prepare('SELECT reserved_micros FROM accounts WHERE id=\'owner\'').get().reserved_micros).toBe(60000);
 if(channel==='HTTP'){const again=await data('/tasks/v1/research','POST',body,ownerKey,{'Idempotency-Key':'all-parameters'});expect(again.task_id).toBe(id);expect(again.created).toBe(false);expect((await request('/tasks/v1/research','POST',{...body,task:'Different research request with the same idempotency key'},ownerKey,{'Idempotency-Key':'all-parameters'})).status).toBe(409);}
 await drain('research');const result=await data('/tasks/v1/research/'+id);expect(result.status).toBe('completed');expect(result.sources[0].url).toBe(root);expect(result.result.findings[0].source_ids).toEqual(['s1']);expect(result.limit_hit).toBeNull();expect(result.progress.steps).toBeLessThanOrEqual(4);expect(result.billing).toMatchObject({reserved:'$0.06',spent:'$0.027',released:'$0.033',settlement:'settled'});expect(balance()).toBe(973000);expect(sql.prepare('SELECT reserved_micros FROM accounts WHERE id=\'owner\'').get().reserved_micros).toBe(0);
 expect((await request('/tasks/v1/research/'+id,'GET',undefined,otherKey)).status).toBe(404);expect((await request('/tasks/v1/research/'+id+'/cancel','POST',{},otherKey)).status).toBe(404);
 if(channel==='MCP'){expect((await mcp('web_task_status',{id,access_token:'ignored-with-owner-key'})).status).toBe('completed');expect((await mcp('web_task_cancel',{id,access_token:'ignored-with-owner-key'})).status).toBe('completed');}
});

it('research cancellation settles the start fee, releases the remaining reservation and is idempotent',async()=>{
 const started=await data('/tasks/v1/research','POST',{task:'Read this fixture page and report the price',urls:[root],limits:{max_cost_usd:.03,max_duration_seconds:30,max_steps:1}},ownerKey,{'Idempotency-Key':'cancel-test'});
 expect((await request('/tasks/v1/research/'+started.task_id+'/cancel','POST',{})).status).toBe(202);await drain('research');const result=await data('/tasks/v1/research/'+started.task_id);expect(result.status).toBe('cancelled');expect(result.billing).toMatchObject({spent:'$0.002',released:'$0.028'});await data('/tasks/v1/research/'+started.task_id+'/cancel','POST',{});expect(balance()).toBe(998000);
});

it.each(['steps','duration','cost'])('research enforces the %s limit and settles within the budget',async(limit)=>{
 const body={task:'Read the fixture and state its price',mode:'research',urls:[root],limits:{max_cost_usd:limit==='cost'?.03:.06,max_duration_seconds:30,max_steps:limit==='steps'?1:4}};
 const started=await data('/tasks/v1/research','POST',body,ownerKey,{'Idempotency-Key':'limit-'+limit});
 if(limit==='duration'){const o=objects.find(o=>o.kind==='research');o.alarmAt=null;await o.instance.alarm();clock+=31000;}
 if(limit==='cost'){const ai=env.AI as any;ai.run=async()=>({response:{action:'read',url:root,reason:'repeat read consumes bounded planning budget'}});}
 await drain('research');const result=await data('/tasks/v1/research/'+started.task_id);expect(['partial','failed']).toContain(result.status);expect(result.limit_hit).toBe(limit);expect(result.progress.steps).toBeLessThanOrEqual(body.limits.max_steps);expect(1000000-balance()).toBeLessThanOrEqual(body.limits.max_cost_usd*1e6);expect(result.billing.settlement).toBe('settled');
});

it('all three Agents persist every parameter, run on schedule, produce comparisons and cancel only for their owner',async()=>{
 const configs:any={'price-watch':{urls:[root,child],frequency:'daily',alert_drop_percent:10},'web-watch':{urls:[root,child],frequency:'weekly',keywords:['pricing','CHANGELOG']},'competitor-monitor':{domain:'https://fixture.example.com',sections:['/catalogue/start','/catalogue/next'],frequency:'weekly'}};const ids:any={};
 expect((await data('/agents/v1','GET',undefined,null)).agents).toHaveLength(3);
 for(const [agent,body] of Object.entries(configs)){const description=await data('/agents/v1/'+agent,'GET',undefined,null);expect(Object.keys(description.parameters).sort()).toEqual(Object.keys(body as any).sort());const created=await data('/agents/v1/'+agent,'POST',body);expect(created.service.config).toEqual(body);ids[agent]=created.service.id;expect((await request('/agents/v1/services/'+created.service.id,'GET',undefined,otherKey)).status).toBe(404);}
 expect((await data('/agents/v1/services')).services).toHaveLength(3);expect(await runDueAgents(env,clock)).toBe(3);expect(balance()).toBe(1000000);
 for(const agent of Object.keys(configs)){const result=(await data('/agents/v1/services/'+ids[agent])).service;expect(result.last_report.summary).toEqual({targets:2,changed:0,alerts:0,errors:0});expect(result.last_report.targets.every((t:any)=>t.change==='first_read')).toBe(true);expect(Date.parse(result.next_run_at)-clock).toBe(agent==='price-watch'?86400000:7*86400000);}
 // Below-threshold drop produces a price change but no alert; next day's larger drop alerts.
 clock+=86400000;pages.set(root,page(95));expect(await runDueAgents(env,clock)).toBe(1);expect((await data('/agents/v1/services/'+ids['price-watch'])).service.last_report.summary).toMatchObject({changed:1,alerts:0});
 clock+=86400000;pages.set(root,page(80));expect(await runDueAgents(env,clock)).toBe(1);expect((await data('/agents/v1/services/'+ids['price-watch'])).service.last_report.summary).toMatchObject({changed:1,alerts:1});
 // Weekly watches compare with their own snapshot and apply keyword filters.
 clock+=5*86400000;pages.set(root,page(80,'New PRICING policy'));pages.set(child,page(50,'Cookie banner changed'));expect(await runDueAgents(env,clock)).toBe(3);
 const web=(await data('/agents/v1/services/'+ids['web-watch'])).service;expect(web.last_report.summary.changed).toBe(1);expect(web.last_report.targets.find((t:any)=>t.url===child).change).toBe('unchanged');
 expect((await data('/agents/v1/services/'+ids['competitor-monitor'])).service.last_report.summary.changed).toBe(2);
 for(const agent of Object.keys(configs)){const id=ids[agent];expect((await request('/agents/v1/services/'+id+'/cancel','POST',{},otherKey)).status).toBe(404);const prior=(await data('/agents/v1/services/'+id)).service.last_report;await data('/agents/v1/services/'+id+'/cancel','POST',{});await data('/agents/v1/services/'+id+'/cancel','POST',{});expect((await data('/agents/v1/services/'+id)).service).toMatchObject({status:'cancelled',next_run_at:null,last_report:prior});}
 clock+=7*86400000;expect(await runDueAgents(env,clock)).toBe(0);expect(balance()).toBe(1000000);
});

const invalid:[string,string,unknown][]=[
 ['batch too few urls','/tasks/v1/scrape/batch',{urls:[root]}],['batch duplicate urls','/tasks/v1/scrape/batch',{urls:[root,root]}],['batch heavy formats','/tasks/v1/scrape/batch',{urls:[root,child],formats:['pdf']}],['batch invalid regex','/tasks/v1/scrape/batch',{urls:[root,child],block:{urlPatterns:['*.png']}}],['batch elements without selectors','/tasks/v1/scrape/batch',{urls:[root,child],formats:['elements']}],['crawl page limit','/tasks/v1/crawl',{url:root,limit:201}],['crawl depth','/tasks/v1/crawl',{url:root,maxDepth:6}],['crawl unknown parameter','/tasks/v1/crawl',{url:root,unknown:true}],['research budget','/tasks/v1/research',{task:'Read the fixture price',limits:{max_cost_usd:.001}}],['research mode','/tasks/v1/research',{task:'Read the fixture price',mode:'purchase'}],['research steps','/tasks/v1/research',{task:'Read the fixture price',limits:{max_steps:21}}],['research time','/tasks/v1/research',{task:'Read the fixture price',limits:{max_duration_seconds:901}}],['research private URL','/tasks/v1/research',{task:'Read the fixture price',urls:['http://127.0.0.1/']}],['price-watch threshold','/agents/v1/price-watch',{urls:[root],alert_drop_percent:101}],['price-watch frequency','/agents/v1/price-watch',{urls:[root],frequency:'hourly'}],['web-watch URL count','/agents/v1/web-watch',{urls:[]}],['web-watch keywords','/agents/v1/web-watch',{urls:[root],keywords:Array(11).fill('x')}],['competitor sections','/agents/v1/competitor-monitor',{domain:'https://fixture.example.com',sections:['no-slash']}],['competitor private target','/agents/v1/competitor-monitor',{domain:'http://127.0.0.1/',sections:['/']}],
];
it.each(invalid)('rejects %s before charging or creating work',async(_name,path,body)=>{expect((await request(path,'POST',body,ownerKey,{'Idempotency-Key':'invalid'})).status).toBe(400);expect(balance()).toBe(1000000);expect(objects).toHaveLength(0);expect(sql.prepare('SELECT COUNT(*) AS n FROM agent_services').get().n).toBe(0);});

it('batch maxAge serves repeated public renders from cache and refunds the savings',async()=>{
 const cache=new Map<string,string>();env.CACHE={get:async(key:string)=>cache.has(key)?JSON.parse(cache.get(key)!):null,put:async(key:string,value:string)=>{cache.set(key,value);}} as any;
 for(let i=0;i<2;i++){const created=await data('/tasks/v1/scrape/batch','POST',{urls:[root,child],formats:['markdown'],maxAge:60000});await drain('batch');const final=await data('/tasks/v1/scrape/batch/'+created.jobId);expect(final.refundedMicros).toBe(i===0?0:3600);}
 expect(renders).toHaveLength(2);expect(balance()).toBe(995600);
});

it.each([false,true])('crawl includeSubdomains=%s changes which public pages are followed',async(includeSubdomains)=>{
 const sub='https://sub.fixture.example.com/catalogue/sub';pages.set(sub,{...page(20),links:[]});
 const created=await data('/tasks/v1/crawl','POST',{url:root,limit:5,maxDepth:1,includeSubdomains,includePaths:['/catalogue/'],excludePaths:['/category/'],formats:['markdown']});await drain('crawl');const final=await data('/tasks/v1/crawl/'+created.jobId);expect(final.pages.some((p:any)=>p.url===sub)).toBe(includeSubdomains);expect(final.read).toBe(includeSubdomains?3:2);expect(final.pages.every((p:any)=>!p.url.includes('/category/')&&!p.url.includes('external.example.org'))).toBe(true);
});

// Reproductions of live failures. A cancellation acknowledgement must remain effective
// even when an alarm had already started a browser read.
it.each(['batch','crawl'])('%s cancellation during a browser read remains cancelled and never resumes',async(kind)=>{
 const original=env.BROWSER.quickAction.bind(env.BROWSER);let unblock!:()=>void,entered!:()=>void;const gate=new Promise<void>(r=>{unblock=r;}),started=new Promise<void>(r=>{entered=r;});let once=true;
 env.BROWSER.quickAction=(async(action:any,options:any)=>{if(once){once=false;entered();await gate;}return original(action,options);}) as any;
 const path='/tasks/v1/'+(kind==='batch'?'scrape/batch':'crawl');const created=await data(path,'POST',kind==='batch'?{urls:[root,child],formats:['markdown']}:{url:root,limit:2,maxDepth:1,formats:['markdown']});const object=objects.find(o=>o.kind===kind);object.alarmAt=null;const running=object.instance.alarm();await started;
 const cancellation=await data(path+'/'+created.jobId+'/cancel','POST',{});expect(cancellation.status).toBe('cancelled');unblock();await running;await drain(kind);
 const final=await data(path+'/'+created.jobId);expect(final.status).toBe('cancelled');expect(final.completed??final.read).toBe(1);
 const pagePrice=kind==='batch'?2000:4000;expect(final.refundedMicros).toBe(pagePrice);expect(balance()).toBe(1000000-pagePrice);
 await data(path+'/'+created.jobId+'/cancel','POST',{});await object.instance.alarm();expect(balance()).toBe(1000000-pagePrice);
 expect(renders.filter(r=>r.options.url===child)).toHaveLength(0);
});

it.each(['batch','crawl'])('%s MCP negative limit has the same bounded behaviour as HTTP',async(kind)=>{
 const path='/tasks/v1/'+(kind==='batch'?'scrape/batch':'crawl');const created=await data(path,'POST',kind==='batch'?{urls:[root,child]}:{url:root,limit:2});await drain(kind);const field=kind==='batch'?'results':'pages';const http=await data(path+'/'+created.jobId+'?limit=-5');const result=await mcp(kind==='batch'?'web_batch_status':'web_crawl_status',{jobId:created.jobId,limit:-5,cancel:false});expect(result[field].length).toBe(http[field].length);
});

it('competitor sections stay on the configured domain',async()=>{
 const r=await request('/agents/v1/competitor-monitor','POST',{domain:'https://fixture.example.com',sections:['//different.example.org/pricing'],frequency:'weekly'});expect(r.status).toBe(400);expect(sql.prepare('SELECT COUNT(*) AS n FROM agent_services').get().n).toBe(0);
});

const mutations:[string,unknown][]=[['formats',[]],['selectors',[]],['json.prompt',''],['json.schema','not-an-object'],['controls.visibleOnly','yes'],['controls.limit',0],['links.visibleOnly','yes'],['links.excludeExternal','yes'],['wait.until','never'],['wait.selector',''],['wait.timeout',99],['request.headers',{'X-Test':1}],['request.cookies.0.name',''],['request.cookies.0.domain',1],['request.cookies.0.path',1],['request.cookies.0.secure','yes'],['request.cookies.0.httpOnly','yes'],['request.userAgent',''],['request.auth.password',null],['block.resourceTypes',['']],['block.urlPatterns',['[']],['maxAge',-1],['viewport.width',0],['viewport.height',4097],['viewport.deviceScaleFactor',4]];
for(const [path,value] of mutations)it('validates extraction parameter '+path+' before charging',async()=>{
 const body:any={...structuredClone(common),urls:[root,child]};const keys=path.split('.');let target=body;for(const key of keys.slice(0,-1))target=target[key];target[keys[keys.length-1]!]=value;expect((await request('/tasks/v1/scrape/batch','POST',body)).status).toBe(400);expect(balance()).toBe(1000000);expect(objects).toHaveLength(0);
});
for(const kind of ['batch','crawl'])for(const [name,extra] of [['json.model',{formats:['json'],json:{prompt:'title',model:'unsupported'}}],['binaryAs=url',{binaryAs:'url'}]] as const)it(kind+' rejects unsupported '+name+' before charging',async()=>{
 const path='/tasks/v1/'+(kind==='batch'?'scrape/batch':'crawl'),base=kind==='batch'?{urls:[root,child]}:{url:root,limit:1};expect((await request(path,'POST',{...base,...extra})).status).toBe(400);expect(balance()).toBe(1000000);
});
const moreInvalid:[string,string,unknown][]=[
 ['research task length','/tasks/v1/research',{task:'short'}],['research URL count','/tasks/v1/research',{task:'Read all fixture pages',urls:Array(6).fill(root)}],['research maximum budget','/tasks/v1/research',{task:'Read all fixture pages',limits:{max_cost_usd:1.1}}],['research minimum duration','/tasks/v1/research',{task:'Read all fixture pages',limits:{max_duration_seconds:29}}],['research minimum steps','/tasks/v1/research',{task:'Read all fixture pages',limits:{max_steps:0}}],['price-watch negative threshold','/agents/v1/price-watch',{urls:[root],alert_drop_percent:-1}],['web-watch frequency','/agents/v1/web-watch',{urls:[root],frequency:'hourly'}],['web-watch empty keyword','/agents/v1/web-watch',{urls:[root],keywords:['']}],['competitor empty sections','/agents/v1/competitor-monitor',{domain:'https://fixture.example.com',sections:[]}],['competitor invalid domain','/agents/v1/competitor-monitor',{domain:'invalid',sections:['/']}],
];
it.each(moreInvalid)('rejects %s without creating work',async(_name,path,body)=>{expect((await request(path,'POST',body,ownerKey,{'Idempotency-Key':'invalid-more'})).status).toBe(400);expect(balance()).toBe(1000000);expect(objects).toHaveLength(0);expect(sql.prepare('SELECT COUNT(*) AS n FROM agent_services').get().n).toBe(0);});


it('valid x402 Task-Token authorizes HTTP and MCP status/cancellation without an API key',async()=>{
 const {startPublicTask}=await import('../src/agent/public-access');
 const started=await startPublicTask(env,{task:'Read the fixture product price',mode:'research',urls:[root],limits:{max_cost_usd:.05,max_duration_seconds:60,max_steps:3}},'x402');if(!started.ok)throw Error(started.error.message);
 sql.prepare("UPDATE accounts SET note=json_set(note,'$.paid',1) WHERE id=?").run(started.account);
 const http=await data('/tasks/v1/research/'+started.taskId,'GET',undefined,null,{'Task-Token':started.accessToken});expect(http.billing).toMatchObject({channel:'x402',paid:'$0.05'});
 expect((await mcp('web_task_status',{id:started.taskId,access_token:started.accessToken},null)).status).toBe('queued');
 await mcp('web_task_cancel',{id:started.taskId,access_token:started.accessToken},null);await drain('research');const final=await data('/tasks/v1/research/'+started.taskId,'GET',undefined,null,{'Task-Token':started.accessToken});expect(final.status).toBe('cancelled');expect(final.execution_budget).toMatchObject({spent:'$0.002',released:'$0.048'});expect(final.billing.paid).toBe('$0.05');
});
it('Task-Token rejects malformed or unrelated capabilities and an unrelated API-key owner',async()=>{
 const {startPublicTask}=await import('../src/agent/public-access');const started=await startPublicTask(env,{task:'Read the fixture product price',urls:[root]},'x402');if(!started.ok)throw Error(started.error.message);
 expect((await request('/tasks/v1/research/'+started.taskId,'GET',undefined,null,{'Task-Token':'invalid'})).status).toBe(401);expect((await request('/tasks/v1/research/'+started.taskId,'GET',undefined,null,{'Task-Token':'0'.repeat(64)})).status).toBe(404);expect((await request('/tasks/v1/research/'+started.taskId,'GET',undefined,ownerKey)).status).toBe(404);
 const invalid=await data('/mcp','POST',{jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'web_task_status',arguments:{id:started.taskId,access_token:'invalid'}}},null);expect(invalid.result.isError).toBe(true);
});

// The ledger commits atomically; replaying an alarm after the DO failed to persist
// its refund checkpoint must not credit the account a second time.
it.each(['batch','crawl'])('%s recovers a refund checkpoint after restart without double credit',async(kind)=>{
 const path='/tasks/v1/'+(kind==='batch'?'scrape/batch':'crawl');
 const created=await data(path,'POST',kind==='batch'?{urls:[root,child]}:{url:root,limit:2});
 await data(path+'/'+created.jobId+'/cancel','POST',{});
 const object=objects.find(o=>o.kind===kind);const stored=object.data.get('job');
 const amount=stored.refundedMicros;object.data.set('job',{...stored,refundedMicros:0,refundMicros:amount});
 await object.instance.alarm();
 expect(balance()).toBe(1000000);expect((await data(path+'/'+created.jobId)).refundedMicros).toBe(amount);
 expect(sql.prepare('SELECT COUNT(*) AS n FROM job_refunds').get().n).toBe(1);
 expect(sql.prepare("SELECT COUNT(*) AS n FROM transactions WHERE micros>0").get().n).toBe(1);
});

it.each(['//different.example.org/pricing','/\\different.example.org/pricing','///different.example.org/pricing'])('rejects competitor domain escape %s',async(section)=>{
 expect((await request('/agents/v1/competitor-monitor','POST',{domain:'https://fixture.example.com',sections:[section]})).status).toBe(400);
 expect(sql.prepare('SELECT COUNT(*) AS n FROM agent_services').get().n).toBe(0);
});

it.each(['batch','crawl'])('%s retries a failed refund without losing cancellation',async(kind)=>{
 const path='/tasks/v1/'+(kind==='batch'?'scrape/batch':'crawl');
 const created=await data(path,'POST',kind==='batch'?{urls:[root,child]}:{url:root,limit:2});
 const prepare=env.BILLING.prepare.bind(env.BILLING);let fail=true;
 env.BILLING.prepare=((query:string)=>{if(fail&&query.includes('INSERT OR IGNORE INTO job_refunds')){fail=false;throw Error('temporary database outage');}return prepare(query);}) as any;
 const stopped=await data(path+'/'+created.jobId+'/cancel','POST',{});expect(stopped.status).toBe('cancelled');expect(balance()).toBeLessThan(1000000);
 await drain(kind);expect(balance()).toBe(1000000);expect(renders).toHaveLength(0);
 const final=await data(path+'/'+created.jobId);expect(final.status).toBe('cancelled');expect(final.refundedMicros).toBe(kind==='batch'?4000:8000);
});

it.each(['batch','crawl'])('%s refunds an in-flight page that fails after cancellation',async(kind)=>{
 let unblock!:()=>void,entered!:()=>void;const gate=new Promise<void>(r=>{unblock=r;}),started=new Promise<void>(r=>{entered=r;});
 env.BROWSER.quickAction=(async()=>{entered();await gate;throw Error('browser failed');}) as any;
 const path='/tasks/v1/'+(kind==='batch'?'scrape/batch':'crawl');const created=await data(path,'POST',kind==='batch'?{urls:[root,child]}:{url:root,limit:2});
 const object=objects.find(o=>o.kind===kind);object.alarmAt=null;const running=object.instance.alarm();await started;
 await Promise.all([data(path+'/'+created.jobId+'/cancel','POST',{}),data(path+'/'+created.jobId+'/cancel','POST',{})]);
 unblock();await running;await drain(kind);expect(balance()).toBe(1000000);
 const final=await data(path+'/'+created.jobId);expect(final.status).toBe('cancelled');expect(final.refundedMicros).toBe(kind==='batch'?4000:8000);
});

it('crawl cache refunds use each format price when JSON costs more than links',async()=>{
 const cache=new Map<string,string>();env.CACHE={get:async(key:string)=>cache.has(key)?JSON.parse(cache.get(key)!):null,put:async(key:string,value:string)=>{cache.set(key,value);}} as any;
 for(let i=0;i<2;i++){
  const created=await data('/tasks/v1/crawl','POST',{url:root,limit:2,maxDepth:1,formats:['json'],json:{prompt:'Extract title'},maxAge:60000});
  await drain('crawl');const final=await data('/tasks/v1/crawl/'+created.jobId);expect(final.read).toBe(2);expect(final.refundedMicros).toBe(i===0?0:13200);
 }
 expect(balance()).toBe(985200);
});

it('an uncertain refund response followed by a larger refund credits only the cumulative difference',async()=>{
 const {refundJob}=await import('../src/jobs/refund');
 await refundJob(env.BILLING,'owner','ambiguous-job',0,2000,'refund: batch');
 // The caller did not receive the first acknowledgment and now also owes another page.
 await refundJob(env.BILLING,'owner','ambiguous-job',0,4000,'refund: batch');
 await refundJob(env.BILLING,'owner','ambiguous-job',0,2000,'refund: batch');
 expect(balance()).toBe(1004000);
 expect(sql.prepare("SELECT SUM(micros) AS n FROM transactions WHERE reference='ambiguous-job'").get().n).toBe(4000);
});

it('a refund baseline from an older job is not credited again',async()=>{
 const {refundJob}=await import('../src/jobs/refund');
 await refundJob(env.BILLING,'owner','legacy-job',2000,1000,'refund: batch');
 expect(balance()).toBe(1001000);
});

it.each(['mailto:test@example.com','data:text/plain,hello','file:///tmp/example'])('rejects non-web competitor base %s before resolving sections',async(domain)=>{
 expect((await request('/agents/v1/competitor-monitor','POST',{domain,sections:['/pricing']})).status).toBe(400);
 expect(sql.prepare('SELECT COUNT(*) AS n FROM agent_services').get().n).toBe(0);
});
