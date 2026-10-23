// parents: @.frostline/graph/m-context.xml

import type { ContextDocument } from "../types.ts";

export function renderContext(documents: ContextDocument[]): string {
  if (documents.length === 0) return "";
  let output = "<frostline-context>\n";
  const tags = documentTags(documents);
  for (const [index, document] of documents.entries()) {
    const project = document.project === undefined
      ? ""
      : ` project="${escapeAttribute(document.project)}"`;
    const tag = tags[index];
    output += `<${tag} path="${
      escapeAttribute(document.path)
    }"${project}>\n<![CDATA[`;
    output += document.content.replaceAll("]]>", "]]]]><![CDATA[>");
    output += `]]>\n</${tag}>\n`;
  }
  return `${output}</frostline-context>`;
}

/**
 * A document element carries its project-relative path as a kebab-case tag so
 * every closing tag is unambiguous. A collision receives an identity suffix.
 */
function documentTags(documents: ContextDocument[]): string[] {
  const bases = documents.map((document) => kebab(document.path));
  const counts = new Map<string, number>();
  for (const tag of bases) counts.set(tag, (counts.get(tag) ?? 0) + 1);

  const used = new Map<string, number>();
  return documents.map((document, index) => {
    const base = bases[index];
    let tag = counts.get(base) === 1
      ? base
      : `${base}-id-${identityHex(document.identity)}`;
    const occurrence = (used.get(tag) ?? 0) + 1;
    used.set(tag, occurrence);
    if (occurrence > 1) tag = `${tag}-${occurrence}`;
    return tag;
  });
}

function kebab(value: string): string {
  const normalized = value.normalize("NFKD")
    .replace(/\p{Mark}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (normalized.length === 0) return "document";
  return /^[a-z_]/.test(normalized) ? normalized : `x-${normalized}`;
}

function identityHex(identity: string): string {
  let output = "";
  for (const byte of new TextEncoder().encode(identity)) {
    output += byte.toString(16).padStart(2, "0");
  }
  return output;
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
