/**
 * Actions that can run against an open session, and their validation.
 *
 * An action points at a control by its `ref` (`<selector>#<n>`, the one the
 * `controls` format returns) or by a plain CSS selector. Inside a session a
 * `ref` stays valid as long as the DOM keeps its order, which is exactly what
 * makes the controls → click → controls loop work without reloading.
 */

import { z } from "zod";

const target = {
  ref: z.string().min(1).optional(),
  selector: z.string().min(1).optional(),
};

export const pageAction = z.union([
  z.object({ navigate: z.string().url() }).strict(),
  z.object({ click: z.object({ ...target }).strict() }).strict(),
  z
    .object({
      type: z.object({ ...target, text: z.string(), clear: z.boolean().optional() }).strict(),
    })
    .strict(),
  z.object({ select: z.object({ ...target, value: z.string() }).strict() }).strict(),
  z.object({ press: z.string().min(1) }).strict(),
  z
    .object({
      scroll: z
        .object({ to: z.enum(["top", "bottom"]).optional(), by: z.number().optional() })
        .strict(),
    })
    .strict(),
  z
    .object({
      wait: z
        .object({
          ms: z.number().int().min(0).max(30_000).optional(),
          selector: z.string().min(1).optional(),
        })
        .strict(),
    })
    .strict(),
  z.object({ back: z.literal(true) }).strict(),
]);

export type PageAction = z.infer<typeof pageAction>;

/** `<selector>#<n>` → the selector and the index of the match. */
export function resolveRef(ref: string): { selector: string; nth: number } {
  const cut = ref.lastIndexOf("#");
  if (cut <= 0) return { selector: ref, nth: 0 };
  const nth = Number(ref.slice(cut + 1));
  if (!Number.isInteger(nth) || nth < 0) return { selector: ref, nth: 0 };
  return { selector: ref.slice(0, cut), nth };
}

/** Short description of an action, for the report of what ran. */
export function describeAction(a: PageAction): string {
  if ("navigate" in a) return `navigate ${a.navigate}`;
  if ("click" in a) return `click ${a.click.ref ?? a.click.selector}`;
  if ("type" in a) return `type ${a.type.ref ?? a.type.selector}`;
  if ("select" in a) return `select ${a.select.ref ?? a.select.selector} = ${a.select.value}`;
  if ("press" in a) return `press ${a.press}`;
  if ("scroll" in a) return `scroll ${a.scroll.to ?? a.scroll.by}`;
  if ("wait" in a) return `wait ${a.wait.selector ?? `${a.wait.ms}ms`}`;
  return "back";
}
