// parents: @.frostline/graph/v-m-syntax.xml

import { assertEquals, assertStringIncludes } from "./assert.ts";
import { Engine } from "../../packages/core/src/runtime/engine.ts";
import { Project, tempDirectory } from "./fixtures.ts";

const leadingDeclarations = [
  ["child.md", "<!-- parents: @parent.md -->\n# Child\n"],
  ["child.rs", "// parents: @parent.md\nfn child() {}\n"],
  ["child.py", "# parents: @parent.md\nprint('child')\n"],
  ["child.lua", "-- parents: @parent.md\nreturn {}\n"],
] as const;

for (const [filename, content] of leadingDeclarations) {
  Deno.test(`leading declaration is recognized in ${filename}`, () => {
    const project = Project.create();
    const parent = project.write("parent.md", "PARENT_MARKER\n");
    const child = project.write(filename, content);
    const output = new Engine(tempDirectory("syntax-cache-")).process([child]);
    assertEquals(output.diagnostics, []);
    assertEquals(output.documents.map((document) => document.path), [parent]);
  });
}

Deno.test("Python shebang and BOM do not hide a FLI declaration", () => {
  const project = Project.create();
  const parent = project.write("parent.md", "PARENT_MARKER\n");
  const child = project.write(
    "child.py",
    "\uFEFF#!/usr/bin/env python3\n# parents: @parent.md\nprint('child')\n",
  );
  const output = new Engine(tempDirectory("syntax-cache-")).process([child]);
  assertEquals(output.diagnostics, []);
  assertEquals(output.documents.map((document) => document.path), [parent]);
});

Deno.test("large leading comment spanning read chunks is parsed", () => {
  const project = Project.create();
  const parent = project.write("parent.md", "PARENT_MARKER\n");
  const filler = "x".repeat(8_500);
  const child = project.write(
    "child.rs",
    `/* ${filler}\nparents: @parent.md\n*/\nfn child() {}\n`,
  );
  const output = new Engine(tempDirectory("syntax-cache-")).process([child]);
  assertEquals(output.diagnostics, []);
  assertEquals(output.documents.map((document) => document.path), [parent]);
});

Deno.test("UTF-8 selector survives a multibyte codepoint across read chunks", () => {
  const project = Project.create();
  const parent = project.write("é.md", "UNICODE_PARENT\n");
  const filler = "x".repeat(4_081);
  const child = project.write(
    "child.rs",
    `/*\n${filler}\nparents: @é.md\n*/\nfn child() {}\n`,
  );
  const output = new Engine(tempDirectory("syntax-cache-")).process([child]);
  assertEquals(output.diagnostics, []);
  assertEquals(output.documents.map((document) => document.path), [parent]);
});

Deno.test("Markdown frontmatter before a FLI declaration is skipped", () => {
  const project = Project.create();
  const parent = project.write("parent.md", "PARENT_MARKER\n");
  const child = project.write(
    "child.md",
    "---\ntitle: Child\n---\n\n<!-- parents: @parent.md -->\n# Child\n",
  );
  const output = new Engine(tempDirectory("syntax-cache-")).process([child]);
  assertEquals(output.diagnostics, []);
  assertEquals(output.documents.map((document) => document.path), [parent]);
});

Deno.test("TOML frontmatter before a FLI declaration is skipped", () => {
  const project = Project.create();
  const parent = project.write("parent.md", "PARENT_MARKER\n");
  const child = project.write(
    "child.md",
    "+++\ntitle = 'Child'\n+++\n\n<!-- parents: @parent.md -->\n# Child\n",
  );
  const output = new Engine(tempDirectory("syntax-cache-")).process([child]);
  assertEquals(output.diagnostics, []);
  assertEquals(output.documents.map((document) => document.path), [parent]);
});

Deno.test("HTML doctype before a FLI declaration is skipped", () => {
  const project = Project.create();
  const parent = project.write("parent.md", "PARENT_MARKER\n");
  const child = project.write(
    "child.html",
    "<!DOCTYPE html>\n<!-- parents: @parent.md -->\n<p>child</p>\n",
  );
  const output = new Engine(tempDirectory("syntax-cache-")).process([child]);
  assertEquals(output.diagnostics, []);
  assertEquals(output.documents.map((document) => document.path), [parent]);
});

Deno.test("INI section headers before a FLI declaration are skipped in systemd units", () => {
  const project = Project.create();
  const parent = project.write("parent.md", "PARENT_MARKER\n");
  const child = project.write(
    "child.service",
    [
      "[Unit]",
      "# parents: @parent.md",
      "Description=Child daemon",
      "",
      "[Service]",
      "ExecStart=/usr/bin/child-daemon",
      "",
    ].join("\n"),
  );
  const output = new Engine(tempDirectory("syntax-cache-")).process([child]);
  assertEquals(output.diagnostics, []);
  assertEquals(output.documents.map((document) => document.path), [parent]);
});

Deno.test("declaration-like text inside frontmatter is ignored", () => {
  const project = Project.create();
  project.write("parent.md", "PARENT_MARKER\n");
  const child = project.write(
    "child.md",
    "---\nparents: @parent.md\n---\n\n# Child\n",
  );
  const output = new Engine(tempDirectory("syntax-cache-")).process([child]);
  assertEquals(output.documents, []);
  assertEquals(output.diagnostics, []);
});

Deno.test("unclosed frontmatter hides no declarations and later comments are ignored", () => {
  const project = Project.create();
  project.write("parent.md", "PARENT_MARKER\n");
  const child = project.write(
    "child.md",
    "---\ntitle: Child\n<!-- parents: @parent.md -->\n",
  );
  const output = new Engine(tempDirectory("syntax-cache-")).process([child]);
  assertEquals(output.documents, []);
  assertEquals(output.diagnostics, []);
});

Deno.test("legacy children declaration produces syntax diagnostic and no reverse edge", () => {
  const project = Project.create();
  const parent = project.write(
    "parent.md",
    "<!-- children: @child.ts -->\nPARENT_MARKER\n",
  );
  const child = project.write("child.ts", "export const child = true;\n");
  const engine = new Engine(tempDirectory("syntax-cache-"));
  const reverse = engine.process([child]);
  assertEquals(reverse.documents, []);
  assertEquals(reverse.diagnostics, []);
  const direct = engine.process([parent]);
  assertEquals(direct.documents, []);
  assertEquals(direct.diagnostics.length, 1);
  assertEquals(direct.diagnostics[0].kind, "syntax");
  assertStringIncludes(direct.diagnostics[0].message, "children:");
});

Deno.test("unknown extension detects the actual leading comment syntax", () => {
  const project = Project.create();
  const parent = project.write("parent.md", "PARENT_MARKER\n");
  const child = project.write(
    "child.unknown-ext",
    "# parents: @parent.md\nBODY\n",
  );
  const output = new Engine(tempDirectory("syntax-cache-")).process([child]);
  assertEquals(output.diagnostics, []);
  assertEquals(output.documents.map((document) => document.path), [parent]);
});

Deno.test("extensionless file detects the actual leading comment syntax", () => {
  const project = Project.create();
  const parent = project.write("parent.md", "PARENT_MARKER\n");
  const child = project.write("Makefile", "// parents: @parent.md\nall:\n");
  const output = new Engine(tempDirectory("syntax-cache-")).process([child]);
  assertEquals(output.diagnostics, []);
  assertEquals(output.documents.map((document) => document.path), [parent]);
});

Deno.test("binary content never introduces FLI declarations", () => {
  const project = Project.create();
  project.write("parent.md", "PARENT_MARKER\n");
  const child = project.write(
    "child.bin",
    "\u0000\u0001\u0002# parents: @parent.md\n",
  );
  const output = new Engine(tempDirectory("syntax-cache-")).process([child]);
  assertEquals(output.documents, []);
  assertEquals(output.diagnostics, []);
});

const htmlExtensions = ["md", "markdown", "html", "xml"] as const;
const slashExtensions = [
  "rs",
  "c",
  "h",
  "cc",
  "cpp",
  "cxx",
  "hpp",
  "java",
  "js",
  "jsx",
  "ts",
  "tsx",
  "go",
  "swift",
  "kt",
  "kts",
  "cs",
  "qml",
] as const;
const hashExtensions = [
  "py",
  "sh",
  "bash",
  "zsh",
  "fish",
  "rb",
  "pl",
  "r",
  "toml",
  "yaml",
  "yml",
] as const;
const dashExtensions = ["lua", "sql"] as const;

for (const extension of htmlExtensions) {
  declarationCase(extension, "<!-- parents: @parent.md -->");
}
for (const extension of slashExtensions) {
  declarationCase(extension, "// parents: @parent.md");
}
for (const extension of hashExtensions) {
  declarationCase(extension, "# parents: @parent.md");
}
for (const extension of dashExtensions) {
  declarationCase(extension, "-- parents: @parent.md");
}

Deno.test("supported extension matching is case insensitive", () => {
  const project = Project.create();
  project.write("parent.md", "PARENT\n");
  const child = project.write(
    "child.TS",
    "// parents: @parent.md\nexport const child = true;\n",
  );

  const output = new Engine(tempDirectory("syntax-matrix-cache-")).process([
    child,
  ]);

  assertEquals(output.diagnostics, []);
  assertEquals(output.documents.map((document) => document.path), [
    project.path("parent.md"),
  ]);
});

for (
  const [filename, declaration] of [
    ["child.ts", "# parents: @parent.md"],
    ["child.py", "// parents: @parent.md"],
    ["child.lua", "# parents: @parent.md"],
    ["child.md", "// parents: @parent.md"],
  ] as const
) {
  Deno.test(`wrong comment syntax is ignored for ${filename}`, () => {
    const project = Project.create();
    project.write("parent.md", "PARENT\n");
    const child = project.write(filename, `${declaration}\nBODY\n`);

    const output = new Engine(tempDirectory("syntax-matrix-cache-")).process([
      child,
    ]);

    assertEquals(output.documents, []);
    assertEquals(output.diagnostics, []);
  });
}

Deno.test("slash block comments and leading star decoration preserve declarations", () => {
  const project = Project.create();
  project.write("parent.md", "PARENT\n");
  const child = project.write(
    "child.ts",
    "/*\n * ordinary comment\n * parents: @parent.md\n */\nexport const child = true;\n",
  );

  const output = new Engine(tempDirectory("syntax-matrix-cache-")).process([
    child,
  ]);

  assertEquals(output.diagnostics, []);
  assertEquals(output.documents.map((document) => document.path), [
    project.path("parent.md"),
  ]);
});

Deno.test("multiple leading comments participate until first non-comment token", () => {
  const project = Project.create();
  project.write("a.md", "A\n");
  project.write("b.md", "B\n");
  project.write("ignored.md", "IGNORED\n");
  const child = project.write(
    "child.md",
    [
      "<!-- ordinary -->",
      "<!-- parents: @a.md -->",
      "<!-- parents: @b.md -->",
      "# Child",
      "<!-- parents: @ignored.md -->",
      "",
    ].join("\n"),
  );

  const output = new Engine(tempDirectory("syntax-matrix-cache-")).process([
    child,
  ]);

  assertEquals(output.diagnostics, []);
  assertEquals(output.documents.map((document) => document.path), [
    project.path("a.md"),
    project.path("b.md"),
  ]);
});

Deno.test("mixed valid and invalid selectors preserve the valid branch with diagnostics", () => {
  const project = Project.create();
  project.write("parent.md", "PARENT\n");
  const child = project.write(
    "child.md",
    "<!-- parents: parent.md, @parent.md, -->\n# Child\n",
  );

  const output = new Engine(tempDirectory("syntax-matrix-cache-")).process([
    child,
  ]);

  assertEquals(output.documents.map((document) => document.path), [
    project.path("parent.md"),
  ]);
  assertEquals(output.diagnostics.length, 2);
  assertEquals(
    output.diagnostics.every((value) => value.kind === "syntax"),
    true,
  );
});

function declarationCase(extension: string, declaration: string): void {
  Deno.test(`.${extension} accepts its canonical leading comment syntax`, () => {
    const project = Project.create();
    project.write("parent.md", "PARENT\n");
    const child = project.write(
      `child.${extension}`,
      `${declaration}\nBODY\n`,
    );

    const output = new Engine(tempDirectory("syntax-matrix-cache-")).process([
      child,
    ]);

    assertEquals(output.diagnostics, []);
    assertEquals(output.documents.map((document) => document.path), [
      project.path("parent.md"),
    ]);
  });
}

for (
  const [filename, source] of [
    [
      "child.sh",
      "#!/usr/bin/env bash\n# ordinary leading comment\n# parents: @parent.md\necho child\n",
    ],
    [
      "child.py",
      "\uFEFF#!/usr/bin/env python3\n# ordinary leading comment\n# parents: @parent.md\nprint('child')\n",
    ],
    [
      "child.py",
      "#!/usr/bin/env python3\r\n# ordinary leading comment\r\n# parents: @parent.md\r\nprint('child')\r\n",
    ],
  ] as const
) {
  Deno.test(`${filename} preserves all leading comments after shebang`, () => {
    const project = Project.create();
    project.write("parent.md", "PARENT_MARKER\n");
    const child = project.write(filename, source);

    const output = new Engine(tempDirectory("shebang-cache-")).process([child]);

    assertEquals(output.diagnostics, []);
    assertEquals(output.documents.map((document) => document.path), [
      project.path("parent.md"),
    ]);
  });
}

Deno.test("shebang without terminating newline is a valid no-op", () => {
  const project = Project.create();
  const child = project.write("child.sh", "#!/usr/bin/env bash");

  const output = new Engine(tempDirectory("shebang-cache-")).process([child]);

  assertEquals(output.documents, []);
  assertEquals(output.diagnostics, []);
});
