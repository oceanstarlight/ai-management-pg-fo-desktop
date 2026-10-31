import { CircleDot, GitBranch, GitMerge, GitPullRequest, GitPullRequestDraft } from "lucide-react";
import { useT } from "../../i18n";
import { useGitHubStore } from "../../store/github";
import { useWorkStore } from "../../store/work";
import { open } from "../work/useGitHubSync";

/**
 * The open project's git state in one line, read only: branch, ahead and
 * behind, local changes, unpushed commits, and the branch's PR and CI.
 */
export function RepoLine() {
  const t = useT();
  const overview = useWorkStore((s) => s.overview);
  const notGit = useWorkStore((s) => s.notGit);
  const { view, status } = useGitHubStore();
  if (notGit) return <span className="text-xs text-text-subtle">{t("live.git.notGit")}</span>;
  if (!overview) return null;
  const head = overview.head;
  const pr = view?.current ?? null;
  const checks = view?.checks ?? null;
  const total = checks ? checks.passed + checks.failed + checks.pending : 0;
  const PrIcon = !pr
    ? GitPullRequest
    : pr.state === "merged"
      ? GitMerge
      : pr.draft
        ? GitPullRequestDraft
        : GitPullRequest;

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-muted">
      <span className="flex items-center gap-1.5 font-mono text-text">
        <GitBranch size={13} className="text-text-subtle" />
        {head.branch ?? head.commit?.slice(0, 7) ?? "-"}
        {(head.ahead > 0 || head.behind > 0) && (
          <span className="text-text-subtle">
            {head.ahead > 0 && `↑${head.ahead}`}
            {head.behind > 0 && ` ↓${head.behind}`}
          </span>
        )}
      </span>
      {overview.changeCount > 0 && (
        <span className="flex items-center gap-1">
          <CircleDot size={11} className="text-act-edit" />
          {t("live.git.changes", { n: overview.changeCount })}
        </span>
      )}
      {overview.unpushed > 0 && <span>{t("live.git.unpushed", { n: overview.unpushed })}</span>}
      {!status?.account ? (
        <span className="text-text-subtle">{t("live.pr.signIn")}</span>
      ) : pr ? (
        <button
          type="button"
          onClick={() => open(pr.url)}
          className="flex min-w-0 items-center gap-1.5 hover:text-text"
          title={pr.title}
        >
          <PrIcon
            size={13}
            className={
              pr.state === "merged"
                ? "text-act-agent"
                : pr.state === "open"
                  ? "text-success"
                  : "text-danger"
            }
          />
          <span className="font-mono">#{pr.number}</span>
          <span className="max-w-60 truncate">{pr.title}</span>
        </button>
      ) : (
        <span className="text-text-subtle">{t("live.pr.none")}</span>
      )}
      {checks && total > 0 && (
        <span
          className={
            checks.failed > 0 ? "text-danger" : checks.pending > 0 ? "text-warning" : "text-success"
          }
        >
          {checks.failed > 0
            ? t("live.pr.failed", { n: checks.failed })
            : checks.pending > 0
              ? t("live.pr.pending")
              : t("live.pr.checks", { passed: checks.passed, total })}
        </span>
      )}
    </div>
  );
}
