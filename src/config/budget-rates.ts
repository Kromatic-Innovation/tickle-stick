/**
 * Explicit per-token rates are required whenever a budget is configured
 * (tickle-stick#248, operator ruling 2026-11-15: fail closed).
 *
 * A budget cap is only as accurate as the rates its spend is computed
 * from. The built-in fallback rates in `tiers/tier1-triage.ts` are rough
 * telemetry estimates that are not tied to any vendor's published price,
 * so letting a budget silently fall back to them makes the cap enforce at
 * an unknown multiple of the intended spend. Both entry points — the YAML
 * loader (via the schema) and `new Pipeline(...)` — call this one check,
 * so they cannot disagree.
 */

/** The two keys a cheap-model stage must set when a budget is configured. */
export const REQUIRED_BUDGET_RATE_KEYS = [
  "costPerInputToken",
  "costPerOutputToken",
] as const;

export type BudgetRateKey = (typeof REQUIRED_BUDGET_RATE_KEYS)[number];

/** Minimal stage shape this check reads (a subset of `StageConfig`). */
export interface BudgetRateStage {
  name: string;
  type: string;
  provider?: string;
  costPerInputToken?: number;
  costPerOutputToken?: number;
}

/**
 * Return the rate keys missing from a stage, or `[]` when the stage is
 * not a cheap-model stage (only cheap-model stages are costed from
 * per-token rates) or already sets both.
 */
export function missingBudgetRateKeys(stage: BudgetRateStage): BudgetRateKey[] {
  if (stage.type !== "model" || stage.provider !== "cheap") return [];
  return REQUIRED_BUDGET_RATE_KEYS.filter((key) => stage[key] === undefined);
}

/** The error message for a cheap-model stage missing rates under a budget. */
export function budgetRatesMissingMessage(
  pipelineName: string,
  stageName: string,
  missing: readonly BudgetRateKey[],
): string {
  return (
    `Pipeline "${pipelineName}" stage "${stageName}": a budget is configured, ` +
    `so cheap-model stages must set explicit per-token rates; missing ` +
    `${missing.map((k) => `"${k}"`).join(" and ")} (USD per token, e.g. ` +
    `costPerInputToken: 0.000001 for $1 per million input tokens)`
  );
}
