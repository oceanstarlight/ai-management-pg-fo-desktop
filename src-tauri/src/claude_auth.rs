//! Whether the user's Claude Code login works, as the app's own `claude -p`
//! runs (prompt suggestions, skill generation, automations) find out. The app
//! never reads or touches the login itself: when a run says the login expired,
//! the user is told to sign in again in Claude Code (`/login`), and the notice
//! goes away once a later run works.
//!
//! The app's own runs also start at least [`SPACING`] apart: several `claude`
//! processes refreshing the same login at the same moment is one way it can
//! end up unusable.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter};

/// Emitted with `true` when a run found the login expired, `false` when a
/// later run worked again.
pub const EVENT: &str = "claude-auth";

const SPACING: Duration = Duration::from_millis(1500);

static EXPIRED: AtomicBool = AtomicBool::new(false);
static APP: OnceLock<AppHandle> = OnceLock::new();
static LAST_START: Mutex<Option<Instant>> = Mutex::new(None);

pub fn manage(app: &AppHandle) {
    let _ = APP.set(app.clone());
}

/// Waits until the last `claude -p` the app started is [`SPACING`] ago.
pub(crate) fn before_run() {
    let mut last = LAST_START.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(at) = *last {
        let since = at.elapsed();
        if since < SPACING {
            std::thread::sleep(SPACING - since);
        }
    }
    *last = Some(Instant::now());
}

/// Whether `claude` output says the login can't be used.
pub(crate) fn is_auth_failure(text: &str) -> bool {
    let t = text.to_ascii_lowercase();
    [
        "failed to authenticate",
        "oauth session expired",
        "oauth token has expired",
        "could not be refreshed",
        "authentication_error",
        "invalid api key",
        "please run /login",
        "not logged in",
    ]
    .iter()
    .any(|p| t.contains(p))
}

/// What the user is told instead of `claude`'s own message.
pub fn expired_message() -> String {
    crate::tr!(
        "Claude Code 로그인이 만료됐어요. 터미널에서 claude를 열고 /login으로 다시 로그인해 주세요",
        "Your Claude Code sign-in expired. Open claude in a terminal and sign in again with /login"
    )
}

fn set(expired: bool) {
    if EXPIRED.swap(expired, Ordering::SeqCst) != expired
        && let Some(app) = APP.get()
    {
        let _ = app.emit(EVENT, expired);
    }
}

/// Notes how a `claude -p` run went. Returns the message to show instead of
/// the run's own when it failed for the login.
pub(crate) fn after_run(ok: bool, stdout: &str, stderr: &str) -> Option<String> {
    let value: serde_json::Value = serde_json::from_str(stdout.trim()).unwrap_or_default();
    let is_error = value["is_error"].as_bool() == Some(true);
    if ok && !is_error {
        set(false);
        return None;
    }
    if is_auth_failure(stderr) || is_auth_failure(stdout) {
        set(true);
        return Some(expired_message());
    }
    None
}

#[tauri::command]
pub fn claude_auth_expired() -> bool {
    EXPIRED.load(Ordering::SeqCst)
}

/// Opens a terminal running the user's `claude`, to sign in with `/login`.
#[tauri::command]
pub async fn claude_open_login(app: AppHandle) -> Result<(), String> {
    use tauri::Manager;
    let path = crate::tools::cli::find(crate::tools::ToolId::Claude)
        .ok_or_else(|| crate::tools::cli::not_found(crate::tools::ToolId::Claude))?;
    let home = app.path().home_dir().map_err(|e| e.to_string())?;
    open_terminal(&path, &home).map_err(|e| {
        crate::tr!(
            "터미널을 열지 못했어요 ({e}). 직접 터미널에서 claude를 실행해 주세요",
            "Couldn't open a terminal ({e}). Run claude in a terminal yourself"
        )
    })
}

#[cfg(windows)]
fn open_terminal(claude: &std::path::Path, dir: &std::path::Path) -> std::io::Result<()> {
    use std::os::windows::process::CommandExt;
    // `start` opens a new console window; `cmd /k ""<path>""` keeps it open
    // after claude exits and survives spaces in the path.
    std::process::Command::new("cmd")
        .raw_arg(format!(
            "/c start \"Claude Code\" cmd /k \"\"{}\"\"",
            claude.display()
        ))
        .current_dir(dir)
        // CREATE_NO_WINDOW for the outer cmd only.
        .creation_flags(0x0800_0000)
        .spawn()
        .map(|_| ())
}

#[cfg(target_os = "macos")]
fn open_terminal(claude: &std::path::Path, dir: &std::path::Path) -> std::io::Result<()> {
    let quote = |p: &std::path::Path| p.display().to_string().replace('\'', r"'\''");
    let script = format!(
        "tell application \"Terminal\" to do script \"cd '{}' && '{}'\"",
        quote(dir),
        quote(claude)
    );
    std::process::Command::new("osascript")
        .args(["-e", &script])
        .spawn()
        .map(|_| ())
}

#[cfg(not(any(windows, target_os = "macos")))]
fn open_terminal(claude: &std::path::Path, dir: &std::path::Path) -> std::io::Result<()> {
    std::process::Command::new("x-terminal-emulator")
        .arg("-e")
        .arg(claude)
        .current_dir(dir)
        .spawn()
        .map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognizes_login_failures() {
        assert!(is_auth_failure(
            "Failed to authenticate: OAuth session expired and could not be refreshed"
        ));
        assert!(is_auth_failure("Invalid API key · Please run /login"));
        assert!(!is_auth_failure("Error: model overloaded"));
    }

    #[test]
    fn a_run_that_failed_for_the_login_is_reworded_and_a_good_one_clears_it() {
        let failed = r#"{"is_error":true,"result":"Failed to authenticate: OAuth session expired and could not be refreshed"}"#;
        assert_eq!(after_run(false, failed, ""), Some(expired_message()));
        assert!(claude_auth_expired());
        // Some other failure says nothing about the login.
        assert_eq!(after_run(false, "", "network down"), None);
        assert!(claude_auth_expired());
        assert_eq!(after_run(true, r#"{"result":"ok"}"#, ""), None);
        assert!(!claude_auth_expired());
    }
}
