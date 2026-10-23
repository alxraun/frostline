---
name: frostline-verification
description: Specification for the Frostline (FLI) verification plane - V-* node schema in .frostline/graph/, Scenarios with target FQIDs, verification hierarchy, and test-file parents markup. Requires frostline-graph. Load when creating or modifying V-* nodes or tests linked to them.
---

# Frostline (FLI) Verification Plane Specification

Verification nodes (`<V-*>`) mirror architectural nodes to specify mechanical correctness proofs. They live in `.frostline/graph/` side by side with architectural nodes, not in a separate directory.

## 1. Verification Hierarchy

- `<V-M-*>` verifies `<M-*>`
- `<V-SS-*>` verifies `<SS-*>`
- `<V-S-*>` verifies `<S-*>`
- `<V-P-*>` verifies `<P-*>`

## 2. Verification Rules & Node Template

- Every scenario `<SCN-NNN>` must have a mandatory `target` attribute containing an exact statement FQID (`target="NODE-ID.STATEMENT-ID"`).
- One scenario proves the happy path of its target statement. Multiple scenarios per target are recommended: one proposition is proven complete only when its boundary cases fail loudly too (see section 4).
- Verification nodes parent strictly one target architectural node, never another verification node.
- Field set is fixed: `<Command>`, `<TestFiles>`, `<Scenarios>` (see the tier matrix in `frostline-graph`).

```xml
<!-- parents: @.frostline/graph/m-dsh-plugin.xml -->
<V-M-DSH-PLUGIN>
  <Command>deno test --allow-all tests/integrations/deepseek-harness/m-dsh-plugin.test.ts</Command>

  <TestFiles>
    <File>tests/integrations/deepseek-harness/m-dsh-plugin.test.ts</File>
  </TestFiles>

  <Scenarios>
    <SCN-001 target="M-DSH-PLUGIN.REQ-001">
      Only accepted unmodified native `read` results with canonical `value.path` become observations.
    </SCN-001>
    <SCN-002 target="M-DSH-PLUGIN.REQ-001">
      Blocked or replaced reads, and ambiguous bash commands, produce no observation and no guessing.
    </SCN-002>
    <SCN-003 target="M-DSH-PLUGIN.REQ-004">
      Empty or already-delivered context emits no repetitive success status.
    </SCN-003>
  </Scenarios>
</V-M-DSH-PLUGIN>
```

## 3. Test File Naming

Base test file name duplicates the verification node name:

```text
.frostline/graph/v-ss-runtime.xml         <->  tests/core/ss-runtime.test.ts
.frostline/graph/v-m-codex-hook.xml       <->  tests/integrations/codex/m-codex-hook.test.ts
```

One V-* may split into several files; each keeps the node name as prefix, suffixed by any distinguishing principle (concern, feature, group — project's choice):

```text
tests/core/m-syntax.prelude.test.ts
tests/core/m-graph.cycle.test.ts
tests/integrations/deepseek-harness/m-dsh-plugin.install.test.ts
```

All files of one V-* node declare the same node as parent.

## 4. Scenario Discovery Heuristics

Independent advisory hints for generating scenario ideas. One scenario per target proves the happy path only; multiple scenarios per target are recommended — inspect the space around the proposition for ways it can vary, interact, or be violated:

- inputs: empty, zero, negative, extreme, malformed, adversarial
- states: initial, intermediate, terminal, corrupted, reused
- boundaries: limits, off-by-one, transition edges
- failures: every way the statement can be violated
- interactions: sibling contracts, concurrent access, shared state
- sequences: repeats, ordering, idempotency, cancellation
- equivalent transformations: forms that must not change the outcome
