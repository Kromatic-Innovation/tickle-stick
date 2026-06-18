import { execFile, spawn } from "node:child_process";
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
        resolve(parseScriptOutput(stdout, onError));
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
      resolve(parseScriptOutput(stdout, onError));
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

function parseScriptOutput(
  stdout: string,
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
    return parsed.map((item: Record<string, unknown>, i: number) => ({
      id: String(item.id ?? `item-${i}`),
      source: String(item.source ?? "unknown"),
      type: String(item.type ?? "unknown"),
      summary: String(item.summary ?? ""),
      body: item.body != null ? String(item.body) : undefined,
      metadata:
        item.metadata != null
          ? (item.metadata as Record<string, unknown>)
          : undefined,
      timestamp: item.timestamp ? new Date(String(item.timestamp)) : new Date(),
    }));
  } catch (err) {
    onError?.(err);
    return [];
  }
}
