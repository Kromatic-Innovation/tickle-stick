import { describe, it, expect } from "vitest";
import { runScript, runPipedScript } from "../src/script-runner.js";

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
    expect(items[0].id).toBe("item-0");
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
});
