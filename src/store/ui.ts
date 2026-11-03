import { create } from "zustand";

export type TabId = "live" | "suggest" | "adaptive" | "memo" | "docs";

interface UiState {
  activeTab: TabId;
  setActiveTab: (tab: TabId) => void;
}

export const useUiStore = create<UiState>((set) => ({
  activeTab: "live",
  setActiveTab: (activeTab) => set({ activeTab }),
}));
