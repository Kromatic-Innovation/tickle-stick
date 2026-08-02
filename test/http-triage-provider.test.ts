import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  HttpTriageProvider,
  type HttpTriageProviderOptions,
} from "../src/providers/http-triage-provider.js";

function makeProvider(
  overrides: Partial<HttpTriageProviderOptions> = {},
): HttpTriageProvider {
  return new HttpTriageProvider({
    apiKey: "test-key",
    model: "gpt-4o-mini",
    provider: "openai",
    ...overrides,
  });
}

const originalFetch = globalThis.fetch;

beforeEach(() => {
  globalThis.fetch = vi.fn();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function mockFetchResponse(body: unknown, ok = true): void {
  (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
    ok,
    json: () => Promise.resolve(body),
  });
}

describe("HttpTriageProvider", () => {
  it("has a descriptive name based on provider", () => {
    expect(makeProvider({ provider: "openai" }).name).toBe("http-openai");
    expect(makeProvider({ provider: "anthropic" }).name).toBe("http-anthropic");
  });

  describe("OpenAI format", () => {
    it("sends correct request shape", async () => {
      mockFetchResponse({
        choices: [
          {
            message: {
              content:
                '{"classification":"routine","response":"Normal","confidence":0.9}',
            },
          },
        ],
        usage: { prompt_tokens: 50, completion_tokens: 20 },
      });

      const provider = makeProvider({ model: "gpt-4o-mini" });
      await provider.classify("hello", "Classify this.");

      const [url, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
        .calls[0];
      expect(url).toBe("https://api.openai.com/v1/chat/completions");
      expect(init.method).toBe("POST");

      const headers = init.headers as Record<string, string>;
      expect(headers["Authorization"]).toBe("Bearer test-key");

      const body = JSON.parse(init.body as string);
      expect(body.model).toBe("gpt-4o-mini");
      expect(body.messages).toEqual([
        { role: "system", content: "Classify this." },
        { role: "user", content: "hello" },
      ]);
      expect(body.max_tokens).toBe(256);
    });

    it("parses response and extracts token usage", async () => {
      mockFetchResponse({
        choices: [
          {
            message: {
              content:
                '{"classification":"routine","response":"Normal","confidence":0.9}',
            },
          },
        ],
        usage: { prompt_tokens: 50, completion_tokens: 20 },
      });

      const provider = makeProvider();
      const result = await provider.classify("hello", "Classify this.");

      expect(result.classification).toBe("routine");
      expect(result.response).toBe("Normal");
      expect(result.confidence).toBe(0.9);
      expect(result.tokenUsage).toEqual({ input: 50, output: 20 });
    });

    it("populates provider and model identifiers on the result", async () => {
      mockFetchResponse({
        choices: [
          {
            message: {
              content:
                '{"classification":"routine","response":"Normal","confidence":0.9}',
            },
          },
        ],
        usage: { prompt_tokens: 50, completion_tokens: 20 },
      });

      const provider = makeProvider({
        provider: "openai",
        model: "gpt-4o-mini",
      });
      const result = await provider.classify("hello", "Classify this.");

      expect(result.provider).toBe("openai");
      expect(result.model).toBe("gpt-4o-mini");
    });

    it("uses custom baseUrl", async () => {
      mockFetchResponse({
        choices: [
          {
            message: {
              content: '{"classification":"needs-reasoning","confidence":0.8}',
            },
          },
        ],
      });

      const provider = makeProvider({
        baseUrl: "https://openrouter.ai/api/v1",
      });
      await provider.classify("test", "Classify.");

      const [url] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
        .calls[0];
      expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    });
  });

  describe("Anthropic format", () => {
    it("sends correct request shape", async () => {
      mockFetchResponse({
        content: [
          {
            text: '{"classification":"routine","response":"Hello!","confidence":0.95}',
          },
        ],
        usage: { input_tokens: 40, output_tokens: 15 },
      });

      const provider = makeProvider({
        provider: "anthropic",
        model: "claude-haiku-4-5-20251001",
        apiKey: "sk-ant-test",
      });
      await provider.classify("hi", "Classify.");

      const [url, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
        .calls[0];
      expect(url).toBe("https://api.anthropic.com/v1/messages");

      const headers = init.headers as Record<string, string>;
      expect(headers["x-api-key"]).toBe("sk-ant-test");
      expect(headers["anthropic-version"]).toBe("2023-06-01");

      const body = JSON.parse(init.body as string);
      expect(body.model).toBe("claude-haiku-4-5-20251001");
      expect(body.system).toBe("Classify.");
      expect(body.messages).toEqual([{ role: "user", content: "hi" }]);
    });

    it("extracts Anthropic token usage", async () => {
      mockFetchResponse({
        content: [
          {
            text: '{"classification":"routine","response":"Hi","confidence":0.9}',
          },
        ],
        usage: { input_tokens: 40, output_tokens: 15 },
      });

      const provider = makeProvider({ provider: "anthropic" });
      const result = await provider.classify("hi", "Classify.");

      expect(result.tokenUsage).toEqual({ input: 40, output: 15 });
    });
  });

  describe("error handling", () => {
    it("returns needs-reasoning on HTTP error", async () => {
      mockFetchResponse({}, false);

      const provider = makeProvider();
      const result = await provider.classify("test", "Classify.");

      expect(result.classification).toBe("needs-reasoning");
      expect(result.confidence).toBe(0);
    });

    it("returns needs-reasoning on fetch failure", async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("Network error"),
      );

      const provider = makeProvider();
      const result = await provider.classify("test", "Classify.");

      expect(result.classification).toBe("needs-reasoning");
      expect(result.confidence).toBe(0);
    });

    it("returns needs-reasoning on abort (timeout)", async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation(
        () =>
          new Promise((_resolve, reject) => {
            setTimeout(
              () => reject(new DOMException("Aborted", "AbortError")),
              10,
            );
          }),
      );

      const provider = makeProvider({ timeout: 5 });
      const result = await provider.classify("test", "Classify.");

      expect(result.classification).toBe("needs-reasoning");
      expect(result.confidence).toBe(0);
    });

    it("returns needs-reasoning when response has no content", async () => {
      mockFetchResponse({ choices: [] });

      const provider = makeProvider();
      const result = await provider.classify("test", "Classify.");

      expect(result.classification).toBe("needs-reasoning");
      expect(result.confidence).toBe(0);
    });
  });

  describe("classifyRaw", () => {
    it("returns the model's raw text without parsing for OpenAI", async () => {
      mockFetchResponse({
        choices: [
          {
            message: {
              content:
                '{"moscow":"must","proposed_action":"revert PR 1234","affected_users":150,"confidence":0.85}',
            },
          },
        ],
      });
      const provider = makeProvider({ provider: "openai" });
      const raw = await provider.classifyRaw(
        "triage me",
        "MoSCoW system prompt",
      );
      expect(raw).toBe(
        '{"moscow":"must","proposed_action":"revert PR 1234","affected_users":150,"confidence":0.85}',
      );
    });

    it("returns the model's raw text without parsing for Anthropic", async () => {
      mockFetchResponse({
        content: [
          {
            text: '{"moscow":"should","proposed_action":"bump pg","affected_users":0,"confidence":0.7}',
          },
        ],
      });
      const provider = makeProvider({ provider: "anthropic" });
      const raw = await provider.classifyRaw(
        "triage me",
        "MoSCoW system prompt",
      );
      expect(raw).toBe(
        '{"moscow":"should","proposed_action":"bump pg","affected_users":0,"confidence":0.7}',
      );
    });

    it("does NOT swallow non-message-triage shapes (regression for tickle-stick#36)", async () => {
      // The whole point of classifyRaw — `classify()` would silently
      // discard this and return needs-reasoning because the message-triage
      // parser doesn't recognize the moscow shape.
      const moscowReply = JSON.stringify({
        moscow: "could",
        proposed_action: "file issue",
        affected_users: 1,
        confidence: 0.6,
      });
      mockFetchResponse({
        choices: [{ message: { content: moscowReply } }],
      });
      const provider = makeProvider();
      const raw = await provider.classifyRaw("test", "system");
      expect(raw).toBe(moscowReply);
    });

    it("throws on HTTP error so callers can apply their own fallback", async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        status: 401,
        text: () => Promise.resolve('{"error":"unauthorized"}'),
      });
      const provider = makeProvider();
      await expect(provider.classifyRaw("test", "system")).rejects.toThrow(
        /openai API 401/,
      );
    });

    it("throws on fetch failure", async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("Network error"),
      );
      const provider = makeProvider();
      await expect(provider.classifyRaw("test", "system")).rejects.toThrow(
        /Network error/,
      );
    });

    it("returns empty string when response has no content", async () => {
      mockFetchResponse({ choices: [] });
      const provider = makeProvider();
      const raw = await provider.classifyRaw("test", "system");
      expect(raw).toBe("");
    });
  });

  describe("defaults", () => {
    it("uses default maxTokens and timeout", async () => {
      mockFetchResponse({
        choices: [
          {
            message: {
              content: '{"classification":"needs-reasoning","confidence":0.5}',
            },
          },
        ],
      });

      const provider = makeProvider();
      await provider.classify("test", "Classify.");

      const [, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
        .calls[0];
      const body = JSON.parse(init.body as string);
      expect(body.max_tokens).toBe(256);
    });

    it("respects custom maxTokens", async () => {
      mockFetchResponse({
        choices: [
          {
            message: {
              content: '{"classification":"needs-reasoning","confidence":0.5}',
            },
          },
        ],
      });

      const provider = makeProvider({ maxTokens: 128 });
      await provider.classify("test", "Classify.");

      const [, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
        .calls[0];
      const body = JSON.parse(init.body as string);
      expect(body.max_tokens).toBe(128);
    });
  });
});
