// parents: @.frostline/graph/v-m-resolution.xml

import * as fs from "node:fs";
import * as path from "node:path";
import { assertEquals, assertStringIncludes } from "./assert.ts";
import { Engine } from "../../packages/core/src/runtime/engine.ts";
import { Project, tempDirectory } from "./fixtures.ts";
import { Frostline } from "../../packages/core/src/product.ts";
import { loadState } from "../../packages/core/src/runtime/state.ts";

function identities(output: { documents: Array<{ path: string }> }): string[] {
  return output.documents.map((document) => document.path);
}

Deno.test("Git worktree .git file does not block rootless parent Resolution", () => {
  const root = tempDirectory("worktree-");
  fs.writeFileSync(path.join(root, ".git"), "gitdir: /tmp/example-git-dir\n");
  const parent = path.join(root, "parent.md");
  fs.writeFileSync(parent, "PARENT\n");
  const child = path.join(root, "child.md");
  fs.writeFileSync(child, "<!-- parents: @parent.md -->\n# Child\n");
  const output = new Engine(tempDirectory("cache-")).process([child]);
  assertEquals(output.diagnostics, []);
  assertEquals(identities(output), [parent]);
});

Deno.test("actual file observations inside .git are rejected", () => {
  const project = Project.create();
  const internal = project.path(".git/PP_TEST.md");
  fs.writeFileSync(internal, "# Internal\n");
  const output = new Engine(tempDirectory("cache-")).process([internal]);
  assertEquals(output.documents, []);
  assertEquals(output.diagnostics.length, 1);
  assertEquals(output.diagnostics[0].kind, "actual-read");
  assertStringIncludes(output.diagnostics[0].message, ".git");
});

Deno.test("unrelated cwd does not influence an absolute observed file", () => {
  const project = Project.create();
  const parent = project.write("parent.md", "PARENT\n");
  const child = project.write(
    "child.md",
    "<!-- parents: @parent.md -->\n# Child\n",
  );
  const output = new Engine(tempDirectory("cache-")).process([child]);
  assertEquals(output.diagnostics, []);
  assertEquals(identities(output), [parent]);
});

Deno.test("empty .git directory does not stop parent Resolution", () => {
  const workspace = tempDirectory("workspace-");
  const nested = path.join(workspace, "nested");
  fs.mkdirSync(path.join(nested, ".git"), { recursive: true });
  const parent = path.join(workspace, "parent.md");
  fs.writeFileSync(parent, "PARENT\n");
  const child = path.join(nested, "child.md");
  fs.writeFileSync(child, "<!-- parents: @parent.md -->\n# Child\n");
  const output = new Engine(tempDirectory("cache-")).process([child]);
  assertEquals(output.diagnostics, []);
  assertEquals(identities(output), [parent]);
});

for (
  const [name, selector] of [
    ["absolute selector", "@/tmp/outside.md"],
    ["parent traversal selector", "@a/../parent.md"],
    ["Git target selector", "@.git/HEAD"],
  ] as const
) {
  Deno.test(`${name} is rejected`, () => {
    const project = Project.create();
    project.write("parent.md", "PARENT\n");
    const child = project.write(
      "child.md",
      `<!-- parents: ${selector} -->\n# Child\n`,
    );
    const output = new Engine(tempDirectory("cache-")).process([child]);
    assertEquals(output.documents, []);
    assertEquals(output.diagnostics.length, 1);
    assertEquals(output.diagnostics[0].kind, "resolution");
    assertStringIncludes(output.diagnostics[0].message, "invalid");
  });
}

Deno.test("symlink traversal through an intermediate directory is rejected", () => {
  const project = Project.create();
  const outside = tempDirectory("outside-");
  fs.writeFileSync(path.join(outside, "parent.md"), "OUTSIDE\n");
  fs.symlinkSync(outside, project.path("linked"));
  const child = project.write(
    "child.md",
    "<!-- parents: @linked/parent.md -->\n# Child\n",
  );
  const output = new Engine(tempDirectory("cache-")).process([child]);
  assertEquals(output.documents, []);
  assertEquals(output.diagnostics.length > 0, true);
  assertEquals(
    output.diagnostics.some((item) => item.message.includes("symlink")),
    true,
  );
});

for (
  const [name, selector] of [
    ["recursive star", "@src/**/*.ts"],
    ["segment star", "@src/*.ts"],
    ["single-character wildcard", "@src/?.ts"],
    ["brace alternatives", "@src/{a,b}.ts"],
    ["brace glob alternatives", "@src/{*.js,a.ts}"],
    ["character class", "@src/[ab].ts"],
    ["negated character class", "@src/[!b].ts"],
    ["character range", "@src/[a-b].ts"],
    ["leading recursive star", "@**/b.ts"],
    ["trailing escape", "@src/file\\"],
    ["escaped metacharacter", "@src/literal\\*.ts"],
    ["escaped comma", "@comma\\,name.md"],
  ] as const
) {
  Deno.test(`${name} selector is rejected as one resolution diagnostic`, () => {
    const project = Project.create();
    project.write("src/a.ts", "export const a = 1;\n");
    const child = project.write(
      "child.md",
      `<!-- parents: ${selector} -->\n# Child\n`,
    );

    const output = new Engine(tempDirectory("selector-cache-")).process([
      child,
    ]);

    assertEquals(output.documents, []);
    assertEquals(output.diagnostics.length, 1);
    assertEquals(output.diagnostics[0].kind, "resolution");
    assertStringIncludes(output.diagnostics[0].message, "invalid: ");
  });
}

Deno.test("empty glob match is rejected as one resolution diagnostic", () => {
  const project = Project.create();
  const child = project.write(
    "child.md",
    "<!-- parents: @src/**/*.ts -->\n# Child\n",
  );
  const output = new Engine(tempDirectory("selector-cache-")).process([child]);
  assertEquals(output.documents, []);
  assertEquals(output.diagnostics.length, 1);
  assertEquals(output.diagnostics[0].kind, "resolution");
});

Deno.test("literal selector with glob-like characters in filenames stays literal", () => {
  const project = Project.create();
  project.write("src/literal*.ts", "STAR\n");
  const child = project.write(
    "child.md",
    "<!-- parents: @src/literal*.ts -->\n# Child\n",
  );

  const output = new Engine(tempDirectory("selector-cache-")).process([child]);

  // The selector itself contains glob metacharacters, so it is diagnosed
  // instead of being interpreted or matched literally.
  assertEquals(output.documents, []);
  assertEquals(output.diagnostics.length, 1);
  assertEquals(output.diagnostics[0].kind, "resolution");
});

Deno.test("literal selector resolves the same nearest target from nested directories", () => {
  const project = Project.create();
  project.write("parent.md", "ROOT_PARENT\n");
  project.write("nested/parent.md", "NESTED_PARENT\n");
  const nestedChild = project.write(
    "nested/child.md",
    "<!-- parents: @parent.md -->\n# Nested Child\n",
  );
  const rootChild = project.write(
    "child.md",
    "<!-- parents: @parent.md -->\n# Root Child\n",
  );

  const engine = new Engine(tempDirectory("selector-cache-"));
  const nested = engine.process([nestedChild]);
  const root = engine.process([rootChild]);

  assertEquals(nested.diagnostics, []);
  assertEquals(nested.documents.map((document) => document.path), [
    project.path("nested/parent.md"),
  ]);
  assertEquals(root.diagnostics, []);
  assertEquals(root.documents.map((document) => document.path), [
    project.path("parent.md"),
  ]);
});

Deno.test("duplicate literal selectors collapse to one canonical edge/document", () => {
  const project = Project.create();
  project.write("parent.md", "PARENT\n");
  const child = project.write(
    "child.md",
    "<!-- parents: @parent.md, @parent.md -->\n# Child\n",
  );
  const output = new Engine(tempDirectory("selector-cache-")).process([child]);
  assertEquals(output.diagnostics, []);
  assertEquals(output.documents.map((document) => document.path), [
    project.path("parent.md"),
  ]);
});

const engine = () => new Engine(tempDirectory("local-first-cache-"));
const paths = (output: { documents: Array<{ path: string }> }) =>
  output.documents.map((document) => document.path);

Deno.test("literal parent resolves at nearest containing ancestor directory", () => {
  const project = Project.create();
  project.write("parent.md", "ROOT_PARENT\n");
  project.write("nested/parent.md", "NEAR_PARENT\n");
  const mid = project.write("nested/mid/parent.md", "MID_PARENT\n");
  const child = project.write(
    "nested/mid/deep/child.md",
    "<!-- parents: @parent.md -->\n# Child\n",
  );
  const output = engine().process([child]);
  assertEquals(output.diagnostics, []);
  assertEquals(paths(output), [mid]);
});

Deno.test("literal parent ascends from deep child to graph scope root", () => {
  const project = Project.create();
  const parent = project.write("parent.md", "ROOT_PARENT\n");
  const child = project.write(
    "nested/deep/child.md",
    "<!-- parents: @parent.md -->\n# Child\n",
  );
  const output = engine().process([child]);
  assertEquals(output.diagnostics, []);
  assertEquals(paths(output), [parent]);
});

Deno.test("literal ancestry may escape Git and FLI markers without expanding discovery", () => {
  const workspace = tempDirectory("local-first-boundary-");
  const project = path.join(workspace, "project");
  fs.mkdirSync(path.join(project, ".git"), { recursive: true });
  fs.writeFileSync(
    path.join(project, ".git", "HEAD"),
    "ref: refs/heads/main\n",
  );
  fs.mkdirSync(path.join(project, ".frostline"));
  const outside = path.join(workspace, "outside.md");
  fs.writeFileSync(outside, "OUTSIDE\n");
  const child = path.join(project, "child.md");
  fs.writeFileSync(child, "<!-- parents: @outside.md -->\n# Child\n");
  const output = engine().process([child]);
  assertEquals(output.diagnostics, []);
  assertEquals(paths(output), [outside]);
});

Deno.test("glob parents are rejected without expanding candidates", () => {
  const project = Project.create();
  const child = project.write("child.ts", "// parents: @**/*.md\nexport {};\n");
  project.write("parent.md", "PARENT\n");
  const output = engine().process([child]);
  assertEquals(output.documents, []);
  assertEquals(output.diagnostics.length, 1);
  assertEquals(output.diagnostics[0].kind, "resolution");
  assertStringIncludes(output.diagnostics[0].message, "glob");
});

Deno.test("unsupported children declaration creates neither context nor reverse edges", () => {
  const project = Project.create();
  const legacy = project.write(
    "parent.md",
    "<!-- children: @child.md -->\n# Parent\n",
  );
  const child = project.write("child.md", "# Child\n");
  assertEquals(engine().process([child]).documents, []);
  const direct = engine().process([legacy]);
  assertEquals(direct.documents, []);
  assertEquals(direct.diagnostics.length, 1);
  assertEquals(direct.diagnostics[0].kind, "syntax");
});

Deno.test("batch of files from different trees has independent absolute identities", () => {
  const first = Project.create();
  const second = Project.create();
  const firstParent = first.write("parent.md", "FIRST_PARENT\n");
  const secondParent = second.write("parent.md", "SECOND_PARENT\n");
  const firstChild = first.write(
    "child.md",
    "<!-- parents: @parent.md -->\n# Child\n",
  );
  const secondChild = second.write(
    "child.md",
    "<!-- parents: @parent.md -->\n# Child\n",
  );
  const output = engine().process([firstChild, secondChild]);
  assertEquals(output.diagnostics, []);
  assertEquals(paths(output), [firstParent, secondParent]);
  assertEquals(
    new Set(output.documents.map((document) => document.identity)).size,
    2,
  );
});

Deno.test("one DeliveryScope handles A, B, A without cross-tree suppression", () => {
  const first = Project.create();
  const second = Project.create();
  first.write("parent.md", "FIRST_PARENT\n");
  second.write("parent.md", "SECOND_PARENT\n");
  const firstChild = first.write(
    "child.md",
    "<!-- parents: @parent.md -->\n# Child\n",
  );
  const secondChild = second.write(
    "child.md",
    "<!-- parents: @parent.md -->\n# Child\n",
  );
  const fli = new Frostline(tempDirectory("local-first-cache-"));
  const deliveryScope = { sessionId: "session", contextId: "main" };
  const ancestors = (file: string) =>
    fli.ancestors({ files: [file], deliveryScope });
  assertStringIncludes(ancestors(firstChild).context, "FIRST_PARENT");
  assertStringIncludes(ancestors(secondChild).context, "SECOND_PARENT");
  assertEquals(ancestors(firstChild).context, "");
  assertEquals(ancestors(secondChild).context, "");
});

const generatedDirectories = [
  "node_modules",
  "target",
  "dist",
  "build",
  ".cache",
  ".deno",
] as const;

for (const directory of generatedDirectories) {
  Deno.test(`literal selector cannot enter generated directory ${directory}`, () => {
    const project = Project.create();
    project.write(`${directory}/parent.md`, "GENERATED\n");
    const child = project.write(
      "child.md",
      `<!-- parents: @${directory}/parent.md -->\n# Child\n`,
    );
    const output = new Engine(tempDirectory("target-space-cache-")).process([
      child,
    ]);
    assertEquals(output.documents, []);
    assertEquals(output.diagnostics.length, 1);
    assertStringIncludes(output.diagnostics[0].message, "excluded target");
  });
}

Deno.test("glob selector is rejected rather than searching generated files", () => {
  const project = Project.create();
  project.write("dist/parent.md", "GENERATED\n");
  const child = project.write(
    "child.md",
    "<!-- parents: @**/parent.md -->\n# Child\n",
  );
  const output = new Engine(tempDirectory("target-space-cache-")).process([
    child,
  ]);
  assertEquals(output.documents, []);
  assertEquals(output.diagnostics.length, 1);
  assertStringIncludes(output.diagnostics[0].message, "glob");
});

Deno.test("reverse children declaration does not attach context to generated output", () => {
  const project = Project.create();
  project.write(
    "parent.md",
    "<!-- children: @dist/output.js -->\nPARENT_SHOULD_NOT_INJECT\n",
  );
  const generated = project.write("dist/output.js", "generated();\n");
  const output = new Engine(tempDirectory("target-space-cache-")).process([
    generated,
  ]);
  assertEquals(output.documents, []);
  assertEquals(output.diagnostics, []);
});

Deno.test("graph snapshot excludes generated directory contents", () => {
  const project = Project.create();
  project.write("anchor.md", "# Anchor\n");
  project.write("source.md", "<!-- parents: @anchor.md -->\n# Source\n");
  project.write(
    "build/generated.md",
    "<!-- parents: @anchor.md -->\n# Generated\n",
  );
  const output = new Engine(tempDirectory("target-space-cache-")).graph({
    anchor: project.root,
  });
  assertEquals(output.diagnostics, []);
  assertEquals(output.nodes, ["anchor.md", "source.md"]);
  assertEquals(output.nodes.includes("build/generated.md"), false);
});

Deno.test("ordinary file named build is not treated as a generated directory", () => {
  const project = Project.create();
  const parent = project.write("build", "ORDINARY_FILE\n");
  const child = project.write(
    "child.md",
    "<!-- parents: @build -->\n# Child\n",
  );
  const output = new Engine(tempDirectory("target-space-cache-")).process([
    child,
  ]);
  assertEquals(output.diagnostics, []);
  assertEquals(output.documents.map((document) => document.path), [parent]);
});

Deno.test("derived-state lock subtree cannot become context when cache equals graph root", () => {
  const project = Project.create();
  const lock = project.path(".state.lock");
  fs.mkdirSync(lock);
  fs.writeFileSync(path.join(lock, "owner"), "123\n");
  const child = project.write(
    "child.md",
    "<!-- parents: @.state.lock/owner -->\n# Child\n",
  );
  const output = new Engine(project.root).process([child]);
  assertEquals(output.documents, []);
  assertEquals(output.diagnostics.length, 1);
  assertStringIncludes(output.diagnostics[0].message, "excluded target");
});

Deno.test("self-loop is diagnosed as a semantic ancestry cycle", () => {
  const project = Project.create();
  const self = project.write("self.md", "<!-- parents: @self.md -->\n# Self\n");
  const output = new Engine(tempDirectory("graph-boundary-cache-")).process([
    self,
  ]);
  assertEquals(output.documents, []);
  assertEquals(output.diagnostics.length, 1);
  assertEquals(output.diagnostics[0].kind, "graph");
  assertStringIncludes(
    output.diagnostics[0].message,
    "semantic ancestry cycle",
  );
});

Deno.test("multiple disjoint cycles produce deterministic independent diagnostics", () => {
  const project = Project.create();
  project.write("a.md", "<!-- parents: @b.md -->\n# A\n");
  project.write("b.md", "<!-- parents: @a.md -->\n# B\n");
  project.write("c.md", "<!-- parents: @d.md -->\n# C\n");
  project.write("d.md", "<!-- parents: @c.md -->\n# D\n");
  const output = new Engine(tempDirectory("graph-boundary-cache-")).graph({
    anchor: project.root,
  });
  assertEquals(output.diagnostics.length, 2);
  assertEquals(
    output.diagnostics.every((value) => value.kind === "graph"),
    true,
  );
  assertEquals(output.nodes.length, 4);
  assertEquals(output.edges.length, 4);
});

Deno.test("nonexistent graph anchor fails before discovery", () => {
  const project = Project.create();
  project.write("parent.md", "# Parent\n");
  project.write("child.md", "<!-- parents: @parent.md -->\n# Child\n");
  const output = new Engine(tempDirectory("graph-boundary-cache-")).graph({
    anchor: project.path("missing.md"),
  });
  assertEquals(output.root, undefined);
  assertEquals(output.nodes, []);
  assertEquals(output.edges, []);
  assertEquals(output.diagnostics.length, 1);
  assertEquals(output.diagnostics[0].kind, "actual-read");
});

Deno.test("graph anchor outside explicit root fails closed", () => {
  const project = Project.create();
  project.write("anchor.md", "# Anchor\n");
  const outside = tempDirectory("graph-outside-");
  const outsideFile = path.join(outside, "outside.md");
  fs.writeFileSync(outsideFile, "# Outside\n");
  const output = new Engine(tempDirectory("graph-boundary-cache-")).graph({
    anchor: outsideFile,
    root: project.root,
  });
  assertEquals(output.root, undefined);
  assertEquals(output.nodes, []);
  assertEquals(output.diagnostics.length, 1);
  assertStringIncludes(
    output.diagnostics[0].message,
    "outside the explicit root",
  );
});

Deno.test("regular file cannot be used as explicit graph root", () => {
  const project = Project.create();
  const anchor = project.write("anchor.md", "# Anchor\n");
  const output = new Engine(tempDirectory("graph-boundary-cache-")).graph({
    anchor,
    root: anchor,
  });
  assertEquals(output.root, undefined);
  assertEquals(output.nodes, []);
  assertEquals(output.edges, []);
  assertEquals(output.diagnostics.length, 1);
  assertStringIncludes(output.diagnostics[0].message, "not a directory");
});

Deno.test(".git cannot be used as explicit graph root", () => {
  const project = Project.create();
  const anchor = project.write("anchor.md", "# Anchor\n");
  const output = new Engine(tempDirectory("graph-boundary-cache-")).graph({
    anchor,
    root: project.path(".git"),
  });
  assertEquals(output.root, undefined);
  assertEquals(output.diagnostics.length, 1);
  assertStringIncludes(output.diagnostics[0].message, ".git");
});

function withHome(body: (home: string) => void): void {
  const home = tempDirectory("fli-home-");
  const previous = process.env.HOME;
  process.env.HOME = home;
  try {
    body(home);
  } finally {
    if (previous === undefined) delete process.env.HOME;
    else process.env.HOME = previous;
  }
}

function writeChild(root: string, name = "child.md"): string {
  fs.mkdirSync(root, { recursive: true });
  const child = path.join(root, name);
  fs.writeFileSync(child, "<!-- parents: @parent.md -->\n# Child\n");
  return child;
}

function writeProject(root: string, marker: string): string {
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, "parent.md"), `${marker}\n`);
  return writeChild(root);
}

Deno.test("ancestors can resolve above nested Git and FLI boundaries to HOME", () => {
  withHome((home) => {
    fs.writeFileSync(path.join(home, "parent.md"), "HOME_PARENT\n");
    const project = path.join(home, "project");
    fs.mkdirSync(path.join(project, ".git"), { recursive: true });
    fs.writeFileSync(
      path.join(project, ".git", "HEAD"),
      "ref: refs/heads/main\n",
    );
    fs.mkdirSync(path.join(project, ".frostline"));
    const child = writeChild(project);
    const output = new Engine(tempDirectory("home-cache-")).process([child]);
    assertEquals(output.diagnostics, []);
    assertEquals(output.documents.map((document) => document.path), [
      path.join(home, "parent.md"),
    ]);
    assertStringIncludes(output.documents[0].content, "HOME_PARENT");
  });
});

Deno.test("ancestors outside HOME requires no Git, FLI or cwd root", () => {
  withHome(() => {
    const outside = tempDirectory("outside-home-");
    const child = writeProject(outside, "OUTSIDE_PARENT");
    const output = new Engine(tempDirectory("home-cache-")).process([child]);
    assertEquals(output.diagnostics, []);
    assertStringIncludes(output.documents[0].content, "OUTSIDE_PARENT");
  });
});

Deno.test("graph falls back to a child of HOME and never scans HOME itself", () => {
  withHome((home) => {
    const project = path.join(home, "project");
    const child = writeProject(project, "PROJECT_PARENT");
    const other = writeProject(path.join(home, "other"), "OTHER_PARENT");
    const homeFile = path.join(home, "unrelated.md");
    fs.writeFileSync(homeFile, "<!-- parents: @missing.md -->\n# Unrelated\n");
    const graph = new Engine(tempDirectory("home-cache-")).graph({
      anchor: child,
    });
    assertEquals(graph.root, project);
    assertEquals(graph.focus, "child.md");
    assertEquals(graph.nodes.includes("child.md"), true);
    assertEquals(graph.nodes.includes(other), false);
    assertEquals(graph.nodes.includes(homeFile), false);
    assertEquals(
      graph.diagnostics.some((item) => item.path === homeFile),
      false,
    );
  });
});

Deno.test("directory anchor in child of HOME has no focus", () => {
  withHome((home) => {
    const project = path.join(home, "project");
    writeProject(project, "PARENT");
    const graph = new Engine(tempDirectory("home-cache-")).graph({
      anchor: project,
    });
    assertEquals(graph.root, project);
    assertEquals(graph.focus, undefined);
    assertEquals(graph.nodes.includes("."), false);
  });
});

Deno.test("graph follows external HOME ancestor without scanning its siblings", () => {
  withHome((home) => {
    const project = path.join(home, "project");
    const child = writeChild(project);
    const parent = path.join(home, "parent.md");
    fs.writeFileSync(parent, "HOME_PARENT\n");
    const outside = path.join(home, "unrelated.md");
    fs.writeFileSync(outside, "<!-- parents: @nothing.md -->\nUNRELATED\n");
    const graph = new Engine(tempDirectory("home-cache-")).graph({
      anchor: child,
    });
    assertEquals(graph.nodes.includes(parent), true);
    assertEquals(
      graph.edges.some((edge) =>
        edge.child === "child.md" && edge.parent === parent
      ),
      true,
    );
    assertEquals(graph.nodes.includes(outside), false);
  });
});

Deno.test("two child-of-HOME scopes retain distinct file identities and DeliveryScope", () => {
  withHome((home) => {
    const first = writeProject(path.join(home, "project-a"), "FIRST_PARENT");
    const second = writeProject(path.join(home, "project-b"), "SECOND_PARENT");
    const engine = new Engine(tempDirectory("home-cache-"));
    const firstOutput = engine.process([first]);
    const secondOutput = engine.process([second]);
    assertEquals(
      firstOutput.documents[0].path,
      path.join(home, "project-a", "parent.md"),
    );
    assertEquals(
      secondOutput.documents[0].path,
      path.join(home, "project-b", "parent.md"),
    );
    assertEquals(
      firstOutput.documents[0].identity !== secondOutput.documents[0].identity,
      true,
    );
    const fli = new Frostline(tempDirectory("home-cache-"));
    const deliveryScope = { sessionId: "session", contextId: "main" };
    const ancestors = (file: string) =>
      fli.ancestors({ files: [file], deliveryScope });
    assertStringIncludes(ancestors(first).context, "FIRST_PARENT");
    assertStringIncludes(ancestors(second).context, "SECOND_PARENT");
    assertEquals(ancestors(first).context, "");
  });
});

Deno.test("nearest literal matching level shadows HOME", () => {
  withHome((home) => {
    fs.writeFileSync(path.join(home, "parent.md"), "HOME_PARENT\n");
    const project = path.join(home, "project");
    const child = writeProject(project, "NEAR_PARENT");
    const output = new Engine(tempDirectory("home-cache-")).process([child]);
    assertEquals(output.diagnostics, []);
    assertEquals(output.documents.map((document) => document.path), [
      path.join(project, "parent.md"),
    ]);
  });
});

Deno.test("graph cache stores declarations only in its finite scope", () => {
  withHome((home) => {
    const project = path.join(home, "cached");
    const child = writeProject(project, "PARENT");
    const unrelated = path.join(home, "unrelated.md");
    fs.writeFileSync(unrelated, "<!-- parents: @missing.md -->\nUNRELATED\n");
    const cache = tempDirectory("home-cache-");
    const engine = new Engine(cache);
    const graph = engine.graph({ anchor: child });
    assertEquals(graph.root, project);
    const state = loadState(cache);
    assertEquals(state?.projects[home], undefined);
    assertEquals(
      typeof state?.projects[project]?.files["child.md"]?.leadingSource,
      "string",
    );
  });
});

Deno.test("cache deletion cannot change rootless ancestry", () => {
  withHome((home) => {
    const child = writeProject(path.join(home, "project-a"), "FIRST_PARENT");
    const cache = tempDirectory("home-cache-");
    const engine = new Engine(cache);
    const before = engine.process([child]);
    fs.rmSync(cache, { recursive: true, force: true });
    const after = engine.process([child]);
    assertEquals(after.documents, before.documents);
    assertEquals(after.diagnostics, before.diagnostics);
  });
});

interface NoGitProject {
  root: string;
  child: string;
  parent: string;
}

function noGitProject(marker: string): NoGitProject {
  const root = tempDirectory("no-git-project-");
  const parent = path.join(root, "parent.md");
  fs.writeFileSync(parent, `${marker}\n`);
  const child = path.join(root, "child.md");
  fs.writeFileSync(child, "<!-- parents: @parent.md -->\n# Child\n");
  return { root, child, parent };
}

Deno.test("no-Git ancestors resolves literal parents without root or cwd hints", () => {
  const { child, parent } = noGitProject("NO_GIT_PARENT");
  const output = new Engine(tempDirectory("no-git-cache-")).process([child]);
  assertEquals(output.diagnostics, []);
  assertEquals(output.documents.map((document) => document.path), [parent]);
});

Deno.test("no-Git ancestors can follow a parent above the file's directory", () => {
  const workspace = tempDirectory("no-git-workspace-");
  const parent = path.join(workspace, "parent.md");
  fs.writeFileSync(parent, "OUTSIDE_PARENT\n");
  const nested = path.join(workspace, "nested");
  fs.mkdirSync(nested);
  const child = path.join(nested, "child.md");
  fs.writeFileSync(child, "<!-- parents: @parent.md -->\n# Child\n");
  const output = new Engine(tempDirectory("no-git-cache-")).process([child]);
  assertEquals(output.diagnostics, []);
  assertEquals(output.documents.map((document) => document.path), [parent]);
});

Deno.test("one session resolves two independent no-Git scopes", () => {
  const first = noGitProject("FIRST_PARENT");
  const second = noGitProject("SECOND_PARENT");
  const engine = new Engine(tempDirectory("no-git-cache-"));
  const firstOutput = engine.process([first.child]);
  const secondOutput = engine.process([second.child]);
  assertEquals(firstOutput.diagnostics, []);
  assertEquals(secondOutput.diagnostics, []);
  assertStringIncludes(firstOutput.documents[0].content, "FIRST_PARENT");
  assertStringIncludes(secondOutput.documents[0].content, "SECOND_PARENT");
  assertEquals(
    new Set([
      firstOutput.documents[0].identity,
      secondOutput.documents[0].identity,
    ]).size,
    2,
  );
});

Deno.test("one DeliveryScope handles no-Git A, B, A without collisions", () => {
  const first = noGitProject("FIRST_PARENT");
  const second = noGitProject("SECOND_PARENT");
  const fli = new Frostline(tempDirectory("no-git-cache-"));
  const deliveryScope = { sessionId: "session", contextId: "main" };
  const ancestors = (project: NoGitProject) =>
    fli.ancestors({ files: [project.child], deliveryScope });
  assertStringIncludes(ancestors(first).context, "FIRST_PARENT");
  assertStringIncludes(ancestors(second).context, "SECOND_PARENT");
  assertEquals(ancestors(first).context, "");
  assertEquals(ancestors(second).context, "");
});

Deno.test("same relative name in independent trees has unique absolute identity", () => {
  const first = noGitProject("FIRST_PARENT");
  const second = noGitProject("SECOND_PARENT");
  const engine = new Engine(tempDirectory("no-git-cache-"));
  const firstOutput = engine.process([first.child]);
  const secondOutput = engine.process([second.child]);
  assertEquals(firstOutput.documents[0].path, first.parent);
  assertEquals(secondOutput.documents[0].path, second.parent);
  assertEquals(
    firstOutput.documents[0].identity !== secondOutput.documents[0].identity,
    true,
  );
});
