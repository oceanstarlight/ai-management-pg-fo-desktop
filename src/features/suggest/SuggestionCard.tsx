import { invoke } from "@tauri-apps/api/core";
import { LoaderCircle } from "lucide-react";
import { useState } from "react";
import {
  type Candidate,
  label,
  NEW_AUTOMATION,
} from "../../../claude-mod/branch-notes/hooks/suggest";
import { Button } from "../../components/ui";
import { type MessageKey, useLocale, useT } from "../../i18n";
import { useAutomationStore } from "../../store/automation";
import { useSuggestStore } from "../../store/suggest";

function actionLabel(c: Candidate): MessageKey {
  if (c.key === NEW_AUTOMATION) return "suggest.act.automate";
  switch (c.source) {
    case "installed":
      return "suggest.act.insert";
    case "library":
      return "suggest.act.apply";
    case "extension":
      return "suggest.act.install";
    case "recommended":
      return "suggest.act.addMcp";
    default:
      return "suggest.act.run";
  }
}

/** Adds, installs or runs what a suggestion names (installed items and new
 * automations are the caller's: `onInsert`, `onAutomate`). */
async function runAction(c: Candidate, project: string | null) {
  if (c.source === "library") {
    await invoke("library_apply", {
      project,
      tool: "claude",
      kind: c.libraryKind,
      id: c.libraryId,
      mode: "personal",
    });
  } else if (c.source === "extension") {
    await invoke("extension_install", { id: c.extensionId });
  } else if (c.source === "recommended") {
    await invoke("suggest_add_mcp", { project: project ?? "", id: c.mcpId });
  } else if (c.automationId) {
    await useAutomationStore.getState().run(c.automationId);
  }
}

/** One suggestion with its button. */
export function SuggestionCard({
  c,
  project,
  onInsert,
  onAutomate,
  compact = false,
}: {
  c: Candidate;
  project: string | null;
  /** Installed items go into the prompt; without this they are only shown. */
  onInsert?: (c: Candidate) => void;
  onAutomate?: () => void;
  compact?: boolean;
}) {
  const t = useT();
  const locale = useLocale();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; bad?: boolean } | null>(null);

  const act = async () => {
    if (c.source === "installed") return onInsert?.(c);
    if (c.key === NEW_AUTOMATION) return onAutomate?.();
    if (c.source === "library" && !project) {
      setNotice({ text: t("suggest.needProject"), bad: true });
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      await runAction(c, project);
      const started = c.source === "automation";
      setNotice({ text: t(started ? "suggest.started" : "suggest.done") });
      if (!started) await useSuggestStore.getState().loadCandidates(project);
    } catch (e) {
      setNotice({ text: String(e), bad: true });
    } finally {
      setBusy(false);
    }
  };

  const usable = c.source !== "installed" || !!onInsert;
  return (
    <article
      className={`flex items-start gap-3 rounded-xl border border-border bg-surface-raised ${
        compact ? "px-3 py-2" : "px-4 py-3"
      }`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-mono text-fs-13 font-medium text-text">
            {label(c, locale)}
          </span>
          <span className="shrink-0 rounded-full bg-sunken px-1.5 py-px text-fs-10 text-text-subtle">
            {t(`suggest.source.${c.source}` as MessageKey)}
          </span>
        </div>
        {c.description && (
          <p className="mt-0.5 line-clamp-2 text-fs-12 text-text-muted">{c.description}</p>
        )}
        {notice && (
          <p
            className={`selectable mt-1 text-fs-12 ${notice.bad ? "text-danger" : "text-success"}`}
          >
            {notice.text}
          </p>
        )}
      </div>
      {usable && (
        <Button
          size="sm"
          variant={c.source === "installed" ? "secondary" : "primary"}
          disabled={busy}
          onClick={() => void act()}
        >
          {busy && <LoaderCircle size={13} className="animate-spin" />}
          {t(actionLabel(c))}
        </Button>
      )}
    </article>
  );
}
