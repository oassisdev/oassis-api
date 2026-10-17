import type { Env } from '../types';
import { hashKey } from './accounts';
import { CREDIT_MICROS, MCP_TRIAL_CREDITS } from './credits';
/** CF supplies the IP header. Never trust caller-selected trial IDs or MCP session IDs. */
export async function trialIdentity(env: Env, headers: Headers): Promise<string | null> {
 const ip = headers.get('cf-connecting-ip');
 if (!ip || !env.AUTH_SECRET) return null;
 return hashKey(env.AUTH_SECRET + ':mcp-trial:' + ip);
}
export async function takeTrial(env: Env, identity: string, micros: number): Promise<boolean> {
 await env.BILLING.prepare('INSERT INTO mcp_trials(identity,created_at) VALUES(?,?) ON CONFLICT(identity) DO NOTHING').bind(identity,Date.now()).run();
 const result=await env.BILLING.prepare('UPDATE mcp_trials SET spent_micros=spent_micros+? WHERE identity=? AND spent_micros+?<=?').bind(micros,identity,micros,MCP_TRIAL_CREDITS*CREDIT_MICROS).run();
 return !!result.meta.changes;
}
export async function refundTrial(env: Env, identity: string, micros: number) {
 await env.BILLING.prepare('UPDATE mcp_trials SET spent_micros=MAX(0,spent_micros-?) WHERE identity=?').bind(micros,identity).run();
}
