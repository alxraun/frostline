# Frostline (FLI)

> **Experimental, not security-hardened — see [SECURITY.md](SECURITY.md).** Not production ready; no marketplace distribution (dev-script install only).

Frostline is a project knowledge graph inspired by [GRACE Marketplace](https://github.com/osovv/grace-marketplace), implementing an architectural knowledge graph with automatic context delivery to AI agents.

When reading a file, an agent receives the contracts of its architectural ancestors before the file's own content. This allows the autoregressive model to interpret the code with prior knowledge of its purpose, requirements, and architectural context.

In its current implementation, Frostline focuses exclusively on architectural knowledge management, without mechanisms for managing agents, tasks, or development workflows.

## Architectural Graph

Frostline uses a directed acyclic graph (DAG). Each file can declare references to its parents in a comment:

```ts
// parents: @.frostline/graph/m-parser.xml
```

Parent documents similarly reference higher-level ancestors, forming an architectural hierarchy:

```text
Project (P)
└── System (S)
    └── Subsystem (SS)
        └── Module (M)
            └── Source file
```

Nodes are XML contracts, stored by default in `.frostline/graph/`.

**The principle is knowledge inheritance without duplication.** As the graph is traversed upward, detail decreases while architectural scope expands: from an individual module to the project as a whole.

This gives the agent a holistic understanding of the system, its components, and their relationships, making codebase navigation easier.

Frostline recursively collects the ancestors of a read file and automatically delivers them to the agent. Documents already delivered are not injected again.

**The mechanism is deterministic:** no LLM inference or semantic search. The source of truth is the filesystem and explicit relationships.

## Integrations

- **OpenAI Codex** — native plugin.
- **DeepSeek Harness** — Cordis plugin.

## CLI

```sh
fli ancestors FILE...              # Ancestor context
fli graph FILE|DIR [--root DIR]     # Full graph
fli reset-context                  # Reset delivery state
fli reset-session
```

## Development

**Stack:** TypeScript, Deno, Rust.
**Platform:** Linux x86_64.

```sh
deno task build
deno task check
deno task test
deno task install:dev codex
deno task install:dev dsh --profile NAME
deno task release
```

Packages are self-contained and require no development toolchain to run.

**Platform:** Linux x86_64 only — build, packages, and runtime are developed and tested exclusively on Linux. Windows and macOS are not supported in the current implementation.

**Distribution:** Codex — Git marketplace; DeepSeek Harness — npm-compatible `.tgz`. Publishing is manual.

## License

Frostline is licensed under the [MIT license](LICENSE). Distributed packages bundle third-party software; each package ships complete notices in `licenses/` (`NOTICE.md` listing every crate and one canonical license text per license family).
