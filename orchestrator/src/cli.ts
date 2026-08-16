#!/usr/bin/env node
// The orchestrator's command surface.
//
//   harness-flow start | status | dispatch | result | gates | doctor
//
// Same split as everywhere else in this program: this layer turns argv into
// calls and prints what came back. It decides nothing. `nextAction` already
// returns advice rather than acting, and a CLI that quietly acted on that
// advice would put the decision back where nobody can inspect it.
//
// Exit codes are part of the contract, because the callers are scripts:
//   0  did what was asked
//   1  refused, or found problems
//   2  the request itself was wrong
//
// There is deliberately no `advance` command. Moving the flow forward means
// dispatching a specialist and recording what it answered, and collapsing that
// into one verb would let a run report a transition nobody's work produced.

import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { Command } from "commander";
import type { FlowMode, Stage } from "./contracts";
import { checkProvenance, nextAction, ownerOf } from "./dag";
import {
  breakingChangeGate,
  contradictionGate,
  verifyApproval,
  type Approval,
  type BreakingDecision,
  type Contradiction,
} from "./gates";
import {
  dispatch,
  initialState,
  recordResult,
  type FlowState,
  type StageStatus,
  StateRejected,
} from "./state";
import { LockHeldError } from "harness-core";
import { readState, withSession, type StoreLayout } from "./store";

const out = (s: string) => process.stdout.write(`${s}\n`);
const err = (s: string) => process.stderr.write(`${s}\n`);

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

const MODES: FlowMode[] = ["full", "requirements", "code-docs", "ddl", "implementation"];

export interface CommonOptions {
  root?: string;
  change?: string;
}

export function layoutOf(options: CommonOptions): StoreLayout {
  return { root: path.resolve(options.root ?? path.join(process.cwd(), ".harness-flow")) };
}

export function requireChange(options: CommonOptions): string {
  if (options.change === undefined || options.change.trim() === "") {
    throw new UsageError("--change is required");
  }
  return options.change;
}

export function requireMode(value: string | undefined): FlowMode {
  if (value === undefined) throw new UsageError("--mode is required");
  if (!MODES.includes(value as FlowMode)) {
    throw new UsageError(`--mode must be one of ${MODES.join(", ")}, got "${value}"`);
  }
  return value as FlowMode;
}

export function readJson<T>(file: string): T {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch (e) {
    throw new UsageError(`cannot read ${file}: ${(e as Error).message}`);
  }
}

function existingState(layout: StoreLayout, changeId: string): FlowState {
  const state = readState(layout, changeId);
  if (state === null) {
    throw new UsageError(
      `no flow at ${layout.root} for ${changeId} — start it first, or point --root at the right directory`
    );
  }
  return state;
}

/** The seed a session needs when the flow already exists. */
function seedFor(changeId: string): FlowState {
  const at = changeId.indexOf("--");
  if (at === -1) {
    throw new UsageError(
      `change id "${changeId}" is not "<unit>--<slug>" — sdd/{change_id}/* namespaces would collide across units`
    );
  }
  return initialState({
    businessProject: "",
    unit: changeId.slice(0, at),
    changeId,
  });
}

function printAdvice(state: FlowState, mode: FlowMode): number {
  const advice = nextAction(state, mode);
  switch (advice.action) {
    case "dispatch":
      out(`next      dispatch ${advice.stage}  (${advice.owner})`);
      return 0;
    case "resume":
      out(`next      resume ${advice.stage}  (${advice.owner}) — already running`);
      return 0;
    case "done":
      out(`next      done at ${advice.stage}`);
      return 0;
    case "choose":
      out(`next      choose a branch out of ${advice.from}:`);
      for (const option of advice.options) {
        out(`            ${option.to.padEnd(24)} ${option.condition}`);
      }
      // Not a failure: the flow is healthy and waiting on a decision that lives
      // in the artifacts. Exiting 0 would let a script treat "somebody must
      // choose" as "nothing to do".
      return 1;
    case "halt":
      err(`halted at ${advice.stage}`);
      err(`  ${advice.reason}`);
      return 1;
  }
}

export function main(argv: string[]): number {
  const program = new Command();
  program
    .name("harness-flow")
    .description("Project Flow Orchestrator: DAG, state, resume and human gates.")
    .exitOverride();

  const common = (c: Command) =>
    c
      .option("--root <directory>", "where flow state lives (default: ./.harness-flow)")
      .option("--change <id>", "change id, <unit>--<slug>");

  let code = 0;
  let ran = false;

  common(program.command("start"))
    .requiredOption("--project <name>", "business project")
    .requiredOption("--mode <mode>", MODES.join(" | "))
    .action((options: CommonOptions & { project: string; mode: string }) => {
      ran = true;
      const changeId = requireChange(options);
      const mode = requireMode(options.mode);
      const layout = layoutOf(options);

      if (readState(layout, changeId) !== null) {
        throw new UsageError(
          `a flow for ${changeId} already exists — resuming is \`status\`, and starting over means a new change id, not a second flow under the same one`
        );
      }

      const at = changeId.indexOf("--");
      if (at === -1) throw new UsageError(`change id "${changeId}" is not "<unit>--<slug>"`);
      const seed = initialState({
        businessProject: options.project,
        unit: changeId.slice(0, at),
        changeId,
      });

      withSession(layout, changeId, seed, (session) => {
        out(`started   ${changeId}  mode ${mode}`);
        out(`state     ${layout.root}`);
        code = printAdvice(session.state, mode);
      });
    });

  common(program.command("status"))
    .requiredOption("--mode <mode>", MODES.join(" | "))
    .action((options: CommonOptions & { mode: string }) => {
      ran = true;
      const changeId = requireChange(options);
      const mode = requireMode(options.mode);
      const state = existingState(layoutOf(options), changeId);

      out(`change    ${state.change_id}`);
      out(`revision  ${state.state_revision}  (fencing token ${state.fencing_token})`);
      for (const [stage, s] of Object.entries(state.stages)) {
        const attempts = s.attempts.length;
        out(
          `  ${stage.padEnd(26)} ${s.status.padEnd(15)} ${attempts} attempt${attempts === 1 ? "" : "s"}`
        );
      }
      for (const t of state.transitions) {
        out(`  ${t.from} → ${t.to}  at ${t.at}`);
      }
      code = printAdvice(state, mode);
    });

  common(program.command("dispatch"))
    .requiredOption("--stage <stage>", "stage to dispatch")
    .option("--input-ref <ref...>", "artifact refs handed to the specialist", [])
    .option("--input-digest <digest...>", "their digests", [])
    .action(
      (
        options: CommonOptions & {
          stage: string;
          inputRef: string[];
          inputDigest: string[];
        }
      ) => {
        ran = true;
        const changeId = requireChange(options);
        const layout = layoutOf(options);
        existingState(layout, changeId);

        // Generated here, not accepted from the caller: an attempt id a script
        // can choose is an attempt id a script can repeat, and the whole point
        // of the identity is that a retry is visibly a different run.
        const attemptId = crypto.randomUUID();
        const requestId = crypto.randomUUID();

        withSession(layout, changeId, seedFor(changeId), (session) => {
          session.commit(
            dispatch(session.state, session.ctx, {
              stage: options.stage as Stage,
              owner: ownerOf(options.stage as Stage),
              attemptId,
              requestId,
              inputRefs: options.inputRef,
              inputDigests: options.inputDigest,
            })
          );
          out(`dispatched ${options.stage}  (${ownerOf(options.stage as Stage)})`);
          out(`  attempt  ${attemptId}`);
          out(`  request  ${requestId}`);
          out(`  token    ${session.ctx.fencingToken}`);
        });
      }
    );

  common(program.command("result"))
    .requiredOption("--stage <stage>", "stage the result is for")
    .requiredOption("--attempt <id>", "the attempt it answers")
    .requiredOption("--request <id>", "the request it answers")
    .requiredOption("--status <status>", "complete | partial | blocked | needs_decision")
    .option("--input-digest <digest...>", "digests it was dispatched with", [])
    .option("--output-ref <ref...>", "what it produced", [])
    .option("--output-digest <digest...>", "their digests", [])
    .action(
      (
        options: CommonOptions & {
          stage: string;
          attempt: string;
          request: string;
          status: string;
          inputDigest: string[];
          outputRef: string[];
          outputDigest: string[];
        }
      ) => {
        ran = true;
        const changeId = requireChange(options);
        const layout = layoutOf(options);
        existingState(layout, changeId);

        withSession(layout, changeId, seedFor(changeId), (session) => {
          session.commit(
            recordResult(session.state, session.ctx, {
              stage: options.stage as Stage,
              attemptId: options.attempt,
              requestId: options.request,
              status: options.status as Exclude<StageStatus, "pending" | "running">,
              inputDigests: options.inputDigest,
              outputRefs: options.outputRef,
              outputDigests: options.outputDigest,
            })
          );
          out(`recorded  ${options.stage} → ${options.status}`);
        });
      }
    );

  common(program.command("gates"))
    .option("--approval <file>", "Approval/v1")
    .option("--presented <file>", "{artifacts, sourceRevision} being promoted")
    .option("--contradictions <file>", "Contradictions/v1 items")
    .option("--impact <file>", "{classification, digest}")
    .option("--decision <file>", "the human decision on a breaking impact")
    .action(
      (
        options: CommonOptions & {
          approval?: string;
          presented?: string;
          contradictions?: string;
          impact?: string;
          decision?: string;
        }
      ) => {
        ran = true;
        const problems: string[] = [];
        let checked = 0;

        if (options.approval !== undefined) {
          if (options.presented === undefined) {
            throw new UsageError(
              "--approval needs --presented: an approval can only be checked against what is being promoted now"
            );
          }
          checked += 1;
          problems.push(
            ...verifyApproval(
              readJson<Approval>(options.approval),
              readJson(options.presented)
            ).problems
          );
        }

        if (options.contradictions !== undefined) {
          checked += 1;
          problems.push(
            ...contradictionGate(readJson<Contradiction[]>(options.contradictions)).problems
          );
        }

        if (options.impact !== undefined) {
          checked += 1;
          problems.push(
            ...breakingChangeGate(
              readJson(options.impact),
              options.decision === undefined
                ? null
                : readJson<BreakingDecision>(options.decision)
            ).problems
          );
        }

        // Reporting "all gates pass" after checking none is the failure mode
        // this whole program is about.
        if (checked === 0) {
          throw new UsageError(
            "no gate was given anything to check — pass --approval, --contradictions or --impact"
          );
        }

        if (problems.length === 0) {
          out(`gates     ${checked} checked, no problems`);
          return;
        }
        err(`gates     ${checked} checked, ${problems.length} problem(s)`);
        for (const p of problems) err(`  - ${p}`);
        code = 1;
      }
    );

  common(program.command("doctor")).action((options: CommonOptions) => {
    ran = true;
    const provenance = checkProvenance();
    for (const p of provenance.problems) err(`  catalog  ${p}`);
    if (!provenance.ok) code = 1;

    if (options.change !== undefined) {
      const state = readState(layoutOf(options), options.change);
      if (state === null) {
        err(`  flow     no state for ${options.change} at ${layoutOf(options).root}`);
        code = 1;
      } else if (state.mirror_pending) {
        err("  flow     mirror_pending — a hybrid write confirmed the file but not the mirror; nobody knows which one the next reader picks");
        code = 1;
      }
    }

    if (code === 0) out("no findings");
  });

  // Checked before parsing: commander treats "no command" as a request for help
  // and exits 0. A script that invoked us with nothing did something wrong.
  const words = argv.slice(2).filter((a) => !a.startsWith("-"));
  if (words.length === 0 && !argv.includes("--help") && !argv.includes("-h")) {
    program.outputHelp();
    return 2;
  }

  try {
    program.parse(argv);
  } catch (e) {
    const commanderCode = (e as { code?: string }).code;
    if (
      commanderCode === "commander.helpDisplayed" ||
      commanderCode === "commander.help" ||
      commanderCode === "commander.version"
    ) {
      return 0;
    }
    return report(e);
  }

  if (!ran) {
    program.outputHelp();
    return 2;
  }
  return code;
}

function report(e: unknown): number {
  if (e instanceof UsageError) {
    err(`usage: ${e.message}`);
    return 2;
  }
  if (e instanceof LockHeldError) {
    err(e.message);
    return 1;
  }
  if (e instanceof StateRejected) {
    err(`${e.kind}: ${e.message}`);
    return 1;
  }
  err(`${(e as Error).message}`);
  return 1;
}

/* istanbul ignore next -- entry point */
if (require.main === module) {
  try {
    process.exitCode = main(process.argv);
  } catch (e: unknown) {
    process.exitCode = report(e);
  }
}
