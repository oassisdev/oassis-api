/** HTTP tasks: x402 on start; task capability on status/cancel. */
import { RESEARCH_ROUTE } from '../api-routes';
import { Hono } from 'hono';
import type { Env } from '../types';
import { x402 } from '../billing/x402';
import { payerFromHeaders, walletIdentity } from '../billing/payer';
import { requestAccount } from '../billing/accounts';
import { startTask, getTask } from './service';
import { recordWalletPayment } from '../billing/accounts';
import { taskRequest } from './request';
import { startPublicTask, publicTask, taskIdentity } from './public-access';
import { kick, cancelTask } from './service';

export const agentRoutes=new Hono<{Bindings:Env}>();
agentRoutes.use('/tasks/v1/*',async(c,next)=>{await next();c.header('cache-control','no-store');});
agentRoutes.get(RESEARCH_ROUTE,async(c)=>{
 const gate=x402(c.env);if(!gate)return c.json({success:false,error:'payment_unavailable'},503);
 return gate(c,async()=>{c.res=c.json({endpoint:'POST /tasks/v1/research',access:'x402 on start; Task-Token on status/cancel',pricing:'fixed execution budget',default_price:'$0.10'});});
});
agentRoutes.post(RESEARCH_ROUTE,async(c)=>{
 const key=await requestAccount(c.env?.BILLING,c.req.raw.headers);
 if(key==='invalid')return c.json({error:'invalid_api_key'},401);
 if(key){
  const body=await c.req.json().catch(()=>null);const idem=c.req.header('idempotency-key');
  if(!idem||!/^[-a-zA-Z0-9_:]{1,100}$/.test(idem))return c.json({error:'Idempotency-Key is required.'},400);
  const out=await startTask(c.env,{account:key.id,body,idempotencyKey:idem,baseUrl:c.env.BASE_URL});
  if(out.ok)c.header('location',out.location);
  return out.ok?c.json({...out,task_id:out.taskId,billing:{channel:'credits',pricing:'reserve maximum; charge actual cost; release unused credits'}},202):c.json(out.error,out.error.status as 400);
 }
 const gate=x402(c.env);if(!gate)return c.json({success:false,error:'payment_unavailable',message:'x402 is unavailable. No API key is required.'},503);
 const payment=c.req.header('payment-signature')||c.req.header('x-payment');
 const body=await c.req.json().catch(()=>null);
 if(payment&&!taskRequest.safeParse(body).success)return c.json({success:false,error:'invalid_request'},400);
 const token=c.req.header('task-token');
 if(token&&!/^[a-f0-9]{64}$/.test(token))return c.json({success:false,error:'invalid_task_token'},400);
 const idem=c.req.header('idempotency-key');
 if(idem&&!/^[A-Za-z0-9._:-]{1,200}$/.test(idem))return c.json({success:false,error:'invalid_idempotency_key'},400);
 if(token&&idem){
  const owner=await taskIdentity(token);
  const saved=await c.env.BILLING.prepare('SELECT note FROM accounts WHERE id=?').bind(owner).first<{note:string}>();
  const metadata=JSON.parse(saved?.note||'{}');
  if(metadata.transport==='x402'&&metadata.paid){
   const replay=await startPublicTask(c.env,body,'x402',token,idem);
   if(!replay.ok)return c.json({success:false,...replay.error},replay.error.status as 400);
   return c.json({task_id:replay.taskId,status:replay.status,location:replay.location,access_token:replay.accessToken,replayed:true},202);
  }
 }
 let accepted:Extract<Awaited<ReturnType<typeof startPublicTask>>,{ok:true}>|undefined;
 let wallet:string|null=null;
 const response=await gate(c,async()=>{
  wallet=payerFromHeaders(c.req.raw.headers);
  if(!wallet){c.res=c.json({success:false,error:'payer_identity_unavailable'},400);return;}
  const result=await startPublicTask(c.env,body,'x402',token,idem);
  if(!result.ok){c.res=c.json({success:false,...result.error},result.error.status as 400);return;}
  accepted=result;
  c.header('location',result.location);
  c.res=c.json({task_id:result.taskId,status:result.status,location:result.location,access_token:result.accessToken,replayed:!result.created,billing:{channel:'x402',price:result.priceMicros/1e6,pricing:'fixed execution budget; no automatic on-chain refund'}},202);
 });
 if(response)c.res=response;
 const status=response?.status??c.res.status;
 if(accepted&&status>=200&&status<300){
  // Start the alarm only after x402 has successfully settled the payment.
  await recordWalletPayment(c.env.BILLING,walletIdentity(wallet!),accepted.priceMicros,c.req.path,(response||c.res).headers).catch(e=>console.error('task payment log',e));
  await c.env.BILLING.prepare("UPDATE accounts SET note=json_set(note,'$.paid',1) WHERE id=?").bind(accepted.account).run();
  await kick(c.env,accepted.taskId).catch(e=>console.error('task kick',e));
 }else if(accepted){await cancelTask(c.env,accepted.account,accepted.taskId);}
 return response||c.res;
});
agentRoutes.get(RESEARCH_ROUTE+'/:id',async(c)=>{
 const key=await requestAccount(c.env?.BILLING,c.req.raw.headers);
 if(key==='invalid')return c.json({error:'invalid_api_key'},401);
 if(key){const out=await getTask(c.env,key.id,(c.req.param('id')||''));return c.json("body" in out?out.body:out,out.status as 200);}
 const out=await publicTask(c.env,(c.req.param('id')||''),c.req.header('task-token')||'');return c.json(out.body,out.status as 200);
});
agentRoutes.post(RESEARCH_ROUTE+'/:id/cancel',async(c)=>{
 const key=await requestAccount(c.env?.BILLING,c.req.raw.headers);
 if(key==='invalid')return c.json({error:'invalid_api_key'},401);
 if(key){const out=await cancelTask(c.env,key.id,(c.req.param('id')||''));return c.json("body" in out?out.body:out,out.status as 200);}
 const out=await publicTask(c.env,(c.req.param('id')||''),c.req.header('task-token')||'',true);return c.json(out.body,out.status as 200);
});
