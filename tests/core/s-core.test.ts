// parents: @.frostline/graph/v-s-core.xml

import { assertEquals, assertStringIncludes } from "./assert.ts";
import { Project, tempDirectory } from "./fixtures.ts";
import * as fs from "node:fs";
import * as path from "node:path";
import { Frostline } from "../../packages/core/src/product.ts";
import { Engine } from "../../packages/core/src/runtime/engine.ts";

Deno.test("canonical subcommand help succeeds without required arguments", async () => {
  for (
    const command of ["ancestors", "graph", "reset-context", "reset-session"]
  ) {
    const output = await runCore(
      [command, "--help"],
      tempDirectory("cli-cache-"),
    );
    assertEquals(output.code, 0);
    assertStringIncludes(output.stdout, `Usage: fli ${command}`);
  }
});

Deno.test("read compatibility command is removed", async () => {
  const result = await runCore(["read", "--help"], tempDirectory("cli-cache-"));
  assertEquals(result.code, 2);
  assertStringIncludes(result.stderr, "unknown command: read");
});

Deno.test("unknown and missing-value options fail with usage status", async () => {
  const unknown = await runCore(
    ["graph", "--unknown"],
    tempDirectory("cli-cache-"),
  );
  assertEquals(unknown.code, 2);
  assertStringIncludes(unknown.stderr, "unknown option: --unknown");

  const missing = await runCore(
    ["ancestors", "--session", "--json"],
    tempDirectory("cli-cache-"),
  );
  assertEquals(missing.code, 2);
  assertStringIncludes(missing.stderr, "--session requires a value");

  const missingAnchor = await runCore(
    ["graph", "--root", "/tmp"],
    tempDirectory("cli-cache-"),
  );
  assertEquals(missingAnchor.code, 2);
  assertStringIncludes(missingAnchor.stderr, "exactly one FILE or DIR anchor");
});

Deno.test("ancestors accepts multiple files and singleton options reject duplicates", async () => {
  const project = Project.create();
  project.write("a.md", "# A\n");
  project.write("b.md", "# B\n");
  const multiple = await runCore([
    "ancestors",
    project.path("a.md"),
    project.path("b.md"),
    "--json",
  ], tempDirectory("cli-cache-"));
  assertEquals(multiple.code, 0);

  for (
    const [command, args, option] of [
      [
        "ancestors",
        [project.path("a.md"), "--session", "s", "--session", "s"],
        "--session",
      ],
      ["graph", [
        project.path("a.md"),
        "--root",
        project.root,
        "--root",
        project.root,
      ], "--root"],
      ["reset-session", ["--session", "a", "--session", "b"], "--session"],
      [
        "reset-context",
        ["--session", "s", "--context", "a", "--context", "b"],
        "--context",
      ],
    ] as const
  ) {
    const output = await runCore(
      [command, ...args],
      tempDirectory("cli-cache-"),
    );
    assertEquals(output.code, 2);
    assertStringIncludes(output.stderr, `${option} may be provided only once`);
  }
});

Deno.test("ancestors reads literal parents without a root or cwd hint", async () => {
  const project = Project.create();
  project.write("parent.md", "PARENT_MARKER\n");
  project.write("child.md", "<!-- parents: @parent.md -->\n# Child\n");
  const output = await runCore([
    "ancestors",
    project.path("child.md"),
  ], tempDirectory("cli-cache-"));
  assertEquals(output.code, 0);
  assertStringIncludes(output.stdout, "PARENT_MARKER");
});

Deno.test("ancestors requires session and context together", async () => {
  const project = Project.create();
  project.write("child.md", "# Child\n");
  for (const loneOption of ["--session", "--context"] as const) {
    const output = await runCore([
      "ancestors",
      project.path("child.md"),
      loneOption,
      "value",
    ], tempDirectory("cli-cache-"));
    assertEquals(output.code, 2);
    assertStringIncludes(
      output.stderr,
      "--session and --context must be provided together",
    );
  }
});

Deno.test("graph accepts a directory anchor without inserting it as a node or focus", async () => {
  const project = Project.create();
  project.write(".frostline/root.md", "# Root\n");
  project.write(
    "src/child.ts",
    "// parents: @.frostline/root.md\nexport {};\n",
  );
  const output = await runCore([
    "graph",
    project.root,
    "--json",
  ], tempDirectory("cli-cache-"));
  assertEquals(output.code, 0);
  const graph = JSON.parse(output.stdout);
  assertEquals(graph.root, project.root);
  assertEquals(graph.focus, undefined);
  assertEquals(graph.nodes.includes("."), false);
  assertEquals(
    graph.edges.some((edge: { child: string; parent: string }) =>
      edge.child === "src/child.ts" && edge.parent === ".frostline/root.md"
    ),
    true,
  );
});

Deno.test("ancestors and resets preserve Delivery semantics across CLI processes", async () => {
  const project = Project.create();
  const cache = tempDirectory("cli-cache-");
  project.write("parent.md", "PARENT_MARKER\n");
  project.write("child.md", "<!-- parents: @parent.md -->\n# Child\n");

  const ancestors = (context: string) =>
    runCore([
      "ancestors",
      project.path("child.md"),
      "--session",
      "session",
      "--context",
      context,
      "--json",
    ], cache);

  const firstMain = await ancestors("main");
  assertEquals(firstMain.code, 0);
  assertStringIncludes(firstMain.stdout, "PARENT_MARKER");
  const secondMain = await ancestors("main");
  assertEquals(JSON.parse(secondMain.stdout).context, "");

  const firstAgent = await ancestors("agent");
  assertStringIncludes(firstAgent.stdout, "PARENT_MARKER");

  const resetContext = await runCore([
    "reset-context",
    "--session",
    "session",
    "--context",
    "main",
    "--json",
  ], cache);
  assertEquals(resetContext.code, 0);
  assertStringIncludes((await ancestors("main")).stdout, "PARENT_MARKER");
  assertEquals(JSON.parse((await ancestors("agent")).stdout).context, "");

  const resetSession = await runCore([
    "reset-session",
    "--session",
    "session",
    "--json",
  ], cache);
  assertEquals(resetSession.code, 0);
  assertStringIncludes((await ancestors("main")).stdout, "PARENT_MARKER");
  assertStringIncludes((await ancestors("agent")).stdout, "PARENT_MARKER");
});

async function runCore(
  args: string[],
  cache: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const output = await new Deno.Command("deno", {
    args: ["run", "--allow-all", "packages/core/src/cli.ts", ...args],
    cwd: new URL("../../", import.meta.url).pathname,
    env: { ...Deno.env.toObject(), FLI_CACHE_DIR: cache },
    stdout: "piped",
    stderr: "piped",
  }).output();
  const decode = (value: Uint8Array) => new TextDecoder().decode(value);
  return {
    code: output.code,
    stdout: decode(output.stdout),
    stderr: decode(output.stderr),
  };
}

Deno.test("unwritable derived-state location cannot suppress required context", () => {
  const project = Project.create();
  project.write("parent.md", "PARENT_MARKER\n");
  const child = project.write(
    "child.md",
    "<!-- parents: @parent.md -->\n# Child\n",
  );
  const cacheParent = tempDirectory("broken-cache-");
  const cache = path.join(cacheParent, "cache-as-file");
  fs.writeFileSync(cache, "not a directory\n");
  const fli = new Frostline(cache);
  const output = fli.ancestors({
    files: [child],
    deliveryScope: { sessionId: "session", contextId: "main" },
  });
  assertStringIncludes(output.context, "PARENT_MARKER");
  assertEquals(output.diagnostics, []);
  assertEquals(output.stateWarnings.length, 1);
  assertStringIncludes(output.stateWarnings[0], "reinjecting safely");
});

Deno.test("unavailable file does not destroy an independent valid ancestry", () => {
  const project = Project.create();
  project.write("parent.md", "PARENT_MARKER\n");
  const valid = project.write(
    "valid.md",
    "<!-- parents: @parent.md -->\n# Valid\n",
  );
  const missing = project.path("missing.md");
  const output = new Engine(tempDirectory("failure-cache-")).process([
    missing,
    valid,
  ]);
  assertEquals(output.documents.map((document) => document.path), [
    project.path("parent.md"),
  ]);
  assertEquals(output.diagnostics.length, 1);
  assertEquals(output.diagnostics[0].kind, "actual-read");
});

Deno.test("invalid explicit graph root fails closed with a resolution diagnostic", () => {
  const project = Project.create();
  const anchor = project.write("a.md", "# Anchor\n");
  const missing = path.join(tempDirectory("failure-root-"), "missing");
  const output = new Engine(tempDirectory("failure-cache-")).graph({
    anchor,
    root: missing,
  });
  assertEquals(output.root, undefined);
  assertEquals(output.nodes, []);
  assertEquals(output.edges, []);
  assertEquals(output.diagnostics.length, 1);
  assertEquals(output.diagnostics[0].kind, "resolution");
});
