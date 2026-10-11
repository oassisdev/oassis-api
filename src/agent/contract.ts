/**
 * The shape of a task's answer, and the checks the server runs on it. The model proposes; the
 * server decides what is kept and what status the task gets.
 */

import { z } from "zod";

export const MAX_SOURCES = 12;
/** Characters of one page kept as evidence. The rest is cut, and the cut is said. */
export const MAX_EVIDENCE_CHARS = 4_000;
/** Characters of evidence sent to the model in one call, across all sources. */
export const MAX_CONTEXT_CHARS = 12_000;

export interface Source {
  id: string;
  url: string;
  retrieved_at: string;
  /** The fragment of the page the model may cite. Truncated to MAX_EVIDENCE_CHARS. */
  evidence: string;
  truncated: boolean;
}

export const resultSchema = z
  .object({
    summary: z.string().min(1).max(2_000),
    findings: z
      .array(
        z
          .object({
            claim: z.string().min(1).max(500),
            source_ids: z.array(z.string().min(1).max(20)).min(1).max(5),
          }),
      )
      .max(20),
    missing: z.array(z.string().min(1).max(300)).max(20),
  });

export type TaskResult = z.infer<typeof resultSchema>;

/** The same contract as JSON Schema, for the model's structured output. */
export const resultJsonSchema = {
  type: "object",
  properties: {
    summary: { type: "string" },
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: { claim: { type: "string" }, source_ids: { type: "array", items: { type: "string" } } },
        required: ["claim", "source_ids"],
      },
    },
    missing: { type: "array", items: { type: "string" } },
  },
  required: ["summary", "findings", "missing"],
};

export function truncateEvidence(text: string): { text: string; truncated: boolean } {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= MAX_EVIDENCE_CHARS) return { text: clean, truncated: false };
  return { text: clean.slice(0, MAX_EVIDENCE_CHARS), truncated: true };
}

/**
 * Keeps only the findings whose every source was really read in this task. A citation that
 * names a source we did not fetch is removed, and counted, because it is not evidence.
 * Existence of a citation is not verification of the claim: the claim still reads as the
 * model's words, and the caller is told so in the documentation.
 */
export function verifyResult(result: TaskResult, sources: Source[]): { result: TaskResult; dropped: number } {
  const known = new Set(sources.map((s) => s.id));
  const findings = result.findings.filter((f) => f.source_ids.every((id) => known.has(id)));
  return { result: { ...result, findings }, dropped: result.findings.length - findings.length };
}

export type FinalStatus = "completed" | "partial" | "failed";

/**
 * completed only when there are verified findings, nothing is missing, and no limit was hit.
 * Everything else is partial; no sources at all is failed. The model's own "done" is not an input.
 */
export function decideStatus(input: {
  sourcesRead: number;
  verifiedFindings: number;
  missing: number;
  dropped: number;
  limitHit: boolean;
}): { status: FinalStatus; code?: string } {
  if (input.sourcesRead === 0) return { status: "failed", code: "no_sources_read" };
  if (input.verifiedFindings === 0) return { status: "partial", code: "insufficient_evidence" };
  if (input.missing > 0 || input.dropped > 0 || input.limitHit) {
    return { status: "partial", code: input.limitHit ? "limit_reached" : "requirements_unresolved" };
  }
  return { status: "completed" };
}
