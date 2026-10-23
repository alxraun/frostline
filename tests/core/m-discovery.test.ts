// parents: @.frostline/graph/v-m-discovery.xml

import * as fs from "node:fs";
import * as path from "node:path";
import { assertEquals, assertStringIncludes } from "./assert.ts";
import { Frostline } from "../../packages/core/src/product.ts";
import { DeliveryStore } from "../../packages/core/src/runtime/delivery.ts";
import { loadState } from "../../packages/core/src/runtime/state.ts";
import { ContextDocument, Diagnostic } from "../../packages/core/src/types.ts";
import { Project, tempDirectory } from "./fixtures.ts";
import { Engine } from "../../packages/core/src/runtime/engine.ts";
import { ProjectIndex } from "../../packages/core/src/runtime/discovery.ts";
import { AncestryGraph } from "../../packages/core/src/runtime/graph.ts";

const repositoryRoot = path.resolve(
  new URL("../../", import.meta.url).pathname,
);

Deno.test("ancestry reflects changed, new, and removed child-owned parent links", () => {
  const project = Project.create();
  const cache = tempDirectory("fli-cache-");
  project.write("a.md", "A_MARKER\n");
  project.write("beta-parent.md", "BBB_MARKER\n");
  const child = project.write("child.md", "<!-- parents: @a.md -->\n# Child\n");
  const fli = new Frostline(cache);

  assertEquals(
    fli.ancestors({ files: [child] }).context.includes("A_MARKER"),
    true,
  );
  fs.writeFileSync(
    child,
    "<!-- parents: @beta-parent.md -->\n# Child changed\n",
  );
  const changed = fli.ancestors({ files: [child] }).context;
  assertEquals(changed.includes("BBB_MARKER"), true);
  assertEquals(changed.includes("A_MARKER"), false);

  const leaf = project.write("leaf.md", "# Leaf\n");
  assertEquals(fli.ancestors({ files: [leaf] }).context, "");
  const external = project.write("external.md", "EXTERNAL_MARKER\n");
  fs.writeFileSync(leaf, "<!-- parents: @external.md -->\n# Leaf\n");
  assertEquals(
    fli.ancestors({ files: [leaf] }).context.includes("EXTERNAL_MARKER"),
    true,
  );
  fs.rmSync(external);
  const removed = fli.ancestors({ files: [leaf] });
  assertEquals(removed.context, "");
  assertEquals(removed.diagnostics.length > 0, true);

  fs.writeFileSync(path.join(cache, "state.json"), "broken-json");
  const rebuilt = fli.ancestors({ files: [child] });
  assertEquals(rebuilt.context.includes("BBB_MARKER"), true);
  assertEquals(rebuilt.stateWarnings, []);
});

Deno.test("metadata cache invalidates when content changes with same size and mtime", () => {
  const project = Project.create();
  const cache = tempDirectory("fli-cache-");
  project.write("a.md", "A_MARKER\n");
  project.write("b.md", "B_MARKER\n");
  const child = project.write("child.md", "<!-- parents: @a.md -->\n# Child\n");
  const fli = new Frostline(cache);

  assertEquals(
    fli.ancestors({ files: [child] }).context.includes("A_MARKER"),
    true,
  );
  const before = fs.statSync(child);
  fs.writeFileSync(child, "<!-- parents: @b.md -->\n# Child\n");
  fs.utimesSync(child, before.atime, before.mtime);

  const changed = fli.ancestors({ files: [child] }).context;
  assertEquals(changed.includes("B_MARKER"), true);
  assertEquals(changed.includes("A_MARKER"), false);
});

Deno.test("delivery suppresses only unchanged documents in a reliable scope", () => {
  const cache = tempDirectory("fli-cache-");
  const store = new DeliveryStore(cache);
  const scope = { sessionId: "session", contextId: "main" };
  const document = (identity: string, content: string): ContextDocument => ({
    path: `/project/${identity}`,
    identity,
    content,
  });

  assertEquals(
    store.filter(scope, [document("a.md", "A")]).documents.length,
    1,
  );
  assertEquals(store.filter(scope, [document("a.md", "A")]).documents, []);
  assertEquals(store.filter(scope, [document("a.md", "A2")]).documents, [
    document("a.md", "A2"),
  ]);
});

Deno.test("context and session resets are isolated", () => {
  const cache = tempDirectory("fli-cache-");
  const project = Project.create();
  project.write("a.md", "A_MARKER\n");
  const child = project.write("child.md", "<!-- parents: @a.md -->\n# Child\n");
  const fli = new Frostline(cache);
  const main = { sessionId: "session", contextId: "main" };
  const sub = { sessionId: "session", contextId: "sub" };
  const other = { sessionId: "other", contextId: "main" };
  const ancestors = (scope: { sessionId: string; contextId: string }) =>
    fli.ancestors({ files: [child], deliveryScope: scope }).context;

  assertEquals(ancestors(main).includes("A_MARKER"), true);
  assertEquals(ancestors(main), "");
  assertEquals(ancestors(sub).includes("A_MARKER"), true);
  assertEquals(ancestors(other).includes("A_MARKER"), true);
  fli.resetContext(main);
  assertEquals(ancestors(main).includes("A_MARKER"), true);
  assertEquals(ancestors(sub), "");
  fli.resetSession("session");
  assertEquals(ancestors(sub).includes("A_MARKER"), true);
  assertEquals(ancestors(other), "");
});

Deno.test("concurrent state transactions preserve every writer", async () => {
  const cache = tempDirectory("fli-cache-");
  const workers = Array.from(
    { length: 12 },
    (_, index) =>
      new Deno.Command("deno", {
        args: [
          "run",
          "--allow-all",
          "tests/core/state-worker.ts",
          cache,
          String(index),
        ],
        cwd: repositoryRoot,
        stdout: "null",
        stderr: "piped",
      }).output(),
  );
  const outputs = await Promise.all(workers);
  for (const output of outputs) {
    assertEquals(output.code, 0, new TextDecoder().decode(output.stderr));
  }
  const state = loadState(cache);
  assertEquals(state !== undefined, true);
  for (let index = 0; index < 12; index += 1) {
    assertEquals(state?.projects[`worker-${index}`] !== undefined, true);
  }
});

Deno.test("stale derived-state lock with dead owner is recoverable", () => {
  const cache = tempDirectory("fli-cache-");
  const lock = path.join(cache, ".state.lock");
  fs.mkdirSync(lock);
  fs.writeFileSync(path.join(lock, "owner"), "2147483647\n");
  const store = new DeliveryStore(cache);
  const result = store.filter(
    { sessionId: "session", contextId: "main" },
    [{ path: "/project/a.md", identity: "a.md", content: "A" }],
  );
  assertEquals(result.documents.length, 1);
  assertEquals(result.warnings, []);
  assertEquals(fs.existsSync(lock), false);
});

Deno.test("structurally corrupt project cache is rejected and rebuilt", () => {
  const project = Project.create();
  const cache = tempDirectory("corrupt-cache-");
  project.write("parent.md", "PARENT_MARKER\n");
  const child = project.write(
    "child.md",
    "<!-- parents: @parent.md -->\n# Child\n",
  );
  const fli = new Frostline(cache);
  assertEquals(
    fli.ancestors({ files: [child] }).context.includes("PARENT_MARKER"),
    true,
  );

  fs.writeFileSync(
    path.join(cache, "state.json"),
    JSON.stringify({
      version: 1,
      projects: { [project.root]: "not-a-project-cache" },
      delivery: {},
    }),
  );

  const rebuilt = fli.ancestors({ files: [child] });
  assertEquals(rebuilt.context.includes("PARENT_MARKER"), true);
  assertEquals(rebuilt.diagnostics, []);
});

Deno.test("failed leading-source cache entry is retried instead of trusted", () => {
  const project = Project.create();
  const cache = tempDirectory("failed-source-cache-");
  project.write("parent.md", "PARENT_MARKER\n");
  const child = project.write(
    "child.md",
    "<!-- parents: @parent.md -->\n# Child\n",
  );
  const metadata = fs.lstatSync(child);
  fs.mkdirSync(cache, { recursive: true });
  fs.writeFileSync(
    path.join(cache, "state.json"),
    JSON.stringify({
      version: 1,
      projects: {
        [project.root]: {
          files: {
            "child.md": {
              size: Number(metadata.size),
              mtimeMs: metadata.mtimeMs,
              ctimeMs: metadata.ctimeMs,
              ino: Number(metadata.ino),
              symlink: false,
              leadingSource: null,
            },
          },
        },
      },
      delivery: {},
    }),
  );

  const output = new Frostline(cache).ancestors({ files: [child] });
  assertEquals(output.context.includes("PARENT_MARKER"), true);
  assertEquals(output.diagnostics, []);
});

Deno.test("structurally corrupt delivery cache becomes unseen history", () => {
  const cache = tempDirectory("corrupt-cache-");
  fs.mkdirSync(cache, { recursive: true });
  fs.writeFileSync(
    path.join(cache, "state.json"),
    JSON.stringify({
      version: 1,
      projects: {},
      delivery: { session: "not-a-context-map" },
    }),
  );
  const store = new DeliveryStore(cache);
  const document = { path: "/project/a.md", identity: "a.md", content: "A" };
  const result = store.filter({ sessionId: "session", contextId: "main" }, [
    document,
  ]);
  assertEquals(result.documents, [document]);
  assertEquals(result.warnings, []);
});

Deno.test("cache directory above a graph scope does not exclude its files", () => {
  const workspace = tempDirectory("cache-ancestor-");
  const project = path.join(workspace, "project");
  fs.mkdirSync(path.join(project, ".git"), { recursive: true });
  fs.writeFileSync(
    path.join(project, ".git", "HEAD"),
    "ref: refs/heads/main\n",
  );
  const parent = path.join(project, "parent.md");
  fs.writeFileSync(parent, "PARENT_MARKER\n");
  const child = path.join(project, "child.md");
  fs.writeFileSync(child, "<!-- parents: @parent.md -->\n# Child\n");
  const output = new Engine(workspace).process([child]);
  assertEquals(output.diagnostics, []);
  assertEquals(output.documents.map((document) => document.path), [parent]);
});

Deno.test("nested cache subtree is excluded without hiding sibling files", () => {
  const project = tempDirectory("cache-nested-project-");
  fs.mkdirSync(path.join(project, ".git"), { recursive: true });
  fs.writeFileSync(
    path.join(project, ".git", "HEAD"),
    "ref: refs/heads/main\n",
  );
  const parent = path.join(project, "parent.md");
  fs.writeFileSync(parent, "PARENT_MARKER\n");
  const child = path.join(project, "child.md");
  fs.writeFileSync(child, "<!-- parents: @parent.md -->\n# Child\n");
  const cache = path.join(project, ".frostline-test-cache");
  const engine = new Engine(cache);
  const ancestors = engine.process([child]);
  const graph = engine.graph({ anchor: project });
  assertEquals(ancestors.documents.map((document) => document.path), [parent]);
  assertEquals(
    graph.nodes.some((node) => node.startsWith(".frostline-test-cache/")),
    false,
  );
});

Deno.test("discovery traversal failure is explicit instead of silently truncating the graph", () => {
  const workspace = tempDirectory("discovery-traversal-");
  const notDirectory = path.join(workspace, "not-a-directory");
  fs.writeFileSync(notDirectory, "plain file\n");

  const index = ProjectIndex.scan(
    notDirectory,
    tempDirectory("discovery-traversal-cache-"),
  );
  const diagnostics: Diagnostic[] = [];
  index.discover([], new AncestryGraph(), diagnostics);

  assertEquals(diagnostics.length, 1);
  assertEquals(diagnostics[0].kind, "resolution");
  assertEquals(diagnostics[0].path, notDirectory);
  assertStringIncludes(
    diagnostics[0].message,
    "cannot traverse discovery directory",
  );
});
