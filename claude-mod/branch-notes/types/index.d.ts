export type Todo = { id: string; text: string; done: boolean };

export type GitHubSummary = {
  prNumber: number | null;
  prTitle: string | null;
  prState: string | null;
  prUrl: string | null;
  passed: number;
  failed: number;
  pending: number;
};

export type BranchData = { note: string; todos: Todo[]; github?: GitHubSummary };

/** What the mod shows: this session's repository and branch, and its memo. */
export type View = {
  /** The app's export was found and is recent. */
  appRunning: boolean;
  locale: "ko" | "en";
  repoKey: string | null;
  branch: string;
  data: BranchData | null;
};

/** Something the prompt suggestions can offer. */
export type Candidate = {
  /** Unique: `i:skill:review`, `l:agent:debugger`, `e:rea`. */
  key: string;
  kind: "skill" | "agent" | "command" | "extension";
  /** Usable now, in the app's library, or an extension to install. */
  source: "installed" | "library" | "extension";
  /** How Claude Code calls it (`review`, `superpowers:brainstorm`). */
  name: string;
  description: string;
  keywords?: string[];
  libraryKind?: "skill" | "agent";
  libraryId?: string;
  extensionId?: string;
};

/** What the band above the prompt suggests for the draft being typed. */
export type Suggestion = {
  draft: string;
  items: Candidate[];
  by: "keyword" | "ai";
  /** Haiku is still picking. */
  pending: boolean;
};

declare module "claude-code" {
  interface PluginState {
    "branch-notes": { view: View | null; isHidden: boolean; suggestion: Suggestion | null };
  }
}
