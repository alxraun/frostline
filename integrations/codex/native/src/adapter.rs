// parents: @.frostline/graph/m-codex-hook.xml

use crate::models::{HookInput, HookOutput, HookSpecificOutput};
use serde_json::Value;
use std::os::unix::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};
use std::sync::mpsc;
use std::time::Duration;

const MAIN_CONTEXT: &str = "__main__";
const CORE_TIMEOUT: Duration = Duration::from_secs(20);

pub(crate) fn dispatch(input: &HookInput) -> Result<HookOutput, String> {
    match input.hook_event_name.as_str() {
        "SessionStart" => session_start(input),
        "PostToolUse" => post_tool_use(input),
        "PostCompact" => post_compact(input),
        event => Err(format!("unsupported hook event `{event}`")),
    }
}

/// Shared integration UX diagnostic visibility from `docs/integration-ux.md`.
#[derive(Clone, Copy, PartialEq, Eq)]
enum DiagnosticsMode {
    Default,
    Strict,
}

/// Unsupported `FLI_DIAGNOSTICS` values select `default` plus one visible
/// configuration notice per harness session (emitted at SessionStart).
fn resolve_diagnostics_mode() -> (DiagnosticsMode, Option<String>) {
    match std::env::var("FLI_DIAGNOSTICS").ok().as_deref() {
        None | Some("default") => (DiagnosticsMode::Default, None),
        Some("strict") => (DiagnosticsMode::Strict, None),
        Some(value) => (DiagnosticsMode::Default, Some(value.to_string())),
    }
}

fn session_start(input: &HookInput) -> Result<HookOutput, String> {
    let source = input.source.as_deref().unwrap_or("startup");
    let warnings = match source {
        "startup" | "clear" => reset_session(&input.session_id)?,
        "compact" => reset_context(input)?,
        "resume" => Vec::new(),
        _ => Vec::new(),
    };
    let mut messages = Vec::new();
    if source != "compact" {
        messages.push("Frostline is active for this session.".to_string());
    }
    if let Some(value) = resolve_diagnostics_mode().1 {
        messages.push(format!(
            "Frostline ignored unknown FLI_DIAGNOSTICS value \"{value}\", using default diagnostics."
        ));
    }
    if let Some(warnings) = format_warnings(warnings) {
        messages.push(warnings);
    }
    Ok(HookOutput {
        system_message: (!messages.is_empty()).then(|| messages.join("\n")),
        ..HookOutput::default()
    })
}

fn post_tool_use(input: &HookInput) -> Result<HookOutput, String> {
    let command = input
        .tool_input
        .get("command")
        .and_then(Value::as_str)
        .ok_or_else(|| "PostToolUse Bash input has no string `command`".to_string())?;
    // Shell reads arrive verbatim from the classifier; a relative path is a
    // fact about the hook's session cwd (Codex wire contract exposes `cwd`
    // for every PostToolUse input and runs shell tools from it), so it is
    // resolved there instead of being skipped.
    let reads = read_classifier::classify_reads(command)
        .into_iter()
        .map(|read| resolve_read(PathBuf::from(read), &input.cwd))
        // Reads inside the plugin's own installation subtree are internal
        // package reads, never model-visible FLI read events.
        .filter(|path| !is_inside_own_installation(path))
        .collect::<Vec<_>>();
    if reads.is_empty() {
        return Ok(HookOutput::default());
    }

    let mut arguments = vec!["ancestors".to_string()];
    for read in reads {
        arguments.push(read.to_string_lossy().into_owned());
    }
    arguments.extend([
        "--session".to_string(),
        input.session_id.clone(),
        "--context".to_string(),
        context_id(input),
        "--json".to_string(),
    ]);

    let output = run_core(&arguments)?;
    let context = output
        .get("context")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let mode = resolve_diagnostics_mode().0;
    let delivery = delivery_message(&output);
    let diagnostics = diagnostics_message(&output, mode);
    let mut messages = Vec::new();
    // One read event -> at most one delivery notice; a diagnostic shares the
    // delivery message per `docs/integration-ux.md`.
    match (delivery, diagnostics) {
        (Some(delivery), Some(diagnostics)) => {
            messages.push(format!("{delivery} Note: {diagnostics}."))
        }
        (Some(delivery), None) => messages.push(delivery),
        (None, Some(diagnostics)) => messages.push(diagnostics),
        (None, None) => {}
    }
    // Default mode hides self-recovering delivery-state warnings; strict
    // shows every state warning.
    let mut warnings = strings(&output, "stateWarnings");
    if mode == DiagnosticsMode::Default {
        warnings.retain(|warning| !warning.contains("reinjecting safely"));
    }
    if let Some(message) = format_warnings(warnings) {
        messages.push(message);
    }
    Ok(HookOutput {
        hook_specific_output: (!context.is_empty()).then_some(HookSpecificOutput {
            hook_event_name: "PostToolUse".to_string(),
            additional_context: context,
        }),
        system_message: (!messages.is_empty()).then(|| messages.join("\n")),
    })
}

fn post_compact(input: &HookInput) -> Result<HookOutput, String> {
    let warnings = reset_context(input)?;
    Ok(HookOutput {
        system_message: format_warnings(warnings),
        ..HookOutput::default()
    })
}

fn reset_context(input: &HookInput) -> Result<Vec<String>, String> {
    let output = run_core(&[
        "reset-context".to_string(),
        "--session".to_string(),
        input.session_id.clone(),
        "--context".to_string(),
        context_id(input),
        "--json".to_string(),
    ])?;
    Ok(strings(&output, "stateWarnings"))
}

fn reset_session(session_id: &str) -> Result<Vec<String>, String> {
    let output = run_core(&[
        "reset-session".to_string(),
        "--session".to_string(),
        session_id.to_string(),
        "--json".to_string(),
    ])?;
    Ok(strings(&output, "stateWarnings"))
}

fn run_core(arguments: &[String]) -> Result<Value, String> {
    let child = Command::new(core_binary()?)
        .args(arguments)
        .process_group(0)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("cannot start FLI Core: {error}"))?;
    let pid = child.id();
    let (sender, receiver) = mpsc::sync_channel(1);
    std::thread::spawn(move || {
        let _ = sender.send(child.wait_with_output());
    });
    let timeout = core_timeout();
    let output = match receiver.recv_timeout(timeout) {
        Ok(result) => result.map_err(|error| format!("cannot await FLI Core: {error}"))?,
        Err(mpsc::RecvTimeoutError::Timeout) => {
            terminate_process(pid);
            let _ = receiver.recv_timeout(Duration::from_secs(1));
            return Err(format!(
                "FLI Core timed out after {}ms",
                timeout.as_millis()
            ));
        }
        Err(mpsc::RecvTimeoutError::Disconnected) => {
            return Err("cannot await FLI Core: waiter disconnected".to_string());
        }
    };
    parse_core_output(output)
}

fn parse_core_output(output: Output) -> Result<Value, String> {
    if !output.status.success() {
        return Err(format!(
            "FLI Core failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    serde_json::from_slice(&output.stdout)
        .map_err(|error| format!("invalid FLI Core JSON: {error}"))
}

fn core_timeout() -> Duration {
    std::env::var("FLI_CORE_TIMEOUT_MS")
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .filter(|value| *value > 0)
        .map(|value| value.min(CORE_TIMEOUT.as_millis() as u64))
        .map(Duration::from_millis)
        .unwrap_or(CORE_TIMEOUT)
}

fn terminate_process(pid: u32) {
    // The release target is Linux x86_64. A timed-out Core must not survive
    // the adapter and retain pipes or the shared derived-state lock.
    unsafe {
        libc::kill(-(pid as libc::pid_t), libc::SIGKILL);
    }
}

fn core_binary() -> Result<PathBuf, String> {
    if let Some(path) = std::env::var_os("FLI_CORE_BIN") {
        let path = PathBuf::from(path);
        if path.is_file() {
            return Ok(path);
        }
    }
    if let Some(root) = std::env::var_os("FLI_PRODUCT_ROOT") {
        let path = Path::new(&root).join("bin").join("fli");
        if path.is_file() {
            return Ok(path);
        }
    }
    let sibling = std::env::current_exe()
        .ok()
        .and_then(|value| value.parent().map(|directory| directory.join("fli")))
        .filter(|value| value.is_file());
    sibling.ok_or_else(|| "FLI Core executable is unavailable; set FLI_CORE_BIN".to_string())
}

/// Resolves a classifier read path against the hook's session cwd. Absolute
/// reads pass through unchanged; relative reads join the cwd because Codex
/// runs shell tools from that cwd and reports it in the hook input.
fn resolve_read(read: PathBuf, cwd: &Path) -> PathBuf {
    if read.is_absolute() {
        read
    } else {
        cwd.join(read)
    }
}

fn is_inside_own_installation(path: &Path) -> bool {
    std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().and_then(Path::parent).map(Path::to_path_buf))
        .map(|installation| path.starts_with(installation))
        .unwrap_or(false)
}

fn context_id(input: &HookInput) -> String {
    input
        .agent_id
        .clone()
        .unwrap_or_else(|| MAIN_CONTEXT.to_string())
}

fn delivery_message(output: &Value) -> Option<String> {
    let names = delivery_names(output);
    if names.is_empty() {
        return None;
    }
    if names.len() <= 3 {
        return Some(format!("Frostline context added for {}.", names.join(", ")));
    }
    let omitted = names.len() - 3;
    Some(format!(
        "Frostline context added for {}, and {} more files.",
        names[..3].join(", "),
        omitted
    ))
}

/// Delivery notice names: project-relative paths, qualified on collision.
fn delivery_names(output: &Value) -> Vec<String> {
    let mut names = structured_document_names(output);
    if names.is_empty() {
        // Core output without structured documents: recover the XML order.
        let context = output.get("context").and_then(Value::as_str).unwrap_or("");
        names = context
            .lines()
            .filter_map(|line| {
                let line = line.trim_start();
                let tag_end = line.find(char::is_whitespace)?;
                let tag = &line[..tag_end];
                let name = tag.strip_prefix('<')?;
                (matches!(name.chars().next(), Some(character) if character.is_ascii_lowercase() || character == '_')
                    && name.chars().all(|character| {
                        character.is_ascii_lowercase() || character.is_ascii_digit() || character == '-'
                    }))
                    .then_some(&line[tag_end..])?
                    .split_once("path=\"")?
                    .1
                    .split_once('"')
                    .map(|(path, _)| path.to_string())
            })
            .collect();
        return names;
    }
    names
}

fn structured_document_names(output: &Value) -> Vec<String> {
    let documents = output
        .get("documents")
        .and_then(Value::as_array)
        .map(|values| {
            values
                .iter()
                .filter_map(|item| {
                    let path = item.get("path")?.as_str()?;
                    let project = item.get("project").and_then(Value::as_str);
                    Some((path.to_string(), project.map(str::to_string)))
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    if documents.is_empty() {
        return Vec::new();
    }
    let mut counts = std::collections::HashMap::new();
    for (path, _) in &documents {
        *counts.entry(path.clone()).or_insert(0usize) += 1;
    }
    documents
        .into_iter()
        .map(
            |(path, project)| match (project, counts.get(&path).copied()) {
                (Some(project), Some(count)) if count > 1 => format!("{project}:{path}"),
                _ => path,
            },
        )
        .collect()
}

/// Default mode shows operational diagnostics; strict adds declaration and
/// selector diagnostics per `docs/integration-ux.md`.
fn diagnostics_message(output: &Value, mode: DiagnosticsMode) -> Option<String> {
    let messages = diagnostic_messages(output)
        .into_iter()
        .filter(|(kind, _)| {
            mode == DiagnosticsMode::Strict || !matches!(kind.as_str(), "syntax" | "resolution")
        })
        .map(|(_, message)| format!("Frostline note: {message}"))
        .collect::<Vec<_>>();
    (!messages.is_empty()).then(|| messages.join("; "))
}

fn diagnostic_messages(value: &Value) -> Vec<(String, String)> {
    value
        .get("diagnostics")
        .and_then(Value::as_array)
        .map(|values| {
            values
                .iter()
                .filter_map(|item| {
                    let object = item.as_object()?;
                    let kind = object
                        .get("kind")
                        .and_then(Value::as_str)
                        .unwrap_or("internal")
                        .to_string();
                    let message = object.get("message")?.as_str()?.to_string();
                    Some((kind, message))
                })
                .collect()
        })
        .unwrap_or_default()
}

fn format_warnings(warnings: Vec<String>) -> Option<String> {
    (!warnings.is_empty()).then(|| {
        warnings
            .into_iter()
            .map(|warning| format!("Frostline warning: {warning}"))
            .collect::<Vec<_>>()
            .join("\n")
    })
}

fn strings(value: &Value, field: &str) -> Vec<String> {
    value
        .get(field)
        .and_then(Value::as_array)
        .map(|values| {
            values
                .iter()
                .filter_map(|item| item.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default()
}
