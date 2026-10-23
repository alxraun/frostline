<!-- parents: @.frostline/graph/p-frostline.xml -->

# AGENTS.md — Frostline (FLI)

> Project knowledge graph: intent → code, delivered to agents as deterministic
> read-time ancestor context. Full authoring spec lives in the `frostline-graph`
> skill (`packages/skills/frostline-graph/SKILL.md`) — read it before changing
> graph semantics.

## FLI semantics

```
source file --parents:--> node (M) --> node (SS/S) --> node (P)
read event ──> fli ancestors ──> <frostline-context> block ──> agent
```

- A file joins the graph by declaring `parents:` in its first comment line;
   Core walks these edges upward at read time — no downward scanning, no
   inference. Cache is disposable acceleration, never authority.
- Nodes are XML contracts in `.frostline/graph/`, tiers `P`/`S`/`SS`/`M`,
   statements addressed as `NODE-ID.STATEMENT-ID` (FQID).
- Graph boundary: explicit root → `.frostline/` → `.git/` → top-level child
   of `HOME`.

## Layout

```
packages/core/             TS/Deno: CLI `fli` + API `Frostline`
  └─ src/runtime/          discovery · graph · resolution · delivery · syntax
  └─ src/knowledge/        XML node schema
packages/read-classifier/  Rust: shell command → read paths
packages/skills/           exported Agent Skill: frostline-graph
.agents/skills/            project-local skills: frostline-verification, frostline-logging
integrations/codex/        thin Codex adapter (hooks + Rust native)
integrations/deepseek-harness/  thin DSH adapter (TS)
tests/                     architecture · core · e2e · integrations · release
scripts/                   build · check · test · package · verify · release · install-dev
.frostline/graph/          FLI's own graph (XML contract nodes)
```

## Commands

```sh
deno task build
deno task check
deno task test
deno task install:dev codex
deno task install:dev dsh --profile NAME
deno task release
```

## Rules

- Adapters stay thin: path parsing in `read-classifier`; resolution/visibility adapter-owned.
- Core never depends on integrations.
- Don't commit build artifacts (`bin/`, `target/`, `lib/`).
