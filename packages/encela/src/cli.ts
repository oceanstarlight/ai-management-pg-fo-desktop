// The `encela` command.
import { catalog, dataDir, VERSION } from "./data";
import { run as runHook } from "./hook";
import { run as runServer } from "./server";
import { setup, uninstall } from "./setup";
import { hubFile, loadHub } from "./store";

const HELP = `encela ${VERSION} - Encela for Claude Code

Usage:
  encela setup [--no-auto] [--no-claude]   Install the Claude Code plugin and prepare your modules
  encela status                            Where your modules are and what is in them
  encela uninstall                         Remove the Claude Code plugin (your modules stay)
  encela mcp                               Run the MCP server (the plugin starts it)
  encela hook                              Run the prompt hook (the plugin starts it)
  encela --version

  --no-auto     Don't add matches to every prompt; use /encela:go <request> instead
  --no-claude   Only write the files; install the plugin yourself`;

function status(): number {
  const hub = loadHub();
  const c = catalog();
  console.log(`encela ${VERSION}`);
  console.log(`Modules file: ${hubFile()} (data folder ${dataDir()})`);
  console.log(
    `Modules (${hub.modules.length}): ${hub.modules.map((m) => `${m.name}${m.inHub ? "" : " (off)"}`).join(", ")}`,
  );
  console.log(`Combinations (${hub.combos.length}): ${hub.combos.map((x) => x.name).join(", ")}`);
  console.log(
    `Catalog: ${c.blocks.length} skills/rules/instructions/subagents, ${c.modules.length} modules`,
  );
  return 0;
}

async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case "--version":
    case "-v":
    case "version":
      console.log(VERSION);
      return 0;
    case "setup":
      return setup({ auto: !rest.includes("--no-auto"), noClaude: rest.includes("--no-claude") });
    case "uninstall":
      return uninstall();
    case "status":
      return status();
    case "mcp":
      await runServer();
      return 0;
    case "hook":
      await runHook();
      return 0;
    case undefined:
    case "help":
    case "--help":
    case "-h":
      console.log(HELP);
      return 0;
    default:
      console.error(`Unknown command: ${cmd}\n\n${HELP}`);
      return 1;
  }
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  },
);
