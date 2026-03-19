import type {
  InboundMessage,
  TriageDecision,
  TriageProvider,
} from "../types.js";
import type { ProviderConfig } from "../config/schema.js";

export class AnthropicTriageProvider implements TriageProvider {
  readonly name = "anthropic";
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly timeout: number;

  constructor(config: ProviderConfig, model: string, timeout: number = 5000) {
    if (!config.apiKey) {
      throw new Error("Anthropic provider requires apiKey");
    }
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl ?? "https://api.anthropic.com";
    this.model = model;
    this.timeout = timeout;
  }

  async triage(
    message: InboundMessage,
    systemPrompt: string,
  ): Promise<TriageDecision> {
    const userContent = [
      message.subject ? `Subject: ${message.subject}` : "",
      `From: ${message.from}`,
      `Channel: ${message.channel}`,
      "",
      message.body,
    ]
      .filter(Boolean)
      .join("\n");

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(`${this.baseUrl}/v1/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: 256,
          system: systemPrompt,
          messages: [{ role: "user", content: userContent }],
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(
          `Anthropic API error: ${response.status} ${response.statusText}`,
        );
      }

      const data = (await response.json()) as {
        content: Array<{ type: string; text: string }>;
        usage?: { input_tokens: number; output_tokens: number };
      };

      const text = data.content?.[0]?.text ?? "";
      return {
        ...parseTriageResponse(text),
        tokenUsage: data.usage
          ? { input: data.usage.input_tokens, output: data.usage.output_tokens }
          : undefined,
      };
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new Error(`Anthropic triage timed out after ${this.timeout}ms`, {
          cause: err,
        });
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

export function parseTriageResponse(text: string): TriageDecision {
  try {
    // Extract JSON from response (may be wrapped in markdown code blocks)
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { action: "escalate", confidence: 0 };
    }

    const parsed = JSON.parse(jsonMatch[0]) as {
      action?: string;
      response?: string;
      confidence?: number;
    };

    const action = parsed.action;
    if (action !== "deflect" && action !== "escalate" && action !== "human") {
      return { action: "escalate", confidence: 0 };
    }

    return {
      action,
      response:
        typeof parsed.response === "string" ? parsed.response : undefined,
      confidence:
        typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
    };
  } catch {
    return { action: "escalate", confidence: 0 };
  }
}
