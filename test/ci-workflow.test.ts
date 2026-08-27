import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { parse } from "yaml";

// tickle-stick#151. These are shape guards on the CI workflow itself, not on
// `src/`. Two invariants the promotion path depends on, both of which regress
// silently and are only noticed when a promotion is already blocked:
//
//   1. `ci.yaml` declares `workflow_dispatch`. `promote-main.yml`'s rung 3
//      dispatches this workflow to produce `CI Required` evidence for a tip
//      that has none; without the trigger that dispatch fails outright
//      (cwc#2749).
//   2. No job or step in `ci.yaml` is conditional on the triggering event, so
//      the `CI Required` fan-in reports identically on a `workflow_dispatch`
//      run as on a `pull_request` run. A job skipped on dispatch would make
//      the aggregate gate mean something different depending on how it fired.

const WORKFLOWS = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  ".github",
  "workflows",
);

function loadWorkflow(name: string): Record<string, unknown> {
  return parse(fs.readFileSync(path.join(WORKFLOWS, name), "utf8")) as Record<
    string,
    unknown
  >;
}

/**
 * `on:` is a YAML 1.1 boolean but a plain string under the 1.2 core schema
 * the `yaml` package uses by default. Accept whichever key the parser
 * produced so this guard does not depend on that detail.
 */
function triggers(workflow: Record<string, unknown>): Record<string, unknown> {
  const on = workflow["on"] ?? workflow[true as unknown as string];
  expect(on, "workflow declares an `on:` block").toBeDefined();
  return on as Record<string, unknown>;
}

/** Every `if:` expression in the workflow, job-level and step-level. */
function conditions(workflow: Record<string, unknown>): string[] {
  const found: string[] = [];
  const jobs = (workflow.jobs ?? {}) as Record<string, Record<string, unknown>>;
  for (const job of Object.values(jobs)) {
    if (typeof job.if === "string") found.push(job.if);
    for (const step of (job.steps ?? []) as Record<string, unknown>[]) {
      if (typeof step.if === "string") found.push(step.if);
    }
  }
  return found;
}

describe("ci.yaml", () => {
  const ci = loadWorkflow("ci.yaml");

  it("declares workflow_dispatch so promote-main rung 3 can produce evidence", () => {
    expect(Object.keys(triggers(ci))).toContain("workflow_dispatch");
  });

  it("still runs on pushes to develop and on pull requests into develop", () => {
    const on = triggers(ci);
    expect((on.push as { branches: string[] }).branches).toContain("develop");
    expect((on.pull_request as { branches: string[] }).branches).toContain(
      "develop",
    );
  });

  it("keeps the CI Required aggregate job", () => {
    const jobs = ci.jobs as Record<string, { name?: string }>;
    expect(
      Object.values(jobs).some((job) => job.name === "CI Required"),
    ).toBe(true);
  });

  it("has no job or step conditional on the triggering event", () => {
    // A condition reading any of these would make the run's shape — and so
    // the meaning of `CI Required` — depend on how the workflow was fired.
    const eventContexts = [
      "github.event.pull_request",
      "github.head_ref",
      "github.base_ref",
      "github.event_name",
    ];
    for (const condition of conditions(ci)) {
      for (const context of eventContexts) {
        expect(
          condition,
          `\`if: ${condition}\` reads \`${context}\`, so this job/step would ` +
            `behave differently on a workflow_dispatch run than on a ` +
            `pull_request run (tickle-stick#151)`,
        ).not.toContain(context);
      }
    }
  });
});

describe("dependabot-auto-merge.yml", () => {
  const workflow = loadWorkflow("dependabot-auto-merge.yml");

  it("enables auto-merge under PROMOTION_BOT_TOKEN, not GITHUB_TOKEN alone", () => {
    const jobs = workflow.jobs as Record<
      string,
      { steps: { name?: string; env?: Record<string, string> }[] }
    >;
    const steps = Object.values(jobs).flatMap((job) => job.steps);
    const merge = steps.find((step) => step.name?.includes("Enable auto-merge"));

    expect(merge, "the auto-merge step is present").toBeDefined();

    const ghToken = merge?.env?.GH_TOKEN ?? "";
    // A merge pushed with the default `GITHUB_TOKEN` does not trigger further
    // workflow runs, so the develop tip it lands is never stamped with a
    // `CI Required` check-run. The App token must be the primary identity;
    // `GITHUB_TOKEN` may appear only as the trailing fallback that keeps
    // auto-merge working until the Dependabot-store secret is provisioned.
    expect(ghToken).toContain("secrets.PROMOTION_BOT_TOKEN");
    expect(ghToken.indexOf("secrets.PROMOTION_BOT_TOKEN")).toBeLessThan(
      ghToken.indexOf("secrets.GITHUB_TOKEN") === -1
        ? Number.MAX_SAFE_INTEGER
        : ghToken.indexOf("secrets.GITHUB_TOKEN"),
    );
  });
});
