// parents: @.frostline/graph/v-p-frostline.xml

import * as fs from "node:fs";
import * as path from "node:path";
import { assertEquals } from "../core/assert.ts";

const root = path.resolve(new URL("../../", import.meta.url).pathname);

Deno.test("Core operates from a product root with only the Core executable", () => {
  const work = fs.mkdtempSync(
    path.join(fs.realpathSync("/tmp"), "fli-core-e2e-"),
  );
  try {
    const product = path.join(work, "product");
    const project = path.join(work, "project");
    fs.mkdirSync(project, { recursive: true });
    fs.mkdirSync(path.join(project, ".git"), { recursive: true });
    fs.writeFileSync(
      path.join(project, ".git", "HEAD"),
      "ref: refs/heads/main\n",
    );
    fs.writeFileSync(path.join(project, "parent.md"), "PARENT_MARKER\n");
    fs.writeFileSync(
      path.join(project, "child.md"),
      "<!-- parents: @parent.md -->\n# Child\n",
    );
    fs.mkdirSync(path.join(product, "bin"), { recursive: true });
    fs.copyFileSync(
      path.join(root, "packages/core/bin/fli"),
      path.join(product, "bin/fli"),
    );

    const output = new Deno.Command(path.join(product, "bin/fli"), {
      args: ["ancestors", path.join(project, "child.md")],
      stdout: "piped",
      stderr: "piped",
      env: {
        ...Deno.env.toObject(),
        FLI_CACHE_DIR: path.join(work, "cache"),
      },
    }).outputSync();
    const context = new TextDecoder().decode(output.stdout);

    assertEquals(output.code, 0);
    assertEquals(context.includes("PARENT_MARKER"), true);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
});
