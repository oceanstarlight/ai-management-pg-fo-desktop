// A small MCP client for kept modules: starts one (stdio) or connects to one
// (streamable HTTP), initializes it, lists its tools and forwards calls.
// TypeScript twin of src-tauri/src/mcp_hub/client.rs.
import { type ChildProcess, spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import type { McpConfig } from "./data";
import { VERSION } from "./data";

type Json = Record<string, unknown>;
const PROTOCOL = "2025-06-18";
export const START_TIMEOUT = 120_000;
export const CALL_TIMEOUT = 600_000;
const LIST_TIMEOUT = 60_000;
const STDERR_KEEP = 4000;

/** `${VAR}` and `${VAR:-default}`, as Claude Code expands them. */
export function expand(text: string, env: NodeJS.ProcessEnv = process.env): string {
  return text.replace(/\$\{([^}]*)\}/g, (whole, inner: string) => {
    const at = inner.indexOf(":-");
    const name = at >= 0 ? inner.slice(0, at) : inner;
    if (!/^[A-Za-z0-9_]+$/.test(name)) return whole;
    const value = env[name];
    if (value) return value;
    if (at >= 0) return inner.slice(at + 2);
    throw new Error(`The environment variable ${name} isn't set`);
  });
}

/** `config` with variables expanded and `{project}` set to `project`. */
export function resolve(config: McpConfig, project: string): McpConfig {
  const fill = (s: string) => expand(s.split("{project}").join(project));
  const map = (m: Record<string, string>) =>
    Object.fromEntries(Object.entries(m).map(([k, v]) => [k, fill(v)]));
  return {
    transport: config.transport,
    command: fill(config.command),
    args: config.args.map(fill),
    env: map(config.env),
    url: fill(config.url),
    headers: map(config.headers),
  };
}

export const supported = (c: McpConfig) => c.transport === "stdio" || c.transport === "http";

interface Conn {
  request(message: Json, timeout: number): Promise<Json>;
  notify(message: Json): Promise<void>;
  close(): void;
}

export class Client {
  private nextId = 1;
  private toolList: Json[] = [];
  private stale = false;

  private constructor(private conn: Conn) {}

  /** Starts or connects, initializes and lists the tools. */
  static async start(config: McpConfig, cwd: string, onChange?: () => void): Promise<Client> {
    if (!supported(config)) {
      throw new Error(
        `The hub can only run stdio and HTTP servers (${config.transport}). Put this one into a project instead.`,
      );
    }
    const c = resolve(config, cwd);
    let client: Client | null = null;
    const changed = () => {
      if (client) client.stale = true;
      onChange?.();
    };
    const conn = c.transport === "stdio" ? new Pipe(c, cwd, changed) : new Http(c);
    client = new Client(conn);
    try {
      const init = await client.request(
        "initialize",
        {
          protocolVersion: PROTOCOL,
          capabilities: { roots: { listChanged: false } },
          clientInfo: { name: "encela-hub", version: VERSION },
        },
        START_TIMEOUT,
      );
      if (conn instanceof Http && typeof init.protocolVersion === "string") {
        conn.version = init.protocolVersion;
      }
      await conn.notify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });
      await client.refreshTools();
    } catch (e) {
      conn.close();
      throw e;
    }
    return client;
  }

  async refreshTools(): Promise<Json[]> {
    const tools: Json[] = [];
    let cursor: string | undefined;
    for (let i = 0; i < 50; i++) {
      const page = await this.request("tools/list", cursor ? { cursor } : {}, LIST_TIMEOUT);
      tools.push(...((page.tools as Json[]) ?? []));
      cursor = typeof page.nextCursor === "string" && page.nextCursor ? page.nextCursor : undefined;
      if (!cursor) break;
    }
    this.toolList = tools;
    this.stale = false;
    return tools;
  }

  tools(): Json[] {
    return this.toolList;
  }

  /** The tools, read again first if the server said they changed. */
  async freshTools(): Promise<Json[]> {
    if (this.stale) await this.refreshTools().catch(() => {});
    return this.toolList;
  }

  call(tool: string, args: unknown): Promise<Json> {
    return this.request("tools/call", { name: tool, arguments: args ?? {} }, CALL_TIMEOUT);
  }

  private async request(method: string, params: Json, timeout: number): Promise<Json> {
    const id = this.nextId++;
    const reply = await this.conn.request({ jsonrpc: "2.0", id, method, params }, timeout);
    if (reply.error) {
      const e = reply.error as { message?: string };
      throw new Error(`The server returned an error: ${e.message ?? "error"}`);
    }
    return (reply.result as Json) ?? {};
  }

  close() {
    this.conn.close();
  }
}

/** On Windows, `npx` is `npx.cmd`, which spawn finds only through a shell. */
function needsShell(command: string): boolean {
  return process.platform === "win32" && !/[\\/]/.test(command) && !/\.\w+$/.test(command);
}

class Pipe implements Conn {
  private child: ChildProcess;
  private pending = new Map<number, (m: Json) => void>();
  private ended: string | null = null;
  private stderr = "";

  constructor(config: McpConfig, cwd: string, onChange: () => void) {
    this.child = spawn(config.command, config.args, {
      cwd,
      env: { ...process.env, ...config.env },
      stdio: ["pipe", "pipe", "pipe"],
      shell: needsShell(config.command),
      windowsHide: true,
    });
    this.child.on("error", (e) => this.end(`Couldn't run ${config.command}: ${e.message}`));
    this.child.on("exit", (code) => this.end(`The server exited (code ${code ?? "?"})`));
    this.child.stderr?.on("data", (d: Buffer) => {
      this.stderr = (this.stderr + d.toString()).slice(-STDERR_KEEP);
    });
    const root = pathToFileURL(cwd).href;
    const lines = createInterface({ input: this.child.stdout as NodeJS.ReadableStream });
    lines.on("line", (line) => {
      let message: unknown;
      try {
        message = JSON.parse(line.trim());
      } catch {
        return;
      }
      for (const m of (Array.isArray(message) ? message : [message]) as Json[]) {
        this.onMessage(m, root, onChange);
      }
    });
  }

  private onMessage(m: Json, root: string, onChange: () => void) {
    const method = typeof m.method === "string" ? m.method : null;
    if (m.id !== undefined && !method) {
      this.pending.get(m.id as number)?.(m);
      this.pending.delete(m.id as number);
    } else if (m.id !== undefined && method) {
      // The server asks something.
      const reply =
        method === "ping"
          ? { jsonrpc: "2.0", id: m.id, result: {} }
          : method === "roots/list"
            ? { jsonrpc: "2.0", id: m.id, result: { roots: [{ uri: root, name: "project" }] } }
            : {
                jsonrpc: "2.0",
                id: m.id,
                error: { code: -32601, message: `Not supported by encela-hub: ${method}` },
              };
      this.write(reply);
    } else if (method === "notifications/tools/list_changed") {
      onChange();
    }
  }

  private end(why: string) {
    if (this.ended) return;
    const tail = this.stderr.trim().slice(-800);
    this.ended = tail ? `${why}\n${tail}` : why;
    for (const [id, resolve] of this.pending) {
      resolve({ jsonrpc: "2.0", id, error: { message: this.ended } });
    }
    this.pending.clear();
  }

  private write(message: Json) {
    if (this.ended) throw new Error(this.ended);
    this.child.stdin?.write(`${JSON.stringify(message)}\n`);
  }

  request(message: Json, timeout: number): Promise<Json> {
    const id = message.id as number;
    return new Promise((resolve, reject) => {
      if (this.ended) return reject(new Error(this.ended));
      const timer = setTimeout(() => {
        this.pending.delete(id);
        try {
          this.write({
            jsonrpc: "2.0",
            method: "notifications/cancelled",
            params: { requestId: id, reason: "timeout" },
          });
        } catch {}
        reject(new Error(`The server didn't answer within ${timeout / 1000} seconds`));
      }, timeout);
      this.pending.set(id, (m) => {
        clearTimeout(timer);
        if (m.error && this.ended && (m.error as Json).message === this.ended) {
          reject(new Error(this.ended));
        } else resolve(m);
      });
      try {
        this.write(message);
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(e);
      }
    });
  }

  async notify(message: Json) {
    this.write(message);
  }

  close() {
    if (!this.ended) this.ended = "closed";
    if (this.child.exitCode === null) this.child.kill();
  }
}

class Http implements Conn {
  session: string | null = null;
  version: string | null = null;

  constructor(private config: McpConfig) {}

  private async post(message: Json, timeout: number): Promise<Response> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...this.config.headers,
    };
    if (this.session) headers["Mcp-Session-Id"] = this.session;
    if (this.version) headers["MCP-Protocol-Version"] = this.version;
    const res = await fetch(this.config.url, {
      method: "POST",
      headers,
      body: JSON.stringify(message),
      signal: AbortSignal.timeout(timeout),
    });
    const s = res.headers.get("mcp-session-id");
    if (s) this.session = s;
    if (res.status === 401 || res.status === 403) {
      throw new Error(
        `This server needs a sign-in. The hub can't do OAuth: put a token (\${VAR}) in a header, or put the server into a project and sign in with /mcp`,
      );
    }
    if (!res.ok) throw new Error(`The server returned HTTP ${res.status}`);
    return res;
  }

  async request(message: Json, timeout: number): Promise<Json> {
    const res = await this.post(message, timeout);
    const text = await res.text();
    const id = message.id;
    const sse = (res.headers.get("content-type") ?? "").startsWith("text/event-stream");
    const chunks = sse
      ? text.split(/\r?\n\r?\n/).map((e) =>
          e
            .split(/\r?\n/)
            .filter((l) => l.startsWith("data:"))
            .map((l) => l.slice(5).trimStart())
            .join("\n"),
        )
      : [text];
    for (const chunk of chunks) {
      const found = findReply(chunk, id);
      if (found) return found;
    }
    throw new Error("Couldn't read the server's answer");
  }

  async notify(message: Json) {
    await this.post(message, LIST_TIMEOUT);
  }

  close() {}
}

/** The reply with `id` in `text` (one message or a batch). */
export function findReply(text: string, id: unknown): Json | null {
  let value: unknown;
  try {
    value = JSON.parse(text.trim());
  } catch {
    return null;
  }
  const matches = (m: Json) => m && m.id === id && m.method === undefined;
  if (Array.isArray(value)) return (value as Json[]).find(matches) ?? null;
  return matches(value as Json) ? (value as Json) : null;
}
