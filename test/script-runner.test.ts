import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import {
  runScript,
  runPipedScript,
  SIGKILL_GRACE_MS,
} from "../src/script-runner.js";

describe("runScript", () => {
  it("parses valid JSON array of work items", async () => {
    const items = await runScript(
      "node",
      [
        "-e",
        'process.stdout.write(JSON.stringify([{id:"e1",source:"gmail",type:"email",summary:"Test email",timestamp:"2026-03-25T10:00:00Z"}]))',
      ],
      5000,
    );

    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("e1");
    expect(items[0].source).toBe("gmail");
    expect(items[0].summary).toBe("Test email");
    expect(items[0].timestamp).toBeInstanceOf(Date);
  });

  it("returns empty array for empty stdout", async () => {
    const items = await runScript("node", ["-e", ""], 5000);
    expect(items).toEqual([]);
  });

  it("returns empty array for non-JSON output", async () => {
    const items = await runScript(
      "node",
      ["-e", 'process.stdout.write("not json")'],
      5000,
    );
    expect(items).toEqual([]);
  });

  it("returns empty array for non-array JSON", async () => {
    const items = await runScript(
      "node",
      ["-e", 'process.stdout.write(JSON.stringify({key:"value"}))'],
      5000,
    );
    expect(items).toEqual([]);
  });

  it("returns empty array when command fails", async () => {
    const items = await runScript("false", [], 5000);
    expect(items).toEqual([]);
  });

  it("returns empty array when command does not exist", async () => {
    const items = await runScript("nonexistent-command-xyz", [], 5000);
    expect(items).toEqual([]);
  });

  it("fills in defaults for missing fields", async () => {
    const items = await runScript(
      "node",
      [
        "-e",
        'process.stdout.write(JSON.stringify([{summary:"Just a summary"}]))',
      ],
      5000,
    );

    expect(items).toHaveLength(1);
    expect(items[0].id).toMatch(/^[0-9a-f]{8}-item-0$/);
    expect(items[0].source).toBe("unknown");
    expect(items[0].type).toBe("unknown");
    expect(items[0].summary).toBe("Just a summary");
    expect(items[0].timestamp).toBeInstanceOf(Date);
  });

  it("handles multiple items", async () => {
    const data = JSON.stringify([
      { id: "a", source: "gmail", type: "email", summary: "Email 1" },
      { id: "b", source: "calendar", type: "event", summary: "Meeting" },
      { id: "c", source: "github", type: "alert", summary: "PR review" },
    ]);
    const items = await runScript(
      "node",
      ["-e", `process.stdout.write(${JSON.stringify(data)})`],
      5000,
    );

    expect(items).toHaveLength(3);
    expect(items[0].source).toBe("gmail");
    expect(items[1].source).toBe("calendar");
    expect(items[2].source).toBe("github");
  });

  it("skips malformed array elements instead of discarding the batch (P4-#8)", async () => {
    const data = JSON.stringify([
      { id: "a", source: "gmail", type: "email", summary: "ok" },
      null,
      42,
      ["nested"],
      { id: "b", source: "gmail", type: "email", summary: "also ok" },
    ]);
    const items = await runScript(
      "node",
      ["-e", `process.stdout.write(${JSON.stringify(data)})`],
      5000,
    );
    expect(items.map((i) => i.id)).toEqual(["a", "b"]);
  });

  it("preserves body and metadata when present", async () => {
    const data = JSON.stringify([
      {
        id: "e1",
        source: "gmail",
        type: "email",
        summary: "Subject line",
        body: "Full email body here",
        metadata: { threadId: "t123", labels: ["inbox"] },
      },
    ]);
    const items = await runScript(
      "node",
      ["-e", `process.stdout.write(${JSON.stringify(data)})`],
      5000,
    );

    expect(items[0].body).toBe("Full email body here");
    expect(items[0].metadata).toEqual({
      threadId: "t123",
      labels: ["inbox"],
    });
  });

  it("assigns unique default ids across two separate script invocations (audit F19)", async () => {
    const a = await runScript(
      "node",
      [
        "-e",
        'process.stdout.write(JSON.stringify([{summary:"A1"},{summary:"A2"}]))',
      ],
      5000,
    );
    const b = await runScript(
      "node",
      [
        "-e",
        'process.stdout.write(JSON.stringify([{summary:"B1"},{summary:"B2"}]))',
      ],
      5000,
    );

    const ids = [...a, ...b].map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("default ids from the same script invocation are deterministic across runs", async () => {
    const run = () =>
      runScript(
        "node",
        [
          "-e",
          'process.stdout.write(JSON.stringify([{summary:"A1"},{summary:"A2"}]))',
        ],
        5000,
      );

    const first = await run();
    const second = await run();
    expect(second.map((i) => i.id)).toEqual(first.map((i) => i.id));
  });

  it("keeps an explicit id unchanged even when a sibling item in the same batch gets a default id", async () => {
    const data = JSON.stringify([
      { id: "explicit-1", summary: "has id" },
      { summary: "no id" },
    ]);
    const items = await runScript(
      "node",
      ["-e", `process.stdout.write(${JSON.stringify(data)})`],
      5000,
    );

    expect(items[0].id).toBe("explicit-1");
    expect(items[1].id).not.toBe("explicit-1");
    expect(items[1].id).toMatch(/-item-1$/);
  });

  it("the same command and args in different cwds get different default-id prefixes (Seer finding on tickle-stick#245)", async () => {
    const sameArgs = [
      "-e",
      'process.stdout.write(JSON.stringify([{summary:"same script, different cwd"}]))',
    ];
    const inProjectDir = await runScript("node", sameArgs, 5000, process.cwd());
    const inTmpDir = await runScript("node", sameArgs, 5000, tmpdir());

    expect(inProjectDir[0].id).not.toBe(inTmpDir[0].id);
  });

  it("the same command, args, and cwd still get the same default-id prefix", async () => {
    const sameArgs = [
      "-e",
      'process.stdout.write(JSON.stringify([{summary:"same everything"}]))',
    ];
    const first = await runScript("node", sameArgs, 5000, process.cwd());
    const second = await runScript("node", sameArgs, 5000, process.cwd());

    expect(first[0].id).toBe(second[0].id);
  });
});

describe("runPipedScript", () => {
  it("round-trips JSON piped via stdin", async () => {
    const items = await runPipedScript(
      "node",
      [
        "-e",
        "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>process.stdout.write(d))",
      ],
      5000,
      JSON.stringify([
        { id: "x1", source: "s", type: "t", summary: "round trip" },
      ]),
    );
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("x1");
  });

  it("does not crash when the child exits before draining stdin (EPIPE guard)", async () => {
    // Child ignores stdin and exits immediately, closing the pipe's read
    // end. Writing a large payload to it must not raise an unhandled EPIPE
    // on the host process. Regression for audit finding P1-#1.
    const big = JSON.stringify(
      Array.from({ length: 5000 }, (_, i) => ({
        id: `i${i}`,
        summary: "x".repeat(200),
      })),
    );
    const items = await runPipedScript(
      "node",
      ["-e", "process.exit(0)"],
      5000,
      big,
    );
    expect(items).toEqual([]);
  });

  it("returns empty array when the piped command fails", async () => {
    const items = await runPipedScript("false", [], 5000, "[]");
    expect(items).toEqual([]);
  });

  // Audit finding F11, probe P7. stderr was piped but never read, so a child
  // writing more than the OS pipe buffer (typically 64 KiB) blocked forever
  // on write(2) and the stage deadlocked until its timeout. At the audit SHA
  // this returned 0 items after 4004ms against a 4000ms timeout.
  it("drains heavy stderr instead of deadlocking until the timeout", async () => {
    const script = [
      'const chunk = "e".repeat(64 * 1024);',
      "for (let i = 0; i < 32; i++) process.stderr.write(chunk);",
      "process.stdout.write(JSON.stringify([",
      '{ id: "a", source: "s", type: "t", summary: "one" },',
      '{ id: "b", source: "s", type: "t", summary: "two" },',
      "]));",
    ].join("\n");

    const errors: unknown[] = [];
    const started = Date.now();
    const items = await runPipedScript(
      "node",
      ["-e", script],
      4000,
      "[]",
      undefined,
      (err) => errors.push(err),
    );
    const elapsed = Date.now() - started;

    expect(items).toHaveLength(2);
    expect(items.map((i) => i.id)).toEqual(["a", "b"]);
    expect(errors).toEqual([]);
    // 2 MiB of stderr must not cost anything like the 4000ms timeout.
    expect(elapsed).toBeLessThan(1000);
  });

  it("escalates to SIGKILL and settles when the child ignores SIGTERM", async () => {
    // `trap '' TERM` makes the shell ignore SIGTERM outright, so the old
    // timeout handler's lone child.kill("SIGTERM") never produced a 'close'
    // event and the promise hung forever.
    const timeout = 300;
    const errors: unknown[] = [];
    const started = Date.now();
    const items = await runPipedScript(
      "sh",
      ["-c", "trap '' TERM; sleep 20"],
      timeout,
      "[]",
      undefined,
      (err) => errors.push(err),
    );
    const elapsed = Date.now() - started;

    // `errored` in StageResult is set by stage-router's reportError, i.e. by
    // onError firing at all — so a non-empty errors[] is exactly the stage
    // reporting errored: true.
    const errored = errors.length > 0;
    expect(errored).toBe(true);
    expect(items).toEqual([]);
    expect(String(errors[0])).toContain(`timed out after ${timeout}ms`);
    // Settles on the SIGKILL escalation, not on the child's 20s sleep.
    expect(elapsed).toBeGreaterThanOrEqual(timeout);
    expect(elapsed).toBeLessThan(timeout + SIGKILL_GRACE_MS + 3000);
  });

  it("quotes a bounded stderr tail in the failure message", async () => {
    const errors: unknown[] = [];
    const items = await runPipedScript(
      "sh",
      ["-c", "echo boom-from-stderr >&2; exit 3"],
      5000,
      "[]",
      undefined,
      (err) => errors.push(err),
    );

    expect(items).toEqual([]);
    expect(String(errors[0])).toContain("exited with code 3");
    expect(String(errors[0])).toContain("boom-from-stderr");
  });
});
