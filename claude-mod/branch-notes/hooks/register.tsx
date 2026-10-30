import type { EngineInterface, Register } from "claude-code";
import { atom, read, update } from "claude-code";
import {
  applyLocally,
  bandText,
  contextText,
  parseExport,
  parseTodo,
  type Request,
  repoKeyFor,
  requestName,
  STALE_MS,
  todoList,
  type View,
  words,
} from "./core";
import {
  AI_DELAY_MS,
  AI_SYSTEM,
  aiAsk,
  aiCatalog,
  buildCandidates,
  type Candidate,
  draftWith,
  installedCandidate,
  keywordRank,
  label,
  parseAiReply,
  type SuggestExport,
  suggestMode,
  wantsSuggestions,
} from "./suggest";

const APP_ID = "io.github.alsrb060303collab.aimanagement";
const PANE = "branch-notes";
/** How often the app's export and the checked-out branch are read again. */
const REFRESH_MS = 5000;

const view = atom({ plugin: "branch-notes", key: "view" } as const, null);
const isHidden = atom({ plugin: "branch-notes", key: "isHidden" } as const, false);
const suggestion = atom({ plugin: "branch-notes", key: "suggestion" } as const, null);

/** The export's suggestion settings and catalog, as last read. */
let lastSuggest: SuggestExport | undefined;

/** `<app data>/bridge`, where the app writes `state.json` and reads `inbox/`. */
async function bridgeDir($: EngineInterface): Promise<string | null> {
  const override = await $.env.get("AIM_BRIDGE_DIR");
  if (override) return override;
  const appData = await $.env.get("APPDATA");
  if (appData) return `${appData}\\${APP_ID}\\bridge`;
  const home = await $.env.get("HOME");
  if (!home) return null;
  const mac = `${home}/Library/Application Support/${APP_ID}/bridge`;
  if (await $.fs.exists(mac)) return mac;
  const xdg = (await $.env.get("XDG_DATA_HOME")) || `${home}/.local/share`;
  return `${xdg}/${APP_ID}/bridge`;
}

const sep = (dir: string) => (dir.includes("\\") ? "\\" : "/");

async function git($: EngineInterface, args: string[]): Promise<string | null> {
  try {
    const out = await $.process.run(["git", ...args]);
    return out.exitCode === 0 ? out.stdout.trim() || null : null;
  } catch {
    return null;
  }
}

/** Reads the app's export and finds this session's repository and branch in it. */
async function load($: EngineInterface): Promise<View | null> {
  const dir = await bridgeDir($);
  if (!dir) return null;
  let text: string;
  try {
    text = (await $.fs.read(`${dir}${sep(dir)}state.json`)) as string;
  } catch {
    return null;
  }
  const exp = parseExport(text);
  if (!exp) return null;
  lastSuggest = exp.suggest;
  const now = await $.clock.now();
  const toplevel = await git($, ["rev-parse", "--show-toplevel"]);
  if (!toplevel) {
    return {
      appRunning: now - exp.heartbeat < STALE_MS,
      locale: exp.locale,
      repoKey: null,
      branch: "",
      data: null,
    };
  }
  const remote =
    (await git($, ["remote", "get-url", "origin"])) ??
    (await git($, ["config", "--get-regexp", "^remote\\..*\\.url$"]))?.split(/\s+/)[1] ??
    null;
  const common = await git($, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  const main = common ? common.replace(/[\\/]\.git[\\/]?$/, "") : toplevel;
  const repoKey = repoKeyFor(exp, remote, main);
  const branch = (await git($, ["symbolic-ref", "--quiet", "--short", "HEAD"])) ?? "";
  return {
    appRunning: now - exp.heartbeat < STALE_MS,
    locale: exp.locale,
    repoKey,
    branch,
    data: (repoKey && exp.repos[repoKey]?.[branch]) || null,
  };
}

async function refresh($: EngineInterface) {
  const next = await load($);
  const prev = await read($, view);
  if (JSON.stringify(next) !== JSON.stringify(prev)) await update($, view, () => next);
}

/** Leaves a request for the app and shows it at once. */
async function send($: EngineInterface, request: Request): Promise<boolean> {
  const dir = await bridgeDir($);
  if (!dir) return false;
  const s = sep(dir);
  try {
    await $.fs.write(
      `${dir}${s}inbox${s}${requestName(await $.clock.now(), Math.random())}`,
      JSON.stringify(request),
    );
  } catch {
    return false;
  }
  await update($, view, (v) => (v ? applyLocally(v, request) : v));
  return true;
}

// ---------------------------------------------------------------------------
// Prompt suggestions

/** Installed skills, subagents and commands are looked for again this often. */
const SCAN_MS = 10 * 60 * 1000;
/** Files read per scan, at most. */
const MAX_FILES = 400;

let installed: Candidate[] = [];
let scannedAt = 0;
let scanning: Promise<void> | null = null;
/** The draft as last typed. */
let current = "";
/** Hidden with × until the prompt is sent or cleared. */
let muted = false;
let timer: { cancel: () => void } | null = null;
let asking: AbortController | null = null;
/** Haiku's picks by draft and catalog. */
const picks = new Map<string, string[]>();

async function claudeDir($: EngineInterface): Promise<string | null> {
  const own = await $.env.get("CLAUDE_CONFIG_DIR");
  if (own) return own;
  const home = (await $.env.get("USERPROFILE")) || (await $.env.get("HOME"));
  return home ? `${home}${sep(home)}.claude` : null;
}

/** Reads the skills, subagents and commands under one `.claude`-like folder. */
async function scanDir(
  $: EngineInterface,
  root: string,
  out: Candidate[],
  budget: { files: number },
  plugin?: string,
) {
  const s = sep(root);
  const list = async (dir: string) => {
    try {
      return await $.fs.list(dir);
    } catch {
      return [];
    }
  };
  const readOne = async (path: string): Promise<string | null> => {
    if (budget.files-- <= 0) return null;
    try {
      return (await $.fs.read(path)) as string;
    } catch {
      return null;
    }
  };
  for (const entry of await list(`${root}${s}skills`)) {
    if (entry.kind !== "dir" && !entry.isLink) continue;
    const text = await readOne(`${root}${s}skills${s}${entry.name}${s}SKILL.md`);
    const c = text && installedCandidate("skill", entry.name, text, plugin);
    if (c) out.push(c);
  }
  for (const kind of ["agents", "commands"] as const) {
    for (const entry of await list(`${root}${s}${kind}`)) {
      if (!entry.name.endsWith(".md")) continue;
      const text = await readOne(`${root}${s}${kind}${s}${entry.name}`);
      const c =
        text &&
        installedCandidate(
          kind === "agents" ? "agent" : "command",
          entry.name.slice(0, -3),
          text,
          plugin,
        );
      if (c) out.push(c);
    }
  }
}

/** What Claude Code loads here: the project's, the user's and plugins' items. */
async function scanInstalled($: EngineInterface) {
  const out: Candidate[] = [];
  const budget = { files: MAX_FILES };
  const top = await git($, ["rev-parse", "--show-toplevel"]);
  if (top) await scanDir($, `${top}${sep(top)}.claude`, out, budget);
  const user = await claudeDir($);
  if (user) await scanDir($, user, out, budget);
  try {
    const run = await $.process.run(["claude", "plugin", "list", "--json"]);
    const plugins = run.exitCode === 0 ? JSON.parse(run.stdout) : [];
    for (const p of Array.isArray(plugins) ? plugins : []) {
      if (p?.enabled === false || typeof p?.installPath !== "string") continue;
      const name = String(p.id ?? "").split("@")[0];
      if (name) await scanDir($, p.installPath, out, budget, name);
    }
  } catch {
    // Without the claude command only files on disk are known.
  }
  installed = out;
  scannedAt = await $.clock.now();
}

async function candidates($: EngineInterface): Promise<Candidate[]> {
  const now = await $.clock.now();
  if (!scannedAt || now - scannedAt > SCAN_MS) {
    scanning ??= scanInstalled($).finally(() => {
      scanning = null;
    });
    if (!scannedAt) await scanning;
  }
  return buildCandidates(installed, lastSuggest);
}

async function clearSuggestion($: EngineInterface) {
  timer?.cancel();
  timer = null;
  asking?.abort();
  asking = null;
  if (await read($, suggestion)) await update($, suggestion, () => null);
}

async function askHaiku($: EngineInterface, draft: string, list: Candidate[]) {
  asking?.abort();
  const stop = new AbortController();
  asking = stop;
  const catalog = aiCatalog(list);
  const r = await $.model.complete(
    {
      model: "haiku",
      system: AI_SYSTEM,
      prompt: [{ text: catalog, cache: true }, { text: aiAsk(draft) }],
      maxTokens: 40,
      effort: "low",
      timeoutMs: 15000,
    },
    { signal: stop.signal },
  );
  if (asking === stop) asking = null;
  if (current !== draft || muted) return;
  if (!r.isAnswered) {
    await update($, suggestion, (s) => (s && s.draft === draft ? { ...s, pending: false } : s));
    return;
  }
  const items = parseAiReply(r.text, list);
  if (picks.size > 50) picks.clear();
  picks.set(
    `${draft}\n${catalog.length}`,
    items.map((c) => c.key),
  );
  await update($, suggestion, () => ({ draft, items, by: "ai" as const, pending: false }));
}

/** Suggests for the draft: keyword matches at once, Haiku's picks after a pause. */
async function onDraft($: EngineInterface, text: string) {
  const draft = text.trim();
  if (draft === current) return;
  current = draft;
  if (!draft) muted = false;
  const mode = suggestMode({ suggest: lastSuggest });
  if (mode === "off" || muted || !wantsSuggestions(draft)) {
    await clearSuggestion($);
    return;
  }
  const list = await candidates($);
  if (current !== draft) return;
  const quick = keywordRank(draft, list);
  timer?.cancel();
  timer = null;
  if (mode === "keyword") {
    await update($, suggestion, () => ({
      draft,
      items: quick,
      by: "keyword" as const,
      pending: false,
    }));
    return;
  }
  const known = picks.get(`${draft}\n${aiCatalog(list).length}`);
  if (known) {
    const items = known
      .map((key) => list.find((c) => c.key === key))
      .filter((c): c is Candidate => !!c);
    await update($, suggestion, () => ({ draft, items, by: "ai" as const, pending: false }));
    return;
  }
  await update($, suggestion, () => ({
    draft,
    items: quick,
    by: "keyword" as const,
    pending: true,
  }));
  timer = $.clock.after(AI_DELAY_MS, () => {
    timer = null;
    if (current === draft) void askHaiku($, draft, list);
  });
}

/** Uses a suggestion: into the prompt, or a request for the app. */
async function pick($: EngineInterface, c: Candidate) {
  const v = await read($, view);
  const w = words(v?.locale ?? "en");
  if (c.source === "installed") {
    const box = await $.prompt.read();
    await $.prompt.fill({ text: draftWith(box.text, c, v?.locale ?? "en"), mode: "replace" });
    return;
  }
  if (!v?.appRunning) {
    $.ui.toast(w.noAppForSuggest);
    return;
  }
  if (c.source === "library" && c.libraryKind && c.libraryId) {
    const project = await git($, ["rev-parse", "--show-toplevel"]);
    if (!project) {
      $.ui.toast(w.noRepo);
      return;
    }
    await send($, { op: "applyLibrary", project, kind: c.libraryKind, id: c.libraryId });
    $.ui.toast(w.adding(c.name));
  } else if (c.extensionId) {
    await send($, { op: "installExtension", id: c.extensionId });
    $.ui.toast(w.installing(c.name));
  }
  scannedAt = 0;
  await clearSuggestion($);
}

export const register: Register = (on) => {
  on("session.start", async ($, e, next) => {
    await $.command.register({
      name: "todo",
      description: "Branch to-dos (Encela): /todo, /todo <text>, /todo done <n>",
    });
    await $.command.register({
      name: "memo",
      description: "Branch note (Encela): /memo, /memo <text>",
    });
    await $.command.register({
      name: "notes",
      description: "Open the branch notes pane (Encela)",
    });
    await refresh($);
    $.clock.every(REFRESH_MS, () => void refresh($));
    return next(e);
  });

  // The branch can change between turns (git switch in the session).
  on("turn.complete", async ($, e, next) => {
    await refresh($);
    return next(e);
  });

  on("command.run", { command: "todo" }, async ($, e) => {
    await refresh($);
    const v = await read($, view);
    const w = words(v?.locale ?? "en");
    if (!v?.repoKey) return { text: v ? w.noRepo : w.noApp };
    const cmd = parseTodo(e.args);
    const tail = v.appRunning ? "" : `\n${w.noApp}`;
    switch (cmd.kind) {
      case "help":
        return { text: w.todoHelp };
      case "list":
        return { text: `${todoList(v)}\n\n${w.todoHelp}` };
      case "add":
        if (
          !(await send($, { op: "addTodo", repoKey: v.repoKey, branch: v.branch, text: cmd.text }))
        ) {
          return { text: w.noApp };
        }
        return { text: w.added(cmd.text) + tail };
      default: {
        const todo = v.data?.todos[cmd.index - 1];
        if (!todo) return { text: w.noSuch(cmd.index) };
        const request: Request =
          cmd.kind === "rm"
            ? { op: "deleteTodo", id: todo.id }
            : { op: "setDone", id: todo.id, done: cmd.kind === "done" };
        if (!(await send($, request))) return { text: w.noApp };
        const said = cmd.kind === "rm" ? w.removed : cmd.kind === "done" ? w.done : w.undone;
        return { text: said(todo.text) + tail };
      }
    }
  });

  on("command.run", { command: "memo" }, async ($, e) => {
    await refresh($);
    const v = await read($, view);
    const w = words(v?.locale ?? "en");
    if (!v?.repoKey) return { text: v ? w.noRepo : w.noApp };
    const text = e.args.trim();
    if (!text) return { text: v.data?.note.trim() ? v.data.note : `${w.empty}\n${w.memoHelp}` };
    if (!(await send($, { op: "appendNote", repoKey: v.repoKey, branch: v.branch, text }))) {
      return { text: w.noApp };
    }
    return { text: w.noted + (v.appRunning ? "" : `\n${w.noApp}`) };
  });

  on("command.run", { command: "notes" }, async ($) => {
    const v = await read($, view);
    await $.ui.open({ id: PANE, title: words(v?.locale ?? "en").paneTitle });
    await update($, isHidden, () => false);
    return {};
  });

  // Above the prompt: suggestions for the draft, then the branch line.
  on("ui.render", { component: "AbovePrompt" }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e);
    const v = await read($, view);
    const w = words(v?.locale ?? "en");
    const text = v ? bandText(v) : null;
    const band = !!v && !!text && !(await read($, isHidden));
    const s = await read($, suggestion);
    const suggest = !!s && (s.items.length > 0 || s.pending);
    if (!band && !suggest) return next(e);
    const { Box, Button, Text } = $.ui.resolve(e);
    const offers = s?.items.some((c) => c.source !== "installed") ?? false;
    return (
      <Box flexDirection="column">
        {suggest && s ? (
          <Box key="suggest">
            <Text dimColor>{`${s.by === "ai" ? "✨" : "💡"} ${w.suggest} `}</Text>
            {s.items.map((c) => (
              <Button key={c.key} label={label(c)} onPress={() => void pick($, c)} />
            ))}
            {s.pending ? <Text dimColor> {w.picking}</Text> : null}
            {offers ? <Text dimColor> {w.suggestLegend}</Text> : null}
            <Button
              key="mute"
              label="×"
              dimColor
              onPress={() => {
                muted = true;
                void clearSuggestion($);
              }}
            />
          </Box>
        ) : null}
        {band ? (
          <Box key="band">
            <Text dimColor wrap="truncate">
              {text}{" "}
            </Text>
            <Button
              key="open"
              label={w.paneTitle}
              dimColor
              onPress={() => void $.ui.open({ id: PANE, title: w.paneTitle })}
            />
            <Button key="hide" label="×" dimColor onPress={() => update($, isHidden, () => true)} />
          </Box>
        ) : null}
      </Box>
    );
  });

  // Suggestions follow the draft as it is typed, recalled or cleared.
  on("prompt.edit", async ($, e, next) => {
    const result = await next(e);
    await onDraft($, result.text);
    return result;
  });

  on("prompt.change", async ($, e, next) => {
    const result = await next(e);
    await onDraft($, e.text);
    return result;
  });

  // Never holds up the prompt: clearing the suggestions may fail on its own.
  on("prompt.submit", async ($, e, next) => {
    muted = false;
    current = "";
    await clearSuggestion($).catch(() => {});
    return next(e);
  });

  // The pane: the note, and the to-dos to tick.
  on("ui.render", { component: "Pane", requestId: PANE }, async ($, e) => {
    const { Box, Button, Markdown, Text } = $.ui.resolve(e);
    const v = await read($, view);
    const w = words(v?.locale ?? "en");
    if (!v?.repoKey) return <Text dimColor>{v ? w.noRepo : w.noApp}</Text>;
    const d = v.data;
    return (
      <Box flexDirection="column">
        <Text bold>⎇ {v.branch || "-"}</Text>
        {!v.appRunning && <Text dimColor>{w.noApp}</Text>}
        {!d && <Text dimColor>{w.empty}</Text>}
        {d?.note.trim() ? (
          <Box flexDirection="column">
            <Text bold>{w.noteTitle}</Text>
            <Markdown key="note" text={d.note} />
          </Box>
        ) : null}
        {d?.todos.length ? (
          <Box flexDirection="column">
            <Text bold>{w.todosTitle}</Text>
            {d.todos.map((t, i) => (
              <Button
                key={`todo-${t.id}`}
                plain
                dimColor={t.done}
                onPress={() => void send($, { op: "setDone", id: t.id, done: !t.done })}
              >
                {`${i + 1}. ${t.done ? "☑" : "☐"} ${t.text}`}
              </Button>
            ))}
          </Box>
        ) : null}
        <Text dimColor>{w.todoHelp}</Text>
      </Box>
    );
  });

  // Claude reads the branch's note and to-dos with the system prompt.
  on("prompt.compose", async ($, e, next) => {
    const result = await next(e);
    const v = await read($, view);
    const text = v ? contextText(v) : null;
    if (!text) return result;
    return {
      ...result,
      sections: [
        ...result.sections,
        { id: "branch-notes:context", text, scope: "session" as const },
      ],
    };
  });
};
