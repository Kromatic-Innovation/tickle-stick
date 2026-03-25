import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  HttpTriageProvider,
  type HttpTriageProviderOptions,
} from "../src/providers/http-triage-provider.js";
import type { InboundMessage } from "../src/types.js";

function makeMessage(body: string): InboundMessage {
  return {
    id: "test-msg",
    channel: "whatsapp",
    from: "user@example.com",
    body,
    timestamp: new Date(),
  };
}

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
              content: '{"action":"deflect","response":"Hi!","confidence":0.9}',
            },
          },
        ],
        usage: { prompt_tokens: 50, completion_tokens: 20 },
      });

      const provider = makeProvider({ model: "gpt-4o-mini" });
      await provider.triage(makeMessage("hello"), "Classify this.");

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
              content: '{"action":"deflect","response":"Hi!","confidence":0.9}',
            },
          },
        ],
        usage: { prompt_tokens: 50, completion_tokens: 20 },
      });

      const provider = makeProvider();
      const result = await provider.triage(
        makeMessage("hello"),
        "Classify this.",
      );

      expect(result.action).toBe("deflect");
      expect(result.response).toBe("Hi!");
      expect(result.confidence).toBe(0.9);
      expect(result.tokenUsage).toEqual({ input: 50, output: 20 });
    });

    it("uses custom baseUrl", async () => {
      mockFetchResponse({
        choices: [
          {
            message: {
              content: '{"action":"escalate","confidence":0.8}',
            },
          },
        ],
      });

      const provider = makeProvider({
        baseUrl: "https://openrouter.ai/api/v1",
      });
      await provider.triage(makeMessage("test"), "Classify.");

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
            text: '{"action":"deflect","response":"Hello!","confidence":0.95}',
          },
        ],
        usage: { input_tokens: 40, output_tokens: 15 },
      });

      const provider = makeProvider({
        provider: "anthropic",
        model: "claude-haiku-4-5-20251001",
        apiKey: "sk-ant-test",
      });
      await provider.triage(makeMessage("hi"), "Classify.");

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
          { text: '{"action":"deflect","response":"Hi","confidence":0.9}' },
        ],
        usage: { input_tokens: 40, output_tokens: 15 },
      });

      const provider = makeProvider({ provider: "anthropic" });
      const result = await provider.triage(makeMessage("hi"), "Classify.");

      expect(result.tokenUsage).toEqual({ input: 40, output: 15 });
    });
  });

  describe("error handling", () => {
    it("returns escalate on HTTP error", async () => {
      mockFetchResponse({}, false);

      const provider = makeProvider();
      const result = await provider.triage(makeMessage("test"), "Classify.");

      expect(result.action).toBe("escalate");
      expect(result.confidence).toBe(0);
    });

    it("returns escalate on fetch failure", async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("Network error"),
      );

      const provider = makeProvider();
      const result = await provider.triage(makeMessage("test"), "Classify.");

      expect(result.action).toBe("escalate");
      expect(result.confidence).toBe(0);
    });

    it("returns escalate on abort (timeout)", async () => {
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
      const result = await provider.triage(makeMessage("test"), "Classify.");

      expect(result.action).toBe("escalate");
      expect(result.confidence).toBe(0);
    });

    it("returns escalate when response has no content", async () => {
      mockFetchResponse({ choices: [] });

      const provider = makeProvider();
      const result = await provider.triage(makeMessage("test"), "Classify.");

      // parseTriageResponse("") returns escalate with confidence 0
      expect(result.action).toBe("escalate");
      expect(result.confidence).toBe(0);
    });
  });

  describe("defaults", () => {
    it("uses default maxTokens and timeout", async () => {
      mockFetchResponse({
        choices: [
          {
            message: {
              content: '{"action":"escalate","confidence":0.5}',
            },
          },
        ],
      });

      const provider = makeProvider();
      await provider.triage(makeMessage("test"), "Classify.");

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
              content: '{"action":"escalate","confidence":0.5}',
            },
          },
        ],
      });

      const provider = makeProvider({ maxTokens: 128 });
      await provider.triage(makeMessage("test"), "Classify.");

      const [, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
        .calls[0];
      const body = JSON.parse(init.body as string);
      expect(body.max_tokens).toBe(128);
    });
  });
});
