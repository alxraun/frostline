// parents: @.frostline/graph/v-ss-distribution.xml

import * as fs from "node:fs";
import * as path from "node:path";
import { assertEquals, assertStringIncludes } from "../core/assert.ts";

{
  const root = path.resolve(new URL("../../", import.meta.url).pathname);
  const skillNames = [
    "frostline-graph",
  ];

  Deno.test("default Codex package contains Core plus canonical skills", () => {
    const work = fs.mkdtempSync(
      path.join(fs.realpathSync("/tmp"), "fli-release-"),
    );
    try {
      const output = path.join(work, "plugin");
      run([path.join(root, "scripts/package.sh"), "codex", output]);
      run([path.join(root, "scripts/verify.sh"), "codex", output]);
      assertEquals(fs.existsSync(path.join(output, "bin/fli")), true);
      assertEquals(
        fs.existsSync(path.join(output, "bin/frostline-codex")),
        true,
      );
      assertEquals(
        fs.readdirSync(path.join(output, "skills")).sort(),
        skillNames,
      );
      assertEquals(fs.existsSync(path.join(output, "manifest.sha256")), true);
      assertEquals(
        fs.existsSync(path.join(output, "share/prompts/session-start.md")),
        false,
      );
    } finally {
      fs.rmSync(work, { recursive: true, force: true });
    }
  });

  Deno.test("packaged Codex SessionStart is lifecycle-only", async () => {
    const work = fs.mkdtempSync(
      path.join(fs.realpathSync("/tmp"), "fli-release-session-"),
    );
    try {
      const plugin = path.join(work, "plugin");
      const cache = path.join(work, "cache");
      run([path.join(root, "scripts/package.sh"), "codex", plugin]);
      const result = await invokeAdapter(plugin, cache, {
        session_id: "packaged-session",
        cwd: work,
        hook_event_name: "SessionStart",
        source: "startup",
      });

      assertEquals(result.code, 0);
      assertEquals(result.value.hookSpecificOutput, undefined);
      assertEquals(
        result.value.systemMessage,
        "Frostline is active for this session.",
      );
    } finally {
      fs.rmSync(work, { recursive: true, force: true });
    }
  });

  Deno.test("packaged Codex PostToolUse calls sibling Core and injects context", async () => {
    const work = fs.mkdtempSync(
      path.join(fs.realpathSync("/tmp"), "fli-release-read-"),
    );
    try {
      const plugin = path.join(work, "plugin");
      const project = path.join(work, "project");
      const cache = path.join(work, "cache");
      run([path.join(root, "scripts/package.sh"), "codex", plugin]);
      fs.mkdirSync(path.join(project, ".git"), { recursive: true });
      fs.writeFileSync(
        path.join(project, ".git/HEAD"),
        "ref: refs/heads/main\n",
      );
      fs.writeFileSync(path.join(project, "parent.md"), "PACKAGED_PARENT\n");
      fs.writeFileSync(
        path.join(project, "child.md"),
        "<!-- parents: @parent.md -->\n# Child\n",
      );

      const result = await invokeAdapter(plugin, cache, {
        session_id: "packaged-read",
        cwd: project,
        hook_event_name: "PostToolUse",
        tool_input: { command: `cat ${path.join(project, "child.md")}` },
      });

      assertEquals(result.code, 0);
      const hook = result.value.hookSpecificOutput as Record<string, string>;
      assertStringIncludes(hook.additionalContext, "PACKAGED_PARENT");
    } finally {
      fs.rmSync(work, { recursive: true, force: true });
    }
  });

  Deno.test("packaged Codex hook bounds a hung Core before the harness deadline", async () => {
    const work = fs.mkdtempSync(
      path.join(fs.realpathSync("/tmp"), "fli-release-timeout-"),
    );
    try {
      const plugin = path.join(work, "plugin");
      const hangingCore = path.join(work, "hanging-core.sh");
      run([path.join(root, "scripts/package.sh"), "codex", plugin]);
      fs.writeFileSync(hangingCore, "#!/usr/bin/env bash\nsleep 30\n");
      fs.chmodSync(hangingCore, 0o755);

      const started = performance.now();
      const result = await invokeAdapter(plugin, path.join(work, "cache"), {
        session_id: "packaged-timeout",
        cwd: work,
        hook_event_name: "PostToolUse",
        tool_input: { command: `cat ${hangingCore}` },
      }, {
        FLI_CORE_BIN: hangingCore,
        FLI_CORE_TIMEOUT_MS: "50",
      });

      assertEquals(result.code, 0);
      assertEquals(performance.now() - started < 2_000, true);
      assertStringIncludes(
        String(result.value.systemMessage),
        "Frostline could not complete this event: FLI Core timed out after 50ms.",
      );
    } finally {
      fs.rmSync(work, { recursive: true, force: true });
    }
  });

  Deno.test("packaged Codex PostToolUse ignores plugin-internal reads", async () => {
    const work = fs.mkdtempSync(
      path.join(fs.realpathSync("/tmp"), "fli-release-self-read-"),
    );
    try {
      const plugin = path.join(work, "plugin");
      const project = path.join(work, "project");
      const cache = path.join(work, "cache");
      run([path.join(root, "scripts/package.sh"), "codex", plugin]);
      fs.mkdirSync(path.join(project, ".git"), { recursive: true });
      fs.writeFileSync(
        path.join(project, ".git/HEAD"),
        "ref: refs/heads/main\n",
      );
      fs.writeFileSync(path.join(project, "parent.md"), "PACKAGED_PARENT\n");
      fs.writeFileSync(
        path.join(project, "child.md"),
        "<!-- parents: @parent.md -->\n# Child\n",
      );
      const internalSkill = path.join(
        plugin,
        "skills/frostline-graph/SKILL.md",
      );

      const result = await invokeAdapter(plugin, cache, {
        session_id: "packaged-self-read",
        cwd: project,
        hook_event_name: "PostToolUse",
        tool_input: { command: `cat ${internalSkill}` },
      });

      assertEquals(result.code, 0);
      assertEquals(result.value.hookSpecificOutput, undefined);
      assertEquals(result.value.systemMessage, undefined);
    } finally {
      fs.rmSync(work, { recursive: true, force: true });
    }
  });

  const run = (command: string[]): void => {
    const output = new Deno.Command(command[0], {
      args: command.slice(1),
      cwd: root,
      stdout: "piped",
      stderr: "piped",
    }).outputSync();
    assertEquals(output.code, 0, new TextDecoder().decode(output.stderr));
  };

  const invokeAdapter = async (
    plugin: string,
    cache: string,
    input: unknown,
    env: Record<string, string> = {},
  ): Promise<{ code: number; value: Record<string, unknown> }> => {
    const command = new Deno.Command(
      path.join(plugin, "bin/frostline-codex"),
      {
        stdin: "piped",
        stdout: "piped",
        stderr: "piped",
        clearEnv: true,
        env: {
          FLI_CACHE_DIR: cache,
          ...env,
        },
      },
    );
    const child = command.spawn();
    const writer = child.stdin.getWriter();
    await writer.write(new TextEncoder().encode(JSON.stringify(input)));
    writer.releaseLock();
    child.stdin.close();
    const output = await child.output();
    return {
      code: output.code,
      value: JSON.parse(new TextDecoder().decode(output.stdout)) as Record<
        string,
        unknown
      >,
    };
  };
}

{
  const root = path.resolve(new URL("../../", import.meta.url).pathname);
  const composeScript = path.join(root, "scripts/package.sh");
  const verifyScript = path.join(root, "scripts/verify.sh");

  Deno.test("package verifier rejects unmanifested extra content", () => {
    withPackage((plugin) => {
      fs.writeFileSync(path.join(plugin, "unexpected.txt"), "unexpected\n");
      const failure = verifyFailure(plugin);
      assertStringIncludes(failure.stderr, "manifest is incomplete");
    });
  });

  Deno.test("package verifier rejects modified manifested content", () => {
    withPackage((plugin) => {
      fs.appendFileSync(
        path.join(plugin, "skills/frostline-graph/SKILL.md"),
        "\nTAMPERED\n",
      );
      const failure = verifyFailure(plugin);
      assertEquals(failure.code !== 0, true);
    });
  });

  Deno.test("package verifier rejects missing manifested content", () => {
    withPackage((plugin) => {
      fs.rmSync(path.join(plugin, ".codex-plugin/plugin.json"));
      const failure = verifyFailure(plugin);
      assertEquals(failure.code !== 0, true);
    });
  });

  Deno.test("package verifier rejects duplicate manifest entries", () => {
    withPackage((plugin) => {
      const manifest = path.join(plugin, "manifest.sha256");
      const first = fs.readFileSync(manifest, "utf8").split("\n")[0];
      fs.appendFileSync(manifest, `${first}\n`);
      const failure = verifyFailure(plugin);
      assertStringIncludes(failure.stderr, "manifest is incomplete");
    });
  });

  Deno.test("package ships license notices covering every lockfile crate", () => {
    withPackage((plugin) => {
      const notice = fs.readFileSync(
        path.join(plugin, "licenses/NOTICE.md"),
        "utf8",
      );
      const lockCrates = [
        "packages/read-classifier",
        "integrations/codex/native",
      ].flatMap((directory) =>
        fs.readFileSync(path.join(root, directory, "Cargo.lock"), "utf8")
          .split("\n")
          .filter((line) => line.startsWith("name = "))
          .map((line) => line.split('"')[1])
      );
      assertEquals(lockCrates.length > 400, true);
      for (const name of new Set(lockCrates)) {
        assertStringIncludes(notice, `| ${name}@`);
      }
      for (const text of fs.readdirSync(path.join(plugin, "licenses"))) {
        if (text === "NOTICE.md") continue;
        assertEquals(
          fs.statSync(path.join(plugin, "licenses", text)).size > 0,
          true,
        );
      }
      assertStringIncludes(notice, "Apache-2.0");
    });
  });

  const withPackage = (operation: (plugin: string) => void): void => {
    const work = fs.mkdtempSync(
      path.join(fs.realpathSync("/tmp"), "fli-manifest-test-"),
    );
    try {
      const plugin = path.join(work, "plugin");
      const compose = new Deno.Command(composeScript, {
        args: ["codex", plugin],
        cwd: root,
        stdout: "piped",
        stderr: "piped",
      }).outputSync();
      assertEquals(compose.code, 0, new TextDecoder().decode(compose.stderr));
      operation(plugin);
    } finally {
      fs.rmSync(work, { recursive: true, force: true });
    }
  };

  const verifyFailure = (
    plugin: string,
  ): { code: number; stderr: string } => {
    const output = new Deno.Command(verifyScript, {
      args: ["codex", plugin],
      cwd: root,
      stdout: "piped",
      stderr: "piped",
    }).outputSync();
    assertEquals(output.code !== 0, true);
    return {
      code: output.code,
      stderr: new TextDecoder().decode(output.stderr),
    };
  };
}

{
  const root = path.resolve(new URL("../../", import.meta.url).pathname);

  Deno.test("repository build rejects unsupported release platform before toolchain work", () => {
    const work = fs.mkdtempSync(
      path.join(fs.realpathSync("/tmp"), "fli-platform-test-"),
    );
    try {
      const fakeUname = path.join(work, "uname");
      fs.writeFileSync(
        fakeUname,
        '#!/bin/sh\ncase "$1" in -s) echo Darwin ;; -m) echo arm64 ;; *) exit 2 ;; esac\n',
      );
      fs.chmodSync(fakeUname, 0o755);
      const output = new Deno.Command(path.join(root, "scripts/build.sh"), {
        cwd: root,
        env: {
          ...Deno.env.toObject(),
          PATH: `${work}:${Deno.env.get("PATH") ?? ""}`,
        },
        stdout: "piped",
        stderr: "piped",
      }).outputSync();

      assertEquals(output.code, 2);
      assertStringIncludes(
        new TextDecoder().decode(output.stderr),
        "current release target is Linux/x86_64",
      );
    } finally {
      fs.rmSync(work, { recursive: true, force: true });
    }
  });
}

{
  const repositoryRoot = path.resolve(
    new URL("../../", import.meta.url).pathname,
  );

  Deno.test("Core builds from an isolated copy with no integrations", () => {
    const work = fs.mkdtempSync(
      path.join(fs.realpathSync("/tmp"), "fli-core-isolated-build-"),
    );
    try {
      const source = path.join(repositoryRoot, "packages/core");
      const core = path.join(work, "core");
      fs.mkdirSync(core);
      for (const file of ["deno.json", "package.json"]) {
        fs.copyFileSync(path.join(source, file), path.join(core, file));
      }
      fs.cpSync(path.join(source, "src"), path.join(core, "src"), {
        recursive: true,
      });

      assertEquals(fs.existsSync(path.join(work, "integrations")), false);

      const output = new Deno.Command("deno", {
        args: ["task", "build"],
        cwd: core,
        stdout: "piped",
        stderr: "piped",
      }).outputSync();

      assertEquals(
        output.code,
        0,
        new TextDecoder().decode(output.stderr),
      );
      assertEquals(fs.existsSync(path.join(core, "bin/fli")), true);
    } finally {
      fs.rmSync(work, { recursive: true, force: true });
    }
  });
}
