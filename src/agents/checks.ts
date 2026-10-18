/**
 * What one run of each service does. The parsing helpers are pure, so the rules that decide
 * a price or a change can be tested without a browser.
 */
import type { Env } from "../types";
import { scrapeRequest } from "../schema";
import { read } from "../scrape";
import { QuickActionsRenderer } from "../quick-actions";

export interface Price {
  amount: number;
  currency: string;
  source: "json-ld" | "meta" | "text";
}

const SYMBOLS: Record<string, string> = { "$": "USD", "€": "EUR", "£": "GBP", USD: "USD", EUR: "EUR", GBP: "GBP" };

/** "1.234,56" and "1,234.56" both mean 1234.56; a lone comma with two digits is a decimal. */
export function parseAmount(raw: string): number | null {
  let s = raw.replace(/\s/g, "");
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma > -1 && lastDot > -1) {
    s = lastComma > lastDot ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (lastComma > -1) {
    s = /,\d{2}$/.test(s) ? s.replace(",", ".") : s.replace(/,/g, "");
  }
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** The product's price, from structured data first, then a meta tag, then visible text. */
export function extractPrice(html: string, markdown: string): Price | null {
  const ld = /"price"\s*:\s*"?(\d+(?:[.,]\d{1,2})?)"?/.exec(html);
  if (ld) {
    const currency = /"priceCurrency"\s*:\s*"([A-Z]{3})"/.exec(html)?.[1] ?? "USD";
    const amount = parseAmount(ld[1]!);
    if (amount !== null) return { amount, currency, source: "json-ld" };
  }
  const meta = /<meta[^>]+property=["']product:price:amount["'][^>]+content=["']([^"']+)["']/i.exec(html);
  if (meta) {
    const currency = /<meta[^>]+property=["']product:price:currency["'][^>]+content=["']([A-Z]{3})["']/i.exec(html)?.[1] ?? "USD";
    const amount = parseAmount(meta[1]!);
    if (amount !== null) return { amount, currency, source: "meta" };
  }
  const text = /(\$|€|£|USD|EUR|GBP)\s?(\d{1,3}(?:[.,\s]\d{3})*(?:[.,]\d{2})?|\d+(?:[.,]\d{2})?)/.exec(markdown);
  if (text) {
    const amount = parseAmount(text[2]!);
    const currency = SYMBOLS[text[1]!];
    if (amount !== null && currency) return { amount, currency, source: "text" };
  }
  return null;
}

export async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const MAX_LINES = 12;

/** Lines that appear in only one of the two texts. Blank and repeated lines are ignored. */
export function changedLines(before: string, after: string): { added: string[]; removed: string[] } {
  const lines = (t: string) => new Set(t.split("\n").map((l) => l.trim()).filter((l) => l.length > 2));
  const a = lines(before);
  const b = lines(after);
  const added = [...b].filter((l) => !a.has(l)).slice(0, MAX_LINES);
  const removed = [...a].filter((l) => !b.has(l)).slice(0, MAX_LINES);
  return { added, removed };
}

/** A change matters for a keyword watch only when one of the changed lines names a keyword. */
export function matchesKeywords(lines: string[], keywords: string[]): boolean {
  if (keywords.length === 0) return true;
  const words = keywords.map((k) => k.toLowerCase());
  return lines.some((l) => words.some((w) => l.toLowerCase().includes(w)));
}

export interface Snapshot {
  hash: string;
  text: string;
  price?: Price | null;
}

export interface Target {
  url: string;
  status: "ok" | "error";
  change: "first_read" | "unchanged" | "changed" | "price_changed" | "error";
  price?: Price | null;
  previous_price?: Price | null;
  added?: string[];
  removed?: string[];
  error?: string;
}

/** Text of a page: the markdown, capped so one page cannot fill the snapshot store. */
const MAX_TEXT = 30_000;

export async function readTarget(env: Env, url: string): Promise<{ markdown: string; html: string } | { error: string }> {
  const req = scrapeRequest.parse({ url, formats: ["markdown", "html"] });
  const res = await read(req, new QuickActionsRenderer(env.BROWSER), env);
  if (!res.success) return { error: "The page could not be read." };
  const markdown = typeof res.data.markdown === "string" ? res.data.markdown : "";
  const html = typeof res.data.html === "string" ? res.data.html : "";
  return { markdown: markdown.slice(0, MAX_TEXT), html: html.slice(0, MAX_TEXT * 4) };
}

/** Compares one read with the previous snapshot and returns the target's report plus the new snapshot. */
export async function compare(
  url: string,
  page: { markdown: string; html: string },
  previous: Snapshot | undefined,
  kind: "price" | "text",
): Promise<{ target: Target; snapshot: Snapshot }> {
  const hash = await sha256(page.markdown);
  const price = kind === "price" ? extractPrice(page.html, page.markdown) : null;
  const snapshot: Snapshot = { hash, text: page.markdown, price };
  if (!previous) return { target: { url, status: "ok", change: "first_read", price }, snapshot };
  if (previous.hash === hash) return { target: { url, status: "ok", change: "unchanged", price }, snapshot };
  const { added, removed } = changedLines(previous.text, page.markdown);
  if (kind === "price" && previous.price && price && previous.price.amount !== price.amount) {
    return {
      target: { url, status: "ok", change: "price_changed", price, previous_price: previous.price, added, removed },
      snapshot,
    };
  }
  return { target: { url, status: "ok", change: "changed", price, added, removed }, snapshot };
}
