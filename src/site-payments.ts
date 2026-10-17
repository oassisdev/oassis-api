import type { Hono } from 'hono';
import type { Env } from './types';
import { createSiteAuth } from './site-auth';
import { ensureBilling, stripeReady, stripeCustomer, stripe, validSignature, fulfill, fulfillInvoice, PACKAGES } from './billing/stripe';
import { startTask, getTask, cancelTask, kick } from './agent/service';
import { CREDIT_MICROS, CREDIT_PACKAGES, creditsFor } from './billing/credits';
import { generateKey, hashKey } from './billing/accounts';
import { fulfillSubscription, syncSubscription } from './billing/subscriptions';
import { billingPage } from './site-payments-page';

/** Cookies authorize prepaid web requests only on the website, never on MCP or API hosts. */
export async function prepaidIdentity(env:Env,request:Request):Promise<string|null> {
 if(new URL(request.url).origin!=='https://oassis.dev'||!env.AUTH_SECRET||!request.headers.has('cookie'))return null;
 if(!['GET','HEAD'].includes(request.method)&&request.headers.get('origin')!=='https://oassis.dev')return null;
 const session=await createSiteAuth(env).api.getSession({headers:request.headers});
 return session?.user.emailVerified?'site:'+session.user.id:null;
}
export function mountSitePayments(app:Hono<{Bindings:Env}>) {
 app.use('*',async(c,next)=>{
  const path=new URL(c.req.url).pathname;
  if(path!=='/dashboard/billing'&&!path.startsWith('/api/billing/'))return next();
  c.header('cache-control','no-store');c.header('x-robots-tag','noindex,nofollow');c.header('referrer-policy','no-referrer');
  if(new URL(c.req.url).origin!=='https://oassis.dev')return c.notFound();
  if(path==='/api/billing/webhook'){
   if(c.req.method!=='POST')return c.body(null,405);
   if(!stripeReady(c.env))return c.json({error:'payments_not_configured'},503);
   const raw=await c.req.text();
   if(!await validSignature(raw,c.req.header('stripe-signature')||'',c.env.STRIPE_WEBHOOK_SECRET!))return c.json({error:'invalid_signature'},400);
   let event;try{event=JSON.parse(raw);}catch{return c.json({error:'invalid_payload'},400);}
   if(event.livemode!==true)return c.json({received:true,ignored:'test_event'});
   const obj=event.data?.object;
   try {
    if(event.type==='payment_intent.succeeded'&&c.env.STRIPE_TAX_ENABLED!=='true')await fulfill(c.env,obj);
    if(event.type==='invoice.paid'){if(!await fulfillSubscription(c.env,obj))await fulfillInvoice(c.env,obj);}
    if(event.type==='customer.subscription.updated'||event.type==='customer.subscription.deleted')await syncSubscription(c.env,obj.id);
    if(event.type==='checkout.session.expired'&&obj.metadata?.oassis_subscription)await c.env.BILLING.prepare("UPDATE credit_subscriptions SET state='expired' WHERE id=? AND state='pending' AND stripe_id IS NULL").bind(obj.metadata.oassis_subscription).run();
    if(event.type==='invoice.payment_failed'&&obj.metadata?.oassis_order){await c.env.BILLING.batch([c.env.BILLING.prepare('UPDATE site_billing SET auto_enabled=0 WHERE user_id=(SELECT user_id FROM billing_orders WHERE id=?)').bind(obj.metadata.oassis_order),c.env.BILLING.prepare("UPDATE billing_orders SET state='failed' WHERE id=? AND state='pending'").bind(obj.metadata.oassis_order)]);}
    if(event.type==='payment_intent.payment_failed'){
     const id=obj.metadata?.oassis_order;
     if(id)await c.env.BILLING.batch([
      c.env.BILLING.prepare("UPDATE site_billing SET auto_enabled=0 WHERE user_id=(SELECT user_id FROM billing_orders WHERE id=? AND kind='auto')").bind(id),
      c.env.BILLING.prepare("UPDATE billing_orders SET state='failed' WHERE id=? AND state='pending'").bind(id),
     ]);
    }
    if(event.type==='checkout.session.completed'&&obj.mode==='subscription'){await syncSubscription(c.env,obj.subscription);}
    if(event.type==='checkout.session.completed'&&obj.mode!=='subscription'&&obj.payment_status==='paid'){
     const intent=await stripe(c.env,'payment_intents/'+encodeURIComponent(obj.payment_intent));if(obj.amount_subtotal!==undefined&&obj.amount_total!==undefined&&intent.amount_received===obj.amount_total)intent.amount_received=obj.amount_subtotal;await fulfill(c.env,intent);
     if(obj.invoice){const invoice=await stripe(c.env,'invoices/'+encodeURIComponent(obj.invoice));await c.env.BILLING.prepare('UPDATE billing_orders SET invoice_url=?,invoice_pdf=? WHERE id=?').bind(invoice.hosted_invoice_url||null,invoice.invoice_pdf||null,obj.metadata?.oassis_order).run();}
    }
    if(event.type==='charge.refunded'||event.type==='charge.dispute.created'){
     const charge=event.type==='charge.refunded'?obj:await stripe(c.env,'charges/'+encodeURIComponent(obj.charge));
     const intent=await stripe(c.env,'payment_intents/'+encodeURIComponent(charge.payment_intent));
     let orderId=intent.metadata?.oassis_order;
     if(!orderId&&charge.invoice){const invoice=await stripe(c.env,'invoices/'+encodeURIComponent(charge.invoice));orderId=invoice.metadata?.oassis_order;}
     const order=await c.env.BILLING.prepare('SELECT * FROM billing_orders WHERE id=?').bind(orderId||'').first<Record<string,any>>();
     if(order&&charge.currency==='usd'){
      const cents=event.type==='charge.refunded'?Math.min(order.cents,Math.round(order.cents*charge.amount_refunded/charge.amount)):order.cents;
      await c.env.BILLING.prepare('INSERT INTO billing_refunds(payment_intent,user_id,cents,at) VALUES(?,?,?,?) ON CONFLICT(payment_intent) DO UPDATE SET cents=MAX(cents,excluded.cents),at=excluded.at').bind(intent.id,order.user_id,cents,Date.now()).run();
      await c.env.BILLING.prepare('UPDATE site_billing SET auto_enabled=0 WHERE user_id=?').bind(order.user_id).run();
     }
    }
    return c.json({received:true});
   }catch {return c.json({error:'payment_processing_failed'},500);}
  }
  if(!c.env.AUTH_SECRET)return c.json({error:'authentication_unavailable'},503);
  const session=await createSiteAuth(c.env).api.getSession({headers:c.req.raw.headers});
  if(!session)return path==='/dashboard/billing'?c.redirect('/login',303):c.json({error:'sign_in_required'},401);
  const row=await ensureBilling(c.env,session.user.id);
  const taskId=path.match(/^\/api\/billing\/tasks\/([^/]+)(?:\/(cancel))?$/);
  if(taskId && (c.req.method==='GET'||(c.req.method==='POST'&&taskId[2]==='cancel'&&c.req.header('origin')==='https://oassis.dev'))){
   const out=taskId[2]?await cancelTask(c.env,row.account_id,taskId[1]!):await getTask(c.env,row.account_id,taskId[1]!);
   return c.json('body' in out?out.body:out,out.status as 200);
  }
  if(c.req.method==='GET'){
   const orders=await c.env.BILLING.prepare('SELECT id,cents,created_at,kind,state,invoice_url,invoice_pdf FROM billing_orders WHERE user_id=? ORDER BY created_at DESC LIMIT 100').bind(session.user.id).all();
   const transactions=await c.env.BILLING.prepare('SELECT at,micros,concept,route,reference FROM transactions WHERE account=? ORDER BY at DESC,id DESC LIMIT 100').bind(row.account_id).all();
   const keys=await c.env.BILLING.prepare('SELECT prefix,label,created_at,revoked_at FROM api_keys WHERE account=? ORDER BY created_at DESC LIMIT 100').bind(row.account_id).all();
   const notices=await c.env.BILLING.prepare('SELECT at,level,message FROM credit_notices WHERE user_id=? ORDER BY at DESC LIMIT 20').bind(session.user.id).all();
   const subscription=await c.env.BILLING.prepare("SELECT cents,state,cancel_at_period_end FROM credit_subscriptions WHERE user_id=? ORDER BY created_at DESC LIMIT 1").bind(session.user.id).first();
   const data={credits:{available:creditsFor(row.balance_micros-row.reserved_micros),reserved:creditsFor(row.reserved_micros),unit_usd:CREDIT_MICROS/1e6,packages:CREDIT_PACKAGES},keys:keys.results,notices:notices.results,subscription,configured:stripeReady(c.env),verified:session.user.emailVerified,balance:row.balance_micros,reserved:row.reserved_micros,auto:{enabled:!!row.auto_enabled,cents:row.auto_cents,threshold:row.threshold_cents,monthlyCap:row.monthly_cap_cents,cardSaved:!!row.payment_method},orders:orders.results,transactions:transactions.results};
   return path==='/dashboard/billing'?c.html(billingPage(session.user.name,data)):path==='/api/billing/status'?c.json(data):c.notFound();
  }
  if(c.req.method!=='POST')return c.body(null,405);
  if(c.req.header('origin')!=='https://oassis.dev')return c.json({error:'untrusted_origin'},403);
  if(!session.user.emailVerified)return c.json({error:'Verify your email or sign in with a verified social provider first.'},403);
  const body=await c.req.json().catch(()=>null);
  if(!body)return c.json({error:'Invalid JSON.'},400);
  if(path==='/api/billing/keys'){
   const label=typeof body.label==='string'?body.label.trim():'';
   if(!label||label.length>60)return c.json({error:'Choose a key name (1–60 characters).'},400);
   const key=generateKey();const hash=await hashKey(key);const prefix=key.slice(0,16);
   const inserted=await c.env.BILLING.prepare('INSERT INTO api_keys(hash,account,prefix,created_at,label) SELECT ?,?,?,?,? WHERE (SELECT COUNT(*) FROM api_keys WHERE account=? AND revoked_at IS NULL)<10').bind(hash,row.account_id,prefix,Date.now(),label,row.account_id).run();
   if(!inserted.meta.changes)return c.json({error:'Revoke an existing key first; maximum 10 active keys.'},409);
   return c.json({key,prefix,label,message:'Copy this key now. It is shown only once.'},201);
  }
  if(path==='/api/billing/keys/revoke'){
   if(typeof body.prefix!=='string')return c.json({error:'Key prefix required.'},400);
   await c.env.BILLING.prepare('UPDATE api_keys SET revoked_at=? WHERE account=? AND prefix=? AND revoked_at IS NULL').bind(Date.now(),row.account_id,body.prefix).run();
   return c.json({revoked:true});
  }
  if(path==='/api/billing/tasks'){
   const idem=c.req.header('idempotency-key');
   if(!idem||!/^[-a-zA-Z0-9_:]{1,100}$/.test(idem))return c.json({error:'Idempotency-Key is required.'},400);
   const out=await startTask(c.env,{account:row.account_id,body,idempotencyKey:idem,baseUrl:'https://oassis.dev',deferKick:true});
   if(out.ok)await kick(c.env,out.taskId).catch(()=>null);
   return out.ok?c.json({...out,location:'/api/billing/tasks/'+out.taskId,billing:{channel:'prepaid',pricing:'reserve maximum budget; settle actual execution cost'}},202):c.json(out.error,out.error.status as 400);
  }
  if(path==='/api/billing/automatic'){
   if(body.enabled)return c.json({error:'Low-balance auto-charges are retired. Choose a one-time or monthly package.'},409);
   if(typeof body.enabled!=='boolean'||!PACKAGES.includes(body.cents)||!Number.isInteger(body.threshold)||body.threshold<50||body.threshold>1000||!Number.isInteger(body.monthlyCap)||body.monthlyCap<body.cents||body.monthlyCap>50000)return c.json({error:'Choose a valid top-up and a monthly cap between the top-up amount and $500.'},400);
   if(body.enabled&&c.env.STRIPE_TAX_ENABLED==='true')return c.json({error:'Automatic top-ups are unavailable with automatic tax; use manual purchases.'},409);
   if(body.enabled&&(!stripeReady(c.env)||!row.payment_method))return c.json({error:'Save a payment method during a successful top-up before enabling automatic payments.'},409);
   await c.env.BILLING.prepare('UPDATE site_billing SET auto_enabled=?,auto_cents=?,threshold_cents=?,monthly_cap_cents=? WHERE user_id=?').bind(body.enabled?1:0,body.cents,body.threshold,body.monthlyCap,session.user.id).run();
   return c.json({saved:true});
  }
  if(!stripeReady(c.env))return c.json({error:'Card payments are awaiting Stripe configuration.'},503);
  try {
   if(path==='/api/billing/subscription/cancel'){
    const sub=await c.env.BILLING.prepare("SELECT * FROM credit_subscriptions WHERE user_id=? AND state IN ('active','trialing','past_due','unpaid')").bind(session.user.id).first<Record<string,any>>();
    if(!sub?.stripe_id)return c.json({error:'No active subscription.'},409);
    await stripe(c.env,'subscriptions/'+encodeURIComponent(sub.stripe_id),{cancel_at_period_end:'true'},'cancel:'+sub.id);
    await syncSubscription(c.env,sub.stripe_id);return c.json({cancel_at_period_end:true});
   }
   if(path==='/api/billing/subscription'){
    if(!PACKAGES.includes(body.cents)||!/^[-a-zA-Z0-9]{20,80}$/.test(body.requestId||'')||body.consent!==true)return c.json({error:'Select a package and explicitly accept monthly billing.'},400);
    const customer=await stripeCustomer(c.env,session.user.id,session.user.email);const id=session.user.id+':'+body.requestId;
    try {await c.env.BILLING.prepare('INSERT INTO credit_subscriptions(id,user_id,cents,created_at) VALUES(?,?,?,?) ON CONFLICT(id) DO NOTHING').bind(id,session.user.id,body.cents,Date.now()).run();}catch{return c.json({error:'An active or pending monthly purchase already exists. Finish it or let Checkout expire before starting another.'},409);}
    const existing=await c.env.BILLING.prepare('SELECT * FROM credit_subscriptions WHERE id=?').bind(id).first<Record<string,any>>();
    if(!existing||existing.cents!==body.cents||existing.state!=='pending')return c.json({error:'Subscription request conflict.'},409);
    const checkout=await stripe(c.env,'checkout/sessions',{mode:'subscription',customer,'payment_method_types[0]':'card','line_items[0][price_data][currency]':'usd','line_items[0][price_data][unit_amount]':String(body.cents),'line_items[0][price_data][recurring][interval]':'month','line_items[0][price_data][product_data][name]':'Oassis '+creditsFor(body.cents*10000)+' monthly credits','line_items[0][quantity]':'1','metadata[oassis_subscription]':id,'subscription_data[metadata][oassis_subscription]':id,...(c.env.STRIPE_TAX_ENABLED==='true'?{'automatic_tax[enabled]':'true','customer_update[address]':'auto','billing_address_collection':'required'}:{}),success_url:'https://oassis.dev/dashboard/billing?checkout=success',cancel_url:'https://oassis.dev/dashboard/billing?checkout=cancelled'},'subscription:'+id);
    return c.json({url:checkout.url});
   }
   if(path==='/api/billing/checkout'){
    if(!PACKAGES.includes(body.cents)||typeof body.saveCard!=='boolean'||!/^[-a-zA-Z0-9]{20,80}$/.test(body.requestId||''))return c.json({error:'Invalid top-up request.'},400);
    const customer=await stripeCustomer(c.env,session.user.id,session.user.email);
    const id=session.user.id+':'+body.requestId;
    await c.env.BILLING.prepare("INSERT INTO billing_orders(id,user_id,cents,created_at,kind,save_card) VALUES(?,?,?,?,'manual',?) ON CONFLICT(id) DO NOTHING").bind(id,session.user.id,body.cents,Date.now(),body.saveCard?1:0).run();
    const order=await c.env.BILLING.prepare('SELECT cents,save_card FROM billing_orders WHERE id=?').bind(id).first<Record<string,any>>();
    if(order?.cents!==body.cents||!!order?.save_card!==body.saveCard)return c.json({error:'This request was already used with different settings.'},409);
    const checkout=await stripe(c.env,'checkout/sessions',{mode:'payment',customer,'payment_method_types[0]':'card','line_items[0][price_data][currency]':'usd','line_items[0][price_data][unit_amount]':String(body.cents),'line_items[0][price_data][product_data][name]':'Oassis '+creditsFor(body.cents*10000)+' credits','line_items[0][quantity]':'1','metadata[oassis_order]':id,'payment_intent_data[metadata][oassis_order]':id,'invoice_creation[enabled]':'true',...(c.env.STRIPE_TAX_ENABLED==='true'?{'automatic_tax[enabled]':'true','customer_update[address]':'auto','billing_address_collection':'required'}:{}),...(body.saveCard?{'payment_intent_data[setup_future_usage]':'off_session'}:{}),success_url:'https://oassis.dev/dashboard/billing?checkout=success',cancel_url:'https://oassis.dev/dashboard/billing?checkout=cancelled'},id);
    return c.json({url:checkout.url});
   }
   if(path==='/api/billing/portal'){
    if(!row.customer)return c.json({error:'Make a purchase first.'},409);
    const portal=await stripe(c.env,'billing_portal/sessions',{customer:row.customer,return_url:'https://oassis.dev/dashboard/billing'});return c.json({url:portal.url});
   }
   return c.notFound();
  }catch{return c.json({error:'The payment service is unavailable. No balance has been added. Please try again.'},502);}
 });
}
