// The modules and combinations file, `<data dir>/mcp-hub.json`, in the
// app's format (src-tauri/src/mcp_hub/mod.rs): read and written the same
// way, so the app and this package can share it.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Combo, dataDir, type Lang, type Module, starter } from "./data";

const FILE = "mcp-hub.json";
const STARTER_KEY = "starter";
const STARTER_VERSION = 1;

export interface Hub {
  modules: Module[];
  combos: Combo[];
}

export const hubFile = (dir = dataDir()) => join(dir, FILE);

function readMap(file: string): Record<string, unknown> | null {
  if (!existsSync(file)) return null;
  const text = readFileSync(file, "utf8").replace(/^﻿/, "");
  if (!text.trim()) return {};
  const value = JSON.parse(text);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${file} isn't a JSON object`);
  }
  return value as Record<string, unknown>;
}

/** Fills fields an older or hand-written entry may lack. */
function normalize(m: Partial<Module> & { name: string }): Module {
  return {
    description: "",
    tags: [],
    kind: "mcp",
    inHub: true,
    tools: [],
    checkedAt: null,
    source: null,
    guide: "",
    capabilities: [],
    inputs: [],
    outputs: [],
    install: [],
    installedDir: null,
    warnings: [],
    ...m,
    config: {
      transport: "stdio",
      command: "",
      args: [],
      env: {},
      url: "",
      headers: {},
      ...m.config,
    },
  };
}

/** Adds the starter set's modules and combinations whose names aren't taken. */
function addStarter(hub: Hub, l?: Lang) {
  const s = starter(l);
  for (const m of s.modules) if (!hub.modules.some((e) => e.name === m.name)) hub.modules.push(m);
  for (const c of s.combos) {
    const there = c.members.every((m) => hub.modules.some((e) => e.name === m.module));
    if (there && !hub.combos.some((x) => x.name === c.name)) hub.combos.push(c);
  }
}

/**
 * Modules and combinations. The starter set is offered once: to a new
 * file, and to one from before it existed (a `starter` mark keeps deleted
 * ones from coming back).
 */
export function loadHub(dir = dataDir(), l?: Lang): Hub {
  const map = readMap(hubFile(dir));
  if (!map) {
    const s = starter(l);
    return { modules: s.modules, combos: s.combos };
  }
  const hub: Hub = {
    modules: ((map.servers as Module[]) ?? []).map(normalize),
    combos: ((map.combos as Combo[]) ?? []).map((c) => ({
      name: c.name,
      goal: c.goal ?? "",
      members: (c.members ?? []).map((m) => ({ module: m.module, role: m.role ?? "" })),
      aiFit: c.aiFit ?? null,
    })),
  };
  if (Number(map[STARTER_KEY] ?? 0) < STARTER_VERSION) addStarter(hub, l);
  return hub;
}

/** Writes everything, keeping other top-level fields of the file. */
export function storeHub(hub: Hub, dir = dataDir()) {
  const file = hubFile(dir);
  const map = readMap(file) ?? {};
  map.version = 2;
  map[STARTER_KEY] = STARTER_VERSION;
  map.servers = hub.modules;
  map.combos = hub.combos;
  mkdirSync(dir, { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, `${JSON.stringify(map, null, 2)}\n`);
  renameSync(tmp, file);
}

/** Writes the file once if it has yet to take in the starter set; whether it did. */
export function ensureHub(dir = dataDir(), l?: Lang): boolean {
  const map = readMap(hubFile(dir));
  if (map && Number(map[STARTER_KEY] ?? 0) >= STARTER_VERSION) return false;
  storeHub(loadHub(dir, l), dir);
  return true;
}

/** The module config with `{module}` set to where it was built. */
export function runtimeConfig(m: Module): Module["config"] {
  const dir = m.installedDir ?? "";
  const fill = (s: string) => s.split("{module}").join(dir);
  return {
    ...m.config,
    command: fill(m.config.command),
    args: m.config.args.map(fill),
    env: Object.fromEntries(Object.entries(m.config.env).map(([k, v]) => [k, fill(v)])),
  };
}

/** The hub can start stdio and streamable HTTP servers, and hand out any guide. */
export const runnable = (m: Module) =>
  m.kind !== "mcp" || m.config.transport === "stdio" || m.config.transport === "http";
