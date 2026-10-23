// parents: @.frostline/graph/v-s-core.xml

import * as fs from "node:fs";
import * as path from "node:path";

const scratch = fs.mkdtempSync(
  path.join(fs.realpathSync("/tmp"), "fli-core-tests-"),
);
globalThis.addEventListener("unload", () => {
  fs.rmSync(scratch, { recursive: true, force: true });
});

export class Project {
  readonly root: string;

  private constructor(root: string) {
    this.root = root;
  }

  static create(): Project {
    const root = fs.mkdtempSync(path.join(scratch, "project-"));
    fs.mkdirSync(path.join(root, ".git"), { recursive: true });
    fs.writeFileSync(path.join(root, ".git", "HEAD"), "ref: refs/heads/main\n");
    return new Project(root);
  }

  write(relative: string, content: string): string {
    const value = this.path(relative);
    fs.mkdirSync(path.dirname(value), { recursive: true });
    fs.writeFileSync(value, content, "utf8");
    return value;
  }

  path(relative: string): string {
    return path.join(this.root, relative);
  }
}

export function tempDirectory(prefix: string): string {
  return fs.mkdtempSync(path.join(scratch, prefix));
}
