// `encela hook`: the plugin's UserPromptSubmit hook. It reads the prompt
// Claude Code is about to send and, when Encela has modules or catalog
// blocks that match it well, adds a short shortlist and the flow (ask the
// user, then apply) as context. Without a match it adds nothing, and it
// never stops the prompt: any failure just leaves the prompt as it was.
import { wantsSuggestions } from "../../../claude-mod/branch-notes/hooks/suggest";
import { describe, isEmpty, recommend } from "./recommend";
import { FLOW } from "./server";
import { type Hub, loadHub } from "./store";

/** Matches less sure than this (1-6) stay out of the prompt. */
export const HOOK_MIN = 3;

/** The context to add for `prompt`, or null for none. */
export function hookContext(prompt: string, hub: Hub): string | null {
  if (!wantsSuggestions(prompt) || prompt.includes("[Encela]")) return null;
  const picked = recommend(prompt, hub, HOOK_MIN);
  if (isEmpty(picked)) return null;
  return `[Encela] These may help with this request (keyword matches; judge them yourself):\n${describe(picked)}\nIf any clearly fit, follow this before starting; otherwise ignore this note.\n${FLOW}`;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

export async function run(): Promise<void> {
  try {
    const input = JSON.parse((await readStdin()) || "{}") as { prompt?: unknown };
    const prompt = typeof input.prompt === "string" ? input.prompt : "";
    const context = hookContext(prompt, loadHub());
    if (context) {
      process.stdout.write(
        JSON.stringify({
          hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: context },
        }),
      );
    }
  } catch {
    // A hook that fails must not get in the way of the prompt.
  }
}
