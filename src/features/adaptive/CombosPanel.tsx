import { ask } from "@tauri-apps/plugin-dialog";
import { Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button, IconButton } from "../../components/ui";
import { useT } from "../../i18n";
import {
  type Combo,
  type ComboView,
  type Fit,
  fitOf,
  type Member,
  useHubStore,
} from "../../store/hub";
import { Dialog, Field, input } from "../../workspace/pages/McpPage";
import { KindBadge } from "./ModulesPanel";

/** The colour a fit score reads as. */
export const fitColor = (score: number) =>
  score >= 75 ? "var(--c-success)" : score >= 50 ? "var(--c-warning)" : "var(--c-danger)";

/** A fit score as a number and a short bar. */
export function FitMeter({ fit, compact = false }: { fit: Fit; compact?: boolean }) {
  const t = useT();
  const color = fitColor(fit.score);
  return (
    <span
      className="flex shrink-0 items-center gap-1.5"
      title={`${t(fit.by === "ai" ? "adaptive.fit.ai" : "adaptive.fit.rule")}\n${fit.reasons.join("\n")}`}
    >
      {!compact && <span className="text-fs-11 text-text-subtle">{t("adaptive.fit")}</span>}
      <span className="h-1 w-12 overflow-hidden rounded-full bg-sunken">
        <span
          className="block h-full rounded-full"
          style={{ width: `${fit.score}%`, background: color }}
        />
      </span>
      <span className="font-mono text-fs-11 tabular-nums" style={{ color }}>
        {fit.score}
      </span>
      {!compact && fit.by === "ai" && <Sparkles size={11} className="text-text-subtle" />}
    </span>
  );
}

/** Sets of modules used together, each with a role, and how well they fit. */
export function CombosPanel() {
  const t = useT();
  const combos = useHubStore((s) => s.combos);
  const modules = useHubStore((s) => s.entries);
  const [editing, setEditing] = useState<{ original: string | null; combo: Combo } | null>(null);

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <p className="text-xs text-text-muted">{t("adaptive.combos.hint")}</p>
        <Button
          size="sm"
          variant="primary"
          className="ml-auto"
          disabled={modules.length < 2}
          onClick={() =>
            setEditing({ original: null, combo: { name: "", goal: "", members: [], aiFit: null } })
          }
        >
          <Plus size={13} />
          {t("adaptive.combos.add")}
        </Button>
      </div>
      {combos.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-2.5 text-xs text-text-subtle">
          {t(modules.length < 2 ? "adaptive.combos.needModules" : "adaptive.combos.empty")}
        </p>
      ) : (
        <ul className="space-y-3">
          {combos.map((c) => (
            <ComboCard
              key={c.name}
              combo={c}
              onEdit={() => setEditing({ original: c.name, combo: c })}
            />
          ))}
        </ul>
      )}
      {editing && <ComboDialog draft={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function ComboCard({ combo: c, onEdit }: { combo: ComboView; onEdit: () => void }) {
  const t = useT();
  const modules = useHubStore((s) => s.entries);
  const fitting = useHubStore((s) => s.fitting.includes(c.name));
  const { judgeCombo, removeCombo } = useHubStore.getState();
  const fit = fitOf(c);
  return (
    <li className="rounded-lg bg-surface-raised px-3.5 py-3">
      <div className="flex items-center gap-2">
        <span className="min-w-0 truncate text-sm font-medium">{c.name}</span>
        <FitMeter fit={fit} />
        <span className="ml-auto flex items-center gap-0.5">
          <Button
            size="sm"
            variant="ghost"
            disabled={fitting}
            onClick={() => void judgeCombo(c.name)}
          >
            <Sparkles size={12} className={fitting ? "animate-pulse" : ""} />
            {fitting ? t("adaptive.fit.judging") : t("adaptive.fit.judge")}
          </Button>
          <IconButton label={t("hub.edit")} onClick={onEdit}>
            <Pencil size={14} />
          </IconButton>
          <IconButton
            label={t("adaptive.combos.delete")}
            onClick={async () => {
              const ok = await ask(t("adaptive.combos.deleteConfirm", { name: c.name }), {
                title: t("adaptive.combos.delete"),
                kind: "warning",
              }).catch(() => false);
              if (ok) await removeCombo(c.name);
            }}
          >
            <Trash2 size={14} />
          </IconButton>
        </span>
      </div>
      {c.goal && <p className="mt-0.5 text-fs-12 text-text-muted">{c.goal}</p>}
      <ul className="mt-2 space-y-1">
        {c.members.map((m) => {
          const e = modules.find((x) => x.name === m.module);
          return (
            <li key={m.module} className="flex items-baseline gap-2 text-fs-12">
              <span className="font-medium">{m.module}</span>
              {e && <KindBadge entry={e} />}
              <span className="min-w-0 truncate text-text-muted">
                {m.role || t("adaptive.combos.noRole")}
              </span>
            </li>
          );
        })}
      </ul>
      {fit.reasons.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-fs-11 text-text-subtle">
          {fit.reasons.map((r) => (
            <li key={r}>· {r}</li>
          ))}
        </ul>
      )}
      {c.aiFit && (
        <p className="mt-1 text-fs-10 text-text-subtle">
          {t("adaptive.fit.ruleToo", { score: c.ruleFit.score })}
        </p>
      )}
    </li>
  );
}

function ComboDialog({
  draft,
  onClose,
}: {
  draft: { original: string | null; combo: Combo };
  onClose: () => void;
}) {
  const t = useT();
  const modules = useHubStore((s) => s.entries);
  const saveCombo = useHubStore((s) => s.saveCombo);
  const [name, setName] = useState(draft.combo.name);
  const [goal, setGoal] = useState(draft.combo.goal);
  const [members, setMembers] = useState<Member[]>(draft.combo.members);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (module: string) =>
    setMembers(
      members.some((m) => m.module === module)
        ? members.filter((m) => m.module !== module)
        : [...members, { module, role: "" }],
    );
  const setRole = (module: string, role: string) =>
    setMembers(members.map((m) => (m.module === module ? { ...m, role } : m)));

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await saveCombo(draft.original, { name, goal, members, aiFit: draft.combo.aiFit });
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={draft.original ? t("adaptive.combos.titleEdit") : t("adaptive.combos.titleNew")}
      onClose={onClose}
      footer={
        <>
          {error && (
            <p className="selectable mr-auto min-w-0 flex-1 text-xs whitespace-pre-wrap text-danger">
              {error}
            </p>
          )}
          <Button variant="ghost" onClick={onClose}>
            {t("mcp.form.cancel")}
          </Button>
          <Button
            variant="primary"
            disabled={busy || !name.trim() || members.length === 0}
            onClick={() => void submit()}
          >
            {busy ? t("mcp.form.saving") : t("mcp.form.save")}
          </Button>
        </>
      }
    >
      <Field label={t("adaptive.combos.name")}>
        <input value={name} onChange={(e) => setName(e.target.value)} className={input} />
      </Field>
      <Field label={t("adaptive.combos.goal")} hint={t("adaptive.combos.goalHint")}>
        <textarea
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          rows={2}
          className={`${input} resize-y`}
        />
      </Field>
      <Field label={t("adaptive.combos.members")} hint={t("adaptive.combos.membersHint")}>
        <ul className="divide-y divide-border rounded-lg border border-border">
          {modules.map((e) => {
            const member = members.find((m) => m.module === e.name);
            return (
              <li key={e.name} className="px-3 py-2">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={!!member} onChange={() => toggle(e.name)} />
                  <span className="font-medium">{e.name}</span>
                  <KindBadge entry={e} />
                  <span className="min-w-0 truncate text-fs-11 text-text-subtle">
                    {e.description}
                  </span>
                </label>
                {member && (
                  <input
                    value={member.role}
                    onChange={(ev) => setRole(e.name, ev.target.value)}
                    placeholder={t("adaptive.combos.rolePlaceholder")}
                    className={`${input} mt-1.5 text-xs`}
                  />
                )}
              </li>
            );
          })}
        </ul>
      </Field>
    </Dialog>
  );
}
