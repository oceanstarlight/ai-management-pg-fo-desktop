//! An optional Anthropic API key of the user's own, for the app's short Haiku
//! calls (prompt suggestions, decision notes) without the user's Claude Code
//! login. With a key saved, those calls go straight to the Messages API and
//! are billed to that key; without one, the app runs the user's `claude -p`
//! as before. The key lives in the OS credential store, never in a file.

use std::time::Duration;

use serde_json::{Value, json};
use ureq::Agent;
use ureq::tls::{RootCerts, TlsConfig};

const SERVICE: &str = "ai-management";
const ACCOUNT: &str = "anthropic-api-key";
const URL: &str = "https://api.anthropic.com/v1/messages";
const API_VERSION: &str = "2026-10-21";
/// The current Haiku: suggestions and notes are short classification calls.
const MODEL: &str = "claude-haiku-5-5";
const MAX_TOKENS: u32 = 2048;

type Result<T> = std::result::Result<T, String>;

fn entry() -> Result<keyring::Entry> {
    keyring::Entry::new(SERVICE, ACCOUNT).map_err(|e| {
        crate::tr!(
            "자격 증명 저장소를 쓸 수 없어요 ({e})",
            "The credential store isn't available ({e})"
        )
    })
}

/// The saved key, if any. A store that can't be read counts as none.
pub fn key() -> Option<String> {
    entry()
        .ok()?
        .get_password()
        .ok()
        .filter(|k| !k.trim().is_empty())
}

fn agent() -> Agent {
    Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(60)))
        .tls_config(
            TlsConfig::builder()
                .root_certs(RootCerts::PlatformVerifier)
                .build(),
        )
        .http_status_as_error(false)
        .user_agent(concat!("ai-management/", env!("CARGO_PKG_VERSION")))
        .build()
        .into()
}

/// The request body: one user message, thinking off and low effort, since
/// these are quick picks and short notes.
fn body(system: &str, prompt: &str, max_tokens: u32) -> Value {
    json!({
        "model": MODEL,
        "max_tokens": max_tokens,
        "system": system,
        "thinking": { "type": "disabled" },
        "output_config": { "effort": "low" },
        "messages": [{ "role": "user", "content": prompt }],
    })
}

/// The reply's text, or why there is none, from a Messages API answer.
fn reply_text(status: u16, value: &Value) -> Result<String> {
    if status >= 400 || value["type"] == "error" {
        let kind = value["error"]["type"].as_str().unwrap_or_default();
        let message = value["error"]["message"].as_str().unwrap_or_default();
        return Err(match (status, kind) {
            (401, _) | (_, "authentication_error") => crate::tr!(
                "Anthropic API 키가 올바르지 않아요. 설정에서 키를 확인해 주세요",
                "The Anthropic API key isn't valid. Check it in Settings"
            ),
            (403, _) | (_, "permission_error") => crate::tr!(
                "이 API 키로는 쓸 수 없어요: {message}",
                "This API key isn't allowed to: {message}"
            ),
            (429, _) | (_, "rate_limit_error") => crate::tr!(
                "API 요청 한도에 걸렸어요. 잠시 뒤 다시 시도해 주세요",
                "The API rate limit was reached. Try again in a moment"
            ),
            (402, _) | (_, "billing_error") => crate::tr!(
                "API 결제 한도나 크레딧을 확인해 주세요: {message}",
                "Check the API billing or credits: {message}"
            ),
            _ => crate::tr!(
                "Anthropic API 오류 ({status}): {message}",
                "Anthropic API error ({status}): {message}"
            ),
        });
    }
    if value["stop_reason"] == "refusal" {
        return Err(crate::tr!(
            "모델이 이 요청에 답하지 않았어요",
            "The model declined this request"
        ));
    }
    let text: String = value["content"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|b| b["type"] == "text")
        .filter_map(|b| b["text"].as_str())
        .collect();
    Ok(text)
}

/// Asks Haiku with `key`; returns its reply text.
pub fn complete_with(key: &str, system: &str, prompt: &str, max_tokens: u32) -> Result<String> {
    let response = agent()
        .post(URL)
        .header("x-api-key", key)
        .header("anthropic-version", API_VERSION)
        .header("content-type", "application/json")
        .send_json(body(system, prompt, max_tokens));
    let mut response = response.map_err(|e| {
        crate::tr!(
            "Anthropic API에 연결하지 못했어요 ({e})",
            "Couldn't reach the Anthropic API ({e})"
        )
    })?;
    let status = response.status().as_u16();
    let value: Value = response
        .body_mut()
        .with_config()
        .limit(4 * 1024 * 1024)
        .read_json()
        .unwrap_or(Value::Null);
    reply_text(status, &value)
}

/// Asks Haiku with the saved key; `None` when no key is saved.
pub fn complete(system: &str, prompt: &str) -> Option<Result<String>> {
    let key = key()?;
    Some(complete_with(&key, system, prompt, MAX_TOKENS))
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyStatus {
    pub set: bool,
    /// The key's last four characters, to tell keys apart.
    pub hint: Option<String>,
}

fn status() -> KeyStatus {
    let key = key();
    KeyStatus {
        set: key.is_some(),
        hint: key.map(|k| {
            let chars: Vec<char> = k.trim().chars().collect();
            chars[chars.len().saturating_sub(4)..].iter().collect()
        }),
    }
}

#[tauri::command]
pub async fn anthropic_key_status() -> KeyStatus {
    tauri::async_runtime::spawn_blocking(status)
        .await
        .unwrap_or(KeyStatus {
            set: false,
            hint: None,
        })
}

/// Checks `key` with a tiny request, then saves it; `None` removes the key.
#[tauri::command]
pub async fn anthropic_key_set(key: Option<String>) -> Result<KeyStatus> {
    tauri::async_runtime::spawn_blocking(move || {
        match key.map(|k| k.trim().to_string()).filter(|k| !k.is_empty()) {
            Some(key) => {
                complete_with(&key, "Reply with OK.", "ping", 16)?;
                entry()?.set_password(&key).map_err(|e| {
                    crate::tr!(
                        "API 키를 저장하지 못했어요 ({e})",
                        "Couldn't save the API key ({e})"
                    )
                })?;
            }
            None => match entry()?.delete_credential() {
                Ok(()) | Err(keyring::Error::NoEntry) => {}
                Err(e) => {
                    return Err(crate::tr!(
                        "API 키를 지우지 못했어요 ({e})",
                        "Couldn't remove the API key ({e})"
                    ));
                }
            },
        }
        Ok(status())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_request_is_a_short_haiku_call() {
        let b = body("sys", "hi", 40);
        assert_eq!(b["model"], "claude-haiku-5-5");
        assert_eq!(b["max_tokens"], 40);
        assert_eq!(b["system"], "sys");
        assert_eq!(b["thinking"]["type"], "disabled");
        assert_eq!(b["output_config"]["effort"], "low");
        assert_eq!(b["messages"][0]["content"], "hi");
        assert!(b.get("temperature").is_none());
    }

    #[test]
    fn reads_text_and_errors() {
        let ok = json!({"content": [
            {"type": "thinking", "thinking": ""},
            {"type": "text", "text": "1, 3"}
        ], "stop_reason": "end_turn"});
        assert_eq!(reply_text(200, &ok).unwrap(), "1, 3");

        let bad = json!({"type": "error", "error": {"type": "authentication_error", "message": "invalid x-api-key"}});
        assert!(reply_text(401, &bad).unwrap_err().contains("API"));
        let refused = json!({"content": [], "stop_reason": "refusal"});
        assert!(reply_text(200, &refused).is_err());
    }
}
