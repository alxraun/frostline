<!-- parents: @.frostline/graph/m-dsh-plugin.xml -->

# @frostline/dsh

Frostline adapter for DeepSeek Harness: a thin plugin that observes file reads,
asks the bundled Core for ancestor context, and injects it into the session.

Tested against dsh `0.2.0-rc.2` — only explicitly tested revisions are
declared supported.

## Observation

```
native read result ──> value.path ──────────────┐
bash result ──> fli-classify-reads ─> paths ────┤
                                                └──> fli ancestors ──> additionalContexts
```

Only accepted, unmodified results become observations; anything ambiguous is
skipped, never guessed. Notices use the v4 source `{ kind: "fli", form:
"notice", summary }`; old v3 sessions stay readable.

## Lifecycle

```
agent/session-start            ──> reset session
session clear / compaction end ──> reset context
resume                         ──> preserved
```

The bundle registers `frostline-graph` through `ctx.skills`; project-local
skills (`frostline-verification`, `frostline-logging`) live in the project's
`.agents/skills/` and are not part of the exported bundle.

## Host string

`cordis.patch.yml` mounts the host string via `insert` for TUI/headless
profiles; web profiles mount it through the agent preset — the user's choice.
The two coexist safely.

## Install

```sh
deno task build
deno task package dsh DEST
deno task install:dev dsh --profile NAME   # explicit existing user profile (required)
```
