// parents: @.frostline/graph/v-m-graph.xml

import * as fs from "node:fs";
import { assertEquals, assertStringIncludes } from "./assert.ts";
import { Engine } from "../../packages/core/src/runtime/engine.ts";
import { Project, tempDirectory } from "./fixtures.ts";
import { AncestryGraph } from "../../packages/core/src/runtime/graph.ts";

Deno.test("graph exposes participating files only and focus", () => {
  const project = Project.create();
  project.write("parent.md", "# Parent\n");
  const child = project.write(
    "child.md",
    "<!-- parents: @parent.md -->\n# Child\n",
  );
  project.write("other.rs", "// unrelated source file\n");
  project.write("scratch.tmp", "temporary scratch\n");
  project.write("nvim.log", "log line\n");
  const output = new Engine(tempDirectory("fli-cache-")).graph({
    anchor: child,
  });
  assertEquals(output.nodes, ["child.md", "parent.md"]);
  assertEquals(output.edges, [{ child: "child.md", parent: "parent.md" }]);
  assertEquals(output.focus, "child.md");
  assertEquals(output.diagnostics, []);
});

Deno.test("focus on non-participating file does not create a graph node", () => {
  const project = Project.create();
  project.write("parent.md", "# Parent\n");
  project.write("child.md", "<!-- parents: @parent.md -->\n# Child\n");
  const scratch = project.write("scratch.tmp", "temporary scratch\n");
  const output = new Engine(tempDirectory("fli-cache-")).graph({
    anchor: scratch,
  });
  assertEquals(output.nodes, ["child.md", "parent.md"]);
  assertEquals(output.edges, [{ child: "child.md", parent: "parent.md" }]);
  assertEquals(output.focus, "scratch.tmp");
  assertEquals(output.diagnostics, []);
});

Deno.test("parent target without declaration participates with directory anchor", () => {
  const project = Project.create();
  project.write("parent.md", "# Parent\n");
  project.write("child.md", "<!-- parents: @parent.md -->\n# Child\n");
  const output = new Engine(tempDirectory("fli-cache-")).graph({
    anchor: project.root,
  });
  assertEquals(output.nodes, ["child.md", "parent.md"]);
  assertEquals(output.edges, [{ child: "child.md", parent: "parent.md" }]);
  assertEquals(output.focus, undefined);
});

Deno.test("explicitly referenced ignored file participates", () => {
  const project = Project.create();
  project.write(".gitignore", "ignored.md\n");
  project.write("ignored.md", "<!-- parents: @kept.md -->\n# Ignored\n");
  project.write("kept.md", "# Kept\n");
  const output = new Engine(tempDirectory("fli-cache-")).graph({
    anchor: project.root,
  });
  assertEquals(output.nodes, ["ignored.md", "kept.md"]);
  assertEquals(output.edges, [{ child: "ignored.md", parent: "kept.md" }]);
  assertEquals(output.diagnostics, []);
});

Deno.test("graph canonical ordering is locale independent", () => {
  const project = Project.create();
  project.write("root.md", "# Root\n");
  project.write("ä.md", "<!-- parents: @root.md -->\n# Umlaut\n");
  project.write("a.md", "<!-- parents: @root.md -->\n# Lower\n");
  project.write("B.md", "<!-- parents: @root.md -->\n# Upper\n");
  const output = new Engine(tempDirectory("fli-cache-")).graph({
    anchor: project.root,
  });
  assertEquals(output.nodes, ["B.md", "a.md", "root.md", "ä.md"]);
  assertEquals(output.diagnostics, []);
});

Deno.test("graph never infers edges from legacy children declarations", () => {
  const project = Project.create();
  project.write("parent.md", "<!-- children: @src/a.rs -->\n# Parent\n");
  project.write("src/a.rs", "fn a() {}\n");
  const output = new Engine(tempDirectory("fli-cache-")).graph({
    anchor: project.root,
  });
  assertEquals(output.edges, []);
  assertEquals(output.nodes, []);
  assertEquals(output.diagnostics.some((item) => item.kind === "syntax"), true);
});

Deno.test("graph reports cycles without losing the snapshot", () => {
  const project = Project.create();
  project.write("a.md", "<!-- parents: @b.md -->\n# A\n");
  project.write("b.md", "<!-- parents: @a.md -->\n# B\n");
  const output = new Engine(tempDirectory("fli-cache-")).graph({
    anchor: project.root,
  });
  assertEquals(output.nodes.length, 2);
  assertEquals(output.edges.length, 2);
  assertEquals(
    output.diagnostics.some((value) =>
      value.message.includes("semantic ancestry cycle")
    ),
    true,
  );
});

Deno.test("canonical knowledge nodes form a parseable resolvable acyclic graph", () => {
  const root = new URL("../../.frostline/", import.meta.url).pathname;
  const documents: string[] = [];
  for (const entry of fs.readdirSync(root, { recursive: true })) {
    const value = `${root}${entry}`;
    if (fs.statSync(value).isFile() && value.endsWith(".md")) {
      documents.push(value);
    }
  }
  documents.sort();
  const output = new Engine(tempDirectory("fli-cache-")).process(documents);
  assertEquals(output.diagnostics, []);
  assertEquals(output.documents, []);
});

Deno.test("acceptance: only declared participants form the graph", () => {
  const project = Project.create();
  project.write(
    "src/a.ts",
    "// parents: @.frostline/root.md\nexport const a = 1;\n",
  );
  project.write(".frostline/root.md", "# Root\n");
  project.write("scratch.tmp", "temporary scratch\n");
  project.write("nvim.log", "log line\n");
  const output = new Engine(tempDirectory("fli-cache-")).graph({
    anchor: project.root,
  });
  assertEquals(output.nodes, [".frostline/root.md", "src/a.ts"]);
  assertEquals(output.edges, [{
    child: "src/a.ts",
    parent: ".frostline/root.md",
  }]);
  assertEquals(output.diagnostics, []);
});

Deno.test("graph JSON is stable across one-shot processes", async () => {
  const project = Project.create();
  project.write("parent.md", "# Parent\n");
  const child = project.write(
    "child.md",
    "<!-- parents: @parent.md -->\n# Child\n",
  );
  const cache = tempDirectory("fli-cache-");
  const run = async () =>
    (await runCore(["graph", child, "--json"], cache)).stdout;
  const first = await run();
  const second = await run();
  assertEquals(first, second);
  assertStringIncludes(first, '"focus":"child.md"');
  assertStringIncludes(first, '{"child":"child.md","parent":"parent.md"}');
});

async function runCore(
  args: string[],
  cache: string,
): Promise<{ stdout: string; stderr: string }> {
  const command = new Deno.Command("deno", {
    args: [
      "run",
      "--allow-all",
      new URL("../../packages/core/src/cli.ts", import.meta.url).pathname,
      ...args,
    ],
    env: { ...Deno.env.toObject(), FLI_CACHE_DIR: cache },
    stdout: "piped",
    stderr: "piped",
  });
  const output = await command.output();
  const decode = (value: Uint8Array) => new TextDecoder().decode(value);
  if (!output.success) throw new Error(decode(output.stderr));
  return { stdout: decode(output.stdout), stderr: decode(output.stderr) };
}

Deno.test("very deep acyclic ancestry is stack-safe and dependency-first", () => {
  const graph = new AncestryGraph();
  const depth = 20_000;
  for (let node = 0; node <= depth; node += 1) {
    graph.addNode(`n${node}`);
    if (node > 0) graph.addEdge(`n${node}`, `n${node - 1}`, 0);
  }

  const output = graph.orderedAncestors([`n${depth}`]);

  assertEquals(output.diagnostics, []);
  assertEquals(output.ordered.length, depth);
  assertEquals(output.ordered[0], "n0");
  assertEquals(output.ordered[depth - 1], `n${depth - 1}`);
});

Deno.test("large strongly connected component is diagnosed without call-stack dependence", () => {
  const graph = new AncestryGraph();
  const size = 5_000;
  for (let node = 0; node < size; node += 1) {
    graph.addEdge(`n${node}`, `n${(node + 1) % size}`, 0);
  }
  graph.addNode("read");
  graph.addEdge("read", "n0", 0);
  graph.addEdge("read", "valid", 1);

  const output = graph.orderedAncestors(["read"]);

  assertEquals(output.diagnostics.length, 1);
  assertEquals(output.ordered, ["valid"]);
});
