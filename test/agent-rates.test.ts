import { describe, expect, it } from "vitest";
import { CLIENT, INTERNAL, MIN_MARGIN, searchClientMicros } from "../src/agent/rates";

describe("agent task rates", () => {
  it("every client price keeps at least the minimum margin over its internal cost", () => {
    expect(CLIENT.planMicros).toBeGreaterThanOrEqual(INTERNAL.planMicros * MIN_MARGIN);
    expect(CLIENT.synthesisMicros).toBeGreaterThanOrEqual(INTERNAL.synthesisMicros * MIN_MARGIN);
    expect(CLIENT.pageMicros).toBeGreaterThanOrEqual(INTERNAL.pageMicros * MIN_MARGIN);
  });

  it("charges the search at least double what the provider charged", () => {
    expect(searchClientMicros(7_000)).toBe(14_000);
    expect(searchClientMicros(7_000)).toBeGreaterThanOrEqual(7_000 * MIN_MARGIN);
  });
});
