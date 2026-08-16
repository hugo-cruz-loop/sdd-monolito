import { describe, it, expect } from "vitest";
import {
  breakingChangeGate,
  contradictionGate,
  descendantsOf,
  invalidatedBy,
  verifyApproval,
  type Approval,
  type ArtifactRef,
  type BreakingDecision,
  type Contradiction,
} from "../src/gates";
import { dispatch, initialState, recordResult, type FlowState } from "../src/state";
import { ownerOf } from "../src/dag";
import type { Stage } from "../src/contracts";

const now = () => "2026-08-13T10:00:00Z";
const d = (n: string) => n.repeat(64).slice(0, 64);

const revision = {
  repository_ref: "git@example.invalid:payments.git",
  commit: "a".repeat(40),
  tree: "b".repeat(40),
};

const artifacts = (): ArtifactRef[] => [
  { type: "Requirement/v1", ref: "req/x/requirement", digest: d("1") },
  { type: "Acceptance/v1", ref: "req/x/acceptance", digest: d("2") },
];

const approval = (over: Partial<Approval> = {}): Approval => ({
  type: "Approval/v1",
  status: "approved",
  actor_id: "hugo",
  actor_display_name: "Hugo",
  approved_at: now(),
  scope: "requirement-and-acceptance",
  source_revision: revision,
  approved_artifacts: artifacts(),
  revoked_at: null,
  revocation_reason: null,
  ...over,
});

describe("an approval authenticates bytes, not names", () => {
  it("accepts exactly what it approved", () => {
    expect(
      verifyApproval(approval(), { artifacts: artifacts(), sourceRevision: revision })
    ).toEqual({ ok: true, problems: [] });
  });

  // Comparing refs alone would let an edited artifact pass under an approved
  // name, which is the exact move an approval exists to prevent.
  it("rejects an artifact edited after the decision", () => {
    const presented = artifacts();
    presented[0].digest = d("9");
    const verdict = verifyApproval(approval(), {
      artifacts: presented,
      sourceRevision: revision,
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.problems.join(" ")).toContain("not this path");
  });

  it("rejects an artifact that entered the package after the decision", () => {
    const presented = [
      ...artifacts(),
      { type: "Design/v1", ref: "sdd/x/design", digest: d("3") },
    ];
    const verdict = verifyApproval(approval(), {
      artifacts: presented,
      sourceRevision: revision,
    });
    expect(verdict.problems.join(" ")).toContain("after the decision");
  });

  // A smaller package is not a safer one: the missing piece may be the reason
  // they said yes.
  it("rejects a package missing something the approver was shown", () => {
    const verdict = verifyApproval(approval(), {
      artifacts: [artifacts()[0]],
      sourceRevision: revision,
    });
    expect(verdict.problems.join(" ")).toContain("missing a piece of");
  });

  it("rejects when the sources moved under the decision", () => {
    const verdict = verifyApproval(approval(), {
      artifacts: artifacts(),
      sourceRevision: { ...revision, commit: "c".repeat(40) },
    });
    expect(verdict.problems.join(" ")).toContain("moved under the decision");
  });

  it("notices a changed tree even when the commit matches", () => {
    const verdict = verifyApproval(approval(), {
      artifacts: artifacts(),
      sourceRevision: { ...revision, tree: "f".repeat(40) },
    });
    expect(verdict.ok).toBe(false);
  });

  it("rejects an approval nobody can be asked about", () => {
    const verdict = verifyApproval(approval({ actor_id: "  " }), {
      artifacts: artifacts(),
      sourceRevision: revision,
    });
    expect(verdict.problems.join(" ")).toContain("a decision nobody made");
  });

  // Once withdrawn, whether the digests still match is not a question anybody
  // needs answered.
  it("stops at revocation instead of listing further problems", () => {
    const verdict = verifyApproval(
      approval({
        status: "revoked",
        revoked_at: "2026-08-14T10:00:00Z",
        revocation_reason: "requirement superseded",
      }),
      { artifacts: [], sourceRevision: { ...revision, commit: "9".repeat(40) } }
    );
    expect(verdict.problems).toHaveLength(1);
    expect(verdict.problems[0]).toContain("withdrawn one");
    expect(verdict.problems[0]).toContain("requirement superseded");
  });
});

describe("contradictions", () => {
  const c = (over: Partial<Contradiction> = {}): Contradiction => ({
    id: "c1",
    kind: "doc-vs-code",
    authority: "CODE_WINS",
    status: "resolved",
    resolved_by: "hugo",
    ...over,
  });

  it("passes when nothing is open", () => {
    expect(contradictionGate([c(), c({ id: "c2" })])).toEqual({ ok: true, problems: [] });
  });

  it("passes on an empty list", () => {
    expect(contradictionGate([]).ok).toBe(true);
  });

  // The authority rule does not decide it, so a person has to.
  it("blocks on an open unresolved contradiction", () => {
    const verdict = contradictionGate([c({ authority: "UNRESOLVED", status: "open" })]);
    expect(verdict.ok).toBe(false);
    expect(verdict.problems[0]).toContain("a person has to");
  });

  // A rule that decides is not the same as a decision taken.
  it("blocks on an open contradiction nobody closed, even under CODE_WINS", () => {
    const verdict = contradictionGate([
      c({ status: "open", resolved_by: null }),
    ]);
    expect(verdict.problems[0]).toContain("not the same as a decision taken");
  });

  it("reports every open contradiction, not just the first", () => {
    const verdict = contradictionGate([
      c({ id: "c1", authority: "UNRESOLVED", status: "open" }),
      c({ id: "c2", status: "open", resolved_by: null }),
    ]);
    expect(verdict.problems).toHaveLength(2);
  });
});

describe("breaking changes", () => {
  const decision = (over: Partial<BreakingDecision> = {}): BreakingDecision => ({
    actor_id: "hugo",
    decided_at: now(),
    impact_digest: d("7"),
    accepted: true,
    rationale: "consumers are internal and will be migrated in the same release",
    ...over,
  });

  it("does not ask about an additive impact", () => {
    expect(
      breakingChangeGate({ classification: "additive", digest: d("7") }, null).ok
    ).toBe(true);
  });

  it("does not ask about a behavior-changing impact either", () => {
    expect(
      breakingChangeGate({ classification: "behavior-changing", digest: d("7") }, null).ok
    ).toBe(true);
  });

  // Breaking means something that works today stops working.
  it("blocks a breaking impact with no decision", () => {
    const verdict = breakingChangeGate({ classification: "breaking", digest: d("7") }, null);
    expect(verdict.problems[0]).toContain("nobody has agreed to that");
  });

  it("accepts a decision taken on this exact impact", () => {
    expect(
      breakingChangeGate({ classification: "breaking", digest: d("7") }, decision()).ok
    ).toBe(true);
  });

  // An impact can be re-analysed and grow; consent does not transfer to what
  // nobody read.
  it("blocks when the impact changed after the decision", () => {
    const verdict = breakingChangeGate(
      { classification: "breaking", digest: d("8") },
      decision()
    );
    expect(verdict.problems[0]).toContain("does not transfer to what nobody read");
  });

  it("blocks when the human said no, and says who and why", () => {
    const verdict = breakingChangeGate(
      { classification: "breaking", digest: d("7") },
      decision({ accepted: false, rationale: "external consumers" })
    );
    expect(verdict.problems[0]).toContain("hugo");
    expect(verdict.problems[0]).toContain("external consumers");
  });

  it("blocks an unattributable acceptance", () => {
    const verdict = breakingChangeGate(
      { classification: "breaking", digest: d("7") },
      decision({ actor_id: "" })
    );
    expect(verdict.problems[0]).toContain("unattributable");
  });
});

describe("cascading invalidation", () => {
  const ctx = (s: FlowState) => ({
    readRevision: s.state_revision,
    fencingToken: s.fencing_token,
  });

  function run(state: FlowState, stage: Stage): FlowState {
    const id = `${stage}-1`;
    const dispatched = dispatch(state, ctx(state), {
      stage,
      owner: ownerOf(stage),
      attemptId: id,
      requestId: `${id}-req`,
      inputRefs: [],
      inputDigests: [],
      now,
    });
    return recordResult(dispatched, ctx(dispatched), {
      stage,
      attemptId: id,
      requestId: `${id}-req`,
      status: "complete",
      inputDigests: [],
      outputRefs: [],
      outputDigests: [],
      now,
    });
  }

  // Computed from the catalog rather than listed, so a change to the graph
  // cannot leave an invalidation rule describing the old shape.
  it("reaches everything downstream, through both branches", () => {
    const from = descendantsOf("sdd-planning");
    expect(from).toContain("ddl");
    expect(from).toContain("implementation");
    expect(from).toContain("archive-delivery");
    expect(from).toContain("archive-post-apply");
  });

  it("does not include the stage itself", () => {
    expect(descendantsOf("sdd-planning")).not.toContain("sdd-planning");
  });

  it("reports nothing downstream of a terminal", () => {
    expect(descendantsOf("archive-delivery")).toEqual([]);
  });

  it("lists only the downstream stages that actually ran", () => {
    let s = initialState({
      businessProject: "p",
      unit: "billing-service",
      changeId: "billing-service--x",
    });
    s = run(s, "requirements");
    s = run(s, "sdd-planning");
    s = run(s, "implementation");

    const invalid = invalidatedBy(s, "requirements", "lost its approval");
    expect(invalid.map((i) => i.stage).sort()).toEqual([
      "implementation",
      "sdd-planning",
    ]);
    expect(invalid[0].previousStatus).toBe("complete");
    expect(invalid[0].reason).toContain("lost its approval");
  });

  it("reports nothing when nothing downstream ran", () => {
    let s = initialState({
      businessProject: "p",
      unit: "billing-service",
      changeId: "billing-service--x",
    });
    s = run(s, "requirements");
    expect(invalidatedBy(s, "requirements", "was revoked")).toEqual([]);
  });

  // Throwing away completed work is a decision; the caller has to see the list
  // before it happens.
  it("reports rather than mutating", () => {
    let s = initialState({
      businessProject: "p",
      unit: "billing-service",
      changeId: "billing-service--x",
    });
    s = run(s, "requirements");
    s = run(s, "sdd-planning");
    const before = JSON.stringify(s);
    invalidatedBy(s, "requirements", "was revoked");
    expect(JSON.stringify(s)).toBe(before);
  });
});
