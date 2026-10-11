/**
 * Public contract and the boundary with the render provider.
 *
 * Everything the client sees lives here; a provider (Quick Actions today, our
 * own browser tomorrow) only has to satisfy `Renderer`.
 */

import type { BrowserWorker } from "@cloudflare/puppeteer";

/** Outputs a client can ask for in `formats`. */
export const FORMATS = [
  "html",
  "markdown",
  "links",
  "screenshot",
  "pdf",
  "elements",
  "json",
  "accessibility",
  "controls",
] as const;

export type Format = (typeof FORMATS)[number];

/** Browser Run actions the formats map onto. */
export type Action =
  | "content"
  | "markdown"
  | "links"
  | "screenshot"
  | "pdf"
  | "scrape"
  | "json"
  | "accessibilityTree";

/**
 * One finished render: the value that goes into `data[format]` plus the browser
 * time it cost, which is what gets billed.
 */
export interface RenderResult {
  value: unknown;
  browserMs: number;
  /** True when it came from the cache, so nothing was rendered or paid upstream. */
  cached?: boolean;
}

/**
 * The only point of contact with a browser. Option A (one Quick Action per
 * format) and option B (a single browser for all of them) differ only in who
 * implements this: the contract of /web/v1/scrape does not change, so clients
 * never notice the switch.
 */
export interface Renderer {
  run(action: Action, options: Record<string, unknown>): Promise<RenderResult>;
}

/** A render failure whose message is safe to show the client. */
export class RenderError extends Error {
  constructor(
    message: string,
    readonly browserMs = 0,
    readonly status?: number,
  ) {
    super(message);
    this.name = "RenderError";
  }
}

export interface ScrapeResponse {
  success: boolean;
  data: Partial<Record<Format, unknown>>;
  metadata: {
    url: string | null;
    formats: Format[];
    /** Billed renders. With the Quick Actions provider, one per format. */
    renders: number;
    /** Formats served from the cache: no render, and priced as a cache hit. */
    cached?: Format[];
    browserMsUsed: number;
    ms: number;
    title?: string;
    /** Present when the url was a document rather than a page. */
    document?: { contentType: string; bytes: number };
  };
  errors: Partial<Record<Format, string>>;
}

/**
 * The binding serves both Quick Actions (`quickAction`) and Puppeteer (which
 * needs the binding's own `fetch`), so it carries both faces.
 */
export type BrowserBinding = BrowserWorker & {
  quickAction(action: Action, options: Record<string, unknown>): Promise<Response>;
};

export interface Env {
  BASE_URL: string;
  SESSIONS: DurableObjectNamespace;
  /** Batch jobs: work that does not fit in one request. */
  JOBS: DurableObjectNamespace;
  /** Crawls: a batch that feeds itself from the links it finds. */
  CRAWLS: DurableObjectNamespace;
  BROWSER: BrowserBinding;
  /** Agent tasks: one object per task, which runs its steps from alarms. */
  AGENT_TASKS: DurableObjectNamespace;
  /** Accounts, API keys, transactions and sessions. Identity and money, nothing else. */
  BILLING: D1Database;
  /** Render cache. Optional: without it everything is rendered fresh. */
  CACHE?: KVNamespace;
  /** Document conversion (PDF, Word, Excel, CSV) with `toMarkdown`. No browser. */
  AI: {
    toMarkdown(
      files: { name: string; blob: Blob }[],
      options?: { conversionOptions?: Record<string, unknown> },
    ): Promise<unknown>;

    /** Workers AI text models. Used by agent tasks for planning and synthesis. */
    run(model: string, inputs: Record<string, unknown>): Promise<unknown>;
  };
  /** Address that receives x402 payments. Without it, that gate is closed. */
  X402_PAY_TO?: string;
  /** `base` (the default) or `base-sepolia` for testing. */
  X402_NETWORK?: string;
  X402_FACILITATOR_URL?: string;
  /** Model for agent tasks. Defaults to the one in agent/rates.ts. */
  AGENT_MODEL?: string;
  /**
   * Private key of the wallet that pays for search, hex with `0x`. Without it the search
   * route says so instead of failing mid-call. Keep it funded with little: it is a hot
   * wallet a Worker can sign with.
   */
  X402_WALLET_KEY?: string;
  /**
   * Address that key must belong to. Declaring it turns a mistyped or swapped key into a
   * refusal at the door instead of a payment attempt from an unexpected wallet. It must be
   * a plain EOA: a 7702-delegated account has code, and USDC then validates EIP-3009 by
   * EIP-1271 against the delegate, which will not accept a signature made with the key.
   */
  X402_WALLET_ADDRESS?: string;
  /** Coinbase keys. Without them there is no settling on Base mainnet. */
  CDP_API_KEY_ID?: string;
  CDP_API_KEY_SECRET?: string;
  /**
   * The console's password. Without both of these there is no `/console` at all: it answers
   * 404, so a deployment that never set them does not advertise a door to try.
   */
  CONSOLE_USER?: string;
  CONSOLE_PASS?: string;
}
