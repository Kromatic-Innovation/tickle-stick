import type { ClassificationResult, TriageProvider } from "../types.js";
import { parseClassificationResponse } from "./parse.js";

export interface HttpTriageProviderOptions {
  /** The actual API key value (not an env var name). */
  apiKey: string;
  /** Model identifier, e.g. "gpt-4o-mini", "claude-haiku-4-5-20251001". */
  model: string;
  /** API format: "openai" for OpenAI-compatible endpoints, "anthropic" for Anthropic. */
  provider: "openai" | "anthropic";
  /** Override the base URL (for OpenRouter, Ollama, etc.). */
  baseUrl?: string;
  /** Max tokens for the response. Default: 256. */
  maxTokens?: number;
  /** Request timeout in ms. Default: 5000. */
  timeout?: number;
}

const DEFAULT_OPENAI_URL = "https://api.openai.com/v1";
const DEFAULT_ANTHROPIC_URL = "https://api.anthropic.com";
const DEFAULT_MAX_TOKENS = 256;
const DEFAULT_TIMEOUT = 5000;

export class HttpTriageProvider implements TriageProvider {
  readonly name: string;
  private readonly options: Required<
    Pick<
      HttpTriageProviderOptions,
      "apiKey" | "model" | "provider" | "maxTokens" | "timeout"
    >
  > &
    Pick<HttpTriageProviderOptions, "baseUrl">;

  constructor(options: HttpTriageProviderOptions) {
    this.name = `http-${options.provider}`;
    this.options = {
      apiKey: options.apiKey,
      model: options.model,
      provider: options.provider,
      baseUrl: options.baseUrl,
      maxTokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
      timeout: options.timeout ?? DEFAULT_TIMEOUT,
    };
  }

  async classify(
    text: string,
    systemPrompt: string,
  ): Promise<ClassificationResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeout);

    try {
      const { url, init } =
        this.options.provider === "anthropic"
          ? this.buildAnthropicRequest(text, systemPrompt)
          : this.buildOpenAIRequest(text, systemPrompt);

      const response = await fetch(url, { ...init, signal: controller.signal });

      if (!response.ok) {
        return { classification: "needs-reasoning", confidence: 0 };
      }

      const body = (await response.json()) as Record<string, unknown>;
      const responseText = this.extractText(body);
      const decision = parseClassificationResponse(responseText);
      decision.tokenUsage = this.extractTokenUsage(body);

      return decision;
    } catch {
      return { classification: "needs-reasoning", confidence: 0 };
    } finally {
      clearTimeout(timer);
    }
  }

  private buildOpenAIRequest(
    userMessage: string,
    systemPrompt: string,
  ): { url: string; init: RequestInit } {
    const baseUrl = this.options.baseUrl ?? DEFAULT_OPENAI_URL;
    return {
      url: `${baseUrl}/chat/completions`,
      init: {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.options.apiKey}`,
        },
        body: JSON.stringify({
          model: this.options.model,
          max_tokens: this.options.maxTokens,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userMessage },
          ],
        }),
      },
    };
  }

  private buildAnthropicRequest(
    userMessage: string,
    systemPrompt: string,
  ): { url: string; init: RequestInit } {
    const baseUrl = this.options.baseUrl ?? DEFAULT_ANTHROPIC_URL;
    return {
      url: `${baseUrl}/v1/messages`,
      init: {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.options.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: this.options.model,
          max_tokens: this.options.maxTokens,
          system: systemPrompt,
          messages: [{ role: "user", content: userMessage }],
        }),
      },
    };
  }

  private extractText(body: Record<string, unknown>): string {
    if (Array.isArray(body.choices)) {
      const first = body.choices[0] as
        | { message?: { content?: string } }
        | undefined;
      return first?.message?.content ?? "";
    }
    if (Array.isArray(body.content)) {
      const first = body.content[0] as { text?: string } | undefined;
      return first?.text ?? "";
    }
    return "";
  }

  private extractTokenUsage(
    body: Record<string, unknown>,
  ): { input: number; output: number } | undefined {
    const usage = body.usage as Record<string, number> | undefined;
    if (!usage) return undefined;

    if (typeof usage.prompt_tokens === "number") {
      return {
        input: usage.prompt_tokens,
        output: usage.completion_tokens ?? 0,
      };
    }
    if (typeof usage.input_tokens === "number") {
      return {
        input: usage.input_tokens,
        output: usage.output_tokens ?? 0,
      };
    }
    return undefined;
  }
}
