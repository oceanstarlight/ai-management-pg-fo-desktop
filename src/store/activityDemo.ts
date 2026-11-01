import type { Session, Step } from "./activity";

// A made-up session for the browser preview (`pnpm dev`, no Tauri): Claude
// reads the project's notes, starts five subagents (three look things up on
// the web, two edit documents), asks the user once, and answers. Loops.

export const DEMO_PROJECT = "/demo/memo-site";

type Ev =
  | {
      at: number;
      start: string;
      tool: string;
      target?: string;
      detail?: string;
      agent?: string;
      prompt?: string;
    }
  | { at: number; end: string; added?: number; removed?: number }
  | { at: number; agentTurn: string; text: string }
  | { at: number; answer: string };

const AGENTS = [
  { id: "a1", desc: "경쟁 서비스 조사", prompt: "비슷한 메모 서비스 3곳의 동기화 방식을 조사해" },
  {
    id: "a2",
    desc: "충돌 해결 방식 조사",
    prompt: "실시간 편집 충돌 해결 방식(CRDT, OT)을 조사해",
  },
  { id: "a3", desc: "가격 정책 조사", prompt: "메모 앱 유료 요금제 가격을 조사해" },
  { id: "a4", desc: "계획 문서 정리", prompt: "조사 결과를 PLANS.md에 정리해" },
  { id: "a5", desc: "CLAUDE.md 규칙 갱신", prompt: "CLAUDE.md의 동기화 규칙을 갱신해" },
];

/** Seconds from the prompt. */
const SCRIPT: Ev[] = [
  { at: 0.6, start: "m1", tool: "Read", target: "CLAUDE.md" },
  { at: 1.4, end: "m1" },
  { at: 1.8, start: "m2", tool: "Read", target: "PLANS.md" },
  { at: 2.4, end: "m2" },
  ...AGENTS.map((a, i) => ({
    at: 3 + i * 0.3,
    start: `g${a.id}`,
    tool: "Agent",
    detail: a.desc,
    prompt: a.prompt,
  })),
  ...AGENTS.map((a, i) => ({ at: 3.4 + i * 0.3, agentTurn: a.id, text: a.prompt })),
  // Web research.
  { at: 4.5, start: "w1", tool: "WebSearch", detail: "note app sync conflict", agent: "a1" },
  { at: 4.8, start: "w2", tool: "WebSearch", detail: "CRDT vs OT 2026", agent: "a2" },
  { at: 5.1, start: "w3", tool: "WebSearch", detail: "note app pricing", agent: "a3" },
  { at: 7.5, end: "w1" },
  {
    at: 7.9,
    start: "w4",
    tool: "WebFetch",
    detail: "https://www.notion.com/help/sync",
    agent: "a1",
  },
  { at: 8.2, end: "w2" },
  {
    at: 8.4,
    start: "w5",
    tool: "WebFetch",
    detail: "https://crdt.tech/implementations",
    agent: "a2",
  },
  { at: 9.0, end: "w3" },
  {
    at: 9.3,
    start: "w6",
    tool: "WebFetch",
    detail: "https://evernote.com/compare-plans",
    agent: "a3",
  },
  // Documents.
  { at: 4.6, start: "d1", tool: "Read", target: "PLANS.md", agent: "a4" },
  { at: 5.0, start: "d2", tool: "Read", target: "CLAUDE.md", agent: "a5" },
  { at: 5.8, end: "d1" },
  { at: 6.2, end: "d2" },
  { at: 6.6, start: "d3", tool: "Grep", target: "docs", detail: "sync", agent: "a5" },
  { at: 8.0, end: "d3" },
  { at: 10.5, end: "w4" },
  { at: 11.0, end: "w5" },
  { at: 11.6, end: "w6" },
  { at: 11.0, start: "d4", tool: "Edit", target: "PLANS.md", agent: "a4" },
  { at: 12.0, start: "d5", tool: "Edit", target: "CLAUDE.md", agent: "a5" },
  { at: 13.5, end: "d4", added: 24, removed: 3 },
  { at: 14.2, end: "d5", added: 6, removed: 2 },
  { at: 12.2, end: "ga1" },
  { at: 12.6, end: "ga2" },
  { at: 13.0, end: "ga3" },
  { at: 14.0, end: "ga4" },
  { at: 14.6, end: "ga5" },
  // A question for the user, then the answer.
  {
    at: 15.4,
    start: "q1",
    tool: "AskUserQuestion",
    detail: "동기화를 CRDT로 바꿀까요?",
  },
  { at: 18.5, end: "q1" },
  {
    at: 19.5,
    answer:
      "다섯 갈래로 나눠 조사하고 문서를 고쳤어요.\n\n- 경쟁 서비스 3곳은 모두 서버 기준 병합을 써요\n- `PLANS.md`: 동기화 개편 계획 추가\n- `CLAUDE.md`: 충돌 처리 규칙 갱신",
  },
];

const PROMPT = "메모 동기화 개편 방향을 조사하고 계획 문서랑 CLAUDE.md까지 정리해줘";
const LOOP_S = 27;

const blank = (at: number): Step => ({
  at,
  kind: "turn",
  id: "",
  phase: "",
  tool: "",
  category: "",
  target: "",
  detail: "",
  answer: "",
  added: 0,
  removed: 0,
  ok: null,
  agent: null,
});

const CATEGORY: Record<string, Step["category"]> = {
  Read: "read",
  Grep: "search",
  Edit: "edit",
  Agent: "agent",
  WebSearch: "web",
  WebFetch: "web",
  AskUserQuestion: "ask",
};

function fresh(start: number): Session {
  return {
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
    steps: [{ ...blank(start), id: "t1", phase: "start", detail: PROMPT }],
    files: {},
    usage: { contextPercent: 18, tokens: 36000, costUsd: 0.12 },
    at: start,
  };
}

/** Plays the demo into `apply`, step by step, looping. */
export function playDemo(apply: (session: Session) => void): () => void {
  let start = Date.now();
  let session = fresh(start);
  let done = 0;
  const events = [...SCRIPT].sort((a, b) => a.at - b.at);
  apply(session);

  const timer = setInterval(() => {
    const now = Date.now();
    const elapsed = (now - start) / 1000;
    if (elapsed > LOOP_S) {
      start = now;
      session = fresh(start);
      done = 0;
      apply(session);
      return;
    }
    const next = structuredClone(session);
    let changed = false;
    while (done < events.length && (events[done]?.at ?? 0) <= elapsed) {
      const ev = events[done] as Ev;
      done += 1;
      changed = true;
      const at = start + ev.at * 1000;
      if ("start" in ev) {
        const category = CATEGORY[ev.tool] ?? "other";
        next.steps.push({
          ...blank(at),
          kind: "tool",
          id: ev.start,
          tool: ev.tool,
          category,
          target: ev.target ?? "",
          detail: ev.detail ?? "",
          agent: ev.agent ?? null,
          prompt: ev.prompt ?? "",
        });
        next.turn.tools += 1;
        if (!ev.agent) {
          next.state = (category || "other") as Session["state"];
          next.doing = ev.target || ev.detail || "";
        }
      } else if ("end" in ev) {
        const open = next.steps.find((s) => s.kind === "tool" && s.id === ev.end);
        if (open) {
          next.steps.push({
            ...open,
            kind: "toolEnd",
            at,
            ok: true,
            added: ev.added ?? 0,
            removed: ev.removed ?? 0,
          });
          if (!open.agent) {
            const agentsOpen = next.steps.some(
              (s) =>
                s.kind === "tool" &&
                s.category === "agent" &&
                !next.steps.some((e) => e.kind === "toolEnd" && e.id === s.id),
            );
            next.state = agentsOpen ? "agent" : "thinking";
            next.doing = "";
          }
        }
      } else if ("agentTurn" in ev) {
        next.steps.push({
          ...blank(at),
          id: `t-${ev.agentTurn}`,
          phase: "start",
          detail: ev.text,
          agent: ev.agentTurn,
        });
      } else {
        next.steps.push({ ...blank(at), id: "t1", phase: "end", answer: ev.answer });
        next.state = "idle";
        next.doing = "";
      }
    }
    if (!changed) return;
    next.usage.contextPercent = Math.min(90, (next.usage.contextPercent ?? 0) + 1);
    next.usage.costUsd = (next.usage.costUsd ?? 0) + 0.01;
    next.at = now;
    session = next;
    apply(session);
  }, 200);
  return () => clearInterval(timer);
}
