// parents: @.frostline/graph/v-ss-knowledge.xml

import * as fs from "node:fs";
import * as path from "node:path";
import { assertEquals } from "./assert.ts";
import {
  isFqid,
  statementPrefixes,
  tierFields,
  tierOf,
  validateKnowledge,
} from "../../packages/core/src/knowledge/schema.ts";
import {
  parse,
  readLeadingArea,
} from "../../packages/core/src/runtime/syntax.ts";

const root = path.resolve(new URL("../../", import.meta.url).pathname);
const docsRoot = path.join(root, ".frostline", "graph");

function doc(name: string): string {
  return fs.readFileSync(path.join(docsRoot, name), "utf8");
}

const projectNode = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  "<!-- parents: @.frostline/none.xml -->",
  "<P-DEMO>",
  "  <Purpose>Demo project.</Purpose>",
  "  <Scope>",
  "    <SCP-IN-001>In.</SCP-IN-001>",
  "    <SCP-OUT-001>Out.</SCP-OUT-001>",
  "  </Scope>",
  "  <Principles>",
  "    <PRIN-001>One.</PRIN-001>",
  "  </Principles>",
  "  <Technology>",
  "    <TECH-001>TypeScript.</TECH-001>",
  "  </Technology>",
  "  <Codemap>",
  "<![CDATA[",
  "* `a` -> `b`",
  "]]>",
  "  </Codemap>",
  "</P-DEMO>",
].join("\n");

const moduleNode = [
  "<!-- parents: @.frostline/ss-demo.xml -->",
  "<M-DEMO>",
  "  <Purpose>Demo module.</Purpose>",
  "  <Scope>",
  "    <SCP-IN-001>In.</SCP-IN-001>",
  "  </Scope>",
  "  <Requirements>",
  "    <REQ-001>One.</REQ-001>",
  "    <REQ-002>Two.</REQ-002>",
  "  </Requirements>",
  "  <Contract>",
  "    <Inputs>",
  "      <IN-001>Input.</IN-001>",
  "    </Inputs>",
  "    <Outputs>",
  "      <OUT-001>Output.</OUT-001>",
  "    </Outputs>",
  "    <SideEffects>",
  "      <None />",
  "    </SideEffects>",
  "  </Contract>",
  "  <Codemap>",
  "<![CDATA[",
  "* `x` -> `y`",
  "]]>",
  "  </Codemap>",
  "</M-DEMO>",
].join("\n");

const verificationNode = [
  "<!-- parents: @.frostline/m-demo.xml -->",
  "<V-M-DEMO>",
  "  <Command>deno test --allow-all tests/core/m-demo.test.ts</Command>",
  "  <TestFiles>",
  "    <File>tests/core/m-demo.test.ts</File>",
  "  </TestFiles>",
  "  <Scenarios>",
  '    <SCN-001 target="M-DEMO.REQ-001">one holds.</SCN-001>',
  "  </Scenarios>",
  "</V-M-DEMO>",
].join("\n");

Deno.test("tier field matrix is the canonical knowledge contract", () => {
  assertEquals(tierFields.project, [
    "Purpose",
    "Scope",
    "Principles",
    "Technology",
    "Codemap",
  ]);
  assertEquals(tierFields.system, tierFields.subsystem);
  assertEquals(tierFields.system, [
    "Purpose",
    "Scope",
    "Principles",
    "Requirements",
    "Codemap",
  ]);
  assertEquals(tierFields.module, [
    "Purpose",
    "Scope",
    "Requirements",
    "Contract",
    "Codemap",
  ]);
  assertEquals(tierFields.verification, [
    "Command",
    "TestFiles",
    "Scenarios",
  ]);
});

Deno.test("statement prefix registry is closed", () => {
  assertEquals([...statementPrefixes], [
    "SCP-IN",
    "SCP-OUT",
    "PRIN",
    "TECH",
    "REQ",
    "IN",
    "OUT",
    "EFF",
    "SCN",
  ]);
});

Deno.test("schema accepts canonical nodes of each tier", () => {
  for (const content of [projectNode, moduleNode, verificationNode]) {
    const validation = validateKnowledge(content);
    assertEquals(validation, { valid: true, errors: [] });
  }
});

Deno.test("schema accepts EFF side effects and validates FQID form", () => {
  const withEffects = moduleNode.replace(
    "      <None />",
    "      <EFF-001>Writes cache.</EFF-001>",
  );
  assertEquals(validateKnowledge(withEffects).valid, true);
  assertEquals(isFqid("M-DEMO.REQ-001"), true);
  assertEquals(isFqid("M-DEMO"), false);
  assertEquals(isFqid("M-DEMO."), false);
  assertEquals(isFqid("unknown.REQ-001"), false);
  assertEquals(isFqid("M-DEMO.REQ-12"), false);
});

for (
  const [name, transform] of [
    ["unknown root tier", () => projectNode.replace("P-DEMO", "X-DEMO")],
    [
      "field outside the tier matrix",
      () =>
        moduleNode.replace(
          "<M-DEMO>",
          "<M-DEMO>\n  <Technology>\n    <TECH-001>x</TECH-001>\n  </Technology>",
        ),
    ],
    [
      "unknown field",
      () => moduleNode.replace("<M-DEMO>", "<M-DEMO>\n  <Roadmap>x</Roadmap>"),
    ],
    [
      "duplicate field",
      () => moduleNode.replace("<M-DEMO>", "<M-DEMO>\n  <Purpose>x</Purpose>"),
    ],
    [
      "unregistered statement prefix",
      () =>
        moduleNode.replace(
          "<REQ-001>One.</REQ-001>",
          "<ROADMAP-001>One.</ROADMAP-001>",
        ),
    ],
    [
      "non-three-digit statement number",
      () =>
        moduleNode.replace("<REQ-001>One.</REQ-001>", "<REQ-12>One.</REQ-12>"),
    ],
    [
      "broken incremental numbering",
      () =>
        moduleNode.replace(
          "<REQ-001>One.</REQ-001>",
          "<REQ-002>One.</REQ-002>",
        ),
    ],
    [
      "Purpose with child elements",
      () =>
        moduleNode.replace(
          "<Purpose>Demo module.</Purpose>",
          "<Purpose>Demo <b>module</b>.</Purpose>",
        ),
    ],
    [
      "empty Purpose",
      () =>
        moduleNode.replace(
          "<Purpose>Demo module.</Purpose>",
          "<Purpose>  </Purpose>",
        ),
    ],
    [
      "Codemap without CDATA",
      () => moduleNode.replace("<![CDATA[\n* `x` -> `y`\n]]>", "* `x` -> `y`"),
    ],
    [
      "Codemap content outside CDATA",
      () =>
        moduleNode.replace(
          "  <Codemap>\n<![CDATA[",
          "  <Codemap>\n    prose\n<![CDATA[",
        ),
    ],
    [
      "SCN without target",
      () => verificationNode.replace(' target="M-DEMO.REQ-001"', ""),
    ],
    [
      "SCN target not an FQID",
      () =>
        verificationNode.replace('target="M-DEMO.REQ-001"', 'target="M-DEMO"'),
    ],
    [
      "SideEffects without None or EFF",
      () => moduleNode.replace("      <None />", "      <File>x</File>"),
    ],
  ] as const
) {
  Deno.test(`knowledge schema rejects ${name}`, () => {
    const validation = validateKnowledge(transform());
    assertEquals(validation.valid, false);
  });
}

// REQ-012 dogfooding: the repository's own docs are a live knowledge graph.

function docsFiles(): string[] {
  return fs.readdirSync(docsRoot).filter((value) => value.endsWith(".xml"))
    .sort();
}

interface DocNode {
  name: string;
  id: string;
  tier: ReturnType<typeof tierOf>;
  parents: string[];
  statements: Set<string>;
  files: string[];
  targets: string[];
}

function docNode(name: string, content: string): DocNode {
  const id = name.replace(/\.xml$/, "").toUpperCase();
  const parsed = parse(readLeadingArea(path.join(docsRoot, name)), name);
  assertEquals(parsed.diagnostics, []);
  const parents = parsed.declarations.flatMap((declaration) =>
    declaration.selectors.map((selector) => selector.raw.slice(1))
  );
  const statements = new Set<string>();
  const files: string[] = [];
  const targets: string[] = [];
  for (
    const match of content.matchAll(
      /<((?:SCP-IN|SCP-OUT|PRIN|TECH|REQ|IN|OUT|EFF|SCN)-\d{3})[ />]/g,
    )
  ) {
    statements.add(match[1]);
    if (match[1].startsWith("SCN-")) {
      const tag = content.slice(match.index);
      const target = /target="([^"]+)"/.exec(tag)?.[1];
      if (target !== undefined) targets.push(target);
    }
  }
  for (const match of content.matchAll(/<File>([^<]+)<\/File>/g)) {
    files.push(match[1].trim());
  }
  return { name, id, tier: tierOf(id), parents, statements, files, targets };
}

const nodes = docsFiles().map((name) => docNode(name, doc(name)));

Deno.test("every docs knowledge node satisfies the canonical schema", () => {
  const invalid: string[] = [];
  for (const name of docsFiles()) {
    const validation = validateKnowledge(doc(name));
    if (!validation.valid) {
      invalid.push(`${name}: ${validation.errors.join(" | ")}`);
    }
  }
  assertEquals(invalid, []);
});

Deno.test("node ID equals the uppercased file stem", () => {
  const mismatched = nodes.filter((node) =>
    node.name !== node.id.toLowerCase() + ".xml"
  );
  assertEquals(mismatched.map((node) => node.name), []);
});

Deno.test("the docs graph is a DAG with tier order M -> SS -> S -> P", () => {
  const rank: Record<string, number> = {
    module: 0,
    subsystem: 1,
    system: 2,
    project: 3,
  };
  const visited = new Map<string, 0 | 1 | 2>();
  let cyclic = "";
  const visit = (id: string): void => {
    const state = visited.get(id);
    if (state === 1) {
      cyclic = id;
      return;
    }
    if (state === 2) return;
    visited.set(id, 1);
    const node = nodes.find((value) => value.id === id);
    if (node !== undefined) {
      for (const parent of node.parents) {
        const parentId = path.basename(parent).replace(/\.xml$/, "")
          .toUpperCase();
        visit(parentId);
      }
    }
    visited.set(id, 2);
  };
  for (const node of nodes) visit(node.id);
  assertEquals(cyclic, "");

  const violations: string[] = [];
  for (const node of nodes) {
    for (const parent of node.parents) {
      const parentId = path.basename(parent).replace(/\.xml$/, "")
        .toUpperCase();
      const parentNode = nodes.find((value) => value.id === parentId);
      if (parentNode === undefined) {
        violations.push(`${node.name} -> missing ${parent}`);
        continue;
      }
      const childRank = node.tier === "verification"
        ? rank[tierOf(node.id.slice(2)) ?? ""]
        : rank[node.tier ?? ""];
      const parentRank = rank[parentNode.tier ?? ""];
      if (childRank === undefined || parentRank === undefined) continue;
      if (childRank > parentRank) {
        violations.push(
          `${node.name} -> ${parentNode.name} inverts tier order`,
        );
      }
    }
  }
  assertEquals(violations, []);
});

Deno.test("role mapping holds for declared parents", async () => {
  const tracked = new TextDecoder().decode(
    await new Deno.Command("git", { args: ["ls-files"], cwd: root }).output()
      .then((output) => output.stdout),
  ).split("\n").filter((value) => value.length > 0);
  const violations: string[] = [];
  for (const file of tracked) {
    if (!/\.(ts|rs|sh|md|json|toml|yml|yaml)$/.test(file)) continue;
    const absolute = path.join(root, file);
    if (!fs.existsSync(absolute)) continue;
    const parsed = parse(readLeadingArea(absolute), file);
    assertEquals(parsed.diagnostics, []);
    const parents = parsed.declarations.flatMap((declaration) =>
      declaration.selectors.map((selector) => selector.raw.slice(1))
    );
    for (const parent of parents) {
      const parentNode = nodes.find((value) =>
        value.name === path.basename(parent)
      );
      const tier = tierOf(parentNode?.id ?? "");
      if (
        file.startsWith("packages/") ||
        file.startsWith("integrations/codex/native/src/")
      ) {
        if (tier !== "module") violations.push(`${file} -> ${parent} (not M)`);
      } else if (
        file.startsWith("tests/") ||
        file.startsWith("packages/workflows/prompts/")
      ) {
        if (tier !== "verification") {
          violations.push(`${file} -> ${parent} (not V)`);
        }
      } else if (
        file.startsWith("integrations/") || file.startsWith("scripts/")
      ) {
        if (tier !== "module" && tier !== "subsystem" && tier !== "system") {
          violations.push(`${file} -> ${parent} (not M|SS|S)`);
        }
      } else if (file.startsWith(".frostline/")) {
        if (!parent.startsWith(".frostline/")) {
          violations.push(`${file} -> ${parent}`);
        }
      }
    }
  }
  assertEquals(violations, []);
});

Deno.test("every scenario target FQID resolves to an existing statement", () => {
  const unresolved: string[] = [];
  for (const node of nodes) {
    for (const target of node.targets) {
      const dot = target.indexOf(".");
      const nodeId = target.slice(0, dot);
      const statementId = target.slice(dot + 1);
      const targetNode = nodes.find((value) => value.id === nodeId);
      if (targetNode === undefined || !targetNode.statements.has(statementId)) {
        unresolved.push(`${node.name}: ${target}`);
      }
    }
  }
  assertEquals(unresolved, []);
});

Deno.test("every verification TestFiles entry exists", () => {
  const missing: string[] = [];
  for (const node of nodes) {
    for (const file of node.files) {
      if (!fs.existsSync(path.join(root, file))) {
        missing.push(`${node.name}: ${file}`);
      }
    }
  }
  assertEquals(missing, []);
});
