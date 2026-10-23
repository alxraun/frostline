// parents: @.frostline/graph/m-codex-hook.xml

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::PathBuf;

#[derive(Debug, Deserialize)]
pub(crate) struct HookInput {
    pub session_id: String,
    #[serde(default)]
    pub agent_id: Option<String>,
    // Codex wire contract: the hook's session cwd. Relative shell reads are
    // resolved against it (Codex runs shell tools from this cwd).
    pub cwd: PathBuf,
    pub hook_event_name: String,
    #[serde(default)]
    pub source: Option<String>,
    #[serde(default)]
    pub tool_input: Value,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HookOutput {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hook_specific_output: Option<HookSpecificOutput>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub system_message: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HookSpecificOutput {
    pub hook_event_name: String,
    pub additional_context: String,
}
