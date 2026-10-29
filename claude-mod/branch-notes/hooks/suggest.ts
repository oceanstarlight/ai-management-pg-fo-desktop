// Prompt suggestions without the engine: the candidates (what is installed,
// the app's library, the extension library), keyword matching, and the
// Haiku request and its reply. Kept in sync with src-tauri/src/bridge.rs
// (`Suggest` in the export, the `applyLibrary` and `installExtension` requests).

import type { Candidate } from "../types";

export type { Candidate, Suggestion } from "../types";

export type SuggestMode = "ai" | "keyword" | "off";

/** The export's `suggest` section. */
export type SuggestExport = {
  mode: SuggestMode;
  library: { kind: "skill" | "agent"; id: string; name: string; description: string }[];
  extensions: {
    id: string;
    name: string;
    kind: "plugin" | "marketplace" | "mcp";
    repo: string;
    summary: string;
    keywords: string[];
    installed: boolean | null;
  }[];
};

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

/** Whether a draft is worth suggesting for: not a command or a shell line. */
export function wantsSuggestions(draft: string): boolean {
  const text = draft.trim();
  return text.length >= MIN_CHARS && !/^[/!#]/.test(text);
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
 * items not installed under the same name, then extensions not known to be
 * installed.
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
  return out;
}

/** Korean words a prompt may use, and the English ones skills describe themselves with. */
const SYNONYMS: Record<string, string[]> = {
  리뷰: ["review"],
  검토: ["review"],
  테스트: ["test", "tdd"],
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
]);

/** Lower-case words of `text`, Korean endings dropped, synonyms added. */
export function tokens(text: string): string[] {
  const out = new Set<string>();
  for (const raw of text.toLowerCase().split(/[^\p{L}\p{N}+#.]+/u)) {
    let word = raw.replace(/^\.+|\.+$/g, "");
    if (/[가-힣]/.test(word)) {
      const stem = word.replace(ENDINGS, "");
      if (stem.length >= 1) word = stem;
    }
    if (word.length < 2 || STOP.has(word)) continue;
    out.add(word);
    for (const [ko, en] of Object.entries(SYNONYMS)) {
      if (word === ko || (ko.length >= 2 && word.startsWith(ko))) for (const e of en) out.add(e);
    }
  }
  return [...out];
}

/** How well `c` matches the draft's words; 0 for no match. */
function score(words: string[], c: Candidate): number {
  const name = c.name.toLowerCase();
  const nameWords = tokens(c.name.replace(/[-_:]/g, " "));
  const desc = new Set(tokens(c.description));
  const keywords = new Set((c.keywords ?? []).map((k) => k.toLowerCase()));
  let total = 0;
  for (const w of words) {
    if (name === w || nameWords.includes(w)) total += 3;
    else if (w.length >= 4 && nameWords.some((n) => n.startsWith(w) || w.startsWith(n))) total += 2;
    if (keywords.has(w)) total += 2;
    if (desc.has(w)) total += 1;
    else if (w.length >= 5 && [...desc].some((d) => d.startsWith(w))) total += 1;
  }
  return total;
}

/** The best keyword matches, installed ones first when equal. */
export function keywordRank(
  draft: string,
  candidates: Candidate[],
  limit = MAX_ITEMS,
): Candidate[] {
  const words = tokens(draft);
  if (!words.length) return [];
  const order = { installed: 0, library: 1, extension: 2 } as const;
  return candidates
    .map((c) => ({ c, s: score(words, c) }))
    .filter((x) => x.s >= 2)
    .sort((a, b) => b.s - a.s || order[a.c.source] - order[b.c.source])
    .slice(0, limit)
    .map((x) => x.c);
}

export const AI_SYSTEM =
  "You pick which Claude Code skills, subagents, commands or extensions would clearly help with the task the user is typing. Be strict: suggest nothing rather than something loosely related. Reply with a JSON array of entry numbers only, best first, for example [3,12] or [].";

/** The numbered list Haiku picks from; the same for every draft, so it caches. */
export function aiCatalog(candidates: Candidate[]): string {
  const where = { installed: "ready", library: "in the user's library", extension: "to install" };
  const lines = candidates.map(
    (c, i) =>
      `${i + 1}. [${c.kind}, ${where[c.source]}] ${c.name}${c.description ? ` - ${c.description}` : ""}`,
  );
  return `Entries:\n${lines.join("\n")}`;
}

export function aiAsk(draft: string): string {
  return `The user is typing this prompt (any language):\n<<<\n${draft.slice(0, 2000)}\n>>>\nWhich entries would clearly help? At most ${MAX_ITEMS}. JSON array of numbers only.`;
}

/** The candidates Haiku's reply names, in its order. */
export function parseAiReply(text: string, candidates: Candidate[]): Candidate[] {
  const m = /\[[\d\s,]*\]/.exec(text);
  if (!m) return [];
  let numbers: unknown;
  try {
    numbers = JSON.parse(m[0]);
  } catch {
    return [];
  }
  if (!Array.isArray(numbers)) return [];
  const out: Candidate[] = [];
  for (const n of numbers) {
    const c = typeof n === "number" ? candidates[n - 1] : undefined;
    if (c && !out.includes(c)) out.push(c);
    if (out.length >= MAX_ITEMS) break;
  }
  return out;
}

/** The button's label: how it is used. */
export function label(c: Candidate): string {
  if (c.source === "library") return `＋${c.name}`;
  if (c.source === "extension") return `⬇${c.name}`;
  return c.kind === "agent" ? `@${c.name}` : `/${c.name}`;
}

/** The draft after picking an installed item: a command first, a subagent asked for. */
export function draftWith(draft: string, c: Candidate, locale: "ko" | "en"): string {
  if (c.kind === "agent") {
    const ask =
      locale === "ko" ? `(${c.name} 서브에이전트를 써 줘)` : `(use the ${c.name} subagent)`;
    return `${draft.trimEnd()} ${ask}`;
  }
  const rest = draft.replace(/^\/\S+\s*/, "");
  return `/${c.name} ${rest}`;
}
