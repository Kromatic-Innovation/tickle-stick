import type { WorkItem, ClassifiedItem, TriageProvider } from "../types.js";
import type { Tier1Config } from "../config/schema.js";

export async function classifyItem(
  item: WorkItem,
  config: Tier1Config,
  provider: TriageProvider,
): Promise<{
  classified: ClassifiedItem;
  costEstimate: number;
  latencyMs: number;
}> {
  const start = performance.now();
  const text = item.body ? `${item.summary}\n\n${item.body}` : item.summary;

  const result = await provider.classify(text, config.systemPrompt);
  const latencyMs = performance.now() - start;

  let costEstimate = 0.001;
  if (result.tokenUsage) {
    costEstimate =
      result.tokenUsage.input * 0.00000025 +
      result.tokenUsage.output * 0.00000125;
  }

  // Below confidence threshold → escalate to reasoning
  const classification =
    result.confidence < config.confidenceThreshold
      ? ("needs-reasoning" as const)
      : result.classification;

  const classified: ClassifiedItem = {
    ...item,
    classification,
    confidence: result.confidence,
    tier1Response: result.response,
  };

  return { classified, costEstimate, latencyMs };
}
