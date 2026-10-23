// parents: @.frostline/graph/m-dsh-plugin.xml

import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  Config,
  CoreAncestorsOutput,
  CoreDeliveredDocument,
  CoreDiagnostic,
  CoreRunner,
  DshAgent,
  DshContext,
  DshSession,
  PostToolDecision,
  SkillRegistration,
  ToolExecution,
  ToolExecutionResult,
  UserMessage,
} from "./types.ts";

export const name = "frostline";
export const inject = ["tools", "skills", "sessions", "agents"];
export const testedDeepSeekHarnessVersion = "0.2.0-rc.2";

const CONTEXT_ID = "__main__";
// Only the canonical exported skill ships in the bundle; project-local skills
// (frostline-verification, frostline-logging) live in the project's .agents/skills.
const SKILL_NAMES = [
  "frostline-graph",
] as const;
const moduleDirectory = dirname(fileURLToPath(import.meta.url));

/** Shared integration UX diagnostic visibility from `docs/integration-ux.md`. */
export type DiagnosticsMode = "default" | "strict";

export interface DiagnosticsModeSelection {
  mode: DiagnosticsMode;
  /** Unsupported `FLI_DIAGNOSTICS` value; `default` applies while it is set. */
  invalid?: string;
}

export function resolveDiagnosticsMode(
  value: string | undefined,
): DiagnosticsModeSelection {
  if (value === undefined || value === "default") return { mode: "default" };
  if (value === "strict") return { mode: "strict" };
  return { mode: "default", invalid: value };
}

/** One configuration notice per harness session for an unsupported value. */
export function createUxMode() {
  let resolved = false;
  let selection: DiagnosticsModeSelection = { mode: "default" };
  let configNoticeShown = false;
  return {
    selection(): DiagnosticsModeSelection {
      if (!resolved) {
        resolved = true;
        selection = resolveDiagnosticsMode(process.env.FLI_DIAGNOSTICS);
      }
      return selection;
    },
    takeConfigNotice(): UserMessage[] {
      const { invalid } = this.selection();
      if (invalid === undefined || configNoticeShown) return [];
      configNoticeShown = true;
      return [
        createNotice(
          invalidConfigNoticeText(invalid),
          invalidConfigNoticeText(invalid),
        ),
      ];
    },
  };
}

export type UxMode = ReturnType<typeof createUxMode>;

function invalidConfigNoticeText(value: string): string {
  return `Frostline ignored unknown FLI_DIAGNOSTICS value "${value}", using default diagnostics.`;
}

/** Delivery notice names: project-relative paths, qualified on collision. */
export function deliveryDocumentNames(
  documents: CoreDeliveredDocument[],
): string[] {
  const seen = new Map<string, number>();
  for (const document of documents) {
    seen.set(document.path, (seen.get(document.path) ?? 0) + 1);
  }
  return documents.map((document) =>
    seen.get(document.path)! > 1 && document.project !== undefined
      ? `${document.project}:${document.path}`
      : document.path
  );
}

/** `docs/integration-ux.md` delivery message: three names inline, then total. */
export function deliveryMessage(documents: CoreDeliveredDocument[]): string {
  const names = deliveryDocumentNames(documents);
  if (names.length <= 3) {
    return `Frostline context added for ${names.join(", ")}.`;
  }
  const omitted = names.length - 3;
  return `Frostline context added for ${
    names.slice(0, 3).join(", ")
  } and ${omitted} more files.`;
}

/** Core output without `documents`: recover the delivery order from its XML. */
function documentsOf(output: CoreAncestorsOutput): CoreDeliveredDocument[] {
  if (output.documents !== undefined) return output.documents;
  return [...output.context.matchAll(/<[a-z_][a-z0-9-]* path="([^"]*)"/g)]
    .map((
      match,
    ) => ({ path: match[1], identity: match[1] }));
}

export function apply(ctx: DshContext, config: Config = {}): void {
  applyWithRunner(ctx, config, createCoreRunner(config.ppPath));
}

export function applyWithRunner(
  ctx: DshContext,
  config: Config,
  runner: CoreRunner,
): void {
  assertHarnessSurface(ctx);
  registerBundledSkills(
    ctx,
    config.skillsPath ?? resolve(moduleDirectory, "../skills"),
  );
  const uxMode = createUxMode();

  ctx.on("agent/session-start", ({ agent, source }) => {
    const notices: UserMessage[] = [];
    try {
      notices.push(...uxMode.takeConfigNotice());
      const sessionId = sessionIdOfAgent(agent);
      if (source === "startup" || source === "clear") {
        notices.push(...warningsToNotices(runner.resetSession(sessionId)));
      }
      if (source !== "compact") {
        notices.unshift(
          createNotice(
            "Frostline is active for this session.",
            "Frostline session",
          ),
        );
      }
    } catch (error) {
      notices.push(errorNotice(error, "session"));
    }
    for (const notice of notices) agent.inject(notice);
  });

  ctx.on(
    "session/event",
    (session, event) => {
      if (event.type !== "compaction/end") return;
      const sessionId = sessionIdOfSession(session);
      if (sessionId === undefined) return;
      try {
        const warnings = runner.resetContext(sessionId, CONTEXT_ID);
        const agent = ctx.agents.get(sessionId);
        if (agent) {
          for (const notice of warningsToNotices(warnings)) {
            agent.inject(notice);
          }
        }
      } catch (error) {
        ctx.agents.get(sessionId)?.inject(errorNotice(error, "session"));
      }
    },
    { global: true },
  );

  ctx.on("tools/post-execute", async (exec, result, next) => {
    const downstream = await next();
    let files: string[];
    try {
      files = observedFiles(config, exec, result, downstream);
    } catch (error) {
      // Explicit operational diagnostic; the original tool result is never
      // replaced or rejected (SS-DEEPSEEK-HARNESS.REQ-005).
      return withContexts(downstream, [errorNotice(error, "read")]);
    }
    if (files.length === 0) return downstream;
    const agent = exec.agent;
    if (agent === undefined) {
      return withContexts(downstream, [
        createNotice(
          "Frostline skipped context delivery because the session identity was unavailable.",
          "Frostline skipped delivery",
        ),
      ]);
    }
    const cwd = agent.session.header.cwd;
    const notices: UserMessage[] = [];
    try {
      const sessionId = sessionIdOfAgent(agent);
      for (const file of files) {
        const output = runner.ancestors({
          file,
          cwd,
          sessionId,
          contextId: CONTEXT_ID,
        });
        notices.push(
          ...uxMode.takeConfigNotice(),
          ...outputNotices(output, uxMode.selection().mode),
        );
      }
    } catch (error) {
      notices.push(errorNotice(error, "read"));
    }
    return withContexts(downstream, notices);
  });
}

/** Observation union: native `read` first, deterministic bash classification second. */
function observedFiles(
  config: Config,
  exec: ToolExecution,
  result: ToolExecutionResult,
  downstream: PostToolDecision,
): string[] {
  const file = observedReadPath(exec, result, downstream);
  if (file !== undefined) return [file];
  const command = observedBashCommand(exec, result, downstream);
  if (command === undefined) return [];
  return bashReadFiles(config, command, reliableCommandCwd(exec));
}

/**
 * The reliable cwd of the classified command itself: an absolute `workdir`
 * argument wins over the session cwd. Never substituted silently — when
 * neither is absolute, relative classified paths stay unresolved and are
 * safely skipped downstream (M-READ-CLASSIFIER.REQ-002).
 */
export function reliableCommandCwd(exec: ToolExecution): string | undefined {
  if (
    isRecord(exec.arguments) &&
    typeof exec.arguments.workdir === "string" &&
    isAbsolute(exec.arguments.workdir)
  ) {
    return exec.arguments.workdir;
  }
  const session = exec.agent?.session.header.cwd;
  return typeof session === "string" && isAbsolute(session)
    ? session
    : undefined;
}

function registerBundledSkills(ctx: DshContext, root: string): void {
  for (const expectedName of SKILL_NAMES) {
    const file = resolve(root, expectedName, "SKILL.md");
    const skill = parseSkillDocument(readFileSync(file, "utf8"), file);
    if (skill.name !== expectedName) {
      throw new Error(
        `FLI skill ${file} declares name ${skill.name}; expected ${expectedName}`,
      );
    }
    ctx.skills.register(skill);
  }
}

function parseSkillDocument(source: string, path: string): SkillRegistration {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (match === null) {
    throw new Error(`FLI skill ${path} has no YAML frontmatter`);
  }
  const frontmatter = match[1];
  const name = frontmatterString(frontmatter, "name", path);
  const description = frontmatterString(frontmatter, "description", path);
  const disableModelInvocation = frontmatterBoolean(
    frontmatter,
    "disable-model-invocation",
    path,
    false,
  );
  const userInvocable = frontmatterBoolean(
    frontmatter,
    "user-invocable",
    path,
    true,
  );
  return {
    name,
    description,
    source: "bundled",
    path,
    resourceBase: { kind: "directory", path: dirname(path) },
    invocation: {
      modelInvocable: !disableModelInvocation,
      userInvocable,
    },
    content: match[2],
  };
}

function frontmatterString(
  frontmatter: string,
  key: string,
  path: string,
): string {
  const prefix = `${key}:`;
  const line = frontmatter.split(/\r?\n/).find((value) =>
    value.startsWith(prefix)
  );
  if (line === undefined) throw new Error(`FLI skill ${path} has no ${key}`);
  const raw = line.slice(prefix.length).trim();
  if (raw.length === 0) throw new Error(`FLI skill ${path} has empty ${key}`);
  if (raw.startsWith('"')) {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "string" || parsed.length === 0) {
      throw new Error(`FLI skill ${path} has invalid ${key}`);
    }
    return parsed;
  }
  if (raw.startsWith("'") && raw.endsWith("'")) {
    return raw.slice(1, -1).replaceAll("''", "'");
  }
  return raw;
}

function frontmatterBoolean(
  frontmatter: string,
  key: string,
  path: string,
  defaultValue: boolean,
): boolean {
  const prefix = `${key}:`;
  const line = frontmatter.split(/\r?\n/).find((value) =>
    value.startsWith(prefix)
  );
  if (line === undefined) return defaultValue;
  const raw = line.slice(prefix.length).trim();
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new Error(`FLI skill ${path} has invalid ${key}`);
}

export function observedReadPath(
  exec: ToolExecution,
  result: ToolExecutionResult,
  downstream: PostToolDecision,
): string | undefined {
  if (exec.name !== "read" || result.isError) return undefined;
  if (!acceptedUnmodified(downstream)) return undefined;
  if (!isRecord(result.value)) return undefined;
  const path = result.value.path;
  return typeof path === "string" && path.length > 0 ? path : undefined;
}

/**
 * Secondary observation tier (`S-INTEGRATION.PRIN-002`): a successful,
 * accepted unmodified `bash` result contributes its command for deterministic
 * read classification; ambiguous commands classify to nothing downstream.
 */
export function observedBashCommand(
  exec: ToolExecution,
  result: ToolExecutionResult,
  downstream: PostToolDecision,
): string | undefined {
  if (exec.name !== "bash" || result.isError) return undefined;
  if (!acceptedUnmodified(downstream)) return undefined;
  if (!isRecord(exec.arguments)) return undefined;
  const command = exec.arguments.command;
  return typeof command === "string" && command.trim().length > 0
    ? command
    : undefined;
}

function acceptedUnmodified(downstream: PostToolDecision): boolean {
  if (downstream.kind !== "accept") return false;
  return !Object.prototype.hasOwnProperty.call(downstream, "content") &&
    !Object.prototype.hasOwnProperty.call(downstream, "value");
}

export function withContexts(
  decision: PostToolDecision,
  contexts: UserMessage[],
): PostToolDecision {
  if (contexts.length === 0) return decision;
  return {
    ...decision,
    additionalContexts: [
      ...contexts,
      ...(decision.additionalContexts ?? []),
    ],
  };
}

export function createNotice(text: string, summary: string): UserMessage {
  return {
    id: randomUUID(),
    role: "user",
    content: [{ type: "text", text }],
    source: {
      kind: "fli",
      form: "notice",
      summary: boundSummary(summary),
    },
  };
}

export function outputNotices(
  output: CoreAncestorsOutput,
  mode: DiagnosticsMode = "default",
): UserMessage[] {
  const notices: UserMessage[] = [];
  const documents = documentsOf(output);
  const hasDelivery = output.context.length > 0;
  // Default mode shows operational diagnostics; strict adds declaration and
  // selector diagnostics per `docs/integration-ux.md`.
  const visibleDiagnostics = mode === "strict"
    ? output.diagnostics
    : output.diagnostics.filter(isOperationalDiagnostic);
  const diagnosticText = renderDiagnostics(visibleDiagnostics);
  if (hasDelivery) {
    // One read event -> at most one delivery notice; a diagnostic shares
    // the delivery message per `docs/integration-ux.md`.
    const message = diagnosticText.length > 0
      ? `${deliveryMessage(documents)} Note: ${diagnosticText}.`
      : deliveryMessage(documents);
    notices.push(createNotice(output.context, message));
  } else if (diagnosticText.length > 0) {
    notices.push(createNotice(diagnosticText, diagnosticText));
  }
  // Default mode hides self-recovering delivery-state warnings; strict shows
  // every state warning.
  const visibleWarnings = mode === "strict"
    ? output.stateWarnings
    : output.stateWarnings.filter((warning) =>
      !warning.includes("reinjecting safely")
    );
  const warningText = renderWarnings(visibleWarnings);
  if (warningText.length > 0) {
    notices.push(createNotice(warningText, "Frostline warning"));
  }
  return notices;
}

function isOperationalDiagnostic(diagnostic: CoreDiagnostic): boolean {
  return diagnostic.kind !== "syntax" && diagnostic.kind !== "resolution";
}

/**
 * Deterministic bash read classification (`packages/read-classifier`): the
 * classifier owns command parsing only; this adapter owns path resolution,
 * deduplication, and model-visibility decisions.
 */
export function bashReadFiles(
  config: Config,
  command: string,
  cwd: string | undefined,
): string[] {
  const executable = config.classifierPath ??
    resolve(moduleDirectory, "../bin/fli-classify-reads");
  const request = JSON.stringify({ commands: [command] });
  const result = spawnSync(executable, {
    input: request,
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() ||
      `exit status ${result.status ?? "unknown"}`;
    throw new Error(`Frostline read classifier failed: ${detail}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout);
  } catch (error) {
    throw new Error("Frostline read classifier returned invalid JSON", {
      cause: error,
    });
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.reads)) {
    throw new Error(
      "Frostline read classifier protocol error: reads is not an array",
    );
  }
  const files: string[] = [];
  for (const value of parsed.reads) {
    if (typeof value !== "string" || value.length === 0) continue;
    const file = isAbsolute(value)
      ? value
      : cwd !== undefined && isAbsolute(cwd)
      ? resolve(cwd, value)
      : undefined;
    // A relative read with an unknown reliable cwd is safely skipped, never
    // guessed against session state.
    if (file !== undefined && !files.includes(file)) files.push(file);
  }
  return files;
}

export function createCoreRunner(ppPath?: string): CoreRunner {
  const executable = ppPath ?? resolve(moduleDirectory, "../bin/fli");
  return {
    ancestors(input) {
      if (!isAbsolute(input.file) && (!input.cwd || !isAbsolute(input.cwd))) {
        throw new Error(
          "FLI requires an absolute observed file path or a reliable absolute read cwd",
        );
      }
      const file = isAbsolute(input.file)
        ? input.file
        : resolve(input.cwd!, input.file);
      const args = [
        "ancestors",
        file,
        "--session",
        input.sessionId,
        "--context",
        input.contextId,
        "--json",
      ];
      return parseAncestorsOutput(runCore(executable, args));
    },
    resetSession(sessionId) {
      return parseResetOutput(
        runCore(executable, [
          "reset-session",
          "--session",
          sessionId,
          "--json",
        ]),
      );
    },
    resetContext(sessionId, contextId) {
      return parseResetOutput(
        runCore(executable, [
          "reset-context",
          "--session",
          sessionId,
          "--context",
          contextId,
          "--json",
        ]),
      );
    },
  };
}

function runCore(executable: string, args: string[]): unknown {
  const result = spawnSync(executable, args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() ||
      `exit status ${result.status ?? "unknown"}`;
    throw new Error(`Frostline Core failed: ${detail}`);
  }
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error("Frostline Core returned invalid JSON", {
      cause: error,
    });
  }
}

function parseAncestorsOutput(value: unknown): CoreAncestorsOutput {
  if (!isRecord(value)) {
    throw invalidCoreOutput("ancestors output is not an object");
  }
  if (typeof value.context !== "string") {
    throw invalidCoreOutput("ancestors output context is not a string");
  }
  const diagnostics = parseDiagnostics(value.diagnostics);
  const stateWarnings = parseStringArray(value.stateWarnings, "stateWarnings");
  return { context: value.context, diagnostics, stateWarnings };
}

function parseResetOutput(value: unknown): string[] {
  if (!isRecord(value)) {
    throw invalidCoreOutput("reset output is not an object");
  }
  return parseStringArray(value.stateWarnings, "stateWarnings");
}

function parseDiagnostics(value: unknown): CoreDiagnostic[] {
  if (!Array.isArray(value)) {
    throw invalidCoreOutput("diagnostics is not an array");
  }
  return value.map((item) => {
    if (!isRecord(item)) throw invalidCoreOutput("diagnostic is not an object");
    if (typeof item.kind !== "string" || typeof item.message !== "string") {
      throw invalidCoreOutput("diagnostic kind/message is invalid");
    }
    if (item.path !== undefined && typeof item.path !== "string") {
      throw invalidCoreOutput("diagnostic path is invalid");
    }
    return {
      kind: item.kind,
      message: item.message,
      ...(item.path === undefined ? {} : { path: item.path }),
    };
  });
}

function parseStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw invalidCoreOutput(`${field} is not a string array`);
  }
  return [...value];
}

function invalidCoreOutput(message: string): Error {
  return new Error(`Frostline Core protocol error: ${message}`);
}

function warningsToNotices(warnings: string[]): UserMessage[] {
  return warnings.length === 0 ? [] : [
    createNotice(
      warnings.map((value) => `Frostline warning: ${value}`).join("\n"),
      "Frostline warning",
    ),
  ];
}

function errorNotice(error: unknown, context: "read" | "session"): UserMessage {
  const message = error instanceof Error ? error.message : String(error);
  const text = context === "read"
    ? `Frostline could not enrich this read: ${message}. The file was read normally.`
    : `Frostline could not complete this session operation: ${message}.`;
  return createNotice(text, "Frostline error");
}

function renderDiagnostics(diagnostics: CoreDiagnostic[]): string {
  // Core owns diagnostic facts; the message already identifies the observed
  // file and the selector when available (`docs/integration-ux.md`).
  return diagnostics.map((value) => `Frostline note: ${value.message}`).join(
    "; ",
  );
}

function renderWarnings(warnings: string[]): string {
  return warnings.map((value) => `Frostline warning: ${value}`).join("\n");
}

function boundSummary(summary: string): string {
  return summary.length <= 120 ? summary : `${summary.slice(0, 119)}…`;
}

function sessionIdOfAgent(agent: DshAgent): string {
  const value = agent.session.header.id ?? agent.id;
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("DeepSeek Harness supplied no reliable session identity");
  }
  return value;
}

function sessionIdOfSession(session: DshSession): string | undefined {
  const value = session.header?.id ?? session.id;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function assertHarnessSurface(ctx: DshContext): void {
  if (
    typeof ctx.on !== "function" ||
    typeof ctx.skills?.register !== "function" ||
    typeof ctx.agents?.get !== "function"
  ) {
    throw new Error(
      `Unsupported DeepSeek Harness API; Frostline is tested with ${testedDeepSeekHarnessVersion}`,
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
