import { X } from "lucide-react";
import { useState } from "react";
import { IconButton } from "../../components/ui";
import { type MessageKey, useT } from "../../i18n";
import { getPref, setPref } from "../../store/prefs";

const PREF = "adaptiveHelp";

/** Open until the user closes it once; then only when asked. */
export function useHelpOpen(): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState(() => getPref(PREF) !== "closed");
  return [
    open,
    (next) => {
      setOpen(next);
      setPref(PREF, next ? null : "closed");
    },
  ];
}

const STEPS = ["add", "hub", "one", "combo", "watch"] as const;

/** How to use adaptive tools, step by step. */
export function AdaptiveHelp({ onClose }: { onClose: () => void }) {
  const t = useT();
  return (
    <section className="mb-8 rounded-lg bg-sunken px-5 py-4">
      <div className="mb-2 flex items-center">
        <h2 className="text-sm font-semibold">{t("adaptive.help.title")}</h2>
        <IconButton label={t("work.close")} onClick={onClose} className="ml-auto -mr-2">
          <X size={15} />
        </IconButton>
      </div>
      <ol className="space-y-3">
        {STEPS.map((s, i) => (
          <li key={s} className="flex gap-3">
            <span className="mt-px flex size-5 shrink-0 items-center justify-center rounded-full bg-surface-raised text-fs-11 font-medium text-text-muted">
              {i + 1}
            </span>
            <div className="min-w-0">
              <p className="text-fs-13 font-medium">
                {t(`adaptive.help.${s}.title` as MessageKey)}
              </p>
              <p className="mt-0.5 text-fs-12 leading-relaxed text-text-muted">
                {t(`adaptive.help.${s}.body` as MessageKey)}
              </p>
            </div>
          </li>
        ))}
      </ol>
      <p className="mt-4 text-fs-11 leading-relaxed text-text-subtle">{t("adaptive.help.tips")}</p>
    </section>
  );
}
