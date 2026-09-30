/**
 * Who paid, when they paid with a wallet.
 *
 * A key identifies its account. A wallet payment identifies nothing by default, and that
 * was a hole rather than a feature: every wallet caller looked like the same anonymous
 * "nobody", so they all passed each other's ownership checks and could drive each other's
 * browser sessions.
 *
 * The payment itself carries the answer. An x402 `exact` payment is a signed EIP-3009
 * authorisation, and the address that signed it is in the header the client sent. That
 * address becomes the caller's identity — `wallet:0x…` — which slots into the same account
 * column everything else already uses, so sessions, jobs and history work unchanged.
 *
 * It is an identity, not a name: we learn an address, never a person. Coinbase's Agentic
 * Wallet asks its user for an email, but that is between them and Coinbase; we never see
 * it, and this is the only thing about a wallet caller we ever know.
 */

/** The header an x402 client sends with its signed payment. */
const PAYMENT_HEADER = "x-payment";

/** `wallet:0x…` — the shape the rest of the code treats as an account id. */
export function walletIdentity(address: string): string {
  return `wallet:${address.toLowerCase()}`;
}

/**
 * The address that signed the payment on this request, or null when there is none to read.
 * Never throws: a malformed header is simply an unknown payer, and the payment middleware
 * has already decided whether the payment itself was valid.
 */
export function payerAddress(paymentHeader: string | undefined): string | null {
  if (!paymentHeader) return null;
  try {
    const decoded = JSON.parse(atob(paymentHeader)) as {
      payload?: { authorization?: { from?: string }; from?: string };
    };
    const from = decoded.payload?.authorization?.from ?? decoded.payload?.from;
    if (typeof from !== "string") return null;
    // An EVM address and nothing else: anything else is not something to key on.
    return /^0x[0-9a-fA-F]{40}$/.test(from) ? from.toLowerCase() : null;
  } catch {
    return null;
  }
}

/** Reads the payer from a request's headers. */
export function payerFromHeaders(headers: Headers): string | null {
  return payerAddress(headers.get(PAYMENT_HEADER) ?? undefined);
}
