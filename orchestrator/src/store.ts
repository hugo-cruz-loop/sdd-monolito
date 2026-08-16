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
// The durable-write and locking primitives come from `harness-core`. They used
// to be a fourth private copy of the same idea; the shared package exists
// because four copies that each declared themselves deliberate are still four
// copies nobody was going to fix.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  ExclusiveLock,
  LockHeldError,
  fsyncDir,
  readHolder as readLockHolder,
  writeJsonDurable,
  type LockHolder,
} from "harness-core";
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

/** What this orchestrator records about itself in the lock. */
export interface FlowLockMetadata {
  fencing_token: number;
}

export type FlowLockHolder = LockHolder<FlowLockMetadata>;

export { LockHeldError };

export interface AcquireOptions {
  self?: { pid: number; hostname: string };
  now?: () => string;
  isAlive?: (pid: number) => boolean;
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
  const lockFile = lockPath(layout, changeId);
  fs.mkdirSync(layout.root, { recursive: true });

  // Read before locking only to learn the token to claim; the authoritative
  // read happens under the lock, below.
  const token = (readState(layout, changeId)?.fencing_token ?? seed.fencing_token) + 1;

  const lock = ExclusiveLock.acquire<FlowLockMetadata>(lockFile, {
    metadata: { fencing_token: token },
    self: options.self,
    now: options.now,
    isAlive: options.isAlive,
    reason:
      "a second orchestrator would dispatch against a state this one is about to change, and neither result would describe the flow that actually ran",
  });

  let state = readState(layout, changeId) ?? seed;

  // Persisted immediately: a token that only exists in this process cannot
  // outlive the crash it was meant to survive, and the next writer would reuse
  // it and look current.
  state = { ...state, fencing_token: token };
  writeJsonDurable(statePath(layout, changeId), state);

  let current = state;

  return {
    changeId,
    get ctx(): WriteContext {
      return { readRevision: current.state_revision, fencingToken: token };
    },
    get state(): FlowState {
      return current;
    },
    commit(next: FlowState): FlowState {
      if (lock.isReleased) {
        throw new StateRejected("fenced", "session already released");
      }
      writeJsonDurable(statePath(layout, changeId), next);
      current = next;
      return next;
    },
    release(): void {
      lock.release();
    },
  };
}

export function readHolder(lock: string): FlowLockHolder | null {
  return readLockHolder<FlowLockMetadata>(lock);
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
