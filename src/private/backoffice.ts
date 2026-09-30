/**
 * Back-office: a no-op here on purpose.
 *
 * The console is operations, not product, and it reads the billing tables directly. The real
 * file lives in the oassis-backoffice repo and is copied over this one before deploying
 * (`./restore.sh` there). With the stub in place the API builds, tests and serves exactly as
 * it should — it simply has no `/console`.
 */

import type { Hono } from "hono";
import type { Env } from "../types";

export function mountBackoffice(_app: Hono<{ Bindings: Env }>): void {
  /* no console in this build */
}
