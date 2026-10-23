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
    // Captured as soon as a response body exists, before anything that can
    // throw (extractText() throws on a max_tokens truncation with no text
    // block, tickle-stick#238) — a truncation still burns real tokens, so
    // the catch below can charge for them instead of silently costing zero
    // (Seer finding on tickle-stick#239: throwing from extractText bypassed
    // extractTokenUsage entirely). A failure with no body at all (404,
    // network error, abort) never reaches this line and stays zero-cost.
    let tokenUsage: { input: number; output: number } | undefined;
    try {
      const { body, failureReason } = await this.fetchModelBody(
        text,
        systemPrompt,
      );
      if (!body) {
        return {
          classification: "needs-reasoning",
          confidence: 0,
          failureReason: failureReason ?? "empty response body",
        };
      }
      tokenUsage = this.extractTokenUsage(body);
      const responseText = this.extractText(body);
      const decision = parseClassificationResponse(responseText);
      decision.tokenUsage = tokenUsage;
      decision.provider = this.options.provider;
      decision.model = this.options.model;
      return decision;
    } catch (err) {
      // Covers thrown network/abort errors and the max_tokens truncation
      // thrown by extractText() (tickle-stick#238) — both degrade to the
      // needs-reasoning sentinel but now carry the reason via failureReason
      // so the stage router can surface onError/errored instead of silently
      // swallowing the failure (tickle-stick#239). tokenUsage is attached
      // when a body was actually received and carried a usage block, so
      // tier1-triage charges the real measured tokens instead of zero.
      return {
        classification: "needs-reasoning",
        confidence: 0,
        failureReason: err instanceof Error ? err.message : String(err),
        tokenUsage,
      };
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
    const { body } = await this.fetchModelBody(text, systemPrompt, {
      throwOnError: true,
    });
    if (!body) return "";
    return this.extractText(body);
  }

  private async fetchModelBody(
    text: string,
    systemPrompt: string,
    opts: { throwOnError?: boolean } = {},
  ): Promise<{ body: Record<string, unknown> | null; failureReason?: string }> {
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
        return {
          body: null,
          failureReason: `${this.options.provider} API ${response.status}`,
        };
      }
      return { body: (await response.json()) as Record<string, unknown> };
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
      // Anthropic responses can lead with a `thinking` block when adaptive
      // thinking engages; scan for the first `text` block rather than
      // assuming content[0] is the text. See tickle-stick#238.
      const textBlock = body.content.find(
        (block): block is { type: "text"; text: string } =>
          typeof block === "object" &&
          block !== null &&
          (block as { type?: unknown }).type === "text" &&
          typeof (block as { text?: unknown }).text === "string",
      );
      if (textBlock) return textBlock.text;
      if (body.stop_reason === "max_tokens") {
        throw new Error(
          `${this.options.provider} response truncated at max_tokens with no text content block`,
        );
      }
      return "";
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
