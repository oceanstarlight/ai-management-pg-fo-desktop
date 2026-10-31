import type { On, PromptEditInput } from "claude-code";
import { type Engine, expect, mock, test } from "claude-code/testing";

const state = (mode: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    version: 1,
    heartbeat: 1000,
    locale: "en",
    paths: {},
    repos: {},
    suggest: {
      mode,
      library: [
        {
          kind: "agent",
          id: "debugger",
          name: "debugger",
          description: "Finds the root cause of a bug",
        },
        { kind: "skill", id: "pdf", name: "pdf", description: "Read and fill PDF files" },
      ],
      extensions: [],
      ...extra,
    },
  });

const ABOVE = {
  plugin: "branch-notes",
  component: "AbovePrompt",
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 4,
    bodyColumns: 80,
    scroll: { offset: 0, bodyRows: 4 },
    view: {},
  },
} as const;

const DRAFT = "why does the login crash with this bug";

/** The engine beneath the mod: an app export, no git, no claude, Haiku's reply. */
function engine(
  on: On,
  mode: string,
  reply: string,
  asked: string[],
  written: string[] = [],
  files: Record<string, string> = {},
) {
  const clock = mock.clock(on, { now: 1000 });
  mock.env(on, { AIM_BRIDGE_DIR: "/bridge", HOME: "/home/me" });
  on("fs.read", (_, e) => ({
    value: e.path === "/bridge/state.json" ? (files.state ?? state(mode)) : (files[e.path] ?? ""),
  }));
  on("fs.list", () => ({ value: [] }));
  on("fs.exists", (_, e) => ({ value: e.path in files }));
  on("process.run", (_, e) =>
    e.argv.includes("--show-toplevel")
      ? { value: { ...ran, exitCode: 0, stdout: "/repo\n" } }
      : { value: ran },
  );
  on("fs.write", (_, e) => {
    written.push(e.text);
    return { value: undefined };
  });
  on("ui.toast", () => ({ value: undefined }));
  on("command.register", (_, e) => ({ value: { command: e.name } }));
  on("model.complete", (_, e) => {
    asked.push(JSON.stringify(e));
    return {
      value: {
        isAnswered: true,
        text: reply,
        usage: {
          input_tokens: 1,
          output_tokens: 1,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
      },
    };
  });
  on("prompt.edit", (_, e) => ({
    text: e.inputText,
    cursor: e.inputText.length,
  }));
  on("session.start", (_, e) => ({ cwd: e.cwd }));
  on("ui.render", ($, e) => {
    const { Text } = $.ui.resolve(e);
    return <Text>engine</Text>;
  });
  return clock;
}

const ran = {
  exitCode: 1,
  stdout: "",
  stderr: "",
  isStdoutTruncated: false,
  isStderrTruncated: false,
};

/** Types `text` into an empty prompt box. The editor raises `prompt.edit`; the
 * kit dispatches it like any event, though its typings list no call for it. */
const type = ($: Engine, text: string) =>
  ($.prompt as unknown as { edit: (e: PromptEditInput) => Promise<unknown> }).edit({
    origin: { kind: "composer" },
    text: "",
    cursor: 0,
    start: 0,
    end: 0,
    inputText: text,
  });

test("typing suggests at once by keyword, then by Haiku's pick", async ($, on) => {
  const asked: string[] = [];
  const clock = engine(on, "ai", "[2]", asked);
  await $.session.start({ cwd: "/", surface: "terminal", isInteractive: true });
  await type($, DRAFT);

  let ui = await $.ui.mount({ ...ABOVE, surface: "terminal" });
  expect((await ui.find({ type: "Text", text: /picking/ }))?.text).toContain("picking");
  await ui.unmount();
  expect(asked).toHaveLength(0);

  await clock.advance(1500);
  expect(asked).toHaveLength(1);
  ui = await $.ui.mount({ ...ABOVE, surface: "terminal" });
  expect(await ui.find({ type: "Text", text: /picking/ })).toBeUndefined();
  expect((await ui.find({ type: "Text", text: /✨/ }))?.text).toContain("Suggested");
  await ui.unmount();
});

test("picking a library item asks the app to add it to the project", async ($, on) => {
  const asked: string[] = [];
  const written: string[] = [];
  const clock = engine(on, "ai", "[2]", asked, written);
  await $.session.start({ cwd: "/", surface: "terminal", isInteractive: true });
  await type($, "fill in this pdf form for me");
  await clock.advance(1500);
  const ui = await $.ui.mount({ ...ABOVE, surface: "terminal" });
  await ui.press({ key: "l:skill:pdf" });
  await ui.unmount();
  expect(written.map((t) => JSON.parse(t))).toContainEqual({
    op: "applyLibrary",
    project: "/repo",
    kind: "skill",
    id: "pdf",
  });
});

test("sending the prompt tells the app what was suggested and picked", async ($, on) => {
  const asked: string[] = [];
  const written: string[] = [];
  const clock = engine(on, "ai", "[1]", asked, written);
  on("prompt.read", () => ({ value: { text: DRAFT, cursor: DRAFT.length } }));
  on("prompt.fill", (_, e) => ({ isFilled: true, text: e.text, cursor: e.text.length }));
  on("prompt.submit", (_, e) => ({ text: e.text }));
  await $.session.start({ cwd: "/", surface: "terminal", isInteractive: true });
  await type($, DRAFT);
  await clock.advance(1500);
  const ui = await $.ui.mount({ ...ABOVE, surface: "terminal" });
  await ui.press({ key: "l:agent:debugger" });
  await ui.unmount();
  await $.prompt.submit({ text: DRAFT, wait: false, origin: { kind: "composer" } });
  const log = written.map((t) => JSON.parse(t)).find((r) => r.op === "suggestLog");
  expect(log).toMatchObject({
    draft: DRAFT,
    by: "ai",
    picked: ["l:agent:debugger"],
    project: "/repo",
  });
  expect(log.items[0]).toEqual({
    key: "l:agent:debugger",
    name: "debugger",
    kind: "agent",
    source: "library",
  });
});

test("keyword mode never asks Haiku", async ($, on) => {
  const asked: string[] = [];
  const clock = engine(on, "keyword", "[1]", asked);
  await $.session.start({ cwd: "/", surface: "terminal", isInteractive: true });
  await type($, "please debug this login failure");
  await clock.advance(5000);
  expect(asked).toHaveLength(0);
  const ui = await $.ui.mount({ ...ABOVE, surface: "terminal" });
  expect((await ui.find({ type: "Text", text: /💡/ }))?.text).toContain("Suggested");
  await ui.unmount();
});

test("off shows nothing", async ($, on) => {
  const asked: string[] = [];
  const clock = engine(on, "off", "[1]", asked);
  await $.session.start({ cwd: "/", surface: "terminal", isInteractive: true });
  await type($, "please debug this login failure");
  await clock.advance(5000);
  expect(asked).toHaveLength(0);
  const ui = await $.ui.mount({ ...ABOVE, surface: "terminal" });
  expect((await ui.find({ type: "Text" }))?.text).toBe("engine");
  await ui.unmount();
});

test("short drafts show nothing", async ($, on) => {
  const asked: string[] = [];
  const clock = engine(on, "ai", "[1]", asked);
  await $.session.start({ cwd: "/", surface: "terminal", isInteractive: true });
  await type($, "bug");
  await clock.advance(5000);
  expect(asked).toHaveLength(0);
  const ui = await $.ui.mount({ ...ABOVE, surface: "terminal" });
  expect((await ui.find({ type: "Text" }))?.text).toBe("engine");
  await ui.unmount();
});

const sent = (written: string[]) => written.map((t) => JSON.parse(t));

test("a session tells the app it started, and what is suggested as it is typed", async ($, on) => {
  const written: string[] = [];
  const clock = engine(on, "keyword", "[]", [], written);
  await $.session.start({ cwd: "/", surface: "terminal", isInteractive: true });
  const start = sent(written).find((r) => r.op === "sessionStart");
  expect(start).toMatchObject({ project: "/repo", surface: "terminal" });
  await type($, "please debug this login failure");
  await clock.advance(1000);
  const live = sent(written)
    .filter((r) => r.op === "suggestLive")
    .pop();
  expect(live).toMatchObject({ session: start.session, draft: "please debug this login failure" });
  expect(live.items[0]).toMatchObject({ key: "l:agent:debugger", label: "＋debugger" });
});

test("the app's sidebar picks a suggestion through the outbox", async ($, on) => {
  const written: string[] = [];
  const files: Record<string, string> = {};
  const clock = engine(on, "keyword", "[]", [], written, files);
  await $.session.start({ cwd: "/", surface: "terminal", isInteractive: true });
  const { session } = sent(written).find((r) => r.op === "sessionStart");
  await type($, "fill in this pdf form for me");
  files[`/bridge/outbox/${session}.json`] = JSON.stringify({
    commands: [
      { seq: 5, op: "pick", key: "l:skill:pdf" },
      { seq: 2000, op: "pick", key: "l:skill:pdf" },
    ],
  });
  await clock.advance(1000);
  expect(sent(written).filter((r) => r.op === "applyLibrary")).toHaveLength(1);
});

test("auto mode uses the suggestions when the prompt is sent", async ($, on) => {
  const written: string[] = [];
  const files = { state: state("keyword", { auto: true }) };
  const clock = engine(on, "keyword", "[]", [], written, files);
  let context: readonly string[] | undefined;
  on("prompt.submit", (_, e) => {
    context = e.context;
    return { text: e.text };
  });
  await $.session.start({ cwd: "/", surface: "terminal", isInteractive: true });
  await type($, "fill in this pdf form for me");
  await clock.advance(1000);
  await $.prompt.submit({
    text: "fill in this pdf form for me",
    wait: false,
    origin: { kind: "composer" },
  });
  expect(sent(written).find((r) => r.op === "applyLibrary")).toMatchObject({ id: "pdf" });
  expect(context).toBeUndefined();
  const log = sent(written).find((r) => r.op === "suggestLog");
  expect(log.picked).toContain("l:skill:pdf");
});

test("Claude's answer goes to the app to find decisions", async ($, on) => {
  const written: string[] = [];
  engine(on, "ai", "[]", [], written);
  on("prompt.submit", (_, e) => ({ text: e.text }));
  on("turn.complete", (_, e) => ({ text: e.answer }));
  await $.session.start({ cwd: "/", surface: "terminal", isInteractive: true });
  await $.prompt.submit({ text: "make a memo website", wait: false, origin: { kind: "composer" } });
  await $.turn.complete({
    answer: "We'll use Next.js with TypeScript and deploy on Vercel.",
    durationMs: 10,
    isAborted: false,
    turnId: "t1",
    reason: "answer",
  });
  expect(sent(written).find((r) => r.op === "turnAnswer")).toMatchObject({
    project: "/repo",
    prompt: "make a memo website",
    answer: "We'll use Next.js with TypeScript and deploy on Vercel.",
  });
});

test("refine rewrites the prompt with Haiku and undo brings it back", async ($, on) => {
  const written: string[] = [];
  const files: Record<string, string> = {};
  const asked: string[] = [];
  const clock = engine(on, "keyword", "Build a memo website.\n- Next.js", asked, written, files);
  let box = "make a memo site with next";
  on("prompt.read", () => ({ value: { text: box, cursor: box.length } }));
  on("prompt.fill", (_, e) => {
    box = e.text;
    return { isFilled: true, text: e.text, cursor: e.text.length };
  });
  await $.session.start({ cwd: "/", surface: "terminal", isInteractive: true });
  const { session } = sent(written).find((r) => r.op === "sessionStart");
  files[`/bridge/outbox/${session}.json`] = JSON.stringify({
    commands: [{ seq: 2000, op: "refine" }],
  });
  await clock.advance(1000);
  expect(box).toBe("Build a memo website.\n- Next.js");
  expect(asked[0]).toContain("make a memo site with next");
  files[`/bridge/outbox/${session}.json`] = JSON.stringify({
    commands: [{ seq: 3000, op: "undo" }],
  });
  await clock.advance(1000);
  expect(box).toBe("make a memo site with next");
});

test("a new project's empty prompt offers the starter forms", async ($, on) => {
  const filled: string[] = [];
  engine(on, "keyword", "[]", []);
  on("prompt.fill", (_, e) => {
    filled.push(e.text);
    return { isFilled: true, text: e.text, cursor: e.text.length };
  });
  on("prompt.submit", (_, e) => ({ text: e.text }));
  await $.session.start({ cwd: "/", surface: "terminal", isInteractive: true });
  let ui = await $.ui.mount({ ...ABOVE, surface: "terminal" });
  expect((await ui.find({ type: "Text", text: /📝/ }))?.text).toContain("New project?");
  await ui.press({ key: "starter-general" });
  await ui.unmount();
  expect(filled[0]).toContain("*Project topic: ");

  await type($, "*Project topic: a todo app\n*Type: (website / mobile app) ");
  ui = await $.ui.mount({ ...ABOVE, surface: "terminal" });
  expect((await ui.find({ type: "Text", text: /📝/ }))?.text).toContain("left blank: Type");
  await ui.unmount();

  await $.prompt.submit({ text: "go", wait: false, origin: { kind: "composer" } });
  ui = await $.ui.mount({ ...ABOVE, surface: "terminal" });
  expect(await ui.find({ type: "Text", text: /📝/ })).toBeUndefined();
  await ui.unmount();
});

test("a project with a CLAUDE.md gets no starter forms", async ($, on) => {
  engine(on, "keyword", "[]", [], [], { "/repo/CLAUDE.md": "# repo" });
  await $.session.start({ cwd: "/", surface: "terminal", isInteractive: true });
  const ui = await $.ui.mount({ ...ABOVE, surface: "terminal" });
  expect(await ui.find({ type: "Text", text: /📝/ })).toBeUndefined();
  await ui.unmount();
});

test("the user's own starter forms come from the app", async ($, on) => {
  const forms = [{ id: "mine", name: "Mine", text: "*Goal: " }];
  engine(on, "keyword", "[]", [], [], { state: state("keyword", { starters: forms }) });
  await $.session.start({ cwd: "/", surface: "terminal", isInteractive: true });
  const ui = await $.ui.mount({ ...ABOVE, surface: "terminal" });
  expect(await ui.find({ key: "starter-mine" })).toBeDefined();
  expect(await ui.find({ key: "starter-general" })).toBeUndefined();
  await ui.unmount();
});
