import type { WorkItem, ClassifiedItem, TriageProvider } from "../types.js";
import type { StageConfig } from "../config/schema.js";

/** Default per-token rates ($USD). Match Anthropic Haiku 3.5 / OpenAI 4o-mini. */
export const DEFAULT_COST_PER_INPUT_TOKEN = 0.00000025;
export const DEFAULT_COST_PER_OUTPUT_TOKEN = 0.00000125;
/** Default cost charged when the provider does not return tokenUsage. */
export const DEFAULT_COST_ESTIMATE = 0.001;

export async function classifyItem(
  item: WorkItem,
  config: Pick<
    StageConfig,
    | "systemPrompt"
    | "confidenceThreshold"
    | "costPerInputToken"
    | "costPerOutputToken"
    | "defaultCostEstimate"
  >,
  provider: TriageProvider,
): Promise<{
  classified: ClassifiedItem;
  costEstimate: number;
  latencyMs: number;
  tokensIn?: number;
  tokensOut?: number;
  provider?: string;
  model?: string;
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
  // Untrusted item text (summary/body) is fenced in its own delimited data
  // block so it reads as data, not instructions, to the model
  // (tickle-stick#247, AC3). The delimiter strings deliberately contain no
  // `{`/`}` characters: the only published-contract consumer of this exact
  // `text` (voltaire) locates its payload by scanning for the first `{` and
  // tracking brace depth, tolerating arbitrary leading/trailing context
  // around the JSON object (see voltaire's `extractEmailItemJson`). A
  // brace-free delimiter is therefore additive for every item, including
  // the `[type: email]\n{json}` shape, and does not change that contract.
  parts.push("--- begin item text (untrusted) ---");
  parts.push(item.summary);
  if (item.body) parts.push(item.body);
  parts.push("--- end item text (untrusted) ---");
  const text = parts.join("\n");

  const result = await provider.classify(text, config.systemPrompt);
  const latencyMs = performance.now() - start;

  const inputRate = config.costPerInputToken ?? DEFAULT_COST_PER_INPUT_TOKEN;
  const outputRate = config.costPerOutputToken ?? DEFAULT_COST_PER_OUTPUT_TOKEN;
  let costEstimate = config.defaultCostEstimate ?? DEFAULT_COST_ESTIMATE;
  if (result.tokenUsage) {
    costEstimate =
      result.tokenUsage.input * inputRate +
      result.tokenUsage.output * outputRate;
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

  return {
    classified,
    costEstimate,
    latencyMs,
    tokensIn: result.tokenUsage?.input,
    tokensOut: result.tokenUsage?.output,
    provider: result.provider,
    model: result.model,
  };
}
