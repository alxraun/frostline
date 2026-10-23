// parents: @.frostline/graph/m-codex-hook.xml

mod adapter;
mod models;

use models::HookOutput;
use std::io::{self, Read};

fn main() {
    let output = run().unwrap_or_else(|message| HookOutput {
        system_message: Some(format!(
            "Frostline could not complete this event: {message}."
        )),
        ..HookOutput::default()
    });
    match serde_json::to_string(&output) {
        Ok(json) => println!("{json}"),
        Err(error) => println!(
            "{{\"systemMessage\":\"Frostline output serialization failed: {}\"}}",
            error.to_string().replace('"', "\\\"")
        ),
    }
}

fn run() -> Result<HookOutput, String> {
    let mut stdin = String::new();
    io::stdin()
        .read_to_string(&mut stdin)
        .map_err(|error| format!("cannot read hook input: {error}"))?;
    let input =
        serde_json::from_str(&stdin).map_err(|error| format!("invalid hook input: {error}"))?;
    adapter::dispatch(&input)
}
