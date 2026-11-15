import type { ClassifiedItem, WorkItem } from "../types.js";

/** Accumulated state across pipeline stages. */
export interface PipelineContext {
  /** All work items from script stages. */
  allItems: WorkItem[];
  /** All classified items from cheap model stages. */
  classified: ClassifiedItem[];
  /** Text outputs from expensive model and callback stages, keyed by stage name. */
  stageOutputs: Map<string, string>;
}

/**
 * Resolve a stage's input filter into the items it should receive.
 *
 * Behavior:
 * - `undefined` or `"all"` — returns every item, with classified items
 *   replacing their raw counterparts so a downstream stage sees the
 *   richest version of each id.
 * - `"classified:<value>(,classified:<value>)*"` — returns only the
 *   classified items whose `classification` matches one of the listed
 *   values. The Zod schema validates the syntax up-front
 *   (`StageConfig.input` refinement); this function trusts it.
 *
 * Note: the schema validation enforces that all tokens use the
 * `classified:` prefix. The legacy "unknown filter → all items"
 * fallback at the end of this function is therefore unreachable for any
 * config loaded through `loadConfig`/`tickleStickConfigSchema`. It is
 * still reachable for a `PipelineConfigEntry` constructed in code and
 * handed straight to `new Pipeline(...)` (that path does not re-parse the
 * schema), so it is kept, and marked, rather than removed
 * (tickle-stick#251 F15).
 */
export function applyInputFilter(
  filter: string | undefined,
  context: PipelineContext,
): (WorkItem | ClassifiedItem)[] {
  if (!filter || filter === "all") {
    const classifiedIds = new Set(context.classified.map((c) => c.id));
    const unclassified = context.allItems.filter(
      (i) => !classifiedIds.has(i.id),
    );
    return [...unclassified, ...context.classified];
  }

  const classifications = filter
    .split(",")
    .map((f) => f.trim())
    .filter((f) => f.startsWith("classified:"))
    .map((f) => f.slice("classified:".length));

  if (classifications.length > 0) {
    return context.classified.filter((c) =>
      classifications.includes(c.classification),
    );
  }

  // Reachable only for an unvalidated, programmatically built config; see
  // the docblock above.
  return [...context.allItems, ...context.classified];
}
