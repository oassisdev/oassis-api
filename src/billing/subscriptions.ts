import type { Env } from '../types';
import { stripe } from './stripe';
/** Verify the current Stripe object: webhook delivery may be duplicated or out of order. */
export async function syncSubscription(env:Env,id:string) {
 const sub=await stripe(env,'subscriptions/'+encodeURIComponent(id));
 const row=await env.BILLING.prepare('SELECT s.*,b.customer FROM credit_subscriptions s JOIN site_billing b ON b.user_id=s.user_id WHERE s.id=?').bind(sub.metadata?.oassis_subscription||'').first<Record<string,any>>();
 if(!row)return null;
 if(sub.customer!==row.customer || (row.stripe_id && row.stripe_id!==sub.id))throw new Error('Subscription identity mismatch');
 await env.BILLING.prepare('UPDATE credit_subscriptions SET stripe_id=?,state=?,cancel_at_period_end=? WHERE id=?').bind(sub.id,sub.status,sub.cancel_at_period_end?1:0,row.id).run();
 return {row,sub};
}
export async function fulfillSubscription(env:Env,eventInvoice:Record<string,any>) {
 const raw=eventInvoice.subscription??eventInvoice.parent?.subscription_details?.subscription;
 const subscription=typeof raw==='string'?raw:raw?.id;
 if(!subscription)return false;
 const match=await syncSubscription(env,subscription);
 if(!match)return false;
 const {row}=match;
 const invoice=await stripe(env,'invoices/'+encodeURIComponent(eventInvoice.id));
 if(invoice.subscription!==subscription || invoice.customer!==row.customer || invoice.currency!=='usd' || invoice.status!=='paid' || invoice.paid_out_of_band || invoice.subtotal!==row.cents || invoice.amount_paid!==invoice.total || invoice.amount_paid<row.cents || typeof invoice.payment_intent!=='string' || !['subscription_create','subscription_cycle'].includes(invoice.billing_reason))throw new Error('Subscription invoice mismatch');
 const lines=invoice.lines?.data;
 if(!Array.isArray(lines)||lines.length!==1||lines[0].proration||lines[0].quantity!==1||lines[0].price?.unit_amount!==row.cents||lines[0].price?.recurring?.interval!=='month')throw new Error('Subscription credit allocation mismatch');
 const id='invoice:'+invoice.id;
 await env.BILLING.prepare("INSERT INTO billing_orders(id,user_id,cents,created_at,kind,invoice_id) VALUES(?,?,?,?,'auto',?) ON CONFLICT(id) DO NOTHING").bind(id,row.user_id,row.cents,Date.now(),invoice.id).run();
 await env.BILLING.prepare("UPDATE billing_orders SET state='paid',payment_intent=?,invoice_url=?,invoice_pdf=? WHERE id=? AND state='pending'").bind(invoice.payment_intent,invoice.hosted_invoice_url||null,invoice.invoice_pdf||null,id).run();
 return true;
}
