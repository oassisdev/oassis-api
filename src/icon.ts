import type { Hono } from "hono";
import type { Env } from "./types";

import iconSvg from "./assets/icon.svg";
import icon512 from "./assets/icon-512.png";
import icon180 from "./assets/icon-180.png";
import faviconIco from "./assets/favicon.ico";

/**
 * The mark: an o held between two brackets — the letter, and a call. It is the one
 * thing a directory shows next to our name before anyone reads a word of it, so it
 * is served from here rather than left to whatever a crawler can guess.
 */

/** A year: the bytes only change when the mark does, and then the path changes too. */
const FOREVER = "public, max-age=31536000, immutable";

const binary = (body: ArrayBuffer, type: string) =>
  new Response(body, { headers: { "content-type": type, "cache-control": FOREVER } });

/** Where a page points at the mark. Same markup on every page we serve. */
export const ICON_LINKS = `<link rel="icon" href="/favicon.ico" sizes="32x32">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">`;

export function mountIcon(app: Hono<{ Bindings: Env }>) {
  app.get("/favicon.svg", () =>
    new Response(iconSvg, {
      headers: { "content-type": "image/svg+xml; charset=utf-8", "cache-control": FOREVER },
    }),
  );
  app.get("/favicon.ico", () => binary(faviconIco, "image/x-icon"));
  app.get("/apple-touch-icon.png", () => binary(icon180, "image/png"));
  // The square a directory and a link preview ask for.
  app.get("/icon-512.png", () => binary(icon512, "image/png"));
}
