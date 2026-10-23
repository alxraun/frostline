// parents: @.frostline/graph/m-syntax.xml

import * as fs from "node:fs";
import * as path from "node:path";
import { StringDecoder } from "node:string_decoder";
import { type Diagnostic, diagnostic } from "../types.ts";

export type DeclarationKind = "parents";

export interface Selector {
  raw: string;
  order: number;
}

export interface Declaration {
  kind: DeclarationKind;
  selectors: Selector[];
}

export interface ParsedFile {
  declarations: Declaration[];
  diagnostics: Diagnostic[];
}

const htmlExtensions = new Set(["md", "markdown", "html", "xml"]);
const slashExtensions = new Set([
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
]);
const hashExtensions = new Set([
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
]);
const dashExtensions = new Set(["lua", "sql"]);
const iniExtensions = new Set(["ini", "conf", "cfg", "service", "desktop"]);
const frontmatterExtensions = new Set(["md", "markdown", "yaml", "yml"]);
const markupExtensions = new Set(["html", "xml", "md", "markdown"]);

export function supportsDeclarations(_value: string): boolean {
  return true;
}

export function readLeadingArea(value: string): string {
  const descriptor = fs.openSync(value, "r");
  try {
    const chunk = Buffer.alloc(4096);
    const decoder = new StringDecoder("utf8");
    let source = "";
    for (;;) {
      const count = fs.readSync(descriptor, chunk, 0, chunk.length, null);
      if (count === 0) return source + decoder.end();
      source += decoder.write(chunk.subarray(0, count));
      if (leadingAreaComplete(value, source)) return source;
    }
  } finally {
    fs.closeSync(descriptor);
  }
}

export function parse(value: string, source: string): ParsedFile {
  const result: ParsedFile = { declarations: [], diagnostics: [] };
  let order = 0;
  for (const comment of leadingComments(value, source)) {
    for (const rawLine of comment.split(/\r?\n/)) {
      const line = rawLine.trim().replaceAll(/^\*+/g, "").trim();
      if (line.startsWith("children:")) {
        result.diagnostics.push(
          diagnostic(
            "syntax",
            value,
            "FLI `children:` declarations are unsupported; declare the edge on each child with `parents:`",
          ),
        );
        continue;
      }
      const declaration = declarationLine(line);
      if (!declaration) continue;
      const selectors: Selector[] = [];
      for (const raw of splitSelectorList(declaration.rest)) {
        if (!raw.startsWith("@") || raw.length === 1) {
          result.diagnostics.push(
            diagnostic("syntax", value, `invalid FLI selector \`${raw}\``),
          );
          continue;
        }
        selectors.push({ raw, order });
        order += 1;
      }
      if (selectors.length === 0) {
        result.diagnostics.push(
          diagnostic(
            "syntax",
            value,
            "FLI parents declaration has no valid selectors",
          ),
        );
      } else {
        result.declarations.push({ kind: "parents", selectors });
      }
    }
  }
  return result;
}

function splitSelectorList(value: string): string[] {
  const result: string[] = [];
  let start = 0;
  let braceDepth = 0;
  let classDepth = 0;
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (character === "{") braceDepth += 1;
    else if (character === "}" && braceDepth > 0) braceDepth -= 1;
    else if (character === "[") classDepth += 1;
    else if (character === "]" && classDepth > 0) classDepth -= 1;
    else if (character === "," && braceDepth === 0 && classDepth === 0) {
      result.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  result.push(value.slice(start).trim());
  return result;
}

function declarationLine(
  line: string,
): { kind: DeclarationKind; rest: string } | undefined {
  if (line.startsWith("parents:")) {
    return { kind: "parents", rest: line.slice(8).trim() };
  }
  return undefined;
}

function leadingComments(value: string, source: string): string[] {
  const extensionName = extension(value);
  const text = strippedSource(source);
  if (text.includes("\0")) return [];
  if (htmlExtensions.has(extensionName)) {
    return htmlComments(skipPrelude(text, extensionName));
  }
  if (slashExtensions.has(extensionName)) {
    return slashComments(skipPrelude(text, extensionName));
  }
  if (hashExtensions.has(extensionName) || iniExtensions.has(extensionName)) {
    return lineComments(skipPrelude(text, extensionName), "#");
  }
  if (dashExtensions.has(extensionName)) {
    return lineComments(skipPrelude(text, extensionName), "--");
  }
  return autoComments(skipPrelude(text, extensionName));
}

function leadingAreaComplete(value: string, source: string): boolean {
  const extensionName = extension(value);
  const text = strippedSource(source);
  if (text.includes("\0")) return true;
  if (htmlExtensions.has(extensionName)) {
    return htmlAreaComplete(skipPrelude(text, extensionName));
  }
  if (slashExtensions.has(extensionName)) {
    return slashAreaComplete(skipPrelude(text, extensionName));
  }
  if (hashExtensions.has(extensionName) || iniExtensions.has(extensionName)) {
    return lineAreaComplete(skipPrelude(text, extensionName), "#");
  }
  if (dashExtensions.has(extensionName)) {
    return lineAreaComplete(skipPrelude(text, extensionName), "--");
  }
  return autoAreaComplete(skipPrelude(text, extensionName));
}

function strippedSource(source: string): string {
  let text = source.startsWith("﻿") ? source.slice(1) : source;
  if (text.startsWith("#!")) {
    const end = text.indexOf("\n");
    text = end < 0 ? "" : text.slice(end + 1);
  }
  return text;
}

function autoComments(text: string): string[] {
  const comments: string[] = [];
  for (;;) {
    text = text.replace(/^\s+/, "");
    if (text.startsWith("<!--")) {
      const end = text.indexOf("-->", 4);
      if (end < 0) break;
      comments.push(text.slice(4, end));
      text = text.slice(end + 3);
    } else if (text.startsWith("//")) {
      const end = text.indexOf("\n");
      comments.push(end < 0 ? text.slice(2) : text.slice(2, end));
      text = end < 0 ? "" : text.slice(end + 1);
    } else if (text.startsWith("#")) {
      const end = text.indexOf("\n");
      comments.push(end < 0 ? text.slice(1) : text.slice(1, end));
      text = end < 0 ? "" : text.slice(end + 1);
    } else if (text.startsWith("--")) {
      const end = text.indexOf("\n");
      comments.push(end < 0 ? text.slice(2) : text.slice(2, end));
      text = end < 0 ? "" : text.slice(end + 1);
    } else {
      break;
    }
  }
  return comments;
}

function autoAreaComplete(text: string): boolean {
  for (;;) {
    text = text.replace(/^\s+/, "");
    if (text.startsWith("<!--")) {
      const end = text.indexOf("-->", 4);
      if (end < 0) return false;
      text = text.slice(end + 3);
    } else if (text.startsWith("//") && text.includes("\n")) {
      text = text.slice(text.indexOf("\n") + 1);
    } else if (
      (text.startsWith("#") || text.startsWith("--")) && text.includes("\n")
    ) {
      text = text.slice(text.indexOf("\n") + 1);
    } else {
      return text.length > 0;
    }
  }
}

function skipPrelude(text: string, extensionName: string): string {
  for (;;) {
    const before = text;
    text = text.replace(/^\s+/, "");
    text = skipMarkupPrelude(text, extensionName);
    text = skipFrontmatterPrelude(text, extensionName);
    text = skipIniPrelude(text, extensionName);
    if (text === before) return text;
  }
}

function skipMarkupPrelude(text: string, extensionName: string): string {
  if (!markupExtensions.has(extensionName)) return text;
  if (/^<!doctype/i.test(text)) {
    const end = text.indexOf(">");
    return end < 0 ? "" : text.slice(end + 1);
  }
  if (text.startsWith("<?")) {
    const end = text.indexOf("?>");
    return end < 0 ? "" : text.slice(end + 2);
  }
  return text;
}

function skipFrontmatterPrelude(text: string, extensionName: string): string {
  if (!frontmatterExtensions.has(extensionName)) return text;
  const match = /^(-{3}|\+{3})[ \t]*\r?\n/.exec(text);
  if (!match) return text;
  const marker = match[1];
  let index = match[0].length;
  for (;;) {
    const end = text.indexOf("\n", index);
    if (end < 0) return text;
    if (text.slice(index, end).replace(/[ \t\r]+$/, "") === marker) {
      return text.slice(end + 1);
    }
    index = end + 1;
  }
}

function skipIniPrelude(text: string, extensionName: string): string {
  if (!iniExtensions.has(extensionName)) return text;
  while (text.startsWith("[")) {
    const end = text.indexOf("\n");
    if (end < 0) return "";
    text = text.slice(end + 1);
  }
  return text;
}

function htmlComments(text: string): string[] {
  const comments: string[] = [];
  for (;;) {
    text = text.replace(/^[\s]*/, "");
    if (!text.startsWith("<!--")) break;
    const end = text.indexOf("-->", 4);
    if (end < 0) break;
    comments.push(text.slice(4, end));
    text = text.slice(end + 3);
  }
  return comments;
}

function htmlAreaComplete(text: string): boolean {
  for (;;) {
    text = text.replace(/^[\s]*/, "");
    if (!text.startsWith("<!--")) return text.length > 0;
    const end = text.indexOf("-->", 4);
    if (end < 0) return false;
    text = text.slice(end + 3);
  }
}

function slashComments(text: string): string[] {
  const comments: string[] = [];
  for (;;) {
    text = text.replace(/^[\s]*/, "");
    if (text.startsWith("//")) {
      const end = text.indexOf("\n");
      comments.push(end < 0 ? text.slice(2) : text.slice(2, end));
      text = end < 0 ? "" : text.slice(end + 1);
    } else if (text.startsWith("/*")) {
      const end = text.indexOf("*/", 2);
      if (end < 0) break;
      comments.push(text.slice(2, end));
      text = text.slice(end + 2);
    } else {
      break;
    }
  }
  return comments;
}

function slashAreaComplete(text: string): boolean {
  for (;;) {
    text = text.replace(/^[\s]*/, "");
    if (text.startsWith("//")) {
      if (!text.includes("\n")) return false;
      text = text.slice(text.indexOf("\n") + 1);
    } else if (text.startsWith("/*")) {
      const end = text.indexOf("*/", 2);
      if (end < 0) return false;
      text = text.slice(end + 2);
    } else {
      return text.length > 0;
    }
  }
}

function lineComments(text: string, marker: string): string[] {
  const comments: string[] = [];
  for (;;) {
    text = text.replace(/^[\s]*/, "");
    if (!text.startsWith(marker)) break;
    const end = text.indexOf("\n");
    comments.push(
      end < 0 ? text.slice(marker.length) : text.slice(marker.length, end),
    );
    text = end < 0 ? "" : text.slice(end + 1);
  }
  return comments;
}

function lineAreaComplete(text: string, marker: string): boolean {
  for (;;) {
    text = text.replace(/^[\s]*/, "");
    if (!text.startsWith(marker)) return text.length > 0;
    if (!text.includes("\n")) return false;
    text = text.slice(text.indexOf("\n") + 1);
  }
}

function extension(value: string): string {
  return path.extname(value).slice(1).toLowerCase();
}
