import { describe, expect, it } from "vitest";
import { CLIENT, INTERNAL, MIN_BUDGET_MICROS, MIN_MARGIN, START_FEE_MICROS, searchClientMicros } from "../src/agent/rates";

describe("agent task rates", () => {
  it("every client price is at least the minimum multiple of its worst internal cost", () => {
    expect(CLIENT.planMicros).toBeGreaterThanOrEqual(INTERNAL.planMicros * MIN_MARGIN);
    expect(CLIENT.synthesisMicros).toBeGreaterThanOrEqual(INTERNAL.synthesisMicros * MIN_MARGIN);
    expect(CLIENT.pageMicros).toBeGreaterThanOrEqual(INTERNAL.pageMicros * MIN_MARGIN);
  });

  it("charges the search at least double what the provider charged", () => {
    expect(searchClientMicros(7_000)).toBe(14_000);
    expect(searchClientMicros(7_000)).toBeGreaterThanOrEqual(7_000 * MIN_MARGIN);
  });

  it("the published minimum budget covers the fee, one step and one answer", () => {
    expect(MIN_BUDGET_MICROS).toBe(START_FEE_MICROS + CLIENT.planMicros + CLIENT.pageMicros + CLIENT.synthesisMicros);
    expect(MIN_BUDGET_MICROS).toBeLessThanOrEqual(30_000);
  });
});
