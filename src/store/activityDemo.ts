import type { Session, Step } from "./activity";

// A made-up session for the browser preview (`pnpm dev`, no Tauri): Claude
// reads, edits and runs things in a small project, one step a second.

export const DEMO_PROJECT = "/demo/memo-site";

export const DEMO_FILES = [
  "package.json",
  "README.md",
  "CLAUDE.md",
  "vite.config.ts",
  "src/main.tsx",
  "src/App.tsx",
  "src/index.css",
  "src/api/client.ts",
  "src/api/notes.ts",
  "src/api/auth.ts",
  "src/components/Editor.tsx",
  "src/components/NoteList.tsx",
  "src/components/Toolbar.tsx",
  "src/components/Sidebar.tsx",
  "src/components/Search.tsx",
  "src/hooks/useNotes.ts",
  "src/hooks/useAuth.ts",
  "src/store/notes.ts",
  "src/store/ui.ts",
  "src/utils/date.ts",
  "src/utils/markdown.ts",
  "server/index.ts",
  "server/routes/notes.ts",
  "server/routes/auth.ts",
  "server/db/schema.sql",
  "server/db/index.ts",
  "tests/notes.test.ts",
  "tests/auth.test.ts",
  "tests/editor.test.tsx",
  "docs/api.md",
];

const SCRIPT: Omit<Step, "at" | "id" | "phase" | "category" | "agent" | "ok">[] = [
  { kind: "tool", tool: "Read", target: "CLAUDE.md", detail: "", added: 0, removed: 0 },
  { kind: "tool", tool: "Grep", target: "src", detail: "saveNote", added: 0, removed: 0 },
  { kind: "tool", tool: "Read", target: "src/api/notes.ts", detail: "", added: 0, removed: 0 },
  { kind: "tool", tool: "Read", target: "src/store/notes.ts", detail: "", added: 0, removed: 0 },
  { kind: "tool", tool: "Edit", target: "src/api/notes.ts", detail: "", added: 14, removed: 3 },
  {
    kind: "tool",
    tool: "Read",
    target: "server/routes/notes.ts",
    detail: "",
    added: 0,
    removed: 0,
  },
  {
    kind: "tool",
    tool: "Edit",
    target: "server/routes/notes.ts",
    detail: "",
    added: 22,
    removed: 6,
  },
  {
    kind: "tool",
    tool: "Bash",
    target: "",
    detail: "pnpm test tests/notes.test.ts",
    added: 0,
    removed: 0,
  },
  { kind: "tool", tool: "Edit", target: "tests/notes.test.ts", detail: "", added: 31, removed: 0 },
  { kind: "tool", tool: "Bash", target: "", detail: "pnpm test", added: 0, removed: 0 },
];

const CATEGORY: Record<string, Step["category"]> = {
  Read: "read",
  Grep: "search",
  Edit: "edit",
  Bash: "run",
};

/** Plays the demo into `apply`, one step at a time, looping. */
export function playDemo(apply: (session: Session) => void): () => void {
  const start = Date.now();
  let session: Session = {
    session: "demo",
    project: DEMO_PROJECT,
    surface: "terminal",
    cloud: false,
    state: "thinking",
    doing: "",
    turnStarted: start,
    turns: 1,
    turn: {
      tools: 0,
      reads: 0,
      edits: 0,
      commands: 0,
      searches: 0,
      agents: 0,
      failed: 0,
      added: 0,
      removed: 0,
    },
    steps: [
      {
        at: start,
        kind: "turn",
        id: "t1",
        phase: "start",
        tool: "",
        category: "",
        target: "",
        detail: "메모 저장할 때 가끔 내용이 사라지는 문제 고치고 테스트 추가해줘",
        added: 0,
        removed: 0,
        ok: null,
        agent: null,
      },
    ],
    files: {},
    usage: { contextPercent: 18, tokens: 36000, costUsd: 0.12 },
    at: start,
  };
  apply(session);
  let i = 0;
  let open: Step | null = null;
  const timer = setInterval(() => {
    const at = Date.now();
    const next = structuredClone(session);
    if (open) {
      const end: Step = {
        ...open,
        kind: "toolEnd",
        at,
        ok: !(open.tool === "Bash" && i === 8),
      };
      next.steps.push(end);
      if (open.category === "edit") {
        next.turn.edits += 1;
        next.turn.added += open.added;
        next.turn.removed += open.removed;
        const f = next.files[open.target] ?? {
          reads: 0,
          edits: 0,
          added: 0,
          removed: 0,
          lastAt: 0,
          last: "edit" as const,
        };
        next.files[open.target] = {
          ...f,
          edits: f.edits + 1,
          added: f.added + open.added,
          removed: f.removed + open.removed,
          lastAt: at,
          last: "edit",
        };
      }
      if (end.ok === false) next.turn.failed += 1;
      next.state = "thinking";
      next.doing = "";
      open = null;
    } else if (i < SCRIPT.length) {
      const s = SCRIPT[i] as (typeof SCRIPT)[number];
      i += 1;
      const step: Step = {
        ...s,
        at,
        id: `c${i}`,
        phase: "",
        category: CATEGORY[s.tool] ?? "other",
        agent: null,
        ok: null,
      };
      next.steps.push(step);
      next.turn.tools += 1;
      if (step.category === "read") {
        next.turn.reads += 1;
        const f = next.files[step.target] ?? {
          reads: 0,
          edits: 0,
          added: 0,
          removed: 0,
          lastAt: 0,
          last: "read" as const,
        };
        next.files[step.target] = {
          ...f,
          reads: f.reads + 1,
          lastAt: at,
          last: f.edits ? "edit" : "read",
        };
      }
      if (step.category === "run") next.turn.commands += 1;
      if (step.category === "search") next.turn.searches += 1;
      next.state = step.category as Session["state"];
      next.doing = step.target || step.detail;
      open = step;
    } else {
      next.state = "idle";
      next.doing = "";
      next.steps.push({ ...(next.steps[0] as Step), at, phase: "end" });
      clearInterval(timer);
    }
    next.usage.contextPercent = Math.min(90, (next.usage.contextPercent ?? 0) + 1.5);
    next.usage.costUsd = (next.usage.costUsd ?? 0) + 0.01;
    next.at = at;
    session = next;
    apply(session);
  }, 1100);
  return () => clearInterval(timer);
}
