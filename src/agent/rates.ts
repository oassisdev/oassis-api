/**
 * Every price an agent task pays, in one place. The executor reads these and nothing else,
 * so a rate changes here without touching how a task runs.
 *
 * Two numbers, kept apart on purpose:
 * - INTERNAL: what the work costs us (model tokens, our own renders). Estimates, set
 *   conservatively; check them against the provider's price list before raising a cap.
 * - CLIENT: what the caller pays. Always at least MIN_MARGIN times the internal cost, so the
 *   margin is a floor that a test enforces.
 *
 * Search is the exception: Exa is paid by us over x402, so the caller pays MIN_MARGIN times
 * whatever Exa charged, every time, including when the result is empty or uncertain.
 */

import { scrapePrice } from "../billing/prices";

/** Model used for planning and synthesis. Overridable per deployment with AGENT_MODEL. */
export const DEFAULT_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

/** Client price is at least this multiple of the internal cost. 2 = a 100% margin. */
export const MIN_MARGIN = 2;

export const INTERNAL = {
  /** One planning call: a few thousand tokens in, a short decision out. */
  planMicros: 1_500,
  /** One synthesis call: the evidence in, a structured result out. */
  synthesisMicros: 4_000,
  /** One page read with our own renderer, markdown only. */
  pageMicros: 500,
} as const;

export const CLIENT = {
  planMicros: INTERNAL.planMicros * MIN_MARGIN,
  synthesisMicros: INTERNAL.synthesisMicros * MIN_MARGIN,
  /** The public scrape price for one markdown output: already at the margin. */
  pageMicros: scrapePrice(["markdown"]),
} as const;

/** Client price for a search, given what Exa charged us for it. */
export function searchClientMicros(exaPaidMicros: number): number {
  return exaPaidMicros * MIN_MARGIN;
}

/** Room kept for one planning call and one page read, so a step never starves the synthesis. */
export const STEP_RESERVE_MICROS = CLIENT.planMicros + CLIENT.pageMicros;

export const SYNTHESIS_RESERVE_MICROS = CLIENT.synthesisMicros;
