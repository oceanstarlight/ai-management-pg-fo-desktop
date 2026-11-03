import { useState } from "react";
import { type MessageKey, useT } from "../../i18n";
import type { HubEntry, ModuleKind } from "../../store/hub";
import type { Transport } from "../../store/mcp";
import { ConfigFields, Field, input } from "../../workspace/pages/McpPage";

const TRANSPORTS: Transport[] = ["stdio", "http", "sse", "ws"];
const KINDS: ModuleKind[] = ["mcp", "cli", "library"];

/** Comma-separated words ↔ a list. */
const listText = (l: string[]) => l.join(", ");
const textList = (s: string) =>
  s
    .split(/[,，]/)
    .map((x) => x.trim())
    .filter(Boolean);

/** A list edited as comma-separated text, kept as typed until it changes. */
function ListField({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const [text, setText] = useState(listText(value));
  return (
    <Field label={label} hint={hint}>
      <input
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          onChange(textList(e.target.value));
        }}
        className={input}
      />
    </Field>
  );
}

/** Everything about a module the user can change. */
export function ModuleForm({
  value,
  onChange,
}: {
  value: HubEntry;
  onChange: (next: HubEntry) => void;
}) {
  const t = useT();
  const patch = (p: Partial<HubEntry>) => onChange({ ...value, ...p });
  return (
    <>
      <Field label={t("mcp.form.name")} hint={t("mcp.form.nameHint")}>
        <input
          value={value.name}
          onChange={(e) => patch({ name: e.target.value })}
          spellCheck={false}
          className={`${input} font-mono`}
        />
      </Field>
      <Field
        label={t("adaptive.form.kind")}
        hint={t(`adaptive.kindHint.${value.kind}` as MessageKey)}
      >
        <div className="flex gap-1 rounded-lg bg-sunken p-0.5 text-xs">
          {KINDS.map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={value.kind === k}
              onClick={() => patch({ kind: k })}
              className={`flex-1 rounded-md px-2 py-1 font-medium ${
                value.kind === k ? "bg-surface-raised text-text shadow-card" : "text-text-muted"
              }`}
            >
              {t(`adaptive.kind.${k}` as MessageKey)}
            </button>
          ))}
        </div>
      </Field>
      <Field label={t("hub.form.description")} hint={t("hub.form.descriptionHint")}>
        <textarea
          value={value.description}
          onChange={(e) => patch({ description: e.target.value })}
          rows={2}
          className={`${input} resize-y`}
        />
      </Field>
      <ListField
        label={t("hub.form.tags")}
        hint={t("hub.form.tagsHint")}
        value={value.tags}
        onChange={(tags) => patch({ tags })}
      />
      <div className="grid grid-cols-3 gap-2">
        <ListField
          label={t("adaptive.form.capabilities")}
          value={value.capabilities}
          onChange={(capabilities) => patch({ capabilities })}
        />
        <ListField
          label={t("adaptive.form.inputs")}
          value={value.inputs}
          onChange={(inputs) => patch({ inputs })}
        />
        <ListField
          label={t("adaptive.form.outputs")}
          value={value.outputs}
          onChange={(outputs) => patch({ outputs })}
        />
      </div>
      <p className="-mt-2 text-fs-11 text-text-subtle">{t("adaptive.form.shapeHint")}</p>
      {value.kind === "mcp" && (
        <ConfigFields
          transports={TRANSPORTS}
          name={value.name}
          shared
          config={value.config}
          onChange={(config) => patch({ config })}
        />
      )}
      <Field label={t("adaptive.form.guide")} hint={t("adaptive.form.guideHint")}>
        <textarea
          value={value.guide}
          onChange={(e) => patch({ guide: e.target.value })}
          rows={value.kind === "mcp" ? 3 : 6}
          spellCheck={false}
          className={`${input} resize-y font-mono text-xs`}
        />
      </Field>
    </>
  );
}
