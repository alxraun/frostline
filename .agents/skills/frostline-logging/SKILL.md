---
name: frostline-logging
description: The Frostline (FLI) grep-stable logging contract - log schema, severity levels, grep-stability rules, and investigation heuristics. Logs are the agent's primary runtime interface - the way to observe execution state and await events. Hard requires frostline-graph. Load when adding or reading FLI logs or diagnostics.
---

# Frostline (FLI) Logging & Diagnostic Traceability

Runtime logs are a grep-stable contract connecting live system execution back to the architectural knowledge graph. This file instantiates that contract for FLI itself: the schema below uses FLI node IDs and symbols. FLI reports through Core stderr diagnostics, Codex `systemMessage` ("FLI: ...") and DSH notices `{ kind: "fli", form: "notice", summary }`.

## 1. Log Schema

Every structured log line must adhere to the exact format:

```text
[TIME/TICK][PROJECT-ID][NODE-ID][CALL-SITE][LEVEL] EVENT VARIABLES: {k1=v1, k2=v2}
```

- **`TIME/TICK`:** Absolute temporal anchor — integer tick/frame index (`[154]`) or ISO-8601 timestamp.
- **`PROJECT-ID`:** Top-level project node ID from the knowledge graph (e.g., `[P-FROSTLINE]`).
- **`NODE-ID`:** Architectural node ID from the knowledge graph owning the code (e.g., `[M-DSH-PLUGIN]`).
- **`CALL-SITE`:** Execution location inside code (`[ClassName:MethodName]`).
- **`LEVEL`:** Severity classification tag: `[DEBUG]`, `[INFO]`, `[WARNING]`, `[ERROR]`.
- **`EVENT`:** Semantic event identifier describing what occurred (e.g., `core.ancestors.failed`, `delivery.context.skipped`). It is not a rigid enum, but an arbitrary, semantically descriptive dot-notated token used when `CALL-SITE` alone is insufficient to clarify the event.
- **`VARIABLES:`:** Mandatory key-value snapshot of critical runtime variables at event time (e.g., `VARIABLES: {file=src/x.ts, sessionId=s1}`; use `VARIABLES: {}` when no state applies).

## 2. Severity Levels

- **`[DEBUG]`:** Hot paths, internal loop state, and high-frequency forensic telemetry.
- **`[INFO]`:** Normal milestones, lifecycle changes, and public contract dispatches.
- **`[WARNING]`:** Recoverable anomalies, fallback execution, and degraded operations.
- **`[ERROR]`:** Invariant violations, contract breaches, and unhandled exceptions.

## 3. The Grep-Stable Contract

1. Log prefixes and brackets are immutable; dynamic formatting and arbitrary free-text prefixes are forbidden.
2. In critical execution paths, log statements must never be throttled or deduplicated; absence of a line proves the event did not occur.
3. Stateful entities must carry a deterministic entity key or short hash inside `VARIABLES:` to enable cross-thread trace isolation.

## 4. Investigation Heuristics

Independent advisory hints; each applies on its own, in any order. The schema, severity levels, and grep-stable contract above are normative.

- Start with a holistic sweep: filter out `[DEBUG]` noise and inspect only `[INFO]`, `[WARNING]`, and `[ERROR]` to map the macro-timeline of execution.
