// parents: @.frostline/graph/v-m-dsh-plugin.xml

import * as path from "node:path";
import {
  applyWithRunner,
  createNotice,
  createUxMode,
  observedReadPath,
  outputNotices,
  resolveDiagnosticsMode,
  withContexts,
} from "../../../integrations/deepseek-harness/src/index.ts";
import {
  CoreAncestorsInput,
  CoreRunner,
  DshAgent,
  DshContext,
  DshSession,
  DshSessionEvent,
  PostToolDecision,
  SessionStartSource,
  SkillRegistration,
  ToolExecution,
  ToolExecutionResult,
  UserMessage,
} from "../../../integrations/deepseek-harness/src/types.ts";
import { assertEquals, assertStringIncludes } from "../../core/assert.ts";
import * as fs from "node:fs";

{
  const root = path.resolve(new URL("../../../", import.meta.url).pathname);
  const skillsRoot = path.join(root, "packages/skills");
  const expectedSkills = [
    "frostline-graph",
  ];

  type PostListener = (
    exec: ToolExecution,
    result: ToolExecutionResult,
    next: () => Promise<PostToolDecision>,
  ) => Promise<PostToolDecision>;
  type StartListener = (
    payload: { agent: DshAgent; source: SessionStartSource },
  ) => void;
  type SessionEventListener = (
    session: DshSession,
    event: DshSessionEvent,
  ) => void;

  Deno.test("notices carry a producer-owned v4 source (no retired plugin kind)", () => {
    const notice = createNotice("text", "FLI: summary");
    assertEquals(notice.source, {
      kind: "fli",
      form: "notice",
      summary: "FLI: summary",
    });
    assertEquals(
      Object.prototype.hasOwnProperty.call(notice.source, "plugin"),
      false,
    );
    // dsh 0.2.x admission rejects `kind: "plugin"` sources; "fli" is accepted.
    assertEquals(notice.source.kind, "fli");
    const summary = "x".repeat(200);
    assertEquals(createNotice("text", summary).source.summary.length, 120);
  });

  Deno.test("plugin registers canonical skills and maps startup lifecycle", () => {
    const fixture = makeFixture();
    applyWithRunner(fixture.ctx, { skillsPath: skillsRoot }, fixture.runner);
    assertEquals(fixture.skills.map((skill) => skill.name), expectedSkills);
    assertEquals(
      fixture.skills.every((skill) =>
        skill.description.length > 0 && skill.content.length > 0
      ),
      true,
    );
    fixture.start?.({ agent: fixture.agent, source: "startup" });
    assertEquals(fixture.resetSessions, ["session-1"]);
    assertEquals(fixture.agentMessages[0].source.summary, "Frostline session");
    assertEquals(
      fixture.agentMessages.every((message) => message.source.kind === "fli"),
      true,
    );
  });

  Deno.test("resume preserves state, clear resets, compaction resets one context", () => {
    const fixture = makeFixture();
    applyWithRunner(fixture.ctx, { skillsPath: skillsRoot }, fixture.runner);
    fixture.start?.({ agent: fixture.agent, source: "resume" });
    assertEquals(fixture.resetSessions, []);
    fixture.start?.({ agent: fixture.agent, source: "clear" });
    assertEquals(fixture.resetSessions, ["session-1"]);
    fixture.start?.({ agent: fixture.agent, source: "compact" });
    assertEquals(fixture.resetContexts, []);
    fixture.sessionEvent?.(
      { id: "session-1", header: { id: "session-1" } },
      { type: "compaction/end" },
    );
    assertEquals(fixture.resetContexts, [["session-1", "__main__"]]);
  });

  Deno.test("lifecycle state warnings remain visible", () => {
    const fixture = makeFixture();
    fixture.resetSessionWarnings.push("delivery cache unavailable");
    applyWithRunner(fixture.ctx, { skillsPath: skillsRoot }, fixture.runner);
    fixture.start?.({ agent: fixture.agent, source: "startup" });
    assertEquals(
      fixture.agentMessages.map((message) => message.source.summary),
      [
        "Frostline session",
        "Frostline warning",
      ],
    );
    assertStringIncludes(
      fixture.agentMessages[1].content[0].text,
      "delivery cache unavailable",
    );
  });

  Deno.test("classified bash reads request Core ancestors and inject context", async () => {
    const fixture = makeFixture();
    fixture.ancestorOutputs.push({
      context:
        '<frostline-context>\n<docs-root-md path="docs/root.md"><![CDATA[root]]></docs-root-md>\n</frostline-context>\n',
      diagnostics: [],
      stateWarnings: [],
    });
    const classifier = await stubClassifier('["/work/src/main.ts"]');
    try {
      applyWithRunner(
        fixture.ctx,
        { skillsPath: skillsRoot, classifierPath: classifier },
        fixture.runner,
      );
      const result = await fixture.post?.(
        {
          name: "bash",
          arguments: { command: "sed -n 1,10p src/main.ts" },
          agent: fixture.agent,
        },
        { isError: false, value: "output", content: [] },
        () => Promise.resolve({ kind: "accept" }),
      );
      assertEquals(fixture.ancestorInputs, [{
        file: "/work/src/main.ts",
        cwd: "/work",
        sessionId: "session-1",
        contextId: "__main__",
      }]);
      assertEquals(result?.kind, "accept");
      assertEquals(
        result?.additionalContexts?.[0].source.summary,
        "Frostline context added for docs/root.md.",
      );
    } finally {
      fs.rmSync(path.dirname(classifier), {
        recursive: true,
        force: true,
      });
    }
  });

  Deno.test("relative classified reads resolve against the reliable agent cwd", async () => {
    const fixture = makeFixture();
    const classifier = await stubClassifier('["src/main.ts"]');
    try {
      applyWithRunner(
        fixture.ctx,
        { skillsPath: skillsRoot, classifierPath: classifier },
        fixture.runner,
      );
      await fixture.post?.(
        {
          name: "bash",
          arguments: { command: "cat src/main.ts" },
          agent: fixture.agent,
        },
        { isError: false, value: "output", content: [] },
        () => Promise.resolve({ kind: "accept" }),
      );
      assertEquals(
        fixture.ancestorInputs.map((input) => input.file),
        ["/work/src/main.ts"],
      );
    } finally {
      fs.rmSync(path.dirname(classifier), {
        recursive: true,
        force: true,
      });
    }
  });

  Deno.test("an absolute bash workdir argument overrides the session cwd", async () => {
    const fixture = makeFixture();
    const classifier = await stubClassifier('["src/main.ts"]');
    try {
      applyWithRunner(
        fixture.ctx,
        { skillsPath: skillsRoot, classifierPath: classifier },
        fixture.runner,
      );
      await fixture.post?.(
        {
          name: "bash",
          arguments: {
            command: "cat src/main.ts",
            workdir: "/other/project",
          },
          agent: fixture.agent,
        },
        { isError: false, value: "output", content: [] },
        () => Promise.resolve({ kind: "accept" }),
      );
      assertEquals(
        fixture.ancestorInputs.map((input) => input.file),
        ["/other/project/src/main.ts"],
      );
    } finally {
      fs.rmSync(path.dirname(classifier), {
        recursive: true,
        force: true,
      });
    }
  });

  Deno.test("non-read bash commands produce no observation and no guessing", async () => {
    const fixture = makeFixture();
    const classifier = await stubClassifier("[]");
    try {
      applyWithRunner(
        fixture.ctx,
        { skillsPath: skillsRoot, classifierPath: classifier },
        fixture.runner,
      );
      const result = await fixture.post?.(
        {
          name: "bash",
          arguments: { command: "echo hello > /tmp/out.txt" },
          agent: fixture.agent,
        },
        { isError: false, value: "", content: [] },
        () => Promise.resolve({ kind: "accept" }),
      );
      assertEquals(fixture.ancestorInputs, []);
      assertEquals(result, { kind: "accept" });
    } finally {
      fs.rmSync(path.dirname(classifier), {
        recursive: true,
        force: true,
      });
    }
  });

  Deno.test("classifier failure yields an explicit diagnostic and preserves the result", async () => {
    const fixture = makeFixture();
    const classifier = await stubClassifier("FAIL");
    try {
      applyWithRunner(
        fixture.ctx,
        { skillsPath: skillsRoot, classifierPath: classifier },
        fixture.runner,
      );
      const result = await fixture.post?.(
        {
          name: "bash",
          arguments: { command: "cat a.ts" },
          agent: fixture.agent,
        },
        { isError: false, value: "output", content: [] },
        () => Promise.resolve({ kind: "accept" }),
      );
      assertEquals(fixture.ancestorInputs, []);
      assertEquals(result?.kind, "accept");
      assertEquals(
        result?.additionalContexts?.[0].source.summary,
        "Frostline error",
      );
      assertStringIncludes(
        result?.additionalContexts?.[0].content[0].text ?? "",
        "read classifier failed",
      );
    } finally {
      fs.rmSync(path.dirname(classifier), {
        recursive: true,
        force: true,
      });
    }
  });

  Deno.test("blocked or replaced bash results never classify", async () => {
    const fixture = makeFixture();
    const classifier = await stubClassifier('["/work/a.ts"]');
    try {
      applyWithRunner(
        fixture.ctx,
        { skillsPath: skillsRoot, classifierPath: classifier },
        fixture.runner,
      );
      const execution = {
        name: "bash",
        arguments: { command: "cat a.ts" },
        agent: fixture.agent,
      };
      const result = {
        isError: false as const,
        value: "output",
        content: [],
      };
      await fixture.post?.(
        execution,
        result,
        () => Promise.resolve({ kind: "block", feedback: [] }),
      );
      await fixture.post?.(
        execution,
        result,
        () => Promise.resolve({ kind: "accept", value: "replaced" }),
      );
      assertEquals(fixture.ancestorInputs, []);
    } finally {
      fs.rmSync(path.dirname(classifier), {
        recursive: true,
        force: true,
      });
    }
  });

  Deno.test("successful native read requests Core ancestors and injects context", async () => {
    const fixture = makeFixture();
    fixture.ancestorOutputs.push({
      context:
        '<frostline-context>\n<docs-root-md path="docs/root.md"><![CDATA[root]]></docs-root-md>\n</frostline-context>\n',
      diagnostics: [],
      stateWarnings: [],
    });
    applyWithRunner(fixture.ctx, { skillsPath: skillsRoot }, fixture.runner);
    const downstream: PostToolDecision = { kind: "accept" };
    const result = await fixture.post?.(
      {
        name: "read",
        arguments: { file_path: "src/main.ts" },
        agent: fixture.agent,
      },
      {
        isError: false,
        value: { path: "/work/src/main.ts" },
        content: [{ type: "text", text: "source" }],
      },
      () => Promise.resolve(downstream),
    );
    assertEquals(fixture.ancestorInputs, [{
      file: "/work/src/main.ts",
      cwd: "/work",
      sessionId: "session-1",
      contextId: "__main__",
    }]);
    assertEquals(result?.kind, "accept");
    assertEquals(
      result?.additionalContexts?.[0].source.summary,
      "Frostline context added for docs/root.md.",
    );
  });

  Deno.test("only successful unmodified native read reaches Core", async () => {
    const fixture = makeFixture();
    applyWithRunner(fixture.ctx, { skillsPath: skillsRoot }, fixture.runner);
    for (const name of ["grep", "glob", "bash", "pwsh"]) {
      const result = await fixture.post?.(
        { name, arguments: {}, agent: fixture.agent },
        { isError: false, value: { path: "/work/a.ts" }, content: [] },
        () => Promise.resolve({ kind: "accept" }),
      );
      assertEquals(result, { kind: "accept" });
    }
    const execution = { name: "read", arguments: {}, agent: fixture.agent };
    const result = {
      isError: false as const,
      value: { path: "/work/a.ts" },
      content: [],
    };
    await fixture.post?.(
      execution,
      result,
      () => Promise.resolve({ kind: "block", feedback: [] }),
    );
    await fixture.post?.(
      execution,
      result,
      () => Promise.resolve({ kind: "accept", content: [] }),
    );
    await fixture.post?.(
      execution,
      result,
      () => Promise.resolve({ kind: "accept", value: { hidden: true } }),
    );
    assertEquals(fixture.ancestorInputs, []);
  });

  Deno.test("FLI context preserves downstream contexts", async () => {
    const fixture = makeFixture();
    fixture.ancestorOutputs.push({
      context:
        '<frostline-context>\n<docs-root-md path="docs/root.md"><![CDATA[root]]></docs-root-md>\n</frostline-context>\n',
      diagnostics: [],
      stateWarnings: [],
    });
    applyWithRunner(fixture.ctx, { skillsPath: skillsRoot }, fixture.runner);
    const other = createNotice("other", "other");
    const result = await fixture.post?.(
      { name: "read", arguments: {}, agent: fixture.agent },
      { isError: false, value: { path: "/work/a.ts" }, content: [] },
      () => Promise.resolve({ kind: "accept", additionalContexts: [other] }),
    );
    assertEquals(
      result?.additionalContexts?.map((message) => message.source.summary),
      ["Frostline context added for docs/root.md.", "other"],
    );
  });

  Deno.test("read without Agent identity skips DeliveryScope", async () => {
    const fixture = makeFixture();
    applyWithRunner(fixture.ctx, { skillsPath: skillsRoot }, fixture.runner);
    const result = await fixture.post?.(
      { name: "read", arguments: {} },
      { isError: false, value: { path: "/work/a.ts" }, content: [] },
      () => Promise.resolve({ kind: "accept" }),
    );
    assertEquals(fixture.ancestorInputs, []);
    assertEquals(
      result?.additionalContexts?.[0].source.summary,
      "Frostline skipped delivery",
    );
  });

  Deno.test("empty Core delivery does not add repetitive FLI status", async () => {
    const fixture = makeFixture();
    fixture.ancestorOutputs.push({
      context: "",
      diagnostics: [],
      stateWarnings: [],
    });
    applyWithRunner(fixture.ctx, { skillsPath: skillsRoot }, fixture.runner);
    const result = await fixture.post?.(
      { name: "read", arguments: {}, agent: fixture.agent },
      { isError: false, value: { path: "/work/a.ts" }, content: [] },
      () => Promise.resolve({ kind: "accept" }),
    );
    assertEquals(result, { kind: "accept" });
  });

  Deno.test("Core failure leaves the native read intact and shows a diagnostic", async () => {
    const fixture = makeFixture();
    fixture.failAncestors = true;
    applyWithRunner(fixture.ctx, { skillsPath: skillsRoot }, fixture.runner);
    const result = await fixture.post?.(
      { name: "read", arguments: {}, agent: fixture.agent },
      { isError: false, value: { path: "/work/a.ts" }, content: [] },
      () => Promise.resolve({ kind: "accept" }),
    );
    assertEquals(result?.kind, "accept");
    assertEquals(
      result?.additionalContexts?.[0].source.summary,
      "Frostline error",
    );
    assertStringIncludes(
      result?.additionalContexts?.[0].content[0].text ?? "",
      "core unavailable",
    );
  });

  Deno.test("strict FLI_DIAGNOSTICS exposes Core diagnostics through the plugin", async () => {
    const previous = process.env.FLI_DIAGNOSTICS;
    try {
      process.env.FLI_DIAGNOSTICS = "strict";
      const fixture = makeFixture();
      fixture.ancestorOutputs.push({
        context: "",
        documents: [],
        diagnostics: [{
          kind: "resolution",
          path: "src/widget.ts",
          message: "unresolved parent in src/widget.ts: @.frostline/missing.md",
        }],
        stateWarnings: [],
      });
      applyWithRunner(fixture.ctx, { skillsPath: skillsRoot }, fixture.runner);
      const result = await fixture.post?.(
        { name: "read", arguments: {}, agent: fixture.agent },
        { isError: false, value: { path: "/work/a.ts" }, content: [] },
        () => Promise.resolve({ kind: "accept" }),
      );
      assertEquals(
        result?.additionalContexts?.[0].source.summary,
        "Frostline note: unresolved parent in src/widget.ts: @.frostline/missing.md",
      );
    } finally {
      if (previous === undefined) delete process.env.FLI_DIAGNOSTICS;
      else process.env.FLI_DIAGNOSTICS = previous;
    }
  });

  /** Deterministic classifier stub; reads == "FAIL" simulates a classifier crash. */
  const stubClassifier = async (reads: string): Promise<string> => {
    const dir = await Deno.makeTempDir({ prefix: "fli-classifier-stub-" });
    const file = path.join(dir, "fli-classify-reads");
    const payload = reads === "FAIL"
      ? 'echo "stub classifier exploded" >&2; exit 1'
      : `printf '{"reads":%s}' '${reads.replaceAll("'", `'\\''`)}'`;
    fs.writeFileSync(
      file,
      `#!/usr/bin/env bash
cat >/dev/null
${payload}
`,
      { mode: 0o755 },
    );
    return file;
  };

  const makeFixture = () => {
    let post: PostListener | undefined;
    let start: StartListener | undefined;
    let sessionEvent: SessionEventListener | undefined;
    const skills: SkillRegistration[] = [];
    const agentMessages: UserMessage[] = [];
    const ancestorInputs: CoreAncestorsInput[] = [];
    const ancestorOutputs: ReturnType<CoreRunner["ancestors"]>[] = [];
    const resetSessions: string[] = [];
    const resetContexts: Array<[string, string]> = [];
    const resetSessionWarnings: string[] = [];
    let failAncestors = false;

    const agent: DshAgent = {
      id: "session-1",
      session: { header: { id: "session-1", cwd: "/work" } },
      inject(message) {
        agentMessages.push(message);
      },
    };
    const runner: CoreRunner = {
      ancestors(input) {
        ancestorInputs.push(input);
        if (failAncestors) throw new Error("core unavailable");
        return ancestorOutputs.shift() ??
          { context: "", diagnostics: [], stateWarnings: [] };
      },
      resetSession(sessionId) {
        resetSessions.push(sessionId);
        return [...resetSessionWarnings];
      },
      resetContext(sessionId, contextId) {
        resetContexts.push([sessionId, contextId]);
        return [];
      },
    };
    const ctx = {
      skills: {
        register(skill: SkillRegistration) {
          skills.push(skill);
        },
      },
      agents: {
        get(id: string) {
          return id === agent.id ? agent : undefined;
        },
      },
      on(event: string, listener: unknown) {
        if (event === "tools/post-execute") post = listener as PostListener;
        else if (event === "agent/session-start") {
          start = listener as StartListener;
        } else if (event === "session/event") {
          sessionEvent = listener as SessionEventListener;
        }
      },
    } as unknown as DshContext;

    return {
      ctx,
      runner,
      agent,
      skills,
      agentMessages,
      ancestorInputs,
      ancestorOutputs,
      resetSessions,
      resetContexts,
      resetSessionWarnings,
      get post() {
        return post;
      },
      get start() {
        return start;
      },
      get sessionEvent() {
        return sessionEvent;
      },
      get failAncestors() {
        return failAncestors;
      },
      set failAncestors(value: boolean) {
        failAncestors = value;
      },
    };
  };
}

{
  Deno.test("DSH native read uses the canonical successful result path", () => {
    const path = observedReadPath(
      { name: "read", arguments: { file_path: "src/main.ts" } },
      {
        isError: false,
        value: {
          path: "/work/src/main.ts",
          offset: 1,
          lines: [],
          totalLines: 0,
        },
        content: [],
      },
      { kind: "accept" },
    );
    assertEquals(path, "/work/src/main.ts");
  });

  Deno.test("only DSH native read is a FLI observation surface", () => {
    const success = {
      isError: false as const,
      value: { path: "/work/a.ts" },
      content: [],
    };
    for (
      const name of [
        "grep",
        "glob",
        "bash",
        "pwsh",
        "write",
        "edit",
        "web_fetch",
        "web_search",
        "skill",
        "subagent",
        "job_output",
        "todo_write",
        "str_replace_editor",
      ]
    ) {
      assertEquals(
        observedReadPath({ name, arguments: {} }, success, { kind: "accept" }),
        undefined,
      );
    }
  });

  Deno.test(
    "failed, blocked, or replaced read results do not become FLI observations",
    () => {
      const success = {
        isError: false as const,
        value: { path: "/work/a.ts" },
        content: [],
      };
      assertEquals(
        observedReadPath(
          { name: "read", arguments: {} },
          { isError: true, content: [] },
          { kind: "accept" },
        ),
        undefined,
      );
      assertEquals(
        observedReadPath(
          { name: "read", arguments: {} },
          success,
          { kind: "block", feedback: [] },
        ),
        undefined,
      );
      assertEquals(
        observedReadPath(
          { name: "read", arguments: {} },
          success,
          { kind: "accept", content: [] },
        ),
        undefined,
      );
      assertEquals(
        observedReadPath(
          { name: "read", arguments: {} },
          success,
          { kind: "accept", value: { hidden: true } },
        ),
        undefined,
      );
    },
  );

  Deno.test("malformed native read output is not guessed from tool arguments", () => {
    assertEquals(
      observedReadPath(
        { name: "read", arguments: { file_path: "/work/a.ts" } },
        { isError: false, value: {}, content: [] },
        { kind: "accept" },
      ),
      undefined,
    );
  });

  Deno.test("FLI contexts prepend without erasing downstream plugin contexts", () => {
    const fli = createNotice("fli", "FLI: context injected");
    const other = createNotice("other", "other");
    const result = withContexts(
      { kind: "accept", additionalContexts: [other] },
      [fli],
    );
    assertEquals(
      result.additionalContexts?.map((value) => value.content[0].text),
      ["fli", "other"],
    );
  });

  Deno.test("context delivery gets concise visible notice and dedup silence", () => {
    const notices = outputNotices({
      context:
        '<frostline-context>\n<docs-a-md path="docs/a.md"><![CDATA[a]]></docs-a-md>\n<docs-b-md path="docs/b.md"><![CDATA[b]]></docs-b-md>\n</frostline-context>\n',
      documents: [
        { path: "docs/a.md", identity: "docs/a.md" },
        { path: "docs/b.md", identity: "docs/b.md" },
      ],
      diagnostics: [],
      stateWarnings: [],
    });
    assertEquals(notices.length, 1);
    assertEquals(
      notices[0].source.summary,
      "Frostline context added for docs/a.md, docs/b.md.",
    );
    assertStringIncludes(notices[0].content[0].text, "frostline-context");

    assertEquals(
      outputNotices({
        context: "",
        documents: [],
        diagnostics: [],
        stateWarnings: [],
      }),
      [],
    );
  });

  Deno.test("delivery notice truncates to three inline names with total", () => {
    const documents = ["a", "b", "c", "d", "e", "f", "g"].map((name) => ({
      path: `docs/${name}.md`,
      identity: `docs/${name}.md`,
    }));
    const notices = outputNotices({
      context: "<frostline-context>\n</frostline-context>\n",
      documents,
      diagnostics: [],
      stateWarnings: [],
    });
    assertEquals(
      notices[0].source.summary,
      "Frostline context added for docs/a.md, docs/b.md, docs/c.md and 4 more files.",
    );
  });

  Deno.test("equal relative paths from different projects are qualified", () => {
    const notices = outputNotices({
      context: "<frostline-context>\n</frostline-context>\n",
      documents: [
        { path: "docs/a.md", identity: "docs/a.md", project: "left" },
        { path: "docs/a.md", identity: "other/docs/a.md", project: "right" },
      ],
      diagnostics: [],
      stateWarnings: [],
    });
    assertEquals(
      notices[0].source.summary,
      "Frostline context added for left:docs/a.md, right:docs/a.md.",
    );
  });

  Deno.test("default mode hides declaration and selector diagnostics", () => {
    const notices = outputNotices({
      context: "",
      documents: [],
      diagnostics: [
        { kind: "syntax", path: "src/widget.ts", message: "bad parents line" },
      ],
      stateWarnings: ["cache unavailable"],
    });
    assertEquals(notices.length, 1);
    assertEquals(notices[0].source.summary, "Frostline warning");
    assertStringIncludes(
      notices[0].content[0].text,
      "Frostline warning: cache unavailable",
    );
  });

  Deno.test("strict mode shows declaration and selector diagnostics", () => {
    const output = {
      context: "",
      documents: [],
      diagnostics: [
        {
          kind: "resolution",
          path: "src/widget.ts",
          message: "unresolved parent",
        },
      ],
      stateWarnings: [],
    };
    assertEquals(outputNotices(output, "default"), []);
    const notices = outputNotices(output, "strict");
    assertEquals(notices.length, 1);
    assertEquals(
      notices[0].source.summary,
      "Frostline note: unresolved parent",
    );
    assertStringIncludes(
      notices[0].content[0].text,
      "Frostline note: unresolved parent",
    );
  });

  Deno.test("strict diagnostic shares the delivery message", () => {
    const notices = outputNotices({
      context:
        '<frostline-context>\n<docs-a-md path="docs/a.md"><![CDATA[a]]></docs-a-md>\n</frostline-context>\n',
      documents: [{ path: "docs/a.md", identity: "docs/a.md" }],
      diagnostics: [
        {
          kind: "resolution",
          path: "src/widget.ts",
          message: "unresolved parent in src/widget.ts: @.frostline/missing.md",
        },
      ],
      stateWarnings: [],
    }, "strict");
    assertEquals(notices.length, 1);
    assertEquals(
      notices[0].source.summary,
      "Frostline context added for docs/a.md. Note: Frostline note: unresolved parent in src/widget.ts: @.frostline/missing.md.",
    );
  });

  Deno.test("operational diagnostics stay visible in either mode", () => {
    const output = {
      context: "",
      documents: [],
      diagnostics: [{ kind: "graph", path: "a.ts", message: "cycle" }],
      stateWarnings: [],
    };
    for (const mode of ["default", "strict"] as const) {
      const notices = outputNotices(output, mode);
      assertEquals(notices.length, 1);
      assertEquals(notices[0].source.summary, "Frostline note: cycle");
    }
  });

  Deno.test("delivery notice recovers names from Core output without structured documents", () => {
    const notices = outputNotices({
      context:
        '<frostline-context>\n<docs-a-md path="docs/a.md"><![CDATA[a]]></docs-a-md>\n<docs-b-md path="docs/b.md"><![CDATA[b]]></docs-b-md>\n</frostline-context>\n',
      diagnostics: [],
      stateWarnings: [],
    });
    assertEquals(notices.length, 1);
    assertEquals(
      notices[0].source.summary,
      "Frostline context added for docs/a.md, docs/b.md.",
    );
  });

  Deno.test("unsupported FLI_DIAGNOSTICS selects default with one session notice", () => {
    const previous = process.env.FLI_DIAGNOSTICS;
    try {
      delete process.env.FLI_DIAGNOSTICS;
      assertEquals(resolveDiagnosticsMode(undefined), { mode: "default" });
      assertEquals(resolveDiagnosticsMode("default"), { mode: "default" });
      assertEquals(resolveDiagnosticsMode("strict"), { mode: "strict" });
      const invalid = resolveDiagnosticsMode("loud");
      assertEquals(invalid.mode, "default");

      process.env.FLI_DIAGNOSTICS = "loud";
      const uxMode = createUxMode();
      const first = uxMode.takeConfigNotice();
      assertEquals(first.length, 1);
      assertEquals(
        first[0].source.summary,
        'Frostline ignored unknown FLI_DIAGNOSTICS value "loud", using default diagnostics.',
      );
      assertEquals(uxMode.takeConfigNotice(), []);
      assertEquals(uxMode.selection().mode, "default");
    } finally {
      if (previous === undefined) delete process.env.FLI_DIAGNOSTICS;
      else process.env.FLI_DIAGNOSTICS = previous;
    }
  });
}

{
  const root = path.resolve(new URL("../../../", import.meta.url).pathname);
  const skillsRoot = path.join(root, "packages/skills");

  Deno.test("DSH preserves canonical skill invocation policy", () => {
    const skills: SkillRegistration[] = [];
    const ctx = {
      skills: {
        register(skill: SkillRegistration) {
          skills.push(skill);
        },
      },
      agents: {
        get() {
          return undefined;
        },
      },
      on() {
        return undefined;
      },
    } as unknown as DshContext;
    const runner: CoreRunner = {
      ancestors() {
        return { context: "", diagnostics: [], stateWarnings: [] };
      },
      resetSession() {
        return [];
      },
      resetContext() {
        return [];
      },
    };

    applyWithRunner(ctx, { skillsPath: skillsRoot }, runner);

    assertEquals(
      skills.map((skill) => [skill.name, skill.invocation]),
      [
        ["frostline-graph", { modelInvocable: true, userInvocable: true }],
      ],
    );
  });
}

{
  const root = path.resolve(new URL("../../../", import.meta.url).pathname);
  const integration = path.join(root, "integrations/deepseek-harness");
  const skillNames = [
    "frostline-graph",
  ];

  Deno.test("DSH source package declares one native bundle layer", () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(integration, "package.json"), "utf8"),
    ) as {
      name: string;
      main: string;
      files?: string[];
      dsh?: { bundle?: { patch?: string } };
      frostline?: { deepSeekHarness?: { testedVersion?: string } };
    };
    assertEquals(manifest.name, "@frostline/dsh");
    assertEquals(manifest.main, "lib/index.js");
    assertEquals(manifest.files?.includes("skills/"), true);
    assertEquals(manifest.files?.includes("assets/session-start.md"), false);
    assertEquals(manifest.dsh?.bundle?.patch, "./cordis.patch.yml");
    assertEquals(
      manifest.frostline?.deepSeekHarness?.testedVersion,
      "0.2.0-rc.2",
    );

    const patch = fs.readFileSync(
      path.join(integration, "cordis.patch.yml"),
      "utf8",
    );
    assertStringIncludes(patch, "id: frostline");
    assertStringIncludes(patch, "name: '@frostline/dsh'");
  });

  Deno.test("DSH uses a native bundle install rather than a dedicated profile", () => {
    const script = fs.readFileSync(
      path.join(root, "scripts/install-dev.sh"),
      "utf8",
    );
    assertStringIncludes(script, "dsh plugin");
    assertStringIncludes(script, '"link:$destination"');
    assertEquals(script.includes("profile create"), false);
  });

  Deno.test("DSH development install requires an explicit profile", () => {
    // Upstream `dsh plugin` rejects a missing --profile; the installer must
    // surface that contract instead of attempting an install that cannot run.
    const command = new Deno.Command("bash", {
      args: [path.join(root, "scripts/install-dev.sh"), "dsh"],
      cwd: root,
      stdout: "piped",
      stderr: "piped",
    }).outputSync();
    assertEquals(command.code, 2);
    assertStringIncludes(
      new TextDecoder().decode(command.stderr),
      "explicit profile",
    );
  });

  Deno.test("failed DSH registration restores the previously installed bundle", () => {
    // Regression: the installer used to delete the previous bundle before the
    // native registration ran, so a registration failure lost it.
    const script = fs.readFileSync(
      path.join(root, "scripts/install-dev.sh"),
      "utf8",
    );
    // A restore path must exist and the previous bundle must be removed only
    // after the native registration commands have run successfully.
    assertStringIncludes(script, "restore() {");
    const backupMove = script.indexOf('mv "$destination" "$backup"');
    const registration = script.indexOf(
      "codex plugin add frostline@frostline-local",
    );
    const backupRemoval = script.lastIndexOf('rm -rf "$backup"');
    assertEquals(backupMove > 0, true);
    assertEquals(registration > backupMove, true);
    assertEquals(backupRemoval > registration, true);
    assertEquals(script.indexOf("restore\n      exit 1") > 0, true);
  });

  Deno.test("canonical skills are projected only during DSH package composition", () => {
    assertEquals(fs.existsSync(path.join(integration, "skills")), false);
    const composer = fs.readFileSync(
      path.join(root, "scripts/package.sh"),
      "utf8",
    );
    assertStringIncludes(composer, 'packages/skills/." "$output/skills/');
    for (const skill of skillNames) {
      assertEquals(
        fs.existsSync(path.join(root, "packages/skills", skill, "SKILL.md")),
        true,
      );
    }
    assertEquals(
      fs.existsSync(path.join(root, "packages/skills/fli-maintain")),
      false,
    );
  });
}
