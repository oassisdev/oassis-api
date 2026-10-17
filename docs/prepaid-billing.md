# Prepaid website billing

Implemented for verified website users at `/dashboard/billing`. Packages: $5 = 2,500 credits; $20 = 10,000; $50 = 25,000. One credit = $0.002. One basic page costs one credit. Other operations consume their quoted dollar price / $0.002, including fractional credits. Existing balances remain in integer micro-dollars and are not reduced by migration. One-time or optional monthly purchases, with no scheduled purchased-credit expiry. MCP and HTTP API keys share this balance. x402 remains available independently.

## Activation

Card payments are deliberately disabled unless all three settings exist:

- `STRIPE_SECRET_KEY`: live-mode server key (`sk_live_` or `rk_live_`) with Customers, Checkout, PaymentIntents, Charges, Invoices, InvoiceItems and Billing Portal permissions.
- `STRIPE_WEBHOOK_SECRET`: signing secret of the production endpoint.
- `STRIPE_PAYMENTS_ENABLED`: exactly `true`, set only after business settings and payment validation are complete.

Create and activate the Stripe business account, configure the merchant's public information, receipts, invoice details and billing portal. Configure tax treatment before enabling payments. `STRIPE_TAX_ENABLED=true` enables Stripe Tax during manual Checkout and requires a configured Stripe Tax account. Automatic top-ups are intentionally unavailable with this flag, because a gross automatic-charge ceiling needs tax-aware reservation. Do not advertise taxed automatic top-ups as supported.

Webhook URL: `https://oassis.dev/api/billing/webhook`.
Subscribe to: `checkout.session.completed`, `payment_intent.succeeded`, `payment_intent.payment_failed`, `invoice.paid`, `invoice.payment_failed`, `charge.refunded`, `charge.dispute.created`.

Secret commands (enter values at the prompt, never as arguments):

    ./node_modules/.bin/wrangler secret put STRIPE_SECRET_KEY
    ./node_modules/.bin/wrangler secret put STRIPE_WEBHOOK_SECRET
    ./node_modules/.bin/wrangler secret put STRIPE_PAYMENTS_ENABLED

A successful browser redirect does not credit balance. The signed webhook and/or successful server-side automatic invoice settlement does. Stripe signature tolerance is five minutes. Test-mode events are ignored on the production endpoint; test keys cannot enable production purchases. Use an isolated Worker/database for end-to-end Stripe sandbox testing; the repository's tests mock Stripe rather than charging cards. Before accepting customers, complete a real-provider validation with the owner's approval.

## Accounting and safety

Migration `0007_prepaid.sql` adds customer settings, orders, cumulative refunds and atomic debit records. Each unique order credits an account once, using a database trigger on its transition to paid. Replayed events cannot duplicate the credit. Tool debits validate funds, move balance and insert the ledger entry in one SQL statement/trigger. Payment bodies are excluded from operational traces.

Orders and customer identity are created server-side from the authenticated user; clients cannot submit arbitrary Stripe customers or credit amounts. Only verified emails may purchase or spend. No card numbers or general API keys are created. History is scoped to the user's account, latest 100 records; financial records are not subject to the 30-day tool trace retention policy.

## Credit identity and trial

Verified website accounts receive 1,000 welcome credits once (atomic database trigger). API keys are created/revoked from /api/billing/keys and /api/billing/keys/revoke; raw secrets appear once and only hashes persist. Up to 10 active keys share one account balance. Bearer authentication works on MCP, HTTP Web Tools and Tasks. Invalid/revoked keys never fall back to anonymous access. GET /web/v1/account returns available/reserved credits. Requests are debited atomically with their ledger entry; active task holds are excluded from available balance.

Without a key, MCP exposes a lifetime 100-credit trial for scrape and map. It is counted in D1 using a salted hash of Cloudflare's connecting IP, not an editable client session ID. Changing client headers or reconnecting does not reset it. Shared networks share a trial; network changes can evade it. It is an anonymous trial, not a verified-person entitlement. Without a trusted address/auth secret the caller is asked to register. Discovery, feedback and owned status/cancellation are free. Old task access tokens continue working for status/cancellation.

## Monthly packages

Checkout subscription mode uses a server-controlled package amount and explicit consent. Only one active/pending monthly purchase per account. Invoice-paid events fetch the version-pinned Stripe invoice and subscription, validate customer, package, recurrence and amount, then use a unique invoice order to credit once. Credits accumulate. Cancel future renewals via /api/billing/subscription/cancel. A failed invoice grants no credits; insufficient balance stops paid work. No automatic charge occurs on exhaustion. Migration 0008 turns off the old low-balance auto-charge mode and the public API refuses re-enabling it.

Additional webhook events: checkout.session.expired, customer.subscription.updated, customer.subscription.deleted, invoice.paid, invoice.payment_failed. Configure the Stripe endpoint API version to 2024-06-20, matching the server requests. Do not allow customer-portal changes to package prices or quantities; cancellation/payment-method management only.

## Alerts

The five-minute cron saves low-credit (20% of balance after last purchase) and exhausted notices once per credit cycle, visible in the billing dashboard. Optional email delivery uses RESEND_API_KEY and BILLING_EMAIL_FROM (verified sender); without them notices remain visible and pending. Email delivery and real Stripe renewal/SCA flows still require validation after the owner's providers are configured. No real card has been charged by these tests.

## Tasks

With an API key, MCP/HTTP tasks reserve limits.max_cost_usd and settle actual execution cost, releasing unused credits. External HTTP starts require Idempotency-Key. Website tasks use the same account and engine. x402 tasks retain fixed-budget payment and task-scoped status/cancel tokens. Never create a free public MCP task balance for a new request.

## Deployment

Apply migrations through 0008 before deploying this code. Retain existing financial balances and keys. Run typecheck and all tests. Stripe card purchases stay disabled until live configuration and payment validation are complete.
