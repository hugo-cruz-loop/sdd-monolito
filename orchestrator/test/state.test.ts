import { describe, it, expect } from "vitest";
import {
  StateRejected,
  appendTransition,
  currentStage,
  dispatch,
  initialState,
  recordResult,
  assertWritable,
  type FlowState,
  type WriteContext,
} from "../src/state";

const now = () => "2026-08-13T10:00:00Z";

const seed = (): FlowState =>
  initialState({
    businessProject: "payments-platform",
    unit: "billing-service",
    changeId: "billing-service--add-payment-idempotency",
  });

const ctx = (state: FlowState): WriteContext => ({
  readRevision: state.state_revision,
  fencingToken: state.fencing_token,
});

function dispatched(over: Partial<Parameters<typeof dispatch>[2]> = {}) {
  const s = seed();
  return dispatch(s, ctx(s), {
    stage: "requirements",
    owner: "Requirements Steward",
    attemptId: "a1",
    requestId: "r1",
    inputRefs: ["req/x"],
    inputDigests: ["d1"],
    now,
    ...over,
  });
}

describe("identity", () => {
  // sdd/{change_id}/* namespaces collide across units when change_id is not
  // derivable from the unit.
  it("refuses a change_id that is not unit + '--' + slug", () => {
    expect(() =>
      initialState({
        businessProject: "p",
        unit: "billing-service",
        changeId: "other-service--x",
      })
    ).toThrow(/namespaces would collide/);
  });

  it("accepts a derivable change_id", () => {
    expect(seed().change_id).toBe("billing-service--add-payment-idempotency");
  });
});

describe("compare-and-swap", () => {
  it("accepts a writer holding the revision it read", () => {
    const s = seed();
    expect(() => assertWritable(s, ctx(s))).not.toThrow();
  });

  // Decisions made against a world that no longer exists cannot be applied on
  // top of the world that replaced it.
  it("rejects a writer whose read revision is behind", () => {
    const s = { ...seed(), state_revision: 5 };
    try {
      assertWritable(s, { readRevision: 4, fencingToken: 0 });
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as StateRejected).kind).toBe("stale");
      expect((e as Error).message).toMatch(/no longer exists/);
    }
  });

  // A writer can hold a current revision with a stale token: it slept through
  // somebody else's whole transaction and the revision came back around.
  it("rejects a superseded writer even when its revision matches", () => {
    const s = { ...seed(), fencing_token: 7 };
    try {
      assertWritable(s, { readRevision: 0, fencingToken: 3 });
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as StateRejected).kind).toBe("fenced");
      expect((e as Error).message).toMatch(/superseded/);
    }
  });

  it("checks the token before the revision, so a fenced writer is named as fenced", () => {
    const s = { ...seed(), state_revision: 5, fencing_token: 7 };
    expect(() =>
      assertWritable(s, { readRevision: 1, fencingToken: 3 })
    ).toThrow(/superseded/);
  });
});

describe("dispatching", () => {
  it("records the attempt and bumps the revision", () => {
    const s = dispatched();
    expect(s.state_revision).toBe(1);
    expect(s.stages.requirements?.status).toBe("running");
    expect(s.stages.requirements?.attempts).toHaveLength(1);
    expect(s.stages.requirements?.attempts[0].finished_at).toBeNull();
  });

  it("does not mutate the state it was given", () => {
    const before = seed();
    dispatch(before, ctx(before), {
      stage: "requirements",
      owner: "o",
      attemptId: "a1",
      requestId: "r1",
      inputRefs: [],
      inputDigests: [],
      now,
    });
    expect(before.state_revision).toBe(0);
    expect(before.stages.requirements).toBeUndefined();
  });

  // Two live attempts on one stage produce two results and no way to say which
  // is current.
  it("refuses a second dispatch while one is running", () => {
    const s = dispatched();
    expect(() =>
      dispatch(s, ctx(s), {
        stage: "requirements",
        owner: "o",
        attemptId: "a2",
        requestId: "r2",
        inputRefs: [],
        inputDigests: [],
        now,
      })
    ).toThrow(/two live attempts/);
  });

  it("refuses to reuse an attempt id", () => {
    const s = recordResult(dispatched(), ctx(dispatched()), {
      stage: "requirements",
      attemptId: "a1",
      requestId: "r1",
      status: "blocked",
      inputDigests: ["d1"],
      outputRefs: [],
      outputDigests: [],
      now,
    });
    expect(() =>
      dispatch(s, ctx(s), {
        stage: "requirements",
        owner: "o",
        attemptId: "a1",
        requestId: "r2",
        inputRefs: [],
        inputDigests: ["d1"],
        now,
      })
    ).toThrow(/a retry needs a new attempt_id/);
  });

  it("allows a retry under a new attempt id", () => {
    const first = dispatched();
    const failed = recordResult(first, ctx(first), {
      stage: "requirements",
      attemptId: "a1",
      requestId: "r1",
      status: "blocked",
      inputDigests: ["d1"],
      outputRefs: [],
      outputDigests: [],
      now,
    });
    const retried = dispatch(failed, ctx(failed), {
      stage: "requirements",
      owner: "o",
      attemptId: "a2",
      requestId: "r2",
      inputRefs: [],
      inputDigests: ["d1"],
      now,
    });
    expect(retried.stages.requirements?.attempts).toHaveLength(2);
  });
});

describe("recording a result", () => {
  const finish = (state: FlowState, over: Record<string, unknown> = {}) =>
    recordResult(state, ctx(state), {
      stage: "requirements",
      attemptId: "a1",
      requestId: "r1",
      status: "complete",
      inputDigests: ["d1"],
      outputRefs: ["req/out"],
      outputDigests: ["o1"],
      now,
      ...(over as object),
    } as Parameters<typeof recordResult>[2]);

  it("closes the attempt and sets the stage status", () => {
    const s = finish(dispatched());
    expect(s.stages.requirements?.status).toBe("complete");
    expect(s.stages.requirements?.attempts[0].finished_at).toBe(now());
    expect(s.stages.requirements?.attempts[0].output_digests).toEqual(["o1"]);
  });

  it("refuses a result for a stage nobody dispatched", () => {
    const s = seed();
    expect(() =>
      recordResult(s, ctx(s), {
        stage: "ddl",
        attemptId: "a1",
        requestId: "r1",
        status: "complete",
        inputDigests: [],
        outputRefs: [],
        outputDigests: [],
        now,
      })
    ).toThrow(/never dispatched/);
  });

  it("refuses a result for an attempt nobody dispatched", () => {
    expect(() => finish(dispatched(), { attemptId: "ghost" })).toThrow(
      /not among the attempts dispatched/
    );
  });

  // The second report is not new information, and appending it would record a
  // transition that never happened.
  it("refuses a second report for the same attempt", () => {
    const done = finish(dispatched());
    expect(() => finish(done)).toThrow(/already finished/);
  });

  it("refuses a result whose request id is not the dispatched one", () => {
    expect(() => finish(dispatched(), { requestId: "r9" })).toThrow(
      /was dispatched as request r1/
    );
  });

  // A specialist that answers about different inputs answered a different
  // question.
  it("refuses a result whose input digests differ from the dispatched ones", () => {
    expect(() => finish(dispatched(), { inputDigests: ["d9"] })).toThrow(
      /answers a different question/
    );
  });

  it("accepts the same digests in a different order", () => {
    const s = dispatch(seed(), ctx(seed()), {
      stage: "requirements",
      owner: "o",
      attemptId: "a1",
      requestId: "r1",
      inputRefs: [],
      inputDigests: ["d1", "d2"],
      now,
    });
    expect(() =>
      recordResult(s, ctx(s), {
        stage: "requirements",
        attemptId: "a1",
        requestId: "r1",
        status: "complete",
        inputDigests: ["d2", "d1"],
        outputRefs: [],
        outputDigests: [],
        now,
      })
    ).not.toThrow();
  });

  it("refuses a result reporting a subset of the dispatched digests", () => {
    const s = dispatch(seed(), ctx(seed()), {
      stage: "requirements",
      owner: "o",
      attemptId: "a1",
      requestId: "r1",
      inputRefs: [],
      inputDigests: ["d1", "d2"],
      now,
    });
    expect(() =>
      recordResult(s, ctx(s), {
        stage: "requirements",
        attemptId: "a1",
        requestId: "r1",
        status: "complete",
        inputDigests: ["d1"],
        outputRefs: [],
        outputDigests: [],
        now,
      })
    ).toThrow(/answers a different question/);
  });
});

describe("transitions", () => {
  const completed = () => {
    const d = dispatched();
    return recordResult(d, ctx(d), {
      stage: "requirements",
      attemptId: "a1",
      requestId: "r1",
      status: "complete",
      inputDigests: ["d1"],
      outputRefs: [],
      outputDigests: [],
      now,
    });
  };

  it("appends a transition out of a complete stage", () => {
    const s = completed();
    const next = appendTransition(s, ctx(s), {
      from: "requirements",
      to: "sdd-planning",
      result_digest: "r".repeat(64),
      at: now(),
    });
    expect(next.transitions).toHaveLength(1);
    expect(next.state_revision).toBe(s.state_revision + 1);
  });

  // blocked, partial and needs_decision are terminals of the current attempt.
  it.each(["blocked", "partial", "needs_decision"] as const)(
    "refuses to transition out of a %s stage",
    (status) => {
      const d = dispatched();
      const s = recordResult(d, ctx(d), {
        stage: "requirements",
        attemptId: "a1",
        requestId: "r1",
        status,
        inputDigests: ["d1"],
        outputRefs: [],
        outputDigests: [],
        now,
      });
      expect(() =>
        appendTransition(s, ctx(s), {
          from: "requirements",
          to: "sdd-planning",
          result_digest: "r".repeat(64),
          at: now(),
        })
      ).toThrow(/do not advance the DAG/);
    }
  );

  it("refuses to transition out of a stage nobody dispatched", () => {
    const s = seed();
    expect(() =>
      appendTransition(s, ctx(s), {
        from: "ddl",
        to: "implementation",
        result_digest: "r".repeat(64),
        at: now(),
      })
    ).toThrow(/never dispatched/);
  });

  // Rewriting a transition is how a past run is made to agree with a present
  // belief.
  it("keeps history append-only across several transitions", () => {
    const s = completed();
    const one = appendTransition(s, ctx(s), {
      from: "requirements",
      to: "sdd-planning",
      result_digest: "a".repeat(64),
      at: now(),
    });
    expect(one.transitions[0].result_digest).toBe("a".repeat(64));
    expect(s.transitions).toHaveLength(0);
  });
});

describe("resuming", () => {
  it("names the stage left running", () => {
    expect(currentStage(dispatched())).toBe("requirements");
  });

  it("reports nothing pending when every stage finished", () => {
    const d = dispatched();
    const done = recordResult(d, ctx(d), {
      stage: "requirements",
      attemptId: "a1",
      requestId: "r1",
      status: "complete",
      inputDigests: ["d1"],
      outputRefs: [],
      outputDigests: [],
      now,
    });
    expect(currentStage(done)).toBeNull();
  });

  it("reports nothing pending on a fresh state", () => {
    expect(currentStage(seed())).toBeNull();
  });
});
