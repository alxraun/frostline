// parents: @.frostline/graph/m-resolution.xml

import * as fs from "node:fs";
import { createHash } from "node:crypto";
import * as path from "node:path";
import { type Diagnostic, diagnostic, type DiagnosticKind } from "../types.ts";

export function toPosix(value: string): string {
  return value.replaceAll("\\", "/");
}

export function lexicalNormalize(value: string): string {
  return path.normalize(value);
}

export function contains(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function containsGitComponent(value: string): boolean {
  return path.resolve(value).split(path.sep).includes(".git");
}

export function validateRegularFile(
  value: string,
  kind: DiagnosticKind,
): Diagnostic | undefined {
  const absolute = path.resolve(value);
  if (containsGitComponent(absolute)) {
    return diagnostic(kind, absolute, "`.git` is outside FLI target space");
  }
  const parts = absolute.split(path.sep).filter((part) => part.length > 0);
  let current = path.parse(absolute).root;
  for (const part of parts) {
    current = path.join(current, part);
    let metadata: fs.Stats;
    try {
      metadata = fs.lstatSync(current);
    } catch (error) {
      return diagnostic(
        kind,
        absolute,
        `unavailable target: ${errorText(error)}`,
      );
    }
    if (metadata.isSymbolicLink()) {
      return diagnostic(
        kind,
        absolute,
        `symlink targets are not canonical FLI files: ${current}`,
      );
    }
  }

  try {
    if (!fs.statSync(absolute).isFile()) {
      return diagnostic(kind, absolute, "target is not a regular file");
    }
  } catch (error) {
    return diagnostic(
      kind,
      absolute,
      `unavailable target: ${errorText(error)}`,
    );
  }
  return undefined;
}

export function canonicalActualRead(
  value: string,
  baseDirectory: string = process.cwd(),
): { path?: string; diagnostic?: Diagnostic } {
  const absolute = lexicalNormalize(
    path.isAbsolute(value) ? value : path.resolve(baseDirectory, value),
  );
  const error = validateRegularFile(absolute, "actual-read");
  return error ? { diagnostic: error } : { path: absolute };
}

export function applicableBoundary(
  boundary: string,
  value: string,
): string | undefined {
  if (!path.isAbsolute(boundary)) return undefined;
  const normalized = lexicalNormalize(boundary);
  try {
    if (
      !fs.statSync(normalized).isDirectory() || !contains(normalized, value)
    ) {
      return undefined;
    }
  } catch {
    return undefined;
  }
  return normalized;
}

export function flRoot(
  value: string,
  directoryAnchor = false,
): string | undefined {
  let directory = directoryAnchor ? value : path.dirname(value);
  for (;;) {
    const marker = path.join(directory, ".frostline");
    try {
      if (fs.statSync(marker).isDirectory()) return directory;
    } catch {
      // Continue upward when no FLI marker exists here.
    }
    const parent = path.dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
}

export function gitRoot(
  value: string,
  directoryAnchor = false,
): string | undefined {
  let directory = directoryAnchor ? value : path.dirname(value);
  for (;;) {
    const git = path.join(directory, ".git");
    try {
      const metadata = fs.statSync(git);
      if (metadata.isFile()) return directory;
      if (metadata.isDirectory()) {
        try {
          if (fs.statSync(path.join(git, "HEAD")).isFile()) return directory;
        } catch {
          // An empty/incomplete .git directory is not a repository boundary.
        }
      }
    } catch {
      // Continue upward when no Git marker exists here.
    }
    const parent = path.dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
}

export function homeChildRoot(value: string): string | undefined {
  const home = process.env.HOME;
  if (!home) return undefined;
  const normalizedHome = path.resolve(home);
  const absolute = path.resolve(value);
  if (!contains(normalizedHome, absolute) || absolute === normalizedHome) {
    return undefined;
  }
  const relative = path.relative(normalizedHome, absolute);
  const first = relative.split(path.sep)[0];
  if (!first || first === "." || first === "..") return undefined;
  const candidate = path.join(normalizedHome, first);
  try {
    return fs.statSync(candidate).isDirectory() ? candidate : undefined;
  } catch {
    return undefined;
  }
}

export function graphBoundary(
  anchor: string,
  explicitRoot?: string,
  directoryAnchor = false,
): { root?: string; diagnostic?: Diagnostic } {
  if (explicitRoot !== undefined) {
    const root = graphProjectRoot(explicitRoot);
    if (root.diagnostic) return root;
    if (!contains(root.root!, anchor)) {
      return {
        diagnostic: diagnostic(
          "resolution",
          anchor,
          "graph anchor is outside the explicit root",
        ),
      };
    }
    return root;
  }

  const root = flRoot(anchor, directoryAnchor) ??
    gitRoot(anchor, directoryAnchor) ?? homeChildRoot(anchor);
  return root ? { root } : {
    diagnostic: diagnostic(
      "resolution",
      anchor,
      "cannot infer a safe graph boundary from `.frostline`, `.git`, or a top-level child of HOME; provide an explicit root",
    ),
  };
}

export function projectRoot(
  value: string,
  hints: { projectRoot?: string; workingDirectory?: string } = {},
): { root?: string; diagnostic?: Diagnostic } {
  return graphBoundary(value, hints.projectRoot);
}

export function graphProjectRoot(
  value: string,
): { root?: string; diagnostic?: Diagnostic } {
  const absolute = lexicalNormalize(path.resolve(value));
  let canonical: string;
  try {
    canonical = fs.realpathSync(absolute);
  } catch (error) {
    return {
      diagnostic: diagnostic(
        "resolution",
        absolute,
        `cannot resolve graph root: ${errorText(error)}`,
      ),
    };
  }
  try {
    if (!fs.statSync(canonical).isDirectory()) {
      return {
        diagnostic: diagnostic(
          "resolution",
          canonical,
          "graph root is not a directory",
        ),
      };
    }
  } catch (error) {
    return {
      diagnostic: diagnostic(
        "resolution",
        canonical,
        `cannot inspect graph root: ${errorText(error)}`,
      ),
    };
  }
  if (containsGitComponent(canonical)) {
    return {
      diagnostic: diagnostic(
        "resolution",
        canonical,
        "`.git` is outside FLI target space",
      ),
    };
  }
  return { root: canonical };
}

export function relativeIdentity(root: string, value: string): string {
  return toPosix(contains(root, value) ? path.relative(root, value) : value);
}

export function projectQualifiedIdentity(root: string, value: string): string {
  return `${root}\0${relativeIdentity(root, value)}`;
}

export function projectDiscriminator(root: string): string {
  const name = path.basename(root) || "scope";
  const digest = createHash("sha256").update(root).digest("hex").slice(0, 32);
  return `${name}@${digest}`;
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
