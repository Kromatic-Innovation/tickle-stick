import { execFile } from "node:child_process";
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
): Promise<WorkItem[]> {
  return new Promise((resolve) => {
    execFile(
      command,
      args,
      { timeout, cwd, encoding: "utf-8", maxBuffer: 10 * 1024 * 1024 },
      (error, stdout) => {
        if (error) {
          resolve([]);
          return;
        }
        const trimmed = stdout.trim();
        if (!trimmed) {
          resolve([]);
          return;
        }
        try {
          const parsed = JSON.parse(trimmed) as unknown;
          if (!Array.isArray(parsed)) {
            resolve([]);
            return;
          }
          const items: WorkItem[] = parsed.map(
            (item: Record<string, unknown>, i: number) => ({
              id: String(item.id ?? `item-${i}`),
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
            }),
          );
          resolve(items);
        } catch {
          resolve([]);
        }
      },
    );
  });
}
