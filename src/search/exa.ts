/**
 * Web search, paid the same way our clients pay us.
 *
 * We have no index of the web and building one is not an option, so search means being
 * a middleman. What makes this one different is the plumbing: Exa sells `/search` over
 * x402 for USDC on Base — the same asset, same chain and same scheme we accept — so a
 * client pays us with a wallet, we pay Exa with a wallet, and there is no account,
 * contract or API key anywhere in the chain. Brave, the obvious alternative, has no
 * x402 at all and would have put a card and a key back in the middle.
 *
 * **The price is read from Exa's own challenge, never written here.** Asking costs
 * nothing: an unpaid request returns 402 with the amount, we charge the client exactly
 * that, and then we pay. If Exa changes its price, ours changes the same day with no
 * deploy. That is what makes "we pass the cost through" a fact instead of a promise.
 */

import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";
import type { PrivateKeyAccount } from "viem";
import type { Env } from "../types";
import type { SearchRequest } from "../schema";

const EXA_SEARCH = "https://api.exa.ai/search";

/** The engine is in the route, so it is in the response too. */
export const ENGINE = "exa";

export interface SearchResult {
  title: string;
  url: string;
  snippet?: string;
  publishedAt?: string;
  author?: string;
}

export interface SearchOutcome {
  results: SearchResult[];
  /** What we paid Exa, in micro-dollars: the same figure the client was charged. */
  paidMicros: number;
}

/**
 * The wallet that pays Exa, or the reason there is none.
 *
 * Derived once per isolate because a key operation per request is waste. When
 * `X402_WALLET_ADDRESS` is set, a key that belongs to another address is refused: paying
 * from a wallet nobody declared is worse than not searching.
 */
type Wallet = { account: PrivateKeyAccount } | { error: string };
let wallet: { key: string; declared: string; result: Wallet } | undefined;

function walletFor(env: Env): Wallet {
  const key = env.X402_WALLET_KEY ?? "";
  const declared = env.X402_WALLET_ADDRESS ?? "";
  if (wallet && wallet.key === key && wallet.declared === declared) return wallet.result;

  const result = derive(key, declared);
  if ("error" in result) console.warn(`search is off: ${result.error}`);
  wallet = { key, declared, result };
  return result;
}

/**
 * A private key as wallets hand it out. MetaMask shows it as 64 bare hex characters, so
 * demanding the `0x` would reject the exact string the operator was given. The address
 * check below is what guarantees the key is the right one, so being strict about the
 * prefix would buy nothing and cost a confusing refusal.
 */
function hexKey(key: string): `0x${string}` {
  const trimmed = key.trim();
  return (/^[0-9a-fA-F]{64}$/.test(trimmed) ? `0x${trimmed}` : trimmed) as `0x${string}`;
}

function derive(key: string, declared: string): Wallet {
  if (!key.trim()) return { error: "there is no X402_WALLET_KEY to pay with" };
  let account: PrivateKeyAccount;
  try {
    account = privateKeyToAccount(hexKey(key));
  } catch {
    return { error: "X402_WALLET_KEY is not a private key" };
  }
  if (declared && account.address.toLowerCase() !== declared.toLowerCase()) {
    return { error: `X402_WALLET_KEY is the key of ${account.address}, not the declared ${declared}` };
  }
  return { account };
}

/** No wallet, no search. Said out loud rather than failing halfway through. */
export function searchAvailable(env: Env): boolean {
  return "account" in walletFor(env);
}

/**
 * What this call will cost, straight from Exa. An unpaid request is free, so this is
 * the honest way to know the price before charging anybody.
 */
export async function priceOfSearch(req: SearchRequest): Promise<number> {
  const res = await fetch(EXA_SEARCH, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(exaBody(req)),
    signal: AbortSignal.timeout(10_000),
  });
  if (res.status !== 402) {
    throw new Error(`Exa did not ask for payment (HTTP ${res.status}): its pricing may have changed.`);
  }
  const challenge = (await res.json()) as { accepts?: { network?: string; amount?: string }[] };
  // Base USDC is what our own wallet holds; the other networks Exa offers are no use to
  // us today.
  const base = challenge.accepts?.find((a) => a.network === "eip155:8453" && a.amount);
  const amount = Number(base?.amount);
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error("Exa's payment challenge carried no amount on Base.");
  }
  return amount;
}

/** Runs the search, paying for it. */
export async function search(env: Env, req: SearchRequest): Promise<SearchOutcome> {
  const paying = walletFor(env);
  if ("error" in paying) throw new Error(`Search is not configured on this deployment: ${paying.error}.`);

  const client = registerExactEvmScheme(new x402Client(), { signer: paying.account });
  const pay = wrapFetchWithPayment(fetch, client);

  const res = await pay(EXA_SEARCH, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(exaBody(req)),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    throw new Error(`Exa answered HTTP ${res.status}.`);
  }

  const body = (await res.json()) as {
    results?: { title?: string; url?: string; text?: string; publishedDate?: string; author?: string }[];
    costDollars?: { total?: number };
  };

  const results = (body.results ?? []).map((r) => ({
    title: r.title ?? "",
    url: r.url ?? "",
    ...(r.text ? { snippet: r.text.replace(/\s+/g, " ").trim().slice(0, 500) } : {}),
    ...(r.publishedDate ? { publishedAt: r.publishedDate } : {}),
    ...(r.author ? { author: r.author } : {}),
  }));

  // Exa reports what it charged; when it does, that is more accurate than our estimate.
  const paidMicros = Math.round((body.costDollars?.total ?? 0) * 1_000_000);
  return { results, paidMicros };
}

/** Our request, in Exa's words. */
function exaBody(req: SearchRequest): Record<string, unknown> {
  return {
    query: req.query,
    numResults: req.limit,
    ...(req.snippets === false ? {} : { contents: { text: { maxCharacters: 1_000 } } }),
    ...(req.domains?.length ? { includeDomains: req.domains } : {}),
    ...(req.excludeDomains?.length ? { excludeDomains: req.excludeDomains } : {}),
    ...(req.since ? { startPublishedDate: req.since } : {}),
  };
}
