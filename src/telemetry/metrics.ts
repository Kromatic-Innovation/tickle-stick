export interface TierMetrics {
  totalProcessed: number;
  tierDistribution: Record<number, number>;
  totalCost: number;
  averageLatencyMs: number;
}

interface MetricEntry {
  tier: number;
  costEstimate: number;
  latencyMs: number;
}

export class MetricsCollector {
  private entries: MetricEntry[] = [];

  record(entry: MetricEntry): void {
    this.entries.push(entry);
  }

  getMetrics(): TierMetrics {
    const totalProcessed = this.entries.length;
    if (totalProcessed === 0) {
      return {
        totalProcessed: 0,
        tierDistribution: {},
        totalCost: 0,
        averageLatencyMs: 0,
      };
    }

    const tierDistribution: Record<number, number> = {};
    let totalCost = 0;
    let totalLatency = 0;

    for (const entry of this.entries) {
      tierDistribution[entry.tier] = (tierDistribution[entry.tier] ?? 0) + 1;
      totalCost += entry.costEstimate;
      totalLatency += entry.latencyMs;
    }

    return {
      totalProcessed,
      tierDistribution,
      totalCost,
      averageLatencyMs: totalLatency / totalProcessed,
    };
  }

  reset(): void {
    this.entries = [];
  }
}
