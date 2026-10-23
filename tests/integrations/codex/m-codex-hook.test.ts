// parents: @.frostline/graph/v-m-codex-hook.xml

import { assertEquals, assertStringIncludes } from "../../core/assert.ts";
import * as path from "node:path";
import {
  repositoryRoot,
  runAdapter,
  tempDirectory,
  tempProject,
} from "./fixtures.ts";
import * as fs from "node:fs";

function absoluteRead(project: string): { command: string } {
  return { command: "cat " + path.join(project, "child.md") };
}

Deno.test("PostToolUse uses Codex read classification and native output fields", async () => {
  const project = tempProject();
  const cache = tempDirectory("fli-codex-cache-");
  const output = await runAdapter(
    {
      session_id: "read-session",
      cwd: project,
      hook_event_name: "PostToolUse",
      tool_input: absoluteRead(project),
    },
    cache,
  );
  const context = (output.value.hookSpecificOutput as Record<string, string>)
    .additionalContext;

  assertEquals(output.code, 0);
  assertEquals(
    (output.value.hookSpecificOutput as Record<string, string>).hookEventName,
    "PostToolUse",
  );
  assertEquals(context.includes("PARENT_MARKER"), true);
  assertEquals(context.includes("CHILD_MARKER"), false);
  assertEquals(
    output.value.systemMessage,
    "Frostline context added for parent.md.",
  );
});

Deno.test("session and agent identity map to independent delivery contexts", async () => {
  const project = tempProject();
  const cache = tempDirectory("fli-codex-cache-");
  const session = "scope-session";
  const input = (agentId?: string) => ({
    session_id: session,
    ...(agentId ? { agent_id: agentId } : {}),
    cwd: project,
    hook_event_name: "PostToolUse",
    tool_input: absoluteRead(project),
  });

  assertEquals(hasContext((await runAdapter(input(), cache)).value), true);
  assertEquals(hasContext((await runAdapter(input(), cache)).value), false);
  assertEquals(
    hasContext((await runAdapter(input("agent"), cache)).value),
    true,
  );
  assertEquals(
    hasContext((await runAdapter(input("agent"), cache)).value),
    false,
  );
});

Deno.test("Codex lifecycle events map to Core resets", async () => {
  const project = tempProject();
  const cache = tempDirectory("fli-codex-cache-");
  const session = "lifecycle-session";
  const read = (agentId?: string) => ({
    session_id: session,
    ...(agentId ? { agent_id: agentId } : {}),
    cwd: project,
    hook_event_name: "PostToolUse",
    tool_input: absoluteRead(project),
  });
  const compact = (agentId?: string) => ({
    session_id: session,
    ...(agentId ? { agent_id: agentId } : {}),
    cwd: project,
    hook_event_name: "PostCompact",
  });
  const sessionStart = (source: string) => ({
    session_id: session,
    cwd: project,
    hook_event_name: "SessionStart",
    source,
  });

  assertEquals(hasContext((await runAdapter(read(), cache)).value), true);
  assertEquals(
    hasContext((await runAdapter(read("agent"), cache)).value),
    true,
  );
  await runAdapter(compact(), cache);
  assertEquals(hasContext((await runAdapter(read(), cache)).value), true);
  assertEquals(
    hasContext((await runAdapter(read("agent"), cache)).value),
    false,
  );
  await runAdapter(sessionStart("resume"), cache);
  assertEquals(hasContext((await runAdapter(read(), cache)).value), false);
  await runAdapter(sessionStart("clear"), cache);
  assertEquals(hasContext((await runAdapter(read(), cache)).value), true);
  assertEquals(
    hasContext((await runAdapter(read("agent"), cache)).value),
    true,
  );
  await runAdapter(sessionStart("compact"), cache);
  assertEquals(hasContext((await runAdapter(read(), cache)).value), true);
  assertEquals(
    hasContext((await runAdapter(read("agent"), cache)).value),
    false,
  );
});

Deno.test("SessionStart is lifecycle-only and injects no FLI semantic prompt", async () => {
  const output = await runAdapter(
    {
      session_id: "startup-session",
      cwd: ".",
      hook_event_name: "SessionStart",
      source: "startup",
    },
    tempDirectory("fli-codex-cache-"),
  );

  assertEquals(output.code, 0);
  assertEquals(output.value.hookSpecificOutput, undefined);
  assertEquals(
    output.value.systemMessage,
    "Frostline is active for this session.",
  );
});

function hasContext(value: Record<string, unknown>): boolean {
  const output = value.hookSpecificOutput as Record<string, string> | undefined;
  return (output?.additionalContext ?? "").length > 0;
}

Deno.test("strict mode transports declaration diagnostics to Codex systemMessage", async () => {
  const project = tempProject();
  fs.writeFileSync(
    path.join(project, "child.md"),
    "<!-- parents: @missing.md -->\n# Child\n",
  );
  const output = await runAdapter(
    {
      session_id: "diagnostic-session",
      cwd: project,
      hook_event_name: "PostToolUse",
      tool_input: { command: "cat " + path.join(project, "child.md") },
    },
    tempDirectory("cache-"),
    { FLI_DIAGNOSTICS: "strict" },
  );

  assertEquals(output.code, 0);
  assertEquals(output.value.hookSpecificOutput, undefined);
  const message = String(output.value.systemMessage ?? "");
  assertStringIncludes(message, "Frostline note: ");
  assertStringIncludes(message, "@missing.md");
});

Deno.test("default mode hides declaration diagnostics", async () => {
  const project = tempProject();
  fs.writeFileSync(
    path.join(project, "child.md"),
    "<!-- parents: @missing.md -->\n# Child\n",
  );
  const output = await runAdapter(
    {
      session_id: "quiet-session",
      cwd: project,
      hook_event_name: "PostToolUse",
      tool_input: { command: "cat " + path.join(project, "child.md") },
    },
    tempDirectory("cache-"),
  );

  assertEquals(output.code, 0);
  assertEquals(output.value.hookSpecificOutput, undefined);
  assertEquals(output.value.systemMessage, undefined);
});

Deno.test("independent valid context survives alongside transported diagnostics", async () => {
  const project = tempProject();
  fs.writeFileSync(path.join(project, "valid.md"), "VALID_MARKER\n");
  fs.writeFileSync(
    path.join(project, "child.md"),
    "<!-- parents: @missing.md, @valid.md -->\n# Child\n",
  );
  const output = await runAdapter(
    {
      session_id: "partial-session",
      cwd: project,
      hook_event_name: "PostToolUse",
      tool_input: { command: "cat " + path.join(project, "child.md") },
    },
    tempDirectory("cache-"),
    { FLI_DIAGNOSTICS: "strict" },
  );

  const hook = output.value.hookSpecificOutput as Record<string, string>;
  assertStringIncludes(hook.additionalContext, "VALID_MARKER");
  const message = String(output.value.systemMessage ?? "");
  assertStringIncludes(message, "Frostline context added for valid.md.");
  assertStringIncludes(message, "@missing.md");
});

Deno.test("unsupported FLI_DIAGNOSTICS value selects default with a session notice", async () => {
  const project = tempProject();
  const start = await runAdapter(
    {
      session_id: "mode-session",
      cwd: project,
      hook_event_name: "SessionStart",
      source: "startup",
    },
    tempDirectory("cache-"),
    { FLI_DIAGNOSTICS: "loud" },
  );
  assertEquals(
    String(start.value.systemMessage ?? ""),
    'Frostline is active for this session.\nFrostline ignored unknown FLI_DIAGNOSTICS value "loud", using default diagnostics.',
  );

  const read = await runAdapter(
    {
      session_id: "mode-session",
      cwd: project,
      hook_event_name: "PostToolUse",
      tool_input: { command: "cat " + path.join(project, "child.md") },
    },
    tempDirectory("cache-"),
    { FLI_DIAGNOSTICS: "loud" },
  );
  assertEquals(
    read.value.systemMessage,
    "Frostline context added for parent.md.",
  );
});

function gitProject(parent: string): string {
  const root = tempDirectory("wire-project-");
  fs.mkdirSync(path.join(root, ".git"), { recursive: true });
  fs.writeFileSync(path.join(root, ".git", "HEAD"), "ref: refs/heads/main\n");
  fs.writeFileSync(path.join(root, "parent.md"), `${parent}\n`);
  fs.writeFileSync(
    path.join(root, "child.md"),
    "<!-- parents: @parent.md -->\n# Child\n",
  );
  return root;
}

function homeProject(home: string, name: string, parent: string): string {
  const root = path.join(home, name);
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, "parent.md"), `${parent}\n`);
  fs.writeFileSync(
    path.join(root, "child.md"),
    "<!-- parents: @parent.md -->\n# Child\n",
  );
  return root;
}

Deno.test("relative read resolves against the hook input cwd", async () => {
  const project = gitProject("RELATIVE_PARENT");
  const output = await runAdapter(
    {
      session_id: "wire-relative",
      cwd: project,
      hook_event_name: "PostToolUse",
      tool_input: { command: "cat child.md" },
    },
    tempDirectory("wire-cache-"),
  );

  assertEquals(output.code, 0);
  const hook = output.value.hookSpecificOutput as Record<string, string>;
  assertStringIncludes(hook.additionalContext, "RELATIVE_PARENT");
  assertEquals(
    output.value.systemMessage,
    "Frostline context added for parent.md.",
  );
});

Deno.test("command-only absolute Git read is enriched", async () => {
  const project = gitProject("GIT_PARENT");
  const output = await runAdapter(
    {
      session_id: "wire-absolute-git",
      cwd: tempDirectory("unrelated-session-cwd-"),
      hook_event_name: "PostToolUse",
      tool_input: { command: `cat ${path.join(project, "child.md")}` },
    },
    tempDirectory("wire-cache-"),
  );

  assertEquals(output.code, 0);
  const hook = output.value.hookSpecificOutput as Record<string, string>;
  assertStringIncludes(hook.additionalContext, "GIT_PARENT");
  assertEquals(
    output.value.systemMessage,
    "Frostline context added for parent.md.",
  );
});

Deno.test("command-only absolute no-Git-under-HOME read uses HOME fallback", async () => {
  const home = tempDirectory("wire-home-");
  const project = homeProject(home, "project", "HOME_PARENT");
  const output = await runAdapter(
    {
      session_id: "wire-absolute-home",
      cwd: tempDirectory("unrelated-session-cwd-"),
      hook_event_name: "PostToolUse",
      tool_input: { command: `cat ${path.join(project, "child.md")}` },
    },
    tempDirectory("wire-cache-"),
    { HOME: home },
  );

  assertEquals(output.code, 0);
  const hook = output.value.hookSpecificOutput as Record<string, string>;
  assertStringIncludes(hook.additionalContext, "HOME_PARENT");
  assertEquals(
    output.value.systemMessage,
    "Frostline context added for parent.md.",
  );
});

Deno.test("nested relative read resolves against the hook cwd", async () => {
  const project = gitProject("NESTED_PARENT");
  fs.mkdirSync(path.join(project, "Source/Agents"), { recursive: true });
  fs.writeFileSync(
    path.join(project, "Source/Agents/child.md"),
    "<!-- parents: @parent.md -->\n# Child\n",
  );
  const output = await runAdapter(
    {
      session_id: "wire-session-cwd",
      cwd: project,
      hook_event_name: "PostToolUse",
      tool_input: { command: "sed -n '1,20p' Source/Agents/child.md" },
    },
    tempDirectory("wire-cache-"),
  );

  assertEquals(output.code, 0);
  const hook = output.value.hookSpecificOutput as Record<string, string>;
  assertStringIncludes(hook.additionalContext, "NESTED_PARENT");
  assertEquals(
    output.value.systemMessage,
    "Frostline context added for parent.md.",
  );
});

Deno.test("one Codex session traverses no-Git projects A, B, and A under HOME", async () => {
  const home = tempDirectory("wire-multi-home-");
  const first = homeProject(home, "project-a", "FIRST_PARENT");
  const second = homeProject(home, "project-b", "SECOND_PARENT");
  const cache = tempDirectory("wire-multi-cache-");
  const session = "wire-multi-project";
  const read = (project: string) =>
    runAdapter(
      {
        session_id: session,
        cwd: tempDirectory("unrelated-session-cwd-"),
        hook_event_name: "PostToolUse",
        tool_input: { command: `cat ${path.join(project, "child.md")}` },
      },
      cache,
      { HOME: home },
    );
  const context = async (project: string) =>
    ((await read(project)).value.hookSpecificOutput as Record<string, string>)
      .additionalContext;

  assertStringIncludes(await context(first), "FIRST_PARENT");
  assertStringIncludes(await context(second), "SECOND_PARENT");
  assertEquals((await read(first)).value.hookSpecificOutput, undefined);
  assertEquals((await read(second)).value.hookSpecificOutput, undefined);
});

Deno.test("mixed relative and absolute reads forward both facts", async () => {
  const project = gitProject("ABSOLUTE_PARENT");
  const relativeProject = gitProject("RELATIVE_PARENT");
  const output = await runAdapter(
    {
      session_id: "wire-mixed",
      cwd: relativeProject,
      hook_event_name: "PostToolUse",
      tool_input: {
        command: `cat child.md && cat ${path.join(project, "child.md")}`,
      },
    },
    tempDirectory("wire-cache-"),
  );

  assertEquals(output.code, 0);
  const hook = output.value.hookSpecificOutput as Record<string, string>;
  assertStringIncludes(hook.additionalContext, "ABSOLUTE_PARENT");
  assertStringIncludes(hook.additionalContext, "RELATIVE_PARENT");
  assertStringIncludes(
    String(output.value.systemMessage),
    "Frostline context added for ",
  );
});

Deno.test("non-read Bash command produces no FLI hook output", async () => {
  const project = tempProject();
  const output = await runAdapter(
    {
      session_id: "non-read",
      cwd: project,
      hook_event_name: "PostToolUse",
      tool_input: { command: "printf '%s\\n' hello" },
    },
    tempDirectory("classifier-cache-"),
  );

  assertEquals(output.code, 0);
  assertEquals(output.value.hookSpecificOutput, undefined);
  assertEquals(output.value.systemMessage, undefined);
});

Deno.test("multiple reads in one Bash hook produce the union of semantic ancestors", async () => {
  const project = tempProject();
  fs.writeFileSync(path.join(project, "other-parent.md"), "OTHER_PARENT\n");
  fs.writeFileSync(
    path.join(project, "other.md"),
    "<!-- parents: @other-parent.md -->\n# Other\n",
  );

  const output = await runAdapter(
    {
      session_id: "multi-read",
      cwd: project,
      hook_event_name: "PostToolUse",
      tool_input: {
        command: "cat " + path.join(project, "child.md") + "; cat " +
          path.join(project, "other.md"),
      },
    },
    tempDirectory("classifier-cache-"),
  );

  assertEquals(output.code, 0);
  const context = (output.value.hookSpecificOutput as Record<string, string>)
    .additionalContext;
  assertStringIncludes(context, "PARENT_MARKER");
  assertStringIncludes(context, "OTHER_PARENT");
});

Deno.test("duplicate reads in one hook do not duplicate injected documents", async () => {
  const project = tempProject();
  const output = await runAdapter(
    {
      session_id: "duplicate-read",
      cwd: project,
      hook_event_name: "PostToolUse",
      tool_input: {
        command: "cat " + path.join(project, "child.md") + "; cat " +
          path.join(project, "child.md"),
      },
    },
    tempDirectory("classifier-cache-"),
  );

  const context = (output.value.hookSpecificOutput as Record<string, string>)
    .additionalContext;
  assertEquals(context.match(/PARENT_MARKER/g)?.length, 1);
});

Deno.test("quoted read paths with spaces preserve the exact read identity", async () => {
  const project = tempProject();
  fs.writeFileSync(path.join(project, "space parent.md"), "SPACE_PARENT\n");
  fs.writeFileSync(
    path.join(project, "space child.md"),
    "<!-- parents: @space parent.md -->\n# Child\n",
  );

  const output = await runAdapter(
    {
      session_id: "quoted-read",
      cwd: project,
      hook_event_name: "PostToolUse",
      tool_input: {
        command: "cat '" + path.join(project, "space child.md") + "'",
      },
    },
    tempDirectory("classifier-cache-"),
  );

  assertEquals(output.code, 0);
  const context = (output.value.hookSpecificOutput as Record<string, string>)
    .additionalContext;
  assertStringIncludes(context, "SPACE_PARENT");
});

for (const shape of ["cat", "sed"] as const) {
  Deno.test(`Codex native classifier recognizes absolute read command: ${shape}`, async () => {
    const project = tempProject();
    const file = path.join(project, "child.md");
    const command = shape === "cat" ? `cat ${file}` : `sed -n '1,20p' ${file}`;
    const output = await runAdapter(
      {
        session_id: `classifier-${command}`,
        cwd: project,
        hook_event_name: "PostToolUse",
        tool_input: { command },
      },
      tempDirectory("classifier-cache-"),
    );

    assertEquals(output.code, 0);
    const hook = output.value.hookSpecificOutput as Record<string, string>;
    assertStringIncludes(hook.additionalContext, "PARENT_MARKER");
    assertEquals(
      output.value.systemMessage,
      "Frostline context added for parent.md.",
    );
  });
}

Deno.test("relative command-only read resolves when the hook cwd matches a no-Git project", async () => {
  const project = tempDirectory("cwd-project-");
  fs.writeFileSync(path.join(project, "parent.md"), "CWD_PARENT\n");
  fs.writeFileSync(
    path.join(project, "child.md"),
    "<!-- parents: @parent.md -->\n# Child\n",
  );

  const output = await runAdapter(
    {
      session_id: "cwd-fallback",
      cwd: project,
      hook_event_name: "PostToolUse",
      tool_input: { command: "cat child.md" },
    },
    tempDirectory("cwd-cache-"),
  );

  assertEquals(output.code, 0);
  const hook = output.value.hookSpecificOutput as Record<string, string>;
  assertStringIncludes(hook.additionalContext, "CWD_PARENT");
  assertEquals(
    output.value.systemMessage,
    `Frostline context added for ${path.join(project, "parent.md")}.`,
  );
});

const skillNames = [
  "frostline-graph",
];

Deno.test("Codex native adapter has no Core or Workflows dependency", () => {
  const manifest = fs.readFileSync(
    path.join(repositoryRoot, "integrations/codex/native/Cargo.toml"),
    "utf8",
  );
  assertEquals(manifest.includes("frostline-core"), false);
  assertEquals(manifest.includes("frostline-workflows"), false);
});

Deno.test("Codex adapter contains only classification and transport logic", () => {
  const source = fs.readFileSync(
    path.join(repositoryRoot, "integrations/codex/native/src/adapter.rs"),
    "utf8",
  );
  for (
    const forbidden of [
      "AncestryGraph",
      "ProjectIndex",
      "render_context",
      "candidate",
      "publication",
      "verification",
    ]
  ) {
    assertEquals(source.includes(forbidden), false);
  }
  assertEquals(source.includes("classify_reads"), true);
  assertEquals(source.includes("Command::new(core_binary"), true);
  assertEquals(source.includes("PP_SESSION_START_PROMPT"), false);
});

Deno.test("canonical FLI skills are harness-independent and not Workflows wrappers", () => {
  for (const skill of skillNames) {
    const content = fs.readFileSync(
      path.join(repositoryRoot, "packages/skills", skill, "SKILL.md"),
      "utf8",
    );
    assertEquals(content.includes(`name: ${skill}`), true);
    assertEquals(content.includes("description:"), true);
    assertEquals(content.includes("Load when"), true);
    assertEquals(content.includes("fli-workflows"), false);
  }
});
