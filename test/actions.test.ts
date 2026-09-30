import { describe, expect, it } from "vitest";
import { describeAction, pageAction, resolveRef } from "../src/session/actions";
import { actRequest, sessionRequest } from "../src/schema";

describe("resolveRef", () => {
  it("splits selector and index", () => {
    expect(resolveRef("a[href]#3")).toEqual({ selector: "a[href]", nth: 3 });
    expect(resolveRef("input#0")).toEqual({ selector: "input", nth: 0 });
  });

  it("a selector containing # is cut at the last one", () => {
    expect(resolveRef("#menu a#2")).toEqual({ selector: "#menu a", nth: 2 });
  });

  it("without a valid index, the first match", () => {
    expect(resolveRef("button")).toEqual({ selector: "button", nth: 0 });
    expect(resolveRef("button#x")).toEqual({ selector: "button#x", nth: 0 });
    expect(resolveRef("button#-1")).toEqual({ selector: "button#-1", nth: 0 });
  });
});

describe("action validation", () => {
  it("accepts the eight shapes", () => {
    const ok = [
      { navigate: "https://a.com" },
      { click: { ref: "button#0" } },
      { type: { selector: "input", text: "hello", clear: true } },
      { select: { ref: "select#0", value: "es" } },
      { press: "Enter" },
      { scroll: { to: "bottom" } },
      { wait: { selector: ".ready" } },
      { back: true },
    ];
    for (const a of ok) expect(pageAction.safeParse(a).success).toBe(true);
  });

  it("rejects what is not an action", () => {
    expect(pageAction.safeParse({ click: {}, press: "Enter" }).success).toBe(false);
    expect(pageAction.safeParse({ evaluate: "alert(1)" }).success).toBe(false);
    expect(pageAction.safeParse({ navigate: "not-a-url" }).success).toBe(false);
    expect(pageAction.safeParse({ wait: { ms: 999_999 } }).success).toBe(false);
  });

  it("describes the action for the report", () => {
    expect(describeAction({ click: { ref: "button#0" } })).toBe("click button#0");
    expect(describeAction({ press: "Enter" })).toBe("press Enter");
  });
});

describe("opening a session", () => {
  it("requires url and returns the control map by default", () => {
    const v = sessionRequest.parse({ url: "https://a.com" });
    expect(v.formats).toEqual(["controls"]);
    expect(sessionRequest.safeParse({ html: "<p>x</p>" }).success).toBe(false);
  });

  it("inherits the rules of /scrape", () => {
    expect(sessionRequest.safeParse({ url: "https://a.com", formats: ["elements"] }).success).toBe(false);
    expect(sessionRequest.safeParse({ url: "https://a.com", formats: ["json"] }).success).toBe(false);
  });
});

describe("acting", () => {
  it("requires a session and at least one action", () => {
    expect(actRequest.safeParse({ actions: [{ press: "Enter" }] }).success).toBe(false);
    expect(actRequest.safeParse({ sessionId: "abc", actions: [] }).success).toBe(false);
  });

  it("accepts actions together with the formats to look at afterwards", () => {
    const v = actRequest.parse({
      sessionId: "abc",
      actions: [{ click: { ref: "a[href]#0" } }, { wait: { ms: 500 } }],
      formats: ["controls", "markdown"],
    });
    expect(v.sessionId).toBe("abc");
    expect(v.actions).toHaveLength(2);
  });

  it("does not let through a format whose required fields are missing", () => {
    expect(
      actRequest.safeParse({ sessionId: "abc", actions: [{ press: "Enter" }], formats: ["json"] }).success,
    ).toBe(false);
  });
});
