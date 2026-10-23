// parents: @.frostline/graph/m-resolution.xml

import * as path from "node:path";
import type { Diagnostic } from "../types.ts";
import type { Selector } from "./syntax.ts";

export interface CompiledSelector {
  literal: string;
}

export interface ResolutionOutcome {
  level?: string;
  matches: string[];
  diagnostics: Diagnostic[];
}

export function compileSelector(selector: Selector): CompiledSelector {
  if (selector.raw.length === 0 || !selector.raw.startsWith("@")) {
    throw new Error("selector must begin with `@`");
  }
  const raw = selector.raw.slice(1);
  if (raw.length === 0) throw new Error("selector path is empty");
  if (path.isAbsolute(raw) || raw.split("/").includes("..")) {
    throw new Error("selector must be a non-escaping relative path");
  }
  if (raw.split("/").includes(".git")) {
    throw new Error("`.git` is outside FLI target space");
  }
  if (/[*?\[\]{}\\]/.test(raw)) {
    throw new Error(
      "glob selectors are unsupported; `parents` accepts literal paths only",
    );
  }
  return { literal: path.posix.normalize(raw) };
}

export function selectorMatches(
  compiled: CompiledSelector,
  relative: string,
): boolean {
  return compiled.literal === relative;
}

export function upwardLevels(value: string, stop?: string): string[] {
  const normalizedStop = stop === undefined ? undefined : path.resolve(stop);
  const levels: string[] = [];
  let current = path.resolve(value);
  for (;;) {
    levels.push(current);
    if (normalizedStop !== undefined && current === normalizedStop) break;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return levels;
}

export function selectorError(selector: Selector, error: unknown): string {
  return `selector \`${selector.raw}\` is invalid: ${
    error instanceof Error ? error.message : String(error)
  }`;
}
