import type { BudgetConfig } from "../config/schema.js";
import type { TelemetryEvent } from "../telemetry/logger.js";
import type {
  AlertSink,
  BudgetAlert,
  BudgetStatus,
  StorageAdapter,
} from "../types.js";

export interface BudgetManagerOptions {
  config: BudgetConfig;
  storage?: StorageAdapter;
  alertSink?: AlertSink;
  /** IANA timezone for day/week boundaries. Default: "UTC". */
  timezone?: string;
}

interface ParsedAlert {
  type: "percentage" | "absolute";
  value: number;
}

/** Offset of `timeZone` from UTC at `instant`, in milliseconds (e.g. -4h for EDT). */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const f: Record<string, number> = {};
  for (const p of parts) {
    if (p.type !== "literal") f[p.type] = Number(p.value);
  }
  const asUtc = Date.UTC(f.year, f.month - 1, f.day, f.hour, f.minute, f.second);
  return asUtc - instant.getTime();
}

/**
 * The UTC instant (ISO 8601) corresponding to 00:00:00 *local* time on
 * `localDate` (a `YYYY-MM-DD` string) in `timeZone`. Resolving the zone
 * offset at that date keeps this DST-correct (except within the ~1h of a
 * transition, which budget windows tolerate).
 *
 * The day/week boundaries used to be hard-coded to `…T00:00:00.000Z`
 * (midnight *UTC*), so a non-UTC `timezone` produced windows skewed by the
 * zone offset — e.g. America/New_York counted spend from 20:00 the prior
 * local day. For `timeZone: "UTC"` this returns the identical
 * `…T00:00:00.000Z` value as before.
 */
export function startOfLocalDateUtc(
  localDate: string,
  timeZone: string,
): string {
  const utcMidnight = new Date(`${localDate}T00:00:00Z`);
  const offsetMs = zoneOffsetMs(utcMidnight, timeZone);
  return new Date(utcMidnight.getTime() - offsetMs).toISOString();
}

export class BudgetManager {
  private readonly config: BudgetConfig;
  private readonly storage: StorageAdapter | null;
  private readonly alertSink: AlertSink | null;
  private readonly timezone: string;
  private readonly parsedAlerts: ParsedAlert[];
  private exceeded = false;
  private alertsSent = new Set<string>();
  private currentDay = "";

  constructor(options: BudgetManagerOptions) {
    this.config = options.config;
    this.storage = options.storage ?? null;
    this.alertSink = options.alertSink ?? null;
    this.timezone = options.timezone ?? "UTC";
    this.parsedAlerts = this.config.alerts.map((a) => this.parseAlert(a.at));
  }

  private parseAlert(at: string | number): ParsedAlert {
    if (typeof at === "number") {
      return { type: "absolute", value: at };
    }
    if (at.endsWith("%")) {
      return { type: "percentage", value: parseFloat(at) / 100 };
    }
    return { type: "absolute", value: parseFloat(at) };
  }

  /** Record a triage event and check budget thresholds. */
  async record(event: TelemetryEvent): Promise<void> {
    if (this.storage) {
      await this.storage.writeEvent(event);
    }
    await this.checkBudget();
  }

  /** Whether the budget has been exceeded (synchronous, cached). */
  isBudgetExceeded(): boolean {
    return this.exceeded;
  }

  /** Query spend and check thresholds. Call after recording events. */
  async checkBudget(): Promise<void> {
    if (!this.storage) return;

    const today = this.getToday();

    // Reset alert dedup on new day; also auto-prune retention-expired events.
    // Fires on first checkBudget() and on each subsequent day rollover. The
    // manual escape hatch (pipeline.pruneBudgetEvents()) is still available.
    if (today !== this.currentDay) {
      this.alertsSent.clear();
      this.currentDay = today;
      this.exceeded = false;
      this.prune().catch(() => {
        /* best-effort retention enforcement; do not block budget checks */
      });
    }

    const dayStart = this.getDayStart();
    const weekStart = this.getWeekStart();

    const dailySpend = await this.storage.getSpendSince(dayStart);
    const weeklySpend = await this.storage.getSpendSince(weekStart);

    // Check caps
    if (this.config.maxDailySpend && dailySpend >= this.config.maxDailySpend) {
      this.exceeded = true;
      await this.fireAlert({
        type: "cap",
        level: "daily",
        currentSpend: dailySpend,
        limit: this.config.maxDailySpend,
        percentage: (dailySpend / this.config.maxDailySpend) * 100,
        message: `Daily triage budget exceeded ($${dailySpend.toFixed(2)}/$${this.config.maxDailySpend.toFixed(2)}). Tier 1 disabled, Tier 0 only.`,
      });
    }

    if (
      this.config.maxWeeklySpend &&
      weeklySpend >= this.config.maxWeeklySpend
    ) {
      this.exceeded = true;
      await this.fireAlert({
        type: "cap",
        level: "weekly",
        currentSpend: weeklySpend,
        limit: this.config.maxWeeklySpend,
        percentage: (weeklySpend / this.config.maxWeeklySpend) * 100,
        message: `Weekly triage budget exceeded ($${weeklySpend.toFixed(2)}/$${this.config.maxWeeklySpend.toFixed(2)}). Tier 1 disabled, Tier 0 only.`,
      });
    }

    // Check alert thresholds
    for (const alert of this.parsedAlerts) {
      if (this.config.maxDailySpend) {
        const threshold =
          alert.type === "percentage"
            ? alert.value * this.config.maxDailySpend
            : alert.value;
        const pct = (dailySpend / this.config.maxDailySpend) * 100;
        const key = `daily:${alert.type === "percentage" ? `${(alert.value * 100).toFixed(0)}%` : `$${alert.value}`}`;
        if (dailySpend >= threshold && !this.alertsSent.has(key)) {
          await this.fireAlert({
            type: "threshold",
            level: "daily",
            currentSpend: dailySpend,
            limit: this.config.maxDailySpend,
            percentage: pct,
            message: `Triage spend today: $${dailySpend.toFixed(2)} (${pct.toFixed(0)}% of $${this.config.maxDailySpend.toFixed(2)} daily limit)`,
          });
          this.alertsSent.add(key);
        }
      }

      if (this.config.maxWeeklySpend) {
        const threshold =
          alert.type === "percentage"
            ? alert.value * this.config.maxWeeklySpend
            : alert.value;
        const pct = (weeklySpend / this.config.maxWeeklySpend) * 100;
        const key = `weekly:${alert.type === "percentage" ? `${(alert.value * 100).toFixed(0)}%` : `$${alert.value}`}`;
        if (weeklySpend >= threshold && !this.alertsSent.has(key)) {
          await this.fireAlert({
            type: "threshold",
            level: "weekly",
            currentSpend: weeklySpend,
            limit: this.config.maxWeeklySpend,
            percentage: pct,
            message: `Triage spend this week: $${weeklySpend.toFixed(2)} (${pct.toFixed(0)}% of $${this.config.maxWeeklySpend.toFixed(2)} weekly limit)`,
          });
          this.alertsSent.add(key);
        }
      }
    }
  }

  /** Return a snapshot of current budget state. */
  async getBudgetStatus(): Promise<BudgetStatus> {
    const dailySpend = this.storage
      ? await this.storage.getSpendSince(this.getDayStart())
      : 0;
    const weeklySpend = this.storage
      ? await this.storage.getSpendSince(this.getWeekStart())
      : 0;
    return {
      dailySpend,
      weeklySpend,
      maxDailySpend: this.config.maxDailySpend ?? null,
      maxWeeklySpend: this.config.maxWeeklySpend ?? null,
      exceeded: this.exceeded,
    };
  }

  /** Delete events older than retentionDays. */
  async prune(): Promise<number> {
    if (!this.storage) return 0;
    const cutoff = new Date(
      Date.now() - this.config.retentionDays * 86400000,
    ).toISOString();
    return this.storage.prune(cutoff);
  }

  private async fireAlert(alert: BudgetAlert): Promise<void> {
    const key = `${alert.level}:${alert.type}`;
    if (alert.type === "cap" && this.alertsSent.has(key)) return;
    if (alert.type === "cap") this.alertsSent.add(key);

    if (this.alertSink) {
      await this.alertSink(alert);
    }
  }

  private getToday(): string {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: this.timezone,
    }).format(new Date());
  }

  private getDayStart(): string {
    return startOfLocalDateUtc(this.getToday(), this.timezone);
  }

  private getWeekStart(): string {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: this.timezone,
      weekday: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const parts = formatter.formatToParts(now);
    const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
    const dayOffsets: Record<string, number> = {
      Mon: 0,
      Tue: 1,
      Wed: 2,
      Thu: 3,
      Fri: 4,
      Sat: 5,
      Sun: 6,
    };
    const offset = dayOffsets[weekday] ?? 0;
    const monday = new Date(now.getTime() - offset * 86400000);
    const mondayStr = new Intl.DateTimeFormat("en-CA", {
      timeZone: this.timezone,
    }).format(monday);
    return startOfLocalDateUtc(mondayStr, this.timezone);
  }

  /** Visible for testing. */
  _resetAlerts(): void {
    this.alertsSent.clear();
    this.exceeded = false;
    this.currentDay = "";
  }
}
