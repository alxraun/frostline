// parents: @.frostline/graph/m-knowledge-schema.xml

export interface KnowledgeValidation {
  valid: boolean;
  errors: string[];
}

export const knowledgeTiers = [
  "project",
  "system",
  "subsystem",
  "module",
  "verification",
] as const;

export type KnowledgeTier = (typeof knowledgeTiers)[number];

export const tierFields: Record<KnowledgeTier, readonly string[]> = {
  project: ["Purpose", "Scope", "Principles", "Technology", "Codemap"],
  system: ["Purpose", "Scope", "Principles", "Requirements", "Codemap"],
  subsystem: ["Purpose", "Scope", "Principles", "Requirements", "Codemap"],
  module: ["Purpose", "Scope", "Requirements", "Contract", "Codemap"],
  verification: ["Command", "TestFiles", "Scenarios"],
};

export const statementPrefixes = [
  "SCP-IN",
  "SCP-OUT",
  "PRIN",
  "TECH",
  "REQ",
  "IN",
  "OUT",
  "EFF",
  "SCN",
] as const;

const tierPatterns: Array<{ tier: KnowledgeTier; pattern: RegExp }> = [
  { tier: "verification", pattern: /^V-(?:P|SS|S|M)-[A-Z0-9-]+$/ },
  { tier: "project", pattern: /^P-[A-Z0-9-]+$/ },
  { tier: "system", pattern: /^S-[A-Z0-9-]+$/ },
  { tier: "subsystem", pattern: /^SS-[A-Z0-9-]+$/ },
  { tier: "module", pattern: /^M-[A-Z0-9-]+$/ },
];

const statementPattern = /^([A-Z]+(?:-[A-Z]+)?)-(\d{3})$/;

export function tierOf(nodeId: string): KnowledgeTier | undefined {
  return tierPatterns.find((entry) => entry.pattern.test(nodeId))?.tier;
}

interface Element {
  tag: string;
  attributes: Map<string, string>;
  children: Element[];
  text: string;
  cdata: string[];
}

export function validateKnowledge(content: string): KnowledgeValidation {
  const errors: string[] = [];
  let document: Element;
  try {
    document = parseXml(content, errors);
  } catch (error) {
    return {
      valid: false,
      errors: [
        ...errors,
        `knowledge file is not parseable XML: ${
          error instanceof Error ? error.message : String(error)
        }`,
      ],
    };
  }

  const tier = tierOf(document.tag);
  if (tier === undefined) {
    errors.push(
      `root tag \`${document.tag}\` does not match a known tier node ID`,
    );
  }

  const allowed = tier === undefined ? undefined : new Set(tierFields[tier]);
  const seen = new Set<string>();
  for (const field of document.children) {
    if (allowed !== undefined && !allowed.has(field.tag)) {
      errors.push(
        `field \`${field.tag}\` is not allowed for tier \`${tier}\``,
      );
      continue;
    }
    if (seen.has(field.tag)) {
      errors.push(`field \`${field.tag}\` appears more than once`);
    }
    seen.add(field.tag);
    validateField(field, errors);
  }

  return { valid: errors.length === 0, errors };
}

function validateField(field: Element, errors: string[]): void {
  if (field.tag === "Purpose") {
    if (field.children.length > 0) {
      errors.push("`Purpose` must be direct text without child elements");
    }
    if (field.text.trim().length === 0) {
      errors.push("`Purpose` must not be empty");
    }
    return;
  }
  if (field.tag === "Codemap") {
    validateCodemap(field, errors);
    return;
  }
  if (field.tag === "SideEffects") {
    if (field.children.length === 0) {
      errors.push("`SideEffects` must contain `<None />` or EFF statements");
    } else if (
      field.children.length === 1 &&
      field.children[0].tag === "None" &&
      field.children[0].children.length === 0
    ) {
      return;
    } else {
      validateStatements(field, errors);
    }
    return;
  }
  if (field.tag === "Command" || field.tag === "TestFiles") {
    if (field.tag === "TestFiles") {
      for (const file of field.children) {
        if (file.tag !== "File") {
          errors.push("`TestFiles` accepts only `<File>` entries");
        }
      }
    }
    return;
  }
  if (field.children.length === 0) {
    if (field.tag === "TestFiles" || field.tag === "Scenarios") return;
    if (field.text.trim().length === 0) {
      errors.push(`field \`${field.tag}\` is empty`);
    }
    return;
  }
  validateStatements(field, errors);
}

function validateStatements(container: Element, errors: string[]): void {
  const expected = new Map<string, number>();
  for (const statement of container.children) {
    const match = statementPattern.exec(statement.tag);
    if (match === null) {
      if (isStructuralGroup(container.tag, statement.tag)) {
        if (statement.tag !== "None") validateStatements(statement, errors);
      } else {
        errors.push(
          `statement tag \`${statement.tag}\` in \`${container.tag}\` is not ` +
            "a registered prefix with a three-digit number",
        );
      }
      continue;
    }
    if (!statementPrefixes.includes(match[1] as never)) {
      errors.push(`unregistered statement prefix \`${match[1]}\``);
    }
    const number = Number(match[2]);
    const next = (expected.get(match[1]) ?? 0) + 1;
    expected.set(match[1], next);
    if (number !== next) {
      errors.push(
        `statement \`${statement.tag}\` breaks incremental numbering in ` +
          `\`${container.tag}\`; expected ${String(next).padStart(3, "0")}`,
      );
    }
    if (statement.children.length > 0) {
      errors.push(`statement \`${statement.tag}\` must be direct text`);
      continue;
    }
    if (statement.tag.startsWith("SCN-")) {
      validateScenario(statement, errors);
    }
  }
}

const structuralGroups = new Set(["Inputs", "Outputs", "SideEffects", "File"]);

function isStructuralGroup(parentTag: string, tag: string): boolean {
  if (tag === "File") return parentTag === "TestFiles";
  if (tag === "None") return parentTag === "SideEffects";
  return structuralGroups.has(tag);
}

function validateScenario(statement: Element, errors: string[]): void {
  const target = statement.attributes.get("target");
  if (target === undefined) {
    errors.push(`\`${statement.tag}\` is missing a \`target\` attribute`);
    return;
  }
  if (!isFqid(target)) {
    errors.push(
      `\`${statement.tag}\` target \`${target}\` is not a valid FQID ` +
        "of the form `NODE-ID.STATEMENT-ID`",
    );
  }
}

export function isFqid(value: string): boolean {
  const dot = value.indexOf(".");
  if (dot <= 0 || dot === value.length - 1) return false;
  const nodeId = value.slice(0, dot);
  const statementId = value.slice(dot + 1);
  return tierOf(nodeId) !== undefined && statementPattern.test(statementId);
}

function validateCodemap(field: Element, errors: string[]): void {
  if (field.cdata.length === 0) {
    errors.push("`Codemap` must be wrapped in CDATA");
  }
  if (field.text.trim().length > 0) {
    errors.push("`Codemap` content must live inside CDATA only");
  }
  for (const section of field.cdata) {
    if (!/^[\w\s`\-+*/.,:;()[\]|&<>=!'"@#]*$/.test(section)) {
      errors.push(
        "`Codemap` content is restricted to identifiers and relation operators",
      );
    }
  }
}

function parseXml(content: string, errors: string[]): Element {
  const source = content.replace(/^\uFEFF/, "").replace(
    /<\?[\s\S]*?\?>/g,
    (match) => " ".repeat(match.length),
  ).replace(/<!--[\s\S]*?-->/g, (match) => " ".repeat(match.length));

  const root = parseElement(source, 0, errors);
  if (root === undefined) throw new Error("no root element found");
  const rest = skipWhitespace(source, root.end);
  if (rest < source.length) {
    throw new Error("trailing content after the root element");
  }
  return root.element;
}

function parseElement(
  source: string,
  start: number,
  errors: string[],
): { element: Element; end: number } | undefined {
  const open = source.indexOf("<", start);
  if (open < 0) return undefined;
  const nameMatch =
    /^<([A-Za-z][A-Za-z0-9-]*)((?:\s+[\w-]+\s*=\s*"[^"]*")*)\s*(\/?)>/
      .exec(source.slice(open));
  if (nameMatch === null) throw new Error(`invalid tag near index ${open}`);
  const element: Element = {
    tag: nameMatch[1],
    attributes: parseAttributes(nameMatch[2] ?? ""),
    children: [],
    text: "",
    cdata: [],
  };
  if (nameMatch[3] === "/") return { element, end: open + nameMatch[0].length };

  let cursor = open + nameMatch[0].length;
  for (;;) {
    const next = source.indexOf("<", cursor);
    if (next < 0) throw new Error(`unclosed tag \`${element.tag}\``);
    element.text += decodeEntities(source.slice(cursor, next));
    if (source.startsWith("<![CDATA[", next)) {
      const close = source.indexOf("]]>", next);
      if (close < 0) throw new Error("unterminated CDATA section");
      element.cdata.push(source.slice(next + 9, close));
      cursor = close + 3;
      continue;
    }
    if (source.startsWith("</", next)) {
      const close = source.indexOf(">", next);
      if (close < 0) throw new Error("unterminated closing tag");
      const closing = source.slice(next + 2, close).trim();
      if (closing !== element.tag) {
        throw new Error(
          `closing tag \`${closing}\` does not match \`${element.tag}\``,
        );
      }
      return { element, end: close + 1 };
    }
    const child = parseElement(source, next, errors);
    if (child === undefined) throw new Error(`unclosed tag \`${element.tag}\``);
    element.children.push(child.element);
    cursor = child.end;
  }
}

function parseAttributes(source: string): Map<string, string> {
  const attributes = new Map<string, string>();
  for (const match of source.matchAll(/([\w-]+)\s*=\s*"([^"]*)"/g)) {
    attributes.set(match[1], decodeEntities(match[2]));
  }
  return attributes;
}

function decodeEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function skipWhitespace(source: string, index: number): number {
  let cursor = index;
  while (cursor < source.length && /\s/.test(source[cursor])) cursor += 1;
  return cursor;
}
