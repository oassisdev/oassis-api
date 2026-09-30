import { describe, expect, it } from "vitest";
import {
  DOCUMENT_FORMATS,
  documentTypeFromUrl,
  isDocumentContentType,
  readDocument,
} from "../src/documents";
import { documentPrice, priceOfRequest, PRICES } from "../src/billing/prices";
import { scrapeRequest } from "../src/schema";
import type { Env } from "../src/types";

describe("spotting a document", () => {
  it("knows the formats it can convert, by extension", () => {
    expect(documentTypeFromUrl("https://a.com/report.pdf")).toBe("application/pdf");
    expect(documentTypeFromUrl("https://a.com/a/b/sheet.xlsx")).toContain("spreadsheetml");
    expect(documentTypeFromUrl("https://a.com/DATA.CSV")).toBe("text/csv");
    expect(documentTypeFromUrl("https://a.com/doc.docx")).toContain("wordprocessingml");
  });

  it("a page is not a document", () => {
    expect(documentTypeFromUrl("https://a.com/")).toBeNull();
    expect(documentTypeFromUrl("https://a.com/products")).toBeNull();
    expect(documentTypeFromUrl("https://a.com/index.html")).toBeNull();
    expect(documentTypeFromUrl("not a url")).toBeNull();
  });

  it("reads a content type, ignoring charset", () => {
    expect(isDocumentContentType("application/pdf")).toBe(true);
    expect(isDocumentContentType("text/csv; charset=utf-8")).toBe(true);
    expect(isDocumentContentType("text/html; charset=utf-8")).toBe(false);
    expect(isDocumentContentType(null)).toBe(false);
  });
});

describe("what comes out of a document", () => {
  it("only markdown: there is no page to screenshot or click", () => {
    expect(DOCUMENT_FORMATS.has("markdown")).toBe(true);
    expect(DOCUMENT_FORMATS.has("screenshot")).toBe(false);
    expect(DOCUMENT_FORMATS.has("controls")).toBe(false);
  });

  it("converts and reports that no browser was used", async () => {
    const env = {
      AI: { async toMarkdown() { return [{ data: "# The report\n\nnumbers" }]; } },
    } as unknown as Env;
    const fetched = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(new Uint8Array([1, 2, 3]), { status: 200 })) as typeof fetch;
    try {
      const res = await readDocument(
        env,
        scrapeRequest.parse({ url: "https://a.com/r.pdf", formats: ["markdown"] }),
        "application/pdf",
      );
      expect(res.success).toBe(true);
      expect(res.data.markdown).toContain("The report");
      expect(res.metadata.renders).toBe(0);
      expect(res.metadata.browserMsUsed).toBe(0);
      expect(res.metadata.document).toEqual({ contentType: "application/pdf", bytes: 3 });
    } finally {
      globalThis.fetch = fetched;
    }
  });

  it("a format that needs a page is refused with a reason, not silence", async () => {
    const env = {
      AI: { async toMarkdown() { return [{ data: "text" }]; } },
    } as unknown as Env;
    const fetched = globalThis.fetch;
    globalThis.fetch = (async () => new Response(new Uint8Array([1]), { status: 200 })) as typeof fetch;
    try {
      const res = await readDocument(
        env,
        scrapeRequest.parse({ url: "https://a.com/r.pdf", formats: ["markdown", "controls"] }),
        "application/pdf",
      );
      expect(res.data.markdown).toBe("text");
      expect(res.errors.controls).toMatch(/only `markdown`/);
    } finally {
      globalThis.fetch = fetched;
    }
  });

  it("a document that converts to nothing is a failure, not an empty success", async () => {
    const env = { AI: { async toMarkdown() { return [{ data: "   " }]; } } } as unknown as Env;
    const fetched = globalThis.fetch;
    globalThis.fetch = (async () => new Response(new Uint8Array([1]), { status: 200 })) as typeof fetch;
    try {
      const res = await readDocument(
        env,
        scrapeRequest.parse({ url: "https://a.com/r.pdf" }),
        "application/pdf",
      );
      expect(res.success).toBe(false);
      expect(res.errors.markdown).toMatch(/scanned or empty/);
    } finally {
      globalThis.fetch = fetched;
    }
  });
});

describe("what a document costs", () => {
  it("one price, known from the url before the call", () => {
    expect(documentPrice()).toBe(PRICES.document);
    expect(priceOfRequest("scrape", { url: "https://a.com/r.pdf", formats: ["markdown"] })).toBe(2_000);
    // Asking for more formats does not make a document cost more.
    expect(
      priceOfRequest("scrape", { url: "https://a.com/r.pdf", formats: ["markdown", "html", "links"] }),
    ).toBe(2_000);
    // A page is still priced per output.
    expect(priceOfRequest("scrape", { url: "https://a.com/page", formats: ["markdown"] })).toBe(1_000);
  });
});
