import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { VERSION } from "../src/version";

const read = (file: string) => JSON.parse(readFileSync(`${process.cwd()}/${file}`, "utf8"));

describe("one version number", () => {
  /**
   * These drifted before anyone noticed: the registry listed 1.0.1 while a client
   * connecting to that very server was told 1.0.0. Nothing fails on its own when two
   * numbers disagree, so this is what does.
   */
  it("is the same in the registry manifest and the package", () => {
    expect(read("server.json").version, "server.json").toBe(VERSION);
    expect(read("package.json").version, "package.json").toBe(VERSION);
  });

  it("looks like a version", () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
