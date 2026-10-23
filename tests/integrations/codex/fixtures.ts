// parents: @.frostline/graph/v-m-codex-hook.xml

import * as fs from "node:fs";
import * as path from "node:path";

export const repositoryRoot = path.resolve(
  new URL("../../../", import.meta.url).pathname,
);
export const adapterBinary = path.join(
  repositoryRoot,
  "integrations/codex/native/target/release/frostline-codex",
);
export const coreBinary = path.join(repositoryRoot, "packages/core/bin/fli");

const scratch = fs.mkdtempSync(
  path.join(fs.realpathSync("/tmp"), "fli-codex-tests-"),
);
globalThis.addEventListener("unload", () => {
  fs.rmSync(scratch, { recursive: true, force: true });
});

export function tempProject(): string {
  const root = fs.mkdtempSync(path.join(scratch, "project-"));
  fs.mkdirSync(path.join(root, ".git"), { recursive: true });
  fs.writeFileSync(path.join(root, ".git", "HEAD"), "ref: refs/heads/main\n");
  fs.writeFileSync(path.join(root, "parent.md"), "PARENT_MARKER\n");
  fs.writeFileSync(
    path.join(root, "child.md"),
    "<!-- parents: @parent.md -->\nCHILD_MARKER\n",
  );
  return root;
}

export function tempDirectory(prefix: string): string {
  return fs.mkdtempSync(path.join(scratch, prefix));
}

export async function runAdapter(
  input: unknown,
  cacheRoot: string,
  env: Record<string, string> = {},
): Promise<{ code: number; value: Record<string, unknown>; stderr: string }> {
  const command = new Deno.Command(adapterBinary, {
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
    env: {
      ...Deno.env.toObject(),
      FLI_CORE_BIN: coreBinary,
      FLI_CACHE_DIR: cacheRoot,
      ...env,
    },
  });
  const child = command.spawn();
  const bytes = new TextEncoder().encode(JSON.stringify(input));
  const writer = child.stdin.getWriter();
  await writer.write(bytes);
  writer.releaseLock();
  child.stdin.close();
  const output = await child.output();
  const stdout = new TextDecoder().decode(output.stdout);
  return {
    code: output.code,
    value: JSON.parse(stdout) as Record<string, unknown>,
    stderr: new TextDecoder().decode(output.stderr),
  };
}
