//! Adding a module from GitHub, step two (only when the user says so): clone
//! the repository at the commit that was analysed into
//! `<app data>/modules/<name>`, then run the setup commands the user
//! approved, one by one, in that folder. Their output is returned so the
//! user sees what happened.

use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::AppHandle;

use super::{blocking, change, data_dir, load};

type Result<T> = std::result::Result<T, String>;

/// One setup command may take this long (a first build downloads a lot).
const STEP_TIMEOUT: Duration = Duration::from_secs(20 * 60);
const LOG_KEEP: usize = 6000;

pub fn modules_dir(data_dir: &Path) -> PathBuf {
    data_dir.join("modules")
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Installed {
    pub dir: String,
    /// What each step printed (the end of it).
    pub log: String,
}

fn shell(command: &str, dir: &Path) -> Command {
    #[cfg(windows)]
    let mut cmd = {
        use std::os::windows::process::CommandExt;
        let mut c = Command::new("cmd");
        c.arg("/C").raw_arg(command);
        // CREATE_NO_WINDOW: no console flash from a GUI app.
        c.creation_flags(0x0800_0000);
        c
    };
    #[cfg(not(windows))]
    let mut cmd = {
        let mut c = Command::new("sh");
        c.arg("-c").arg(command);
        c
    };
    cmd.current_dir(dir)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    cmd
}

/// Runs one command; its output, or why it failed (with the output).
fn run_step(command: &str, dir: &Path, timeout: Duration) -> Result<String> {
    let mut child = shell(command, dir).spawn().map_err(|e| {
        crate::tr!(
            "실행하지 못했어요: {command} ({e})",
            "Couldn't run: {command} ({e})"
        )
    })?;
    let read = |pipe: Option<Box<dyn Read + Send>>| {
        std::thread::spawn(move || {
            let mut text = String::new();
            if let Some(mut p) = pipe {
                let mut buf = Vec::new();
                let _ = p.read_to_end(&mut buf);
                text = String::from_utf8_lossy(&buf).into_owned();
            }
            text
        })
    };
    let out = read(
        child
            .stdout
            .take()
            .map(|p| Box::new(p) as Box<dyn Read + Send>),
    );
    let err = read(
        child
            .stderr
            .take()
            .map(|p| Box::new(p) as Box<dyn Read + Send>),
    );
    let start = Instant::now();
    let status = loop {
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            break Some(status);
        }
        if start.elapsed() > timeout {
            let _ = child.kill();
            let _ = child.wait();
            break None;
        }
        std::thread::sleep(Duration::from_millis(200));
    };
    let text = format!(
        "{}{}",
        out.join().unwrap_or_default(),
        err.join().unwrap_or_default()
    );
    let text = tail(&text);
    match status {
        Some(s) if s.success() => Ok(text),
        Some(s) => Err(crate::tr!(
            "실패했어요 (종료 코드 {}): {command}\n{text}",
            "Failed (exit code {}): {command}\n{text}",
            s.code().unwrap_or(-1)
        )),
        None => Err(crate::tr!(
            "{}분 안에 끝나지 않아 멈췄어요: {command}\n{text}",
            "Stopped after {} minutes: {command}\n{text}",
            timeout.as_secs() / 60
        )),
    }
}

fn tail(text: &str) -> String {
    let chars: Vec<char> = text.trim().chars().collect();
    chars[chars.len().saturating_sub(LOG_KEEP)..]
        .iter()
        .collect()
}

/// Clones `repo` at `commit` into `dir` (replacing an earlier clone) and runs
/// `steps` there.
pub fn install(repo: &str, commit: &str, dir: &Path, steps: &[String]) -> Result<String> {
    let parent = dir.parent().ok_or("bad folder")?;
    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    if dir.exists() {
        std::fs::remove_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let url = format!("https://github.com/{repo}.git");
    let target = dir.to_string_lossy().into_owned();
    crate::git::run(
        parent,
        &[
            "clone",
            "--filter=blob:none",
            "--no-checkout",
            &url,
            &target,
        ],
    )?;
    crate::git::run(dir, &["checkout", "--quiet", commit])?;
    let mut log = format!("$ git clone {url} @ {}\n", &commit[..commit.len().min(12)]);
    for step in steps.iter().map(|s| s.trim()).filter(|s| !s.is_empty()) {
        log.push_str(&format!("\n$ {step}\n"));
        match run_step(step, dir, STEP_TIMEOUT) {
            Ok(out) => log.push_str(&out),
            Err(e) => return Err(format!("{}\n\n{e}", tail(&log))),
        }
    }
    Ok(tail(&log))
}

/// Clones the module's repository at its analysed commit and runs the
/// setup commands the user approved (`steps`, as shown to them).
#[tauri::command]
pub async fn module_install(app: AppHandle, name: String, steps: Vec<String>) -> Result<Installed> {
    let data = data_dir(&app)?;
    blocking(move || {
        let modules = load(&data)?;
        let entry = modules
            .iter()
            .find(|e| e.name == name)
            .ok_or_else(|| crate::tr!("없는 모듈이에요", "No such module"))?;
        let source = entry
            .source
            .clone()
            .filter(|s| !s.repo.is_empty() && !s.commit.is_empty());
        let Some(source) = source else {
            return Err(crate::tr!(
                "GitHub에서 가져온 모듈만 설치할 수 있어요",
                "Only modules from GitHub can be installed"
            ));
        };
        crate::mcp::check_name(&name)?;
        let dir = modules_dir(&data).join(&name);
        let log = install(&source.repo, &source.commit, &dir, &steps)?;
        let path = dir.to_string_lossy().into_owned();
        change(&data, |hub| {
            if let Some(e) = hub.modules.iter_mut().find(|e| e.name == name) {
                e.installed_dir = Some(path.clone());
                e.install = steps.clone();
            }
            Ok(())
        })?;
        Ok(Installed { dir: path, log })
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(unix)]
    #[test]
    fn steps_report_their_output_and_failures() {
        let dir = std::env::temp_dir();
        assert_eq!(run_step("echo built", &dir, STEP_TIMEOUT).unwrap(), "built");
        let err = run_step("echo nope >&2; exit 4", &dir, STEP_TIMEOUT).unwrap_err();
        assert!(err.contains("4") && err.contains("nope"), "{err}");
        let err = run_step("sleep 5", &dir, Duration::from_millis(300)).unwrap_err();
        assert!(err.contains("sleep 5"), "{err}");
    }

    #[test]
    fn logs_keep_their_end() {
        let long = "x".repeat(LOG_KEEP + 50) + "END";
        assert!(tail(&long).ends_with("END"));
        assert_eq!(tail(&long).chars().count(), LOG_KEEP);
    }
}
