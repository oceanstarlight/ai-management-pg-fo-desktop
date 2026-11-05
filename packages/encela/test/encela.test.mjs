// Run with `pnpm test` in packages/encela (builds test/.build/lib.js first).
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const home = mkdtempSync(join(tmpdir(), "encela-test-"));
process.env.ENCELA_HOME = home;
process.env.ENCELA_LANG = "ko";

const lib = await import("./.build/lib.js");

const fresh = () => mkdtempSync(join(tmpdir(), "encela-hub-"));

test("a new data folder starts with the starter set, written once", () => {
  const dir = fresh();
  const hub = lib.loadHub(dir);
  assert.deepEqual(
    hub.modules.map((m) => m.name),
    ["repomix", "ast-grep", "mcp-mermaid"],
  );
  assert.equal(hub.combos.length, 2);
  assert.equal(lib.ensureHub(dir), true);
  assert.equal(lib.ensureHub(dir), false);
  // Deleted starter modules don't come back.
  lib.storeHub({ modules: [], combos: [] }, dir);
  assert.equal(lib.loadHub(dir).modules.length, 0);
});

test("an app file from before the starter set keeps its modules and gains the rest", () => {
  const dir = fresh();
  writeFileSync(
    lib.hubFile(dir),
    JSON.stringify({
      version: 2,
      future: 1,
      servers: [
        { name: "repomix", description: "mine", config: { transport: "stdio", command: "x" } },
      ],
    }),
  );
  const hub = lib.loadHub(dir);
  assert.equal(hub.modules[0].description, "mine");
  assert.equal(hub.modules.length, 3);
  lib.storeHub(hub, dir);
  const raw = JSON.parse(readFileSync(lib.hubFile(dir), "utf8"));
  assert.equal(raw.future, 1, "unknown fields stay");
  assert.equal(raw.starter, 1);
});

test("requests find their modules, combinations and catalog blocks", () => {
  const hub = lib.loadHub(fresh());
  const map = lib.recommend("저장소 전체 구조를 다이어그램으로 그려줘", hub);
  const names = map.modules.map((m) => m.name);
  assert.ok(names.includes("mcp-mermaid") || names.includes("repomix"), JSON.stringify(map));
  const react = lib.recommend("React 컴포넌트를 리팩터링해줘", hub);
  assert.ok(
    react.blocks.some((b) => b.id === "builtin:react"),
    JSON.stringify(react.blocks),
  );
  assert.ok(lib.describe(react).includes("builtin:react"));
});

test("the hook adds context only for real requests that match", () => {
  const hub = lib.loadHub(fresh());
  assert.equal(lib.hookContext("ok", hub), null);
  assert.equal(lib.hookContext("/encela:go 다이어그램 그려줘", hub), null);
  assert.equal(lib.hookContext("오늘 점심 뭐 먹지 고민이야 추천해줘", hub), null);
  const ctx = lib.hookContext("저장소 전체 구조를 mermaid 다이어그램으로 그려줘", hub);
  assert.ok(ctx?.startsWith("[Encela]"), ctx);
  assert.ok(ctx.includes("AskUserQuestion"));
  // Already went through Encela: nothing more.
  assert.equal(lib.hookContext(`${ctx}\nmore`, hub), null);
});

test("blocks come with their text and source", () => {
  const text = lib.blockText("builtin:react");
  assert.match(text, /function components/i);
  assert.throws(() => lib.blockText("nope:nothing"));
  const ext = lib.catalog().blocks.find((b) => b.source);
  assert.match(lib.blockText(ext.id), /Source: https:\/\/github\.com\//);
});

test("Claude can search the catalog with its own words", () => {
  const found = lib.searchBlocks("frontend design");
  assert.match(found, /anthropics_skills:frontend-design/);
  assert.match(lib.searchBlocks("", "agent"), /^- agent /);
  assert.match(lib.searchBlocks("zzzz qqqq"), /No catalog block/);
});

test("variables expand like Claude Code's", () => {
  const env = { TOKEN: "abc" };
  // `${VAR}` written out: the syntax being expanded, not template placeholders.
  const v = (name) => `\${${name}}`;
  assert.equal(lib.expand(`Bearer ${v("TOKEN")}`, env), "Bearer abc");
  assert.equal(lib.expand(v("NOPE:-x"), env), "x");
  assert.equal(lib.expand(v("not valid"), env), v("not valid"));
  assert.throws(() => lib.expand(v("NOPE"), env), /NOPE/);
});

test("exposed tool names fit Claude Code's limit and stay apart", () => {
  assert.equal(lib.exposed("rea", "scan"), "rea__scan");
  const a = lib.exposed("srv", `${"x".repeat(60)}1`);
  const b = lib.exposed("srv", `${"x".repeat(60)}2`);
  assert.ok(a.length <= 37 && b.length <= 37);
  assert.notEqual(a, b);
});

/** A tiny MCP server in Node, so the test runs on every OS. */
function fakeServer(dir) {
  const file = join(dir, "fake.mjs");
  writeFileSync(
    file,
    `import { createInterface } from "node:readline";
const out = (m) => process.stdout.write(JSON.stringify(m) + "\\n");
createInterface({ input: process.stdin }).on("line", (line) => {
  const m = JSON.parse(line);
  if (m.method === "initialize") out({ jsonrpc: "2.0", id: m.id, result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "fake", version: "1" } } });
  if (m.method === "tools/list") { out({ jsonrpc: "2.0", id: 99, method: "roots/list" }); out({ jsonrpc: "2.0", id: m.id, result: { tools: [{ name: "echo", description: "Echo back", inputSchema: { type: "object" } }] } }); }
  if (m.method === "tools/call") out({ jsonrpc: "2.0", id: m.id, result: { content: [{ type: "text", text: "echo:" + JSON.stringify(m.params.arguments) }] } });
});`,
  );
  return file;
}

test("the MCP server suggests, opens modules and combinations, and passes calls through", async () => {
  const dir = fresh();
  const file = fakeServer(dir);
  const hub = {
    modules: [
      {
        ...lib.loadHub(fresh()).modules[1],
      },
      {
        name: "fake",
        description: "A fake server",
        tags: ["test"],
        kind: "mcp",
        config: {
          transport: "stdio",
          command: process.execPath,
          args: [file],
          env: {},
          url: "",
          headers: {},
        },
        inHub: true,
        tools: [],
        checkedAt: null,
        source: null,
        guide: "Call echo.",
        capabilities: [],
        inputs: [],
        outputs: [],
        install: [],
        installedDir: null,
        warnings: [],
      },
    ],
    combos: [
      {
        name: "pair",
        goal: "test both",
        members: [
          { module: "ast-grep", role: "search" },
          { module: "fake", role: "echo" },
        ],
      },
    ],
  };
  const sent = [];
  const server = new lib.Server(
    (m) => sent.push(m),
    dir,
    () => hub,
  );
  const ask = async (method, params, id = 1) =>
    (await server.handle({ jsonrpc: "2.0", id, method, params })).result;

  const init = await ask("initialize", { protocolVersion: "2025-03-26" });
  assert.equal(init.protocolVersion, "2025-03-26");
  assert.ok(init.capabilities.prompts && init.instructions.includes("hub_open_combo"));
  const names = (await ask("tools/list")).tools.map((t) => t.name);
  assert.ok(
    ["suggest", "get_block", "hub_open_server", "hub_open_combo"].every((n) => names.includes(n)),
  );
  const prompts = await ask("prompts/list");
  assert.equal(prompts.prompts[0].name, "go");
  const go = await ask("prompts/get", { name: "go", arguments: { request: "다이어그램 그려줘" } });
  assert.match(go.messages[0].content.text, /\[Encela\]/);

  const call = (name, args) => ask("tools/call", { name, arguments: args });
  const cli = await call("hub_open_server", { name: "ast-grep" });
  assert.equal(cli.isError, false);
  assert.match(cli.content[0].text, /command line tool/);

  const combo = await call("hub_open_combo", { name: "pair" });
  assert.equal(combo.isError, false, combo.content[0].text);
  assert.match(combo.content[0].text, /role: echo/);
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(sent.some((m) => m.method === "notifications/tools/list_changed"));
  const listed = (await ask("tools/list")).tools.map((t) => t.name);
  assert.ok(listed.includes("fake__echo"), listed.join(","));
  const echoed = await call("fake__echo", { a: 1 });
  assert.equal(echoed.content[0].text, 'echo:{"a":1}');
  const via = await call("hub_call", { server: "fake", tool: "echo", arguments: { b: 2 } });
  assert.equal(via.content[0].text, 'echo:{"b":2}');
  assert.match((await call("hub_close_server", { name: "fake" })).content[0].text, /Stopped/);
  assert.equal((await call("fake__echo", {})).isError, true);
  assert.equal((await call("hub_open_server", { name: "nope" })).isError, true);
  server.closeAll();
});

test("setup writes a plugin with the MCP server, the hook and the command", () => {
  const root = lib.writePlugin(join(fresh(), "plugin"), true);
  const plugin = join(root, "plugins", "encela");
  const mcp = JSON.parse(readFileSync(join(plugin, ".mcp.json"), "utf8"));
  assert.ok(mcp.mcpServers.encela.args.at(-1) === "mcp");
  const hooks = JSON.parse(readFileSync(join(plugin, "hooks", "hooks.json"), "utf8"));
  assert.match(hooks.hooks.UserPromptSubmit[0].hooks[0].command, / hook$/);
  assert.match(readFileSync(join(plugin, "commands", "go.md"), "utf8"), /\$ARGUMENTS/);
  const market = JSON.parse(readFileSync(join(root, ".claude-plugin", "marketplace.json"), "utf8"));
  assert.equal(market.plugins[0].name, "encela");
  const quiet = lib.writePlugin(join(fresh(), "plugin"), false);
  assert.equal(existsSync(join(quiet, "plugins", "encela", "hooks")), false);
});

test("on Windows the plugin starts encela and npx through cmd /c", () => {
  const npxCli =
    "C:\\Users\\u\\AppData\\Local\\npm-cache\\_npx\\abc\\node_modules\\encela\\dist\\cli.js";
  const win = lib.launcherFor("win32", false, npxCli, "C:\\node.exe");
  assert.equal(win.command, "cmd");
  assert.deepEqual(win.args.slice(0, 3), ["/c", "npx", "-y"]);
  assert.match(win.args[3], /^encela@/);
  assert.deepEqual(lib.launcherFor("win32", true, npxCli, "x"), {
    command: "cmd",
    args: ["/c", "encela"],
  });
  // Elsewhere, and for a plain checkout, nothing is wrapped.
  assert.deepEqual(lib.launcherFor("linux", true, "/x/cli.js", "/usr/bin/node"), {
    command: "encela",
    args: [],
  });
  assert.equal(
    lib.launcherFor("darwin", false, "/home/u/.npm/_npx/1/node_modules/encela/dist/cli.js", "n")
      .command,
    "npx",
  );
  assert.deepEqual(lib.launcherFor("win32", false, "D:\\repo\\dist\\cli.js", "C:\\node.exe"), {
    command: "C:\\node.exe",
    args: ["D:\\repo\\dist\\cli.js"],
  });
});
