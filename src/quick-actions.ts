/**
 * Option A: one render per format, delegating to Browser Run Quick Actions
 * through the `BROWSER` binding (no API token).
 *
 * Cost: every format opens its own page, so asking for four formats costs four
 * renders. `metadata.browserMsUsed` says so in every response. Once there is
 * volume, option B (a single browser for all of them) implements the same
 * `Renderer` and the API contract does not move.
 */

import { RenderError, type Action, type BrowserBinding, type RenderResult, type Renderer } from "./types";

/** Actions whose response is the binary itself, not JSON. */
const BINARY: ReadonlySet<Action> = new Set<Action>(["screenshot", "pdf"]);

function base64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = "";
  // In chunks: `String.fromCharCode(...bytes)` blows the stack on a PDF.
  for (let i = 0; i < bytes.length; i += 8192) {
    s += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return btoa(s);
}

export class QuickActionsRenderer implements Renderer {
  constructor(private readonly browser: BrowserBinding) {}

  async run(action: Action, options: Record<string, unknown>): Promise<RenderResult> {
    let res: Response;
    try {
      res = await this.browser.quickAction(action, options);
    } catch (e) {
      throw new RenderError(e instanceof Error ? e.message : String(e));
    }

    // Cloudflare bills this whether the render succeeds or fails, so it is
    // counted before looking at the status.
    const browserMs = Number(res.headers.get("x-browser-ms-used") ?? 0) || 0;

    if (!res.ok) throw new RenderError(await errorMessage(res), browserMs, res.status);

    if (BINARY.has(action)) {
      return { value: base64(await res.arrayBuffer()), browserMs };
    }

    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new RenderError(`The provider returned a non-JSON response for \`${action}\`.`, browserMs);
    }

    const envelope = body as { success?: boolean; result?: unknown; errors?: unknown };
    if (envelope?.success === false) {
      throw new RenderError(errorsText(envelope.errors) ?? `\`${action}\` failed.`, browserMs);
    }
    return { value: envelope?.result ?? body, browserMs };
  }
}

async function errorMessage(res: Response): Promise<string> {
  const text = await res.text();
  try {
    const body = JSON.parse(text) as { errors?: unknown; error?: unknown; message?: unknown };
    return (
      errorsText(body.errors) ??
      (typeof body.error === "string" ? body.error : undefined) ??
      (typeof body.message === "string" ? body.message : undefined) ??
      `HTTP ${res.status}`
    );
  } catch {
    return text.slice(0, 300) || `HTTP ${res.status}`;
  }
}

function errorsText(errors: unknown): string | undefined {
  if (!Array.isArray(errors) || errors.length === 0) return undefined;
  return errors
    .map((e) => (typeof e === "string" ? e : (e as { message?: string })?.message))
    .filter(Boolean)
    .join("; ") || undefined;
}
