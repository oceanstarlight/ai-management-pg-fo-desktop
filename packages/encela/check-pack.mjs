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

// Under `npm publish` (or `npm run`), npm says where its own CLI is: run that
// with node, so Windows needs no shell (npm.cmd can't start without one).
const args = ["pack", "--dry-run", "--json", "--ignore-scripts"];
const npmCli = process.env.npm_execpath;
const out =
  npmCli && /\.c?js$/.test(npmCli)
    ? execFileSync(process.execPath, [npmCli, ...args], { cwd: here, encoding: "utf8" })
    : execFileSync(process.platform === "win32" ? "npm.cmd" : "npm", args, {
        cwd: here,
        encoding: "utf8",
        // Windows: a .cmd needs a shell; the arguments are fixed, so nothing is injected.
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
