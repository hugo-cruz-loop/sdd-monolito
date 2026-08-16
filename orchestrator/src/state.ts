// The global flow state.
//
// "Solo Project Flow Orchestrator modifica este estado mediante compare-and-swap
// sobre `state_revision`. Un resultado con identidad, attempt o input digest
// distinto se rechaza como stale/replay; cada transición conserva historial
// inmutable."
//
// Three separate rejections hide behind that sentence, and collapsing them is
// how a resumed flow silently accepts work from a run nobody remembers:
//
//   * STALE — the writer read revision N and the state is now N+1. Somebody
//     else moved. The writer's decisions were made against a world that no
//     longer exists, so they cannot be applied on top.
//   * REPLAY — the same attempt reports twice. The second report is not new
//     information; accepting it would append a transition that never happened.
//   * DIVERGENT — the result's inputs are not the inputs this attempt was
//     dispatched with. It answers a different question.
//
// History is append-only. A transition is never rewritten, because the only
// reason to rewrite one is to make a past run agree with a present belief.

import type { Stage } from "./contracts";

export type StageStatus =
  | "pending"
  | "running"
  | "complete"
  | "partial"
  | "blocked"
  | "needs_decision";

export interface Attempt {
  attempt_id: string;
  request_id: string;
  input_refs: string[];
  input_digests: string[];
  output_refs: string[];
  output_digests: string[];
  started_at: string;
  finished_at: string | null;
}

export interface StageState {
  owner: string;
  status: StageStatus;
  attempts: Attempt[];
}

export interface Transition {
  from: Stage;
  to: Stage;
  result_digest: string;
  at: string;
}

export interface FlowState {
  state_revision: number;
  business_project: string;
  unit: string;
  change_id: string;
  /** Monotonic; a writer holding a lower token has been superseded. */
  fencing_token: number;
  stages: Partial<Record<Stage, StageState>>;
  transitions: Transition[];
  /**
   * Set when a hybrid write confirmed the authoritative file but not the mirror.
   * Blocks new dispatches: a state whose mirror disagrees cannot be resumed
   * from the mirror, and nobody knows which one the next reader will pick.
   */
  mirror_pending: boolean;
}

export type RejectionKind = "stale" | "replay" | "divergent" | "fenced" | "identity";

export class StateRejected extends Error {
  constructor(
    readonly kind: RejectionKind,
    message: string
  ) {
    super(message);
    this.name = "StateRejected";
  }
}

export function initialState(options: {
  businessProject: string;
  unit: string;
  changeId: string;
  now?: () => string;
}): FlowState {
  const expected = `${options.unit}--${changeSlugOf(options.changeId)}`;
  if (options.changeId !== expected) {
    throw new StateRejected(
      "identity",
      `change_id "${options.changeId}" is not "${expected}" — sdd/{change_id}/* namespaces would collide across units`
    );
  }
  return {
    state_revision: 0,
    business_project: options.businessProject,
    unit: options.unit,
    change_id: options.changeId,
    fencing_token: 0,
    stages: {},
    transitions: [],
    mirror_pending: false,
  };
}

function changeSlugOf(changeId: string): string {
  const at = changeId.indexOf("--");
  return at === -1 ? "" : changeId.slice(at + 2);
}

// ---------------------------------------------------------------------------
// Compare-and-swap
// ---------------------------------------------------------------------------

export interface WriteContext {
  /** The revision the writer read before deciding anything. */
  readRevision: number;
  /** The token the writer was handed when it acquired the lock. */
  fencingToken: number;
}

/**
 * Check that a writer may still act on the state it read.
 *
 * Both conditions are checked, not one: a writer can hold a current revision
 * with a stale token (it slept through somebody else's whole transaction and
 * the revision happened to come back around), and a current token with a stale
 * revision (it read early and decided late).
 */
export function assertWritable(state: FlowState, ctx: WriteContext): void {
  if (ctx.fencingToken < state.fencing_token) {
    throw new StateRejected(
      "fenced",
      `writer holds fencing token ${ctx.fencingToken} but the state is at ${state.fencing_token} — this writer was superseded and its decisions describe a lock it no longer holds`
    );
  }
  if (ctx.readRevision !== state.state_revision) {
    throw new StateRejected(
      "stale",
      `writer read revision ${ctx.readRevision} but the state is at ${state.state_revision} — somebody else moved, so these decisions were made against a world that no longer exists`
    );
  }
}

export interface DispatchOptions {
  stage: Stage;
  owner: string;
  attemptId: string;
  requestId: string;
  inputRefs: string[];
  inputDigests: string[];
  now?: () => string;
}

/** Record that a stage was dispatched. Returns the next state; never mutates. */
export function dispatch(
  state: FlowState,
  ctx: WriteContext,
  options: DispatchOptions
): FlowState {
  assertWritable(state, ctx);

  const stage = state.stages[options.stage];
  if (stage?.status === "running") {
    throw new StateRejected(
      "replay",
      `stage ${options.stage} is already running as attempt ${stage.attempts.at(-1)?.attempt_id} — two live attempts on one stage produce two results and no way to say which is current`
    );
  }
  if (stage?.attempts.some((a) => a.attempt_id === options.attemptId)) {
    throw new StateRejected(
      "replay",
      `attempt ${options.attemptId} was already dispatched for ${options.stage} — a retry needs a new attempt_id, or the two runs become indistinguishable in the history`
    );
  }

  const at = (options.now ?? isoNow)();
  return {
    ...state,
    state_revision: state.state_revision + 1,
    stages: {
      ...state.stages,
      [options.stage]: {
        owner: options.owner,
        status: "running",
        attempts: [
          ...(stage?.attempts ?? []),
          {
            attempt_id: options.attemptId,
            request_id: options.requestId,
            input_refs: [...options.inputRefs],
            input_digests: [...options.inputDigests],
            output_refs: [],
            output_digests: [],
            started_at: at,
            finished_at: null,
          },
        ],
      },
    },
  };
}

export interface ResultOptions {
  stage: Stage;
  attemptId: string;
  requestId: string;
  status: Exclude<StageStatus, "pending" | "running">;
  /** Echoed back by the specialist; must match what it was dispatched with. */
  inputDigests: string[];
  outputRefs: string[];
  outputDigests: string[];
  now?: () => string;
}

/**
 * Record a specialist's result.
 *
 * The reported inputs are compared against the dispatched ones. A specialist
 * that answers about different inputs answered a different question, and
 * accepting it would attribute its conclusions to work nobody asked for.
 */
export function recordResult(
  state: FlowState,
  ctx: WriteContext,
  options: ResultOptions
): FlowState {
  assertWritable(state, ctx);

  const stage = state.stages[options.stage];
  if (stage === undefined) {
    throw new StateRejected(
      "divergent",
      `result for ${options.stage}, which was never dispatched`
    );
  }

  const index = stage.attempts.findIndex((a) => a.attempt_id === options.attemptId);
  if (index === -1) {
    throw new StateRejected(
      "divergent",
      `attempt ${options.attemptId} is not among the attempts dispatched for ${options.stage}`
    );
  }

  const attempt = stage.attempts[index];
  if (attempt.finished_at !== null) {
    throw new StateRejected(
      "replay",
      `attempt ${options.attemptId} already finished at ${attempt.finished_at} — the second report is not new information, and appending it would record a transition that never happened`
    );
  }
  if (attempt.request_id !== options.requestId) {
    throw new StateRejected(
      "divergent",
      `attempt ${options.attemptId} was dispatched as request ${attempt.request_id}, not ${options.requestId}`
    );
  }
  if (!sameDigests(attempt.input_digests, options.inputDigests)) {
    throw new StateRejected(
      "divergent",
      `result for ${options.attemptId} reports different input digests than it was dispatched with — it answers a different question, and accepting it would attribute its conclusions to work nobody asked for`
    );
  }

  const attempts = [...stage.attempts];
  attempts[index] = {
    ...attempt,
    output_refs: [...options.outputRefs],
    output_digests: [...options.outputDigests],
    finished_at: (options.now ?? isoNow)(),
  };

  return {
    ...state,
    state_revision: state.state_revision + 1,
    stages: {
      ...state.stages,
      [options.stage]: { ...stage, status: options.status, attempts },
    },
  };
}

/**
 * Append a transition. History is append-only: the only reason to rewrite one
 * is to make a past run agree with a present belief.
 */
export function appendTransition(
  state: FlowState,
  ctx: WriteContext,
  transition: Omit<Transition, "at"> & { at?: string }
): FlowState {
  assertWritable(state, ctx);

  const from = state.stages[transition.from];
  if (from?.status !== "complete") {
    throw new StateRejected(
      "divergent",
      `cannot transition out of ${transition.from}, which is ${from?.status ?? "never dispatched"} — blocked, partial and needs_decision do not advance the DAG`
    );
  }

  return {
    ...state,
    state_revision: state.state_revision + 1,
    transitions: [
      ...state.transitions,
      { ...transition, at: transition.at ?? isoNow() },
    ],
  };
}

function sameDigests(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const left = [...a].sort();
  const right = [...b].sort();
  return left.every((v, i) => v === right[i]);
}

const isoNow = (): string => new Date().toISOString();

/** The stage a resumed flow should look at, or null when nothing is pending. */
export function currentStage(state: FlowState): Stage | null {
  for (const [stage, s] of Object.entries(state.stages) as [Stage, StageState][]) {
    if (s.status === "running") return stage;
  }
  return null;
}
