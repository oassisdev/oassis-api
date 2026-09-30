#!/usr/bin/env node
/**
 * Fails when something is exported and nobody imports it.
 *
 * Dead code is not harmless: it is read, trusted and maintained by whoever comes next.
 * The compiler already refuses unused locals and parameters (`noUnusedLocals`,
 * `noUnusedParameters` in tsconfig); this covers the one case it cannot see, an export
 * with no importer.
 *
 *   npm run deadcode
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const files = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path);
    else if (path.endsWith(".ts")) files.push(path);
  }
};
for (const root of ["src", "test"]) walk(root);

const source = new Map(files.map((f) => [f, readFileSync(f, "utf8")]));
const declaration = /export (?:async )?(?:function|class|const|interface|type|enum) (\w+)/g;

const dead = [];
for (const [file, text] of source) {
  for (const [, name] of text.matchAll(declaration)) {
    const declaredHere = new RegExp(
      `^\\s*export (?:async )?(?:function|class|const|interface|type|enum) ${name}\\b`,
    );
    let uses = 0;
    for (const text of source.values()) {
      for (const line of text.split("\n")) {
        if (new RegExp(`\\b${name}\\b`).test(line) && !declaredHere.test(line)) uses += 1;
      }
    }
    if (uses === 0) dead.push(`${name}  (${file})`);
  }
}

if (dead.length) {
  console.error(`Exported and imported by nobody:\n${dead.map((d) => `  ${d}`).join("\n")}`);
  process.exit(1);
}
console.log("No dead exports.");
