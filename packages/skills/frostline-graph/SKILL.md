---
name: frostline-graph
description: Authoritative specification for the Frostline (FLI) architectural knowledge graph - 4-tier contract schema, statement grammar, FQID addressing, parents linking protocol, and codemap discipline. Load when creating or modifying architectural nodes (P/S/SS/M) in .frostline/graph/.
---

# Frostline (FLI) Graph Specification

## 1. System Model & Core Axioms

Frostline (FLI) is an architectural knowledge graph connecting project intent to codebase implementation via a Directed Acyclic Graph (DAG) of contracts and child-owned in-file parent declarations.

### Core Axioms

1. **Architectural Hierarchy:** The graph reflects the architectural decomposition of the system from global intent down to concrete implementation modules (`P -> S -> SS -> M`).
2. **Inheritance without Duplication:** Knowledge is anchored at the highest applicable abstraction level; descendants inherit context without duplication. Duplicate statements across nodes or levels are forbidden.
3. **Contract-Driven Authority:** Contracts are primary: implementation source code realizes specified contractual obligations.
4. **Physical Grounding (No Invented Abstractions):** Every node in the graph must represent a tangible codebase entity, directory, component, or deliverable. Artificial grouping nodes without distinct invariants are invalid.
   - *The Deletion Test:* If removing a node from the graph loses no unique architectural invariants or domain constraints that cannot live in its parent or children, the node must not exist.

---

## 2. Tier Matrix & Decomposition Topology

Every graph node is an individual XML file; the root tag matches the node's unique identifier. Architectural nodes (`P-*`, `S-*`, `SS-*`, `M-*`) live in `.frostline/graph/`.

### 2.1. Tier Matrix

| Tier             | Root Tag | Scope & Scale                                                  | Allowed Fields (Strict Closed Set)                                    |
| ---------------- | -------- | -------------------------------------------------------------- | --------------------------------------------------------------------- |
| **Project**      | `<P-*>`  | Global intent, deliverable unit, platform & macro-layout.      | `<Purpose>`, `<Scope>`, `<Principles>`, `<Technology>`, `<Codemap>`   |
| **System**       | `<S-*>`  | Autonomous domain, major service, or system protocol boundary. | `<Purpose>`, `<Scope>`, `<Principles>`, `<Requirements>`, `<Codemap>` |
| **Subsystem**    | `<SS-*>` | Functional cluster of modules, pipeline orchestration.         | `<Purpose>`, `<Scope>`, `<Principles>`, `<Requirements>`, `<Codemap>` |
| **Module**       | `<M-*>`  | Atomic implementation component: interface contract and logic. | `<Purpose>`, `<Scope>`, `<Requirements>`, `<Contract>`, `<Codemap>`   |

The verification plane (`<V-*>`) is specified by the project-local `frostline-verification` skill (`.agents/skills/`); verification nodes live in `.frostline/graph/` side by side with architectural nodes.

### 2.2. Topology & Hierarchy Normatives

- **Project Boundary Definition:** One `<P-*>` node corresponds to exactly one independently deliverable or releasable unit (e.g., an application, package, or tool with its own versioning, metadata, or lifecycle). A Git repository is not inherently a project.
- **Multi-Project Roots:** A single `.frostline/` catalog may contain multiple independent `<P-*>` root nodes.
- **Tier Collapse (Direct Attachment):** An intermediate tier (`SS-*` or `S-*`) is introduced **only** if the grouping holds its own distinct domain invariants, policies, or contracts. In the absence of intermediate invariants, a child module (`M-*`) attaches directly to an `<S-*>` or `<P-*>`.
- **Module Is a Membrane:** `<M-*>` is the atomic decomposition floor. There are no sub-module tiers and no finer decomposition inside `M-*`; internal structure belongs to source code, not to the graph.
- **Vertical-Only Parents:** The `parents:` linking hierarchy is strictly directed upward (`M -> SS/S/P`, `SS -> S/P`, `S -> P`). Horizontal links between siblings (`P -> P`, `S -> S`, `M -> M`) are forbidden.
- **Cross-System & Cross-Project Seams:** Interactions between peer nodes or independent projects must never use `parents:` links. They are expressed strictly via shared symbol references within `<Codemap>` and cross-referenced statement FQIDs in requirements.

---

## 3. Graph Linking Protocol

A file declares its graph participation in its very first comment immediately following optional file preludes (UTF-8 BOM, shebang `#!`, XML prolog `<?xml ?>`):

```text
parents: @<path>[, @<path>]
```

### 3.1. Comment Syntax

- **`//` (C#, TS, Rust, Go):** `// parents: @.frostline/graph/m-payment.xml`
- **`#` (Python, Shell, YAML):** `# parents: @.frostline/graph/m-payment.xml`
- **`<!-- -->` (XML, HTML, MD):** `<!-- parents: @.frostline/graph/ss-billing.xml -->`
- **`--` (SQL, Lua):** `-- parents: @.frostline/graph/m-ledger.xml`

### 3.2. Role Mapping

| File Role                             | Target Parent Node                                 |
| ------------------------------------- | -------------------------------------------------- |
| Implementation Source (`src/`)        | `<M-*>` (Implementation Module)                    |
| Test Suites (`tests/`)                | `<V-*>` (Verification Node)                        |
| Verification Node (`.frostline/graph/`) | Verified Target Node (`M-*`, `SS-*`, `S-*`, `P-*`) |
| Architectural Node (`.frostline/graph/...`) | Superior Graph Node (`M -> SS/S/P`, `SS -> S/P`, `S -> P`) |

---

## 4. Field Definitions & Boundaries

Each field serves strictly one architectural purpose:

- **`<Purpose>`:** Defines why the node exists in the architecture (direct text).
- **`<Scope>`:** Operational boundaries with explicit separation of included responsibilities (`<SCP-IN-NNN>`) and excluded responsibilities (`<SCP-OUT-NNN>`).
- **`<Principles>`:** Stable design heuristics and invariants governing technical decisions (`<PRIN-NNN>`).
- **`<Technology>`:** Physical platform foundation: runtime constraints, libraries, and frameworks (`<TECH-NNN>`). Allowed in `<P-*>` only.
- **`<Requirements>`:** Normative behavioral rules, algorithmic logic, and domain invariants (`<REQ-NNN>`).
- **`<Contract>`:** Public interface specifications: inputs (`<IN-NNN>`), outputs (`<OUT-NNN>`), and side effects (`<EFF-NNN>`). Allowed in `<M-*>` only.
- **`<Codemap>`:** Symbolic projection of the node onto implementation symbols, data flows, and structural relationships (`<![CDATA[ ... ]]>`).

---

## 5. Statement Grammar & Addressing

Atomic statements inside container fields use typed tag prefixes and three-digit incremental numbers (`NNN`).

### 5.1. Statement Prefix Registry

| Field                                      | Prefix                | Tag Format                        | Example                                                                                                                       |
| ------------------------------------------ | --------------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `<Purpose>`                                | _(none)_              | _(direct text)_                   | `<Purpose>Processes and records customer payment transactions.</Purpose>`                                                     |
| `<Scope>`                                  | `SCP-IN`<br>`SCP-OUT` | `<SCP-IN-NNN>`<br>`<SCP-OUT-NNN>` | `<SCP-IN-001>Payment capture via acquirers.</SCP-IN-001>`<br>`<SCP-OUT-001>Card issuance and KYC verification.</SCP-OUT-001>` |
| `<Principles>`                             | `PRIN`                | `<PRIN-NNN>`                      | `<PRIN-001>Monetary amounts are stored as integer minor units.</PRIN-001>`                                                    |
| `<Technology>`                             | `TECH`                | `<TECH-NNN>`                      | `<TECH-001>PostgreSQL for ledger state storage.</TECH-001>`                                                                   |
| `<Requirements>`                           | `REQ`                 | `<REQ-NNN>`                       | `<REQ-001>Duplicate idempotency keys return the cached receipt.</REQ-001>`                                                    |
| `<Contract>` $\rightarrow$ `<Inputs>`      | `IN`                  | `<IN-NNN>`                        | `<IN-001>Param amount: positive integer.</IN-001>`                                                                            |
| `<Contract>` $\rightarrow$ `<Outputs>`     | `OUT`                 | `<OUT-NNN>`                       | `<OUT-001>Returns transaction status and receiptId.</OUT-001>`                                                                |
| `<Contract>` $\rightarrow$ `<SideEffects>` | `EFF`                 | `<EFF-NNN>`                       | `<EFF-001>Outbound HTTP POST call to payment gateway.</EFF-001>`                                                               |

*When side effects are absent, use the explicit marker:*
```xml
<SideEffects>
  <None />
</SideEffects>
```

### 5.2. XML Escaping in Signatures

Statement text carrying code signatures with XML-special characters (`<`, `>`, `&`, e.g. generic types `Map<K, V>`) is wrapped in a CDATA section instead of entity escaping — exactly like `<Codemap>`:

```xml
<IN-002><![CDATA[Param headers: Map<string, string>.]]></IN-002>
```

### 5.3. Addressing Protocol (FQID)

Every statement has a deterministic, globally unique address (Fully Qualified Identifier):

```text
NODE-ID.STATEMENT-ID
```

Examples:
- `P-FLEXVERSE.PRIN-001`
- `S-BILLING.REQ-004`
- `SS-PAYMENT-PIPELINE.SCP-OUT-002`
- `M-PAYMENT-SERVICE.IN-001`

---

## 6. Codemap Specification

The `<Codemap>` field is the node's single inventory surface: navigation anchors plus executable pseudocode in one projection. It contains a symbolic projection of the node onto concrete code elements, formatted as a Markdown list wrapped inside a `<![CDATA[ ... ]]>` block.

### 6.1. Invariants

1. **Symbols Only (No Prose):** Permitted content is strictly implementation code identifiers and relation operators. Natural language sentences, words, and comments are forbidden.
2. **Absolute Ban on FQIDs:** FQIDs (`NODE-ID.STATEMENT-ID`) belong exclusively to text fields and must never appear inside `<Codemap>`. Codemap belongs strictly to source code symbols.
3. **Operator-Based Semantics:** State transitions, conditions, and dynamic semantics must be expressed strictly via relational and logical operators (e.g., `cond => state == val`), never descriptive text.
4. **Allowed Operators:** Strictly restricted to:
   - `->` (Invocation, dispatch, sequential flow)
   - `=>` (State transition, event emission, condition implication)
   - `==`, `!=` (Equality, value/state invariant)
   - `+` (Aggregation, composition, parallel execution)
   - `|` (Choice, variant, fallback)
   - `:` (Type signature, interface implementation)
5. **Tree Coverage:** A parent node's Codemap must cover the public boundaries, interfaces, and inter-relations of all its child sibling nodes at its resolution level.
6. **Public Surface:** Captures key facades, domain aggregates, entrypoints, and main data flows. Internal helpers, loop state, and method bodies are excluded.

### 6.2. Canonical XML Example (Project Tier)

```xml
<Codemap>
<![CDATA[
* `apps/api_gateway` -> `services/account` + `services/payment` + `services/settlement`

* `ApiGateway.handle_request` -> `AuthTokenVerifier.verify` -> `RouteDispatcher.dispatch`
* `RouteDispatcher.dispatch` -> `AccountFacade` | `PaymentFacade` | `SettlementFacade`

* `PaymentFacade.charge(CreateChargeCmd)` -> `AccountFacade.hold_funds` -> `PaymentPipeline.execute`
* `AccountFacade.hold_funds` -> `Account.balance.available >= Cmd.amount` => `LedgerStore.create_hold`
* `Payment.account_id == Account.id`
* `Payment.amount.currency == Account.currency`

* `PaymentPipeline.execute` -> `GatewayRouter.route(PaymentMethod)`
* `GatewayRouter.route` -> `StripeAdapter` | `AdyenAdapter` | `BankRailsAdapter`
* `StripeAdapter` : `IGatewayAdapter`
* `AdyenAdapter` : `IGatewayAdapter`

* `IGatewayAdapter.charge` -> `GatewayResponse.status == Succeeded` => `Payment.status = Captured`
* `IGatewayAdapter.charge` -> `GatewayResponse.status == Failed` => `Payment.status = Failed`

* `Payment.status == Captured` => `EventOutbox.publish(PaymentCaptured)`
* `Payment.status == Failed` => `AccountFacade.release_hold` + `EventOutbox.publish(PaymentFailed)`

* `PaymentCaptured` => `LedgerFacade.commit_hold` + `ReceiptService.issue` + `WebhookDispatcher.broadcast`

* `SettlementCron.daily_reconcile` -> `GatewayReportParser.fetch_settled` + `LedgerFacade.unsettled_entries`
* `ReconciliationEngine.match` -> `SettlementBatch.status = Balanced` | `AlertService.notify_finance`
]]>
</Codemap>
```
