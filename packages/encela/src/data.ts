// What the package ships with (dist/catalog.json, made by build.mjs) and
// where the user's own modules live.
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

declare const __VERSION__: string;
export const VERSION: string = typeof __VERSION__ === "string" ? __VERSION__ : "0.0.0";

export type Lang = "ko" | "en";
export type Text = { ko: string; en: string };

export interface Block {
  /** `builtin:rust`, `addyosmani_agent_skills:api-and-interface-design`. */
  id: string;
  kind: "instruction" | "rule" | "skill" | "agent";
  name: string;
  title: Text;
  summary: Text;
  category: Text;
  description: string;
  paths: string[];
  license: string;
  copyright: string;
  source: { repo: string; commit: string; path: string } | null;
  body: string;
}

export interface McpConfig {
  transport: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  url: string;
  headers: Record<string, string>;
}

export type ModuleKind = "mcp" | "cli" | "library";

/** A module as the app keeps it (`src-tauri/src/mcp_hub/mod.rs` Entry). */
export interface Module {
  name: string;
  description: string;
  tags: string[];
  kind: ModuleKind;
  config: McpConfig;
  inHub: boolean;
  tools: { name: string; description: string }[];
  checkedAt: number | null;
  source: { repo: string; commit: string; license: string | null; licenseOk: boolean } | null;
  guide: string;
  capabilities: string[];
  inputs: string[];
  outputs: string[];
  install: string[];
  installedDir: string | null;
  warnings: string[];
}

export interface Combo {
  name: string;
  goal: string;
  members: { module: string; role: string }[];
  aiFit?: { score: number; reasons: string[] } | null;
}

interface CatalogModule {
  id: string;
  name: string;
  kind: ModuleKind;
  needs: string;
  description: Text;
  tags: string[];
  capabilities: string[];
  inputs: string[];
  outputs: string[];
  config: McpConfig | null;
  source: Module["source"];
  install: string[];
  guide: Text;
  warnings: { ko: string[]; en: string[] };
}

interface Catalog {
  version: string;
  blocks: Block[];
  modules: CatalogModule[];
  starter: {
    modules: string[];
    combos: { name: Text; goal: Text; members: { module: string; role: Text }[] }[];
  };
}

let cached: Catalog | null = null;

/** The shipped catalog (next to the bundled cli.js). */
export function catalog(): Catalog {
  if (cached) return cached;
  const here = dirname(fileURLToPath(import.meta.url));
  const file = [
    join(here, "catalog.json"),
    join(here, "..", "dist", "catalog.json"),
    join(here, "..", "..", "dist", "catalog.json"),
  ].find((f) => existsSync(f));
  if (!file) throw new Error("catalog.json is missing: build the package first");
  cached = JSON.parse(readFileSync(file, "utf8")) as Catalog;
  return cached;
}

/** Korean when the system language is Korean, else English (ENCELA_LANG overrides). */
export function lang(): Lang {
  const env = process.env.ENCELA_LANG ?? process.env.LC_ALL ?? process.env.LANG ?? "";
  if (/^ko/i.test(env)) return "ko";
  if (env) return "en";
  try {
    return /^ko/i.test(Intl.DateTimeFormat().resolvedOptions().locale) ? "ko" : "en";
  } catch {
    return "en";
  }
}

/** The file's configs are for macOS and Linux; Windows runs npx through cmd /c. */
function forThisOs(config: McpConfig): McpConfig {
  if (process.platform === "win32" && config.command === "npx") {
    return { ...config, command: "cmd", args: ["/c", "npx", ...config.args] };
  }
  return config;
}

const EMPTY_CONFIG: McpConfig = {
  transport: "stdio",
  command: "",
  args: [],
  env: {},
  url: "",
  headers: {},
};

function toModule(c: CatalogModule, l: Lang): Module {
  return {
    name: c.name,
    description: c.description[l],
    tags: c.tags,
    kind: c.kind,
    config: c.config ? forThisOs(c.config) : { ...EMPTY_CONFIG },
    inHub: true,
    tools: [],
    checkedAt: null,
    source: c.source,
    guide: c.guide[l],
    capabilities: c.capabilities,
    inputs: c.inputs,
    outputs: c.outputs,
    install: c.install,
    installedDir: null,
    warnings: c.warnings[l],
  };
}

/** Every ready-made module. */
export function catalogModules(l: Lang = lang()): Module[] {
  return catalog().modules.map((c) => toModule(c, l));
}

/** What a new user starts with (the app's starter set). */
export function starter(l: Lang = lang()): { modules: Module[]; combos: Combo[] } {
  const c = catalog();
  return {
    modules: c.starter.modules
      .map((n) => c.modules.find((m) => m.name === n))
      .filter((m): m is CatalogModule => !!m)
      .map((m) => toModule(m, l)),
    combos: c.starter.combos.map((x) => ({
      name: x.name[l],
      goal: x.goal[l],
      members: x.members.map((m) => ({ module: m.module, role: m.role[l] })),
      aiFit: null,
    })),
  };
}

/** The app's identifier (`src-tauri/tauri.conf.json`), which names its data folder. */
const APP_ID = "io.github.alsrb060303collab.aimanagement";

/** Where the Encela app keeps its data on this OS (it may not be installed). */
export function appDataDir(): string {
  const home = homedir();
  if (process.platform === "win32") {
    return join(process.env.APPDATA ?? join(home, "AppData", "Roaming"), APP_ID);
  }
  if (process.platform === "darwin") return join(home, "Library", "Application Support", APP_ID);
  const xdg = process.env.XDG_DATA_HOME;
  return join(xdg?.trim() ? xdg : join(home, ".local", "share"), APP_ID);
}

/**
 * Where modules are kept: ENCELA_HOME when set; the app's data folder when
 * the app is installed (both then share one file); `~/.encela` otherwise.
 */
export function dataDir(): string {
  if (process.env.ENCELA_HOME?.trim()) return process.env.ENCELA_HOME;
  const app = appDataDir();
  return existsSync(app) ? app : join(homedir(), ".encela");
}

/** The package's own folder for its Claude Code plugin. */
export function encelaHome(): string {
  return process.env.ENCELA_HOME?.trim() ? process.env.ENCELA_HOME : join(homedir(), ".encela");
}
