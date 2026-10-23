// parents: @.frostline/graph/ss-runtime.xml

import * as fs from "node:fs";
import * as path from "node:path";
import { discoverAncestors, ProjectIndex } from "./discovery.ts";
import { AncestryGraph } from "./graph.ts";
import {
  canonicalActualRead,
  graphBoundary,
  graphProjectRoot,
  relativeIdentity,
} from "./paths.ts";
import type {
  CoreOutput,
  Diagnostic,
  GraphOutput,
  GraphRequest,
} from "../types.ts";
import { dedupeDiagnostics } from "../types.ts";

export class Engine {
  constructor(private readonly cacheDirectory: string) {}

  process(files: string[]): CoreOutput {
    const diagnostics: Diagnostic[] = [];
    const anchors: string[] = [];
    for (const file of files) {
      const canonical = canonicalActualRead(file);
      if (canonical.diagnostic) {
        diagnostics.push(canonical.diagnostic);
        continue;
      }
      if (!anchors.includes(canonical.path!)) anchors.push(canonical.path!);
    }

    const graph = new AncestryGraph();
    discoverAncestors(this.cacheDirectory, anchors, graph, diagnostics);
    const { ordered, diagnostics: graphDiagnostics } = graph.orderedAncestors(
      anchors,
    );
    diagnostics.push(...graphDiagnostics);

    const actual = new Set(anchors);
    const documents = [];
    for (const value of ordered) {
      if (actual.has(value)) continue;
      try {
        documents.push({
          path: value,
          identity: value,
          content: readUtf8Strict(value),
        });
      } catch (error) {
        diagnostics.push({
          kind: "resolution",
          path: value,
          message: `cannot read context document: ${
            error instanceof Error ? error.message : String(error)
          }`,
        });
      }
    }
    return { documents, diagnostics: dedupeDiagnostics(diagnostics) };
  }

  graph(request: GraphRequest): GraphOutput {
    const candidate = path.resolve(request.anchor);
    let isDirectory = false;
    try {
      isDirectory = fs.lstatSync(candidate).isDirectory();
    } catch {
      // File validation reports missing or unreadable anchors below.
    }

    const directoryResult = isDirectory
      ? graphProjectRoot(candidate)
      : undefined;
    const fileResult = isDirectory
      ? undefined
      : canonicalActualRead(request.anchor);
    const anchorError = directoryResult?.diagnostic ?? fileResult?.diagnostic;
    if (anchorError) {
      return { nodes: [], edges: [], diagnostics: [anchorError] };
    }
    const anchor = isDirectory ? directoryResult!.root! : fileResult!.path!;

    const boundary = graphBoundary(anchor, request.root, isDirectory);
    if (boundary.diagnostic) {
      return { nodes: [], edges: [], diagnostics: [boundary.diagnostic] };
    }
    const root = boundary.root!;
    const diagnostics: Diagnostic[] = [];

    const index = ProjectIndex.scan(root, this.cacheDirectory);
    const graph = index.participationGraph(diagnostics);
    diagnostics.push(...graph.diagnostics());

    return {
      root,
      ...(isDirectory ? {} : { focus: relativeIdentity(root, anchor) }),
      nodes: graph.nodes().map((node) => relativeIdentity(root, node)),
      edges: graph.edges().map(({ child, parent }) => ({
        child: relativeIdentity(root, child),
        parent: relativeIdentity(root, parent),
      })),
      diagnostics: dedupeDiagnostics(diagnostics),
    };
  }
}

function readUtf8Strict(value: string): string {
  const bytes = fs.readFileSync(value);
  return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
    bytes,
  );
}
