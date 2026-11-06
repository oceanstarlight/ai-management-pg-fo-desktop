// Prompt suggestions without the engine: the candidates (what is installed,
// the app's library and block catalog, extensions, MCP servers, automations), keyword
// matching, and the Haiku request and its reply. The app's own prompt box
// (src/features/suggest) imports this file too, so it has no engine imports.
// Kept in sync with src-tauri/src/suggest (the export's `suggest` section
// and the requests the mod sends).

export type CandidateKind =
  | "skill"
  | "agent"
  | "command"
  | "instruction"
  | "rule"
  | "hook"
  | "extension"
  | "mcp"
  | "automation";

/**
 * `installed`: usable now. `library`: in the app's library, added to the
 * project on pick. `catalog`: one of the app's ready-made blocks (instruction,
 * rule, skill, subagent, hook), written into the project on pick (for the
 * user only). `extension`: a GitHub extension to install. `recommended`:
 * an MCP server to add. `automation`: one of the app's automations, or a new one.
 */
export type CandidateSource =
  | "installed"
  | "library"
  | "catalog"
  | "extension"
  | "recommended"
  | "automation";

/** Something the prompt suggestions can offer. */
export type Candidate = {
  /** Unique: `i:skill:review`, `l:agent:debugger`, `b:builtin:rust`, `e:rea`, `m:github`, `a:new`. */
  key: string;
  kind: CandidateKind;
  source: CandidateSource;
  /** How Claude Code calls it (`review`, `superpowers:brainstorm`). */
  name: string;
  description: string;
  keywords?: string[];
  libraryKind?: "skill" | "agent";
  libraryId?: string;
  /** A catalog block's id (`builtin:rust`). */
  blockId?: string;
  /** Instructions and rules: the text sent with the prompt it is picked for. */
  context?: string;
  /** Hooks: the command it runs, shown before it is added. */
  command?: string;
  extensionId?: string;
  mcpId?: string;
  automationId?: string;
  /** How sure the pick is, 1 (barely related) to 6 (clearly needed). */
  confidence?: number;
};

/** What is suggested for the draft being typed. */
export type Suggestion = {
  draft: string;
  items: Candidate[];
  by: "keyword" | "ai";
  /** Haiku is still picking. */
  pending: boolean;
};

export type SuggestMode = "ai" | "keyword" | "off";

/** The key of the "make this an automation" suggestion. */
export const NEW_AUTOMATION = "a:new";

/** The export's `suggest` section. */
/** The model that picks suggestions and refines prompts. */
export type AgentModel = "haiku" | "sonnet" | "opus";

export type SuggestExport = {
  mode: SuggestMode;
  /** The agent's model; Haiku when unset. */
  model?: AgentModel;
  /** Suggestions are used without asking, when the prompt is sent. */
  auto?: boolean;
  /** Each project's settled decisions (`topic: value`), by project folder. */
  decisions?: Record<string, string[]>;
  library: { kind: "skill" | "agent"; id: string; name: string; description: string }[];
  /** The app's catalog blocks; titles and summaries in the UI language. */
  blocks?: {
    id: string;
    kind: "instruction" | "rule" | "skill" | "agent" | "hook";
    name: string;
    title: string;
    summary: string;
    category: string;
    description: string;
    context?: string;
    command?: string;
  }[];
  extensions: {
    id: string;
    name: string;
    kind: "plugin" | "marketplace" | "mcp";
    repo: string;
    summary: string;
    keywords: string[];
    installed: boolean | null;
  }[];
  /** MCP servers: the ones Claude Code has, and recommended ones to add. */
  mcp?: {
    id: string | null;
    name: string;
    summary: string;
    keywords: string[];
    installed: boolean;
  }[];
  automations?: { id: string; name: string; prompt: string; enabled: boolean }[];
  /** The user's project starter forms (`starters.ts`); unset for the built-in ones. */
  starters?: unknown;
};

/** Words that ask for something on a schedule. */
const RECURRING = [
  "매일",
  "매주",
  "매달",
  "매시간",
  "아침마다",
  "저녁마다",
  "밤마다",
  "정기",
  "주기적",
  "스케줄",
  "예약",
  "자동화",
  "daily",
  "weekly",
  "hourly",
  "every",
  "schedule",
  "recurring",
  "cron",
  "automate",
  "automation",
];

/** Messages Claude Code delivers as a prompt: a session's or a task's output, not a request. */
const RELAYED = /^(<(agent-message|task-notification)[\s>]|Another Claude session sent a message:)/;
/** Keyword matching reads this much of a prompt: more only adds chance matches. */
const MAX_MATCHED = 1500;
/** A request for work, not talk about something: an imperative in Korean or English. */
const ASKS_FOR_WORK = [
  /(작성|추가|구현|수정|고쳐|고치|만들|설계|리뷰|검토|분석|리팩[터토]링?|디버그|디버깅|점검|그려|그리|정리|배포|테스트)(을|를)?\s*(해\s*|하\s*|어\s*|어서\s*)?(줘|주세요|주실|줄래|줄\s*수|달라|봐|볼래|(?<=[하들치])자|할래|부탁|해야)/,
  /(^|[.!?\n]\s*)(please\s+|can you\s+|could you\s+)?(write|add|fix|implement|create|make|refactor|review|build|design|generate|debug|update|migrate)\b/i,
];
/** Drafts shorter than this get no suggestions. */
export const MIN_CHARS = 8;
/** At most this many suggestions show. */
export const MAX_ITEMS = 3;
/** Haiku is asked once typing stops for this long. */
export const AI_DELAY_MS = 1200;
/** Descriptions are cut to this for matching and for Haiku. */
const MAX_DESCRIPTION = 200;

export function suggestMode(exp: { suggest?: { mode?: string } } | null | undefined): SuggestMode {
  const mode = exp?.suggest?.mode;
  return mode === "keyword" || mode === "off" ? mode : "ai";
}

/** The agent's model alias from the export, Haiku unless another is chosen. */
export function agentModel(exp: SuggestExport | null | undefined): AgentModel {
  const m = exp?.model;
  return m === "sonnet" || m === "opus" ? m : "haiku";
}

/** A confidence of 1-6, or none. */
export function clampConfidence(n: unknown): number | undefined {
  return typeof n === "number" && Number.isFinite(n)
    ? Math.min(6, Math.max(1, Math.round(n)))
    : undefined;
}

/** Keyword scores as a confidence: matching words alone never reach 6. */
export function keywordConfidence(score: number): number {
  if (score >= 9) return 5;
  if (score >= 6) return 4;
  if (score >= 3) return 3;
  return 2;
}

/** Whether a draft is worth suggesting for: not a command or a shell line. */
export function wantsSuggestions(draft: string): boolean {
  const text = draft.trim();
  return text.length >= MIN_CHARS && !/^[/!#]/.test(text) && !RELAYED.test(text);
}

/** `name` and `description` from a Markdown file's YAML frontmatter. */
export function parseFrontmatter(text: string): { name?: string; description?: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return {};
  const lines = (m[1] ?? "").split(/\r?\n/);
  const out: { name?: string; description?: string } = {};
  for (let i = 0; i < lines.length; i++) {
    const field = /^(name|description):\s*(.*)$/.exec(lines[i] ?? "");
    if (!field) continue;
    const key = field[1] as "name" | "description";
    let value = (field[2] ?? "").trim();
    if (value === "" || value === "|" || value === ">" || /^[|>][-+]?$/.test(value)) {
      const block: string[] = [];
      while (i + 1 < lines.length && /^(\s+|$)/.test(lines[i + 1] ?? "")) {
        block.push((lines[++i] ?? "").trim());
      }
      value = block.join(" ").trim();
    }
    value = value.replace(/^(["'])([\s\S]*)\1$/, "$2");
    out[key] = value;
  }
  return out;
}

const clip = (text: string) =>
  text.length > MAX_DESCRIPTION ? `${text.slice(0, MAX_DESCRIPTION - 1)}…` : text;

/** A candidate for a skill, subagent or command file Claude Code loads. */
export function installedCandidate(
  kind: "skill" | "agent" | "command",
  fallbackName: string,
  text: string,
  plugin?: string,
): Candidate | null {
  const fm = parseFrontmatter(text);
  const base = (kind === "command" ? fallbackName : fm.name || fallbackName).trim();
  if (!base) return null;
  const name = plugin ? `${plugin}:${base}` : base;
  let description = fm.description ?? "";
  if (!description && kind === "command") {
    description =
      text
        .replace(/^---[\s\S]*?---/, "")
        .trim()
        .split(/\r?\n/)[0] ?? "";
  }
  return {
    key: `i:${kind}:${name}`,
    kind,
    source: "installed",
    name,
    description: clip(description),
  };
}

/**
 * Everything that can be suggested: installed items first, then library
 * items not installed under the same name, then catalog blocks (skills and
 * subagents only when neither installed nor in the library under the same
 * name), then extensions not known to be installed.
 */
export function buildCandidates(installed: Candidate[], exp?: SuggestExport | null): Candidate[] {
  const seen = new Set<string>();
  const out: Candidate[] = [];
  for (const c of installed) {
    if (seen.has(c.key)) continue;
    seen.add(c.key);
    out.push(c);
  }
  const names = new Set(installed.map((c) => `${c.kind}:${c.name.toLowerCase()}`));
  for (const item of exp?.library ?? []) {
    if (names.has(`${item.kind}:${item.name.toLowerCase()}`)) continue;
    out.push({
      key: `l:${item.kind}:${item.id}`,
      kind: item.kind,
      source: "library",
      name: item.name || item.id,
      description: clip(item.description ?? ""),
      libraryKind: item.kind,
      libraryId: item.id,
    });
    names.add(`${item.kind}:${(item.name || item.id).toLowerCase()}`);
  }
  for (const b of exp?.blocks ?? []) {
    if (
      (b.kind === "skill" || b.kind === "agent") &&
      names.has(`${b.kind}:${b.name.toLowerCase()}`)
    )
      continue;
    const about = [b.summary, b.description].filter(Boolean).join(" ");
    out.push({
      key: `b:${b.id}`,
      kind: b.kind,
      source: "catalog",
      name: b.name,
      description: clip(`${b.title}${about ? ` - ${about}` : ""}`),
      keywords: tokens(`${b.title} ${b.category}`),
      blockId: b.id,
      context: b.context,
      command: b.command,
    });
  }
  for (const ext of exp?.extensions ?? []) {
    if (ext.installed) continue;
    out.push({
      key: `e:${ext.id}`,
      kind: "extension",
      source: "extension",
      name: ext.name,
      description: clip(ext.summary),
      keywords: ext.keywords,
      extensionId: ext.id,
    });
  }
  const servers = new Set(installed.filter((c) => c.kind === "mcp").map((c) => c.name));
  for (const server of exp?.mcp ?? []) {
    if (servers.has(server.name)) continue;
    servers.add(server.name);
    out.push({
      key: server.installed ? `i:mcp:${server.name}` : `m:${server.id ?? server.name}`,
      kind: "mcp",
      source: server.installed ? "installed" : "recommended",
      name: server.name,
      description: clip(server.summary),
      keywords: server.keywords,
      mcpId: server.id ?? undefined,
    });
  }
  for (const a of exp?.automations ?? []) {
    out.push({
      key: `a:${a.id}`,
      kind: "automation",
      source: "automation",
      name: a.name,
      description: clip(a.prompt),
      automationId: a.id,
    });
  }
  if (exp) {
    out.push({
      key: NEW_AUTOMATION,
      kind: "automation",
      source: "automation",
      name: "new automation",
      description:
        "Run this prompt on a schedule (daily, weekly, every few hours) from the Encela app",
      keywords: RECURRING,
    });
  }
  return out;
}

/** Korean words a prompt may use, and the English ones skills describe themselves with. */
const SYNONYMS: Record<string, string[]> = {
  flowchart: ["diagram"],
  순서도: ["diagram", "flowchart"],
  리뷰: ["review"],
  검토: ["review"],
  테스트: ["test"],
  tdd: ["test"],
  디버그: ["debug", "bug"],
  디버깅: ["debug", "bug"],
  버그: ["bug", "debug", "fix"],
  오류: ["error", "debug", "fix"],
  에러: ["error", "debug", "fix"],
  고쳐: ["fix", "debug"],
  수정: ["fix", "edit"],
  커밋: ["commit", "git"],
  깃: ["git"],
  문서: ["docs", "documentation", "readme"],
  계획: ["plan", "planning"],
  설계: ["design", "architecture", "plan"],
  아키텍처: ["architecture", "design"],
  보안: ["security", "vulnerability"],
  취약점: ["security", "vulnerability"],
  배포: ["deploy", "release", "ship"],
  릴리스: ["release", "ship"],
  리팩터: ["refactor"],
  리팩토링: ["refactor"],
  성능: ["performance", "optimize"],
  최적화: ["optimize", "performance"],
  프론트: ["frontend", "ui"],
  프론트엔드: ["frontend", "ui"],
  백엔드: ["backend", "api", "server"],
  데이터베이스: ["database", "sql"],
  디비: ["database", "sql"],
  브레인스토밍: ["brainstorm"],
  아이디어: ["brainstorm", "idea"],
  리버스: ["reverse", "reversing"],
  역공학: ["reverse", "reversing", "decompile"],
  디컴파일: ["decompile", "reverse"],
  분석: ["analyze", "analysis"],
  스크래핑: ["scrape", "scraping", "web"],
  크롤링: ["crawl", "scrape", "web"],
  검색: ["search", "web"],
  번역: ["translate"],
  요약: ["summarize", "summary"],
  메일: ["email", "mail", "gmail"],
  이메일: ["email", "mail", "gmail"],
  슬라이드: ["slides", "presentation", "pptx"],
  엑셀: ["excel", "xlsx", "spreadsheet"],
  표: ["table", "spreadsheet"],
  차트: ["chart", "visualization"],
  그래프: ["chart", "graph"],
  타입: ["type", "typescript"],
  린트: ["lint"],
  인프라: ["infrastructure", "devops"],
  쿠버네티스: ["kubernetes", "k8s"],
  도커: ["docker", "container"],
  에이전트: ["agent", "subagent"],
  서브에이전트: ["subagent", "agent"],
  자동화: ["automation", "workflow"],
  안드로이드: ["android", "apk"],
};

/** Korean particles and endings dropped before matching (`리뷰를` → `리뷰`). */
const ENDINGS =
  /(으로|에서|에게|하고|해줘|해 줘|해주세요|합니다|해요|하기|하는|이랑|랑|를|을|이|가|은|는|도|의|에|로|와|과|좀)$/;

const STOP = new Set([
  "the",
  "and",
  "for",
  "with",
  "this",
  "that",
  "please",
  "can",
  "you",
  "make",
  "use",
  "from",
  "into",
  "add",
  "an",
  "in",
  "on",
  "at",
  "to",
  "of",
  "or",
  "is",
  "it",
  "its",
  "be",
  "as",
  "by",
  "if",
  "so",
  "no",
  "not",
  "are",
  "was",
  "my",
  "me",
  "we",
  "do",
  "all",
  "when",
  "what",
  "how",
  "why",
  "there",
  "here",
]);

/** One entry per thing the text says: a word and its synonyms, so 테스트 with its
 * test and tdd count once, and 에이전트 and 에이전트들 are the same entry. */
export function concepts(text: string): string[][] {
  const out = new Map<string, Set<string>>();
  for (const raw of text.toLowerCase().split(/[^\p{L}\p{N}+#.]+/u)) {
    let word = raw.replace(/^\.+|\.+$/g, "");
    if (/[가-힣]/.test(word)) {
      const stem = word.replace(ENDINGS, "");
      if (stem.length >= 1) word = stem;
    }
    if (word.length < 2 || STOP.has(word)) continue;
    const same = Object.entries(SYNONYMS).filter(
      ([ko]) => word === ko || (ko.length >= 2 && word.startsWith(ko)),
    );
    const key = same[0]?.[0] ?? word;
    const group = out.get(key) ?? new Set<string>();
    group.add(word);
    for (const [, en] of same) for (const e of en) group.add(e);
    out.set(key, group);
  }
  return [...out.values()].map((g) => [...g]);
}

/** Lower-case words of text, Korean endings dropped, synonyms added. */
export function tokens(text: string): string[] {
  return [...new Set(concepts(text).flat())];
}

/** How well c matches: each concept counts once, by its best word. strong is how
 * many hit the name or a keyword. */
function score(words: string[][], c: Candidate): { total: number; strong: number } {
  const name = c.name.toLowerCase();
  const nameWords = tokens(c.name.replace(/[-_:]/g, " "));
  const desc = new Set(tokens(c.description));
  const keywords = new Set((c.keywords ?? []).map((k) => k.toLowerCase()));
  let total = 0;
  let strong = 0;
  for (const group of words) {
    let best = 0;
    for (const w of group) {
      let s = 0;
      if (name === w || nameWords.includes(w)) s += 3;
      else if (
        w.length >= 4 &&
        nameWords.some(
          (n) => n.length >= 4 && (n.startsWith(w.replace(/s$/, "")) || w.startsWith(n)),
        )
      )
        s += 2;
      if (keywords.has(w)) s += 2;
      if (desc.has(w)) s += 1;
      else if (w.length >= 5 && [...desc].some((d) => d.startsWith(w))) s += 1;
      best = Math.max(best, s);
    }
    total += best;
    if (best >= 2) strong++;
  }
  return { total, strong };
}

/** The best keyword matches, installed ones first when equal. */
export function keywordRank(
  draft: string,
  candidates: Candidate[],
  limit = MAX_ITEMS,
): Candidate[] {
  const words = concepts(draft.slice(0, MAX_MATCHED));
  if (!words.length) return [];
  const work = ASKS_FOR_WORK.some((r) => r.test(draft));
  const order = {
    installed: 0,
    library: 1,
    catalog: 2,
    recommended: 3,
    extension: 4,
    automation: 5,
  } as const;
  return (
    candidates
      .map((c) => ({ c, ...score(words, c) }))
      .filter((x) => x.total >= 2)
      // One word in common is a lead, not a fit, unless the prompt asks for
      // work and the word is the thing's name or one of its keywords.
      .map((x) => ({ ...x, sure: x.strong >= 2 || (x.strong >= 1 && work) }))
      .sort(
        (a, b) =>
          Number(b.strong >= 2) - Number(a.strong >= 2) ||
          Number(b.sure) - Number(a.sure) ||
          b.total - a.total ||
          order[a.c.source] - order[b.c.source],
      )
      .slice(0, limit)
      .map((x) => ({
        ...x.c,
        confidence: x.sure ? keywordConfidence(x.total) : Math.min(2, keywordConfidence(x.total)),
      }))
  );
}

export const AI_SYSTEM =
  'You pick which Claude Code skills, subagents, commands, instructions, rules, hooks, MCP servers, extensions or automations would clearly help with the task the user is typing. Judge only by what the prompt itself asks for, not by what the project might use. Suggest a language or framework guide (React, TypeScript, Rust, Python...) only when the prompt names that language or framework or asks to write code in it. A short follow-up, answer or acknowledgement without a concrete new task ("keep #1 as is", "yes, do it", "apply it there too") gets []. Suggest the new automation only when the user asks for something to happen repeatedly or on a schedule. Be strict: suggest nothing rather than something loosely related. For each pick give a confidence from 1 to 6: 6 the prompt plainly needs it, 5 very likely helps, 3-4 probably helps, 1-2 only loosely related. Reply with a JSON array of [entry number, confidence] pairs only, best first, for example [[3,6],[12,4]] or [].';

/** The numbered list Haiku picks from; the same for every draft, so it caches. */
export function aiCatalog(candidates: Candidate[]): string {
  const where = {
    installed: "ready",
    library: "in the user's library",
    catalog: "from the app's catalog",
    extension: "to install",
    recommended: "to add",
    automation: "the app's scheduler",
  };
  const lines = candidates.map(
    (c, i) =>
      `${i + 1}. [${c.kind}, ${where[c.source]}] ${c.name}${c.description ? ` - ${c.description}` : ""}`,
  );
  return `Entries:\n${lines.join("\n")}`;
}

/** The question for one draft. The project's settled decisions are left
 * out on purpose: they made every prompt look like a request for the
 * project's languages and frameworks. */
export function aiAsk(draft: string): string {
  return `The user is typing this prompt (any language):\n<<<\n${draft.slice(0, 2000)}\n>>>\nWhich entries would this prompt itself clearly need? At most ${MAX_ITEMS}. JSON array of [number, confidence] pairs only.`;
}

/** The project's decisions, found by its folder (case and slashes aside). */
export function decisionsFor(exp: SuggestExport | null | undefined, project: string): string[] {
  const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  const want = norm(project);
  if (!want || !exp?.decisions) return [];
  for (const [key, lines] of Object.entries(exp.decisions)) {
    if (norm(key) === want) return lines;
  }
  return [];
}

export const REFINE_SYSTEM =
  "You rewrite a developer's prompt for Claude Code so it gets better results. Keep the user's language, intent and every requirement; do not invent features. Make it clear and specific: the goal first, then requirements as a short list, then constraints (the project's settled decisions, when they matter), then what done looks like. Start with the given slash command when there is one. Reply with the rewritten prompt only, no preamble.";

/** What Haiku rewrites: the draft, what to use, and what is settled. */
export function refineAsk(draft: string, use: Candidate[], decisions: string[]): string {
  const command = use.find(
    (c) => c.source === "installed" && c.kind !== "agent" && c.kind !== "mcp",
  );
  const helpers = use.filter((c) => c !== command && c.source === "installed");
  const lines = [
    command ? `Slash command to start with: /${command.name}` : "",
    helpers.length
      ? `Ask Claude to use: ${helpers.map((c) => `${c.name} (${c.kind})`).join(", ")}`
      : "",
    decisions.length
      ? `Settled for this project:\n${decisions.map((d) => `- ${d}`).join("\n")}`
      : "",
    `Prompt:\n<<<\n${draft.slice(0, 4000)}\n>>>`,
  ];
  return lines.filter(Boolean).join("\n\n");
}

/** The rewritten prompt: quotes and fences Haiku sometimes adds, removed. */
export function cleanRefined(text: string): string {
  return text
    .trim()
    .replace(/^```[a-z]*\n?/i, "")
    .replace(/\n?```$/, "")
    .replace(/^<<<\n?/, "")
    .replace(/\n?>>>$/, "")
    .trim();
}

/** What the model reads beside a prompt sent in auto mode: the suggestions to use. */
export function autoContext(items: Candidate[]): string | null {
  const lines = items
    .filter((c) => c.source === "installed")
    .map((c) =>
      c.kind === "agent"
        ? `- the ${c.name} subagent`
        : c.kind === "mcp"
          ? `- the ${c.name} MCP server`
          : `- the ${c.name} ${c.kind === "command" ? "command" : "skill"}`,
    );
  if (!lines.length) return null;
  return `The user's tools suggest these for this request; use them where they help:\n${lines.join("\n")}`;
}

/** What the model reads beside a prompt: the instructions and rules picked
 * from the catalog for it (their files are read only when a session starts). */
export function blockContext(items: Candidate[]): string | null {
  const parts = items
    .filter((c) => c.source === "catalog" && c.context)
    .map((c) => `## ${c.name} (${c.kind})\n${c.context}`);
  if (!parts.length) return null;
  return `The user added these ${parts.length > 1 ? "guidelines" : "guideline"} to the project for this request; follow them:\n\n${parts.join("\n\n")}`;
}

/** Where a picked catalog block is written in the project (for the user only). */
export function blockPath(c: Candidate): string | null {
  switch (c.kind) {
    case "skill":
      return `.claude/skills/${c.name}/SKILL.md`;
    case "agent":
      return `.claude/agents/${c.name}.md`;
    case "rule":
      return `.claude/rules/${c.name}.md`;
    case "instruction":
      return "CLAUDE.local.md";
    case "hook":
      return ".claude/settings.local.json";
    default:
      return null;
  }
}

/** The app's prompt box: the draft after an instruction or rule was added,
 * asking Claude to follow it now (the file loads with the next session). */
export function draftWithBlock(draft: string, c: Candidate, locale: "ko" | "en"): string {
  const path = blockPath(c);
  if (!path || (c.kind !== "instruction" && c.kind !== "rule")) return draft;
  const ask =
    locale === "ko"
      ? `(${path}에 추가한 ${c.name} ${c.kind === "rule" ? "규칙" : "지침"}을 읽고 따라 줘)`
      : `(read and follow the ${c.name} ${c.kind} added in ${path})`;
  return draft.includes(ask) ? draft : `${draft.trimEnd()} ${ask}`;
}

/** The candidates the agent's reply names, in its order, with its confidence:
 * `[[3,6],[12,4]]`, or plain numbers `[3,12]` (no confidence). */
export function parseAiReply(text: string, candidates: Candidate[]): Candidate[] {
  const m = /\[[\d\s,.[\]]*\]/.exec(text);
  if (!m) return [];
  let entries: unknown;
  try {
    entries = JSON.parse(m[0]);
  } catch {
    return [];
  }
  if (!Array.isArray(entries)) return [];
  const out: Candidate[] = [];
  for (const entry of entries) {
    const [n, confidence] = Array.isArray(entry) ? entry : [entry, undefined];
    const c = typeof n === "number" ? candidates[n - 1] : undefined;
    if (c && !out.some((o) => o.key === c.key)) {
      out.push({ ...c, confidence: clampConfidence(confidence) });
    }
    if (out.length >= MAX_ITEMS) break;
  }
  return out;
}

/** The button's label: how it is used. */
export function label(c: Candidate, locale: "ko" | "en" = "en"): string {
  if (c.key === NEW_AUTOMATION) return locale === "ko" ? "⏰자동화로 만들기" : "⏰Automate it";
  if (c.source === "automation") return `⏰${c.name}`;
  if (c.source === "library" || c.source === "catalog") return `＋${c.name}`;
  if (c.source === "extension" || c.source === "recommended") return `⬇${c.name}`;
  if (c.kind === "mcp") return `🔌${c.name}`;
  return c.kind === "agent" ? `@${c.name}` : `/${c.name}`;
}

const KIND_WORDS: Record<CandidateKind, { ko: string; en: string }> = {
  skill: { ko: "스킬", en: "skill" },
  agent: { ko: "에이전트", en: "agent" },
  command: { ko: "명령", en: "command" },
  instruction: { ko: "지침", en: "instruction" },
  rule: { ko: "규칙", en: "rule" },
  hook: { ko: "훅", en: "hook" },
  extension: { ko: "확장", en: "extension" },
  mcp: { ko: "MCP", en: "MCP" },
  automation: { ko: "자동화", en: "automation" },
};

/** What kind of document or tool it is, in one word. */
export function kindWord(kind: CandidateKind, locale: "ko" | "en" = "en"): string {
  return KIND_WORDS[kind]?.[locale] ?? kind;
}

/** The label with its kind, for the band above the prompt: `＋api-design·스킬`.
 * Automations say what they are with ⏰ already. */
export function bandLabel(c: Candidate, locale: "ko" | "en" = "en"): string {
  if (c.kind === "automation") return label(c, locale);
  return `${label(c, locale)}·${kindWord(c.kind, locale)}`;
}

/** Each mark before a name and each kind, explained (the band's ⓘ). */
export function legendLines(locale: "ko" | "en" = "en"): string[] {
  const ko = locale === "ko";
  return ko
    ? [
        "＋ 프로젝트에 추가 · ⬇ 설치 · ⏰ 앱 자동화 · / 설치된 스킬·명령 · @ 서브에이전트 · 🔌 연결된 MCP",
        "스킬: 작업 방법 문서 · 에이전트: 따로 일하는 도우미 · 지침: 항상 지키는 글(CLAUDE.local.md) · 규칙: 특정 파일용 규칙 · 훅: 자동 실행 명령 · 확장: 묶음 설치 · MCP: 외부 도구 서버",
      ]
    : [
        "＋ adds to the project · ⬇ installs · ⏰ app automation · / installed skill or command · @ subagent · 🔌 connected MCP",
        "skill: how-to document · agent: separate helper · instruction: always-on guidance (CLAUDE.local.md) · rule: for certain files · hook: runs a command by itself · extension: bundle to install · MCP: external tool server",
      ];
}

/** Whether picking it changes the prompt (rather than asking the app for something). */
export const editsPrompt = (c: Candidate) => c.source === "installed";

/** The draft after picking an installed item: a command first, a subagent or server asked for. */
export function draftWith(draft: string, c: Candidate, locale: "ko" | "en"): string {
  if (c.kind === "agent" || c.kind === "mcp") {
    const what =
      c.kind === "agent"
        ? locale === "ko"
          ? "서브에이전트"
          : "subagent"
        : locale === "ko"
          ? "MCP 서버"
          : "MCP server";
    const ask = locale === "ko" ? `(${c.name} ${what}를 써 줘)` : `(use the ${c.name} ${what})`;
    // Once is enough: pressing it again leaves the prompt as it is.
    if (draft.includes(ask)) return draft;
    return `${draft.trimEnd()} ${ask}`;
  }
  const rest = draft.replace(/^\/\S+\s*/, "");
  return `/${c.name} ${rest}`;
}
