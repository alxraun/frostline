// parents: @.frostline/graph/m-discovery.xml, @.frostline/graph/ss-runtime.xml

import * as fs from "node:fs";
import * as path from "node:path";
import {
  type Declaration,
  parse,
  type ParsedFile,
  readLeadingArea,
  supportsDeclarations,
} from "./syntax.ts";
import {
  compileSelector,
  type ResolutionOutcome,
  selectorError,
  upwardLevels,
} from "./selector.ts";
import { loadState, type ProjectCache, updateState } from "./state.ts";
import { AncestryGraph } from "./graph.ts";
import { contains, relativeIdentity, validateRegularFile } from "./paths.ts";
import { compareText, type Diagnostic, diagnostic } from "../types.ts";

interface FileFingerprint {
  size: number;
  mtimeMs: number;
  ctimeMs: number;
  ino: number;
  symlink: boolean;
}

const generatedDirectories = new Set([
  "node_modules",
  "target",
  "dist",
  "build",
  ".cache",
  ".deno",
]);

/**
 * Expand only transitive child-owned parents from the supplied anchor files.
 * Literal selectors search ancestor directories up to the filesystem root.
 * No downward project/scope discovery is performed here.
 */
export function discoverAncestors(
  cacheDirectory: string,
  anchors: string[],
  graph: AncestryGraph,
  diagnostics: Diagnostic[],
): void {
  expandAncestors(
    anchors,
    graph,
    diagnostics,
    cacheDirectory,
    (node) => inspectFile(node, diagnostics),
  );
}

export class ProjectIndex {
  private constructor(
    private readonly root: string,
    private readonly cacheDirectory: string,
    private readonly parsed: Map<string, ParsedFile>,
    private readonly scanDiagnostics: Diagnostic[],
  ) {}

  static scan(
    root: string,
    cacheDirectory: string,
    freshFiles: Set<string> = new Set(),
  ): ProjectIndex {
    const parsed = new Map<string, ParsedFile>();
    const scanDiagnostics: Diagnostic[] = [];
    const nextCache: ProjectCache = { files: {} };
    let cached: ProjectCache | undefined;
    try {
      cached = loadState(cacheDirectory)?.projects[root];
    } catch {
      // Derived cache corruption never changes filesystem authority.
    }

    visitDirectory(
      root,
      cacheDirectory,
      (value) => {
        if (!supportsDeclarations(value)) return;

        const relative = relativeIdentity(root, value);
        let fingerprint: FileFingerprint;
        try {
          fingerprint = fingerprintOf(value);
        } catch (error) {
          scanDiagnostics.push(
            diagnostic(
              "resolution",
              value,
              `cannot inspect discovery candidate metadata: ${
                errorText(error)
              }`,
            ),
          );
          return;
        }

        let source: string | null = null;
        if (!fingerprint.symlink) {
          const entry = freshFiles.has(value)
            ? undefined
            : cached?.files[relative];
          if (
            entry?.leadingSource !== undefined &&
            entry.leadingSource !== null &&
            entry.size === fingerprint.size &&
            entry.mtimeMs === fingerprint.mtimeMs &&
            entry.ctimeMs === fingerprint.ctimeMs &&
            entry.ino === fingerprint.ino &&
            entry.symlink === fingerprint.symlink
          ) {
            source = entry.leadingSource;
          } else {
            try {
              source = readLeadingArea(value);
            } catch (error) {
              scanDiagnostics.push(
                diagnostic(
                  "resolution",
                  value,
                  `cannot inspect discovery candidate: ${errorText(error)}`,
                ),
              );
            }
          }

          if (source !== null) {
            const metadata = parse(value, source);
            if (
              metadata.declarations.length > 0 ||
              metadata.diagnostics.length > 0
            ) {
              parsed.set(value, metadata);
            }
          }
        }

        nextCache.files[relative] = {
          size: fingerprint.size,
          mtimeMs: fingerprint.mtimeMs,
          ctimeMs: fingerprint.ctimeMs,
          ino: fingerprint.ino,
          symlink: fingerprint.symlink,
          leadingSource: source,
        };
      },
      (directory, error) => {
        scanDiagnostics.push(
          diagnostic(
            "resolution",
            directory,
            `cannot traverse discovery directory: ${errorText(error)}`,
          ),
        );
      },
    );

    try {
      updateState(cacheDirectory, (current) => {
        current.projects[root] = nextCache;
      });
    } catch {
      // Cache persistence is acceleration only.
    }

    return new ProjectIndex(root, cacheDirectory, parsed, scanDiagnostics);
  }

  participationGraph(diagnostics: Diagnostic[]): AncestryGraph {
    const graph = new AncestryGraph();
    diagnostics.push(...this.scanDiagnostics);

    const seeds: string[] = [];
    for (const [file, metadata] of this.parsed) {
      diagnostics.push(...metadata.diagnostics);
      if (metadata.declarations.length > 0) seeds.push(file);
    }
    seeds.sort(compareText);

    expandAncestors(
      seeds,
      graph,
      diagnostics,
      this.cacheDirectory,
      (node) => {
        const indexed = this.parsed.get(node);
        if (indexed) return indexed;
        if (contains(this.root, node)) return undefined;
        return inspectFile(node, diagnostics);
      },
    );
    return graph;
  }

  /**
   * Expand anchors against this scan's declarations. Kept for explicit callers;
   * it never broadens the full-scan region when parents escape the root.
   */
  discover(
    anchors: string[],
    graph: AncestryGraph,
    diagnostics: Diagnostic[],
  ): void {
    diagnostics.push(...this.scanDiagnostics);
    expandAncestors(
      anchors,
      graph,
      diagnostics,
      this.cacheDirectory,
      (node) => this.parsed.get(node) ?? inspectFile(node, diagnostics),
    );
  }
}

function expandAncestors(
  starts: string[],
  graph: AncestryGraph,
  diagnostics: Diagnostic[],
  cacheDirectory: string,
  metadataFor: (node: string) => ParsedFile | undefined,
): void {
  const queue = [...starts];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const node = queue.shift()!;
    if (visited.has(node)) continue;
    visited.add(node);

    const metadata = metadataFor(node);
    if (!metadata) continue;
    diagnostics.push(...metadata.diagnostics);
    if (metadata.declarations.length > 0) graph.addNode(node);

    for (const declaration of metadata.declarations) {
      for (const selector of declaration.selectors) {
        const outcome = resolveLiteralParent(cacheDirectory, selector, node);
        diagnostics.push(...outcome.diagnostics);
        for (const parent of outcome.matches) {
          graph.addEdge(node, parent, selector.order);
          queue.push(parent);
        }
      }
    }
  }
}

function inspectFile(
  node: string,
  diagnostics: Diagnostic[],
): ParsedFile | undefined {
  if (!supportsDeclarations(node)) return undefined;
  try {
    return parse(node, readLeadingArea(node));
  } catch (error) {
    diagnostics.push(
      diagnostic(
        "resolution",
        node,
        `cannot inspect FLI declaration source: ${errorText(error)}`,
      ),
    );
    return undefined;
  }
}

function resolveLiteralParent(
  cacheDirectory: string,
  selector: Declaration["selectors"][number],
  node: string,
): ResolutionOutcome {
  let literal: string;
  try {
    literal = compileSelector(selector).literal;
  } catch (error) {
    return {
      matches: [],
      diagnostics: [
        diagnostic("resolution", node, selectorError(selector, error)),
      ],
    };
  }

  const diagnostics: Diagnostic[] = [];
  for (const level of upwardLevels(path.dirname(node))) {
    const candidate = path.join(level, literal);
    if (!exists(candidate)) continue;

    if (isExcludedTarget(cacheDirectory, candidate, node)) {
      diagnostics.push(
        diagnostic(
          "resolution",
          node,
          `selector \`${selector.raw}\` matched excluded target ${candidate}`,
        ),
      );
      continue;
    }

    const error = validateRegularFile(candidate, "resolution");
    if (error) {
      diagnostics.push(
        diagnostic(
          "resolution",
          node,
          `selector \`${selector.raw}\` matched invalid target ${candidate}: ${error.message}`,
        ),
      );
      continue;
    }
    return { level, matches: [candidate], diagnostics };
  }

  if (diagnostics.length === 0) {
    diagnostics.push(
      diagnostic(
        "resolution",
        node,
        `selector \`${selector.raw}\` matched no file through filesystem root`,
      ),
    );
  }
  return { matches: [], diagnostics };
}

function visitDirectory(
  root: string,
  cacheDirectory: string,
  emit: (value: string) => void,
  reportTraversalError: (directory: string, error: unknown) => void,
): void {
  const stack = [root];
  while (stack.length > 0) {
    const directory = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true }).sort((
        left,
        right,
      ) => compareText(left.name, right.name));
    } catch (error) {
      reportTraversalError(directory, error);
      continue;
    }

    const directories: string[] = [];
    for (const entry of entries) {
      const value = path.join(directory, entry.name);
      if (
        entry.name === ".git" ||
        (entry.isDirectory() && generatedDirectories.has(entry.name)) ||
        isDerivedCachePath(root, cacheDirectory, value)
      ) {
        continue;
      }
      if (entry.isDirectory()) directories.push(value);
      else if (entry.isFile() || entry.isSymbolicLink()) emit(value);
    }
    for (let index = directories.length - 1; index >= 0; index -= 1) {
      stack.push(directories[index]);
    }
  }
}

function isExcludedTarget(
  cacheDirectory: string,
  value: string,
  node: string,
): boolean {
  const absolute = path.resolve(value);
  const cache = path.resolve(cacheDirectory);
  const nodeDirectory = path.dirname(path.resolve(node));
  // A node living inside a generated directory (for example decompiled
  // reference sources under a project `.cache/`) owns ordinary FLI target
  // space: its own resolution must not be excluded by generated-name
  // matching, otherwise its graph would be permanently unreachable.
  const nodeGenerated = path.dirname(nodeDirectory)
    .split(path.sep)
    .filter(Boolean)
    .some((component) => generatedDirectories.has(component));
  if (!nodeGenerated) {
    // Only directory components may be generated directories; a plain file
    // merely named `build` stays inside FLI target space.
    const directoryComponents = path.dirname(absolute)
      .split(path.sep)
      .filter(Boolean);
    if (
      directoryComponents.some((component) =>
        generatedDirectories.has(component)
      )
    ) {
      return true;
    }
  }
  // A cache directory strictly above the declaring file's scope is ordinary
  // ancestor territory, not a derived-state exclusion region. A cache at or
  // inside the scope still hides its own derived state.
  if (contains(cache, nodeDirectory) && !contains(nodeDirectory, cache)) {
    return false;
  }
  return contains(cache, absolute);
}

function isDerivedCachePath(
  root: string,
  cacheDirectory: string,
  value: string,
): boolean {
  const canonicalRoot = path.resolve(root);
  const canonicalCache = path.resolve(cacheDirectory);
  const canonicalValue = path.resolve(value);
  if (canonicalCache === canonicalRoot) {
    const relative = relativeIdentity(canonicalRoot, canonicalValue);
    return relative === "state.json" || relative === ".state.lock" ||
      relative.startsWith(".state.lock/") ||
      /^\.state-[^.]+\.json$/.test(relative);
  }
  return contains(canonicalRoot, canonicalCache) &&
    contains(canonicalCache, canonicalValue);
}

function fingerprintOf(value: string): FileFingerprint {
  const metadata = fs.lstatSync(value);
  return {
    size: Number(metadata.size),
    mtimeMs: metadata.mtimeMs,
    ctimeMs: metadata.ctimeMs,
    ino: Number(metadata.ino),
    symlink: metadata.isSymbolicLink(),
  };
}

function exists(value: string): boolean {
  try {
    fs.lstatSync(value);
    return true;
  } catch {
    return false;
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
