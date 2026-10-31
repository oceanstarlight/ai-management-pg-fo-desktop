import { FilePen } from "lucide-react";
import { useEffect, useState } from "react";
import {
  fillStarter,
  isNewProject,
  STARTER_PREF,
  type Starter,
  starterFields,
  startersFor,
} from "../../../claude-mod/branch-notes/hooks/starters";
import { decisionsFor } from "../../../claude-mod/branch-notes/hooks/suggest";
import { Button } from "../../components/ui";
import { useLocale, useT } from "../../i18n";
import { getPref, onPrefChanged } from "../../store/prefs";
import { useSuggestStore } from "../../store/suggest";
import { useWorkspaceStore } from "../../store/workspace";

/** The settings card's element id, to scroll to. */
export const STARTERS_CARD = "starters-card";

/** The starter forms in use: the user's own, or the built-in ones. */
export function useStarters(): Starter[] {
  const locale = useLocale();
  const [pref, setPref] = useState(() => getPref(STARTER_PREF));
  useEffect(() => onPrefChanged(STARTER_PREF, setPref), []);
  return startersFor(pref, locale);
}

/** Whether the open project is new (or none is open): the forms are offered. */
export function useNewProject(): boolean {
  const { project, hasClaudeMd, catalog } = useSuggestStore();
  if (catalog?.mode === "off") return false;
  return !project || isNewProject(hasClaudeMd, decisionsFor(catalog, project));
}

/**
 * Beside the prompt box in a new project: a form's fields to fill in; "Apply"
 * puts the finished prompt in the box (only what was filled in, no hints).
 */
export function StarterPanel({ onApply }: { onApply: (text: string) => void }) {
  const t = useT();
  const starters = useStarters();
  const goProject = useWorkspaceStore((s) => s.goProject);
  const [picked, setPicked] = useState<string | null>(null);
  const [values, setValues] = useState<Record<number, string>>({});
  const [more, setMore] = useState(false);
  const form = starters.find((s) => s.id === picked) ?? starters[0];
  const fields = form ? starterFields(form.text) : [];
  const missing = fields.filter((f) => f.required && !values[f.line]?.trim());

  const choose = (id: string) => {
    setPicked(id);
    setValues({});
    setMore(false);
  };
  const optional = fields.filter((f) => !f.required).length;
  const shown = more ? fields : fields.filter((f) => f.required);

  return (
    <section>
      <div className="mb-1.5 flex items-center gap-1.5">
        <FilePen size={12} className="shrink-0 text-accent" />
        <h2 className="min-w-0 flex-1 text-fs-11 font-medium tracking-wide text-text-subtle">
          {t("suggest.starters.title")}
        </h2>
        <button
          type="button"
          className="text-fs-11 text-text-subtle hover:text-text"
          onClick={() => goProject("starters")}
        >
          {t("suggest.starters.edit")}
        </button>
      </div>
      <div>
        <p className="text-fs-12 text-text-muted">{t("suggest.starters.description")}</p>
        <div className="mt-2 flex flex-wrap gap-1">
          {starters.map((s) => (
            <button
              key={s.id}
              type="button"
              aria-pressed={s.id === form?.id}
              onClick={() => choose(s.id)}
              className={`rounded-md px-2 py-1 text-fs-12 transition-colors ${
                s.id === form?.id
                  ? "bg-accent-soft font-medium text-text"
                  : "text-text-muted hover:bg-hover hover:text-text"
              }`}
            >
              {s.name}
            </button>
          ))}
        </div>
        <div className="mt-3 space-y-2">
          {shown.map((f) => (
            <label key={`${form?.id}:${f.line}`} className="block">
              <span className="text-fs-12 text-text-muted">
                {f.label}
                {f.required && <span className="ml-0.5 text-danger">*</span>}
              </span>
              <input
                value={values[f.line] ?? ""}
                placeholder={f.hint}
                onChange={(e) => setValues({ ...values, [f.line]: e.target.value })}
                className="mt-1 block w-full rounded-md bg-surface-raised px-2.5 py-1.5 text-fs-12 text-text ring-1 ring-transparent outline-none placeholder:text-text-subtle focus:ring-border-strong"
              />
            </label>
          ))}
        </div>
        {optional > 0 && (
          <button
            type="button"
            onClick={() => setMore(!more)}
            className="mt-2 text-fs-12 text-text-subtle hover:text-text"
          >
            {t(more ? "suggest.starters.less" : "suggest.starters.more", { n: optional })}
          </button>
        )}
        <div className="mt-3 flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-fs-11 text-text-subtle">
            {missing.length > 0 &&
              t("suggest.starters.missing", { names: missing.map((f) => f.label).join(", ") })}
          </span>
          <Button
            size="sm"
            variant="primary"
            disabled={!form || missing.length > 0}
            onClick={() => form && onApply(fillStarter(form.text, values))}
          >
            {t("suggest.starters.apply")}
          </Button>
        </div>
      </div>
    </section>
  );
}
