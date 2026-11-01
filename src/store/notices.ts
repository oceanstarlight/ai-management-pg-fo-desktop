import { create } from "zustand";
import { getPref, onPrefChanged, setPref } from "./prefs";

/** Notices the user chose not to see again (by id), kept across runs. */
const KEY = "notices.dismissed";
const MAX = 100;

function load(): string[] {
  try {
    const list = JSON.parse(getPref(KEY) ?? "[]");
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

interface NoticesState {
  dismissed: string[];
  /** "Don't show again" for this notice. */
  dismiss: (id: string) => void;
}

export const useNoticesStore = create<NoticesState>((set, get) => ({
  dismissed: load(),
  dismiss: (id) => {
    if (get().dismissed.includes(id)) return;
    const dismissed = [...get().dismissed, id].slice(-MAX);
    setPref(KEY, JSON.stringify(dismissed));
    set({ dismissed });
  },
}));

onPrefChanged(KEY, () => useNoticesStore.setState({ dismissed: load() }));
