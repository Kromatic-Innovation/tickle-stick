import type { WorkItem, ClassifiedItem, TriageProvider } from "../types.js";
import type { StageConfig } from "../config/schema.js";

/** Default per-token rates ($USD). Match Anthropic Haiku 3.5 / OpenAI 4o-mini. */
export const DEFAULT_COST_PER_INPUT_TOKEN = 0.00000025;
export const DEFAULT_COST_PER_OUTPUT_TOKEN = 0.00000125;
/** Default cost charged when the provider does not return tokenUsage. */
export const DEFAULT_COST_ESTIMATE = 0.001;

// Untrusted item text (summary/body) is fenced in its own delimited data
// block in the prompt so it reads as data, not instructions, to the model
// (tickle-stick#247, AC3). The markers deliberately contain no `{`/`}`
// characters: the only published-contract consumer of the exact `text`
// built below (voltaire) locates its payload by scanning for the first `{`
// and tracking brace depth, tolerating arbitrary leading/trailing context
// around the JSON object (see voltaire's `extractEmailItemJson`). A
// brace-free fence is therefore additive for every item, including the
// `[type: email]\n{json}` shape, and does not change that contract.
const ITEM_TEXT_FENCE_START = "--- begin item text (untrusted) ---";
const ITEM_TEXT_FENCE_END = "--- end item text (untrusted) ---";
/**
 * A literal occurrence of either fence marker INSIDE the untrusted text
 * itself would close (or forge) the fence early (tickle-stick#247, Finding
 * 2) -- a fence a payload can close is not a "clearly delimited data
 * block." Both markers are neutralised via a deterministic string
 * substitution (not a per-request nonce, so the prompt stays stable
 * run-to-run for testing/caching) before the text is embedded. The
 * replacement is brace-free, preserving the fence's own brace-free
 * property.
 */
const NEUTRALIZED_FENCE_MARKER = "[fence marker removed]";

function sanitizeForFence(s: string): string {
  return s
    .split(ITEM_TEXT_FENCE_START)
    .join(NEUTRALIZED_FENCE_MARKER)
    .split(ITEM_TEXT_FENCE_END)
    .join(NEUTRALIZED_FENCE_MARKER);
}

/**
 * True when `text` mentions urgency anywhere. Deliberately simple and
 * deliberately conservative (favors escalation over a silent drop).
 */
function mentionsUrgent(text: string): boolean {
  return /\burgent\b/i.test(text);
}

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
  parts.push(ITEM_TEXT_FENCE_START);
  parts.push(sanitizeForFence(item.summary));
  if (item.body) parts.push(sanitizeForFence(item.body));
  parts.push(ITEM_TEXT_FENCE_END);
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
  if (result.tokenUsage) {
    costEstimate =
      result.tokenUsage.input * inputRate +
      result.tokenUsage.output * outputRate;
  } else if (!result.failureReason) {
    costEstimate = config.defaultCostEstimate ?? DEFAULT_COST_ESTIMATE;
  }

  // Below confidence threshold → escalate to reasoning
  const threshold = config.confidenceThreshold ?? 0.7;
  let classification =
    result.confidence < threshold
      ? ("needs-reasoning" as const)
      : result.classification;

  // Non-skippable safety net (tickle-stick#247, AC4): the urgency signal
  // must come from the INPUT item text, not the model's output. The
  // model's response is exactly what a successful prompt injection
  // controls, so a guard that inspected the response (an earlier revision
  // of this guard did) is defeated by a compliant model that returns only
  // `{"classification":"routine","confidence":1}` with no echo of the
  // injected text at all -- precisely the Motivation scenario this issue
  // names. Checking the item's OWN summary/body instead means this cannot
  // be bypassed by anything the model says. Applied strictly after the
  // confidence-threshold decision above, and only ever escalates (never
  // downgrades): if the item's own text mentions urgency and the model
  // still said "routine", force needs-reasoning regardless of confidence.
  //
  // Trade-off, stated plainly: an item whose own text contains the word
  // "urgent" now always reaches the expensive tier even when the model
  // genuinely says "routine" -- e.g. ordinary marketing mail that merely
  // uses the word costs more. That is the intended, deliberately
  // conservative direction (fail toward reasoning, never toward a silent
  // drop), and is this PR's chosen mechanism for AC4's "non-skippable
  // path." No config key is provided to opt out (out of scope).
  if (
    classification === "routine" &&
    mentionsUrgent(item.summary + "\n" + (item.body ?? ""))
  ) {
    classification = "needs-reasoning";
  }

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
  };
}
