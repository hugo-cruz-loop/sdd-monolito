import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  CONTRACTS_ROOT,
  checkProvenance,
  loadCatalog,
  modeSpec,
  nextAction,
  ownerOf,
  successorsOf,
} from "../src/dag";
import { dispatch, initialState, recordResult, type FlowState } from "../src/state";
import type { FlowMode, Stage } from "../src/contracts";

const now = () => "2026-08-13T10:00:00Z";

const seed = (): FlowState =>
  initialState({
    businessProject: "payments-platform",
    unit: "billing-service",
    changeId: "billing-service--add-payment-idempotency",
  });

const ctx = (s: FlowState) => ({
  readRevision: s.state_revision,
  fencingToken: s.fencing_token,
});

/** Drive a stage from dispatched to a finished status. */
function run(
  state: FlowState,
  stage: Stage,
  status: "complete" | "blocked" | "partial" | "needs_decision" = "complete",
  at = now()
): FlowState {
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
    status,
    inputDigests: [],
    outputRefs: [],
    outputDigests: [],
    now: () => at,
  });
}

describe("the vendored catalog", () => {
  it("still matches what the owner sealed", () => {
    const report = checkProvenance();
    expect(report.problems).toEqual([]);
    expect(report.ok).toBe(true);
  });

  // Repairing it here would make this repository the author of a rule it only
  // consumes.
  it("reports a locally edited copy as drift", () => {
    const file = path.join(CONTRACTS_ROOT, "v1", "catalog.json");
    const original = fs.readFileSync(file);
    fs.writeFileSync(file, original.toString().replace('"catalog_version"', '"edited"'));
    try {
      const report = checkProvenance();
      expect(report.ok).toBe(false);
      expect(report.problems.join(" ")).toContain("do not edit it here");
    } finally {
      fs.writeFileSync(file, original);
    }
  });

  it("declares the twelve stages the plan names", () => {
    expect(loadCatalog().stages).toHaveLength(12);
    expect(ownerOf("requirements")).toBe("Requirements Steward");
  });

  it("refuses to name an owner for a stage the catalog does not have", () => {
    expect(() => ownerOf("nonsense" as Stage)).toThrow(/unknown stage/);
  });
});

describe("successors", () => {
  it("reads them from the catalog, not from a second copy", () => {
    expect(successorsOf("code-knowledge-baseline").map((t) => t.to)).toEqual([
      "requirements",
    ]);
  });

  it("reports both branches where the catalog branches", () => {
    expect(successorsOf("sdd-planning").map((t) => t.to).sort()).toEqual([
      "ddl",
      "implementation",
    ]);
  });

  it("reports none for a terminal stage", () => {
    expect(successorsOf("archive-delivery")).toEqual([]);
  });
});

describe("modes are entries, not fragments of full", () => {
  // "Cada modo tiene su propia entrada tipada; no se simula como un fragmento
  // implícito de full." A mode that were "full, but stop early" could not say
  // which stop was intended and which was a flow that ran out.
  it("gives each mode its own entry", () => {
    expect(modeSpec("full").entry).toBe("readiness");
    expect(modeSpec("requirements").entry).toBe("code-knowledge-baseline");
    expect(modeSpec("ddl").entry).toBe("ddl");
    expect(modeSpec("implementation").entry).toBe("sdd-planning");
  });

  it("gives each mode its own terminals", () => {
    expect(modeSpec("requirements").terminals).toEqual(["requirements"]);
    expect(modeSpec("implementation").terminals).toContain("archive-delivery");
    expect(modeSpec("full").terminals).toHaveLength(3);
  });

  it("keeps every allowed stage inside the catalog", () => {
    const known = new Set(loadCatalog().stages.map((s) => s.id));
    for (const mode of ["full", "requirements", "code-docs", "ddl", "implementation"] as FlowMode[]) {
      for (const stage of modeSpec(mode).allowed) {
        expect(known.has(stage)).toBe(true);
      }
    }
  });

  it("keeps every terminal inside its own allowed set", () => {
    for (const mode of ["full", "requirements", "code-docs", "ddl", "implementation"] as FlowMode[]) {
      const spec = modeSpec(mode);
      for (const terminal of spec.terminals) {
        expect(spec.allowed).toContain(terminal);
      }
    }
  });
});

describe("what to do next", () => {
  it("dispatches the mode's entry on a fresh flow", () => {
    expect(nextAction(seed(), "full")).toEqual({
      action: "dispatch",
      stage: "readiness",
      owner: ownerOf("readiness"),
    });
  });

  it("dispatches a different entry for a different mode", () => {
    // Narrowed rather than reached into: `Advice` is a union, and `choose` has
    // no `stage`. Reaching in works at runtime and hides which shape came back.
    const advice = nextAction(seed(), "ddl");
    expect(advice.action).toBe("dispatch");
    if (advice.action === "dispatch") expect(advice.stage).toBe("ddl");
  });

  it("resumes a stage left running rather than dispatching past it", () => {
    const s = dispatch(seed(), ctx(seed()), {
      stage: "readiness",
      owner: "o",
      attemptId: "a1",
      requestId: "r1",
      inputRefs: [],
      inputDigests: [],
      now,
    });
    expect(nextAction(s, "full")).toEqual({
      action: "resume",
      stage: "readiness",
      owner: ownerOf("readiness"),
    });
  });

  it("advances along the only successor the catalog allows", () => {
    const s = run(seed(), "readiness");
    expect(nextAction(s, "full")).toEqual({
      action: "dispatch",
      stage: "code-knowledge-baseline",
      owner: ownerOf("code-knowledge-baseline"),
    });
  });

  it("reports the flow done at a terminal of its mode", () => {
    let s = run(seed(), "code-knowledge-baseline", "complete", "2026-08-13T10:00:00Z");
    s = run(s, "requirements", "complete", "2026-08-13T11:00:00Z");
    expect(nextAction(s, "requirements")).toEqual({
      action: "done",
      stage: "requirements",
    });
  });

  // The condition that picks the branch lives in the artifacts, not the graph.
  it("asks rather than guessing where the catalog branches", () => {
    const s = run(seed(), "sdd-planning");
    const advice = nextAction(s, "implementation");
    expect(advice.action).toBe("choose");
    if (advice.action === "choose") {
      expect(advice.options.map((o) => o.to).sort()).toEqual(["ddl", "implementation"]);
      expect(advice.options.every((o) => o.condition.length > 0)).toBe(true);
    }
  });

  it("offers only the branches its mode allows", () => {
    const s = run(seed(), "code-knowledge-refresh");
    const advice = nextAction(s, "implementation");
    // `implementation` may end at archive-delivery or ready-for-apply; both are
    // successors of refresh, so it must still ask.
    expect(advice.action).toBe("choose");
  });

  // The catalog branches from refresh to ready-for-apply and archive-delivery,
  // but mode `ddl` never archives a delivery — it hands off to an external
  // apply. With only one branch in scope there is nothing to ask about, and
  // asking anyway would make the operator choose between a real option and one
  // their mode cannot take.
  it("does not ask when the mode leaves only one branch in scope", () => {
    const s = run(seed(), "code-knowledge-refresh");
    expect(nextAction(s, "ddl")).toEqual({
      action: "dispatch",
      stage: "ready-for-apply",
      owner: ownerOf("ready-for-apply"),
    });
  });

  it.each(["blocked", "partial", "needs_decision"] as const)(
    "halts on a %s stage instead of advancing",
    (status) => {
      const s = run(seed(), "readiness", status);
      const advice = nextAction(s, "full");
      expect(advice.action).toBe("halt");
      if (advice.action === "halt") {
        expect(advice.reason).toContain("do not advance the DAG");
        expect(advice.reason).toContain("somebody has to authorise");
      }
    }
  );

  // A state carrying a stage this mode never runs was produced by a different
  // mode. Dispatching the entry anyway would start a second flow on top of the
  // first, and the history would read as if one flow did both.
  it("halts when the state contains a stage outside the mode", () => {
    const s = run(seed(), "requirements");
    const advice = nextAction(s, "code-docs");
    expect(advice.action).toBe("halt");
    if (advice.action === "halt") {
      expect(advice.reason).toContain("produced by a different mode");
    }
  });

  // A flow that ran past its own path is a mode chosen wrong, not a stage to
  // invent.
  it("halts when the completed stage has no successor in scope", () => {
    let s = run(seed(), "code-knowledge-baseline", "complete", "2026-08-13T09:00:00Z");
    s = run(s, "requirements", "complete", "2026-08-13T10:00:00Z");
    const advice = nextAction(s, "requirements");
    // `requirements` is this mode's terminal, so it is done — not halted.
    expect(advice.action).toBe("done");
  });

  // The re-dispatch this ordering prevents: a blocked entry stage used to fall
  // through to "nothing has completed yet", and the orchestrator would retry, on
  // its own, the exact stage a specialist had just refused.
  it("halts on a blocked entry stage instead of re-dispatching it", () => {
    const s = run(seed(), "readiness", "blocked");
    const advice = nextAction(s, "full");
    expect(advice.action).toBe("halt");
    if (advice.action === "halt") expect(advice.stage).toBe("readiness");
  });

  // Both stages belong to this mode; the question is only which one it follows.
  // The first fixture I wrote used `requirements`, which mode `implementation`
  // never runs — and the foreign-stage check caught it, which is the check
  // doing its job on its own author.
  it("follows the most recently completed stage, not declaration order", () => {
    let s = run(seed(), "sdd-planning", "complete", "2026-08-13T09:00:00Z");
    s = run(s, "ddl", "complete", "2026-08-13T12:00:00Z");
    const advice = nextAction(s, "implementation");
    expect(advice).toEqual({
      action: "dispatch",
      stage: "implementation",
      owner: ownerOf("implementation"),
    });
  });

  it("would have followed the earlier stage had it been the later one", () => {
    let s = run(seed(), "ddl", "complete", "2026-08-13T09:00:00Z");
    s = run(s, "sdd-planning", "complete", "2026-08-13T12:00:00Z");
    const advice = nextAction(s, "implementation");
    expect(advice.action).toBe("choose");
    if (advice.action === "choose") expect(advice.from).toBe("sdd-planning");
  });
});

describe("advice is advice", () => {
  // A function that both decided and acted could not be inspected before it did.
  it("never touches the state it was given", () => {
    const before = run(seed(), "readiness");
    const snapshot = JSON.stringify(before);
    nextAction(before, "full");
    expect(JSON.stringify(before)).toBe(snapshot);
  });
});
