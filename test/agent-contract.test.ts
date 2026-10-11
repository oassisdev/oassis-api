import { describe, expect, it } from "vitest";
import { decideStatus, truncateEvidence, verifyResult, MAX_EVIDENCE_CHARS, type Source } from "../src/agent/contract";

const src = (id: string): Source => ({ id, url: `https://a.example/${id}`, retrieved_at: "2026-10-11T00:00:00Z", evidence: "x", truncated: false });

describe("source references", () => {
  it("keeps findings that cite only sources that were really read", () => {
    const result = {
      summary: "s",
      findings: [
        { claim: "ok", source_ids: ["s1"] },
        { claim: "invented", source_ids: ["s9"] },
        { claim: "mixed", source_ids: ["s1", "s9"] },
      ],
      missing: [],
    };
    const v = verifyResult(result, [src("s1")]);
    expect(v.result.findings.map((f) => f.claim)).toEqual(["ok"]);
    expect(v.dropped).toBe(2);
  });
});

describe("evidence limits", () => {
  it("cuts long pages and says so", () => {
    const t = truncateEvidence("word ".repeat(2_000));
    expect(t.truncated).toBe(true);
    expect(t.text.length).toBeLessThanOrEqual(MAX_EVIDENCE_CHARS);
  });
  it("leaves short pages alone", () => {
    expect(truncateEvidence("  short   text ")).toEqual({ text: "short text", truncated: false });
  });
});

describe("status", () => {
  it("is failed without any source read", () => {
    expect(decideStatus({ sourcesRead: 0, verifiedFindings: 0, missing: 0, dropped: 0, limitHit: false }).status).toBe("failed");
  });
  it("is partial when evidence is thin, requirements are open, or a limit was hit", () => {
    expect(decideStatus({ sourcesRead: 2, verifiedFindings: 0, missing: 0, dropped: 0, limitHit: false }).status).toBe("partial");
    expect(decideStatus({ sourcesRead: 2, verifiedFindings: 2, missing: 1, dropped: 0, limitHit: false }).status).toBe("partial");
    expect(decideStatus({ sourcesRead: 2, verifiedFindings: 2, missing: 0, dropped: 0, limitHit: true }).code).toBe("limit_reached");
  });
  it("is completed only with verified findings and nothing open", () => {
    expect(decideStatus({ sourcesRead: 2, verifiedFindings: 2, missing: 0, dropped: 0, limitHit: false }).status).toBe("completed");
  });
});
