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
import type { Env } from "./types";

/** Where a person writes when something is wrong. One address, answered by a person. */
export const SUPPORT_EMAIL = "oassistech@gmail.com";

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
  <a href="${base}/support">Support</a> ·
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
    "What oassis stores, for how long, and what it never collects. No names, no email addresses, and no scraped content kept in our database.",
    `
<h1>Privacy</h1>

<p class="muted">Last updated 1 October 2026.</p>

<p>oassis is an API that fetches web pages on behalf of whoever calls it. This page says
exactly what we keep while doing that. It describes the system we actually run, and it
changes when the system does.</p>

<h2>What we never collect</h2>

<ul>
  <li><strong>No account identity.</strong> An account is an opaque id and a balance. We do
  not ask for or store a name, an email address, a postal address or a phone number.</li>
  <li><strong>No passwords.</strong> There is no login. An API key is stored only as a hash,
  so a copy of our database does not let anyone call the API.</li>
  <li><strong>No payment instruments.</strong> We never see a card number. Wallet payments
  settle on a public blockchain and we keep only the transaction reference.</li>
  <li><strong>No conversation data.</strong> We do not read, request or store your prompts,
  chat history, files or anything else from the client calling us, beyond the parameters a
  tool needs to run.</li>
</ul>

<h2>What we store, and for how long</h2>

<table>
<thead><tr><th>What</th><th>Why</th><th>Kept</th></tr></thead>
<tbody>
<tr><td>Account id, balance, API key hash</td><td>To charge the right balance</td><td>Until the account is deleted</td></tr>
<tr><td>One row per billable call: time, amount, route, reference</td><td>So a charge can be explained and disputed</td><td>Until the account is deleted</td></tr>
<tr><td>Browser sessions and jobs: when opened, how much charged</td><td>Billing and support</td><td>Until the account is deleted</td></tr>
<tr><td>Feedback you choose to send</td><td>To fix what is broken</td><td>Until acted on</td></tr>
<tr><td>Rendered pages, cached</td><td>So a repeat read is cheaper for you</td><td>Short-lived, then discarded</td></tr>
<tr><td>A one-way fingerprint of the caller's IP address</td><td>To count free calls without accounts</td><td>Rolling daily counters</td></tr>
</tbody>
</table>

<h3>About the free tier and your IP address</h3>

<p>Calls made with no key and no account are counted against a <strong>one-way hash of the
IP address</strong>, truncated. We do this so a free allowance can exist at all without
asking anyone to sign up. <strong>The address itself is not stored</strong> in that counter,
and the hash cannot be turned back into it.</p>

<h3>About the pages you ask us to fetch</h3>

<p>We request the url you give us and return the result to you. The content is held only as
long as it takes to answer, plus a short cache so that asking twice costs you less. <strong>We
do not keep a copy of scraped content in our database</strong>, and we do not build a corpus
out of what our users read.</p>

<h2>Who else sees anything</h2>

<ul>
  <li><strong>The site you asked for.</strong> Fetching a page means contacting that site,
  which will see the request as it would any other.</li>
  <li><strong>Our hosting provider</strong>, who runs the servers and keeps short-lived
  operational logs on our behalf.</li>
  <li><strong>A search provider</strong>, but only for the search route, and only the query
  you sent. Every other route stays with us.</li>
  <li><strong>The public blockchain</strong>, for wallet payments, which are public by design.</li>
</ul>

<p>We do not sell data, we do not share it for advertising, and we do not pass it to anyone
not listed above.</p>

<h2>Your choices</h2>

<ul>
  <li><strong>Use it without an account.</strong> The free tier needs no identity at all.</li>
  <li><strong>Ask us to delete your account</strong> and everything attached to it, by writing
  to <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>. Because an account carries no
  personal details, deletion removes the balance, the key hashes and the charge history.</li>
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

export function supportPage(c: Context<{ Bindings: Env }>): string {
  const base = origin(c);
  return page(
    c,
    "Support",
    "How to get help with the oassis web scraping and crawling API: where to write, what to include, and how refunds work when a call fails.",
    `
<h1>Support</h1>

<p>Write to <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>. A person reads it, and
there is no ticket form to fill in first.</p>

<h2>Before you write, this may answer it</h2>

<ul>
  <li><strong>Every route explains itself.</strong> <code>GET ${base}/web/v1/scrape</code>
  returns the fields it expects and the price, free of charge. Same for every other route.</li>
  <li><strong>A failed call is not charged.</strong> If the work does not happen, the money
  is not taken — and if it was taken, it is returned. You do not need to ask.</li>
  <li><strong>The catalogue:</strong> <a href="${base}/openapi.json">OpenAPI</a> and
  <a href="${base}/llms.txt">llms.txt</a>.</li>
</ul>

<h2>What to include</h2>

<p>The route you called, the url you asked for, roughly when, and what you expected instead.
If you have an account, its id — never your API key, which we never need and cannot read
anyway.</p>

<h2>Reporting something that looks like a security problem</h2>

<p>Write to the same address with "security" in the subject, and please give us a chance to
fix it before telling anyone else. We answer these first.</p>

<h2>Billing</h2>

<p>Prices are quoted before any work happens and charged after it. A balance does not expire
and there is no monthly fee. If a charge looks wrong, write with the time and the route and
we will look it up and refund it if it is ours.</p>
`,
  );
}
