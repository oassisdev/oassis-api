import type { Env } from '../types';
export const PACKAGES = [500,2000,5000];
export function stripeReady(env:Env):boolean { return env.STRIPE_PAYMENTS_ENABLED==='true' && /^(sk|rk)_live_/.test(env.STRIPE_SECRET_KEY||'') && !!env.STRIPE_WEBHOOK_SECRET; }
export async function stripe(env:Env,path:string,body?:Record<string,string>,key?:string) {
 const response=await fetch('https://api.stripe.com/v1/'+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+env.STRIPE_SECRET_KEY,'Stripe-Version':'2024-06-20',...(body?{'Content-Type':'application/x-www-form-urlencoded'}:{}),...(key?{'Idempotency-Key':key}:{})},...(body?{body:new URLSearchParams(body).toString()}:{})});
 const data=await response.json() as Record<string,any>;
 if(!response.ok)throw new Error('Stripe request failed ('+response.status+').');
 return data;
}
export async function validSignature(raw:string,header:string,secret:string,now=Date.now()):Promise<boolean> {
 const parts=header.split(',');const timestamp=parts.find(p=>p.startsWith('t='))?.slice(2)||'';
 if(!/^\d+$/.test(timestamp)||Math.abs(now/1000-Number(timestamp))>300)return false;
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const expected=new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(timestamp+'.'+raw)));
 return parts.filter(p=>p.startsWith('v1=')).some(p=>{const value=p.slice(3);if(!/^[a-f0-9]{64}$/.test(value))return false;let diff=0;for(let i=0;i<32;i++)diff|=expected[i]!^parseInt(value.slice(i*2,i*2+2),16);return diff===0;});
}
export async function ensureBilling(env:Env,userId:string) {
 const account='site:'+userId;
 await env.BILLING.batch([
  env.BILLING.prepare('INSERT INTO accounts(id,created_at,balance_micros,note) VALUES(?,?,0,?) ON CONFLICT(id) DO NOTHING').bind(account,Date.now(),'Website prepaid account'),
  env.BILLING.prepare('INSERT INTO site_billing(user_id,account_id) VALUES(?,?) ON CONFLICT(user_id) DO NOTHING').bind(userId,account),
 ]);
 await env.BILLING.prepare('UPDATE site_billing SET welcome_granted=1 WHERE user_id=? AND welcome_granted=0 AND EXISTS(SELECT 1 FROM site_user WHERE id=? AND emailVerified=1)').bind(userId,userId).run();
 return (await env.BILLING.prepare('SELECT b.*,a.balance_micros,a.reserved_micros FROM site_billing b JOIN accounts a ON a.id=b.account_id WHERE user_id=?').bind(userId).first()) as Record<string,any>;
}
export async function stripeCustomer(env:Env,userId:string,email:string) {
 const row=await ensureBilling(env,userId);if(row.customer)return row.customer as string;
 const customer=await stripe(env,'customers',{'email':email,'metadata[oassis_user]':userId},'customer:'+userId);
 await env.BILLING.prepare('UPDATE site_billing SET customer=? WHERE user_id=? AND customer IS NULL').bind(customer.id,userId).run();return customer.id as string;
}
export async function fulfill(env:Env,object:Record<string,any>) {
 const id=object.metadata?.oassis_order;if(typeof id!=='string')return;
 const order=await env.BILLING.prepare('SELECT o.*,b.customer FROM billing_orders o JOIN site_billing b ON b.user_id=o.user_id WHERE o.id=?').bind(id).first<Record<string,any>>();
 if(!order)return;
 if(order.payment_intent&&order.payment_intent!==object.id)throw new Error('Payment intent mismatch.');
 if(object.currency!=='usd'||object.customer!==order.customer||object.amount_received!==order.cents*1)throw new Error('Payment amount or customer mismatch.');
 if(object.status!=='succeeded')return;
 await env.BILLING.prepare("UPDATE billing_orders SET state='paid',payment_intent=? WHERE id=? AND state!='paid'").bind(object.id,id).run();
 if(order.save_card&&typeof object.payment_method==='string')await env.BILLING.prepare('UPDATE site_billing SET payment_method=? WHERE user_id=?').bind(object.payment_method,order.user_id).run();
}
export async function fulfillInvoice(env:Env,invoice:Record<string,any>) {
 const order=await env.BILLING.prepare("SELECT o.*,b.customer FROM billing_orders o JOIN site_billing b ON b.user_id=o.user_id WHERE o.id=? AND o.kind='auto'").bind(invoice.metadata?.oassis_order||'').first<Record<string,any>>();
 if(!order)return;
 if(invoice.id!==order.invoice_id||invoice.customer!==order.customer||invoice.currency!=='usd'||invoice.subtotal!==order.cents||invoice.amount_paid!==order.cents||invoice.status!=='paid'||invoice.paid_out_of_band||typeof invoice.payment_intent!=='string')throw new Error('Invoice payment mismatch.');
 await fulfill(env,{id:invoice.payment_intent,metadata:{oassis_order:order.id},currency:'usd',customer:order.customer,amount_received:order.cents,status:'succeeded'});
 await env.BILLING.prepare('UPDATE billing_orders SET invoice_url=?,invoice_pdf=? WHERE id=?').bind(invoice.hosted_invoice_url||null,invoice.invoice_pdf||null,order.id).run();
}
export async function automaticTopups(env:Env):Promise<void> {
 if(!stripeReady(env)||env.STRIPE_TAX_ENABLED==='true')return;
 const month=Date.UTC(new Date().getUTCFullYear(),new Date().getUTCMonth(),1);
 const rows=await env.BILLING.prepare('SELECT b.* FROM site_billing b JOIN accounts a ON a.id=b.account_id WHERE b.auto_enabled=1 AND b.payment_method IS NOT NULL AND a.balance_micros-a.reserved_micros<b.threshold_cents*10000 LIMIT 50').all<Record<string,any>>();
 for(const row of rows.results){
  const id=crypto.randomUUID();
  await env.BILLING.prepare(`INSERT INTO billing_orders(id,user_id,cents,created_at,kind)
   SELECT ?,user_id,auto_cents,?,'auto' FROM site_billing WHERE user_id=? AND auto_enabled=1
   AND NOT EXISTS(SELECT 1 FROM billing_orders WHERE user_id=? AND kind='auto' AND state IN ('pending','review'))
   AND auto_cents+COALESCE((SELECT SUM(cents) FROM billing_orders WHERE user_id=? AND kind='auto' AND created_at>=? AND state!='failed'),0)<=monthly_cap_cents`)
   .bind(id,Date.now(),row.user_id,row.user_id,row.user_id,month).run();
  const pending=await env.BILLING.prepare("SELECT * FROM billing_orders WHERE user_id=? AND kind='auto' AND state='pending' LIMIT 1").bind(row.user_id).first<Record<string,any>>();
  if(!pending)continue;
  if(Date.now()-pending.created_at>23*3600000){await env.BILLING.prepare("UPDATE billing_orders SET state='review' WHERE id=? AND state='pending'").bind(pending.id).run();continue;}
  try {
   const invoice=await stripe(env,'invoices',{customer:row.customer,currency:'usd',collection_method:'charge_automatically',auto_advance:'false',default_payment_method:row.payment_method,'metadata[oassis_order]':pending.id},pending.id+':invoice');
   await env.BILLING.prepare('UPDATE billing_orders SET invoice_id=? WHERE id=?').bind(invoice.id,pending.id).run();
   await stripe(env,'invoiceitems',{customer:row.customer,invoice:invoice.id,currency:'usd',amount:String(pending.cents),description:'Oassis automatic prepaid top-up'},pending.id+':line');
   await stripe(env,'invoices/'+invoice.id+'/finalize',{auto_advance:'false'},pending.id+':finalize');
   const paid=await stripe(env,'invoices/'+invoice.id+'/pay',{off_session:'true'},pending.id+':pay');
   await fulfillInvoice(env,paid);
  }catch { /* Ambiguous network outcomes remain pending and retry with the same Stripe idempotency key. */ }
 }
}
