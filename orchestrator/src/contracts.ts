// Types shared with the frozen contracts in harness-ctha-docs.
//
// Hand-written on purpose, and deliberately narrow: the orchestrator needs the
// stage vocabulary and the result vocabulary, not the whole schema set. The
// authority is `contracts/v1/` in harness-ctha-docs; a mismatch here is a bug
// here, never a licence to widen the contract.

export type Stage =
  | "readiness"
  | "code-knowledge-baseline"
  | "requirements"
  | "sdd-planning"
  | "ddl"
  | "implementation"
  | "code-knowledge-refresh"
  | "ready-for-apply"
  | "external-apply"
  | "post-apply-reconcile"
  | "archive-delivery"
  | "archive-post-apply";

export const STAGES: Stage[] = [
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
];

export type FlowMode =
  | "full"
  | "requirements"
  | "code-docs"
  | "ddl"
  | "implementation";

export type ResultStatus =
  | "complete"
  | "partial"
  | "blocked"
  | "needs_decision";

export type ArtifactStore = "engram" | "files" | "hybrid";
