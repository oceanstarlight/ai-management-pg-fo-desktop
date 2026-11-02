//! Reading public GitHub repositories for the catalog and skill imports:
//! the latest commit (git's ref advertisement, no API limit), a commit's file
//! list (REST API, with the signed-in token when there is one) and raw files.
//! Nothing fetched is ever executed.

use std::time::Duration;

use serde::Deserialize;
use ureq::Agent;
use ureq::tls::{RootCerts, TlsConfig};

/// Text and companion files are small; anything bigger is refused.
pub const MAX_FILE: u64 = 512 * 1024;

pub fn agent() -> Agent {
    Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(20)))
        // The OS certificate store, so corporate proxies with their own CA work.
        .tls_config(
            TlsConfig::builder()
                .root_certs(RootCerts::PlatformVerifier)
                .build(),
        )
        .user_agent(concat!("ai-management/", env!("CARGO_PKG_VERSION")))
        .build()
        .into()
}

fn call(agent: &Agent, url: &str, accept: &str, token: Option<&str>) -> Result<Vec<u8>, String> {
    let mut req = agent.get(url).header("Accept", accept);
    if let Some(token) = token {
        req = req.header("Authorization", &format!("Bearer {token}"));
    }
    req.call()
        .map_err(|e| match e {
            ureq::Error::StatusCode(404) => crate::tr!(
                "GitHub에서 찾을 수 없어요 (주소나 공개 여부를 확인해 주세요)",
                "Not found on GitHub (check the address and that it's public)"
            ),
            ureq::Error::StatusCode(403 | 429) => crate::tr!(
                "GitHub 요청 한도에 걸렸어요. GitHub에 로그인하거나 잠시 뒤 다시 시도해 주세요",
                "GitHub's rate limit was reached. Sign in to GitHub or try again later"
            ),
            e => crate::tr!("받아오지 못했어요 ({e})", "Couldn't download ({e})"),
        })?
        .body_mut()
        .with_config()
        .limit(8 * 1024 * 1024)
        .read_to_vec()
        .map_err(|e| crate::tr!("읽지 못했어요 ({e})", "Couldn't read the response ({e})"))
}

pub fn get(agent: &Agent, url: &str, accept: &str) -> Result<String, String> {
    let bytes = call(agent, url, accept, None)?;
    String::from_utf8(bytes).map_err(|_| crate::tr!("텍스트 파일이 아니에요", "Not a text file"))
}

/// The repository's HEAD commit from git's smart-HTTP ref advertisement (what
/// `git ls-remote` reads): no API token or API rate limit involved.
pub fn latest_commit(agent: &Agent, repo: &str) -> Result<String, String> {
    let url = format!("https://github.com/{repo}.git/info/refs?service=git-upload-pack");
    let refs = get(agent, &url, "*/*")?;
    head_commit(&refs).ok_or_else(|| {
        crate::tr!(
            "최신 커밋을 알 수 없어요",
            "Couldn't find the latest commit"
        )
    })
}

/// Finds `<sha> HEAD` in a pkt-line ref advertisement.
pub(super) fn head_commit(refs: &str) -> Option<String> {
    ref_commit(refs, "HEAD")
}

/// Finds `<sha> <name>` in a pkt-line ref advertisement.
fn ref_commit(refs: &str, name: &str) -> Option<String> {
    refs.split(['\n', '\0']).find_map(|line| {
        let (head, rest) = line.split_once(' ')?;
        let sha = head.get(head.len().checked_sub(40)?..)?;
        (rest == name && sha.chars().all(|c| c.is_ascii_hexdigit()))
            .then(|| sha.to_ascii_lowercase())
    })
}

/// The commit a GitHub address's `<ref>/<path>` part starts with, and how
/// many of `segments` the ref took (branch names may hold `/`). No segments:
/// the default branch.
pub fn resolve(agent: &Agent, repo: &str, segments: &[&str]) -> Result<(String, usize), String> {
    let Some(first) = segments.first() else {
        return Ok((latest_commit(agent, repo)?, 0));
    };
    if first.len() == 40 && first.chars().all(|c| c.is_ascii_hexdigit()) {
        return Ok((first.to_ascii_lowercase(), 1));
    }
    let url = format!("https://github.com/{repo}.git/info/refs?service=git-upload-pack");
    let refs = get(agent, &url, "*/*")?;
    pick_ref(&refs, segments).ok_or_else(|| {
        crate::tr!(
            "브랜치나 태그를 찾을 수 없어요: {first}",
            "No such branch or tag: {first}"
        )
    })
}

/// The longest `segments` prefix that names a branch or tag in `refs`.
fn pick_ref(refs: &str, segments: &[&str]) -> Option<(String, usize)> {
    (1..=segments.len().min(6)).rev().find_map(|n| {
        let name = segments[..n].join("/");
        [
            format!("refs/heads/{name}"),
            format!("refs/tags/{name}^{{}}"),
            format!("refs/tags/{name}"),
        ]
        .iter()
        .find_map(|r| ref_commit(refs, r))
        .map(|sha| (sha, n))
    })
}

#[derive(Clone, Debug, Deserialize)]
pub struct Entry {
    pub path: String,
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default)]
    pub size: u64,
}

impl Entry {
    pub fn is_file(&self) -> bool {
        self.kind == "blob"
    }
}

#[derive(Deserialize)]
struct Tree {
    tree: Vec<Entry>,
    #[serde(default)]
    truncated: bool,
}

/// Every file and folder at `commit` (one API request).
pub fn tree(
    agent: &Agent,
    repo: &str,
    commit: &str,
    token: Option<&str>,
) -> Result<Vec<Entry>, String> {
    let url = format!("https://api.github.com/repos/{repo}/git/trees/{commit}?recursive=1");
    let bytes = call(agent, &url, "application/vnd.github+json", token)?;
    let tree: Tree = serde_json::from_slice(&bytes).map_err(|e| {
        crate::tr!(
            "GitHub 응답을 읽지 못했어요 ({e})",
            "Couldn't read GitHub's response ({e})"
        )
    })?;
    if tree.truncated {
        eprintln!("{repo}: file list truncated");
    }
    Ok(tree.tree)
}

/// One file's bytes at `commit`.
pub fn raw(agent: &Agent, repo: &str, commit: &str, path: &str) -> Result<Vec<u8>, String> {
    let url = format!("https://raw.githubusercontent.com/{repo}/{commit}/{path}");
    call(agent, &url, "*/*", None)
}

/// One text file at `commit`.
pub fn raw_text(agent: &Agent, repo: &str, commit: &str, path: &str) -> Result<String, String> {
    String::from_utf8(raw(agent, repo, commit, path)?)
        .map_err(|_| crate::tr!("텍스트 파일이 아니에요", "Not a text file"))
}

/// Whether a file name is a license file.
pub fn is_license_file(name: &str) -> bool {
    let upper = name.to_ascii_uppercase();
    let stem = upper.split('.').next().unwrap_or_default();
    matches!(stem, "LICENSE" | "LICENCE" | "COPYING" | "UNLICENSE")
}

/// The license file that covers `dir` (a path in the repository): the
/// nearest one in `dir` or a folder above it.
pub fn license_for<'a>(entries: &'a [Entry], dir: &str) -> Option<&'a Entry> {
    let mut at = dir.trim_matches('/').to_string();
    loop {
        let found = entries.iter().find(|e| {
            e.is_file()
                && match e.path.rsplit_once('/') {
                    Some((parent, name)) => parent == at && is_license_file(name),
                    None => at.is_empty() && is_license_file(&e.path),
                }
        });
        if found.is_some() {
            return found;
        }
        if at.is_empty() {
            return None;
        }
        at = at
            .rsplit_once('/')
            .map(|(p, _)| p.to_string())
            .unwrap_or_default();
    }
}

/// The SPDX id a license text reads as, roughly, and whether the project's
/// rules allow taking it (`CLAUDE.md`, "Third-party content").
pub fn classify_license(text: &str) -> (Option<&'static str>, bool) {
    let t = text.to_ascii_lowercase();
    let id = if t.contains("gnu affero general public license") {
        "AGPL-3.0"
    } else if t.contains("gnu lesser general public license") {
        "LGPL"
    } else if t.contains("gnu general public license") {
        "GPL"
    } else if t.contains("mozilla public license") {
        "MPL-2.0"
    } else if t.contains("noncommercial") || t.contains("non-commercial") {
        "CC BY-NC"
    } else if t.contains("apache license") && t.contains("version 2.0") {
        "Apache-2.0"
    } else if t.contains("permission is hereby granted, free of charge")
        || t.contains("mit license")
    {
        "MIT"
    } else if t.contains("redistribution and use in source and binary forms") {
        "BSD"
    } else if t.contains("permission to use, copy, modify, and/or distribute this software") {
        "ISC"
    } else if t.contains("this is free and unencumbered software released into the public domain") {
        "Unlicense"
    } else if t.contains("cc0") || t.contains("creative commons zero") {
        "CC0-1.0"
    } else if t.contains("altered source versions must be plainly marked") {
        "Zlib"
    } else {
        return (None, false);
    };
    let ok = matches!(
        id,
        "Apache-2.0" | "MIT" | "BSD" | "ISC" | "Unlicense" | "CC0-1.0" | "Zlib"
    );
    (Some(id), ok)
}

/// Things the project's rules keep out of third-party text: piped remote
/// scripts, referral or tracking links, telemetry. Shown before anything
/// is taken in; the user decides.
pub fn content_warnings(text: &str) -> Vec<String> {
    let t = text.to_ascii_lowercase();
    let mut out = Vec::new();
    let piped = ["| sh", "| bash", "|sh", "|bash", "| zsh", "| iex", "|iex"];
    if (t.contains("curl ") || t.contains("wget ") || t.contains("irm ") || t.contains("iwr "))
        && piped.iter().any(|p| t.contains(p))
    {
        out.push(crate::tr!(
            "원격 스크립트를 받아 바로 실행하는 명령이 있어요",
            "Runs a downloaded script directly"
        ));
    }
    if ["?ref=", "&ref=", "utm_", "referral", "affiliate"]
        .iter()
        .any(|p| t.contains(p))
    {
        out.push(crate::tr!(
            "추천·추적 링크가 있어요",
            "Contains referral or tracking links"
        ));
    }
    if ["telemetry", "analytics", "posthog", "sentry"]
        .iter()
        .any(|p| t.contains(p))
    {
        out.push(crate::tr!(
            "원격 수집(telemetry) 관련 내용이 있어요",
            "Mentions telemetry or analytics"
        ));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(path: &str) -> Entry {
        Entry {
            path: path.into(),
            kind: "blob".into(),
            size: 1,
        }
    }

    #[test]
    fn reads_refs_from_an_advertisement() {
        let a = "a".repeat(40);
        let b = "b".repeat(40);
        let c = "c".repeat(40);
        let refs = format!(
            "001e# service=git-upload-pack\n00000155{a} HEAD\0multi_ack symref=HEAD:refs/heads/main\n003f{a} refs/heads/main\n003f{b} refs/tags/v1\n003f{c} refs/tags/v1^{{}}\n0000"
        );
        assert_eq!(head_commit(&refs).as_deref(), Some(a.as_str()));
        assert_eq!(
            ref_commit(&refs, "refs/heads/main").as_deref(),
            Some(a.as_str())
        );
        assert_eq!(
            ref_commit(&refs, "refs/tags/v1^{}").as_deref(),
            Some(c.as_str())
        );
        assert_eq!(ref_commit(&refs, "refs/heads/dev"), None);
        assert_eq!(pick_ref(&refs, &["v1", "skills"]), Some((c.clone(), 1)));
        assert_eq!(pick_ref(&refs, &["nope"]), None);
        let slashed = format!("003f{b} refs/heads/feat/x\n");
        assert_eq!(
            pick_ref(&slashed, &["feat", "x", "dir"]),
            Some((b.clone(), 2))
        );
        assert_eq!(head_commit("0000"), None);
        assert_eq!(head_commit("0008zz HEAD"), None);
    }

    #[test]
    fn finds_the_nearest_license() {
        let entries = vec![
            entry("LICENSE"),
            entry("skills/a/SKILL.md"),
            entry("skills/b/SKILL.md"),
            entry("skills/b/LICENSE.txt"),
        ];
        assert_eq!(license_for(&entries, "skills/a").unwrap().path, "LICENSE");
        assert_eq!(
            license_for(&entries, "skills/b").unwrap().path,
            "skills/b/LICENSE.txt"
        );
        assert!(license_for(&entries[1..2], "skills/a").is_none());
    }

    #[test]
    fn classifies_licenses() {
        assert_eq!(
            classify_license("MIT License\n\nPermission is hereby granted, free of charge"),
            (Some("MIT"), true)
        );
        assert_eq!(
            classify_license("Apache License\nVersion 2.0, January 2004"),
            (Some("Apache-2.0"), true)
        );
        assert_eq!(
            classify_license("GNU GENERAL PUBLIC LICENSE Version 3"),
            (Some("GPL"), false)
        );
        assert_eq!(classify_license("All rights reserved."), (None, false));
        assert!(!classify_license("Attribution-NonCommercial 4.0").1);
    }

    #[test]
    fn warns_about_risky_content() {
        assert_eq!(
            content_warnings("Run `curl -fsSL https://x.sh | bash` first").len(),
            1
        );
        assert_eq!(content_warnings("See https://x.com/?ref=abc").len(), 1);
        assert!(content_warnings("Plain instructions.").is_empty());
    }
}
