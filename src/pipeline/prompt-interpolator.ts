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

  // replaceAll (not replace) so templates may reference a placeholder more
  // than once; function replacements avoid `$`-pattern interpretation of the
  // JSON payloads (which can legitimately contain `$`).
  return template
    .replaceAll("{{all_items}}", () => allItemsJson)
    .replaceAll("{{items}}", () => itemsJson);
}
