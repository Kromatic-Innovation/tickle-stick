import type { TierResult } from "../types.js";

export interface TierMetrics {
  totalProcessed: number;
  tierDistribution: Record<number, number>;
  totalCost: number;
  averageLatencyMs: number;
  costSaved: number;
}

const FULL_AGENT_COST = 0.15;

export class MetricsCollector {
  private results: TierResult[] = [];

  record(result: TierResult): void {
    this.results.push(result);
  }

  getMetrics(): TierMetrics {
    const totalProcessed = this.results.length;
    if (totalProcessed === 0) {
      return {
        totalProcessed: 0,
        tierDistribution: {},
        totalCost: 0,
        averageLatencyMs: 0,
        costSaved: 0,
      };
    }

    const tierDistribution: Record<number, number> = {};
    let totalCost = 0;
    let totalLatency = 0;

    for (const result of this.results) {
      tierDistribution[result.tier] = (tierDistribution[result.tier] ?? 0) + 1;
      totalCost += result.costEstimate;
      totalLatency += result.latencyMs;
    }

    const costWithoutTickleStick = totalProcessed * FULL_AGENT_COST;
    const costSaved = costWithoutTickleStick - totalCost;

    return {
      totalProcessed,
      tierDistribution,
      totalCost,
      averageLatencyMs: totalLatency / totalProcessed,
      costSaved,
    };
  }

  reset(): void {
    this.results = [];
  }
}
