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
        resolve(parseScriptOutput(stdout, scriptKey(command, args), onError));
      },
    );
  });
}

/**
 * Execute a script with JSON data piped to stdin.
 * Used for enrichment stages that transform filtered items.
 * On any error, returns the original items unchanged.
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
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeout);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf-8");
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        onError?.(new Error(`piped script timed out after ${timeout}ms`));
        resolve([]);
        return;
      }
      if (code !== 0) {
        onError?.(new Error(`piped script exited with code ${code}`));
        resolve([]);
        return;
      }
      resolve(parseScriptOutput(stdout, scriptKey(command, args), onError));
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      onError?.(err);
      resolve([]);
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
 * Derived from the command + args rather than a caller-supplied stage name:
 * neither `runScript` nor `runPipedScript` currently receives the pipeline
 * stage name, and threading it through would require changing the stage
 * dispatcher that calls these functions. Keying on command+args keeps the
 * fix fully contained in this module and is deterministic across runs (same
 * invocation always hashes the same way), which matters because downstream
 * consumers (voltaire, storage adapters) may persist default ids across
 * runs. Two stages that invoke the exact same command with the exact same
 * args would still collide; that case is not addressed here.
 */
function scriptKey(command: string, args: readonly string[]): string {
  return createHash("sha1")
    .update(command)
    .update("\u0000")
    .update(args.join("\u0000"))
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
