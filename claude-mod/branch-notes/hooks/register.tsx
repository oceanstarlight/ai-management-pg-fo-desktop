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
import { isNewProject, missingFields, type Starter, startersFor } from "./starters";
import {
  AI_DELAY_MS,
  AI_SYSTEM,
  aiAsk,
  aiCatalog,
  autoContext,
  buildCandidates,
  type Candidate,
  cleanRefined,
  decisionsFor,
  draftWith,
  installedCandidate,
  keywordRank,
  label,
  NEW_AUTOMATION,
  parseAiReply,
  REFINE_SYSTEM,
  refineAsk,
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
/** The starter forms offered above an empty prompt, or the required fields
 * a filled-in form still leaves blank. */
const starter = atom({ plugin: "branch-notes", key: "starter" } as const, null);

/** The export's suggestion settings and catalog, as last read. */
let lastSuggest: SuggestExport | undefined;
/** This session's id for the app (its live view and its commands). */
let session = "";
/** The repository's top folder, or where the session started. */
let projectDir = "";
/** The app's last command run (`outbox/<session>.json`). */
let lastSeq = 0;
/** How often the app's commands are looked for. */
const OUTBOX_MS = 800;
/** The live view goes to the app after this pause. */
const LIVE_MS = 400;
let liveTimer: { cancel: () => void } | null = null;
/** The prompt before it was refined, for undo. */
let original: string | null = null;
/** The prompt last sent, to pair with Claude's answer. */
let lastPrompt = "";
/** A new project's first prompt is still to come: the starter forms are offered. */
let offerStarters = false;

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
/** What was suggested and picked for the prompt being written, for the app's log. */
let shown: { draft: string; items: Candidate[]; by: "keyword" | "ai" } | null = null;
let picked: string[] = [];

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

type Shown = { draft: string; items: Candidate[]; by: "keyword" | "ai"; pending: boolean } | null;

/** Changes what the band shows, and tells the app a moment later. */
async function setSuggestion($: EngineInterface, f: (s: Shown) => Shown) {
  await update($, suggestion, f);
  liveTimer?.cancel();
  liveTimer = $.clock.after(LIVE_MS, () => {
    liveTimer = null;
    void pushLive($).catch(() => {});
  });
}

/** The prompt being written and its suggestions, for the app's sidebar. */
async function pushLive($: EngineInterface) {
  if (!session) return;
  const s = await read($, suggestion);
  const locale = (await read($, view))?.locale ?? "en";
  await send($, {
    op: "suggestLive",
    session,
    project: projectDir,
    draft: s?.draft ?? current,
    by: s?.by ?? "keyword",
    pending: s?.pending ?? false,
    items: (s?.items ?? []).map((c) => ({
      key: c.key,
      name: c.name,
      kind: c.kind,
      source: c.source,
      label: label(c, locale),
      description: c.description,
    })),
    picked,
  });
}

async function clearSuggestion($: EngineInterface) {
  timer?.cancel();
  timer = null;
  asking?.abort();
  asking = null;
  if (await read($, suggestion)) await setSuggestion($, () => null);
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
      prompt: [
        { text: catalog, cache: true },
        { text: aiAsk(draft, decisionsFor(lastSuggest, projectDir)) },
      ],
      maxTokens: 40,
      effort: "low",
      timeoutMs: 15000,
    },
    { signal: stop.signal },
  );
  if (asking === stop) asking = null;
  if (current !== draft || muted) return;
  if (!r.isAnswered) {
    await setSuggestion($, (s) => (s && s.draft === draft ? { ...s, pending: false } : s));
    return;
  }
  const items = parseAiReply(r.text, list);
  if (picks.size > 50) picks.clear();
  picks.set(
    `${draft}\n${catalog.length}`,
    items.map((c) => c.key),
  );
  shown = { draft, items, by: "ai" };
  await setSuggestion($, () => ({ draft, items, by: "ai" as const, pending: false }));
}

/** Suggests for the draft: keyword matches at once, Haiku's picks after a pause. */
async function onDraft($: EngineInterface, text: string) {
  const draft = text.trim();
  if (draft === current) return;
  current = draft;
  await showStarter($, draft).catch(() => {});
  if (!draft) muted = false;
  const mode = suggestMode({ suggest: lastSuggest });
  if (mode === "off" || muted || !wantsSuggestions(draft)) {
    shown = null;
    await clearSuggestion($);
    return;
  }
  const list = await candidates($);
  if (current !== draft) return;
  const quick = keywordRank(draft, list);
  timer?.cancel();
  timer = null;
  shown = { draft, items: quick, by: "keyword" };
  if (mode === "keyword") {
    await setSuggestion($, () => ({
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
    shown = { draft, items, by: "ai" };
    await setSuggestion($, () => ({ draft, items, by: "ai" as const, pending: false }));
    return;
  }
  await setSuggestion($, () => ({
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

/** Whether this session's project is new: no CLAUDE.md, nothing settled. */
async function newProject($: EngineInterface): Promise<boolean> {
  if (suggestMode({ suggest: lastSuggest }) === "off" || !projectDir) return false;
  const s = sep(projectDir);
  const md =
    (await $.fs.exists(`${projectDir}${s}CLAUDE.md`).catch(() => false)) ||
    (await $.fs.exists(`${projectDir}${s}.claude${s}CLAUDE.md`).catch(() => false));
  return isNewProject(md, decisionsFor(lastSuggest, projectDir));
}

/** The forms above an empty prompt; blank required fields once one is filled in. */
async function showStarter($: EngineInterface, draft: string) {
  let next: { forms: Starter[] } | { missing: string[] } | null = null;
  if (offerStarters && !draft) {
    const locale = (await read($, view))?.locale ?? "en";
    next = { forms: startersFor(lastSuggest?.starters, locale) };
  } else if (draft.includes("*")) {
    const missing = missingFields(draft);
    if (missing.length) next = { missing };
  }
  const prev = await read($, starter);
  if (JSON.stringify(prev) !== JSON.stringify(next)) await update($, starter, () => next);
}

/** Asks the app to add, install or start what a suggestion names. */
/** `prompt` is read only for a new automation. */
async function act(
  $: EngineInterface,
  c: Candidate,
  prompt: () => Promise<string>,
): Promise<boolean> {
  const v = await read($, view);
  const w = words(v?.locale ?? "en");
  if (!v?.appRunning) {
    $.ui.toast(w.noAppForSuggest);
    return false;
  }
  const project = (await git($, ["rev-parse", "--show-toplevel"])) ?? "";
  if (c.source === "library" && c.libraryKind && c.libraryId) {
    if (!project) {
      $.ui.toast(w.noRepo);
      return false;
    }
    await send($, { op: "applyLibrary", project, kind: c.libraryKind, id: c.libraryId });
  } else if (c.extensionId) {
    await send($, { op: "installExtension", id: c.extensionId });
  } else if (c.source === "recommended" && c.mcpId) {
    await send($, { op: "addMcp", id: c.mcpId, project });
  } else if (c.key === NEW_AUTOMATION) {
    await send($, { op: "draftAutomation", prompt: (await prompt()).trim(), project });
  } else if (c.automationId) {
    await send($, { op: "runAutomation", id: c.automationId });
  } else {
    return false;
  }
  scannedAt = 0;
  return true;
}

/** Uses a suggestion: into the prompt, or a request for the app. */
async function pick($: EngineInterface, c: Candidate) {
  const locale = (await read($, view))?.locale ?? "en";
  const w = words(locale);
  if (!picked.includes(c.key)) picked.push(c.key);
  const box = async () => (await $.prompt.read()).text;
  if (c.source === "installed") {
    await $.prompt.fill({ text: draftWith(await box(), c, locale), mode: "replace" });
    return;
  }
  if (!(await act($, c, box))) return;
  if (c.source === "library") $.ui.toast(w.adding(c.name));
  else if (c.extensionId) $.ui.toast(w.installing(c.name));
  else if (c.source === "recommended") $.ui.toast(w.addingMcp(c.name));
  else if (c.key === NEW_AUTOMATION) $.ui.toast(w.draftingAutomation);
  else $.ui.toast(w.runningAutomation(c.name));
  await clearSuggestion($);
}

/** Haiku rewrites the prompt with the suggestions and the project's decisions. */
async function refine($: EngineInterface) {
  const w = words((await read($, view))?.locale ?? "en");
  const box = await $.prompt.read();
  const draft = box.text.trim();
  if (!wantsSuggestions(draft)) return;
  $.ui.toast(w.refining);
  const use = ((await read($, suggestion))?.items ?? []).filter((c) => c.source === "installed");
  const r = await $.model.complete({
    model: "haiku",
    system: REFINE_SYSTEM,
    prompt: [{ text: refineAsk(draft, use, decisionsFor(lastSuggest, projectDir)) }],
    maxTokens: 1500,
    effort: "low",
    timeoutMs: 30000,
  });
  const text = r.isAnswered ? cleanRefined(r.text) : "";
  if (!text) {
    $.ui.toast(w.refineFailed);
    return;
  }
  original = box.text;
  for (const c of use) if (!picked.includes(c.key)) picked.push(c.key);
  await $.prompt.fill({ text, mode: "replace" });
}

async function undoRefine($: EngineInterface) {
  if (original === null) return;
  const text = original;
  original = null;
  await $.prompt.fill({ text, mode: "replace" });
}

/** Auto mode: what wasn't picked is used as the prompt is sent. Returns the
 * context to send along (the installed items to use), if any. */
async function autoApply($: EngineInterface, prompt: string): Promise<string | null> {
  const last = shown;
  if (!lastSuggest?.auto || !last?.items.length) return null;
  const left = last.items.filter((c) => !picked.includes(c.key) && !c.automationId);
  const used: Candidate[] = [];
  for (const c of left) {
    if (c.source === "installed" || (await act($, c, async () => prompt))) {
      used.push(c);
      picked.push(c.key);
    }
  }
  if (used.length) {
    const w = words((await read($, view))?.locale ?? "en");
    $.ui.toast(w.autoApplied(used.map((c) => c.name).join(", ")));
  }
  return autoContext(used);
}

/** Runs what the app asked for in the sidebar (`outbox/<session>.json`). */
async function readOutbox($: EngineInterface) {
  const dir = session ? await bridgeDir($) : null;
  if (!dir) return;
  const s = sep(dir);
  let commands: { seq?: unknown; op?: unknown; key?: unknown; text?: unknown }[];
  try {
    const text = (await $.fs.read(`${dir}${s}outbox${s}${session}.json`)) as string;
    commands = JSON.parse(text)?.commands ?? [];
  } catch {
    return;
  }
  for (const c of commands) {
    if (typeof c.seq !== "number" || c.seq <= lastSeq) continue;
    lastSeq = c.seq;
    if (c.op === "pick") {
      const item = (await read($, suggestion))?.items.find((i) => i.key === c.key);
      if (item) await pick($, item);
    } else if (c.op === "fill" && typeof c.text === "string") {
      await $.prompt.fill({ text: c.text, mode: "replace" });
    } else if (c.op === "refine") {
      await refine($);
    } else if (c.op === "undo") {
      await undoRefine($);
    }
  }
}

/** Tells the app what was suggested for the prompt just sent, and what was picked. */
async function logSent($: EngineInterface) {
  const last = shown;
  const chosen = picked;
  shown = null;
  picked = [];
  if (!last?.items.length) return;
  const project = (await git($, ["rev-parse", "--show-toplevel"])) ?? "";
  await send($, {
    op: "suggestLog",
    at: await $.clock.now(),
    project,
    draft: last.draft,
    by: last.by,
    items: last.items.map((c) => ({ key: c.key, name: c.name, kind: c.kind, source: c.source })),
    picked: chosen,
  });
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
    const now = await $.clock.now();
    session = `s${now}${Math.floor(Math.random() * 1e6)}`;
    lastSeq = now;
    projectDir = (await git($, ["rev-parse", "--show-toplevel"])) ?? e.cwd;
    offerStarters = await newProject($).catch(() => false);
    await showStarter($, "").catch(() => {});
    await send($, { op: "sessionStart", session, project: projectDir, surface: e.surface ?? "" });
    $.clock.every(OUTBOX_MS, () => void readOutbox($).catch(() => {}));
    return next(e);
  });

  on("session.end", async ($, e, next) => {
    if (session) await send($, { op: "sessionEnd", session }).catch(() => false);
    return next(e);
  });

  // The branch can change between turns (git switch in the session); the
  // app looks for decisions settled in the answer.
  on("turn.complete", async ($, e, next) => {
    await refresh($);
    if (e.agentId === undefined && e.reason === "answer" && lastPrompt && session) {
      await send($, {
        op: "turnAnswer",
        session,
        project: projectDir,
        prompt: lastPrompt.slice(0, 4000),
        answer: e.answer.slice(0, 20000),
      }).catch(() => false);
    }
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
    const st = await read($, starter);
    if (!band && !suggest && !st) return next(e);
    const { Box, Button, Text } = $.ui.resolve(e);
    const legend = [
      s?.items.some((c) => c.source === "library") ? w.legendAdd : null,
      s?.items.some((c) => c.source === "extension" || c.source === "recommended")
        ? w.legendInstall
        : null,
      s?.items.some((c) => c.source === "automation") ? w.legendAutomation : null,
    ]
      .filter(Boolean)
      .join(" · ");
    return (
      <Box flexDirection="column">
        {st && "forms" in st ? (
          <Box key="starter">
            <Text dimColor>{`📝 ${w.starters} `}</Text>
            {st.forms.map((f) => (
              <Button
                key={`starter-${f.id}`}
                label={f.name}
                onPress={() => void $.prompt.fill({ text: f.text, mode: "replace" })}
              />
            ))}
            <Text> </Text>
            <Button
              key="starter-hide"
              label="×"
              dimColor
              onPress={() => {
                offerStarters = false;
                void update($, starter, () => null);
              }}
            />
          </Box>
        ) : null}
        {st && "missing" in st ? (
          <Box key="starter-missing">
            <Text dimColor wrap="truncate">{`📝 ${w.startersMissing(st.missing.join(", "))}`}</Text>
          </Box>
        ) : null}
        {suggest && s ? (
          <Box key="suggest">
            <Text dimColor>{`${s.by === "ai" ? "✨" : "💡"} ${w.suggest} `}</Text>
            {s.items.map((c) => (
              <Button
                key={c.key}
                label={label(c, v?.locale ?? "en")}
                onPress={() => void pick($, c)}
              />
            ))}
            {s.pending ? <Text dimColor> {w.picking}</Text> : null}
            <Button key="refine" label={w.refine} dimColor onPress={() => void refine($)} />
            {original !== null ? (
              <Button key="undo" label={w.undo} dimColor onPress={() => void undoRefine($)} />
            ) : null}
            {legend ? <Text dimColor>{` ${legend} `}</Text> : <Text> </Text>}
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
  // In auto mode, what was suggested and not picked is used now.
  on("prompt.submit", async ($, e, next) => {
    muted = false;
    current = "";
    original = null;
    lastPrompt = e.text;
    offerStarters = false;
    await update($, starter, () => null).catch(() => {});
    const extra = e.command ? null : await autoApply($, e.text).catch(() => null);
    await clearSuggestion($).catch(() => {});
    await logSent($).catch(() => {});
    return next(extra ? { ...e, context: [...(e.context ?? []), extra] } : e);
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
    const decisions = decisionsFor(lastSuggest, projectDir);
    const sections = [...result.sections];
    if (text) sections.push({ id: "branch-notes:context", text, scope: "session" as const });
    if (decisions.length) {
      sections.push({
        id: "branch-notes:decisions",
        text: `Settled for this project (keep to these unless the user changes them):\n${decisions.map((d) => `- ${d}`).join("\n")}`,
        scope: "session" as const,
      });
    }
    return sections.length === result.sections.length ? result : { ...result, sections };
  });
};
