//! What each recommended MCP server is for, in English (for Haiku and for
//! matching), and the words (Korean and English) a prompt that needs it uses.

pub fn mcp(id: &str) -> (&'static str, &'static [&'static str]) {
    match id {
        "filesystem" => (
            "Read and write files in the project folder",
            &["file", "files", "folder", "파일", "폴더"],
        ),
        "git" => (
            "Git history, diffs and commits",
            &["git", "commit", "diff", "history", "blame", "커밋", "기록"],
        ),
        "fetch" => (
            "Fetch a web page and read it as Markdown",
            &[
                "web",
                "url",
                "page",
                "fetch",
                "scrape",
                "웹",
                "페이지",
                "스크래핑",
                "크롤링",
            ],
        ),
        "memory" => (
            "Remember facts across conversations in a knowledge graph",
            &["remember", "memory", "기억"],
        ),
        "time" => (
            "Current time and time zone conversion",
            &["time", "timezone", "시간", "시간대"],
        ),
        "github" => (
            "GitHub issues, pull requests, repositories and code search",
            &[
                "github",
                "issue",
                "issues",
                "pr",
                "pull",
                "이슈",
                "풀리퀘스트",
                "깃허브",
            ],
        ),
        "playwright" => (
            "Drive a browser to use and test web pages",
            &[
                "browser",
                "e2e",
                "click",
                "screenshot",
                "브라우저",
                "스크린샷",
            ],
        ),
        "chrome-devtools" => (
            "Debug and profile pages with Chrome DevTools",
            &[
                "chrome",
                "devtools",
                "console",
                "lighthouse",
                "크롬",
                "콘솔",
            ],
        ),
        "context7" => (
            "Up-to-date documentation for libraries and frameworks",
            &[
                "docs",
                "documentation",
                "library",
                "framework",
                "최신",
                "라이브러리",
            ],
        ),
        "notion" => ("Search and edit Notion pages", &["notion", "wiki", "노션"]),
        "linear" => (
            "Read Linear issues",
            &["linear", "ticket", "리니어", "티켓"],
        ),
        "cloudflare" => (
            "Cloudflare Workers, KV, R2 and D1",
            &["cloudflare", "workers", "kv", "r2", "d1", "클라우드플레어"],
        ),
        "supabase" => (
            "Supabase projects, database and auth",
            &["supabase", "수파베이스"],
        ),
        "stripe" => (
            "Stripe payments, customers and products",
            &[
                "stripe",
                "payment",
                "payments",
                "billing",
                "결제",
                "스트라이프",
            ],
        ),
        "aws-docs" => (
            "Search and read AWS documentation",
            &["aws", "amazon", "s3", "lambda", "아마존"],
        ),
        "postgres" => (
            "Query a Postgres database",
            &[
                "postgres",
                "postgresql",
                "sql",
                "query",
                "쿼리",
                "포스트그레스",
            ],
        ),
        "next-devtools" => (
            "Next.js dev server errors, routes and docs",
            &["next", "nextjs", "next.js", "넥스트"],
        ),
        "atlassian" => (
            "Jira and Confluence",
            &["jira", "confluence", "atlassian", "지라", "컨플루언스"],
        ),
        "figma" => (
            "Read layout and styles from Figma designs",
            &["figma", "피그마"],
        ),
        _ => ("", &[]),
    }
}
