/**
 * Converting html to markdown ourselves, for the pages the renderer gets wrong.
 *
 * Only used as a second chance: see `run-together.ts` for what goes wrong and why it has
 * to be noticed rather than returned. `toMarkdown` takes `text/html`, and it keeps the
 * whitespace that the other conversion drops.
 */

import type { Env } from "./types";

/** Past this we do not bother: the conversion is for a page, not an archive. */
const MAX_HTML = 2_000_000;

export function markdownFromHtml(env: Env) {
  return async (html: string): Promise<string | null> => {
    if (!env.AI || !html || html.length > MAX_HTML) return null;
    const converted = (await env.AI.toMarkdown([
      { name: "page.html", blob: new Blob([html], { type: "text/html" }) },
    ])) as { data?: string }[];
    const md = converted?.[0]?.data ?? "";
    return md.trim() ? md : null;
  };
}
