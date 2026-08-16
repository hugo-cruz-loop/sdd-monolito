import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  LockHeldError,
  open,
  readHolder,
  readState,
  lockPath,
  statePath,
  withSession,
  type StoreLayout,
} from "../src/store";
import {
  StateRejected,
  assertWritable,
  dispatch,
  initialState,
  type FlowState,
} from "../src/state";

let root: string;
let layout: StoreLayout;

const CHANGE = "billing-service--add-payment-idempotency";
const now = () => "2026-08-13T10:00:00Z";

const seed = (): FlowState =>
  initialState({
    businessProject: "payments-platform",
    unit: "billing-service",
    changeId: CHANGE,
  });

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-flow-"));
  layout = { root: path.join(root, "state") };
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("opening a session", () => {
  it("creates the state on first open", () => {
    const s = open(layout, CHANGE, seed(), { now });
    try {
      expect(fs.existsSync(statePath(layout, CHANGE))).toBe(true);
      expect(s.state.change_id).toBe(CHANGE);
    } finally {
      s.release();
    }
  });

  it("reads back an existing state instead of reseeding it", () => {
    withSession(layout, CHANGE, seed(), (s) => {
      s.commit(
        dispatch(s.state, s.ctx, {
          stage: "requirements",
          owner: "o",
          attemptId: "a1",
          requestId: "r1",
          inputRefs: [],
          inputDigests: [],
          now,
        })
      );
    }, { now });

    withSession(layout, CHANGE, seed(), (s) => {
      expect(s.state.stages.requirements?.status).toBe("running");
    }, { now });
  });

  // Bumped at acquisition, not at write: bumping at write would let two writers
  // both believe they are current until the first commits, and by then the
  // second has already decided.
  it("issues a token one higher than the state has seen, at acquisition", () => {
    const first = open(layout, CHANGE, seed(), { now });
    expect(first.ctx.fencingToken).toBe(1);
    first.release();

    const second = open(layout, CHANGE, seed(), { now });
    expect(second.ctx.fencingToken).toBe(2);
    second.release();
  });

  // A token that only exists in the process that issued it cannot outlive the
  // crash it was meant to survive.
  it("persists the token before handing it out", () => {
    const s = open(layout, CHANGE, seed(), { now });
    try {
      expect(readState(layout, CHANGE)?.fencing_token).toBe(1);
    } finally {
      s.release();
    }
  });
});

describe("the lock", () => {
  it("refuses a second live writer", () => {
    const first = open(layout, CHANGE, seed(), {
      self: { pid: 4242, hostname: "build-01" },
      now,
      isAlive: () => true,
    });
    try {
      expect(() =>
        open(layout, CHANGE, seed(), {
          self: { pid: 4243, hostname: "build-01" },
          now,
          isAlive: () => true,
        })
      ).toThrow(LockHeldError);
    } finally {
      first.release();
    }
  });

  it("reclaims a lock left by a dead process on this host", () => {
    open(layout, CHANGE, seed(), {
      self: { pid: 4242, hostname: "build-01" },
      now,
      isAlive: () => true,
    });
    const second = open(layout, CHANGE, seed(), {
      self: { pid: 4243, hostname: "build-01" },
      now,
      isAlive: () => false,
    });
    try {
      expect(readHolder(lockPath(layout, CHANGE))?.pid).toBe(4243);
    } finally {
      second.release();
    }
  });

  // "Its pid is not running here" says nothing about there.
  it("refuses to judge a lock held by another host", () => {
    open(layout, CHANGE, seed(), {
      self: { pid: 4242, hostname: "other-host" },
      now,
      isAlive: () => true,
    });
    expect(() =>
      open(layout, CHANGE, seed(), {
        self: { pid: 4243, hostname: "build-01" },
        now,
        isAlive: () => false,
      })
    ).toThrow(LockHeldError);
  });

  it("releases even when the guarded work throws", () => {
    expect(() =>
      withSession(layout, CHANGE, seed(), () => {
        throw new Error("boom");
      }, { now })
    ).toThrow("boom");
    expect(fs.existsSync(lockPath(layout, CHANGE))).toBe(false);
  });

  // If a stale reclaim handed the lock to somebody else, deleting it here would
  // unlock their session. The comparison is on pid + hostname + acquired_at,
  // not on the token: pids get reused, and a token nobody read is not identity.
  it("does not remove a lock that now belongs to somebody else", () => {
    const mine = open(layout, CHANGE, seed(), { now });
    fs.writeFileSync(
      lockPath(layout, CHANGE),
      JSON.stringify({
        pid: 999,
        hostname: "other-host",
        acquired_at: "2026-08-13T11:00:00Z",
        metadata: { fencing_token: 99 },
      })
    );
    mine.release();
    const held = readHolder(lockPath(layout, CHANGE));
    expect(held?.pid).toBe(999);
    expect(held?.metadata.fencing_token).toBe(99);
  });

  it("records its own token in the lock, in the shape harness-core writes", () => {
    const s = open(layout, CHANGE, seed(), { now });
    try {
      const held = readHolder(lockPath(layout, CHANGE));
      expect(held?.metadata).toEqual({ fencing_token: 1 });
    } finally {
      s.release();
    }
  });
});

describe("fencing across sessions", () => {
  // The whole reason the token is persisted: a writer that stalls long enough
  // for its lock to be reclaimed wakes up believing it is still current.
  it("rejects a stalled writer that woke up after being superseded", () => {
    const stalled = open(layout, CHANGE, seed(), {
      self: { pid: 1, hostname: "h" },
      now,
      isAlive: () => true,
    });
    const stalledCtx = stalled.ctx;

    // Its lock is reclaimed as stale and somebody else takes over.
    const taker = open(layout, CHANGE, seed(), {
      self: { pid: 2, hostname: "h" },
      now,
      isAlive: () => false,
    });
    const current = taker.state;
    taker.release();

    expect(stalledCtx.fencingToken).toBeLessThan(current.fencing_token);
    try {
      assertWritable(current, stalledCtx);
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as StateRejected).kind).toBe("fenced");
    }
  });
});

describe("reading", () => {
  it("reports a missing state as absent", () => {
    expect(readState(layout, "nope")).toBeNull();
  });

  // Treating unreadable as absent would start a second flow over a first one
  // nobody can read but which may still be running.
  it("refuses to treat an unreadable state as absent", () => {
    fs.mkdirSync(layout.root, { recursive: true });
    fs.writeFileSync(statePath(layout, CHANGE), "{ not json");
    expect(() => readState(layout, CHANGE)).toThrow(StateRejected);
  });
});

describe("committing", () => {
  it("persists a transition and advances the session's context", () => {
    withSession(layout, CHANGE, seed(), (s) => {
      const before = s.ctx.readRevision;
      s.commit(
        dispatch(s.state, s.ctx, {
          stage: "requirements",
          owner: "o",
          attemptId: "a1",
          requestId: "r1",
          inputRefs: [],
          inputDigests: [],
          now,
        })
      );
      expect(s.ctx.readRevision).toBe(before + 1);
    }, { now });

    // 1, not 2: opening a session bumps the TOKEN, not the revision. They count
    // different things — the revision tracks content, the token tracks lock
    // generations — and merging them would make every reader stale the moment
    // somebody else merely took the lock without changing anything.
    expect(readState(layout, CHANGE)?.state_revision).toBe(1);
  });

  it("keeps the token and the revision as separate counters", () => {
    const first = open(layout, CHANGE, seed(), { now });
    first.release();
    const second = open(layout, CHANGE, seed(), { now });
    try {
      expect(second.state.fencing_token).toBe(2);
      expect(second.state.state_revision).toBe(0);
    } finally {
      second.release();
    }
  });

  it("refuses to commit after release", () => {
    const s = open(layout, CHANGE, seed(), { now });
    s.release();
    expect(() => s.commit(s.state)).toThrow(/already released/);
  });
});

describe("a process killed mid-flow", () => {
  // Not a simulated stop: SIGKILL cannot be caught, so whatever the parent then
  // finds is whatever survived on its own.
  //
  // KNOWN LIMIT, same as harness-install's crash tests: killing a PROCESS does
  // not evict the kernel page cache, so this proves the ORDERING and that
  // recovery reads from disk — not that the fsync calls do their job against a
  // power cut.
  it("leaves a state a later session can resume from", () => {
    const script = `
      const { open } = require(${JSON.stringify(path.join(__dirname, "..", "dist", "store.js"))});
      const { initialState, dispatch } = require(${JSON.stringify(path.join(__dirname, "..", "dist", "state.js"))});
      const layout = { root: ${JSON.stringify(layout.root)} };
      const seed = initialState({ businessProject: "p", unit: "billing-service", changeId: ${JSON.stringify(CHANGE)} });
      const s = open(layout, ${JSON.stringify(CHANGE)}, seed);
      s.commit(dispatch(s.state, s.ctx, {
        stage: "requirements", owner: "o", attemptId: "a1", requestId: "r1",
        inputRefs: [], inputDigests: [],
      }));
      process.kill(process.pid, "SIGKILL");
    `;
    const build = spawnSync("npx", ["tsc", "-p", "tsconfig.json"], {
      cwd: path.join(__dirname, ".."),
      encoding: "utf8",
    });
    if (build.status !== 0) throw new Error(`build failed: ${build.stdout}${build.stderr}`);

    const child = spawnSync(process.execPath, ["-e", script], { encoding: "utf8" });
    if (child.signal !== "SIGKILL") {
      throw new Error(`child did not reach the kill point: ${child.stderr}`);
    }

    const survived = readState(layout, CHANGE)!;
    expect(survived.stages.requirements?.status).toBe("running");

    // The dead process left its lock behind; the next session reclaims it and
    // gets a higher token, so the corpse can never win a race it is not in.
    const resumed = open(layout, CHANGE, seed(), { isAlive: () => false });
    try {
      expect(resumed.ctx.fencingToken).toBeGreaterThan(survived.fencing_token);
      expect(resumed.state.stages.requirements?.attempts[0].attempt_id).toBe("a1");
    } finally {
      resumed.release();
    }
  }, 60000);
});
