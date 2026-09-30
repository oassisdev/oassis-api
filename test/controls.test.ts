import { describe, expect, it } from "vitest";
import { mapControls } from "../src/controls";
import { scrapeRequest } from "../src/schema";
import { scrape } from "../src/scrape";
import type { Renderer } from "../src/types";

/**
 * Raw response of the Browser Run `scrape` action. In production the bare array
 * of blocks arrives (verified against example.com on 2026-09-24); the docs
 * describe it wrapped in `{ results }`, and both are accepted.
 */
const blocks = [
  {
    selector: "a[href]",
    results: [
      {
        text: "  Buy  now ",
        attributes: [{ name: "href", value: "/cart" }],
        top: 300,
        left: 10,
        width: 120,
        height: 40,
      },
      // Hidden: no box.
      { text: "Hidden link", attributes: [], top: 0, left: 0, width: 0, height: 0 },
    ],
  },
  {
    selector: "button",
    results: [
      {
        text: "",
        attributes: [
          { name: "aria-label", value: "Dismiss notice" },
          { name: "disabled", value: "" },
        ],
        top: 20,
        left: 900,
        width: 32,
        height: 32,
      },
    ],
  },
  {
    // The same button caught by another selector: it must not repeat.
    selector: '[role="button"]',
    results: [
      {
        text: "",
        attributes: [{ name: "aria-label", value: "Dismiss notice" }],
        top: 20,
        left: 900,
        width: 32,
        height: 32,
      },
    ],
  },
  {
    selector: "input",
    results: [
      {
        text: "",
        attributes: [
          { name: "type", value: "submit" },
          { name: "value", value: "Send" },
        ],
        top: 500,
        left: 10,
        width: 80,
        height: 30,
      },
    ],
  },
];

describe("mapControls", () => {
  it("sorts by position, normalises the name and never repeats an element", () => {
    const c = mapControls(blocks);
    expect(c.map((x) => x.name)).toEqual(["Dismiss notice", "Buy now", "Send"]);
    expect(c[0]?.disabled).toBe(true);
    expect(c[1]?.href).toBe("/cart");
    expect(c[1]?.ref).toBe("a[href]#0");
  });

  it("a submit input is announced as a button", () => {
    expect(mapControls(blocks).find((c) => c.name === "Send")?.role).toBe("button");
  });

  it("drops the invisible unless asked otherwise, and honours the limit", () => {
    expect(mapControls(blocks).some((c) => c.name === "Hidden link")).toBe(false);
    const all = mapControls(blocks, { visibleOnly: false });
    expect(all.some((c) => c.name === "Hidden link")).toBe(true);
    expect(mapControls(blocks, { limit: 2 })).toHaveLength(2);
  });

  it("accepts the bare array and the { results } wrapper", () => {
    expect(mapControls(blocks)).toHaveLength(3);
    expect(mapControls({ results: blocks })).toHaveLength(3);
  });

  it("survives a response that does not have the expected shape", () => {
    expect(mapControls(null)).toEqual([]);
    expect(mapControls({ results: "nothing" })).toEqual([]);
    expect(mapControls("text")).toEqual([]);
  });
});

describe("the controls format in /web/v1/scrape", () => {
  it("costs a single render and asks for the fixed selector list", async () => {
    const calls: { action: string; options: Record<string, unknown> }[] = [];
    const renderer: Renderer = {
      async run(action, options) {
        calls.push({ action, options });
        return { value: blocks, browserMs: 250 };
      },
    };

    const res = await scrape(
      scrapeRequest.parse({ url: "https://a.com", formats: ["controls"] }),
      renderer,
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]?.action).toBe("scrape");
    expect((calls[0]?.options.elements as unknown[]).length).toBeGreaterThan(5);
    expect(res.metadata.renders).toBe(1);
    expect((res.data.controls as unknown[]).length).toBe(3);
  });

  it("controls and elements do not stomp on each other's selectors", async () => {
    const perCall: Record<string, unknown>[] = [];
    const renderer: Renderer = {
      async run(_action, options) {
        perCall.push(options);
        return { value: blocks, browserMs: 10 };
      },
    };
    await scrape(
      scrapeRequest.parse({
        url: "https://a.com",
        formats: ["controls", "elements"],
        selectors: [".price"],
      }),
      renderer,
    );
    const lists = perCall.map((o) => JSON.stringify(o.elements));
    expect(lists).toContain(JSON.stringify([{ selector: ".price" }]));
    expect(lists.some((l) => l.includes("a[href]"))).toBe(true);
  });
});

describe("naming from the label", () => {
  // Real boxes from https://httpbin.org/forms/post (2026-09-24): the field starts
  // one pixel above its label and ends exactly at its edge.
  const withLabels = [
    {
      selector: "label",
      results: [
        { text: "Customer name: ", top: 17, left: 8, width: 286, height: 17 },
        { text: " Small", top: 169, left: 24, width: 62, height: 17 },
      ],
    },
    {
      selector: "input",
      results: [
        { text: "", attributes: [{ name: "name", value: "custname" }], top: 16, left: 117, width: 177, height: 21 },
        { text: "", attributes: [{ name: "type", value: "radio" }, { name: "value", value: "small" }], top: 170, left: 29, width: 13, height: 13 },
      ],
    },
  ];

  it("names the field after the label wrapping it, not its name attribute", () => {
    const c = mapControls(withLabels);
    expect(c.map((x) => [x.role, x.name])).toEqual([
      ["input", "Customer name"],
      ["radio", "Small"],
    ]);
  });

  it("the label itself is not returned as a control", () => {
    expect(mapControls(withLabels).some((c) => c.selector === "label")).toBe(false);
  });

  it("takes the name from an image's alt when the link has no text", () => {
    const c = mapControls([
      {
        selector: "a[href]",
        results: [
          {
            text: "",
            html: '<img src="/logo.svg" alt="Home">',
            attributes: [{ name: "href", value: "/" }],
            top: 5,
            left: 5,
            width: 18,
            height: 18,
          },
        ],
      },
    ]);
    expect(c[0]?.name).toBe("Home");
  });
});
