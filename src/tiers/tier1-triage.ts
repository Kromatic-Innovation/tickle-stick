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
  failureReason?: string;
  /**
   * "estimated" whenever `costEstimate` is a tickle-stick-computed dollar
   * amount — whether derived from the provider's reported token usage
   * (rates × tokens) or the flat `DEFAULT_COST_ESTIMATE` fallback. Neither
   * is a provider-billed amount, so downstream readers that reprice from
   * `cwc/docs/model-pricing.json` need every computed dollar labelled,
   * not just the flat-rate one (tickle-stick#254, AC3). Left `undefined`
   * for the zero-cost `failureReason` case: nothing was computed, so
   * there is no basis to report.
   */
  costBasis?: "estimated";
  /**
   * Which cost path actually fired — distinct from `costBasis`, which is
   * "estimated" for both paths. `stage-router.ts` uses this (not
   * `costBasis`) to decide whether to attach the
   * `metadata: { reason: "default-cost-estimate" }` visible-reason note
   * (tickle-stick#254, AC4): once `costBasis` stopped discriminating
   * between the two paths, something else had to.
   */
  costSource?: "token-usage" | "default-estimate";
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

  const inputRate = config.costPerInputToken ?? DEFAULT_COST_PER_INPUT_TOKEN;
  const outputRate = config.costPerOutputToken ?? DEFAULT_COST_PER_OUTPUT_TOKEN;
  // A result carrying failureReason means the call itself failed (see
  // HttpTriageProvider.classify, tickle-stick#239) rather than the model
  // genuinely returning low-confidence output — charge zero cost instead of
  // falling back to DEFAULT_COST_ESTIMATE for work that produced nothing.
  let costEstimate = 0;
  let costBasis: "estimated" | undefined;
  let costSource: "token-usage" | "default-estimate" | undefined;
  if (result.tokenUsage) {
    costEstimate =
      result.tokenUsage.input * inputRate +
      result.tokenUsage.output * outputRate;
    costBasis = "estimated";
    costSource = "token-usage";
  } else if (!result.failureReason) {
    costEstimate = config.defaultCostEstimate ?? DEFAULT_COST_ESTIMATE;
    costBasis = "estimated";
    costSource = "default-estimate";
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
    failureReason: result.failureReason,
    costBasis,
    costSource,
  };
}
