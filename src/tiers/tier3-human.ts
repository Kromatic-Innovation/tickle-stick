import type { InboundMessage, TierResult } from "../types.js";
import type { Tier3Config, EscalationRoute } from "../config/schema.js";

async function sendWebhook(
  route: EscalationRoute,
  message: InboundMessage,
): Promise<void> {
  const url = route.url;
  if (!url) throw new Error("Webhook route missing url");

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      event: "tickle_stick.escalation",
      messageId: message.id,
      channel: message.channel,
      from: message.from,
      subject: message.subject,
      body: message.body,
      timestamp: message.timestamp.toISOString(),
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Webhook failed: ${response.status} ${response.statusText}`,
    );
  }
}

async function sendEmail(
  route: EscalationRoute,
  message: InboundMessage,
): Promise<void> {
  const to = route.to;
  if (!to) throw new Error("Email route missing 'to' address");

  // Email sending is a host responsibility — log the intent
  // In a real deployment, this would use the host's email transport
  console.warn(
    `[tickle-stick] Email escalation: to=${to} messageId=${message.id} from=${message.from}`,
  );
}

async function sendSlack(
  route: EscalationRoute,
  message: InboundMessage,
): Promise<void> {
  const webhookUrl = route.webhookUrl;
  if (!webhookUrl) throw new Error("Slack route missing webhookUrl");

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: `*Escalated message from ${message.from}*\n>${message.subject || "(no subject)"}\n${message.body.slice(0, 500)}`,
    }),
  });

  if (!response.ok) {
    throw new Error(`Slack webhook failed: ${response.status}`);
  }
}

const ROUTE_HANDLERS: Record<
  string,
  (route: EscalationRoute, message: InboundMessage) => Promise<void>
> = {
  webhook: sendWebhook,
  email: sendEmail,
  slack: sendSlack,
};

export async function processTier3(
  message: InboundMessage,
  config: Tier3Config,
): Promise<TierResult> {
  const start = performance.now();
  const errors: string[] = [];

  for (const route of config.routes) {
    const handler = ROUTE_HANDLERS[route.channel];
    if (!handler) {
      errors.push(`Unknown escalation channel: ${route.channel}`);
      continue;
    }

    try {
      await handler(route, message);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${route.channel}: ${msg}`);
    }
  }

  return {
    tier: 3,
    action: "human",
    costEstimate: 0,
    latencyMs: performance.now() - start,
    response: "Your message has been escalated to a human team member.",
    metadata: errors.length > 0 ? { errors } : undefined,
  };
}
