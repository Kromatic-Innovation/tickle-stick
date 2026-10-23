import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import type { WorkItem } from "./types.js";

/**
 * Execute a Tier 0 script and parse its JSON stdout as WorkItem[].
 * On any error (timeout, bad JSON, non-zero exit), returns [].
 */
export function runScript(
  command: string,
  args: string[],
  timeout: number,
  cwd?: string,
  onError?: (err: unknown) => void,
): Promise<WorkItem[]> {
  return new Promise((resolve) => {
    execFile(
      command,
      args,
      { timeout, cwd, encoding: "utf-8", maxBuffer: 10 * 1024 * 1024 },
      (error, stdout) => {
        if (error) {
          onError?.(error);
          resolve([]);
          return;
        }
        resolve(
          parseScriptOutput(stdout, scriptKey(command, args, cwd), onError),
        );
      },
    );
  });
}

/**
 * Grace period between the SIGTERM sent on timeout and the SIGKILL that
 * follows it. A child that installs a TERM handler (or `trap '' TERM`)
 * never exits on SIGTERM, so without an escalation the stage promise would
 * never settle. SIGKILL cannot be caught, blocked, or ignored.
 */
export const SIGKILL_GRACE_MS = 500;

/**
 * Cap on the child stderr retained for diagnostics. stderr is always drained
 * so a chatty child can never block on a full pipe buffer; only this much of
 * the tail is kept in memory to quote back in the error message.
 */
const STDERR_TAIL_LIMIT = 2000;

/**
 * Execute a script with JSON data piped to stdin.
 * Used for enrichment stages that transform filtered items.
 *
 * On any error (timeout, bad JSON, non-zero exit) this returns an empty
 * array and reports the error via `onError`; it does not echo the input
 * back. The caller (`stage-router`) treats an empty result as "no
 * enrichment happened" and leaves the original items untouched, which is
 * where the unchanged-items behaviour actually comes from.
 */
export function runPipedScript(
  command: string,
  args: string[],
  timeout: number,
  stdinData: string,
  cwd?: string,
  onError?: (err: unknown) => void,
): Promise<WorkItem[]> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      timeout,
    });

    let stdout = "";
    let stderrTail = "";
    let timedOut = false;
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let killTimer: ReturnType<typeof setTimeout> | undefined;

    const finish = (result: WorkItem[], err?: unknown): void => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      if (killTimer !== undefined) clearTimeout(killTimer);
      if (err !== undefined) onError?.(err);
      resolve(result);
    };

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf-8");
    });

    // Drain stderr. Without a reader the OS pipe buffer (typically 64 KiB)
    // fills and the child blocks forever on write(2), deadlocking the stage
    // until its timeout fires (audit finding F11). Only a bounded tail is
    // retained, to quote back in the error message.
    child.stderr.on("data", (chunk: Buffer) => {
      stderrTail = (stderrTail + chunk.toString("utf-8")).slice(
        -STDERR_TAIL_LIMIT,
      );
    });

    const withStderr = (message: string): string => {
      const tail = stderrTail.trim();
      return tail ? `${message}; stderr tail: ${tail}` : message;
    };
    const timeoutError = (): Error =>
      new Error(withStderr(`piped script timed out after ${timeout}ms`));

    timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      // A child that ignores SIGTERM would otherwise never emit 'close' and
      // the promise would hang forever. Escalate to SIGKILL, then settle
      // without waiting for 'close': an orphaned grandchild can keep the
      // stdio pipes open past the child's own death, which delays — or
      // prevents — that event.
      killTimer = setTimeout(() => {
        child.kill("SIGKILL");
        finish([], timeoutError());
        child.stdin.destroy();
        child.stdout.destroy();
        child.stderr.destroy();
      }, SIGKILL_GRACE_MS);
      killTimer.unref();
    }, timeout);

    child.on("close", (code) => {
      if (timedOut) {
        finish([], timeoutError());
        return;
      }
      if (code !== 0) {
        finish(
          [],
          new Error(withStderr(`piped script exited with code ${code}`)),
        );
        return;
      }
      finish(parseScriptOutput(stdout, scriptKey(command, args, cwd), onError));
    });

    child.on("error", (err) => {
      finish([], err);
    });

    // Silently drop stdin errors (e.g. EPIPE). A child that ignores stdin
    // and exits before we finish writing closes the pipe's read end; the
    // resulting 'error' event on child.stdin would otherwise be unhandled
    // and crash the host process. The close/error handlers above surface
    // the real exit reason. (Mirrors the guard in post-hook.ts.)
    child.stdin.on("error", () => {});
    child.stdin.write(stdinData);
    child.stdin.end();
  });
}

/**
 * Build a short, deterministic key identifying one script invocation, used
 * to prefix default item ids so that id-less items from different script
 * stages never collide (audit F19: two gather stages both defaulting to
 * `item-0` corrupted id-keyed dedupe/enrichment downstream).
 *
 * Derived from command + args + cwd rather than a caller-supplied stage
 * name: neither `runScript` nor `runPipedScript` currently receives the
 * pipeline stage name, and threading it through would require changing the
 * stage dispatcher that calls these functions. Keying on the invocation's
 * own identity keeps the fix fully contained in this module and is
 * deterministic across runs (same invocation always hashes the same way),
 * which matters because downstream consumers (voltaire, storage adapters)
 * may persist default ids across runs. `cwd` is included because two
 * gather stages commonly run the *same* script against *different* working
 * directories (e.g. two project checkouts); hashing only command+args would
 * make those collide exactly the way F19 describes (Seer finding on tickle-stick#245).
 * An absent `cwd` is normalized to a sentinel (`\u0001absent\u0001`) that
 * no real path can equal, rather than coerced to `""` or `"."`, so "no cwd"
 * is its own stable value and never collides with a stage that explicitly
 * sets `cwd: ""`. Two stages that invoke the exact same command with the
 * exact same args *and* the exact same cwd (including both omitting it)
 * would still collide; that case is not addressed here.
 */
function scriptKey(
  command: string,
  args: readonly string[],
  cwd: string | undefined,
): string {
  const cwdKey = cwd === undefined ? "\u0001absent\u0001" : cwd;
  return createHash("sha1")
    .update(command)
    .update("\u0000")
    .update(args.join("\u0000"))
    .update("\u0000")
    .update(cwdKey)
    .digest("hex")
    .slice(0, 8);
}

function parseScriptOutput(
  stdout: string,
  keyPrefix: string,
  onError?: (err: unknown) => void,
): WorkItem[] {
  const trimmed = stdout.trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!Array.isArray(parsed)) {
      onError?.(
        new Error("script output was valid JSON but not a WorkItem[] array"),
      );
      return [];
    }
    const items: WorkItem[] = [];
    parsed.forEach((raw: unknown, i: number) => {
      // Skip a malformed element (null / primitive / array) rather than
      // letting a property access on it throw and discard the whole batch.
      if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
        onError?.(
          new Error(`script output element ${i} is not a WorkItem object; skipped`),
        );
        return;
      }
      const item = raw as Record<string, unknown>;
      items.push({
        id: String(item.id ?? `${keyPrefix}-item-${i}`),
        source: String(item.source ?? "unknown"),
        type: String(item.type ?? "unknown"),
        summary: String(item.summary ?? ""),
        body: item.body != null ? String(item.body) : undefined,
        metadata:
          item.metadata != null
            ? (item.metadata as Record<string, unknown>)
            : undefined,
        timestamp: item.timestamp
          ? new Date(String(item.timestamp))
          : new Date(),
      });
    });
    return items;
  } catch (err) {
    onError?.(err);
    return [];
  }
}
