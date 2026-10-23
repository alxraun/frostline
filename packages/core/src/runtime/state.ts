// parents: @.frostline/graph/m-discovery.xml, @.frostline/graph/ss-runtime.xml

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export interface ProjectCacheFile {
  size: number;
  mtimeMs: number;
  ctimeMs: number;
  ino: number;
  symlink: boolean;
  leadingSource?: string | null;
}

export interface ProjectCache {
  files: Record<string, ProjectCacheFile>;
}

export interface CoreState {
  version: 1;
  projects: Record<string, ProjectCache>;
  delivery: Record<string, Record<string, Record<string, string>>>;
}

interface LockSnapshot {
  token: string;
  pid: number | undefined;
  stale: boolean;
}

export function defaultCacheDirectory(): string {
  const explicit = process.env.FLI_CACHE_DIR;
  if (explicit) return path.resolve(explicit);
  const xdg = process.env.XDG_CACHE_HOME;
  if (xdg) return path.join(path.resolve(xdg), "frostline");
  const home = process.env.HOME;
  if (home) return path.join(home, ".cache", "frostline");
  return path.join(os.tmpdir(), "frostline-cache");
}

export function loadState(cacheDirectory: string): CoreState | undefined {
  try {
    const value: unknown = JSON.parse(
      fs.readFileSync(path.join(cacheDirectory, "state.json"), "utf8"),
    );
    return isCoreState(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

export function persistState(cacheDirectory: string, state: CoreState): void {
  fs.mkdirSync(cacheDirectory, { recursive: true });
  const temporary = path.join(
    cacheDirectory,
    `.state-${crypto.randomUUID()}.json`,
  );
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    fs.renameSync(temporary, path.join(cacheDirectory, "state.json"));
  } finally {
    try {
      fs.rmSync(temporary, { force: true });
    } catch {
      // Derived-state temporary cleanup is best-effort.
    }
  }
}

export function updateState<T>(
  cacheDirectory: string,
  update: (state: CoreState) => T,
): T {
  return withStateLock(cacheDirectory, () => {
    const state = loadState(cacheDirectory) ?? emptyState();
    const result = update(state);
    persistState(cacheDirectory, state);
    return result;
  });
}

export function withStateLock<T>(
  cacheDirectory: string,
  operation: () => T,
): T {
  fs.mkdirSync(cacheDirectory, { recursive: true });
  const lock = path.join(cacheDirectory, ".state.lock");
  const deadline = Date.now() + 2_000;
  for (;;) {
    let descriptor: number | undefined;
    try {
      descriptor = fs.openSync(lock, "wx");
      try {
        fs.writeFileSync(
          descriptor,
          `${process.pid}\n${crypto.randomUUID()}\n`,
          "utf8",
        );
        break;
      } finally {
        fs.closeSync(descriptor);
      }
    } catch (error) {
      if (descriptor !== undefined) removeLock(lock);
      if (!isAlreadyExists(error)) throw error;
      const snapshot = readLockSnapshot(lock);
      if (
        snapshot && lockIsStale(snapshot) &&
        readLockSnapshot(lock)?.token === snapshot.token
      ) {
        removeLock(lock);
        continue;
      }
      if (Date.now() >= deadline) {
        throw new Error("timed out waiting for FLI derived-state lock");
      }
      sleep(5);
      continue;
    }
  }

  try {
    return operation();
  } finally {
    removeLock(lock);
  }
}

export function emptyState(): CoreState {
  return { version: 1, projects: {}, delivery: {} };
}

function isCoreState(value: unknown): value is CoreState {
  if (!isRecord(value) || value.version !== 1) return false;
  if (!isRecord(value.projects) || !isRecord(value.delivery)) return false;

  for (const project of Object.values(value.projects)) {
    if (!isRecord(project) || !isRecord(project.files)) return false;
    for (const file of Object.values(project.files)) {
      if (!isProjectCacheFile(file)) return false;
    }
  }

  for (const session of Object.values(value.delivery)) {
    if (!isRecord(session)) return false;
    for (const context of Object.values(session)) {
      if (!isRecord(context)) return false;
      for (const delivered of Object.values(context)) {
        if (typeof delivered !== "string") return false;
      }
    }
  }
  return true;
}

function isProjectCacheFile(value: unknown): value is ProjectCacheFile {
  if (!isRecord(value)) return false;
  if (
    typeof value.size !== "number" || typeof value.mtimeMs !== "number" ||
    typeof value.ctimeMs !== "number" || typeof value.ino !== "number" ||
    typeof value.symlink !== "boolean"
  ) {
    return false;
  }
  return value.leadingSource === undefined || value.leadingSource === null ||
    typeof value.leadingSource === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readLockSnapshot(lock: string): LockSnapshot | undefined {
  let owner = lock;
  try {
    if (fs.statSync(lock).isDirectory()) owner = path.join(lock, "owner");
  } catch {
    return undefined;
  }
  try {
    const token = fs.readFileSync(owner, "utf8").trim();
    const pid = Number.parseInt(token.split("\n")[0] ?? "", 10);
    if (Number.isFinite(pid) && pid > 0) {
      if (process.platform === "linux") {
        return { token, pid, stale: !fs.existsSync(`/proc/${pid}`) };
      }
      try {
        process.kill(pid, 0);
        return { token, pid, stale: false };
      } catch (error) {
        if (isNoSuchProcess(error)) return { token, pid, stale: true };
        if (errorCode(error) === "EPERM") return { token, pid, stale: false };
      }
    }
  } catch {
    // A process may have created the lock but not owner metadata yet.
  }
  try {
    return {
      token: "",
      pid: undefined,
      stale: Date.now() - fs.statSync(lock).mtimeMs > 30_000,
    };
  } catch {
    return undefined;
  }
}

function lockIsStale(snapshot: LockSnapshot): boolean {
  return snapshot.stale;
}

function removeLock(lock: string): void {
  try {
    if (fs.statSync(lock).isDirectory()) {
      fs.rmSync(lock, { recursive: true, force: true });
    } else {
      fs.rmSync(lock, { force: true });
    }
  } catch {
    // Derived-state cleanup failure must never become semantic authority.
  }
}

function isAlreadyExists(error: unknown): boolean {
  return errorCode(error) === "EEXIST";
}

function isNoSuchProcess(error: unknown): boolean {
  return errorCode(error) === "ESRCH";
}

function errorCode(error: unknown): unknown {
  return typeof error === "object" && error !== null && "code" in error
    ? (error as { code?: unknown }).code
    : undefined;
}

function sleep(milliseconds: number): void {
  const buffer = new SharedArrayBuffer(4);
  Atomics.wait(new Int32Array(buffer), 0, 0, milliseconds);
}
