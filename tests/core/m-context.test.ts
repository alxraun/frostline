// parents: @.frostline/graph/v-m-context.xml

import * as fs from "node:fs";
import * as path from "node:path";
import { assertEquals, assertStringIncludes } from "./assert.ts";
import { Engine } from "../../packages/core/src/runtime/engine.ts";
import { Project, tempDirectory } from "./fixtures.ts";
import { DeliveryStore } from "../../packages/core/src/runtime/delivery.ts";
import { ContextDocument } from "../../packages/core/src/types.ts";
import { renderContext } from "../../packages/core/src/runtime/context.ts";
import { Frostline } from "../../packages/core/src/product.ts";

function identities(output: { documents: Array<{ path: string }> }): string[] {
  return output.documents.map((document) => document.path);
}

Deno.test("emits transitive ancestors dependency first and not the actual file", () => {
  const project = Project.create();
  const root = project.write("root.md", "# Root\n");
  const mid = project.write("mid.md", "<!-- parents: @root.md -->\n# Middle\n");
  const child = project.write(
    "child.md",
    "<!-- parents: @mid.md -->\n# Child\n",
  );
  const output = new Engine(tempDirectory("fli-cache-")).process([child]);
  assertEquals(identities(output), [root, mid]);
  assertEquals(output.diagnostics, []);
  assertEquals(output.documents[1].content.startsWith("<!-- parents:"), true);
});

Deno.test("multi-file ancestors union deduplicates and preserves declared order", () => {
  const project = Project.create();
  const a = project.write("a.md", "# A\n");
  const b = project.write("b.md", "# B\n");
  const shared = project.write("shared.md", "# Shared\n");
  const first = project.write(
    "first.md",
    "<!-- parents: @a.md, @shared.md -->\n# First\n",
  );
  const second = project.write(
    "second.md",
    "<!-- parents: @b.md, @shared.md -->\n# Second\n",
  );
  const output = new Engine(tempDirectory("fli-cache-")).process([
    first,
    second,
  ]);
  assertEquals(identities(output), [a, shared, b]);
});

Deno.test("explicit parents traverse through previously undiscovered parent nodes", () => {
  const project = Project.create();
  const root = project.write("root.md", "# Root\n");
  const parent = project.write(
    "parent.md",
    "<!-- parents: @root.md -->\n# Parent\n",
  );
  const child = project.write(
    "src/child.rs",
    "// parents: @parent.md\nfn child() {}\n",
  );
  const output = new Engine(tempDirectory("fli-cache-")).process([child]);
  assertEquals(identities(output), [root, parent]);
  assertEquals(output.diagnostics, []);
});

Deno.test("unsupported children declaration on unrelated file cannot inject context", () => {
  const project = Project.create();
  project.write("parent.md", "<!-- children: @child.md -->\n# Parent\n");
  const child = project.write("child.md", "# Child\n");
  const output = new Engine(tempDirectory("fli-cache-")).process([child]);
  assertEquals(output.documents, []);
  assertEquals(output.diagnostics, []);
});

Deno.test("resolution error keeps an independent valid branch", () => {
  const project = Project.create();
  const valid = project.write("valid.md", "# Valid\n");
  const child = project.write(
    "child.md",
    "<!-- parents: @missing.md, @valid.md -->\n# Child\n",
  );
  const output = new Engine(tempDirectory("fli-cache-")).process([child]);
  assertEquals(identities(output), [valid]);
  assertEquals(output.diagnostics.length, 1);
  assertEquals(output.diagnostics[0].kind, "resolution");
});

Deno.test("cycle is diagnosed and an independent branch survives", () => {
  const project = Project.create();
  project.write("a.md", "<!-- parents: @b.md -->\n# A\n");
  project.write("b.md", "<!-- parents: @a.md -->\n# B\n");
  const valid = project.write("valid.md", "# Valid\n");
  const child = project.write(
    "child.md",
    "<!-- parents: @a.md, @valid.md -->\n# Child\n",
  );
  const output = new Engine(tempDirectory("fli-cache-")).process([child]);
  assertEquals(identities(output), [valid]);
  assertEquals(output.diagnostics.length, 1);
  assertEquals(output.diagnostics[0].kind, "graph");
});

Deno.test("declaration-like body text is a no-op", () => {
  const project = Project.create();
  project.write("parent.md", "# Parent\n");
  const child = project.write(
    "child.md",
    "# Child\n<!-- parents: @parent.md -->\n",
  );
  const output = new Engine(tempDirectory("fli-cache-")).process([child]);
  assertEquals(output.documents, []);
  assertEquals(output.diagnostics, []);
});

Deno.test("parent source content is read on every ancestry request", () => {
  const project = Project.create();
  const parent = project.write("parent.md", "first\n");
  const child = project.write(
    "child.md",
    "<!-- parents: @parent.md -->\n# Child\n",
  );
  const engine = new Engine(tempDirectory("fli-cache-"));
  const first = engine.process([child]);
  fs.writeFileSync(parent, "second\n");
  const second = engine.process([child]);
  assertEquals(first.documents[0].content, "first\n");
  assertEquals(second.documents[0].content, "second\n");
});

Deno.test("symlink target diagnosed without losing valid sibling", () => {
  const project = Project.create();
  const real = project.write("real.md", "# Real\n");
  const valid = project.write("valid.md", "# Valid\n");
  fs.symlinkSync(real, project.path("link.md"));
  const child = project.write(
    "child.md",
    "<!-- parents: @link.md, @valid.md -->\n# Child\n",
  );
  const output = new Engine(tempDirectory("fli-cache-")).process([child]);
  assertEquals(identities(output), [valid]);
  assertStringIncludes(output.diagnostics[0].message, "symlink");
});

Deno.test("glob parent selector is rejected without enumerating its matches", () => {
  const project = Project.create();
  project.write("parents/z.md", "# Z\n");
  project.write("parents/a.md", "# A\n");
  const child = project.write(
    "child.md",
    "<!-- parents: @parents/*.md -->\n# Child\n",
  );
  const output = new Engine(tempDirectory("fli-cache-")).process([child]);
  assertEquals(output.documents, []);
  assertEquals(output.diagnostics.length, 1);
  assertStringIncludes(output.diagnostics[0].message, "glob");
});

Deno.test("diamond emits shared ancestor once before descendants", () => {
  const project = Project.create();
  const root = project.write("root.md", "# Root\n");
  const left = project.write("left.md", "<!-- parents: @root.md -->\n# Left\n");
  const right = project.write(
    "right.md",
    "<!-- parents: @root.md -->\n# Right\n",
  );
  const leaf = project.write(
    "leaf.md",
    "<!-- parents: @left.md, @right.md -->\n# Leaf\n",
  );
  const values = identities(
    new Engine(tempDirectory("fli-cache-")).process([leaf]),
  );
  assertEquals(values.filter((identity) => identity === root).length, 1);
  assertEquals(values.indexOf(root) < values.indexOf(left), true);
  assertEquals(values.indexOf(root) < values.indexOf(right), true);
  assertEquals(values.includes(leaf), false);
});

Deno.test("nested Git root does not constrain literal ancestor lookup", () => {
  const project = Project.create();
  const outside = project.write("outer-parent.md", "OUTER\n");
  fs.mkdirSync(project.path("nested/.git"), { recursive: true });
  fs.writeFileSync(project.path("nested/.git/HEAD"), "ref: refs/heads/main\n");
  const child = project.write(
    "nested/child.md",
    "<!-- parents: @outer-parent.md -->\n# Child\n",
  );
  const output = new Engine(tempDirectory("fli-cache-")).process([child]);
  assertEquals(output.diagnostics, []);
  assertEquals(identities(output), [outside]);
});

Deno.test("no-Git ancestor lookup works without a cwd hint", () => {
  const root = tempDirectory("fli-workspace-");
  const parent = path.join(root, "parent.md");
  fs.writeFileSync(parent, "PARENT\n");
  const child = path.join(root, "child.md");
  fs.writeFileSync(child, "<!-- parents: @parent.md -->\n# Child\n");
  const output = new Engine(tempDirectory("fli-cache-")).process([child]);
  assertEquals(output.diagnostics, []);
  assertEquals(identities(output), [parent]);
});

Deno.test("invalid UTF-8 ancestor is isolated and never injected with replacement characters", () => {
  const project = Project.create();
  const invalid = project.path("invalid.md");
  fs.writeFileSync(invalid, new Uint8Array([0xff, 0xfe, 0x0a]));
  const valid = project.write("valid.md", "VALID_PARENT\n");
  const child = project.write(
    "child.md",
    "<!-- parents: @invalid.md, @valid.md -->\n# Child\n",
  );
  const output = new Engine(tempDirectory("encoding-cache-")).process([child]);
  assertEquals(output.documents.map((document) => document.path), [valid]);
  assertEquals(output.diagnostics.length, 1);
  assertEquals(output.diagnostics[0].kind, "resolution");
  assertEquals(output.diagnostics[0].path, invalid);
  assertStringIncludes(
    output.diagnostics[0].message,
    "cannot read context document",
  );
  assertEquals(
    output.documents.some((document) => document.content.includes("�")),
    false,
  );
});

Deno.test("valid UTF-8 ancestor content including BOM is preserved exactly", () => {
  const project = Project.create();
  project.write("parent.md", "\uFEFFPARENT\né\n");
  const child = project.write(
    "child.md",
    "<!-- parents: @parent.md -->\n# Child\n",
  );
  const output = new Engine(tempDirectory("encoding-cache-")).process([child]);
  assertEquals(output.diagnostics, []);
  assertEquals(output.documents.length, 1);
  assertEquals(output.documents[0].content, "\uFEFFPARENT\né\n");
});

const hostileIdentifiers = [
  "__proto__",
  "constructor",
  "prototype",
  "toString",
  "hasOwnProperty",
  "",
] as const;

for (const sessionId of hostileIdentifiers) {
  for (const contextId of hostileIdentifiers) {
    Deno.test(`delivery scope remains opaque for ${JSON.stringify(sessionId)} / ${JSON.stringify(contextId)}`, () => {
      const store = new DeliveryStore(tempDirectory("delivery-id-cache-"));
      const scope = { sessionId, contextId };
      const document: ContextDocument = {
        path: "/project/a.md",
        identity: "a.md",
        content: "A",
      };

      assertEquals(store.filter(scope, [document]).documents, [document]);
      assertEquals(store.filter(scope, [document]).documents, []);
      assertEquals(store.resetContext(scope), []);
      assertEquals(store.filter(scope, [document]).documents, [document]);
      assertEquals(store.resetSession(sessionId), []);
      assertEquals(store.filter(scope, [document]).documents, [document]);
    });
  }
}

Deno.test("similar encoded delivery identifiers never collide", () => {
  const store = new DeliveryStore(tempDirectory("delivery-id-cache-"));
  const document: ContextDocument = {
    path: "/project/a.md",
    identity: "a.md",
    content: "A",
  };
  const first = { sessionId: "x", contextId: "id:y" };
  const second = { sessionId: "id:x", contextId: "y" };

  assertEquals(store.filter(first, [document]).documents, [document]);
  assertEquals(store.filter(second, [document]).documents, [document]);
  assertEquals(store.filter(first, [document]).documents, []);
  assertEquals(store.filter(second, [document]).documents, []);
});

Deno.test("ancestor delivery identities are project-relative with a project discriminator", () => {
  const project = Project.create();
  const parent = project.write("docs/parent.md", "# Parent\n");
  const child = project.write(
    "src/child.rs",
    "// parents: @docs/parent.md\nfn child() {}\n",
  );
  const output = new Frostline(tempDirectory("fli-cache-")).ancestors({
    files: [child],
  });
  assertEquals(output.documents, [{
    path: "docs/parent.md",
    identity: parent,
    project: output.documents[0].project,
  }]);
  assertEquals(typeof output.documents[0].project, "string");
});

Deno.test("delivery identities keep the exact identity that delivery dedup consumes", () => {
  const project = Project.create();
  const parent = project.write("parent.md", "# Parent\n");
  const child = project.write(
    "child.md",
    "<!-- parents: @parent.md -->\n# Child\n",
  );
  const fli = new Frostline(tempDirectory("fli-cache-"));
  const scope = { sessionId: "identity-session", contextId: "__main__" };
  const first = fli.ancestors({ files: [child], deliveryScope: scope });
  assertEquals(first.documents[0].identity, parent);
  const second = fli.ancestors({ files: [child], deliveryScope: scope });
  assertEquals(second.documents, []);
  assertEquals(second.context, "");
});

Deno.test("equal project-relative paths from different projects carry distinct discriminators", () => {
  const fli = new Frostline(tempDirectory("fli-cache-"));
  const documents = ["left", "right"].map((name) => {
    const project = Project.create();
    project.write("shared.md", `# Shared ${name}\n`);
    const child = project.write(
      "child.md",
      "<!-- parents: @shared.md -->\n# Child\n",
    );
    return fli.ancestors({ files: [child] }).documents[0];
  });
  assertEquals(documents[0].path, documents[1].path);
  assertEquals(
    documents[0].project !== documents[1].project,
    true,
  );
});

Deno.test("multi-project context preserves first-seen project order", () => {
  const workspace = tempDirectory("multi-project-order-");
  const reads: string[] = [];
  for (
    const [name, marker] of [
      ["B", "UPPER"],
      ["a", "LOWER"],
      ["ä", "UMLAUT"],
    ] as const
  ) {
    const project = path.join(workspace, name);
    fs.mkdirSync(path.join(project, ".git"), { recursive: true });
    fs.writeFileSync(
      path.join(project, ".git", "HEAD"),
      "ref: refs/heads/main\n",
    );
    fs.writeFileSync(path.join(project, "parent.md"), `${marker}\n`);
    const child = path.join(project, "child.md");
    fs.writeFileSync(child, "<!-- parents: @parent.md -->\n# Child\n");
    reads.push(child);
  }

  const output = new Engine(tempDirectory("multi-project-cache-")).process(
    reads.toReversed(),
  );

  assertEquals(output.diagnostics, []);
  assertEquals(
    output.documents.map((document) => document.content.trim()),
    ["UMLAUT", "LOWER", "UPPER"],
  );
});

Deno.test("multi-file context preserves order and source-provided identities", () => {
  const context = renderContext([
    {
      path: "docs/root.md",
      identity: "project\0docs/root.md",
      content: "ROOT_MARKER\n",
    },
    {
      path: "docs/child.md",
      identity: "project\0docs/child.md",
      content: "CHILD_MARKER\n",
    },
  ]);
  assertEquals(context.match(/<frostline-context>/g)?.length, 1);
  assertEquals(context.match(/<\/frostline-context>/g)?.length, 1);
  assertEquals(context.match(/<[a-z][a-z0-9-]* path=/g)?.length, 2);
  assertStringIncludes(context, '<docs-root-md path="docs/root.md">');
  assertStringIncludes(context, "</docs-root-md>");
  assertEquals(
    context.indexOf('path="docs/root.md"') <
      context.indexOf('path="docs/child.md"'),
    true,
  );
});

Deno.test("CDATA terminators are split without semantic loss", () => {
  const context = renderContext([
    { path: 'a&"b.md', identity: 'project\0a&"b.md', content: "a]]>b" },
  ]);
  assertStringIncludes(context, 'path="a&amp;&quot;b.md"');
  assertStringIncludes(context, "<![CDATA[a]]]]><![CDATA[>b]]>");
  assertStringIncludes(context, '<a-b-md path="a&amp;&quot;b.md"');
});

Deno.test("normalization collisions receive distinct identity suffixes", () => {
  const context = renderContext([
    { path: "docs/a_b.md", identity: "docs/a_b.md", content: "underscore" },
    { path: "docs/a-b.md", identity: "docs/a-b.md", content: "hyphen" },
  ]);
  assertStringIncludes(context, "<docs-a-b-md-id-646f63732f615f622e6d64");
  assertStringIncludes(context, "<docs-a-b-md-id-646f63732f612d622e6d64");
});
