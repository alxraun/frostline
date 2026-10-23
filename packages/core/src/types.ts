// parents: @.frostline/graph/ss-runtime.xml

export type DiagnosticKind =
  | "actual-read"
  | "syntax"
  | "resolution"
  | "graph"
  | "internal";

export interface Diagnostic {
  kind: DiagnosticKind;
  path?: string;
  message: string;
}

export interface ContextDocument {
  path: string;
  identity: string;
  project?: string;
  content: string;
}

export interface DeliveryScope {
  sessionId: string;
  contextId: string;
}

export interface AncestorsRequest {
  files: string[];
  deliveryScope?: DeliveryScope;
}

export interface CoreOutput {
  documents: ContextDocument[];
  diagnostics: Diagnostic[];
}

export interface DeliveredDocument {
  path: string;
  identity: string;
  project?: string;
}

export interface AncestorsOutput {
  context: string;
  /** Newly delivered documents in Core order, without content. */
  documents: DeliveredDocument[];
  diagnostics: Diagnostic[];
  stateWarnings: string[];
}

export interface GraphRequest {
  /** Existing regular file or directory used for boundary discovery. */
  anchor: string;
  /** Explicit scan boundary; must contain the anchor. */
  root?: string;
}

export interface GraphEdge {
  child: string;
  parent: string;
}

export interface GraphOutput {
  root?: string;
  /** Relative file identity, omitted when the anchor is a directory. */
  focus?: string;
  nodes: string[];
  edges: GraphEdge[];
  diagnostics: Diagnostic[];
}

export function diagnostic(
  kind: DiagnosticKind,
  path: string | undefined,
  message: string,
): Diagnostic {
  return { kind, path, message };
}

export function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function compareDiagnostics(
  left: Diagnostic,
  right: Diagnostic,
): number {
  return (
    compareText(left.kind, right.kind) ||
    compareText(left.path ?? "", right.path ?? "") ||
    compareText(left.message, right.message)
  );
}

export function dedupeDiagnostics(values: Diagnostic[]): Diagnostic[] {
  const seen = new Set<string>();
  const result: Diagnostic[] = [];
  for (const value of values.toSorted(compareDiagnostics)) {
    const key = `${value.kind}\0${value.path ?? ""}\0${value.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}
