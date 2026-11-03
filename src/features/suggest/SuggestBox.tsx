import { Check, Copy, LoaderCircle, X } from "lucide-react";
import { useEffect, useState } from "react";
import { missingFields } from "../../../claude-mod/branch-notes/hooks/starters";
import { draftWith, draftWithBlock } from "../../../claude-mod/branch-notes/hooks/suggest";
import { Button, IconButton } from "../../components/ui";
import { useLocale, useT } from "../../i18n";
import { useAutomationStore } from "../../store/automation";
import { useProjectStore } from "../../store/project";
import { useSuggestStore } from "../../store/suggest";
import { useWorkspaceStore } from "../../store/workspace";
import { SuggestLegend } from "./KindBadge";
import { SuggestionCard } from "./SuggestionCard";

/** The app's own prompt box: suggestions as you type, like in the terminal. */
export function SuggestBox() {
  const t = useT();
  const locale = useLocale();
  const project = useProjectStore((s) => s.current);
  const { draft, items, by, pending, error, catalog, setDraft, loadCandidates } = useSuggestStore();
  const go = useWorkspaceStore((s) => s.go);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    void loadCandidates(project);
  }, [project, loadCandidates]);

  const off = catalog?.mode === "off";
  const short = draft.trim().length > 0 && items.length === 0 && !pending;
  const missing = draft.includes("*") ? missingFields(draft) : [];

  return (
    <div>
      <div className="rounded-lg bg-surface-raised ring-1 ring-transparent transition-shadow focus-within:ring-border-strong">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={t("suggest.placeholder")}
          rows={Math.min(14, Math.max(3, draft.split("\n").length))}
          className="block w-full resize-none rounded-t-lg bg-transparent px-3.5 pt-3 pb-1 text-sm text-text outline-none placeholder:text-text-subtle"
        />
        <div className="flex items-center gap-2 px-3 pb-2.5 text-fs-12 text-text-subtle">
          <span className="flex min-w-0 flex-1 items-center gap-1.5 truncate">
            {pending && <LoaderCircle size={12} className="shrink-0 animate-spin" />}
            {off
              ? t("suggest.off")
              : pending
                ? t("suggest.picking")
                : items.length > 0
                  ? t(by === "ai" ? "suggest.byAi" : "suggest.byKeyword")
                  : ""}
          </span>
          {items.length > 0 && <SuggestLegend />}
          {draft && (
            <IconButton label={t("suggest.clear")} className="size-7!" onClick={() => setDraft("")}>
              <X size={14} />
            </IconButton>
          )}
          <Button
            size="sm"
            disabled={!draft.trim()}
            onClick={() =>
              void navigator.clipboard.writeText(draft).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              })
            }
          >
            {copied ? <Check size={13} /> : <Copy size={13} />}
            {t(copied ? "suggest.copied" : "suggest.copy")}
          </Button>
        </div>
      </div>

      {off && (
        <Button size="sm" variant="ghost" className="mt-2" onClick={() => go("settings")}>
          {t("suggest.openSettings")}
        </Button>
      )}
      {missing.length > 0 && (
        <p className="mt-2 px-1 text-xs text-warning">
          {t("suggest.starters.missing", { names: missing.join(", ") })}
        </p>
      )}
      {error && (
        <p className="selectable mt-2 text-xs text-danger">{t("suggest.aiFailed", { error })}</p>
      )}

      <div className="mt-3 space-y-2">
        {items.map((c) => (
          <SuggestionCard
            key={c.key}
            c={c}
            project={project}
            onInsert={(c) => setDraft(draftWith(draft, c, locale))}
            onBlock={(c) => setDraft(draftWithBlock(draft, c, locale))}
            onAutomate={() => {
              useAutomationStore.getState().startDraft(draft, project ?? "");
              go("automations");
            }}
          />
        ))}
        {short && !off && missing.length === 0 && (
          <p className="px-1 text-fs-12 text-text-subtle">
            {draft.trim().length < 8 ? t("suggest.tooShort") : t("suggest.none")}
          </p>
        )}
      </div>
    </div>
  );
}
