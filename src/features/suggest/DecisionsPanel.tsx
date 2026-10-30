import { ask } from "@tauri-apps/plugin-dialog";
import { FileCheck2, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { keywordRank, NEW_AUTOMATION } from "../../../claude-mod/branch-notes/hooks/suggest";
import { Button, IconButton } from "../../components/ui";
import { useT } from "../../i18n";
import { type Decision, useLiveStore } from "../../store/live";
import { useProjectStore } from "../../store/project";
import { useSuggestStore } from "../../store/suggest";
import { SuggestionCard } from "./SuggestionCard";

const inputClass =
  "min-w-0 rounded-md border border-border bg-surface px-2 py-1 text-fs-12 outline-none focus:border-border-strong";

/** What has been settled for the project: found in Claude's answers or written here. */
export function DecisionsPanel({ compact = false }: { compact?: boolean }) {
  const t = useT();
  const project = useProjectStore((s) => s.current);
  const { decisions, decisionsFor, loadDecisions, saveDecisions, applyDecisions, init } =
    useLiveStore();
  const candidates = useSuggestStore((s) => s.candidates);
  const [rows, setRows] = useState<Decision[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; bad?: boolean } | null>(null);

  useEffect(() => init(), [init]);
  useEffect(() => {
    void loadDecisions(project);
    void useSuggestStore.getState().loadCandidates(project);
  }, [project, loadDecisions]);
  // Picks up what Haiku found while nothing is being edited.
  useEffect(() => {
    if (decisionsFor === project) setRows(decisions);
  }, [decisions, decisionsFor, project]);

  const dirty = JSON.stringify(rows) !== JSON.stringify(decisions);
  const pending = decisions.filter((d) => !d.inClaudeMd).length;

  // Re-suggests for what is settled: a framework brings its tools.
  const fits = useMemo(() => {
    const text = decisions.map((d) => `${d.topic} ${d.value}`).join(" ");
    return text
      ? keywordRank(text, candidates, 4).filter(
          (c) => c.key !== NEW_AUTOMATION && c.source !== "automation",
        )
      : [];
  }, [decisions, candidates]);

  if (!project) {
    return (
      <section>
        <h2 className="mb-2 px-1 text-xs font-semibold text-text-muted">
          {t("suggest.decisions.title")}
        </h2>
        <p className="px-1 text-fs-12 text-text-subtle">{t("suggest.decisions.noProject")}</p>
      </section>
    );
  }

  const set = (id: string, patch: Partial<Decision>) =>
    setRows((r) => r.map((d) => (d.id === id ? { ...d, ...patch } : d)));

  const run = async (f: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    setNotice(null);
    try {
      await f();
      if (done) setNotice({ text: done });
    } catch (e) {
      setNotice({ text: String(e), bad: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <div className="mb-2 flex items-center gap-2 px-1">
        <h2 className="flex-1 text-xs font-semibold text-text-muted">
          {t("suggest.decisions.title")}
        </h2>
        <IconButton
          label={t("suggest.decisions.add")}
          className="size-6! text-text-subtle"
          onClick={() =>
            setRows((r) => [
              ...r,
              {
                id: `new-${Date.now()}`,
                topic: "",
                value: "",
                source: "user",
                at: Date.now(),
                inClaudeMd: false,
              },
            ])
          }
        >
          <Plus size={14} />
        </IconButton>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-3 py-4 text-center text-fs-12 text-text-muted">
          {t("suggest.decisions.empty")}
        </p>
      ) : (
        <ul className="space-y-1 rounded-xl border border-border bg-surface-raised p-1.5">
          {rows.map((d) => (
            <li key={d.id} className="group flex items-center gap-1">
              <input
                value={d.topic}
                onChange={(e) => set(d.id, { topic: e.target.value })}
                placeholder={t("suggest.decisions.topic")}
                aria-label={t("suggest.decisions.topic")}
                className={`${inputClass} ${compact ? "w-28" : "w-36"} shrink-0 font-medium`}
              />
              <input
                value={d.value}
                onChange={(e) => set(d.id, { value: e.target.value })}
                placeholder={t("suggest.decisions.value")}
                aria-label={t("suggest.decisions.value")}
                className={`${inputClass} flex-1`}
              />
              <span
                className="w-10 shrink-0 text-right text-fs-10 text-text-subtle"
                title={d.inClaudeMd ? t("suggest.decisions.inClaudeMd") : undefined}
              >
                {d.inClaudeMd && "✓ "}
                {t(d.source === "auto" ? "suggest.decisions.auto" : "suggest.decisions.user")}
              </span>
              <IconButton
                label={t("suggest.decisions.delete")}
                className="size-6! text-text-subtle opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                onClick={() => setRows((r) => r.filter((x) => x.id !== d.id))}
              >
                <Trash2 size={12} />
              </IconButton>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-2 flex flex-wrap gap-1.5">
        {dirty && (
          <Button
            size="sm"
            variant="primary"
            disabled={busy}
            onClick={() =>
              void run(() =>
                saveDecisions(
                  project,
                  rows.map((d) => (d.id.startsWith("new-") ? { ...d, id: "" } : d)),
                ),
              )
            }
          >
            {t("suggest.decisions.save")}
          </Button>
        )}
        {!dirty && pending > 0 && (
          <Button
            size="sm"
            disabled={busy}
            onClick={async () => {
              const ok = await ask(t("suggest.decisions.applyConfirm", { n: decisions.length }), {
                kind: "info",
              }).catch(() => false);
              if (ok) void run(() => applyDecisions(project), t("suggest.decisions.applied"));
            }}
          >
            <FileCheck2 size={13} />
            {t("suggest.decisions.apply", { n: pending })}
          </Button>
        )}
      </div>
      {notice && (
        <p
          className={`selectable mt-1 px-1 text-fs-12 ${notice.bad ? "text-danger" : "text-success"}`}
        >
          {notice.text}
        </p>
      )}

      {fits.length > 0 && (
        <>
          <h3 className="mt-4 mb-1.5 px-1 text-fs-11 font-semibold text-text-muted">
            {t("suggest.decisions.suggest")}
          </h3>
          <div className="space-y-1.5">
            {fits.map((c) => (
              <SuggestionCard key={c.key} c={c} project={project} compact />
            ))}
          </div>
        </>
      )}
    </section>
  );
}
