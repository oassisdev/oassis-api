/** Public task capabilities. No customer accounts, API keys or prepaid balances. */
import type { Env } from '../types';
import { hashKey } from '../billing/accounts';
import { taskRequest } from './request';
import { startTask, getTask, cancelTask } from './service';
import { inDollars } from '../billing/prices';

export async function taskIdentity(token: string): Promise<string | null> {
  return /^[a-f0-9]{64}$/.test(token) ? 'task:' + await hashKey(token) : null;
}
export async function startPublicTask(env: Env, body: unknown, transport: 'mcp' | 'x402', token?: string, idempotencyKey?: string | null) {
  const parsed = taskRequest.safeParse(body);
  if (!parsed.success) return { ok: false as const, error: { status: 400, error: 'invalid_request', message: 'The request does not match the task contract.', details: parsed.error.issues } };
  const accessToken = token || Array.from(crypto.getRandomValues(new Uint8Array(32)), b=>b.toString(16).padStart(2,'0')).join('');
  const account = await taskIdentity(accessToken);
  if (!account) return { ok: false as const, error: { status: 400, error: 'invalid_task_token', message: 'Task-Token must be 64 lowercase hexadecimal characters.' } };
  const budget = Math.round(parsed.data.limits.max_cost_usd * 1_000_000);
  // This is an execution budget, not a customer balance. The existing atomic task
  // reservation/settlement engine measures work using a task-scoped internal row.
  await env.BILLING.prepare('INSERT INTO accounts (id,created_at,balance_micros,note) VALUES (?1,?2,?3,?4) ON CONFLICT(id) DO NOTHING')
    .bind(account,Date.now(),budget,JSON.stringify({transport,price:transport==='mcp'?0:budget})).run();
  const previous=await env.BILLING.prepare('SELECT note FROM accounts WHERE id=?').bind(account).first<{note:string}>();
  if (JSON.parse(previous?.note||'{}').transport!==transport) return {ok:false as const,error:{status:409,error:'task_token_conflict',message:'This task token belongs to a different transport.'}};
  const existing=await env.BILLING.prepare('SELECT id,idempotency_key FROM agent_tasks WHERE account=? LIMIT 1').bind(account).first<{id:string;idempotency_key:string|null}>();
  if(existing&&(!idempotencyKey||existing.idempotency_key!==idempotencyKey))return {ok:false as const,error:{status:409,error:'task_token_used',message:'This token belongs to a task. Start another task with a new token, or retry with the same Idempotency-Key.'}};
  const result=await startTask(env,{account,body:parsed.data,idempotencyKey:idempotencyKey||null,baseUrl:env.BASE_URL,deferKick:transport==='x402'});
  return result.ok?{...result,accessToken,account,priceMicros:transport==='mcp'?0:budget}:result;
}
export async function publicTask(env: Env, id: string, token: string, cancel=false) {
  const account=await taskIdentity(token);
  if(!account)return {status:401,body:{success:false,error:'task_token_required',message:'Send the access_token returned when the task started, using Task-Token. No API key is needed.'}};
  const out=cancel?await cancelTask(env,account,id):await getTask(env,account,id);
  if('error' in out)return {status:out.status,body:{success:false,error:out.error,message:'Task not found or task token does not match.'}};
  const row=await env.BILLING.prepare('SELECT note FROM accounts WHERE id=?').bind(account).first<{note:string}>();
  const payment=JSON.parse(row?.note||'{}') as {transport:string;price:number;paid?:boolean};
  const data=out.body as Record<string,unknown>;
  const progress=data.progress as {operations:Array<Record<string,unknown>>};
  const internal=data.billing as Record<string,unknown>;
  return {status:out.status,body:{...data,progress:{...progress,operations:progress.operations.map(({charged,...op})=>({...op,execution_cost:charged}))},billing:{channel:payment.transport,paid:inDollars(payment.transport==='mcp'||!payment.paid?0:payment.price||0),pricing:payment.transport==='mcp'?'free':'fixed task execution budget; no automatic on-chain refund'},execution_budget:internal}};
}
