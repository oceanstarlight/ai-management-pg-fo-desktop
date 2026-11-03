import { invoke, isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useState } from "react";
import { Button, Segmented } from "../../components/ui";
import { useT } from "../../i18n";
import { useLibraryStore } from "../../store/library";
import { useProjectStore } from "../../store/project";
import { InfoTip } from "../suggest/KindBadge";

// Mirrors `Found` and `Preview` in src-tauri/src/library/import.rs.
interface Found {
  path: string;
  id: string;
  name: string;
  description: string | null;
  files: number;
  bytes: number;
  license: string | null;
  licenseOk: boolean;
  licensePath: string | null;
  exists: boolean;
  warnings: string[];
  blocked: string | null;
}

interface Preview {
  repo: string | null;
  commit: string | null;
  skills: Found[];
}

interface Imported {
  added: string[];
  failed: [string, string][];
}

type Way = "github" | "folder" | "write" | "generate";

const input =
  "w-full rounded-md bg-sunken px-2.5 py-1.5 text-xs ring-1 ring-transparent outline-none placeholder:text-text-subtle focus:ring-border-strong";

/** The `name` in SKILL.md frontmatter, to suggest as the library folder name. */
function nameOf(text: string): string {
  const m = /^---\s*\n[\s\S]*?^name:\s*["']?([\w.-]+)["']?\s*$/m.exec(text);
  return m?.[1] ?? "";
}

/**
 * Brings skills into the library: from a GitHub address, a folder on this
 * computer, pasted text, or a description the user's own `claude -p` turns
 * into a SKILL.md. Previews what will be added (license, warnings) first.
 */
export function SkillImport({ onClose }: { onClose: () => void }) {
  const t = useT();
  const [way, setWay] = useState<Way>("github");
  const [url, setUrl] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [id, setId] = useState("");
  const [text, setText] = useState("");
  const [request, setRequest] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const reload = useLibraryStore((s) => s.load);
  const project = useProjectStore((s) => s.current);

  const run = async (action: () => Promise<void>) => {
    if (!isTauri()) return;
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      await action();
    } catch (e) {
      setError(String(e));
    }
    setBusy(false);
  };

  const show = (p: Preview) => {
    setPreview(p);
    setPicked(new Set(p.skills.filter((s) => !s.exists && !s.blocked).map((s) => s.path)));
  };

  const done = async (r: Imported) => {
    setNote(
      t("docs.import.done", {
        added: r.added.length,
        failed: r.failed.length,
      }) + (r.failed.length ? ` (${r.failed.map(([p, why]) => `${p}: ${why}`).join(", ")})` : ""),
    );
    setPreview(null);
    await reload(true);
  };

  const ways: { value: Way; label: string }[] = [
    { value: "github", label: t("docs.import.way.github") },
    { value: "folder", label: t("docs.import.way.folder") },
    { value: "write", label: t("docs.import.way.write") },
    { value: "generate", label: t("docs.import.way.generate") },
  ];

  return (
    <div className="space-y-3 rounded-md border border-border bg-surface-raised px-3 py-3 text-xs">
      <div className="flex items-center gap-2">
        <span className="font-semibold">{t("docs.import.title")}</span>
        <InfoTip title={t("docs.import.title")}>
          <p>{t("docs.import.help1")}</p>
          <p>{t("docs.import.help2")}</p>
        </InfoTip>
        <Button size="sm" variant="ghost" className="ml-auto" onClick={onClose}>
          {t("docs.import.close")}
        </Button>
      </div>
      <Segmented
        label={t("docs.import.title")}
        value={way}
        options={ways}
        onChange={(w) => {
          setWay(w);
          setPreview(null);
          setError(null);
          setNote(null);
        }}
      />

      {way === "github" && (
        <form
          className="flex gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () =>
              show(await invoke<Preview>("library_import_preview_github", { url })),
            );
          }}
        >
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://github.com/owner/repo/tree/main/skills/name"
            className={input}
          />
          <Button size="sm" type="submit" disabled={busy || !url.trim()}>
            {t("docs.import.find")}
          </Button>
        </form>
      )}
      {way === "github" && (
        <p className="text-fs-10 text-text-muted">{t("docs.import.githubHint")}</p>
      )}

      {way === "folder" && (
        <Button
          size="sm"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const dir = await open({ directory: true, title: t("docs.import.chooseFolder") });
              if (typeof dir !== "string") return;
              show(await invoke<Preview>("library_import_preview_folder", { path: dir }));
            })
          }
        >
          {t("docs.import.chooseFolder")}
        </Button>
      )}

      {way === "generate" && (
        <div className="space-y-1.5">
          <textarea
            value={request}
            onChange={(e) => setRequest(e.target.value)}
            rows={3}
            placeholder={t("docs.import.generatePlaceholder")}
            className={input}
          />
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              disabled={busy || !request.trim()}
              onClick={() =>
                void run(async () => {
                  const out = await invoke<string>("library_generate_skill", {
                    request,
                    project,
                  });
                  setText(out);
                  setId(nameOf(out));
                  setWay("write");
                })
              }
            >
              {busy ? t("docs.import.generating") : t("docs.import.generate")}
            </Button>
            <span className="text-fs-10 text-text-muted">{t("docs.import.generateHint")}</span>
          </div>
        </div>
      )}

      {way === "write" && (
        <div className="space-y-1.5">
          <input
            value={id}
            onChange={(e) => setId(e.target.value)}
            placeholder={t("docs.import.idPlaceholder")}
            className={input}
          />
          <textarea
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              if (!id) setId(nameOf(e.target.value));
            }}
            rows={12}
            placeholder={
              "---\nname: my-skill\ndescription: What it does and when to use it.\n---\n\n# Steps\n..."
            }
            className={`${input} font-mono`}
          />
          <Button
            size="sm"
            disabled={busy || !id.trim() || !text.trim()}
            onClick={() =>
              void run(async () => {
                const saved = await invoke<string>("library_create_skill", { id, text });
                setNote(t("docs.import.saved", { id: saved }));
                setText("");
                setId("");
                await reload(true);
              })
            }
          >
            {t("docs.import.save")}
          </Button>
        </div>
      )}

      {preview && (
        <div className="space-y-1.5">
          <ul className="max-h-96 space-y-1 overflow-auto">
            {preview.skills.map((s) => {
              const disabled = s.exists || !!s.blocked;
              return (
                <li key={s.path}>
                  <label
                    className={`flex gap-2 rounded-md px-1.5 py-1 ${disabled ? "opacity-60" : "hover:bg-hover"}`}
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      disabled={disabled}
                      checked={picked.has(s.path)}
                      onChange={(e) => {
                        const next = new Set(picked);
                        if (e.target.checked) next.add(s.path);
                        else next.delete(s.path);
                        setPicked(next);
                      }}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="font-medium">{s.name}</span>
                      {s.name !== s.id && <span className="ml-1 text-text-subtle">({s.id})</span>}
                      <span className="ml-2 text-fs-10 text-text-subtle">
                        {t("docs.import.files", { n: s.files })}
                      </span>
                      <span
                        className={`ml-2 text-fs-10 ${s.licenseOk ? "text-success" : "text-warning"}`}
                      >
                        {s.license ?? t("docs.import.noLicense")}
                      </span>
                      {s.description && (
                        <span className="block line-clamp-2 text-fs-11 text-text-muted">
                          {s.description}
                        </span>
                      )}
                      {s.exists && (
                        <span className="block text-fs-10 text-text-muted">
                          {t("docs.import.exists")}
                        </span>
                      )}
                      {s.blocked && (
                        <span className="block text-fs-10 text-danger">{s.blocked}</span>
                      )}
                      {s.warnings.map((w) => (
                        <span key={w} className="block text-fs-10 text-warning">
                          {w}
                        </span>
                      ))}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
          <Button
            size="sm"
            variant="primary"
            disabled={busy || picked.size === 0}
            onClick={() =>
              void run(async () => {
                const paths = [...picked];
                const r = preview.repo
                  ? await invoke<Imported>("library_import_github", {
                      repo: preview.repo,
                      commit: preview.commit,
                      paths,
                    })
                  : await invoke<Imported>("library_import_folders", { paths });
                await done(r);
              })
            }
          >
            {t("docs.import.add", { n: picked.size })}
          </Button>
        </div>
      )}

      {busy && way !== "generate" && <p className="text-text-muted">…</p>}
      {error && <p className="rounded-md bg-danger-soft px-2.5 py-1.5 text-danger">{error}</p>}
      {note && <p className="text-text-muted">{note}</p>}
    </div>
  );
}
