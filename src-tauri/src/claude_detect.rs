//! Whether Claude (the desktop app or Claude Code) is running, so the app can
//! open as the sidebar beside it.

/// A running process named `claude` (`claude.exe` on Windows: the desktop app
/// and the native Claude Code both). Claude Code installed with npm runs as
/// `node` and is only seen when its session starts (the mod's `sessionStart`).
pub fn claude_running() -> bool {
    imp::process_names().iter().any(|n| is_claude(n))
}

fn is_claude(name: &str) -> bool {
    let name = name.to_ascii_lowercase();
    name == "claude" || name == "claude.exe"
}

#[cfg(windows)]
mod imp {
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, PROCESSENTRY32W, Process32FirstW, Process32NextW,
        TH32CS_SNAPPROCESS,
    };

    pub fn process_names() -> Vec<String> {
        let mut out = Vec::new();
        let Ok(snap) = (unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) }) else {
            return out;
        };
        let mut entry = PROCESSENTRY32W {
            dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
            ..Default::default()
        };
        let mut ok = unsafe { Process32FirstW(snap, &mut entry) }.is_ok();
        while ok {
            let len = entry
                .szExeFile
                .iter()
                .position(|&c| c == 0)
                .unwrap_or(entry.szExeFile.len());
            out.push(String::from_utf16_lossy(&entry.szExeFile[..len]));
            ok = unsafe { Process32NextW(snap, &mut entry) }.is_ok();
        }
        unsafe {
            let _ = CloseHandle(snap);
        }
        out
    }
}

#[cfg(not(windows))]
mod imp {
    /// `/proc/<pid>/comm` on Linux; nothing elsewhere.
    pub fn process_names() -> Vec<String> {
        let Ok(dir) = std::fs::read_dir("/proc") else {
            return Vec::new();
        };
        dir.flatten()
            .filter(|e| {
                e.file_name()
                    .to_string_lossy()
                    .bytes()
                    .all(|b| b.is_ascii_digit())
            })
            .filter_map(|e| std::fs::read_to_string(e.path().join("comm")).ok())
            .map(|s| s.trim().to_string())
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_are_matched_whole() {
        assert!(is_claude("claude"));
        assert!(is_claude("Claude.exe"));
        assert!(!is_claude("claude-helper"));
        assert!(!is_claude("node"));
        // Runs on any machine; only checks it doesn't fail.
        let _ = claude_running();
    }
}
