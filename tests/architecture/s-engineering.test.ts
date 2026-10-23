// parents: @.frostline/graph/v-s-engineering.xml

import * as fs from "node:fs";
import * as path from "node:path";
import { assertEquals } from "../core/assert.ts";

{
  const root = path.resolve(new URL("../../", import.meta.url).pathname);
  const skillNames = [
    "frostline-graph",
  ];
  const projectSkillNames = [
    "frostline-verification",
    "frostline-logging",
  ];

  Deno.test("repository root expresses the target ownership boundaries", () => {
    const allowed = new Set([
      ".gitignore",
      "LICENSE",
      "SECURITY.md",
      "licenses",
      "README.md",
      "AGENTS.md",
      ".agents",
      ".frostline",
      "integrations",
      "packages",
      "tests",
      "scripts",
      "deno.json",
    ]);
    const topLevel = new Set(
      trackedFiles().map((value) => value.split("/")[0]),
    );
    assertEquals(topLevel, allowed);
  });

  Deno.test("Core has no dependency on integrations", () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(root, "packages/core/package.json"), "utf8"),
    ) as { dependencies?: Record<string, string> };
    assertEquals(manifest.dependencies, undefined);
    for (const file of filesUnder(path.join(root, "packages/core/src"))) {
      const source = fs.readFileSync(file, "utf8");
      assertEquals(source.includes("integrations/codex"), false);
    }
  });

  Deno.test("TypeScript is the default implementation language", () => {
    const sourceFiles = trackedFiles().filter((value) =>
      value.startsWith("packages/") && /\.(ts|tsx|py|rs)$/.test(value)
    );
    // Shared read classifier is the one sanctioned Rust exception under
    // packages/ (P-FROSTLINE TECH-001: justified owner-local capability).
    const nonTypeScript = sourceFiles.filter((value) =>
      !value.endsWith(".ts") && !value.startsWith("packages/read-classifier/")
    );
    assertEquals(nonTypeScript, []);
    const classifierRust = sourceFiles.filter((value) =>
      value.startsWith("packages/read-classifier/") && value.endsWith(".rs")
    );
    assertEquals(classifierRust.length > 0, true);
    const integrationRust = trackedFiles().filter((value) =>
      value.startsWith("integrations/codex/native/") && value.endsWith(".rs")
    );
    assertEquals(integrationRust.length > 0, true);
  });

  Deno.test("canonical Agent Skills have one harness-independent owner", () => {
    assertEquals(
      fs.existsSync(path.join(root, "packages/core/prompts/session-start.md")),
      false,
    );
    for (const skill of skillNames) {
      assertEquals(
        fs.existsSync(path.join(root, "packages/skills", skill, "SKILL.md")),
        true,
      );
    }
    for (const skill of projectSkillNames) {
      // Project-local authoring skills serve this repository only; they are
      // not part of the exported bundle surface.
      assertEquals(
        fs.existsSync(path.join(root, ".agents/skills", skill, "SKILL.md")),
        true,
      );
      assertEquals(
        fs.existsSync(path.join(root, "packages/skills", skill)),
        false,
      );
    }
    assertEquals(
      fs.existsSync(path.join(root, "packages/skills/fli-maintain")),
      false,
    );
    assertEquals(
      fs.existsSync(path.join(root, "integrations/codex/skills")),
      false,
    );
  });

  Deno.test("repository-level scripts own distribution", () => {
    for (
      const task of [
        "build",
        "check",
        "test",
        "package",
        "verify",
        "install-dev",
        "release",
      ]
    ) {
      assertEquals(
        fs.existsSync(path.join(root, "scripts", task + ".sh")),
        true,
      );
    }
    assertEquals(fs.existsSync(path.join(root, "tooling")), false);
  });

  Deno.test("no generated or transient content is tracked", () => {
    const forbidden = trackedFiles().filter((value) =>
      value.includes("/bin/") ||
      value.includes("/node_modules/") ||
      value.includes("/target/") ||
      value.includes("/dist/") ||
      /\.(log|tmp|sqlite3)$/.test(value)
    );
    assertEquals(forbidden, []);
  });

  const filesUnder = (rootDirectory: string): string[] => {
    const result: string[] = [];
    for (
      const entry of fs.readdirSync(rootDirectory, { withFileTypes: true })
    ) {
      const value = path.join(rootDirectory, entry.name);
      if (entry.isDirectory()) result.push(...filesUnder(value));
      else if (/\.(ts|tsx)$/.test(value)) result.push(value);
    }
    return result;
  };

  const trackedFiles = (): string[] => {
    const output = new Deno.Command("git", {
      args: ["ls-files"],
      cwd: root,
      stdout: "piped",
    }).outputSync();
    return new TextDecoder()
      .decode(output.stdout)
      .split("\n")
      .filter((value) => value.length > 0);
  };
}
