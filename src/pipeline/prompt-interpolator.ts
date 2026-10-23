import type { ClassifiedItem, WorkItem } from "../types.js";
import { applyInputFilter, type PipelineContext } from "./context.js";

function projectItem(item: WorkItem | ClassifiedItem): Record<string, unknown> {
  const base = {
    id: item.id,
    source: item.source,
    type: item.type,
    summary: item.summary,
    body: item.body,
    metadata: item.metadata,
  };
  if ("classification" in item) {
    return {
      ...base,
      classification: item.classification,
      confidence: item.confidence,
    };
  }
  return base;
}

/**
 * Render a stage prompt template with item context.
 *
 * Substitutes `{{items}}` with the JSON projection of the items the
 * stage was invoked on, and `{{all_items}}` with the JSON projection
 * of every item currently in the pipeline context. Both projections
 * include classification and confidence on items that have been
 * classified.
 */
export function interpolatePrompt(
  template: string,
  items: (WorkItem | ClassifiedItem)[],
  context: PipelineContext,
): string {
  const itemsJson = JSON.stringify(items.map(projectItem), null, 2);
  const allItems = applyInputFilter("all", context);
  const allItemsJson = JSON.stringify(allItems.map(projectItem), null, 2);

  // Single pass over a regex matching only the known placeholders, with a
  // replacement callback. This must NOT be two chained replaceAll calls:
  // running them sequentially re-scans the text inserted by the first
  // replacement for the second placeholder, so an item whose own text
  // contains the literal "{{items}}" or "{{all_items}}" would have that
  // literal text expanded a second time once it's spliced into the
  // template. One pass over the *original* template means text injected
  // for a placeholder is never itself re-scanned for placeholders.
  // Unknown placeholders are left untouched because the regex only matches
  // these two names. The callback form (not a `$`-pattern string) avoids
  // `$`-pattern interpretation of the JSON payloads, which can legitimately
  // contain `$`.
  return template.replace(/\{\{(all_items|items)\}\}/g, (_match, name: string) =>
    name === "all_items" ? allItemsJson : itemsJson,
  );
}
