import { describe, expect, test } from "claude-code/testing";
import {
  AI_SYSTEM,
  agentModel,
  aiAsk,
  aiCatalog,
  bandLabel,
  blockContext,
  buildCandidates,
  type Candidate,
  concepts,
  draftWith,
  draftWithBlock,
  installedCandidate,
  keywordConfidence,
  keywordRank,
  kindWord,
  label,
  legendLines,
  NEW_AUTOMATION,
  parseAiReply,
  parseFrontmatter,
  type SuggestExport,
  suggestMode,
  tokens,
  wantsSuggestions,
} from "./suggest";

const skill = (name: string, description: string, plugin?: string) =>
  installedCandidate(
    "skill",
    name,
    `---\nname: ${name}\ndescription: ${description}\n---\n# body`,
    plugin,
  ) as Candidate;

const exp: SuggestExport = {
  mode: "ai",
  library: [
    {
      kind: "agent",
      id: "debugger",
      name: "debugger",
      description: "Finds the root cause of bugs",
    },
    { kind: "skill", id: "review", name: "review", description: "Same name as an installed skill" },
  ],
  extensions: [
    {
      id: "rea",
      name: "REA",
      kind: "mcp",
      repo: "morluto/rea",
      summary: "A reverse-engineering MCP server for native binaries and APKs.",
      keywords: ["reverse", "apk", "리버스", "역공학"],
      installed: false,
    },
    {
      id: "superpowers",
      name: "superpowers",
      kind: "plugin",
      repo: "obra/superpowers",
      summary: "Skills for brainstorm, plan, TDD.",
      keywords: ["brainstorm"],
      installed: true,
    },
  ],
};

const installed = [
  skill("review", "Review the current diff for bugs and style"),
  skill("brainstorming", "Turn a rough idea into a design", "superpowers"),
  skill("pdf", "Read, fill and merge PDF files"),
];

describe("candidates", () => {
  test("frontmatter is read, folded descriptions too", () => {
    expect(parseFrontmatter('---\nname: "x"\ndescription: >\n  one\n  two\n---\n')).toEqual({
      name: "x",
      description: "one two",
    });
    expect(parseFrontmatter("no frontmatter")).toEqual({});
  });

  test("plugin items are called by plugin:name; commands by file name", () => {
    expect(installed[1]?.name).toBe("superpowers:brainstorming");
    const cmd = installedCandidate("command", "ce-plan", "Plan the work in steps", "compound");
    expect(cmd?.name).toBe("compound:ce-plan");
    expect(cmd?.description).toBe("Plan the work in steps");
  });

  test("the library and extensions add what isn't installed yet", () => {
    const all = buildCandidates(installed, exp);
    const keys = all.map((c) => c.key);
    expect(keys).toContain("l:agent:debugger");
    expect(keys).not.toContain("l:skill:review");
    expect(keys).toContain("e:rea");
    expect(keys).not.toContain("e:superpowers");
    expect(buildCandidates(installed, null).length).toBe(3);
  });

  test("the mode defaults to Haiku", () => {
    expect(suggestMode(null)).toBe("ai");
    expect(suggestMode({ suggest: { mode: "keyword" } })).toBe("keyword");
    expect(suggestMode({ suggest: { mode: "off" } })).toBe("off");
  });
});

describe("keyword matching", () => {
  const all = buildCandidates(installed, exp);

  test("Korean words find English skills", () => {
    expect(tokens("코드 리뷰를 해줘")).toContain("review");
    expect(keywordRank("이 변경사항 리뷰해줘", all)[0]?.name).toBe("review");
    expect(keywordRank("이 apk 파일을 역공학으로 분석해줘", all)[0]?.key).toBe("e:rea");
    expect(keywordRank("로그인 버그를 디버그해서 고쳐줘", all)[0]?.key).toBe("l:agent:debugger");
  });

  test("unrelated drafts get nothing", () => {
    expect(keywordRank("hello there, how are things", all)).toEqual([]);
  });

  test("short drafts, commands and shell lines are skipped", () => {
    expect(wantsSuggestions("리뷰")).toBe(false);
    expect(wantsSuggestions("/review this please")).toBe(false);
    expect(wantsSuggestions("!git status --short")).toBe(false);
    expect(wantsSuggestions("review my last commit")).toBe(true);
  });

  const item = (name: string, description: string, keywords?: string[]): Candidate => ({
    key: `m:${name}`,
    kind: "mcp",
    source: "installed",
    name,
    description,
    keywords,
  });

  test("messages relayed from other sessions and tasks are not requests", () => {
    expect(wantsSuggestions("<task-notification>\n<task-id>a1</task-id>review done")).toBe(false);
    expect(wantsSuggestions('<agent-message from="x">please review the PR')).toBe(false);
    expect(wantsSuggestions("Another Claude session sent a message: review it")).toBe(false);
    expect(wantsSuggestions("review this <task-notification> format")).toBe(true);
  });

  test("short English words don't count", () => {
    expect(tokens("what is it in an hour")).toEqual(["hour"]);
  });

  test("a prefix match needs a real word on both sides", () => {
    const go = item("go-tools", "Go language tools");
    expect(keywordRank("load the props into a godot scene, please make it", [go])).toEqual([]);
  });

  test("a word and its synonyms count once", () => {
    expect(concepts("테스트")).toEqual([["테스트", "test"]]);
    const t = item("tester", "test test", ["test"]);
    expect(keywordRank("테스트 관련해서", [t])[0]?.confidence ?? 0).toBeLessThan(3);
  });

  test("one word in common is sure only when the prompt asks for work", () => {
    const mermaid = item("mcp-mermaid", "Draws diagrams", ["diagram", "mermaid"]);
    expect(keywordRank("이 저장소 구조 순서도로 그려줘", [mermaid])[0]?.confidence).toBe(3);
    expect(keywordRank("순서도라는 말이 어디서 왔을까", [mermaid])[0]?.confidence).toBe(2);
    const tdd = item("test-driven-development", "Write the test first", ["test", "tdd"]);
    for (const ask of ["이 함수 단위 테스트 추가해줄래?", "TDD로 로그인 기능 구현하자"]) {
      expect(keywordRank(ask, [tdd])[0]?.confidence ?? 0).toBeGreaterThanOrEqual(3);
    }
    // 작성자 (author) is not 작성 + 자 (let's).
    expect(keywordRank("작성자 test 정보", [tdd])[0]?.confidence).toBe(2);
  });

  test("only the start of a long prompt is matched", () => {
    const m = item("mcp-mermaid", "Draws diagrams", ["diagram", "mermaid"]);
    const long = `${"그냥 긴 설명. ".repeat(200)} mermaid diagram`;
    expect(keywordRank(long, [m])).toEqual([]);
  });

  test("고도화 is not the Godot engine", () => {
    expect(tokens("검색 기능 고도화해줘")).not.toContain("godot");
  });
});

describe("Haiku", () => {
  const all = buildCandidates(installed, exp);

  test("the reply's pairs carry a confidence of 1 to 6", () => {
    const picked = parseAiReply("[[2,6],[1,9],[3,0]]", all);
    expect(picked.map((c) => c.confidence)).toEqual([6, 6, 1]);
    expect(parseAiReply("[2, 1]", all)[0]?.confidence).toBeUndefined();
    expect(parseAiReply("[]", all)).toEqual([]);
    expect(agentModel({ mode: "ai", model: "opus" } as SuggestExport)).toBe("opus");
    expect(agentModel(null)).toBe("haiku");
  });

  test("keyword matches say how sure they are, never 6", () => {
    expect(keywordConfidence(2)).toBe(2);
    expect(keywordConfidence(20)).toBe(5);
    const top = keywordRank("코드 리뷰 해줘", all)[0];
    expect(top?.confidence).toBeGreaterThanOrEqual(2);
  });

  test("the question carries only the prompt, not the project's stack", () => {
    const ask = aiAsk("1번은 그대로, 터미널 안 표시줄도 반영해줘.");
    expect(ask).toContain("터미널 안 표시줄");
    expect(ask).not.toContain("settled");
    expect(AI_SYSTEM).toContain("only when the prompt names that language or framework");
  });

  test("the catalog numbers every entry and says where it is", () => {
    const text = aiCatalog(all);
    expect(text).toContain("1. [skill, ready] review - Review the current diff");
    expect(text).toContain("[extension, to install] REA");
  });

  test("the reply's numbers pick entries, at most three", () => {
    expect(parseAiReply("[2, 1]", all).map((c) => c.name)).toEqual([
      "superpowers:brainstorming",
      "review",
    ]);
    expect(parseAiReply("Sure: [1,1,99,3,4,5]", all).length).toBe(3);
    expect(parseAiReply("none", all)).toEqual([]);
    expect(parseAiReply("[]", all)).toEqual([]);
  });
});

describe("using a suggestion", () => {
  const all = buildCandidates(installed, exp);
  const byKey = (key: string) => all.find((c) => c.key === key) as Candidate;

  test("labels say how it is used", () => {
    expect(label(byKey("i:skill:review"))).toBe("/review");
    expect(label(byKey("l:agent:debugger"))).toBe("＋debugger");
    expect(label(byKey("e:rea"))).toBe("⬇REA");
  });

  test("the band adds what kind each one is", () => {
    expect(bandLabel(byKey("i:skill:review"), "ko")).toBe("/review·스킬");
    expect(bandLabel(byKey("l:agent:debugger"))).toBe("＋debugger·agent");
    const server = {
      key: "m:x",
      kind: "mcp",
      source: "recommended",
      name: "github",
      description: "",
    };
    expect(bandLabel(server as Candidate, "ko")).toBe("⬇github·MCP");
    const job = {
      key: "a:x",
      kind: "automation",
      source: "automation",
      name: "News",
      description: "",
    };
    expect(bandLabel(job as Candidate)).toBe("⏰News");
    expect(kindWord("rule", "ko")).toBe("규칙");
    expect(legendLines("ko").join(" ")).toContain("＋ 프로젝트에 추가");
  });

  test("a skill goes first in the prompt; a subagent is asked for", () => {
    expect(draftWith("check my diff", byKey("i:skill:review"), "en")).toBe("/review check my diff");
    const agent: Candidate = { ...byKey("l:agent:debugger"), source: "installed" };
    expect(draftWith("왜 실패해? ", agent, "ko")).toBe(
      "왜 실패해? (debugger 서브에이전트를 써 줘)",
    );
    // Pressing it again doesn't add it twice.
    const once = draftWith("왜 실패해? ", agent, "ko");
    expect(draftWith(once, agent, "ko")).toBe(once);
  });
});

describe("MCP servers and automations", () => {
  const withMore: SuggestExport = {
    ...exp,
    mcp: [
      {
        id: null,
        name: "postgres-local",
        summary: "Query the local Postgres database",
        keywords: [],
        installed: true,
      },
      {
        id: "github",
        name: "github",
        summary: "GitHub issues, pull requests and code search",
        keywords: ["github", "issue", "pr", "이슈", "풀리퀘스트"],
        installed: false,
      },
    ],
    automations: [
      { id: "auto-1", name: "Morning news", prompt: "Summarize today's AI news", enabled: true },
    ],
  };
  const all = buildCandidates(installed, withMore);
  const byKey = (key: string) => all.find((c) => c.key === key) as Candidate;

  test("installed servers are ready, others are added; automations and a new one", () => {
    expect(byKey("i:mcp:postgres-local").source).toBe("installed");
    expect(byKey("m:github").source).toBe("recommended");
    expect(byKey("a:auto-1").automationId).toBe("auto-1");
    expect(byKey(NEW_AUTOMATION).kind).toBe("automation");
    expect(buildCandidates(installed, null).some((c) => c.key === NEW_AUTOMATION)).toBe(false);
  });

  test("recurring asks suggest an automation; GitHub asks the server", () => {
    expect(keywordRank("매일 아침 9시에 뉴스 요약해서 보내줘", all).map((c) => c.key)).toContain(
      NEW_AUTOMATION,
    );
    expect(keywordRank("열린 github 이슈 목록 정리해줘", all)[0]?.key).toBe("m:github");
  });

  test("labels and prompt edits for the new kinds", () => {
    expect(label(byKey(NEW_AUTOMATION), "ko")).toBe("⏰자동화로 만들기");
    expect(label(byKey("a:auto-1"))).toBe("⏰Morning news");
    expect(label(byKey("m:github"))).toBe("⬇github");
    expect(label(byKey("i:mcp:postgres-local"))).toBe("🔌postgres-local");
    expect(draftWith("count users", byKey("i:mcp:postgres-local"), "en")).toBe(
      "count users (use the postgres-local MCP server)",
    );
    expect(aiCatalog(all)).toContain("[automation, the app's scheduler] new automation");
  });
});

describe("catalog blocks", () => {
  const withBlocks: SuggestExport = {
    ...exp,
    blocks: [
      {
        id: "builtin:rust",
        kind: "rule",
        name: "rust",
        title: "Rust 규칙",
        summary: "clippy 경고 없이, 라이브러리 코드에서 unwrap 금지",
        category: "Rust",
        description: "",
        context: "No unwrap() outside tests.",
      },
      {
        id: "builtin:debugger",
        kind: "agent",
        name: "debugger",
        title: "Debugger",
        summary: "Same name as a library agent",
        category: "디버깅",
        description: "",
      },
      {
        id: "builtin:hook-stop-lint",
        kind: "hook",
        name: "stop-lint",
        title: "응답 끝나면 lint",
        summary: "Claude가 답을 마칠 때마다 lint를 돌려요",
        category: "품질",
        description: "",
        command: "npm run lint --if-present",
      },
    ],
  };

  test("blocks are offered, skipping skills and subagents the user already has", () => {
    const list = buildCandidates(installed, withBlocks);
    const keys = list.map((c) => c.key);
    expect(keys).toContain("b:builtin:rust");
    expect(keys).toContain("b:builtin:hook-stop-lint");
    expect(keys).not.toContain("b:builtin:debugger");
    const rust = list.find((c) => c.key === "b:builtin:rust");
    expect(rust?.source).toBe("catalog");
    expect(label(rust as Candidate)).toBe("＋rust");
    expect(aiCatalog(list)).toContain("[rule, from the app's catalog] rust");
  });

  test("Korean prompts find blocks by their Korean titles", () => {
    const list = buildCandidates([], withBlocks);
    expect(keywordRank("러스트 말고 rust 코드 리팩터링해 줘", list)[0]?.key).toBe("b:builtin:rust");
    expect(keywordRank("응답 끝나면 lint 돌려줘", list).map((c) => c.key)).toContain(
      "b:builtin:hook-stop-lint",
    );
  });

  test("picked instructions and rules go with the prompt", () => {
    const list = buildCandidates([], withBlocks);
    const rust = list.find((c) => c.key === "b:builtin:rust") as Candidate;
    const hook = list.find((c) => c.key === "b:builtin:hook-stop-lint") as Candidate;
    expect(blockContext([hook])).toBeNull();
    expect(blockContext([rust, hook])).toContain("No unwrap() outside tests.");
    expect(draftWithBlock("fix it", rust, "en")).toBe(
      "fix it (read and follow the rust rule added in .claude/rules/rust.md)",
    );
    expect(draftWithBlock("fix it", hook, "en")).toBe("fix it");
  });
});
