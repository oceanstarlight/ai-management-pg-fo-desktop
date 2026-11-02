import { Info } from "lucide-react";
import { type ReactNode, useState } from "react";
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

/** Colour of a confidence level: red 1-2, yellow 3-4, green 5, blue 6. */
const LEVEL = (n: number) =>
  n >= 6 ? "bg-info" : n === 5 ? "bg-success" : n >= 3 ? "bg-warning" : "bg-danger";

/** Six boxes, the first `value` filled in the level's colour, and the number. */
export function ConfidenceBar({ value }: { value?: number | null }) {
  const t = useT();
  if (!value) return null;
  const n = Math.min(6, Math.max(1, Math.round(value)));
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1"
      title={t("suggest.confidence.title", { n })}
      role="img"
      aria-label={t("suggest.confidence.title", { n })}
    >
      <span className="inline-flex gap-px">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <span
            key={i}
            className={`size-2 rounded-[2px] ${i <= n ? LEVEL(n) : "ring-1 ring-border-strong ring-inset"}`}
          />
        ))}
      </span>
      <span className="font-mono text-fs-10 text-text-muted tabular-nums">{n}</span>
    </span>
  );
}

/** A round ⓘ button that opens a short help text beside what it explains. */
export function InfoTip({
  title,
  children,
  align = "left",
}: {
  title: string;
  children: ReactNode;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex align-middle">
      <button
        type="button"
        aria-expanded={open}
        aria-label={title}
        title={title}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex size-5 items-center justify-center rounded-full text-text-subtle hover:bg-hover hover:text-text"
      >
        <Info size={13} />
      </button>
      {open && (
        <div
          role="dialog"
          aria-label={title}
          className={`absolute top-6 z-20 w-80 rounded-lg bg-surface-raised p-3 text-left text-fs-12 font-normal tracking-normal text-text-muted normal-case shadow-lg ring-1 ring-border ${
            align === "right" ? "right-0" : "left-0"
          }`}
        >
          <p className="mb-1.5 font-semibold text-text">{title}</p>
          <div className="space-y-1.5 leading-relaxed">{children}</div>
        </div>
      )}
    </span>
  );
}

/** What confidence means, for help texts. */
export function ConfidenceHelp() {
  const t = useT();
  return (
    <>
      <p>{t("suggest.confidence.help")}</p>
      <ul className="space-y-1">
        {[6, 5, 4, 2].map((n) => (
          <li key={n} className="flex items-center gap-2">
            <ConfidenceBar value={n} />
            <span>{t(`suggest.confidence.level${n}` as MessageKey)}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

/** The "i" button: what each mark, kind and confidence means. */
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
          className="absolute top-6 right-0 z-20 w-80 rounded-lg bg-surface-raised p-3 text-fs-12 shadow-lg ring-1 ring-border"
        >
          <p className="mb-1.5 font-semibold text-text">{t("suggest.legend.confidence")}</p>
          <div className="mb-3 space-y-1 text-text-muted">
            <ConfidenceHelp />
          </div>
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
