/**
 * Reading a document by its url: PDF, Word, Excel, CSV and the rest.
 *
 * A browser cannot read these. Pointed at a PDF it returned an empty page and we
 * answered `200` with empty markdown and charged for it — an answer that looks valid
 * and is worthless, which is worse than an error. Any real crawl of a site runs into
 * datasheets, reports and papers, so this is not an extra format: it is the difference
 * between reading a site and reading half of it.
 *
 * No browser is involved. The bytes are fetched over plain HTTP and converted with
 * Cloudflare's `toMarkdown`, which is free for everything except images.
 */

import type { Env, Format, ScrapeResponse } from "./types";
import type { ScrapeRequest } from "./schema";

/** What can be converted, by extension and by content type. */
const BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xlsm: "application/vnd.ms-excel.sheet.macroenabled.12",
  xls: "application/vnd.ms-excel",
  csv: "text/csv",
  odt: "application/vnd.oasis.opendocument.text",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  numbers: "application/vnd.apple.numbers",
  xml: "application/xml",
};

const DOCUMENT_CONTENT_TYPES = new Set(Object.values(BY_EXTENSION));

/** Beyond this it is not worth pulling into a Worker's memory. */
const MAX_BYTES = 25 * 1024 * 1024;

/** Only markdown comes out of a document: there is no page to screenshot or click. */
export const DOCUMENT_FORMATS: ReadonlySet<Format> = new Set<Format>(["markdown"]);

/**
 * The content type a url's extension promises, if any. Free and synchronous, which is
 * why the price of the call can already know it is a document.
 */
export function documentTypeFromUrl(url: string): string | null {
  try {
    const extension = new URL(url).pathname.split(".").pop()?.toLowerCase() ?? "";
    return BY_EXTENSION[extension] ?? null;
  } catch {
    return null;
  }
}

/** Whether a content type is one we can convert, ignoring charset and parameters. */
export function isDocumentContentType(contentType: string | null): boolean {
  if (!contentType) return false;
  return DOCUMENT_CONTENT_TYPES.has(contentType.split(";")[0]!.trim().toLowerCase());
}

/**
 * Asks the server what a url is, without downloading it. Used only when a render came
 * back empty: a document with no extension in its path (`/download?id=7`) looks like a
 * page until the page turns out to be blank.
 */
export async function contentTypeOf(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(6_000) });
    return res.headers.get("content-type");
  } catch {
    return null;
  }
}

/**
 * Fetches the document and converts it. The returned shape is a normal scrape response,
 * so a document and a page are the same thing to whoever called us.
 */
export async function readDocument(
  env: Env,
  req: ScrapeRequest,
  contentType: string,
  /**
   * Renders already spent before getting here. It is 1 when a url with no telling
   * extension went through a browser first and came back blank: a browser was used and
   * saying otherwise would make `renders` a lie.
   */
  rendersSpent = 0,
): Promise<ScrapeResponse> {
  const started = Date.now();
  const url = req.url as string;
  const formats = [...new Set(req.formats)];
  const data: Partial<Record<Format, unknown>> = {};
  const errors: Partial<Record<Format, string>> = {};

  // Formats that need a page get a reason, not silence.
  for (const format of formats) {
    if (!DOCUMENT_FORMATS.has(format)) {
      errors[format] =
        `This url is a document (${contentType}), not a page: only \`markdown\` can be produced from it.`;
    }
  }

  if (formats.some((f) => DOCUMENT_FORMATS.has(f))) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(req.wait?.timeout ?? 30_000),
        headers: {
          "user-agent": req.request?.userAgent ?? "oassis-api/1.0 (+https://oassis.dev)",
          ...(req.request?.headers ?? {}),
        },
      });
      if (!res.ok) throw new Error(`The server answered HTTP ${res.status}.`);

      const bytes = await res.arrayBuffer();
      if (bytes.byteLength > MAX_BYTES) {
        throw new Error(
          `The document is ${Math.round(bytes.byteLength / 1_048_576)} MB, over the ${MAX_BYTES / 1_048_576} MB limit.`,
        );
      }

      const name = new URL(url).pathname.split("/").pop() || "document";
      const converted = (await env.AI.toMarkdown(
        [{ name, blob: new Blob([bytes], { type: contentType }) }],
        // The PDF metadata block —format version, whether it has AcroForms— is noise in
        // front of the text somebody actually asked for.
        { conversionOptions: { pdf: { metadata: false } } },
      )) as { data?: string }[];

      const markdown = converted?.[0]?.data ?? "";
      if (!markdown.trim()) throw new Error("The document converted to nothing: it may be scanned or empty.");
      data.markdown = markdown;

      return {
        success: true,
        data,
        metadata: {
          url,
          formats,
          // Zero unless a browser had already been tried on this url.
          renders: rendersSpent,
          browserMsUsed: 0,
          ms: Date.now() - started,
          document: { contentType, bytes: bytes.byteLength },
        },
        errors,
      };
    } catch (e) {
      errors.markdown = e instanceof Error ? e.message : String(e);
    }
  }

  return {
    success: false,
    data,
    metadata: { url, formats, renders: rendersSpent, browserMsUsed: 0, ms: Date.now() - started },
    errors,
  };
}
