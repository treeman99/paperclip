import { describe, expect, it } from "vitest";
import {
  classifyRunErrorCode,
  CONTEXT_OVERFLOW_ERROR_CODE,
  isContextOverflowText,
} from "../adapters/context-overflow.js";

describe("context overflow detection", () => {
  describe("OpenAI-compatible servers (Lane B)", () => {
    it.each([
      // vLLM / SGLang
      "This model's maximum context length is 32768 tokens, however you requested 41520 tokens.",
      // OpenAI-compatible error code form
      '{"error":{"code":"context_length_exceeded","message":"..."}}',
      // Common phrasing across proxies
      "Please reduce the length of the messages or completion.",
      "llama_decode: the prompt is too long for this context window",
    ])("recognises %s", (message) => {
      expect(isContextOverflowText(message)).toBe(true);
    });
  });

  describe("Bedrock (Lane A)", () => {
    it.each([
      "ValidationException: Input is too long for requested model.",
      "ValidationException: too many input tokens for this model",
    ])("recognises %s", (message) => {
      expect(isContextOverflowText(message)).toBe(true);
    });
  });

  describe("does not fire on unrelated failures", () => {
    it.each([
      "Adapter failed",
      "ECONNREFUSED 127.0.0.1:8000",
      "rate limit exceeded, please try again later",
      "model not found: corp/my-coder-model",
      "Timed out",
      "",
    ])("ignores %s", (message) => {
      expect(isContextOverflowText(message)).toBe(false);
    });

    it("ignores non-string input", () => {
      expect(isContextOverflowText(null)).toBe(false);
      expect(isContextOverflowText(undefined)).toBe(false);
      expect(isContextOverflowText(42)).toBe(false);
    });
  });
});

describe("classifyRunErrorCode", () => {
  it("upgrades a generic failure to context_overflow", () => {
    expect(
      classifyRunErrorCode({
        errorCode: null,
        errorMessage: "This model's maximum context length is 32768 tokens",
      }),
    ).toBe(CONTEXT_OVERFLOW_ERROR_CODE);
  });

  it("upgrades the adapter_failed placeholder too", () => {
    expect(
      classifyRunErrorCode({
        errorCode: "adapter_failed",
        errorMessage: "context_length_exceeded",
      }),
    ).toBe(CONTEXT_OVERFLOW_ERROR_CODE);
  });

  it("never overwrites a specific error code the adapter already determined", () => {
    // An adapter that classified the failure knows more than a regex does.
    expect(
      classifyRunErrorCode({
        errorCode: "claude_transient_upstream",
        errorMessage: "maximum context length is 32768 tokens",
      }),
    ).toBe("claude_transient_upstream");
  });

  it("leaves unrelated failures untouched", () => {
    expect(
      classifyRunErrorCode({ errorCode: null, errorMessage: "ECONNREFUSED" }),
    ).toBeNull();
    expect(
      classifyRunErrorCode({ errorCode: "adapter_failed", errorMessage: "boom" }),
    ).toBe("adapter_failed");
  });

  it("does not map overflow onto a retriable family", async () => {
    // Guards the core design decision: overflow is deterministic, so routing it
    // into the bounded transient ladder would re-send an identical oversized
    // prompt four times over ~2h42m and fail identically each time.
    const module = await import("../adapters/context-overflow.js");
    const source = Object.keys(module);
    expect(source).not.toContain("errorFamily");
    expect(CONTEXT_OVERFLOW_ERROR_CODE).not.toBe("transient_upstream");
    expect(CONTEXT_OVERFLOW_ERROR_CODE).not.toBe("provider_quota");
  });
});
