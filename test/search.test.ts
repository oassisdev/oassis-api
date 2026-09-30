import { describe, expect, it, vi } from "vitest";
import { searchRequest } from "../src/schema";
import { ENGINE, priceOfSearch, search, searchAvailable } from "../src/search/exa";
import type { Env } from "../src/types";

const parse = (v: unknown) => searchRequest.parse(v);

describe("what a search takes", () => {
  it("a query, and ten results by default", () => {
    const v = parse({ query: "x402 protocol" });
    expect(v.limit).toBe(10);
    expect(searchRequest.safeParse({}).success).toBe(false);
    expect(searchRequest.safeParse({ query: "" }).success).toBe(false);
  });

  it("caps the result count and refuses unknown fields", () => {
    expect(searchRequest.safeParse({ query: "a", limit: 200 }).success).toBe(false);
    expect(searchRequest.safeParse({ query: "a", engine: "google" }).success).toBe(false);
  });
});

describe("no wallet, no search", () => {
  // Hardhat's account #1: a key everybody already knows, which is why it holds nothing.
  const KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
  const ADDRESS = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";

  it("says so instead of failing halfway through", () => {
    expect(searchAvailable({} as Env)).toBe(false);
    expect(searchAvailable({ X402_WALLET_KEY: KEY } as Env)).toBe(true);
  });

  it("refuses a key that is not a key", () => {
    expect(searchAvailable({ X402_WALLET_KEY: "0xabc" } as Env)).toBe(false);
    expect(searchAvailable({ X402_WALLET_KEY: "   " } as Env)).toBe(false);
  });

  it("takes the key as MetaMask hands it out: bare hex, no 0x", () => {
    const bare = KEY.slice(2);
    expect(searchAvailable({ X402_WALLET_KEY: bare, X402_WALLET_ADDRESS: ADDRESS } as Env)).toBe(true);
    expect(searchAvailable({ X402_WALLET_KEY: `  ${bare}\n`, X402_WALLET_ADDRESS: ADDRESS } as Env)).toBe(true);
  });

  it("accepts the key of the declared address, whatever its case", () => {
    expect(searchAvailable({ X402_WALLET_KEY: KEY, X402_WALLET_ADDRESS: ADDRESS } as Env)).toBe(true);
    expect(
      searchAvailable({ X402_WALLET_KEY: KEY, X402_WALLET_ADDRESS: ADDRESS.toLowerCase() } as Env),
    ).toBe(true);
  });

  it("refuses the key of another wallet rather than paying from it", () => {
    const other = "0x0000000000000000000000000000000000001234";
    expect(searchAvailable({ X402_WALLET_KEY: KEY, X402_WALLET_ADDRESS: other } as Env)).toBe(false);
  });

  it("refuses to run without one", async () => {
    await expect(search({} as Env, parse({ query: "a" }))).rejects.toThrow(/no X402_WALLET_KEY/);
  });

  it("refuses to run with the wrong one", async () => {
    const env = { X402_WALLET_KEY: KEY, X402_WALLET_ADDRESS: "0x0000000000000000000000000000000000001234" } as Env;
    await expect(search(env, parse({ query: "a" }))).rejects.toThrow(/not the declared/i);
  });
});

describe("the price comes from Exa, not from us", () => {
  const challenge = (accepts: unknown) =>
    new Response(JSON.stringify({ accepts }), { status: 402, headers: { "content-type": "application/json" } });

  it("reads the amount for Base USDC", async () => {
    const fetched = globalThis.fetch;
    globalThis.fetch = vi.fn(async () =>
      challenge([
        { network: "solana:x", amount: "9999" },
        { network: "eip155:8453", amount: "7000" },
      ]),
    ) as unknown as typeof fetch;
    try {
      expect(await priceOfSearch(parse({ query: "a" }))).toBe(7_000);
    } finally {
      globalThis.fetch = fetched;
    }
  });

  it("a price rise needs no deploy: whatever the challenge says is what it costs", async () => {
    const fetched = globalThis.fetch;
    globalThis.fetch = vi.fn(async () =>
      challenge([{ network: "eip155:8453", amount: "12000" }]),
    ) as unknown as typeof fetch;
    try {
      expect(await priceOfSearch(parse({ query: "a" }))).toBe(12_000);
    } finally {
      globalThis.fetch = fetched;
    }
  });

  it("no amount on Base is an error, not a guess", async () => {
    const fetched = globalThis.fetch;
    globalThis.fetch = vi.fn(async () =>
      challenge([{ network: "solana:x", amount: "7000" }]),
    ) as unknown as typeof fetch;
    try {
      await expect(priceOfSearch(parse({ query: "a" }))).rejects.toThrow(/no amount on Base/);
    } finally {
      globalThis.fetch = fetched;
    }
  });

  it("an endpoint that stops charging is an error too: the price may have changed", async () => {
    const fetched = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;
    try {
      await expect(priceOfSearch(parse({ query: "a" }))).rejects.toThrow(/did not ask for payment/);
    } finally {
      globalThis.fetch = fetched;
    }
  });
});

describe("the engine is named", () => {
  it("because the price is its price", () => {
    expect(ENGINE).toBe("exa");
  });
});
