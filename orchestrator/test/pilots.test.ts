import { describe, it, expect } from "vitest";
import { nextAction, ownerOf } from "../src/dag";
import {
  breakingChangeGate,
  contradictionGate,
  invalidatedBy,
  verifyApproval,
  type Approval,
  type Contradiction,
} from "../src/gates";
import {
  StateRejected,
  appendTransition,
  dispatch,
  initialState,
  recordResult,
  type FlowState,
  type StageStatus,
} from "../src/state";
import type { FlowMode, Stage } from "../src/contracts";

// The five pilots of Phase 5, as executable scenarios.
//
// WHAT THESE PROVE, and it is narrower than the plan's pilots:
//
// They drive the real state machine, the real DAG and the real gates through
// each scenario's shape. They prove the orchestrator refuses to advance without
// the conditions the plan names — a blocked stage stops the flow, a retry needs
// a new attempt, an open contradiction blocks promotion, a mode is offered only
// the branches it can take.
//
// WHAT THEY DO NOT PROVE:
//
// Nothing about the specialists' judgement. Every stage result here is a
// fixture: no Requirements Steward read a document, no parser looked at DDL, no
// test suite went red then green. A pilot that passes here does not say the
// system documents a service well — it says the orchestrator will not let a
// flow advance while the conditions are unmet.
//
// The plan's pilots need live Buzz agents and a real project. These are the
// regression suite underneath them, not a substitute for them.

const CHANGE = "billing-service--add-payment-idempotency";
const at = (h: number) => `2026-08-13T${String(h).padStart(2, "0")}:00:00Z`;
const digest = (seed: string) => seed.repeat(64).slice(0, 64);

function seed(): FlowState {
  return initialState({
    businessProject: "payments-platform",
    unit: "billing-service",
    changeId: CHANGE,
  });
}

const ctx = (s: FlowState) => ({
  readRevision: s.state_revision,
  fencingToken: s.fencing_token,
});

interface RunOptions {
  status?: Exclude<StageStatus, "pending" | "running">;
  attempt?: string;
  finishedAt?: string;
  inputDigests?: string[];
  outputRefs?: string[];
  outputDigests?: string[];
}

/** Dispatch a stage and record its result, as the CLI would across two calls. */
function runStage(state: FlowState, stage: Stage, options: RunOptions = {}): FlowState {
  const attemptId = options.attempt ?? `${stage}-1`;
  const requestId = `${attemptId}-req`;
  const inputDigests = options.inputDigests ?? [];

  const dispatched = dispatch(state, ctx(state), {
    stage,
    owner: ownerOf(stage),
    attemptId,
    requestId,
    inputRefs: [],
    inputDigests,
    now: () => at(9),
  });

  return recordResult(dispatched, ctx(dispatched), {
    stage,
    attemptId,
    requestId,
    status: options.status ?? "complete",
    inputDigests,
    outputRefs: options.outputRefs ?? [],
    outputDigests: options.outputDigests ?? [],
    now: () => options.finishedAt ?? at(10),
  });
}

/** Follow the DAG's advice until it stops offering a single next stage. */
function advance(state: FlowState, mode: FlowMode, hour = 10): FlowState {
  let current = state;
  let clock = hour;
  for (let guard = 0; guard < 12; guard += 1) {
    const advice = nextAction(current, mode);
    if (advice.action !== "dispatch") return current;
    clock += 1;
    current = runStage(current, advice.stage, { finishedAt: at(clock) });
  }
  throw new Error("the flow did not settle — the DAG is looping");
}

// ---------------------------------------------------------------------------

describe("Pilot 1 — documentation to requirement, no DB change", () => {
  it("runs baseline then requirements and stops at its own terminal", () => {
    let state = seed();
    expect(nextAction(state, "requirements")).toMatchObject({
      action: "dispatch",
      stage: "code-knowledge-baseline",
    });

    state = advance(state, "requirements");

    expect(nextAction(state, "requirements")).toEqual({
      action: "done",
      stage: "requirements",
    });
    expect(Object.keys(state.stages).sort()).toEqual([
      "code-knowledge-baseline",
      "requirements",
    ]);
  });

  // The mode never touches ddl, so a flow that reached it was not this mode's.
  it("never offers a schema stage", () => {
    const state = advance(seed(), "requirements");
    expect(state.stages.ddl).toBeUndefined();
    expect(state.stages["sdd-planning"]).toBeUndefined();
  });

  it("promotes only with an approval that covers exactly what is presented", () => {
    const revision = {
      repository_ref: "git@example.invalid:payments.git",
      commit: "a".repeat(40),
      tree: "b".repeat(40),
    };
    const artifacts = [
      { type: "Requirement/v1", ref: "req/x/requirement", digest: digest("1") },
      { type: "Acceptance/v1", ref: "req/x/acceptance", digest: digest("2") },
    ];
    const approval: Approval = {
      type: "Approval/v1",
      status: "approved",
      actor_id: "hugo",
      actor_display_name: "Hugo",
      approved_at: at(11),
      scope: "requirement-and-acceptance",
      source_revision: revision,
      approved_artifacts: artifacts,
      revoked_at: null,
      revocation_reason: null,
    };

    expect(verifyApproval(approval, { artifacts, sourceRevision: revision }).ok).toBe(true);

    // The requirement was edited after the human said yes.
    const edited = artifacts.map((a) =>
      a.type === "Requirement/v1" ? { ...a, digest: digest("9") } : a
    );
    expect(verifyApproval(approval, { artifacts: edited, sourceRevision: revision }).ok).toBe(
      false
    );
  });
});

describe("Pilot 2 — code to documentation, with a contradiction", () => {
  const contradiction = (over: Partial<Contradiction> = {}): Contradiction => ({
    id: "c1",
    kind: "doc-vs-code",
    authority: "CODE_WINS",
    status: "resolved",
    resolved_by: "hugo",
    ...over,
  });

  it("completes when the reconciliation settled the contradiction", () => {
    const state = advance(seed(), "code-docs");
    expect(nextAction(state, "code-docs")).toEqual({
      action: "done",
      stage: "code-knowledge-baseline",
    });
    expect(contradictionGate([contradiction()]).ok).toBe(true);
  });

  // A document that disagrees about what happens TODAY is stale, and CODE_WINS
  // decides it. One that disagrees about what SHOULD happen is the change being
  // asked for, and no rule decides that.
  it("blocks promotion while a contradiction is unresolved", () => {
    const verdict = contradictionGate([
      contradiction({ id: "c2", kind: "doc-vs-doc", authority: "UNRESOLVED", status: "open" }),
    ]);
    expect(verdict.ok).toBe(false);
    expect(verdict.problems[0]).toContain("a person has to");
  });

  it("blocks a contradiction closed by nobody, even under CODE_WINS", () => {
    expect(
      contradictionGate([contradiction({ status: "open", resolved_by: null })]).ok
    ).toBe(false);
  });
});

describe("Pilot 3 — PostgreSQL change with shared consumers", () => {
  it("walks ddl through apply and reconcile to its own terminal", () => {
    let state = seed();
    expect(nextAction(state, "ddl")).toMatchObject({ action: "dispatch", stage: "ddl" });

    state = runStage(state, "ddl", { finishedAt: at(11) });
    state = runStage(state, "implementation", { finishedAt: at(12) });
    state = runStage(state, "code-knowledge-refresh", { finishedAt: at(13) });

    // The catalog branches here, but this mode never archives a delivery.
    expect(nextAction(state, "ddl")).toMatchObject({
      action: "dispatch",
      stage: "ready-for-apply",
    });

    state = runStage(state, "ready-for-apply", { finishedAt: at(14) });
    state = runStage(state, "external-apply", { finishedAt: at(15) });
    state = runStage(state, "post-apply-reconcile", { finishedAt: at(16) });
    state = runStage(state, "archive-post-apply", { finishedAt: at(17) });

    expect(nextAction(state, "ddl")).toEqual({
      action: "done",
      stage: "archive-post-apply",
    });
  });

  // Shared consumers are what makes a contract phase breaking, and breaking
  // means something that works today stops working.
  it("requires a human decision before a breaking schema change", () => {
    const impact = { classification: "breaking" as const, digest: digest("7") };
    expect(breakingChangeGate(impact, null).ok).toBe(false);

    expect(
      breakingChangeGate(impact, {
        actor_id: "hugo",
        decided_at: at(11),
        impact_digest: digest("7"),
        accepted: true,
        rationale: "the two consumers are internal and migrate in the same release",
      }).ok
    ).toBe(true);
  });

  // The expand phase is additive; only contract removes something.
  it("does not ask about the expand phase", () => {
    expect(
      breakingChangeGate({ classification: "additive", digest: digest("3") }, null).ok
    ).toBe(true);
  });
});

describe("Pilot 4 — multi-PR implementation", () => {
  it("chooses between ddl and implementation rather than guessing", () => {
    const state = runStage(seed(), "sdd-planning", { finishedAt: at(11) });
    const advice = nextAction(state, "implementation");
    expect(advice.action).toBe("choose");
    if (advice.action === "choose") {
      expect(advice.options.map((o) => o.to).sort()).toEqual(["ddl", "implementation"]);
    }
  });

  it("reaches archive-delivery when no schema change is involved", () => {
    let state = runStage(seed(), "sdd-planning", { finishedAt: at(11) });
    state = runStage(state, "implementation", { finishedAt: at(12) });
    state = runStage(state, "code-knowledge-refresh", { finishedAt: at(13) });
    state = runStage(state, "archive-delivery", { finishedAt: at(14) });

    expect(nextAction(state, "implementation")).toEqual({
      action: "done",
      stage: "archive-delivery",
    });
  });

  // The specialist enforces protected features and observed RED; the
  // orchestrator's part is refusing to walk past the refusal.
  it("halts when implementation refuses, and does not retry on its own", () => {
    let state = runStage(seed(), "sdd-planning", { finishedAt: at(11) });
    state = runStage(state, "implementation", { status: "blocked", finishedAt: at(12) });

    const advice = nextAction(state, "implementation");
    expect(advice.action).toBe("halt");
    if (advice.action === "halt") {
      expect(advice.stage).toBe("implementation");
      expect(advice.reason).toContain("somebody has to authorise");
    }
  });

  // Each work unit is its own attempt. Reusing the id would make two PRs
  // indistinguishable in the history.
  it("records one attempt per work unit", () => {
    let state = runStage(seed(), "sdd-planning", { finishedAt: at(11) });
    state = runStage(state, "implementation", {
      attempt: "pr-1",
      status: "partial",
      finishedAt: at(12),
    });
    state = runStage(state, "implementation", {
      attempt: "pr-2",
      status: "complete",
      finishedAt: at(13),
    });

    expect(state.stages.implementation?.attempts.map((a) => a.attempt_id)).toEqual([
      "pr-1",
      "pr-2",
    ]);
  });
});

describe("Pilot 5 — a full flow resumed after a blocked gate", () => {
  function blockedAtRequirements(): FlowState {
    let state = runStage(seed(), "readiness", { finishedAt: at(10) });
    state = runStage(state, "code-knowledge-baseline", { finishedAt: at(11) });
    return runStage(state, "requirements", {
      attempt: "req-1",
      status: "blocked",
      finishedAt: at(12),
      inputDigests: [digest("1")],
    });
  }

  it("stops the flow and names what stopped it", () => {
    const advice = nextAction(blockedAtRequirements(), "full");
    expect(advice.action).toBe("halt");
    if (advice.action === "halt") expect(advice.stage).toBe("requirements");
  });

  // Retrying is a new attempt, not a re-report of the old one.
  it("refuses to re-answer the attempt that was blocked", () => {
    const state = blockedAtRequirements();
    expect(() =>
      recordResult(state, ctx(state), {
        stage: "requirements",
        attemptId: "req-1",
        requestId: "req-1-req",
        status: "complete",
        inputDigests: [digest("1")],
        outputRefs: [],
        outputDigests: [],
      })
    ).toThrow(/already finished/);
  });

  it("resumes under a new attempt and carries on", () => {
    let state = blockedAtRequirements();
    state = runStage(state, "requirements", {
      attempt: "req-2",
      status: "complete",
      finishedAt: at(13),
      inputDigests: [digest("1")],
    });

    expect(state.stages.requirements?.attempts).toHaveLength(2);
    expect(nextAction(state, "full")).toMatchObject({
      action: "dispatch",
      stage: "sdd-planning",
    });
  });

  // The specialist answering a question nobody asked is not a smaller answer:
  // it is an answer about different work.
  it("refuses a resumed result whose inputs are not the ones dispatched", () => {
    let state = blockedAtRequirements();
    const dispatched = dispatch(state, ctx(state), {
      stage: "requirements",
      owner: ownerOf("requirements"),
      attemptId: "req-2",
      requestId: "req-2-req",
      inputRefs: [],
      inputDigests: [digest("1")],
      now: () => at(13),
    });

    try {
      recordResult(dispatched, ctx(dispatched), {
        stage: "requirements",
        attemptId: "req-2",
        requestId: "req-2-req",
        status: "complete",
        inputDigests: [digest("9")],
        outputRefs: [],
        outputDigests: [],
      });
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as StateRejected).kind).toBe("divergent");
    }
  });

  // A resumed flow is still one flow: the history keeps both attempts, so the
  // block is not erased by the run that succeeded after it.
  it("keeps the blocked attempt in the history", () => {
    let state = blockedAtRequirements();
    state = runStage(state, "requirements", {
      attempt: "req-2",
      status: "complete",
      finishedAt: at(13),
      inputDigests: [digest("1")],
    });

    const attempts = state.stages.requirements!.attempts;
    expect(attempts[0].attempt_id).toBe("req-1");
    expect(attempts[0].finished_at).toBe(at(12));
  });

  it("invalidates what was built on a requirement that lost its approval", () => {
    let state = blockedAtRequirements();
    state = runStage(state, "requirements", {
      attempt: "req-2",
      status: "complete",
      finishedAt: at(13),
      inputDigests: [digest("1")],
    });
    state = appendTransition(state, ctx(state), {
      from: "requirements",
      to: "sdd-planning",
      result_digest: digest("4"),
      at: at(13),
    });
    state = runStage(state, "sdd-planning", { finishedAt: at(14) });
    state = runStage(state, "implementation", { finishedAt: at(15) });

    const invalid = invalidatedBy(state, "requirements", "had its approval revoked");
    expect(invalid.map((i) => i.stage).sort()).toEqual(["implementation", "sdd-planning"]);
    expect(invalid.every((i) => i.reason.includes("revoked"))).toBe(true);
  });
});

describe("what these pilots do not establish", () => {
  // Stated as a test so it is read, not as a comment somebody scrolls past.
  it("uses fixture results, not specialist work", () => {
    const state = advance(seed(), "requirements");
    for (const stage of Object.values(state.stages)) {
      for (const attempt of stage.attempts) {
        // Every output here was supplied by this file. No document was read, no
        // graph was built, no test suite went red then green.
        expect(attempt.output_refs).toEqual([]);
      }
    }
  });
});
