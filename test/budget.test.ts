import { describe, it, expect, vi, beforeEach } from "vitest";
import { BudgetManager } from "../src/budget/budget-manager.js";
import type { BudgetConfig } from "../src/config/schema.js";
import type { TelemetryEvent } from "../src/telemetry/logger.js";
import type { StorageAdapter, BudgetAlert } from "../src/types.js";

function makeEvent(cost = 0.001): TelemetryEvent {
  return {
    event: "tickle_stick.pipeline",
    pipeline: "test",
    tier: 1,
    action: "routine",
    latencyMs: 50,
    costEstimate: cost,
    timestamp: new Date().toISOString(),
  };
}

function makeStorage(): StorageAdapter & { events: TelemetryEvent[] } {
  const events: TelemetryEvent[] = [];
  return {
    events,
    writeEvent: vi.fn((event: TelemetryEvent) => {
      events.push(event);
    }),
    getSpendSince: vi.fn((since: string) => {
      return events
        .filter((e) => e.timestamp >= since)
        .reduce((sum, e) => sum + e.costEstimate, 0);
    }),
    prune: vi.fn((before: string) => {
      const initial = events.length;
      const remaining = events.filter((e) => e.timestamp >= before);
      events.length = 0;
      events.push(...remaining);
      return initial - events.length;
    }),
  };
}

function makeConfig(overrides: Partial<BudgetConfig> = {}): BudgetConfig {
  return {
    alerts: [],
    retentionDays: 30,
    ...overrides,
  };
}

describe("BudgetManager", () => {
  let storage: ReturnType<typeof makeStorage>;
  let alertSink: ReturnType<typeof vi.fn<[BudgetAlert], void>>;

  beforeEach(() => {
    storage = makeStorage();
    alertSink = vi.fn();
  });

  it("starts with budget not exceeded", () => {
    const mgr = new BudgetManager({
      config: makeConfig({ maxDailySpend: 1.0 }),
      storage,
    });
    expect(mgr.isBudgetExceeded()).toBe(false);
  });

  it("marks budget exceeded when daily limit is reached", async () => {
    const mgr = new BudgetManager({
      config: makeConfig({ maxDailySpend: 0.01 }),
      storage,
      alertSink,
    });

    await mgr.record(makeEvent(0.005));
    expect(mgr.isBudgetExceeded()).toBe(false);

    await mgr.record(makeEvent(0.006));
    expect(mgr.isBudgetExceeded()).toBe(true);
  });

  it("marks budget exceeded when weekly limit is reached", async () => {
    const mgr = new BudgetManager({
      config: makeConfig({ maxWeeklySpend: 0.01 }),
      storage,
      alertSink,
    });

    await mgr.record(makeEvent(0.005));
    expect(mgr.isBudgetExceeded()).toBe(false);

    await mgr.record(makeEvent(0.006));
    expect(mgr.isBudgetExceeded()).toBe(true);
  });

  it("fires cap alert when daily limit exceeded", async () => {
    const mgr = new BudgetManager({
      config: makeConfig({ maxDailySpend: 0.01 }),
      storage,
      alertSink,
    });

    await mgr.record(makeEvent(0.02));

    expect(alertSink).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "cap",
        level: "daily",
      }),
    );
  });

  it("fires threshold alert at configured percentage", async () => {
    const mgr = new BudgetManager({
      config: makeConfig({
        maxDailySpend: 1.0,
        alerts: [{ at: "50%" }],
      }),
      storage,
      alertSink,
    });

    await mgr.record(makeEvent(0.3));
    expect(alertSink).not.toHaveBeenCalled();

    await mgr.record(makeEvent(0.3));
    expect(alertSink).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "threshold",
        level: "daily",
      }),
    );
  });

  it("fires threshold alert at configured absolute amount", async () => {
    const mgr = new BudgetManager({
      config: makeConfig({
        maxDailySpend: 1.0,
        alerts: [{ at: 0.5 }],
      }),
      storage,
      alertSink,
    });

    await mgr.record(makeEvent(0.3));
    expect(alertSink).not.toHaveBeenCalled();

    await mgr.record(makeEvent(0.3));
    expect(alertSink).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "threshold",
        level: "daily",
        currentSpend: expect.closeTo(0.6, 2),
      }),
    );
  });

  it("deduplicates threshold alerts (fires only once)", async () => {
    const mgr = new BudgetManager({
      config: makeConfig({
        maxDailySpend: 1.0,
        alerts: [{ at: "50%" }],
      }),
      storage,
      alertSink,
    });

    await mgr.record(makeEvent(0.6));
    await mgr.record(makeEvent(0.1));

    const thresholdCalls = alertSink.mock.calls.filter(
      ([a]: [BudgetAlert]) => a.type === "threshold",
    );
    expect(thresholdCalls.length).toBe(1);
  });

  it("deduplicates cap alerts", async () => {
    const mgr = new BudgetManager({
      config: makeConfig({ maxDailySpend: 0.01 }),
      storage,
      alertSink,
    });

    await mgr.record(makeEvent(0.02));
    await mgr.record(makeEvent(0.02));

    const capCalls = alertSink.mock.calls.filter(
      ([a]: [BudgetAlert]) => a.type === "cap",
    );
    expect(capCalls.length).toBe(1);
  });

  it("works without storage (no persistence, no budget enforcement)", async () => {
    const mgr = new BudgetManager({
      config: makeConfig({ maxDailySpend: 0.01 }),
    });

    await mgr.record(makeEvent(1.0));
    expect(mgr.isBudgetExceeded()).toBe(false);
  });

  it("works without alertSink (no alerts fired)", async () => {
    const mgr = new BudgetManager({
      config: makeConfig({ maxDailySpend: 0.01 }),
      storage,
    });

    await mgr.record(makeEvent(0.02));
    expect(mgr.isBudgetExceeded()).toBe(true);
  });

  it("prunes old events from storage", async () => {
    const mgr = new BudgetManager({
      config: makeConfig({ retentionDays: 1 }),
      storage,
    });

    const old = makeEvent(0.01);
    old.timestamp = new Date(Date.now() - 2 * 86400000).toISOString();
    storage.events.push(old);
    storage.events.push(makeEvent(0.01));

    const pruned = await mgr.prune();
    expect(pruned).toBe(1);
    expect(storage.events.length).toBe(1);
  });

  it("auto-prunes on first checkBudget and on day rollover (L8)", async () => {
    const mgr = new BudgetManager({
      config: makeConfig({ retentionDays: 1 }),
      storage,
    });

    const old = makeEvent(0.01);
    old.timestamp = new Date(Date.now() - 2 * 86400000).toISOString();
    storage.events.push(old);

    await mgr.record(makeEvent(0.01));
    // Allow the best-effort prune microtask to settle
    await new Promise((r) => setTimeout(r, 0));

    expect(storage.prune).toHaveBeenCalledTimes(1);

    // Same-day record() should NOT trigger another prune
    await mgr.record(makeEvent(0.01));
    await new Promise((r) => setTimeout(r, 0));
    expect(storage.prune).toHaveBeenCalledTimes(1);

    // Day rollover via test helper → next record() triggers prune again
    mgr._resetAlerts();
    await mgr.record(makeEvent(0.01));
    await new Promise((r) => setTimeout(r, 0));
    expect(storage.prune).toHaveBeenCalledTimes(2);
  });

  it("resets alerts on new day", async () => {
    const mgr = new BudgetManager({
      config: makeConfig({
        maxDailySpend: 0.01,
        alerts: [{ at: "50%" }],
      }),
      storage,
      alertSink,
    });

    await mgr.record(makeEvent(0.02));
    const callsBefore = alertSink.mock.calls.length;

    mgr._resetAlerts();

    await mgr.record(makeEvent(0.02));
    expect(alertSink.mock.calls.length).toBeGreaterThan(callsBefore);
  });

  it("getBudgetStatus returns current spend and limits", async () => {
    const mgr = new BudgetManager({
      config: makeConfig({ maxDailySpend: 1.0, maxWeeklySpend: 5.0 }),
      storage,
    });

    await mgr.record(makeEvent(0.1));
    await mgr.record(makeEvent(0.2));

    const status = await mgr.getBudgetStatus();
    expect(status.dailySpend).toBeCloseTo(0.3, 2);
    expect(status.weeklySpend).toBeCloseTo(0.3, 2);
    expect(status.maxDailySpend).toBe(1.0);
    expect(status.maxWeeklySpend).toBe(5.0);
    expect(status.exceeded).toBe(false);
  });

  it("getBudgetStatus reflects exceeded state", async () => {
    const mgr = new BudgetManager({
      config: makeConfig({ maxDailySpend: 0.01 }),
      storage,
    });

    await mgr.record(makeEvent(0.02));

    const status = await mgr.getBudgetStatus();
    expect(status.exceeded).toBe(true);
    expect(status.maxWeeklySpend).toBeNull();
  });

  it("getBudgetStatus returns zeros without storage", async () => {
    const mgr = new BudgetManager({
      config: makeConfig({ maxDailySpend: 1.0 }),
    });

    const status = await mgr.getBudgetStatus();
    expect(status.dailySpend).toBe(0);
    expect(status.weeklySpend).toBe(0);
    expect(status.exceeded).toBe(false);
  });

  it("includes readable message in alert", async () => {
    const mgr = new BudgetManager({
      config: makeConfig({ maxDailySpend: 1.0 }),
      storage,
      alertSink,
    });

    await mgr.record(makeEvent(1.5));

    const alert = alertSink.mock.calls[0][0] as BudgetAlert;
    expect(alert.message).toContain("Daily triage budget exceeded");
    expect(alert.message).toContain("$1.00");
  });
});
