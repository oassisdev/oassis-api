/**
 * The two pages a directory asks for before it will list you, and that a person
 * reading about an API that takes money looks for anyway: what we keep, and where
 * to write when something breaks.
 *
 * **Both must stay true.** A privacy policy that describes a system we no longer run
 * is worse than none: it is a promise in writing. When the tables or the counters
 * change, this file changes in the same commit.
 */

import type { Context } from "hono";
import { ICON_LINKS } from "./icon";
import { STYLE } from "./landing";
import { origin } from "./http";
import { TRACE_DAYS } from "./traces";
import type { Env } from "./types";

/** Where a person writes when something is wrong. One address, answered by a person. */
export const SUPPORT_EMAIL = "support@oassis.dev";

const page = (c: Context<{ Bindings: Env }>, title: string, description: string, body: string) => {
  const base = origin(c);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} — oassis</title>
<meta name="description" content="${description}">
<link rel="canonical" href="${base}/${title.toLowerCase().split(" ")[0]}">
${ICON_LINKS}
${STYLE}
</head>
<body>
<div class="wrap">
<p class="nav"><a href="${base}/">← oassis</a></p>
${body}
<footer>
  oassis · <a href="${base}/privacy">Privacy</a> ·
  <a href="${base}/terms">Terms</a> ·
  <a href="${base}/llms.txt">llms.txt</a>
</footer>
</div>
</body>
</html>`;
};

export function privacyPage(c: Context<{ Bindings: Env }>): string {
  return page(
    c,
    "Privacy",
    "What Oassis stores for API calls and optional website accounts, including authentication cookies and account deletion.",
    `
<h1>Privacy</h1>

<p class="muted">Last updated 17 October 2026.</p>

<p>oassis is an API that fetches web pages on behalf of whoever calls it. This page says
exactly what we keep while doing that. It describes the system we actually run, and it
changes when the system does.</p>

<h2>What we never collect</h2>

<ul>
  <li><strong>No account required for API access.</strong> MCP offers a 100-credit trial for scrape and map. Further use requires a verified account and an API key with credits. HTTP tools also support x402 without an account.</li>
  <li><strong>No plaintext passwords.</strong> For website accounts we store a salted password hash, never your password. Authentication request and response bodies are excluded from the tool request log.</li>
  <li><strong>No card numbers.</strong> Stripe handles card entry and storage. We store Stripe customer and payment-method identifiers, payment amounts and invoice links, not full card numbers. Wallet payments settle on a public blockchain.</li>
  <li><strong>No conversation data.</strong> We do not read, request or store your prompts,
  chat history, files or anything else from the client calling us, beyond the parameters a
  tool needs to run.</li>
</ul>

<h2>What we store, and for how long</h2>

<table>
<thead><tr><th>What</th><th>Why</th><th>Kept</th></tr></thead>
<tbody>
<tr><td>Optional website account: email, display name, verification status, password hash or linked OAuth provider id and encrypted OAuth tokens</td><td>To create and authenticate your website account</td><td>Until the account is deleted</td></tr>
<tr><td>Website sessions, IP address and user-agent</td><td>Secure login and abuse prevention</td><td>Sessions expire after 7 days; expired records may remain until account deletion</td></tr>
<tr><td>Authentication rate-limit records</td><td>Prevent repeated password guessing</td><td>Until operational cleanup or account deletion where identifiable</td></tr>
<tr><td>Legacy billing account id, balance, API key hash</td><td>To charge the right balance</td><td>Until the account is deleted</td></tr>
<tr><td>One row per billable call: time, amount, route, reference</td><td>So a charge can be explained and disputed</td><td>Until the account is deleted</td></tr>
<tr><td>Browser sessions and jobs: when opened, how much charged</td><td>Billing and support</td><td>Until the account is deleted</td></tr>
<tr><td>Feedback you choose to send</td><td>To fix what is broken</td><td>Until acted on</td></tr>
<tr><td>Rendered pages, cached</td><td>So a repeat read is cheaper for you</td><td>Short-lived, then discarded</td></tr>
<tr><td>A short request log: time, route, status, how long it took, your IP, your
user-agent, and a truncated copy of the request and the answer</td><td>So a call can be
explained when something goes wrong</td><td>${TRACE_DAYS} days, or until the current UTC calendar month ends if longer (up to 31 days)</td></tr>
</tbody>
</table>

<h3 id="cookies">Website cookies and social sign-in</h3>
<p>Signing in sets essential, Secure, HttpOnly session cookies for oassis.dev. They are not advertising cookies. Your browser may store your last successful sign-in method to display “Last used”. If you choose an enabled Google or GitHub sign-in, that provider authenticates you and shares your profile and email with Oassis under its own privacy policy. Social sign-in may not be available until configured.</p>
<h3>Calls with no key and your IP address</h3>

<p>Calls made with no key and no account are not counted per address: there is no daily allowance to keep. The request log above still records the address of each call.</p>

<h3>About the request log</h3>

<p>We keep a short operational log of recent requests so that a call can be explained when
something goes wrong. It is retained for ${TRACE_DAYS} days without a row-count limit. The current UTC calendar month is also kept complete, for up to 31 days; older entries are
removed during maintenance. The bodies are stored truncated — enough to see what was
asked for, not a copy of the answer. Large responses are recorded as a size and never read.
It is read by us, to run the service, and by nobody else.</p>

<h3>About the pages you ask us to fetch</h3>

<p>We request the url you give us and return the result to you. The content is held only as
long as it takes to answer, plus a short cache so that asking twice costs you less. <strong>We
do not keep a copy of scraped content in our database</strong>, and we do not build a corpus
out of what our users read.</p>

<h2>Card payments and prepaid balance</h2><p>When enabled, Stripe processes card payments and billing details. We retain your customer identifier, saved payment-method identifier if you consent, purchase and refund records, balance movements and automatic top-up settings. Authentication and billing bodies are excluded from tool traces. Financial records may need retention for accounting and disputes after account deletion.</p>
<h2>Who else sees anything</h2>

<ul>
  <li><strong>The site you asked for.</strong> Fetching a page means contacting that site,
  which will see the request as it would any other.</li>
  <li><strong>Our hosting provider</strong>, who runs the servers and keeps short-lived
  operational logs on our behalf.</li>
  <li><strong>A search provider</strong>, but only for the search route, and only the query
  you sent. Every other route stays with us.</li>
  <li><strong>Your sign-in provider</strong>, if you choose Google or GitHub when available, to authenticate your website account.</li>
  <li><strong>Stripe</strong>, when you choose card payments, to process your payment and provide invoices.</li>
  <li><strong>The public blockchain</strong>, for wallet payments, which are public by design.</li>
</ul>

<p>We do not sell data, we do not share it for advertising, and we do not pass it to anyone
not listed above.</p>

<h2>Your choices</h2>

<ul>
  <li><strong>Use it without an account.</strong> MCP and x402 do not require a website account.</li>
  <li><strong>Ask us to delete your account</strong> and everything attached to it, by writing
  to <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>. Deletion removes your website identity, linked provider records and sessions. Blockchain transactions remain public; operational and billing records may need to be retained to resolve charges.</li>
  <li><strong>Ask what we hold</strong> at the same address.</li>
</ul>

<h2>Children</h2>

<p>oassis is a developer tool and is not directed at children.</p>

<h2>Changes</h2>

<p>If this policy changes, the date at the top changes with it.</p>

<h2>Contact</h2>

<p>Write to <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>. A person reads it.</p>
`,
  );
}

export function termsPage(c: Context<{ Bindings: Env }>): string {
  const base = origin(c);
  return page(
    c,
    "Terms",
    "The terms for using the oassis web scraping and crawling API: what you may ask it to fetch, how billing works, and what we do not promise.",
    `
<h1>Terms of service</h1>

<p class="muted">Last updated 17 October 2026.</p>

<p>These terms cover the oassis API at <code>${base}</code> and the MCP server at
<code>${base}/mcp</code>. Using either means accepting them. They are written to be read, not
to be survived.</p>

<h2>What the service does</h2>

<p>oassis fetches web pages and documents you name, converts them, lists and crawls sites you
name, drives a browser session on your behalf, and passes a search query to a search provider.
It acts on <strong>your</strong> instructions, as your agent, against the urls you choose.</p>

<h2>Optional prepaid payments</h2><p>Website users with a verified email can purchase USD-denominated balance when card payments are enabled. Available packages and any applicable taxes are shown before payment. Purchased balance has no scheduled expiry and is used at the operation prices shown by Oassis. Contact support about refunds or disputed charges.</p><p>Monthly purchases are optional and require explicit authorization. Your selected package is charged monthly; purchased credits accumulate without scheduled expiry. Cancel future renewals from Balance &amp; billing. Exhausting credits does not trigger an extra charge.</p><p>Prepaid research tasks reserve the selected maximum budget, settle actual execution charges, and release unused funds. This differs from the fixed execution package paid through x402. MCP and API-key HTTP calls consume the same account credits. One basic page costs one credit ($0.002). Verified accounts receive 1,000 welcome credits once; generating more API keys does not grant more credits.</p>

<h2>What you are responsible for</h2>

<p>This is the part that matters most, so it is not buried.</p>

<ul>
  <li><strong>You must have the right to access what you ask for.</strong> You are responsible
  for complying with the terms, licences and access rules of the sites you point us at, and for
  any law that applies to you or to that content. Asking us to fetch a page does not transfer
  that responsibility to us, and it does not grant you rights you did not already have.</li>
  <li><strong>robots.txt.</strong> Free calls honour it: those requests leave our
  infrastructure with no account behind them, so they answer to us. <strong>Paid calls do
  not</strong> — a paying caller is identified and answers for their own access. If you need
  robots.txt enforced on your paid traffic, write to us.</li>
  <li><strong>No circumvention.</strong> Do not use oassis to defeat a paywall, a login, a
  rate limit, a block or any other access control, or to collect personal data unlawfully.</li>
  <li><strong>No overwhelming anybody.</strong> Including us. Crawls and batches exist so that
  volume is paced and paid for; do not route around them.</li>
</ul>

<p>We may refuse or stop a request, and suspend an account, when it breaks these rules. We
would rather write to you first, and usually will.</p>

<h2>Paying</h2>

<ul>
  <li><strong>Per call, quoted first.</strong> The price of a call is in the <code>402</code>
  answer before any work happens, and it is charged after the work happens.</li>
  <li><strong>Work that does not happen is not charged.</strong> A request we cannot serve
  costs nothing, and a crawl or batch you cancel refunds the pages it never read. You do not
  have to ask.</li>
  <li><strong>A balance does not expire</strong> and there is no monthly fee. Prepaid balance
  is not otherwise refundable.</li>
  <li><strong>Wallet payments are final.</strong> A payment settled on a public blockchain
  cannot be reversed by us. Mistakes are handled as credit, not as a chain transaction.</li>
  <li><strong>Prices can change.</strong> The price that applies is the one quoted in the
  challenge for that call, which is why we quote it on every single one.</li>
</ul>

<h2>What we do not promise</h2>

<p>The service is provided as it is. <strong>We do not promise an uptime figure, a response
time, or that any particular site will be readable</strong> — sites change, block automation,
or go down, and that is outside our control. We do not promise the content we return is
accurate, complete or current: it is what the page said when we read it.</p>

<p>To the extent the law allows, we are not liable for indirect or consequential loss, and our
total liability for any claim is limited to what you paid us in the three months before it.
Nothing here limits liability that cannot be limited.</p>

<h2>Your content and ours</h2>

<p>You keep whatever rights you have in what you ask for and what comes back. We claim no
ownership of it, and we do not build a corpus out of what our users read — see the
<a href="${base}/privacy">privacy policy</a> for what we keep and for how long.</p>

<p>The source code is published under the Elastic License 2.0, which governs the code and not
this service. Using the API grants you no licence to the code beyond that.</p>

<h2>Ending it</h2>

<p>You can stop at any time; there is nothing to cancel. We can suspend or end an account that
breaks these terms, and we will refund any unused prepaid balance unless the reason for the
suspension was fraud or abuse.</p>

<h2>Changes</h2>

<p>If these terms change, the date at the top changes with them. A change that materially
reduces what you get applies from when it is published, not retroactively.</p>

<h2>Contact</h2>

<p>Write to <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>. A person reads it.</p>
`,
  );
}

/**
 * A robot agent with a magnifying glass, looking at a web with one thread missing. Drawn
 * in the page's own colours, so it reads in light and dark.
 */
const LOST_ROBOT = `<svg viewBox="0 0 320 230" role="img" aria-label="A confused robot agent holds a magnifying glass up to a web that is missing one thread, while a spider dangles above it">
<g fill="none" stroke="currentColor" stroke-width="1.5" opacity=".3">
<circle cx="240" cy="120" r="40"/><circle cx="240" cy="120" r="70"/>
<path d="M240 120 L340 120 M240 120 L311 191 M240 120 L240 220 M240 120 L169 191 M240 120 L140 120 M240 120 L240 20 M240 120 L311 49"/>
</g>
<path d="M240 120 L169 49" fill="none" stroke="#b57912" stroke-width="2" stroke-dasharray="5 6"/>
<text x="176" y="34" font-size="22" font-weight="700" fill="#b57912" font-family="ui-monospace, Menlo, monospace">?</text>
<g fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
<path d="M75 72 V58"/>
<rect x="48" y="72" width="54" height="44" rx="10" style="fill:var(--bg)"/>
<rect x="40" y="120" width="70" height="66" rx="12" style="fill:var(--bg)"/>
<path d="M40 138 L26 160 M110 138 L124 120 M58 186 V206 M92 186 V206"/>
<path d="M62 106 q6 -5 12 0 t12 0" stroke-width="2"/>
<circle cx="146" cy="96" r="18" stroke-width="3"/>
<path d="M133 109 L122 120" stroke-width="4"/>
</g>
<circle cx="75" cy="54" r="4" fill="#b57912"/>
<circle cx="63" cy="92" r="6" fill="currentColor"/>
<circle cx="87" cy="88" r="6" fill="currentColor"/>
<path d="M276 0 V30" stroke="currentColor" stroke-width="1.5"/>
<ellipse cx="276" cy="40" rx="7" ry="9" fill="currentColor"/>
<path d="M269 36 l-8 -4 M269 44 l-8 4 M283 36 l8 -4 M283 44 l8 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
</svg>`;

/** An address that is not a page here. A person gets a way back; the API hosts keep their JSON. */
export function notFoundPage(c: Context<{ Bindings: Env }>): string {
  const base = origin(c);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Page not found — oassis</title>
<meta name="description" content="There is no page at this address on oassis.dev.">
${ICON_LINKS}
${STYLE}
<style>.lost svg { display:block; width:100%; max-width:320px; height:auto; margin:8px 0 24px; color:var(--fg) }</style>
</head>
<body>
<div class="wrap">
<p class="nav"><a href="${base}/">← oassis</a></p>
<h1>Page not found</h1>
<figure class="lost">${LOST_ROBOT}</figure>
<p>Our agent checked every link, and this address was not one of them. Start from the <a href="${base}/">home page</a>, or read the <a href="${base}/docs">documentation</a>.</p>
</div>
</body>
</html>`;
}
