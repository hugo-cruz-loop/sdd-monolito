// The DAG, read from the frozen catalog.
//
// The transitions are NOT declared here. They live in `contracts/v1/catalog.json`,
// owned by harness-ctha-docs and vendored with a digest pin — the same
// arrangement harness-install uses, for the same reason: a second copy of a rule
// keeps validating instances, keeps looking authoritative, and quietly disagrees
// with every other harness.
//
// What this module adds is what the catalog deliberately does not say: which
// stage comes next for a given MODE. The catalog describes the graph; a mode
// describes a path through it, and paths are the orchestrator's business.

import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import type { FlowMode, Stage } from "./contracts";
import type { FlowState } from "./state";

export const CONTRACTS_ROOT = path.join(__dirname, "..", "contracts");

export class CatalogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CatalogError";
  }
}

export interface CatalogTransition {
  from: Stage;
  to: Stage;
  condition: string;
}

export interface Catalog {
  catalog_version: number;
  stages: { id: Stage; owner: string; purpose: string }[];
  transitions: CatalogTransition[];
}

let cached: Catalog | null = null;

export function loadCatalog(): Catalog {
  if (cached !== null) return cached;
  const file = path.join(CONTRACTS_ROOT, "v1", "catalog.json");
  cached = JSON.parse(fs.readFileSync(file, "utf8")) as Catalog;
  return cached;
}

/**
 * Prove the vendored catalog is still the one the owner sealed.
 *
 * Reported as drift, never repaired here: repairing it would make this
 * repository the author of a rule it only consumes.
 */
export function checkProvenance(): { ok: boolean; problems: string[] } {
  const provenance = JSON.parse(
    fs.readFileSync(path.join(CONTRACTS_ROOT, "PROVENANCE.json"), "utf8")
  ) as {
    owner_repository: string;
    pinned_commit: string;
    files: { path: string; sha256: string }[];
  };

  const problems: string[] = [];
  for (const entry of provenance.files) {
    const absolute = path.join(CONTRACTS_ROOT, entry.path);
    if (!fs.existsSync(absolute)) {
      problems.push(`${entry.path} is pinned but missing`);
      continue;
    }
    const actual = crypto
      .createHash("sha256")
      .update(fs.readFileSync(absolute))
      .digest("hex");
    if (actual !== entry.sha256) {
      problems.push(
        `${entry.path} is ${actual} but ${provenance.owner_repository}@${provenance.pinned_commit.slice(0, 12)} sealed ${entry.sha256} — fix it at the owner and re-pin, do not edit it here`
      );
    }
  }
  return { ok: problems.length === 0, problems };
}

export function ownerOf(stage: Stage): string {
  const found = loadCatalog().stages.find((s) => s.id === stage);
  if (found === undefined) throw new CatalogError(`unknown stage: ${stage}`);
  return found.owner;
}

/** Every stage the catalog allows moving to from `from`. */
export function successorsOf(from: Stage): CatalogTransition[] {
  return loadCatalog().transitions.filter((t) => t.from === from);
}

// ---------------------------------------------------------------------------
// Modes
// ---------------------------------------------------------------------------

/**
 * Where each mode starts and where it is allowed to stop.
 *
 * "Cada modo tiene su propia entrada tipada; no se simula como un fragmento
 * implícito de `full`." A mode that were just "full, but stop early" would have
 * no way to say which stop was intended and which was a flow that ran out.
 */
export interface ModeSpec {
  entry: Stage;
  /** Stages at which this mode has finished successfully. */
  terminals: Stage[];
  /** Stages this mode may pass through. Anything else is out of scope. */
  allowed: Stage[];
}

const MODES: Record<FlowMode, ModeSpec> = {
  requirements: {
    entry: "code-knowledge-baseline",
    terminals: ["requirements"],
    allowed: ["code-knowledge-baseline", "requirements"],
  },
  "code-docs": {
    entry: "code-knowledge-baseline",
    terminals: ["code-knowledge-baseline"],
    allowed: ["code-knowledge-baseline"],
  },
  ddl: {
    entry: "ddl",
    terminals: ["ready-for-apply", "archive-post-apply"],
    allowed: [
      "ddl",
      "implementation",
      "code-knowledge-refresh",
      "ready-for-apply",
      "external-apply",
      "post-apply-reconcile",
      "archive-post-apply",
    ],
  },
  implementation: {
    entry: "sdd-planning",
    terminals: ["archive-delivery", "ready-for-apply"],
    allowed: [
      "sdd-planning",
      "ddl",
      "implementation",
      "code-knowledge-refresh",
      "ready-for-apply",
      "archive-delivery",
    ],
  },
  full: {
    entry: "readiness",
    terminals: ["archive-delivery", "ready-for-apply", "archive-post-apply"],
    allowed: [
      "readiness",
      "code-knowledge-baseline",
      "requirements",
      "sdd-planning",
      "ddl",
      "implementation",
      "code-knowledge-refresh",
      "ready-for-apply",
      "external-apply",
      "post-apply-reconcile",
      "archive-delivery",
      "archive-post-apply",
    ],
  },
};

export function modeSpec(mode: FlowMode): ModeSpec {
  return MODES[mode];
}

export type Advice =
  | { action: "dispatch"; stage: Stage; owner: string }
  | { action: "resume"; stage: Stage; owner: string }
  | { action: "choose"; from: Stage; options: CatalogTransition[] }
  | { action: "halt"; stage: Stage; reason: string }
  | { action: "done"; stage: Stage };

/**
 * What the orchestrator should do next.
 *
 * Returns advice rather than acting, because every caller needs to decide
 * differently: the CLI prints it, an agent asks a human, a test asserts on it.
 * A function that both decided and acted could not be inspected before it did.
 */
export function nextAction(state: FlowState, mode: FlowMode): Advice {
  const spec = modeSpec(mode);
  const stages = Object.entries(state.stages) as [Stage, { status: string }][];

  const running = stages.find(([, s]) => s.status === "running");
  if (running !== undefined) {
    return { action: "resume", stage: running[0], owner: ownerOf(running[0]) };
  }

  // Checked BEFORE anything else, because a halt is a fact about the current
  // attempt whether or not another stage ever completed. Checking it later let
  // a blocked entry stage fall through to "nothing has completed yet" and get
  // re-dispatched — the orchestrator retrying, on its own, the exact stage a
  // specialist had just refused.
  const stopped = stages.find(
    ([, s]) =>
      s.status === "blocked" || s.status === "partial" || s.status === "needs_decision"
  );
  if (stopped !== undefined) {
    return {
      action: "halt",
      stage: stopped[0],
      reason: `${stopped[0]} is ${stopped[1].status}; blocked, partial and needs_decision do not advance the DAG, and retrying is a new attempt somebody has to authorise`,
    };
  }

  // A stage outside this mode's path means the state was not produced by this
  // mode. Dispatching the entry anyway would start a second flow on top of a
  // first one, and the history would read as if one flow did both.
  const foreign = stages.find(
    ([stage, s]) => s.status === "complete" && !spec.allowed.includes(stage)
  );
  if (foreign !== undefined) {
    return {
      action: "halt",
      stage: foreign[0],
      reason: `${foreign[0]} completed but is not part of mode "${mode}" — this state was produced by a different mode, and continuing would start a second flow on top of the first`,
    };
  }

  const last = lastCompleted(state, spec);
  if (last === null) {
    return { action: "dispatch", stage: spec.entry, owner: ownerOf(spec.entry) };
  }

  if (spec.terminals.includes(last)) {
    return { action: "done", stage: last };
  }

  const options = successorsOf(last).filter((t) => spec.allowed.includes(t.to));
  if (options.length === 0) {
    return {
      action: "halt",
      stage: last,
      reason: `${last} completed but no successor is in scope for mode "${mode}" — the flow ran past its own path, which is a mode chosen wrong, not a stage to invent`,
    };
  }
  if (options.length > 1) {
    // The catalog branches (sdd-planning goes to ddl or implementation; refresh
    // goes to apply or archive) and the condition that picks lives in the
    // artifacts, not in the graph. Guessing here would pick a path nobody chose.
    return { action: "choose", from: last, options };
  }

  return { action: "dispatch", stage: options[0].to, owner: ownerOf(options[0].to) };
}

/** The most recently completed stage inside this mode's path. */
function lastCompleted(state: FlowState, spec: ModeSpec): Stage | null {
  let latest: { stage: Stage; at: string } | null = null;
  for (const [stage, s] of Object.entries(state.stages) as [
    Stage,
    { status: string; attempts: { finished_at: string | null }[] },
  ][]) {
    if (s.status !== "complete") continue;
    if (!spec.allowed.includes(stage)) continue;
    const finished = s.attempts.at(-1)?.finished_at;
    if (finished == null) continue;
    if (latest === null || finished > latest.at) latest = { stage, at: finished };
  }
  return latest?.stage ?? null;
}
