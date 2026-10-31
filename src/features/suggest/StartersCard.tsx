import { ChevronDown, ChevronRight, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import {
  defaultStarters,
  MAX_STARTER_TEXT,
  MAX_STARTERS,
  parseStarters,
  STARTER_PREF,
  type Starter,
} from "../../../claude-mod/branch-notes/hooks/starters";
import { Button, Card, IconButton } from "../../components/ui";
import { useLocale, useT } from "../../i18n";
import { getPref, onPrefChanged, setPref } from "../../store/prefs";
import { STARTERS_CARD, useStarters } from "./StarterPanel";

/** Settings card: edit the project starter forms (the `promptStarters` pref). */
export function StartersCard() {
  const t = useT();
  const locale = useLocale();
  const current = useStarters();
  const [custom, setCustom] = useState(() => parseStarters(getPref(STARTER_PREF)).length > 0);
  const [list, setList] = useState<Starter[]>(current);
  const [open, setOpen] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);

  // Follows the saved forms (another window, the language) unless being edited.
  const key = JSON.stringify(current);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` stands for `current`.
  useEffect(() => {
    if (!dirty) setList(current);
  }, [key]);
  useEffect(() => onPrefChanged(STARTER_PREF, (v) => setCustom(parseStarters(v).length > 0)), []);

  const edit = (next: Starter[]) => {
    setList(next);
    setDirty(true);
    setSaved(false);
  };
  const change = (id: string, patch: Partial<Starter>) =>
    edit(list.map((s) => (s.id === id ? { ...s, ...patch } : s)));

  const add = () => {
    const id = `c${Date.now().toString(36)}`;
    edit([
      ...list,
      { id, name: t("starters.newName"), text: defaultStarters(locale)[0]?.text ?? "" },
    ]);
    setOpen(id);
  };

  const save = () => {
    const valid = parseStarters(list);
    setPref(STARTER_PREF, valid.length ? JSON.stringify(valid) : null);
    setList(valid.length ? valid : defaultStarters(locale));
    setDirty(false);
    setSaved(true);
  };

  const reset = () => {
    if (!window.confirm(t("starters.resetConfirm"))) return;
    setPref(STARTER_PREF, null);
    setList(defaultStarters(locale));
    setDirty(false);
    setSaved(false);
  };

  return (
    <div id={STARTERS_CARD} className="scroll-mt-6">
      <Card title={t("starters.title")}>
        <div className="px-4 py-3">
          <p className="text-xs text-text-muted">{t("starters.description")}</p>
          <p className="mt-1 text-fs-11 text-text-subtle">
            {t(custom ? "starters.custom" : "starters.default")} · {t("starters.emptyHint")}
          </p>
        </div>
        {list.map((s) => {
          const expanded = open === s.id;
          return (
            <div key={s.id} className="px-4 py-2.5">
              <div className="flex items-center gap-2">
                <IconButton
                  label={s.name}
                  className="size-7!"
                  aria-expanded={expanded}
                  onClick={() => setOpen(expanded ? null : s.id)}
                >
                  {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </IconButton>
                <input
                  aria-label={t("starters.name")}
                  value={s.name}
                  maxLength={40}
                  onChange={(e) => change(s.id, { name: e.target.value })}
                  className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1.5 py-1 text-sm font-medium outline-none hover:border-border focus:border-border-strong"
                />
                <IconButton
                  label={t("starters.delete")}
                  className="size-7!"
                  onClick={() => edit(list.filter((x) => x.id !== s.id))}
                >
                  <Trash2 size={14} />
                </IconButton>
              </div>
              {expanded && (
                <textarea
                  aria-label={t("starters.text")}
                  value={s.text}
                  maxLength={MAX_STARTER_TEXT}
                  rows={14}
                  onChange={(e) => change(s.id, { text: e.target.value })}
                  className="mt-2 block w-full resize-y rounded-lg border border-border bg-surface px-3 py-2 text-fs-13 leading-relaxed text-text outline-none focus:border-border-strong"
                />
              )}
            </div>
          );
        })}
        <div className="flex flex-wrap items-center gap-2 px-4 py-3">
          <Button size="sm" disabled={list.length >= MAX_STARTERS} onClick={add}>
            <Plus size={13} />
            {t("starters.add")}
          </Button>
          <Button size="sm" variant="ghost" disabled={!custom && !dirty} onClick={reset}>
            {t("starters.reset")}
          </Button>
          <span className="min-w-0 flex-1 text-right text-fs-11 text-text-subtle">
            {list.length >= MAX_STARTERS
              ? t("starters.max", { n: MAX_STARTERS })
              : saved
                ? t("starters.saved")
                : ""}
          </span>
          <Button size="sm" variant="primary" disabled={!dirty} onClick={save}>
            {t("starters.save")}
          </Button>
        </div>
      </Card>
    </div>
  );
}
