/**
 * Every price an agent task pays, in one place. The executor reads these and nothing else.
 *
 * Two numbers, kept apart on purpose:
 * - INTERNAL: what one call costs us in the worst case (model tokens at the provider's list
 *   price, one browser render at its time limit). Estimates; check them before raising a cap.
 * - CLIENT: what the caller pays for one call. At least MIN_MARGIN times the internal cost, so
 *   a test keeps the markup from falling below the floor. A call is charged whether or not it
 *   produced something usable: we paid for the attempt either way.
 *
 * Search is the exception: Exa is paid by us over x402, so the caller pays MIN_MARGIN times
 * whatever Exa charged, every time, including when the result is empty or uncertain.
 */

/** Model used for planning and synthesis. Overridable per deployment with AGENT_MODEL. */
export const DEFAULT_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

/** Client price is at least this multiple of the internal cost: 2 = a 100% markup, which is a 50% gross margin. */
export const MIN_MARGIN = 2;

export const INTERNAL = {
  /** One planning call at its worst: about 4,300 input tokens and 256 output tokens. */
  planMicros: 1_840,
  /** One final answer at its worst: about 4,300 input tokens and 1,500 output tokens. */
  synthesisMicros: 4_640,
  /** One page read at its time limit: about 60 seconds of browser time, plus conversion. */
  pageMicros: 1_500,
} as const;

export const CLIENT = {
  planMicros: 6_000,
  synthesisMicros: 10_000,
  pageMicros: 3_000,
} as const;

/** Charged once when a task is accepted. Covers the work of starting it. */
export const START_FEE_MICROS = 2_000;

/** Client price for a search, given what Exa charged us for it. */
export function searchClientMicros(exaPaidMicros: number): number {
  return exaPaidMicros * MIN_MARGIN;
}

/** Room kept for one planning call and one page read, so a step never starves the answer. */
export const STEP_RESERVE_MICROS = CLIENT.planMicros + CLIENT.pageMicros;

/** Room kept for the final answer. */
export const SYNTHESIS_RESERVE_MICROS = CLIENT.synthesisMicros;

/** The smallest budget that can pay for the fee, one step and one answer. */
export const MIN_BUDGET_MICROS = START_FEE_MICROS + STEP_RESERVE_MICROS + SYNTHESIS_RESERVE_MICROS;
