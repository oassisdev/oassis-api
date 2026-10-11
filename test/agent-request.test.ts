import { describe, expect, it } from "vitest";
import { DEFAULT_LIMITS, checkPublicUrl, taskRequest } from "../src/agent/request";

describe("task request", () => {
  it("applies the documented defaults", () => {
    const r = taskRequest.parse({ task: "Compare three hosting providers for agents" });
    expect(r.mode).toBe("research");
    expect(r.urls).toEqual([]);
    expect(r.limits).toEqual(DEFAULT_LIMITS);
  });

  it("refuses unknown fields and unsupported modes instead of ignoring them", () => {
    expect(taskRequest.safeParse({ task: "Compare three hosting providers", tools: [] }).success).toBe(false);
    expect(taskRequest.safeParse({ task: "Compare three hosting providers", mode: "purchase" }).success).toBe(false);
    expect(taskRequest.safeParse({ task: "Compare three hosting providers", limits: { max_steps: 3, extra: 1 } }).success).toBe(false);
  });

  it("keeps every limit inside its range", () => {
    expect(taskRequest.safeParse({ task: "Compare three hosting providers", limits: { max_cost_usd: 5 } }).success).toBe(false);
    expect(taskRequest.safeParse({ task: "Compare three hosting providers", limits: { max_steps: 99 } }).success).toBe(false);
    expect(taskRequest.safeParse({ task: "short" }).success).toBe(false);
  });
});

describe("url checks", () => {
  it("accepts public http and https urls", () => {
    expect(checkPublicUrl("https://example.com/pricing")).toBeNull();
    expect(checkPublicUrl("http://example.org/a?b=c")).toBeNull();
  });
  it("refuses local, private and credentialed targets", () => {
    expect(checkPublicUrl("http://localhost:8080/")).toBe("private_host");
    expect(checkPublicUrl("http://intranet/")).toBe("private_host");
    expect(checkPublicUrl("http://10.0.0.5/")).toBe("private_address");
    expect(checkPublicUrl("http://192.168.1.1/")).toBe("private_address");
    expect(checkPublicUrl("http://169.254.169.254/latest")).toBe("private_address");
    expect(checkPublicUrl("http://[::1]/")).toBe("private_address");
    expect(checkPublicUrl("https://user:pw@example.com/")).toBe("credentials_in_url");
    expect(checkPublicUrl("file:///etc/passwd")).toBe("unsupported_scheme");
    expect(checkPublicUrl("not a url")).toBe("invalid_url");
  });
});
