//! Modules the app offers ready-made: the recommended MCP servers
//! (`crate::mcp::recommended`, docs/research.md §11) and the MCP servers and
//! CLIs checked for license and content in docs/research.md §21. The app
//! only keeps how to run them; the user's tools fetch the code itself.

use serde::Serialize;

use super::{Entry, ModuleKind, Source};
use crate::mcp::{self, Config};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogModule {
    /// Stable id; recommended MCP servers keep theirs (`mcp.rec.<id>` strings).
    pub id: String,
    /// What it needs first: `node`, `uv`, `docker`, `token`, `login`, `app`.
    pub needs: String,
    /// The module as it is added.
    pub module: Entry,
}

struct Spec {
    id: &'static str,
    kind: ModuleKind,
    repo: &'static str,
    commit: &'static str,
    license: &'static str,
    needs: &'static str,
    tags: &'static [&'static str],
    capabilities: &'static [&'static str],
    inputs: &'static [&'static str],
    outputs: &'static [&'static str],
}

fn strings(list: &[&str]) -> Vec<String> {
    list.iter().map(|s| s.to_string()).collect()
}

fn module(
    spec: &Spec,
    config: Config,
    description: String,
    guide: String,
    install: &[&str],
) -> CatalogModule {
    CatalogModule {
        id: spec.id.into(),
        needs: spec.needs.into(),
        module: Entry {
            name: spec.id.into(),
            description,
            tags: strings(spec.tags),
            kind: spec.kind,
            config,
            in_hub: true,
            source: Some(Source {
                repo: spec.repo.into(),
                commit: spec.commit.into(),
                license: Some(spec.license.into()),
                license_ok: true,
            }),
            guide,
            capabilities: strings(spec.capabilities),
            inputs: strings(spec.inputs),
            outputs: strings(spec.outputs),
            install: strings(install),
            ..Entry::default()
        },
    }
}

/// Fields for the recommended MCP servers the fit can use.
fn recommended_shape(
    id: &str,
) -> (
    &'static [&'static str],
    &'static [&'static str],
    &'static [&'static str],
    &'static [&'static str],
) {
    match id {
        "filesystem" => (
            &["files"],
            &["read", "write", "files"],
            &["path"],
            &["text", "files"],
        ),
        "memory" => (
            &["memory"],
            &["knowledge", "graph"],
            &["text"],
            &["knowledge"],
        ),
        "git" => (
            &["git", "code"],
            &["history", "diff"],
            &["repository"],
            &["diff", "history"],
        ),
        "fetch" => (&["web"], &["fetch", "web"], &["url"], &["markdown", "html"]),
        "time" => (&["time"], &["time"], &["text"], &["time"]),
        "github" => (
            &["github", "code"],
            &["issues", "pull requests"],
            &["repository"],
            &["issues", "source-code"],
        ),
        "playwright" => (
            &["browser", "testing", "web"],
            &["browser", "automation", "testing"],
            &["url", "app"],
            &["screenshot", "html", "test-results"],
        ),
        "chrome-devtools" => (
            &["browser", "web", "performance"],
            &["browser", "debugging", "performance"],
            &["url", "app"],
            &["screenshot", "performance-report"],
        ),
        "context7" => (
            &["docs"],
            &["documentation", "lookup"],
            &["library-name"],
            &["docs"],
        ),
        "next-devtools" => (
            &["web", "nextjs"],
            &["nextjs", "debugging"],
            &["app"],
            &["errors"],
        ),
        "atlassian" => (
            &["issues", "docs"],
            &["jira", "confluence"],
            &["text"],
            &["issues", "docs"],
        ),
        "figma" => (
            &["design"],
            &["design", "layout"],
            &["figma-url"],
            &["design-data"],
        ),
        _ => (&[], &[], &[], &[]),
    }
}

pub fn modules() -> Vec<CatalogModule> {
    let mut out: Vec<CatalogModule> = mcp::recommended()
        .into_iter()
        .map(|r| {
            let (tags, caps, inputs, outputs) = recommended_shape(r.id);
            let spec = Spec {
                id: r.id,
                kind: ModuleKind::Mcp,
                repo: r.repo,
                commit: "",
                license: r.license,
                needs: r.needs,
                tags,
                capabilities: caps,
                inputs,
                outputs,
            };
            let mut m = module(&spec, r.config, String::new(), String::new(), &[]);
            m.module.name = r.name.into();
            if r.repo.is_empty() {
                m.module.source = None;
            }
            m
        })
        .collect();
    out.extend(researched());
    for m in &mut out {
        m.module.warnings = warnings(&m.id);
    }
    out
}

/// What the checks found worth knowing before use (docs/research.md §21).
fn warnings(id: &str) -> Vec<String> {
    let one = |ko: &str, en: &str| vec![if crate::i18n::english() { en } else { ko }.to_string()];
    match id {
        "markitdown" => one(
            "인증이 없고 사용자가 읽을 수 있는 파일은 다 읽어요. stdio로만 쓰세요.",
            "No authentication; it reads any file you can. Use it over stdio only.",
        ),
        "mcp-mermaid" => one(
            "svg_url·png_url 출력은 다이어그램 내용을 공개 서비스 mermaid.ink로 보내요.",
            "The svg_url and png_url outputs send the diagram text to the public mermaid.ink service.",
        ),
        "drawio" => one(
            "도형 목록과 코드를 diagrams.net에서 받아요(다이어그램 내용은 안 보냄). 아이콘 조회는 꺼 두었어요.",
            "Fetches shapes and code from diagrams.net (not your diagrams). Icon lookups are turned off.",
        ),
        "lighthouse" => one(
            "처음 실행 때 오류 보고를 물어봐요. --no-enable-error-reporting으로 꺼요.",
            "Asks to report errors on first run; --no-enable-error-reporting turns it off.",
        ),
        "postgres-pro" => one(
            "읽기 전용(restricted)으로 넣었어요. 쓰기가 필요하면 --access-mode=unrestricted로 바꾸세요.",
            "Added read-only (restricted). Change to --access-mode=unrestricted to allow writes.",
        ),
        "ghidra" => one(
            "Ghidra와 GhidraMCP 확장을 먼저 설치하고 켜야 해요. git 최신 버전을 받아요.",
            "Install and start Ghidra with the GhidraMCP extension first. It fetches the latest from git.",
        ),
        "kubernetes" => one(
            "현재 kubeconfig의 클러스터를 다뤄요. 운영 클러스터는 조심하세요.",
            "Works on the cluster in your current kubeconfig. Take care with production.",
        ),
        _ => Vec::new(),
    }
}

/// docs/research.md §21 (2026-11-03, checked at these commits).
fn researched() -> Vec<CatalogModule> {
    let mcp = ModuleKind::Mcp;
    let cli = ModuleKind::Cli;
    vec![
        module(
            &Spec {
                id: "markitdown",
                kind: mcp,
                repo: "microsoft/markitdown",
                commit: "7482c092d9c0",
                license: "MIT",
                needs: "uv",
                tags: &["documents", "conversion"],
                capabilities: &["convert", "pdf", "office", "documents"],
                inputs: &["pdf", "docx", "xlsx", "pptx", "html", "image", "url"],
                outputs: &["markdown"],
            },
            mcp::uvx(&["markitdown-mcp"]),
            crate::tr!(
                "PDF·Word·Excel·PowerPoint·HTML 같은 파일을 Markdown으로 바꿔요.",
                "Turns PDF, Word, Excel, PowerPoint, HTML and similar files into Markdown."
            ),
            String::new(),
            &[],
        ),
        module(
            &Spec {
                id: "mcp-mermaid",
                kind: mcp,
                repo: "hustcc/mcp-mermaid",
                commit: "13497062a980",
                license: "MIT",
                needs: "node",
                tags: &["diagram", "docs", "code"],
                capabilities: &["diagram", "render"],
                inputs: &["mermaid", "text"],
                outputs: &["diagram", "svg", "png"],
            },
            mcp::npx(&["-y", "mcp-mermaid"], &[]),
            crate::tr!(
                "Mermaid 문법으로 다이어그램을 그려 이미지로 만들어요.",
                "Draws diagrams from Mermaid text and renders them as images."
            ),
            crate::tr!(
                "구조·흐름을 Mermaid 코드(flowchart, sequenceDiagram, classDiagram…)로 쓴 뒤 generate_mermaid_diagram 도구로 그려요. 출력은 base64 또는 파일로 받아요(svg_url·png_url은 외부 서비스로 보냄).",
                "Write the structure or flow as Mermaid (flowchart, sequenceDiagram, classDiagram…), then draw it with the generate_mermaid_diagram tool. Take base64 or file output (svg_url and png_url go to an outside service)."
            ),
            &[],
        ),
        module(
            &Spec {
                id: "drawio",
                kind: mcp,
                repo: "jgraph/drawio-mcp",
                commit: "2a0f57032862",
                license: "Apache-2.0",
                needs: "node",
                tags: &["diagram", "design"],
                capabilities: &["diagram", "edit"],
                inputs: &["text", "mermaid"],
                outputs: &["diagram"],
            },
            mcp::npx(
                &["-y", "@drawio/mcp"],
                &[("DRAWIO_ICON_SERVICE_URL", "${DRAWIO_ICON_SERVICE_URL:-off}")],
            ),
            crate::tr!(
                "draw.io 다이어그램을 만들고 고쳐요.",
                "Creates and edits draw.io diagrams."
            ),
            String::new(),
            &[],
        ),
        module(
            &Spec {
                id: "qdrant",
                kind: mcp,
                repo: "qdrant/mcp-server-qdrant",
                commit: "c56ae5adf62b",
                license: "Apache-2.0",
                needs: "uv",
                tags: &["database", "search", "memory"],
                capabilities: &["vector search", "store", "memory"],
                inputs: &["text"],
                outputs: &["search-results", "knowledge"],
            },
            mcp::uvx_env(
                &["mcp-server-qdrant"],
                &[
                    ("QDRANT_URL", "${QDRANT_URL}"),
                    ("QDRANT_API_KEY", "${QDRANT_API_KEY:-}"),
                    ("COLLECTION_NAME", "${COLLECTION_NAME:-encela}"),
                ],
            ),
            crate::tr!(
                "Qdrant 벡터 DB에 내용을 저장하고 의미로 찾아요.",
                "Stores text in a Qdrant vector database and finds it by meaning."
            ),
            String::new(),
            &[],
        ),
        module(
            &Spec {
                id: "jupyter",
                kind: mcp,
                repo: "datalayer/jupyter-mcp-server",
                commit: "ec66cb82f10b",
                license: "BSD-3-Clause",
                needs: "uv",
                tags: &["data", "notebook", "python"],
                capabilities: &["notebook", "execute", "data analysis"],
                inputs: &["code", "data"],
                outputs: &["notebook", "chart", "data"],
            },
            mcp::uvx_env(
                &["jupyter-mcp-server@latest"],
                &[
                    ("JUPYTER_URL", "${JUPYTER_URL:-http://localhost:8888}"),
                    ("JUPYTER_TOKEN", "${JUPYTER_TOKEN}"),
                ],
            ),
            crate::tr!(
                "실행 중인 Jupyter에서 노트북 셀을 만들고 실행해요.",
                "Creates and runs notebook cells in a running Jupyter."
            ),
            String::new(),
            &[],
        ),
        module(
            &Spec {
                id: "kubernetes",
                kind: mcp,
                repo: "containers/kubernetes-mcp-server",
                commit: "91cbf349d6cc",
                license: "Apache-2.0",
                needs: "node",
                tags: &["devops", "kubernetes"],
                capabilities: &["cluster", "deploy", "logs"],
                inputs: &["manifest"],
                outputs: &["logs", "status"],
            },
            mcp::npx(&["-y", "kubernetes-mcp-server@latest"], &[]),
            crate::tr!(
                "kubeconfig로 Kubernetes 리소스·로그·Pod를 다뤄요.",
                "Works with Kubernetes resources, logs and pods through your kubeconfig."
            ),
            String::new(),
            &[],
        ),
        module(
            &Spec {
                id: "postgres-pro",
                kind: mcp,
                repo: "crystaldba/postgres-mcp",
                commit: "15c8e3335354",
                license: "MIT",
                needs: "uv",
                tags: &["database", "sql"],
                capabilities: &["sql", "query", "tuning"],
                inputs: &["sql"],
                outputs: &["data", "query-plan"],
            },
            mcp::uvx_env(
                &["postgres-mcp", "--access-mode=restricted"],
                &[("DATABASE_URI", "${DATABASE_URI}")],
            ),
            crate::tr!(
                "PostgreSQL을 조회하고 인덱스·성능을 점검해요 (기본은 읽기 전용).",
                "Queries PostgreSQL and checks indexes and performance (read-only by default)."
            ),
            String::new(),
            &[],
        ),
        module(
            &Spec {
                id: "ghidra",
                kind: mcp,
                repo: "LaurieWired/GhidraMCP",
                commit: "1e980252087b",
                license: "Apache-2.0",
                needs: "app",
                tags: &["reverse engineering", "binary"],
                capabilities: &["decompile", "disassemble", "analysis"],
                inputs: &["binary"],
                outputs: &["source-code", "functions"],
            },
            mcp::uvx(&[
                "--from",
                "git+https://github.com/LaurieWired/GhidraMCP",
                "ghidra-mcp",
                "--ghidra-server",
                "http://127.0.0.1:8080/",
            ]),
            crate::tr!(
                "Ghidra로 바이너리를 디컴파일하고 함수·심볼을 분석해요. Ghidra와 GhidraMCP 확장이 먼저 켜져 있어야 해요.",
                "Decompiles binaries and analyses functions and symbols with Ghidra. Ghidra with the GhidraMCP extension must be running first."
            ),
            String::new(),
            &[],
        ),
        module(
            &Spec {
                id: "repomix",
                kind: mcp,
                repo: "yamadashy/repomix",
                commit: "fe02ab760f14",
                license: "MIT",
                needs: "node",
                tags: &["code", "context", "docs"],
                capabilities: &["pack", "repository", "summary"],
                inputs: &["repository", "source-code"],
                outputs: &["text", "source-code"],
            },
            mcp::npx(&["-y", "repomix", "--mcp"], &[]),
            crate::tr!(
                "저장소를 AI가 읽기 좋은 파일 하나로 묶어요.",
                "Packs a repository into one AI-friendly file."
            ),
            crate::tr!(
                "pack_codebase 도구로 폴더를 묶고(include·ignore 패턴, compress로 줄이기), 결과 id로 grep_repomix_output·read_repomix_output을 써서 필요한 부분만 읽어요. 원격 저장소는 pack_remote_repository.",
                "Pack a folder with the pack_codebase tool (include and ignore patterns, compress to shrink it), then read only what you need through grep_repomix_output and read_repomix_output with the result's id. For a remote repository, pack_remote_repository."
            ),
            &[],
        ),
        module(
            &Spec {
                id: "ast-grep",
                kind: cli,
                repo: "ast-grep/ast-grep",
                commit: "e83806463b5f",
                license: "MIT",
                needs: "node",
                tags: &["code", "refactor", "search"],
                capabilities: &["structural search", "rewrite", "lint"],
                inputs: &["source-code"],
                outputs: &["matches", "source-code"],
            },
            Config::default(),
            crate::tr!(
                "코드 구조(AST)로 찾고 한꺼번에 바꿔요.",
                "Searches and rewrites code by its structure (AST)."
            ),
            crate::tr!(
                "명령: `ast-grep run -p '<패턴>' -l <언어> [경로]`, 바꾸기는 `-r '<바꿀 코드>'`(먼저 `--json`으로 확인). 패턴의 `$A`는 아무 노드.",
                "Command: `ast-grep run -p '<pattern>' -l <lang> [path]`; rewrite with `-r '<replacement>'` (check with `--json` first). `$A` in a pattern matches any node."
            ),
            &["npm install --global @ast-grep/cli"],
        ),
        module(
            &Spec {
                id: "mermaid-cli",
                kind: cli,
                repo: "mermaid-js/mermaid-cli",
                commit: "1423a0d7967d",
                license: "MIT",
                needs: "node",
                tags: &["diagram", "docs"],
                capabilities: &["render", "diagram"],
                inputs: &["mermaid"],
                outputs: &["svg", "png", "pdf"],
            },
            Config::default(),
            crate::tr!(
                "Mermaid 파일을 SVG·PNG·PDF로 렌더링해요.",
                "Renders Mermaid files to SVG, PNG or PDF."
            ),
            crate::tr!(
                "명령: `mmdc -i 입력.mmd -o 출력.svg` (`-o`의 확장자로 형식이 정해져요).",
                "Command: `mmdc -i input.mmd -o output.svg` (the `-o` extension picks the format)."
            ),
            &["npm install -g @mermaid-js/mermaid-cli"],
        ),
        module(
            &Spec {
                id: "lighthouse",
                kind: cli,
                repo: "GoogleChrome/lighthouse",
                commit: "df282a603063",
                license: "Apache-2.0",
                needs: "node",
                tags: &["web", "performance", "testing"],
                capabilities: &["audit", "performance", "accessibility"],
                inputs: &["url"],
                outputs: &["performance-report", "test-results"],
            },
            Config::default(),
            crate::tr!(
                "웹 페이지의 성능·접근성·SEO를 점검해 보고서를 만들어요.",
                "Audits a web page's performance, accessibility and SEO and writes a report."
            ),
            crate::tr!(
                "명령: `lighthouse <URL> --no-enable-error-reporting --output json --output-path ./report.json --chrome-flags=\"--headless\"`. Node 22 이상과 Chrome이 있어야 해요.",
                "Command: `lighthouse <URL> --no-enable-error-reporting --output json --output-path ./report.json --chrome-flags=\"--headless\"`. Needs Node 22+ and Chrome."
            ),
            &["npm install -g lighthouse"],
        ),
        module(
            &Spec {
                id: "ripgrep",
                kind: cli,
                repo: "BurntSushi/ripgrep",
                commit: "91f5d22ef48b",
                license: "MIT OR Unlicense",
                needs: "",
                tags: &["code", "search"],
                capabilities: &["text search"],
                inputs: &["source-code", "text"],
                outputs: &["matches"],
            },
            Config::default(),
            crate::tr!(
                "빠른 텍스트 검색 (.gitignore를 따라요).",
                "Fast text search that follows .gitignore."
            ),
            crate::tr!(
                "명령: `rg -n '<정규식>' [경로]`, 파일 종류는 `-t rust`, JSON 결과는 `--json`.",
                "Command: `rg -n '<regex>' [path]`; file types with `-t rust`, JSON with `--json`."
            ),
            &["cargo install ripgrep"],
        ),
        module(
            &Spec {
                id: "jq",
                kind: cli,
                repo: "jqlang/jq",
                commit: "5c001b18d723",
                license: "MIT",
                needs: "",
                tags: &["data", "json"],
                capabilities: &["json", "transform", "filter"],
                inputs: &["json"],
                outputs: &["json", "data"],
            },
            Config::default(),
            crate::tr!("JSON을 거르고 바꿔요.", "Filters and transforms JSON."),
            crate::tr!(
                "명령: `jq '<필터>' 파일.json` (예: `jq '.items[] | .name'`), 한 줄씩은 `-c`.",
                "Command: `jq '<filter>' file.json` (e.g. `jq '.items[] | .name'`); one per line with `-c`."
            ),
            &[],
        ),
    ]
}

/// What a new user starts with: three modules that feed each other and two
/// combinations of them (repomix packs the code; ast-grep finds and rewrites
/// by structure; mcp-mermaid draws what repomix found).
pub fn starter() -> super::Hub {
    use super::{Combo, Hub, Member};
    let all = modules();
    let pick = |id: &str| {
        all.iter()
            .find(|c| c.id == id)
            .map(|c| c.module.clone())
            .expect("starter module in the catalog")
    };
    let member = |module: &str, role: String| Member {
        module: module.into(),
        role,
    };
    Hub {
        modules: vec![pick("repomix"), pick("ast-grep"), pick("mcp-mermaid")],
        combos: vec![
            Combo {
                name: crate::tr!("코드베이스 지도", "Codebase map"),
                goal: crate::tr!(
                    "저장소 전체를 읽고 구조와 흐름을 다이어그램으로 정리한다",
                    "Read the whole repository and lay out its structure and flow as diagrams"
                ),
                members: vec![
                    member(
                        "repomix",
                        crate::tr!(
                            "저장소를 묶어 모듈·의존 관계를 파악한다",
                            "Pack the repository and work out its modules and dependencies"
                        ),
                    ),
                    member(
                        "mcp-mermaid",
                        crate::tr!(
                            "파악한 구조를 Mermaid 다이어그램으로 그린다",
                            "Draw what was found as Mermaid diagrams"
                        ),
                    ),
                ],
                ai_fit: None,
            },
            Combo {
                name: crate::tr!("구조 기반 리팩터링", "Structural refactor"),
                goal: crate::tr!(
                    "바꿀 패턴의 영향 범위를 파악하고, 같은 패턴을 구조 검색으로 찾아 한꺼번에 고친다",
                    "Find where a pattern is used, then rewrite every match by structure in one go"
                ),
                members: vec![
                    member(
                        "repomix",
                        crate::tr!(
                            "관련 코드를 묶어 영향 범위를 확인한다",
                            "Pack the related code and check what the change touches"
                        ),
                    ),
                    member(
                        "ast-grep",
                        crate::tr!(
                            "패턴을 찾아 미리 보고(--json) 한꺼번에 바꾼다",
                            "Find the pattern, preview (--json) and rewrite it everywhere"
                        ),
                    ),
                ],
                ai_fit: None,
            },
        ],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_starter_set_feeds_itself_and_fits_well() {
        let hub = starter();
        assert_eq!(hub.modules.len(), 3);
        assert_eq!(hub.combos.len(), 2);
        for c in &hub.combos {
            for m in &c.members {
                assert!(
                    hub.modules.iter().any(|e| e.name == m.module),
                    "{}",
                    m.module
                );
                assert!(!m.role.is_empty());
            }
            let fit = super::super::fit::rule_fit(c, &hub.modules);
            assert!(fit.score >= 75, "{}: {}", c.name, fit.score);
        }
    }

    #[test]
    fn catalog_modules_are_valid_and_named_uniquely() {
        let all = modules();
        assert!(all.len() >= 20);
        let mut names: Vec<&str> = all.iter().map(|m| m.module.name.as_str()).collect();
        for m in &all {
            mcp::check_name(&m.module.name).unwrap();
            if m.module.kind == ModuleKind::Mcp {
                mcp::check_config(&m.module.config).unwrap();
            } else {
                assert!(!m.module.guide.is_empty(), "{} needs a guide", m.id);
            }
            if let Some(s) = &m.module.source {
                assert!(s.license_ok && s.license.is_some(), "{}", m.id);
            }
        }
        names.sort();
        names.dedup();
        assert_eq!(names.len(), all.len());
    }
}
