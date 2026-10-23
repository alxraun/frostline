// parents: @.frostline/graph/m-graph.xml

import { compareText, type Diagnostic, diagnostic } from "../types.ts";

interface ParentEdge {
  order: number;
  path: string;
}

export class AncestryGraph {
  private readonly parentMap = new Map<string, ParentEdge[]>();

  addNode(node: string): void {
    this.parentMap.set(node, this.parentMap.get(node) ?? []);
  }

  addEdge(child: string, parent: string, order: number): void {
    this.addNode(parent);
    const parents = this.parentMap.get(child) ?? [];
    if (!parents.some((value) => value.path === parent)) {
      parents.push({ order, path: parent });
      parents.sort(
        (left, right) =>
          left.order - right.order || compareText(left.path, right.path),
      );
    }
    this.parentMap.set(child, parents);
  }

  nodes(): string[] {
    return [...this.parentMap.keys()].sort(compareText);
  }

  edges(): Array<{ child: string; parent: string }> {
    return [...this.parentMap.entries()]
      .flatMap(([child, parents]) =>
        parents.map((parent) => ({ child, parent: parent.path }))
      )
      .sort((left, right) =>
        compareText(left.child, right.child) ||
        compareText(left.parent, right.parent)
      );
  }

  diagnostics(): Diagnostic[] {
    return this.cyclicComponents().map((component) =>
      diagnostic(
        "graph",
        component[0],
        `semantic ancestry cycle: ${component.join(" -> ")}`,
      )
    );
  }

  orderedAncestors(
    reads: string[],
  ): { ordered: string[]; diagnostics: Diagnostic[] } {
    const cycles = this.cyclicComponents();
    const cyclic = new Set(cycles.flatMap((component) => component));
    const diagnostics = cycles.map((component) =>
      diagnostic(
        "graph",
        component[0],
        `semantic ancestry cycle: ${component.join(" -> ")}`,
      )
    );
    const ordered: string[] = [];
    const emitted = new Set<string>();
    const failed = new Set<string>();

    for (const read of reads) {
      for (const parent of this.parentMap.get(read) ?? []) {
        this.visitIterative(parent.path, cyclic, emitted, failed, ordered);
      }
    }
    return { ordered, diagnostics };
  }

  private visitIterative(
    start: string,
    cyclic: Set<string>,
    emitted: Set<string>,
    failed: Set<string>,
    ordered: string[],
  ): boolean {
    if (emitted.has(start)) return true;
    if (cyclic.has(start) || failed.has(start)) return false;

    const stack: Array<{ node: string; nextParent: number; valid: boolean }> = [
      { node: start, nextParent: 0, valid: true },
    ];

    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      const parents = this.parentMap.get(frame.node) ?? [];
      if (frame.nextParent < parents.length) {
        const parent = parents[frame.nextParent].path;
        frame.nextParent += 1;
        if (emitted.has(parent)) continue;
        if (cyclic.has(parent) || failed.has(parent)) {
          frame.valid = false;
          continue;
        }
        stack.push({ node: parent, nextParent: 0, valid: true });
        continue;
      }

      stack.pop();
      if (frame.valid) {
        if (!emitted.has(frame.node)) {
          emitted.add(frame.node);
          ordered.push(frame.node);
        }
      } else {
        failed.add(frame.node);
        const caller = stack[stack.length - 1];
        if (caller) caller.valid = false;
      }
    }

    return !failed.has(start);
  }

  private cyclicComponents(): string[][] {
    const nodes = this.nodes();
    const visited = new Set<string>();
    const finishOrder: string[] = [];

    for (const start of nodes) {
      if (visited.has(start)) continue;
      visited.add(start);
      const stack: Array<{ node: string; nextParent: number }> = [
        { node: start, nextParent: 0 },
      ];
      while (stack.length > 0) {
        const frame = stack[stack.length - 1];
        const parents = this.parentMap.get(frame.node) ?? [];
        if (frame.nextParent < parents.length) {
          const parent = parents[frame.nextParent].path;
          frame.nextParent += 1;
          if (!visited.has(parent)) {
            visited.add(parent);
            stack.push({ node: parent, nextParent: 0 });
          }
          continue;
        }
        finishOrder.push(frame.node);
        stack.pop();
      }
    }

    const reverse = new Map<string, string[]>();
    for (const node of nodes) reverse.set(node, []);
    for (const [child, parents] of this.parentMap) {
      for (const parent of parents) {
        const children = reverse.get(parent.path) ?? [];
        children.push(child);
        reverse.set(parent.path, children);
      }
    }
    for (const children of reverse.values()) children.sort(compareText);

    const assigned = new Set<string>();
    const cycles: string[][] = [];
    for (let index = finishOrder.length - 1; index >= 0; index -= 1) {
      const start = finishOrder[index];
      if (assigned.has(start)) continue;
      assigned.add(start);
      const component: string[] = [];
      const stack = [start];
      while (stack.length > 0) {
        const node = stack.pop()!;
        component.push(node);
        const children = reverse.get(node) ?? [];
        for (
          let childIndex = children.length - 1;
          childIndex >= 0;
          childIndex -= 1
        ) {
          const child = children[childIndex];
          if (assigned.has(child)) continue;
          assigned.add(child);
          stack.push(child);
        }
      }

      const selfLoop = component.length === 1 &&
        (this.parentMap.get(component[0]) ?? []).some(({ path }) =>
          path === component[0]
        );
      if (component.length > 1 || selfLoop) {
        cycles.push(component.toSorted(compareText));
      }
    }

    return cycles.sort((left, right) =>
      compareText(left.join("\0"), right.join("\0"))
    );
  }
}
