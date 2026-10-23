// parents: @.frostline/graph/m-dsh-plugin.xml

export interface TextBlock {
  type: "text";
  text: string;
}

/** Producer-owned v4 source; dsh 0.2.x retired `kind: "plugin"` wrappers. */
export interface ProducerSource {
  kind: "fli";
  form: "notice";
  summary: string;
}

export interface UserMessage {
  id: string;
  role: "user";
  content: TextBlock[];
  source: ProducerSource;
}

export interface DshAgent {
  id: string;
  session: {
    header: {
      id?: string;
      cwd?: string;
    };
  };
  inject(message: UserMessage): void;
}

export type SessionStartSource = "startup" | "resume" | "clear" | "compact";

export interface ToolExecution {
  name: string;
  arguments: unknown;
  agent?: DshAgent;
}

export interface ToolExecutionSuccess {
  isError: false;
  value: unknown;
  content: unknown[];
  additionalContexts?: UserMessage[];
}

export interface ToolExecutionFailure {
  isError: true;
  content: unknown[];
  additionalContexts?: UserMessage[];
}

export type ToolExecutionResult = ToolExecutionSuccess | ToolExecutionFailure;

export type PostToolDecision =
  | {
    kind: "accept";
    content?: unknown[];
    value?: unknown;
    additionalContexts?: UserMessage[];
  }
  | {
    kind: "block";
    feedback: unknown[];
    additionalContexts?: UserMessage[];
  };

export interface DshSession {
  id?: string;
  header?: { id?: string; cwd?: string };
}

export interface DshSessionEvent {
  type: string;
}

export interface SkillInvocationPolicy {
  modelInvocable: boolean;
  userInvocable: boolean;
}

export interface SkillRegistration {
  path?: string;
  name: string;
  description: string;
  source: string;
  resourceBase?: { kind: "directory"; path: string };
  invocation?: SkillInvocationPolicy;
  content: string;
}

export interface DshContext {
  skills: {
    register(skill: SkillRegistration): unknown;
  };
  agents: {
    get(id: string): DshAgent | undefined;
  };
  on(
    event: "tools/post-execute",
    listener: (
      exec: ToolExecution,
      result: ToolExecutionResult,
      next: () => Promise<PostToolDecision>,
    ) => Promise<PostToolDecision>,
  ): unknown;
  on(
    event: "agent/session-start",
    listener: (payload: {
      agent: DshAgent;
      source: SessionStartSource;
    }) => void,
  ): unknown;
  on(
    event: "session/event",
    listener: (session: DshSession, event: DshSessionEvent) => void,
    options?: { global?: boolean },
  ): unknown;
}

export interface CoreDiagnostic {
  kind: string;
  path?: string;
  message: string;
}

export interface CoreDeliveredDocument {
  path: string;
  identity: string;
  project?: string;
}

export interface CoreAncestorsOutput {
  context: string;
  /** Newly delivered documents in Core order; absent in older Core output. */
  documents?: CoreDeliveredDocument[];
  diagnostics: CoreDiagnostic[];
  stateWarnings: string[];
}

export interface CoreAncestorsInput {
  file: string;
  cwd?: string;
  sessionId: string;
  contextId: string;
}

export interface CoreRunner {
  ancestors(input: CoreAncestorsInput): CoreAncestorsOutput;
  resetSession(sessionId: string): string[];
  resetContext(sessionId: string, contextId: string): string[];
}

export interface Config {
  ppPath?: string;
  /** Override for the bundled `fli-classify-reads` classifier binary. */
  classifierPath?: string;
  skillsPath?: string;
}
