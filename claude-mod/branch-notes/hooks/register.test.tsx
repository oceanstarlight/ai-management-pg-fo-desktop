import type { On, PromptEditInput } from "claude-code";
import { type Engine, expect, mock, test } from "claude-code/testing";

const state = (mode: string) =>
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
function engine(on: On, mode: string, reply: string, asked: string[], written: string[] = []) {
  const clock = mock.clock(on, { now: 1000 });
  mock.env(on, { AIM_BRIDGE_DIR: "/bridge", HOME: "/home/me" });
  on("fs.read", (_, e) => ({ value: e.path === "/bridge/state.json" ? state(mode) : "" }));
  on("fs.list", () => ({ value: [] }));
  on("fs.exists", () => ({ value: false }));
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
