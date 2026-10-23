// parents: @.frostline/graph/m-read-classifier.xml

//! Deterministic shell read classification shared by Frostline harness
//! adapters. The classifier owns command parsing only: it never resolves
//! relative paths, filters installation subtrees, or decides model
//! visibility — those stay adapter-owned.

use codex_protocol::parse_command::ParsedCommand;

/// Classify one shell script into best-effort read file paths, deduplicated
/// in first-seen order. Paths are returned verbatim from command parsing:
/// when relative, the caller resolves them against the command's working
/// directory.
pub fn classify_reads(script: &str) -> Vec<String> {
    let mut reads: Vec<String> = Vec::new();
    for parsed in codex_shell_command::parse_command::parse_shell_script(script) {
        if let ParsedCommand::Read { path, .. } = parsed {
            let value = path.to_string_lossy().into_owned();
            if !reads.contains(&value) {
                reads.push(value);
            }
        }
    }
    reads
}
