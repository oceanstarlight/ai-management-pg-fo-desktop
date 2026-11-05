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
/** The Encela app's hub server (src-tauri/src/mcp_hub), replaced by the plugin's. */
export const APP_HUB = "encela-hub";

/** How the plugin starts this package: `encela` on PATH, this install, or npx. */
export function launcher(): { command: string; args: string[] } {
  return launcherFor(process.platform, ...installed());
}

/** Whether `encela` is on PATH, this file and Node: what picks how to start it. */
function installed(): [boolean, string, string] {
  return [onPath("encela"), realpathSync(fileURLToPath(import.meta.url)), process.execPath];
}

/** The command that starts this install, before any wrapping for the OS. */
function bareLauncher(
  encelaOnPath: boolean,
  cli: string,
  execPath: string,
): { command: string; args: string[] } {
  if (encelaOnPath) return { command: "encela", args: [] };
  // npx runs from a cache folder that can be cleared: point at the registry instead.
  if (/[\\/]_npx[\\/]/.test(cli)) return { command: "npx", args: ["-y", `encela@${VERSION}`] };
  return { command: execPath, args: [cli] };
}

/**
 * [`launcher`] for a given OS. On Windows `encela` and `npx` are `.cmd`
 * files, which Claude Code can't start directly (the MCP server's
 * connection just closes): they go through `cmd /c`, as Claude Code's docs
 * say for npx servers.
 */
export function launcherFor(
  platform: string,
  encelaOnPath: boolean,
  cli: string,
  execPath: string,
): { command: string; args: string[] } {
  const run = bareLauncher(encelaOnPath, cli, execPath);
  return platform === "win32" && run.command !== execPath
    ? { command: "cmd", args: ["/c", run.command, ...run.args] }
    : run;
}

/**
 * The command line for hooks.json. Claude Code runs hooks in a POSIX shell,
 * Git Bash on Windows, so `cmd /c` must stay out of it: Git Bash turns `/c`
 * into a path, cmd opens interactively and runs the hook's stdin, the user's
 * prompt included, as commands. The shell finds npm's `encela` and `npx` by
 * itself, and it would eat a path's backslashes.
 */
export function hookCommandFor(
  platform: string,
  encelaOnPath: boolean,
  cli: string,
  execPath: string,
): string {
  const run = bareLauncher(encelaOnPath, cli, execPath);
  const parts = [run.command, ...run.args, "hook"];
  return parts
    .map((p) => (platform === "win32" ? p.replaceAll("\\", "/") : p))
    .map((p) => (/^[\w@%+=:,./-]+$/.test(p) ? p : `'${p.replaceAll("'", `'\\''`)}'`))
    .join(" ");
}

function onPath(name: string): boolean {
  const exts =
    process.platform === "win32" ? (process.env.PATHEXT ?? ".EXE;.CMD").split(";") : [""];
  return (process.env.PATH ?? "")
    .split(delimiter)
    .filter(Boolean)
    .some((dir) => exts.some((e) => existsSync(join(dir, name + e.toLowerCase()))));
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
                command: hookCommandFor(process.platform, ...installed()),
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
  // The app's own hub server serves the same modules file: with the plugin
  // installed, Claude would see every hub tool twice.
  if (claude(["mcp", "get", APP_HUB]).ok) {
    const dropped = claude(["mcp", "remove", APP_HUB, "--scope", "user"]);
    log(
      dropped.ok
        ? `Removed the Encela app's ${APP_HUB} server from Claude Code: the plugin's hub uses the same modules.`
        : `Couldn't remove the Encela app's ${APP_HUB} server (Claude would see the hub tools twice):\n${dropped.out}`,
    );
  }
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
      ? `Removed the Claude Code plugin. Your modules stay in ${hubFile()}. With the Encela app, connect its hub again under Adaptive tools.`
      : `The plugin wasn't installed (or claude isn't available):\n${removed.out}`,
  );
  return 0;
}
