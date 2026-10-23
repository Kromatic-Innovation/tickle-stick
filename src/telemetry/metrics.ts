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
  granularity: "call" | "stage";
}

export class MetricsCollector {
  private entries: MetricEntry[] = [];

  /**
   * Only "call"-granularity (per-item) entries are retained. A "stage"
   * entry is the pipeline's own per-stage rollup (gather/model/callback
   * stage completion, or a budget skip) — counting it here is what made
   * `totalProcessed` exceed the real item count and `totalCost` double the
   * recorded spend (tickle-stick#254). Per-item events are now the sole
   * source for every metric this collector reports.
   */
  record(entry: MetricEntry): void {
    if (entry.granularity !== "call") return;
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
