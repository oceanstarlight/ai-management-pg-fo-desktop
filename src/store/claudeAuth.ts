import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { create } from "zustand";

/**
 * Whether the user's Claude Code login expired, as the app's own `claude -p`
 * runs found out (src-tauri/src/claude_auth.rs). Cleared by the next run that works.
 */
interface ClaudeAuthState {
  expired: boolean;
  /** The user closed the notice; it comes back on the next failure. */
  hidden: boolean;
  /** Why the terminal couldn't be opened, if it couldn't. */
  openError: string | null;
  hide: () => void;
  openLogin: () => Promise<void>;
}

export const useClaudeAuthStore = create<ClaudeAuthState>((set) => ({
  expired: false,
  hidden: false,
  openError: null,
  hide: () => set({ hidden: true }),
  openLogin: async () => {
    try {
      await invoke("claude_open_login");
      set({ openError: null });
    } catch (e) {
      set({ openError: String(e) });
    }
  },
}));

if (isTauri()) {
  void invoke<boolean>("claude_auth_expired")
    .then((expired) => useClaudeAuthStore.setState({ expired }))
    .catch(() => {});
  void listen<boolean>("claude-auth", (e) =>
    useClaudeAuthStore.setState({ expired: e.payload, hidden: false }),
  );
}
