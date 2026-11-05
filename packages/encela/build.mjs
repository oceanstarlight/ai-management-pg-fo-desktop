// Builds the package: bundles src/cli.ts (with the Claude Code mod's
// suggestion code) into one file, and gathers the data it ships with:
// the app's block catalog (instructions, rules, skills, subagents) and the
// module catalog, with each external source's LICENSE text.
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..", "..");
const catalog = join(repo, "src-tauri", "catalog");
const dist = join(here, "dist");
const pkg = JSON.parse(readFileSync(join(here, "package.json"), "utf8"));

rmSync(dist, { recursive: true, force: true });
mkdirSync(join(dist, "licenses"), { recursive: true });

/** `key: value` lines and `key:` + `  - item` lists, as the catalog writes them. */
function frontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return null;
  const fm = {};
  let list = null;
  for (const line of m[1].split(/\r?\n/)) {
    const item = line.match(/^\s+-\s+(.*)$/);
    if (item && list) {
      fm[list].push(unquote(item[1]));
      continue;
    }
    const kv = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (!kv) continue;
    list = null;
    if (kv[2] === "") {
      fm[kv[1]] = [];
      list = kv[1];
    } else fm[kv[1]] = unquote(kv[2]);
  }
  return { fm, body: text.slice(m[0].length).trim() };
}

function unquote(v) {
  const t = v.trim();
  if (t.startsWith('"') && t.endsWith('"')) {
    try {
      return JSON.parse(t);
    } catch {
      return t.slice(1, -1);
    }
  }
  return t.replace(/^'(.*)'$/, "$1");
}

const KINDS = new Set(["instruction", "rule", "skill", "agent"]);
const blocks = [];
function add(source, file) {
  const parsed = frontmatter(readFileSync(file, "utf8"));
  if (!parsed || !KINDS.has(parsed.fm.kind)) return; // hooks need the app to add them
  const { fm, body } = parsed;
  const stem = file.split(/[\\/]/).pop().replace(/\.md$/, "");
  blocks.push({
    id: `${source}:${stem}`,
    kind: fm.kind,
    name: fm.name || stem,
    title: { ko: fm.title || stem, en: fm.title_en || fm.title || stem },
    summary: { ko: fm.summary || "", en: fm.summary_en || fm.summary || "" },
    category: { ko: fm.category || "", en: fm.category_en || fm.category || "" },
    description: fm.description || "",
    paths: Array.isArray(fm.paths) ? fm.paths : [],
    license: fm.license || (source === "builtin" ? pkg.license : ""),
    copyright: fm.copyright || "",
    source: fm.source_repo
      ? { repo: fm.source_repo, commit: fm.source_commit || "", path: fm.source_path || "" }
      : null,
    body,
  });
}

for (const f of readdirSync(join(catalog, "builtin"))
  .filter((f) => f.endsWith(".md"))
  .sort()) {
  add("builtin", join(catalog, "builtin", f));
}
for (const source of readdirSync(join(catalog, "external")).sort()) {
  const dir = join(catalog, "external", source);
  for (const f of readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .sort())
    add(source, join(dir, f));
  const licenses = readdirSync(dir).filter((f) => /^(LICENSE|LICENCE|COPYING|NOTICE)/i.test(f));
  if (licenses.length) mkdirSync(join(dist, "licenses", source), { recursive: true });
  for (const l of licenses) copyFileSync(join(dir, l), join(dist, "licenses", source, l));
}

const modules = JSON.parse(readFileSync(join(catalog, "modules.json"), "utf8"));
delete modules.$comment;
writeFileSync(
  join(dist, "catalog.json"),
  JSON.stringify({
    version: pkg.version,
    blocks,
    modules: modules.modules,
    starter: modules.starter,
  }),
);

for (const f of ["LICENSE", "THIRD_PARTY_NOTICES.md"]) copyFileSync(join(repo, f), join(here, f));

await build({
  entryPoints: [join(here, "src", "cli.ts")],
  outfile: join(dist, "cli.js"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  banner: { js: "#!/usr/bin/env node" },
  define: { __VERSION__: JSON.stringify(pkg.version) },
  legalComments: "none",
  logLevel: "warning",
});
if (process.argv.includes("--test")) {
  await build({
    entryPoints: [join(here, "src", "lib.ts")],
    outfile: join(here, "test", ".build", "lib.js"),
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    define: { __VERSION__: JSON.stringify(pkg.version) },
    logLevel: "warning",
  });
}
console.log(`encela ${pkg.version}: ${blocks.length} blocks, ${modules.modules.length} modules`);
