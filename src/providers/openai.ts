import type {
  InboundMessage,
  TriageDecision,
  TriageProvider,
} from "../types.js";
import type { ProviderConfig } from "../config/schema.js";

export class OpenAITriageProvider implements TriageProvider {
  readonly name = "openai";
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly timeout: number;

  constructor(config: ProviderConfig, model: string, timeout: number = 5000) {
    if (!config.apiKey) {
      throw new Error("OpenAI provider requires apiKey");
    }
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl ?? "https://api.openai.com";
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
      const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: 256,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userContent },
          ],
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(
          `OpenAI API error: ${response.status} ${response.statusText}`,
        );
      }

      const data = (await response.json()) as {
        choices: Array<{ message: { content: string } }>;
        usage?: { prompt_tokens: number; completion_tokens: number };
      };

      const text = data.choices?.[0]?.message?.content ?? "";
      return {
        ...parseTriageResponse(text),
        tokenUsage: data.usage
          ? {
              input: data.usage.prompt_tokens,
              output: data.usage.completion_tokens,
            }
          : undefined,
      };
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new Error(`OpenAI triage timed out after ${this.timeout}ms`, {
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
