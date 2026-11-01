import { describe, expect, test } from "claude-code/testing";
import { describeTool, editSize, enqueue, MAX_BATCH, toolInput } from "./activity";

describe("activity", () => {
  test("each tool names its file or what it runs", () => {
    expect(describeTool("Read", { file_path: "/r/a.ts" })).toEqual({
      target: "/r/a.ts",
      detail: "",
    });
    expect(describeTool("Bash", { command: "pnpm test" }).detail).toBe("pnpm test");
    expect(describeTool("Grep", { pattern: "TODO", path: "src" })).toEqual({
      target: "src",
      detail: "TODO",
    });
    expect(describeTool("Agent", { description: "Find the bug" }).detail).toBe("Find the bug");
    expect(describeTool("Agent", { description: "d", prompt: "Look at src" }).prompt).toBe(
      "Look at src",
    );
    expect(
      describeTool("AskUserQuestion", { questions: [{ question: "Which one?" }] }).detail,
    ).toBe("Which one?");
    expect(describeTool("mcp__github__get_issue", {}).detail).toBe("github get_issue");
    expect(describeTool("Bash", { command: "x".repeat(500) }).detail.length).toBe(300);
  });

  test("edits count the lines they add and remove", () => {
    expect(editSize("Edit", { old_string: "a\nb", new_string: "a\nb\nc" })).toEqual({
      added: 3,
      removed: 2,
    });
    expect(
      editSize("MultiEdit", {
        edits: [
          { old_string: "a", new_string: "b" },
          { old_string: "c\nd", new_string: "" },
        ],
      }),
    ).toEqual({ added: 1, removed: 3 });
    expect(editSize("Write", { content: "1\n2\n3" })).toEqual({ added: 3, removed: 0 });
    expect(editSize("Read", { file_path: "x" })).toEqual({ added: 0, removed: 0 });
  });

  test("the engine's keys are not the tool's input; the queue keeps the newest", () => {
    expect(toolInput({ tool: "Bash", tool_use_id: "1", agentId: "a", command: "ls" })).toEqual({
      command: "ls",
    });
    let q: ReturnType<typeof enqueue> = [];
    for (let i = 0; i < MAX_BATCH + 5; i++) q = enqueue(q, { at: i, kind: "tool" });
    expect(q).toHaveLength(MAX_BATCH);
    expect(q[0]?.at).toBe(5);
  });
});
