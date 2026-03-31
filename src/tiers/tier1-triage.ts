import type { WorkItem, ClassifiedItem, TriageProvider } from "../types.js";
import type { StageConfig } from "../config/schema.js";

export async function classifyItem(
  item: WorkItem,
  config: Pick<StageConfig, "systemPrompt" | "confidenceThreshold">,
  provider: TriageProvider,
): Promise<{
  classified: ClassifiedItem;
  costEstimate: number;
  latencyMs: number;
}> {
  const start = performance.now();

  if (!config.systemPrompt) {
    throw new Error("systemPrompt is required for classification");
  }

  // Build classification text with structured context (type, labels) so the
  // model can make label-aware decisions (e.g., skip planning for approved items).
  const parts: string[] = [];
  if (item.type) parts.push(`[type: ${item.type}]`);
  const labels = item.metadata?.labels;
  if (Array.isArray(labels) && labels.length > 0) {
    parts.push(`[labels: ${labels.join(", ")}]`);
  }
  if (item.metadata?.hasOwnerComment) {
    parts.push("[hasOwnerComment: true]");
  }
  parts.push(item.summary);
  if (item.body) parts.push(item.body);
  const text = parts.join("\n");

  const result = await provider.classify(text, config.systemPrompt);
  const latencyMs = performance.now() - start;

  let costEstimate = 0.001;
  if (result.tokenUsage) {
    costEstimate =
      result.tokenUsage.input * 0.00000025 +
      result.tokenUsage.output * 0.00000125;
  }

  // Below confidence threshold → escalate to reasoning
  const threshold = config.confidenceThreshold ?? 0.7;
  const classification =
    result.confidence < threshold
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
