// parents: @.frostline/graph/m-read-classifier.xml

//! Stdin/stdout transport over `read_classifier::classify_reads` for
//! non-Rust adapters. Input: `{"commands": ["<script>", ...]}`; output:
//! `{"reads": ["<path>", ...]}` deduplicated across all commands.

use read_classifier::classify_reads;
use serde::{Deserialize, Serialize};
use std::io::{self, Read};

#[derive(Deserialize)]
struct Request {
    commands: Vec<String>,
}

#[derive(Serialize)]
struct Response {
    reads: Vec<String>,
}

fn run() -> Result<Response, String> {
    let mut input = String::new();
    io::stdin()
        .read_to_string(&mut input)
        .map_err(|error| format!("cannot read request: {error}"))?;
    let request: Request =
        serde_json::from_str(&input).map_err(|error| format!("invalid request: {error}"))?;
    let mut reads: Vec<String> = Vec::new();
    for command in request.commands {
        for read in classify_reads(&command) {
            if !reads.contains(&read) {
                reads.push(read);
            }
        }
    }
    Ok(Response { reads })
}

fn main() {
    match run() {
        Ok(response) => match serde_json::to_string(&response) {
            Ok(json) => println!("{json}"),
            Err(error) => fail(format!("response serialization failed: {error}")),
        },
        Err(message) => fail(message),
    }
}

fn fail(message: String) -> ! {
    eprintln!("fli-classify-reads: {message}");
    std::process::exit(1);
}
