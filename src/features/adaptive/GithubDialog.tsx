import { AlertTriangle, FileText } from "lucide-react";
import { useState } from "react";
import { Button } from "../../components/ui";
import { useT } from "../../i18n";
import { type Analysis, type HubEntry, useHubStore } from "../../store/hub";
import { useProjectStore } from "../../store/project";
import { Dialog, Field, input } from "../../workspace/pages/McpPage";
import { ModuleForm } from "./ModuleForm";

/**
 * Adds a module from GitHub: the app reads the repository's files (nothing
 * runs), Haiku drafts how to use it, the user checks and changes the draft,
 * then saves it, and only for a module that must be built, approves the
 * setup commands that run in its clone.
 */
export function GithubDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const project = useProjectStore((s) => s.current);
  const { analyze, save, install } = useHubStore.getState();
  const [repo, setRepo] = useState("");
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [entry, setEntry] = useState<HubEntry | null>(null);
  const [steps, setSteps] = useState("");
  const [approved, setApproved] = useState(false);
  const [busy, setBusy] = useState<"read" | "save" | "install" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const read = async () => {
    setBusy("read");
    setError(null);
    try {
      const a = await analyze(repo.trim(), project);
      setAnalysis(a);
      setEntry(a.module);
      setSteps(a.module.install.join("\n"));
      setApproved(false);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  };

  const stepList = steps
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  const build = analysis?.needsBuild ?? false;

  const submit = async (andInstall: boolean) => {
    if (!entry) return;
    setBusy(andInstall ? "install" : "save");
    setError(null);
    try {
      const module = { ...entry, name: entry.name.trim(), install: stepList };
      if (!saved) {
        await save(null, module);
        setSaved(true);
      }
      if (andInstall) {
        setLog(await install(module.name, stepList));
      } else {
        onClose();
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog
      title={t("adaptive.github.title")}
      onClose={onClose}
      footer={
        <>
          {error && (
            <p className="selectable mr-auto max-h-32 min-w-0 flex-1 overflow-y-auto text-xs whitespace-pre-wrap text-danger">
              {error}
            </p>
          )}
          <Button variant="ghost" onClick={onClose}>
            {log ? t("adaptive.github.done") : t("mcp.form.cancel")}
          </Button>
          {!analysis ? (
            <Button
              variant="primary"
              disabled={busy !== null || !repo.trim()}
              onClick={() => void read()}
            >
              {busy === "read" ? t("adaptive.github.reading") : t("adaptive.github.read")}
            </Button>
          ) : log === null ? (
            <>
              {!saved && (
                <Button
                  variant={build ? "secondary" : "primary"}
                  disabled={busy !== null || !entry?.name.trim()}
                  onClick={() => void submit(false)}
                >
                  {busy === "save" ? t("mcp.form.saving") : t("adaptive.github.save")}
                </Button>
              )}
              {build && (
                <Button
                  variant="primary"
                  disabled={busy !== null || !approved || !stepList.length || !entry?.name.trim()}
                  onClick={() => void submit(true)}
                >
                  {busy === "install"
                    ? t("adaptive.github.installing")
                    : saved
                      ? t("adaptive.github.retry")
                      : t("adaptive.github.saveInstall")}
                </Button>
              )}
            </>
          ) : null}
        </>
      }
    >
      {!analysis ? (
        <>
          <p className="text-xs text-text-muted">{t("adaptive.github.hint")}</p>
          <Field label={t("adaptive.github.repo")}>
            <input
              value={repo}
              onChange={(e) => setRepo(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && repo.trim() && !busy && void read()}
              placeholder="owner/repo · https://github.com/owner/repo"
              spellCheck={false}
              className={`${input} font-mono`}
            />
          </Field>
          {busy === "read" && (
            <p className="text-fs-11 text-text-subtle">{t("adaptive.github.readingHint")}</p>
          )}
        </>
      ) : log !== null ? (
        <>
          <p className="text-xs text-success">{t("adaptive.github.installed")}</p>
          <pre className="selectable max-h-72 overflow-y-auto whitespace-pre-wrap rounded-md bg-sunken p-2 font-mono text-fs-11 text-text-muted">
            {log}
          </pre>
        </>
      ) : (
        entry && (
          <>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-fs-11 text-text-subtle">
              <span className="font-mono">
                {entry.source?.repo} @ {entry.source?.commit.slice(0, 7)}
              </span>
              <span className={entry.source?.licenseOk ? "" : "text-warning"}>
                {entry.source?.license ?? t("adaptive.licenseUnknown")}
              </span>
              <span className="flex items-center gap-1" title={analysis.files.join("\n")}>
                <FileText size={11} />
                {t("adaptive.github.files", { count: analysis.files.length })}
              </span>
            </div>
            {entry.warnings.length > 0 && (
              <ul className="space-y-1 rounded-md bg-warning/10 px-2.5 py-2 text-fs-11 text-warning">
                {entry.warnings.map((w) => (
                  <li key={w} className="flex gap-1.5">
                    <AlertTriangle size={11} className="mt-0.5 shrink-0" />
                    {w}
                  </li>
                ))}
              </ul>
            )}
            <p className="text-fs-11 text-text-muted">{t("adaptive.github.checkDraft")}</p>
            <ModuleForm value={entry} onChange={setEntry} />
            <Field
              label={t("adaptive.install")}
              hint={build ? t("adaptive.github.buildHint") : t("adaptive.github.packageHint")}
            >
              <textarea
                value={steps}
                onChange={(e) => {
                  setSteps(e.target.value);
                  setApproved(false);
                }}
                rows={3}
                spellCheck={false}
                className={`${input} resize-y font-mono text-xs`}
              />
            </Field>
            {build && stepList.length > 0 && (
              <label className="flex items-start gap-2 rounded-md bg-sunken px-2.5 py-2 text-fs-11 text-text-muted">
                <input
                  type="checkbox"
                  checked={approved}
                  onChange={(e) => setApproved(e.target.checked)}
                  className="mt-0.5"
                />
                {t("adaptive.github.approve")}
              </label>
            )}
          </>
        )
      )}
    </Dialog>
  );
}
