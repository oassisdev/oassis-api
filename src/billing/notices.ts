import type { Env } from '../types';
import { creditsFor } from './credits';
/** Persistent notices are also shown in the dashboard if email has not been configured. */
export async function creditNotices(env:Env) {
 const rows=await env.BILLING.prepare(`SELECT b.*,a.balance_micros-a.reserved_micros available FROM site_billing b JOIN accounts a ON a.id=b.account_id WHERE b.welcome_granted=1 AND a.balance_micros-a.reserved_micros<=b.alert_baseline*0.2 LIMIT 100`).all<Record<string,any>>();
 for(const row of rows.results){
  const level=row.available<=0?2:1;
  if(row.alert_level>=level)continue;
  const id=row.user_id+':'+row.alert_cycle+':'+level;
  const message=level===2?'Your Oassis credits are exhausted. Add a package to continue.':'Your Oassis balance is low: '+creditsFor(Math.max(0,row.available))+' credits remain.';
  await env.BILLING.batch([
   env.BILLING.prepare('INSERT INTO credit_notices(id,user_id,at,level,message) VALUES(?,?,?,?,?) ON CONFLICT(id) DO NOTHING').bind(id,row.user_id,Date.now(),level===2?'exhausted':'low',message),
   env.BILLING.prepare('UPDATE site_billing SET alert_level=MAX(alert_level,?) WHERE user_id=? AND alert_cycle=?').bind(level,row.user_id,row.alert_cycle),
  ]);
 }
 if(!env.RESEND_API_KEY||!env.BILLING_EMAIL_FROM)return;
 const pending=await env.BILLING.prepare('SELECT n.*,u.email FROM credit_notices n JOIN site_user u ON u.id=n.user_id WHERE n.emailed_at IS NULL AND u.emailVerified=1 ORDER BY n.at LIMIT 50').all<Record<string,any>>();
 for(const notice of pending.results){
  const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+env.RESEND_API_KEY,'Content-Type':'application/json','Idempotency-Key':notice.id},body:JSON.stringify({from:env.BILLING_EMAIL_FROM,to:[notice.email],subject:notice.level==='exhausted'?'Oassis: credits exhausted':'Oassis: credits running low',text:notice.message+'\nhttps://oassis.dev/dashboard/billing'})});
  if(response.ok)await env.BILLING.prepare('UPDATE credit_notices SET emailed_at=? WHERE id=?').bind(Date.now(),notice.id).run();
 }
}
