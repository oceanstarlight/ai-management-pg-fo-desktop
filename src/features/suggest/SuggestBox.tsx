import { Check, Copy, LoaderCircle, X } from "lucide-react";
import { useEffect, useState } from "react";
import { draftWith } from "../../../claude-mod/branch-notes/hooks/suggest";
import { Button, IconButton } from "../../components/ui";
import { useLocale, useT } from "../../i18n";
import { useAutomationStore } from "../../store/automation";
import { useProjectStore } from "../../store/project";
import { useSuggestStore } from "../../store/suggest";
import { useWorkspaceStore } from "../../store/workspace";
import { SuggestionCard } from "./SuggestionCard";

const CHOOSE = "\u0000choose";

/** The app's own prompt box: suggestions as you type, like in the terminal. */
export function SuggestBox() {
  const t = useT();
  const locale = useLocale();
  const project = useProjectStore((s) => s.current);
  const recent = useProjectStore((s) => s.recent);
  const { draft, items, by, pending, error, catalog, setDraft, loadCandidates } = useSuggestStore();
  const go = useWorkspaceStore((s) => s.go);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    void loadCandidates(project);
  }, [project, loadCandidates]);

  const off = catalog?.mode === "off";
  const { select, choose } = useProjectStore.getState();
  const projects = project && !recent.includes(project) ? [project, ...recent] : recent;
  const short = draft.trim().length > 0 && items.length === 0 && !pending;

  return (
    <div>
      <div className="rounded-2xl border border-border bg-surface-raised shadow-card focus-within:border-border-strong">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={t("suggest.placeholder")}
          rows={4}
          className="block w-full resize-none rounded-t-2xl bg-transparent px-4 pt-3.5 pb-1 text-sm text-text outline-none placeholder:text-text-subtle"
        />
        <div className="flex items-center gap-2 px-3 pb-2.5 text-fs-12 text-text-subtle">
          <select
            aria-label={t("docs.project.recent")}
            title={project ?? undefined}
            value={project ?? ""}
            onChange={(e) => {
              if (e.target.value === CHOOSE) void choose();
              else if (e.target.value) void select(e.target.value);
            }}
            className="max-w-40 shrink-0 truncate rounded-md border border-border bg-surface px-1.5 py-1 text-fs-12 text-text-muted"
          >
            {!project && <option value="">{t("docs.project.none")}</option>}
            {projects.map((path) => (
              <option key={path} value={path}>
                {path.split(/[\\/]/).filter(Boolean).pop() ?? path}
              </option>
            ))}
            <option value={CHOOSE}>{t("docs.project.choose")}</option>
          </select>
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
            onAutomate={() => {
              useAutomationStore.getState().startDraft(draft, project ?? "");
              go("automations");
            }}
          />
        ))}
        {short && !off && (
          <p className="px-1 text-fs-12 text-text-subtle">
            {draft.trim().length < 8 ? t("suggest.tooShort") : t("suggest.none")}
          </p>
        )}
      </div>
    </div>
  );
}
