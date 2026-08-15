// The files backend for the flow state.
//
// "`files`: lock exclusivo, fencing token monotónico y escritura temporal +
// `fsync` + rename. Request y result transportan el token."
//
// The fencing token is the part that is easy to skip and expensive to skip.
// A lock alone is not enough: a writer can acquire the lock, stall long enough
// for the lock to be reclaimed as stale, and wake up believing it still holds
// it. The token makes that detectable, because the reclaimer bumped it and the
// sleeper's number is now in the past.
//
// The token is persisted in the state, not held in memory, for the same reason
// the journal is durable: a number that only exists in the process that issued
// it cannot outlive the crash it was meant to survive.
//
// DEBT: the durable-write primitives below are a third copy of the same idea —
// harness-code and harness-db each grew one, and harness-install has the good
// version. The plan already names a shared package as the fix; this repeats the
// duplication rather than blocking Phase 4 on it, and says so out loud instead
// of letting the third copy pass unnoticed.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { StateRejected, type FlowState, type WriteContext } from "./state";

export interface StoreLayout {
  /** Directory holding one state file per change. */
  root: string;
}

export function statePath(layout: StoreLayout, changeId: string): string {
  return path.join(layout.root, `${changeId}.state.json`);
}

export function lockPath(layout: StoreLayout, changeId: string): string {
  return path.join(layout.root, `${changeId}.lock`);
}

function fsyncDir(dir: string): void {
  let fd: number;
  try {
    fd = fs.openSync(dir, "r");
  } catch {
    return;
  }
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

function writeJsonDurable(file: string, value: unknown): void {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.tmp`);
  const fd = fs.openSync(tmp, "w");
  try {
    fs.writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  try {
    fs.renameSync(tmp, file);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw e;
  }
  fsyncDir(dir);
}

export function readState(layout: StoreLayout, changeId: string): FlowState | null {
  try {
    return JSON.parse(fs.readFileSync(statePath(layout, changeId), "utf8")) as FlowState;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    // Unreadable is not absent. Treating it as absent would start a second flow
    // over a first one nobody can read but which may still be running.
    throw new StateRejected(
      "divergent",
      `${statePath(layout, changeId)} exists but cannot be read: ${(e as Error).message}`
    );
  }
}

export interface LockHolder {
  pid: number;
  hostname: string;
  acquired_at: string;
  fencing_token: number;
}

export class LockHeld extends Error {
  constructor(readonly holder: LockHolder) {
    super(
      `state is locked by pid ${holder.pid} on ${holder.hostname} since ${holder.acquired_at} (token ${holder.fencing_token})`
    );
    this.name = "LockHeld";
  }
}

export interface AcquireOptions {
  self?: { pid: number; hostname: string };
  now?: () => string;
  isAlive?: (pid: number) => boolean;
}

function defaultIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

export interface Session {
  changeId: string;
  ctx: WriteContext;
  state: FlowState;
  /** Persist a new state produced by a pure transition. */
  commit(next: FlowState): FlowState;
  release(): void;
}

/**
 * Take the lock, read the state and issue a fencing token one higher than the
 * state has seen.
 *
 * The token is bumped at ACQUISITION, not at write. Bumping at write would let
 * two writers both believe they are current until the first one commits, and by
 * then the second has already made its decisions.
 */
export function open(
  layout: StoreLayout,
  changeId: string,
  seed: FlowState,
  options: AcquireOptions = {}
): Session {
  const self = options.self ?? { pid: process.pid, hostname: os.hostname() };
  const now = options.now ?? (() => new Date().toISOString());
  const isAlive = options.isAlive ?? defaultIsAlive;
  const lock = lockPath(layout, changeId);

  fs.mkdirSync(layout.root, { recursive: true });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = fs.openSync(lock, "wx");
      fs.closeSync(fd);
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      const existing = readHolder(lock);
      // Only a lock left by a dead process on THIS host can be judged stale:
      // "its pid is not running here" says nothing about there.
      if (
        existing === null ||
        (existing.hostname === self.hostname && !isAlive(existing.pid))
      ) {
        fs.rmSync(lock, { force: true });
        continue;
      }
      throw new LockHeld(existing);
    }
  }

  let state = readState(layout, changeId) ?? seed;
  const token = state.fencing_token + 1;

  const holder: LockHolder = {
    pid: self.pid,
    hostname: self.hostname,
    acquired_at: now(),
    fencing_token: token,
  };
  writeJsonDurable(lock, holder);

  // Persisted immediately: a token that only exists in this process cannot
  // outlive the crash it was meant to survive, and the next writer would reuse
  // it and look current.
  state = { ...state, fencing_token: token };
  writeJsonDurable(statePath(layout, changeId), state);

  let current = state;
  let released = false;

  return {
    changeId,
    get ctx(): WriteContext {
      return { readRevision: current.state_revision, fencingToken: token };
    },
    get state(): FlowState {
      return current;
    },
    commit(next: FlowState): FlowState {
      if (released) {
        throw new StateRejected("fenced", "session already released");
      }
      writeJsonDurable(statePath(layout, changeId), next);
      current = next;
      return next;
    },
    release(): void {
      if (released) return;
      const held = readHolder(lock);
      // Only remove a lock that still describes us: if a stale reclaim handed
      // it to somebody else, deleting it would unlock their session.
      if (held !== null && held.fencing_token === token) {
        fs.rmSync(lock, { force: true });
        fsyncDir(path.dirname(lock));
      }
      released = true;
    },
  };
}

export function readHolder(lock: string): LockHolder | null {
  try {
    return JSON.parse(fs.readFileSync(lock, "utf8")) as LockHolder;
  } catch {
    return null;
  }
}

/** Run `fn` under the lock, releasing it even when `fn` throws. */
export function withSession<T>(
  layout: StoreLayout,
  changeId: string,
  seed: FlowState,
  fn: (session: Session) => T,
  options: AcquireOptions = {}
): T {
  const session = open(layout, changeId, seed, options);
  try {
    return fn(session);
  } finally {
    session.release();
  }
}
