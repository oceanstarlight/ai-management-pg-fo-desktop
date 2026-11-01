import { ChevronDown, ChevronRight, FilePen } from "lucide-react";
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
 * In the home page's side menu: the starter forms as a tree. Opening a form
 * shows its fields; "Apply" puts the finished prompt in the box (only what
 * was filled in, no hints). Open by default in a new project.
 */
export function StarterPanel({
  onApply,
  fresh,
}: {
  onApply: (text: string) => void;
  fresh: boolean;
}) {
  const t = useT();
  const starters = useStarters();
  const goProject = useWorkspaceStore((s) => s.goProject);
  const [open, setOpen] = useState<boolean | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const expanded = open ?? fresh;

  return (
    <section>
      <div className="mb-1 flex items-center gap-1">
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setOpen(!expanded)}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-text-subtle hover:text-text"
        >
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <FilePen size={12} className="shrink-0 text-accent" />
          <h2 className="truncate text-fs-11 font-medium tracking-wide">
            {t("suggest.starters.title")}
          </h2>
        </button>
        <button
          type="button"
          className="text-fs-11 text-text-subtle hover:text-text"
          onClick={() => goProject("starters")}
        >
          {t("suggest.starters.edit")}
        </button>
      </div>
      {expanded && (
        <div className="ml-1.5 border-l border-border pl-2.5">
          <p className="py-1 text-fs-12 text-text-muted">{t("suggest.starters.description")}</p>
          <ul>
            {starters.map((s) => {
              const on = s.id === picked;
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    aria-expanded={on}
                    onClick={() => setPicked(on ? null : s.id)}
                    className={`flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-fs-12 transition-colors ${
                      on
                        ? "font-medium text-text"
                        : "text-text-muted hover:bg-hover hover:text-text"
                    }`}
                  >
                    {on ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    <span className="truncate">{s.name}</span>
                  </button>
                  {on && <StarterForm key={s.id} form={s} onApply={onApply} />}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}

/** One form's fields, under its row in the tree. */
function StarterForm({ form, onApply }: { form: Starter; onApply: (text: string) => void }) {
  const t = useT();
  const [values, setValues] = useState<Record<number, string>>({});
  const [more, setMore] = useState(false);
  const fields = starterFields(form.text);
  const missing = fields.filter((f) => f.required && !values[f.line]?.trim());
  const optional = fields.filter((f) => !f.required).length;
  const shown = more ? fields : fields.filter((f) => f.required);

  return (
    <div className="mb-2 ml-3 border-l border-border pt-1 pl-3">
      <div className="space-y-2">
        {shown.map((f) => (
          <label key={f.line} className="block">
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
      <div className="mt-2 flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-fs-11 text-text-subtle">
          {missing.length > 0 &&
            t("suggest.starters.missing", { names: missing.map((f) => f.label).join(", ") })}
        </span>
        <Button
          size="sm"
          variant="primary"
          disabled={missing.length > 0}
          onClick={() => onApply(fillStarter(form.text, values))}
        >
          {t("suggest.starters.apply")}
        </Button>
      </div>
    </div>
  );
}
