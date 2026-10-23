// parents: @.frostline/graph/v-ss-runtime.xml

import * as fs from "node:fs";
import { assertEquals } from "./assert.ts";
import { Engine } from "../../packages/core/src/runtime/engine.ts";
import { Project, tempDirectory } from "./fixtures.ts";
import * as path from "node:path";

{
  Deno.test("generated literal parents graphs are invariant under declaration order", () => {
    const random = generator(0x51deca7e);
    for (let caseIndex = 0; caseIndex < 30; caseIndex += 1) {
      const nodeCount = 4 + nextInt(random, 12);
      const parents = new Map<number, number[]>();
      for (let node = 0; node < nodeCount; node += 1) {
        const chosen = new Set<number>();
        if (node > 0) {
          const count = 1 + nextInt(random, Math.min(3, node));
          while (chosen.size < count) chosen.add(nextInt(random, node));
        }
        parents.set(node, [...chosen].sort((left, right) => left - right));
      }
      const leftProject = Project.create();
      const rightProject = Project.create();
      for (let node = 0; node < nodeCount; node += 1) {
        const selectors = (parents.get(node) ?? []).map((parent) =>
          `@n${parent}.md`
        );
        const forward = selectors.length > 0
          ? `<!-- parents: ${selectors.join(", ")} -->\n`
          : "";
        const reversed = selectors.length > 0
          ? `<!-- parents: ${[...selectors].reverse().join(", ")} -->\n`
          : "";
        leftProject.write(`n${node}.md`, `${forward}# N${node}\n`);
        rightProject.write(`n${node}.md`, `${reversed}# N${node}\n`);
      }
      const left = new Engine(tempDirectory("parents-cache-")).graph({
        anchor: leftProject.root,
      });
      const right = new Engine(tempDirectory("parents-cache-")).graph({
        anchor: rightProject.root,
      });
      assertEquals(left.diagnostics, []);
      assertEquals(right.diagnostics, []);
      assertEquals(left.nodes, right.nodes, `case ${caseIndex}: node mismatch`);
      assertEquals(left.edges, right.edges, `case ${caseIndex}: edge mismatch`);
    }
  });

  Deno.test("unrelated files and cache deletion do not change resolved context", () => {
    for (let caseIndex = 0; caseIndex < 30; caseIndex += 1) {
      const project = Project.create();
      const cache = tempDirectory("metamorphic-cache-");
      const depth = 2 + (caseIndex % 8);
      project.write("n0.md", "ROOT\n");
      for (let node = 1; node <= depth; node += 1) {
        project.write(
          `n${node}.md`,
          `<!-- parents: @n${node - 1}.md -->\n# N${node}\n`,
        );
      }
      const leaf = project.path(`n${depth}.md`);
      const engine = new Engine(cache);
      const before = engine.process([leaf]);
      project.write(`unrelated-${caseIndex}.md`, `UNRELATED ${caseIndex}\n`);
      const withUnrelated = engine.process([leaf]);
      fs.rmSync(cache, { recursive: true, force: true });
      const afterCacheDelete = engine.process([leaf]);
      assertEquals(withUnrelated.documents, before.documents);
      assertEquals(withUnrelated.diagnostics, before.diagnostics);
      assertEquals(afterCacheDelete.documents, before.documents);
      assertEquals(afterCacheDelete.diagnostics, before.diagnostics);
    }
  });

  Deno.test("redundant transitive literal parent declaration does not change context", () => {
    for (let depth = 2; depth <= 18; depth += 1) {
      const project = Project.create();
      project.write("n0.md", "ROOT\n");
      for (let node = 1; node <= depth; node += 1) {
        project.write(
          `n${node}.md`,
          `<!-- parents: @n${node - 1}.md -->\n# N${node}\n`,
        );
      }
      const leaf = project.path(`n${depth}.md`);
      const engine = new Engine(tempDirectory("transitive-cache-"));
      const before = engine.process([leaf]);
      fs.writeFileSync(
        leaf,
        `<!-- parents: @n${depth - 1}.md, @n0.md -->\n# N${depth}\n`,
      );
      const after = engine.process([leaf]);
      assertEquals(after.documents, before.documents);
      assertEquals(after.diagnostics, before.diagnostics);
    }
  });

  const generator = (seed: number): () => number => {
    let state = seed >>> 0;
    return () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state;
    };
  };

  const nextInt = (random: () => number, maximum: number): number => {
    return random() % maximum;
  };
}

{
  Deno.test("generated DAG repositories agree with an independent ancestry model", () => {
    const random = generator(0x5eed1234);
    for (let caseIndex = 0; caseIndex < 60; caseIndex += 1) {
      const project = Project.create();
      const nodeCount = 5 + nextInt(random, 16);
      const parents = new Map<number, number[]>();
      for (let node = 0; node < nodeCount; node += 1) {
        const available = node;
        const chosen = new Set<number>();
        if (available > 0) {
          const count = 1 + nextInt(random, Math.min(3, available));
          while (chosen.size < count) chosen.add(nextInt(random, available));
        }
        const ordered = [...chosen].sort((a, b) => a - b);
        parents.set(node, ordered);
        const selectors = ordered.map((parent) => `@n${parent}.md`);
        if (caseIndex % 7 === 0 && selectors.length > 0) {
          selectors.push(selectors[0]);
        }
        const declaration = selectors.length > 0
          ? `<!-- parents: ${selectors.join(", ")} -->\n`
          : "";
        project.write(`n${node}.md`, `${declaration}# N${node}\n`);
      }
      const readIndexes = caseIndex % 3 === 0 && nodeCount > 2
        ? [nodeCount - 1, nodeCount - 2]
        : [nodeCount - 1];
      const reads = readIndexes.map((node) => project.path(`n${node}.md`));
      const output = new Engine(tempDirectory("property-cache-")).process(
        reads,
      );
      assertEquals(output.diagnostics, []);
      const actual = output.documents.map((document) =>
        Number(/^n(\d+)\.md$/.exec(path.basename(document.path))?.[1])
      );
      const expected = referenceAncestors(readIndexes, parents);
      assertEquals(
        [...new Set(actual)].sort((a, b) => a - b),
        [...expected].sort((a, b) => a - b),
      );
      assertEquals(actual.length, expected.size);
      for (const read of readIndexes) {
        assertEquals(actual.includes(read), false);
      }
      const positions = new Map(actual.map((node, index) => [node, index]));
      for (const child of expected) {
        for (const parent of parents.get(child) ?? []) {
          if (!expected.has(parent)) continue;
          assertEquals(
            positions.get(parent)! < positions.get(child)!,
            true,
            `case ${caseIndex}: n${parent} must precede n${child}`,
          );
        }
      }
    }
  });

  const referenceAncestors = (
    reads: number[],
    parents: Map<number, number[]>,
  ): Set<number> => {
    const result = new Set<number>();
    const actualReads = new Set(reads);
    const visit = (node: number) => {
      for (const parent of parents.get(node) ?? []) {
        if (!actualReads.has(parent)) result.add(parent);
        visit(parent);
      }
    };
    for (const read of reads) visit(read);
    return result;
  };

  const generator = (seed: number): () => number => {
    let state = seed >>> 0;
    return () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state;
    };
  };

  const nextInt = (random: () => number, maximum: number): number => {
    return random() % maximum;
  };
}
