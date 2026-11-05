// Makes sure what npm would publish holds the built CLI and its data: runs
// before every `npm publish` (prepublishOnly) and in CI. 0.1.0 went out
// without dist/ because it was published before building.
import { execFileSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const REQUIRED = [
  "dist/cli.js",
  "dist/catalog.json",
  "README.md",
  "LICENSE",
  "THIRD_PARTY_NOTICES.md",
  "package.json",
];

const out = execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
  cwd: here,
  encoding: "utf8",
  shell: process.platform === "win32",
});
const files = new Set(JSON.parse(out)[0].files.map((f) => f.path.replace(/\\/g, "/")));
const missing = REQUIRED.filter((f) => !files.has(f));
if (missing.length) {
  console.error(
    `The package would be missing: ${missing.join(", ")}. Build it first (node build.mjs).`,
  );
  process.exit(1);
}
console.log(`npm package OK: ${files.size} files, including ${REQUIRED.join(", ")}`);
