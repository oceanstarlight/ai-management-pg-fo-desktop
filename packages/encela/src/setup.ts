// `encela setup`: writes the Claude Code plugin (MCP server, hook, the
// /encela:go command) as a local marketplace under ~/.encela and installs it
// with the user's own `claude`, and prepares the modules file. `encela
// uninstall` takes the plugin out again.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { dataDir, encelaHome, VERSION } from "./data";
import { FLOW } from "./server";
import { ensureHub, hubFile, loadHub } from "./store";

export const MARKETPLACE = "encela";
export const PLUGIN = "encela";
export const PLUGIN_ID = `${PLUGIN}@${MARKETPLACE}`;

/** How the plugin starts this package: `encela` on PATH, this install, or npx. */
export function launcher(): { command: string; args: string[] } {
  if (onPath("encela")) return { command: "encela", args: [] };
  const cli = realpathSync(fileURLToPath(import.meta.url));
  // npx runs from a cache folder that can be cleared: point at the registry instead.
  if (/[\\/]_npx[\\/]/.test(cli)) return { command: "npx", args: ["-y", `encela@${VERSION}`] };
  return { command: process.execPath, args: [cli] };
}

function onPath(name: string): boolean {
  const exts =
    process.platform === "win32" ? (process.env.PATHEXT ?? ".EXE;.CMD").split(";") : [""];
  return (process.env.PATH ?? "")
    .split(delimiter)
    .filter(Boolean)
    .some((dir) => exts.some((e) => existsSync(join(dir, name + e.toLowerCase()))));
}

/** A command line for hooks.json (a shell runs it). */
function commandLine(parts: string[]): string {
  return parts.map((p) => (/[\s"'&|<>^]/.test(p) ? JSON.stringify(p) : p)).join(" ");
}

const GO_COMMAND = `---
description: Encela - find the modules, skills and rules for a request, ask which to apply, then do it
argument-hint: <request>
---
Request: $ARGUMENTS

${FLOW}
`;

/** Writes the plugin as a local marketplace; its folder. */
export function writePlugin(root = join(encelaHome(), "claude-plugin"), auto = true): string {
  const run = launcher();
  const plugin = join(root, "plugins", PLUGIN);
  rmSync(root, { recursive: true, force: true });
  for (const d of [
    join(root, ".claude-plugin"),
    join(plugin, ".claude-plugin"),
    join(plugin, "commands"),
  ]) {
    mkdirSync(d, { recursive: true });
  }
  const json = (file: string, value: unknown) =>
    writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
  json(join(root, ".claude-plugin", "marketplace.json"), {
    name: MARKETPLACE,
    owner: { name: "Encela" },
    plugins: [{ name: PLUGIN, source: `./plugins/${PLUGIN}`, version: VERSION }],
  });
  json(join(plugin, ".claude-plugin", "plugin.json"), {
    name: PLUGIN,
    version: VERSION,
    author: { name: "Encela" },
    homepage:
      "https://github.com/oceanstarlight/ai-management-pg-fo-desktop/tree/main/packages/encela",
    description:
      "Finds the modules (MCP servers, CLIs), skills and rules a prompt needs, asks before applying them, and runs modules on demand.",
  });
  json(join(plugin, ".mcp.json"), {
    mcpServers: { encela: { command: run.command, args: [...run.args, "mcp"] } },
  });
  if (auto) {
    mkdirSync(join(plugin, "hooks"), { recursive: true });
    json(join(plugin, "hooks", "hooks.json"), {
      hooks: {
        UserPromptSubmit: [
          {
            hooks: [
              {
                type: "command",
                command: commandLine([run.command, ...run.args, "hook"]),
                timeout: 10,
              },
            ],
          },
        ],
      },
    });
  }
  writeFileSync(join(plugin, "commands", "go.md"), GO_COMMAND);
  return root;
}

/** The user's `claude`; its output, or why it failed. */
function claude(args: string[]): { ok: boolean; out: string } {
  const r = spawnSync("claude", args, {
    encoding: "utf8",
    shell: process.platform === "win32",
    windowsHide: true,
    env: { ...process.env, CLAUDE_CODE_DISABLE_TERMINAL_TITLE: "1" },
  });
  if (r.error) return { ok: false, out: r.error.message };
  return { ok: r.status === 0, out: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim() };
}

export interface SetupOptions {
  auto: boolean;
  /** Only write files; don't run `claude` (for tests, or to install by hand). */
  noClaude: boolean;
}

export function setup(opts: SetupOptions, log: (s: string) => void = console.log): number {
  const dir = dataDir();
  const seeded = ensureHub(dir);
  const hub = loadHub(dir);
  log(
    `Modules: ${hubFile(dir)} (${hub.modules.length} modules, ${hub.combos.length} combinations${seeded ? ", starter set added" : ""})`,
  );
  const root = writePlugin(undefined, opts.auto);
  log(`Plugin: ${root}${opts.auto ? "" : " (no automatic hook)"}`);
  if (opts.noClaude) {
    log(
      `Install it yourself: claude plugin marketplace add "${root}" && claude plugin install ${PLUGIN_ID}`,
    );
    return 0;
  }
  if (!claude(["--version"]).ok) {
    log(
      "Couldn't find Claude Code (the claude command). Install it, then run `encela setup` again.",
    );
    return 1;
  }
  const added = claude(["plugin", "marketplace", "add", root]);
  if (!added.ok) {
    const updated = claude(["plugin", "marketplace", "update", MARKETPLACE]);
    if (!updated.ok) {
      log(`Couldn't add the marketplace:\n${added.out}`);
      return 1;
    }
  }
  const installed = claude(["plugin", "install", PLUGIN_ID, "--scope", "user"]);
  if (!installed.ok && !/already/i.test(installed.out)) {
    log(`Couldn't install the plugin:\n${installed.out}`);
    return 1;
  }
  claude(["plugin", "update", PLUGIN_ID, "--scope", "user"]);
  log(
    `Done. Start a new Claude Code session (or run /reload-plugins).\n- Just write your request: Encela adds what fits${opts.auto ? "" : " (automatic hook off: use the command)"}.\n- Or run /encela:go <request> for the whole flow.`,
  );
  return 0;
}

export function uninstall(log: (s: string) => void = console.log): number {
  const removed = claude(["plugin", "uninstall", PLUGIN_ID, "--scope", "user"]);
  claude(["plugin", "marketplace", "remove", MARKETPLACE]);
  rmSync(join(encelaHome(), "claude-plugin"), { recursive: true, force: true });
  log(
    removed.ok
      ? `Removed the Claude Code plugin. Your modules stay in ${hubFile()}.`
      : `The plugin wasn't installed (or claude isn't available):\n${removed.out}`,
  );
  return 0;
}
