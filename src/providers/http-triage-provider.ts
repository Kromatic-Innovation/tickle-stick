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
    try {
      const body = await this.fetchModelBody(text, systemPrompt);
      if (!body) return { classification: "needs-reasoning", confidence: 0 };
      const responseText = this.extractText(body);
      const decision = parseClassificationResponse(responseText);
      decision.tokenUsage = this.extractTokenUsage(body);
      decision.provider = this.options.provider;
      decision.model = this.options.model;
      return decision;
    } catch {
      return { classification: "needs-reasoning", confidence: 0 };
    }
  }

  /**
   * Issue the same provider call as `classify()` but return the raw model
   * text without running it through the message-triage parser. Use this
   * when your system prompt asks the model for a JSON shape other than
   * `{classification, response, confidence}` and you want to own the
   * parsing yourself.
   *
   * Throws on transport / HTTP errors so callers can apply their own
   * retry / fallback. Unlike `classify()`, this method does NOT swallow
   * errors into a sentinel value — silent failure has caused real
   * production poisoning when the caller's parser couldn't tell a
   * timeout from an empty response.
   */
  async classifyRaw(text: string, systemPrompt: string): Promise<string> {
    const body = await this.fetchModelBody(text, systemPrompt, {
      throwOnError: true,
    });
    if (!body) return "";
    return this.extractText(body);
  }

  private async fetchModelBody(
    text: string,
    systemPrompt: string,
    opts: { throwOnError?: boolean } = {},
  ): Promise<Record<string, unknown> | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeout);
    try {
      const { url, init } =
        this.options.provider === "anthropic"
          ? this.buildAnthropicRequest(text, systemPrompt)
          : this.buildOpenAIRequest(text, systemPrompt);
      const response = await fetch(url, { ...init, signal: controller.signal });
      if (!response.ok) {
        if (opts.throwOnError) {
          const errBody = await response.text().catch(() => "");
          throw new Error(
            `${this.options.provider} API ${response.status}: ${errBody.slice(0, 200)}`,
          );
        }
        return null;
      }
      return (await response.json()) as Record<string, unknown>;
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
