import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { layoutOf, readJson, requireChange, requireMode, UsageError } from "../src/cli";

let root: string;
let flow: string;

const DIST_CLI = path.join(__dirname, "..", "dist", "cli.js");
const CHANGE = "billing-service--add-payment-idempotency";

beforeAll(() => {
  const build = spawnSync("npx", ["tsc", "-p", "tsconfig.json"], {
    cwd: path.join(__dirname, ".."),
    encoding: "utf8",
  });
  if (build.status !== 0) throw new Error(`build failed: ${build.stdout}${build.stderr}`);
}, 60000);

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-cli-"));
  flow = path.join(root, "flow");
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

/** Run the built CLI the way a script would. */
function run(...args: string[]) {
  const r = spawnSync(process.execPath, [DIST_CLI, ...args], { encoding: "utf8" });
  return { code: r.status ?? -1, out: r.stdout, err: r.stderr };
}

const withRoot = (...args: string[]) => ["--root", flow, "--change", CHANGE, ...args];

describe("argument handling", () => {
  it("defaults the state root to a directory under cwd", () => {
    expect(layoutOf({}).root).toBe(path.join(process.cwd(), ".harness-flow"));
  });

  it("resolves a relative root to an absolute path", () => {
    expect(path.isAbsolute(layoutOf({ root: "./x" }).root)).toBe(true);
  });

  it("requires a change id", () => {
    expect(() => requireChange({})).toThrow(UsageError);
    expect(() => requireChange({ change: "  " })).toThrow(/--change is required/);
  });

  it("rejects an unknown mode by name", () => {
    expect(() => requireMode("planning")).toThrow(/--mode must be one of/);
  });

  it("accepts each declared mode", () => {
    for (const mode of ["full", "requirements", "code-docs", "ddl", "implementation"]) {
      expect(requireMode(mode)).toBe(mode);
    }
  });

  it("reports an unreadable file as a usage problem, not a crash", () => {
    expect(() => readJson(path.join(root, "nope.json"))).toThrow(UsageError);
  });
});

describe("starting a flow", () => {
  it("creates the state and says what comes next", () => {
    const r = run("start", ...withRoot("--project", "payments", "--mode", "full"));
    expect(r.code).toBe(0);
    expect(r.out).toContain("started");
    expect(r.out).toContain("dispatch readiness");
  });

  // Starting over means a new change id, not a second flow under the same one.
  it("refuses to start a second flow under the same change id", () => {
    run("start", ...withRoot("--project", "payments", "--mode", "full"));
    const r = run("start", ...withRoot("--project", "payments", "--mode", "full"));
    expect(r.code).toBe(2);
    expect(r.err).toContain("already exists");
  });

  it("refuses a change id that is not <unit>--<slug>", () => {
    const r = run(
      "start",
      "--root",
      flow,
      "--change",
      "nounit",
      "--project",
      "p",
      "--mode",
      "full"
    );
    expect(r.code).toBe(2);
    expect(r.err).toContain("<unit>--<slug>");
  });
});

describe("status", () => {
  it("refuses when no flow exists at that root", () => {
    const r = run("status", ...withRoot("--mode", "full"));
    expect(r.code).toBe(2);
    expect(r.err).toContain("start it first");
  });

  it("reports the revision, the fencing token and what comes next", () => {
    run("start", ...withRoot("--project", "payments", "--mode", "full"));
    const r = run("status", ...withRoot("--mode", "full"));
    expect(r.code).toBe(0);
    expect(r.out).toContain("revision");
    expect(r.out).toContain("fencing token");
    expect(r.out).toContain("dispatch readiness");
  });
});

describe("dispatch and result", () => {
  const start = () => run("start", ...withRoot("--project", "payments", "--mode", "full"));

  it("records a dispatch and prints the identity the specialist must echo", () => {
    start();
    const r = run("dispatch", ...withRoot("--stage", "readiness"));
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/attempt\s+[0-9a-f-]{36}/);
    expect(r.out).toMatch(/request\s+[0-9a-f-]{36}/);
  });

  // An attempt id a script can choose is one a script can repeat, and the whole
  // point of the identity is that a retry is visibly a different run.
  it("generates the attempt id rather than accepting one", () => {
    start();
    const first = run("dispatch", ...withRoot("--stage", "readiness"));
    const attempt = /attempt\s+([0-9a-f-]{36})/.exec(first.out)![1];

    run("result", ...withRoot(
      "--stage", "readiness",
      "--attempt", attempt,
      "--request", /request\s+([0-9a-f-]{36})/.exec(first.out)![1],
      "--status", "blocked"
    ));

    const second = run("dispatch", ...withRoot("--stage", "readiness"));
    const retried = /attempt\s+([0-9a-f-]{36})/.exec(second.out)![1];
    expect(retried).not.toBe(attempt);
  });

  it("refuses a result whose attempt was never dispatched", () => {
    start();
    run("dispatch", ...withRoot("--stage", "readiness"));
    const r = run("result", ...withRoot(
      "--stage", "readiness",
      "--attempt", "00000000-0000-4000-8000-000000000000",
      "--request", "r",
      "--status", "complete"
    ));
    expect(r.code).toBe(1);
    expect(r.err).toContain("divergent");
  });

  it("advances the flow once a stage completes", () => {
    start();
    const dispatched = run("dispatch", ...withRoot("--stage", "readiness"));
    const attempt = /attempt\s+([0-9a-f-]{36})/.exec(dispatched.out)![1];
    const request = /request\s+([0-9a-f-]{36})/.exec(dispatched.out)![1];

    run("result", ...withRoot(
      "--stage", "readiness",
      "--attempt", attempt,
      "--request", request,
      "--status", "complete"
    ));

    const status = run("status", ...withRoot("--mode", "full"));
    expect(status.out).toContain("dispatch code-knowledge-baseline");
  });

  // A flow waiting on a branch is healthy, but it is not "nothing to do".
  // Exiting 0 would let a script schedule the next step and move on, and the
  // branch that decides between ddl and implementation would go unchosen.
  it("exits 1 when the flow is waiting on a branch, and lists the options", () => {
    run("start", "--root", flow, "--change", CHANGE, "--project", "p", "--mode", "implementation");
    const dispatched = run("dispatch", ...withRoot("--stage", "sdd-planning"));
    const attempt = /attempt\s+([0-9a-f-]{36})/.exec(dispatched.out)![1];
    const request = /request\s+([0-9a-f-]{36})/.exec(dispatched.out)![1];
    run("result", ...withRoot(
      "--stage", "sdd-planning",
      "--attempt", attempt,
      "--request", request,
      "--status", "complete"
    ));

    const status = run("status", ...withRoot("--mode", "implementation"));
    expect(status.code).toBe(1);
    expect(status.out).toContain("choose a branch");
    expect(status.out).toContain("ddl");
    expect(status.out).toContain("implementation");
  });

  // A halt is not a hiccup: retrying is a new attempt somebody has to authorise.
  it("exits 1 and explains when a stage halted", () => {
    start();
    const dispatched = run("dispatch", ...withRoot("--stage", "readiness"));
    const attempt = /attempt\s+([0-9a-f-]{36})/.exec(dispatched.out)![1];
    const request = /request\s+([0-9a-f-]{36})/.exec(dispatched.out)![1];

    run("result", ...withRoot(
      "--stage", "readiness",
      "--attempt", attempt,
      "--request", request,
      "--status", "blocked"
    ));

    const status = run("status", ...withRoot("--mode", "full"));
    expect(status.code).toBe(1);
    expect(status.err).toContain("do not advance the DAG");
  });
});

describe("gates", () => {
  const write = (name: string, value: unknown) => {
    const file = path.join(root, name);
    fs.writeFileSync(file, JSON.stringify(value));
    return file;
  };

  // Reporting "all gates pass" after checking none is the failure mode this
  // whole program is about.
  it("refuses to report a pass when nothing was checked", () => {
    const r = run("gates", "--root", flow, "--change", CHANGE);
    expect(r.code).toBe(2);
    expect(r.err).toContain("no gate was given anything to check");
  });

  it("refuses an approval with nothing to check it against", () => {
    const approval = write("a.json", { type: "Approval/v1" });
    const r = run("gates", "--root", flow, "--change", CHANGE, "--approval", approval);
    expect(r.code).toBe(2);
    expect(r.err).toContain("only be checked against what is being promoted now");
  });

  it("passes a clean contradiction set", () => {
    const file = write("c.json", [
      { id: "c1", kind: "doc-vs-code", authority: "CODE_WINS", status: "resolved", resolved_by: "hugo" },
    ]);
    const r = run("gates", "--root", flow, "--change", CHANGE, "--contradictions", file);
    expect(r.code).toBe(0);
    expect(r.out).toContain("1 checked, no problems");
  });

  it("reports an open contradiction and exits 1", () => {
    const file = write("c.json", [
      { id: "c1", kind: "doc-vs-doc", authority: "UNRESOLVED", status: "open", resolved_by: null },
    ]);
    const r = run("gates", "--root", flow, "--change", CHANGE, "--contradictions", file);
    expect(r.code).toBe(1);
    expect(r.err).toContain("a person has to");
  });

  it("blocks a breaking impact with no decision", () => {
    const file = write("i.json", { classification: "breaking", digest: "a".repeat(64) });
    const r = run("gates", "--root", flow, "--change", CHANGE, "--impact", file);
    expect(r.code).toBe(1);
    expect(r.err).toContain("nobody has agreed to that");
  });

  it("counts every gate it was given", () => {
    const contradictions = write("c.json", []);
    const impact = write("i.json", { classification: "additive", digest: "a".repeat(64) });
    const r = run(
      "gates", "--root", flow, "--change", CHANGE,
      "--contradictions", contradictions, "--impact", impact
    );
    expect(r.out).toContain("2 checked");
  });
});

describe("doctor", () => {
  it("reports no findings on a clean install", () => {
    const r = run("doctor", "--root", flow);
    expect(r.code).toBe(0);
    expect(r.out).toContain("no findings");
  });

  it("reports a missing flow when asked about one", () => {
    const r = run("doctor", "--root", flow, "--change", CHANGE);
    expect(r.code).toBe(1);
    expect(r.err).toContain("no state for");
  });
});

describe("the command surface", () => {
  // A script that invoked us with nothing did something wrong; reporting
  // success would let it carry on believing the flow moved.
  it("exits 2 and prints help when given no command", () => {
    const r = run();
    expect(r.code).toBe(2);
    expect(r.out + r.err).toContain("dispatch");
  });

  // Collapsing dispatch and result into one verb would let a run report a
  // transition nobody's work produced.
  it("has no `advance` command", () => {
    const r = run("advance", "--root", flow, "--change", CHANGE);
    expect(r.code).not.toBe(0);
  });
});
