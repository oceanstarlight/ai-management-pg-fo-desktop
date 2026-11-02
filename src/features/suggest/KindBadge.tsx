import { Info } from "lucide-react";
import { useState } from "react";
import { type MessageKey, useT } from "../../i18n";

/** What a suggestion is, in words: the kinds `CandidateKind` names in the mod. */
const KINDS = [
  "skill",
  "agent",
  "command",
  "instruction",
  "rule",
  "hook",
  "mcp",
  "extension",
  "automation",
] as const;

/** The marks `label()` puts before a suggestion's name (claude-mod/branch-notes/hooks/suggest.ts). */
const ICONS = [
  ["＋", "suggest.icon.add"],
  ["⬇", "suggest.icon.install"],
  ["⏰", "suggest.icon.automation"],
  ["/", "suggest.icon.slash"],
  ["@", "suggest.icon.agent"],
  ["🔌", "suggest.icon.mcp"],
] as const;

const isKind = (kind: string): kind is (typeof KINDS)[number] =>
  (KINDS as readonly string[]).includes(kind);

/** A small chip saying what kind of document or tool a suggestion is. */
export function KindBadge({ kind }: { kind: string }) {
  const t = useT();
  if (!isKind(kind)) return null;
  return (
    <span
      className="shrink-0 rounded-full bg-accent-soft px-1.5 py-px text-fs-10 font-medium text-accent"
      title={t(`suggest.kindHint.${kind}` as MessageKey)}
    >
      {t(`suggest.kind.${kind}` as MessageKey)}
    </span>
  );
}

/** The "i" button: what each mark and kind means. */
export function SuggestLegend() {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        aria-expanded={open}
        aria-label={t("suggest.legend.title")}
        title={t("suggest.legend.title")}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex size-5 items-center justify-center rounded-full text-text-subtle hover:bg-hover hover:text-text"
      >
        <Info size={13} />
      </button>
      {open && (
        <div
          role="dialog"
          aria-label={t("suggest.legend.title")}
          className="absolute top-6 right-0 z-20 w-72 rounded-lg bg-surface-raised p-3 text-fs-12 shadow-lg ring-1 ring-border"
        >
          <p className="mb-1.5 font-semibold text-text">{t("suggest.legend.icons")}</p>
          <ul className="mb-3 space-y-1">
            {ICONS.map(([icon, key]) => (
              <li key={icon} className="flex gap-2">
                <span className="w-5 shrink-0 text-center font-mono">{icon}</span>
                <span className="text-text-muted">{t(key)}</span>
              </li>
            ))}
          </ul>
          <p className="mb-1.5 font-semibold text-text">{t("suggest.legend.kinds")}</p>
          <ul className="space-y-1">
            {KINDS.map((kind) => (
              <li key={kind} className="flex gap-2">
                <span className="w-16 shrink-0">
                  <KindBadge kind={kind} />
                </span>
                <span className="text-text-muted">
                  {t(`suggest.kindHint.${kind}` as MessageKey)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </span>
  );
}
