import { create } from "zustand";

export type TabId = "suggest" | "docs" | "work" | "memo" | "commands" | "trees";

interface UiState {
  activeTab: TabId;
  setActiveTab: (tab: TabId) => void;
}

export const useUiStore = create<UiState>((set) => ({
  activeTab: "suggest",
  setActiveTab: (activeTab) => set({ activeTab }),
}));
