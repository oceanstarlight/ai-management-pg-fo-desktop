// `encela mcp`: the MCP server the plugin gives Claude Code (stdio).
//
// - suggest: the modules, combinations and catalog blocks that may fit a
//   request (the plugin's hook sends the same shortlist with each prompt).
// - get_block: a skill's, rule's, instruction's or subagent's full text.
// - The hub: kept modules start only when Claude opens one (or a whole
//   combination); an MCP module's tools then appear as <module>__<tool>, a
//   CLI or library module hands over its usage guide. Same tools as the
//   app's encela-hub (src-tauri/src/mcp_hub/gateway.rs).
// - The `go` prompt: the whole flow for one request (find, ask, apply, do).
import { createHash } from "node:crypto";
import { createInterface } from "node:readline";
import { Client, supported } from "./client";
import { catalog, lang, type Module, VERSION } from "./data";
import { describe, isEmpty, recommend, searchCatalog } from "./recommend";
import { type Hub, loadHub, runnable, runtimeConfig } from "./store";

type Json = Record<string, unknown>;
const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
/** Claude Code names a plugin's tool `mcp__plugin_encela_encela__<name>`; the API allows 64. */
const MAX_TOOL_NAME = 64 - "mcp__plugin_encela_encela__".length;

/** How to take a request through Encela; the `go` prompt, the hook and the command use it. */
export const FLOW = `How to use Encela for a request:
1. Call the encela tool suggest with the request (skip this when an "[Encela]" shortlist came with the prompt). Its matches are by keyword: when the task needs something it missed (e.g. "an app like Paint" needs frontend design, maybe reverse engineering), look yourself with search_blocks and hub_list_servers using English keywords.
2. Keep only the items that clearly help. If none do, just do the task.
3. Ask the user once with AskUserQuestion whether to apply them: all, some (let them pick), or none. One line each on why it helps.
4. Apply what was chosen: a combination with hub_open_combo; a module with hub_open_server (an MCP module's tools then appear as <module>__<tool>, a CLI or library module returns its usage guide); a skill, rule, instruction or subagent with get_block, then follow its text for this task (a subagent's text briefs a subagent you start).
5. Do the task to the end with them. Work on roles that don't depend on each other in parallel subagents, and close modules you opened with hub_close_server when done.`;

const INSTRUCTIONS = `Encela keeps modules (MCP servers, command line tools, libraries) and a catalog of skills, rules, instructions and subagents for Claude Code. Nothing runs until you open it.\n${FLOW}`;

export function exposed(server: string, tool: string): string {
  const clean = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, "_");
  const full = `${clean(server)}__${clean(tool)}`;
  if (full.length <= MAX_TOOL_NAME) return full;
  const hash = createHash("sha256").update(`${server}\0${tool}`).digest("hex").slice(0, 6);
  return `${full.slice(0, MAX_TOOL_NAME - hash.length - 1)}_${hash}`;
}

const text = (t: string, isError = false) => ({ content: [{ type: "text", text: t }], isError });

function tool(
  name: string,
  description: string,
  properties: Json,
  required: string[],
  readOnly: boolean,
) {
  return {
    name,
    description,
    inputSchema: { type: "object", properties, required },
    annotations: { readOnlyHint: readOnly, destructiveHint: false, openWorldHint: !readOnly },
  };
}

function ownTools() {
  const name = { type: "string", description: "The module's name" };
  return [
    tool(
      "suggest",
      "The modules, combinations and catalog skills/rules/instructions/subagents that may fit a request, with how sure each match is (1-6). Ask the user before applying them.",
      { request: { type: "string", description: "The user's request, as written" } },
      ["request"],
      true,
    ),
    tool(
      "search_blocks",
      'Searches the catalog\'s skills, rules, instructions and subagents by words (English works best, e.g. "frontend design"). Returns ids for get_block.',
      {
        query: { type: "string", description: "Words to match; empty lists everything" },
        kind: { type: "string", enum: ["instruction", "rule", "skill", "agent"] },
      },
      [],
      true,
    ),
    tool(
      "get_block",
      "A catalog skill, rule, instruction or subagent in full (id from suggest): its text to follow, and where it comes from.",
      { id: { type: "string" } },
      ["id"],
      true,
    ),
    tool(
      "hub_list_servers",
      "Lists the kept modules: name, kind, what it is for, tags, whether it is running and its tools.",
      { query: { type: "string", description: "Words to match; empty lists all" } },
      [],
      true,
    ),
    tool(
      "hub_open_server",
      "Opens a kept module: an MCP module starts and its tools are added as <module>__<tool>; a CLI or library module returns its usage guide.",
      { name },
      ["name"],
      false,
    ),
    tool(
      "hub_list_tools",
      "The tools of a running module with their input schemas.",
      { server: name, tools: { type: "array", items: { type: "string" } } },
      ["server"],
      true,
    ),
    tool(
      "hub_call",
      "Calls a tool of a running module by its own name, when the <module>__<tool> tools didn't appear.",
      { server: name, tool: { type: "string" }, arguments: { type: "object" } },
      ["server", "tool"],
      false,
    ),
    tool(
      "hub_close_server",
      "Stops a running module and removes its tools.",
      { name },
      ["name"],
      false,
    ),
    tool(
      "hub_list_combos",
      "Lists combinations of modules: name, goal and each module's role.",
      {},
      [],
      true,
    ),
    tool(
      "hub_open_combo",
      "Opens every module of a combination at once and returns each one's role, tools and guide, to work on the roles in parallel.",
      { name: { type: "string", description: "The combination's name" } },
      ["name"],
      false,
    ),
  ];
}

export class Server {
  private open = new Map<string, Client>();
  private starting = new Map<string, Promise<Client>>();
  private changed = false;

  constructor(
    private send: (m: Json) => void,
    private cwd = process.cwd(),
    private load: () => Hub = () => loadHub(),
  ) {}

  private hub(): Hub {
    try {
      const hub = this.load();
      return { modules: hub.modules.filter((m) => m.inHub), combos: hub.combos };
    } catch {
      return { modules: [], combos: [] };
    }
  }

  /** The reply to a message; notifications and replies get none. */
  async handle(m: Json): Promise<Json | null> {
    if (m.id === undefined || typeof m.method !== "string") return null;
    const params = (m.params as Json) ?? {};
    const ok = (result: unknown) => ({ jsonrpc: "2.0", id: m.id, result });
    switch (m.method) {
      case "initialize": {
        const asked = String(params.protocolVersion ?? "");
        return ok({
          protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
          capabilities: { tools: { listChanged: true }, prompts: { listChanged: false } },
          serverInfo: { name: "encela", version: VERSION },
          instructions: INSTRUCTIONS,
        });
      }
      case "ping":
        return ok({});
      case "tools/list":
        return ok({ tools: await this.toolList() });
      case "tools/call": {
        const result = await this.call(String(params.name ?? ""), (params.arguments as Json) ?? {});
        if (this.changed) {
          this.changed = false;
          queueMicrotask(() =>
            this.send({ jsonrpc: "2.0", method: "notifications/tools/list_changed" }),
          );
        }
        return ok(result);
      }
      case "prompts/list":
        return ok({
          prompts: [
            {
              name: "go",
              description:
                "Find the modules, skills and rules for a request, ask, apply, then do it",
              arguments: [{ name: "request", description: "What you want done", required: true }],
            },
          ],
        });
      case "prompts/get": {
        const args = (params.arguments as Json) ?? {};
        return ok(goPrompt(String(args.request ?? ""), this.hub()));
      }
      default:
        return {
          jsonrpc: "2.0",
          id: m.id,
          error: { code: -32601, message: `Method not found: ${m.method}` },
        };
    }
  }

  async toolList(): Promise<Json[]> {
    const tools: Json[] = ownTools();
    for (const [server, client] of this.open) {
      for (const t of await client.freshTools()) {
        tools.push({
          ...t,
          name: exposed(server, String(t.name)),
          description: `[${server}] ${String(t.description ?? "")}`,
        });
      }
    }
    return tools;
  }

  async call(name: string, args: Json): Promise<Json> {
    try {
      switch (name) {
        case "suggest":
          return text(suggestText(String(args.request ?? args.prompt ?? ""), this.hub()));
        case "get_block":
          return text(blockText(String(args.id ?? "")));
        case "search_blocks":
          return text(searchBlocks(String(args.query ?? ""), args.kind as string | undefined));
        case "hub_list_servers":
          return text(this.listServers(String(args.query ?? "")));
        case "hub_open_server":
          return text(await this.openServer(String(args.name ?? "")));
        case "hub_list_tools":
          return text(await this.listTools(String(args.server ?? ""), args.tools as string[]));
        case "hub_call":
          return await this.client(String(args.server ?? "")).call(
            String(args.tool ?? ""),
            args.arguments,
          );
        case "hub_close_server":
          return text(this.closeServer(String(args.name ?? "")));
        case "hub_list_combos":
          return text(JSON.stringify(this.hub().combos, null, 2));
        case "hub_open_combo":
          return await this.openCombo(String(args.name ?? ""));
        default: {
          for (const [server, client] of this.open) {
            const t = client.tools().find((x) => exposed(server, String(x.name)) === name);
            if (t) return await client.call(String(t.name), args);
          }
          return text(`Unknown tool ${name}. Open its module with hub_open_server first.`, true);
        }
      }
    } catch (e) {
      return text(e instanceof Error ? e.message : String(e), true);
    }
  }

  private listServers(query: string): string {
    const q = query.trim().toLowerCase();
    const list = this.hub()
      .modules.filter(
        (m) =>
          !q ||
          [m.name, m.description, ...m.tags, ...m.capabilities, ...m.tools.map((t) => t.name)].some(
            (s) => s.toLowerCase().includes(q),
          ),
      )
      .map((m) => ({
        name: m.name,
        kind: m.kind,
        description: m.description,
        tags: m.tags,
        capabilities: m.capabilities,
        inputs: m.inputs,
        outputs: m.outputs,
        open: this.open.has(m.name),
        canOpen: runnable(m),
        tools: (this.open.get(m.name)?.tools() ?? m.tools).map((t) => String(t.name)),
      }));
    return JSON.stringify(list, null, 2);
  }

  private module(name: string): Module {
    const m = this.hub().modules.find((x) => x.name === name);
    if (!m) throw new Error(`No module named "${name}". See hub_list_servers.`);
    return m;
  }

  async openServer(name: string): Promise<string> {
    const m = this.module(name);
    if (m.kind !== "mcp") return guideText(m);
    if (!supported(m.config)) {
      throw new Error(
        `The hub can't start ${name} (${m.config.transport}). Add it to the project's MCP servers instead.`,
      );
    }
    let client = this.open.get(name);
    if (!client) {
      let start = this.starting.get(name);
      if (!start) {
        start = Client.start(runtimeConfig(m), this.cwd, () =>
          this.send({ jsonrpc: "2.0", method: "notifications/tools/list_changed" }),
        );
        this.starting.set(name, start);
      }
      try {
        client = await start;
      } catch (e) {
        throw new Error(`Couldn't start ${name}: ${e instanceof Error ? e.message : e}`);
      } finally {
        this.starting.delete(name);
      }
      if (!this.open.has(name)) {
        this.open.set(name, client);
        this.changed = true;
      }
    }
    const lines = client.tools().map((t) => {
      const about = String(t.description ?? "").split("\n")[0];
      return `- ${exposed(name, String(t.name))} (tool ${t.name}): ${about}`;
    });
    let out = `${name} is running with ${lines.length} tools. They are now in your tool list under these names; if they don't show up, get a tool's schema with hub_list_tools and call it with hub_call {server, tool, arguments}.\n${lines.join("\n")}`;
    if (m.guide.trim()) out += `\n\nHow to use it:\n${m.guide.trim()}`;
    return out;
  }

  private async listTools(server: string, only?: string[]): Promise<string> {
    const tools = await this.client(server).freshTools();
    const list = only?.length ? tools.filter((t) => only.includes(String(t.name))) : tools;
    return JSON.stringify(list, null, 2);
  }

  private closeServer(name: string): string {
    const c = this.open.get(name);
    if (!c) return `${name} wasn't running.`;
    c.close();
    this.open.delete(name);
    this.changed = true;
    return `Stopped ${name}.`;
  }

  private async openCombo(name: string): Promise<Json> {
    const combo = this.hub().combos.find((c) => c.name === name);
    if (!combo) throw new Error(`No combination named "${name}". See hub_list_combos.`);
    let out = `Combination "${combo.name}"${combo.goal ? `\nGoal: ${combo.goal}` : ""}\nEach module below has a role. Work on the roles that don't depend on each other at the same time (one subagent per role, each using its module's tools or commands), and pass what one role produces to the role that needs it.\n`;
    let failed = 0;
    for (const m of combo.members) {
      out += `\n## ${m.module} — role: ${m.role || "(not set)"}\n`;
      try {
        out += await this.openServer(m.module);
      } catch (e) {
        failed++;
        out += e instanceof Error ? e.message : String(e);
      }
      out += "\n";
    }
    return text(out, failed === combo.members.length);
  }

  private client(server: string): Client {
    const c = this.open.get(server);
    if (!c) throw new Error(`${server} isn't running. Start it with hub_open_server.`);
    return c;
  }

  closeAll() {
    for (const c of this.open.values()) c.close();
    this.open.clear();
  }
}

/** A CLI or library module: how to use it. */
function guideText(m: Module): string {
  const what = m.kind === "cli" ? "command line tool" : "library";
  let out = `${m.name} is a ${what}: use it yourself (Bash or code) as described below; there are no MCP tools to call.\n`;
  if (m.installedDir) out += `It was built in: ${m.installedDir}\n`;
  if (m.install.length) out += `Set up with: ${m.install.join(" && ")}\n`;
  return `${out}\n${m.guide.trim() || m.description}`;
}

export function suggestText(request: string, hub: Hub): string {
  const picked = recommend(request, hub);
  if (isEmpty(picked)) {
    return "Nothing in Encela clearly fits this request. Go ahead without it.";
  }
  return `Encela's shortlist for this request (keyword matches; keep only what clearly helps):\n${describe(picked)}\n\nNext: ask the user once (all / some / none), then apply what they chose — hub_open_combo, hub_open_server, get_block — and do the task.`;
}

/** Catalog blocks matching `query` (all of them, by title, when it's empty). */
export function searchBlocks(query: string, kind?: string): string {
  const l = lang();
  const found = (
    query.trim()
      ? searchCatalog(query, 12)
      : catalog().blocks.map((b) => ({
          id: b.id,
          kind: b.kind,
          title: b.title[l],
          summary: b.summary[l],
        }))
  ).filter((b) => !kind || b.kind === kind);
  if (!found.length) return "No catalog block matches. Try other (English) words.";
  return found.map((b) => `- ${b.kind} ${b.id} "${b.title}": ${b.summary}`).join("\n");
}

export function blockText(id: string): string {
  const b = catalog().blocks.find((x) => x.id === id || x.name === id);
  if (!b) throw new Error(`No block "${id}". Ids come from suggest.`);
  const l = lang();
  const from = b.source
    ? `\nSource: https://github.com/${b.source.repo}/blob/${b.source.commit}/${b.source.path} (${b.license}${b.copyright ? `, ${b.copyright}` : ""})`
    : "";
  const where = b.paths.length ? `\nApplies to files: ${b.paths.join(", ")}` : "";
  const how =
    b.kind === "agent"
      ? "Use this as the brief for a subagent you start for this task."
      : "Follow this for the current task.";
  return `${b.kind} ${b.name} — ${b.title[l]}${where}${from}\n${how}\n\n${b.body}`;
}

function goPrompt(request: string, hub: Hub) {
  const shortlist = suggestText(request, hub);
  return {
    description: "Take a request through Encela",
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: `${request}\n\n[Encela]\n${shortlist}\n\n${FLOW}`,
        },
      },
    ],
  };
}

/** Runs the server on stdin/stdout until stdin closes. */
export function run(): Promise<void> {
  const send = (m: Json) => process.stdout.write(`${JSON.stringify(m)}\n`);
  const server = new Server(send);
  const lines = createInterface({ input: process.stdin });
  lines.on("line", (line) => {
    if (!line.trim()) return;
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
      return;
    }
    for (const m of (Array.isArray(message) ? message : [message]) as Json[]) {
      void server.handle(m).then((reply) => reply && send(reply));
    }
  });
  return new Promise((resolve) =>
    lines.on("close", () => {
      server.closeAll();
      resolve();
    }),
  );
}
