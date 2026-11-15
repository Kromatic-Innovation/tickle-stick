import { execFile } from "node:child_process";

/**
 * Execute a post-hook script with stage output piped via stdin as JSON.
 * Errors are propagated to the caller (pipeline handles them gracefully).
 */
export function runPostHook(
  command: string,
  args: string[],
  stdinData: string,
  timeout: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      command,
      args,
      { timeout, encoding: "utf-8", maxBuffer: 10 * 1024 * 1024 },
      (error) => {
        if (error) {
          // Node always passes a real Error here; ExecException's type merely
          // omits ErrnoException's `code`, so it is not typed as one.
          reject(error instanceof Error ? error : new Error(error.message));
        } else {
          resolve();
        }
      },
    );

    if (child.stdin) {
      // Silently drop EPIPE — child may have exited before we finish writing,
      // and the execFile callback above will reject with the real exit reason.
      child.stdin.on("error", () => {});
      child.stdin.write(stdinData);
      child.stdin.end();
    }
  });
}
