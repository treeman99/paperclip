import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertAdapterTypeAllowed,
  assertModelAllowed,
  checkModelForAdapter,
  describeLlmPolicy,
  getLlmPolicy,
  isAdapterTypeAllowed,
  isBedrockModelId,
  resetLlmPolicyCache,
} from "../adapters/llm-policy.js";

vi.mock("acpx/runtime", () => ({
  createAcpRuntime: vi.fn(),
  createAgentRegistry: vi.fn(),
  createRuntimeStore: vi.fn(),
  isAcpRuntimeError: vi.fn(() => false),
}));

// Loaded at module scope: pulling in the adapter registry drags in every
// adapter package and can exceed the per-test timeout on a cold cache.
const { findActiveServerAdapter, getServerAdapter } = await import("../adapters/index.js");

const POLICY_ENV_KEYS = [
  "PAPERCLIP_LLM_POLICY_MODE",
  "PAPERCLIP_LLM_ALLOWED_ADAPTERS",
  "PAPERCLIP_LLM_INTERNAL_PROVIDER_IDS",
  "PAPERCLIP_LLM_EXTRA_ALLOWED_MODELS",
] as const;

function clearPolicyEnv() {
  for (const key of POLICY_ENV_KEYS) delete process.env[key];
  resetLlmPolicyCache();
}

describe("llm policy", () => {
  beforeEach(clearPolicyEnv);
  afterEach(clearPolicyEnv);

  describe("defaults", () => {
    it("is restricted when no env is set", () => {
      expect(getLlmPolicy().mode).toBe("restricted");
    });

    it("permits exactly the two supported lanes", () => {
      expect(isAdapterTypeAllowed("claude_local")).toBe(true);
      expect(isAdapterTypeAllowed("opencode_local")).toBe(true);
    });

    it.each([
      "codex_local",
      "cursor",
      "cursor_cloud",
      "gemini_local",
      "grok_local",
      "pi_local",
      "hermes_local",
      "hermes_gateway",
      "openclaw_gateway",
      "process",
      "http",
    ])("refuses %s", (type) => {
      expect(isAdapterTypeAllowed(type)).toBe(false);
      expect(() => assertAdapterTypeAllowed(type)).toThrow(/not permitted/);
    });

    it("refuses adapter types upstream may add later", () => {
      expect(isAdapterTypeAllowed("some_future_vendor_adapter")).toBe(false);
    });
  });

  describe("fail-closed behaviour", () => {
    it("stays restricted for a malformed mode value", () => {
      for (const value of ["true", "OPEN", "1", "yes", ""]) {
        process.env.PAPERCLIP_LLM_POLICY_MODE = value;
        resetLlmPolicyCache();
        expect(getLlmPolicy().mode).toBe("restricted");
      }
    });

    it("opens only on the exact string \"open\"", () => {
      process.env.PAPERCLIP_LLM_POLICY_MODE = "open";
      resetLlmPolicyCache();
      expect(getLlmPolicy().mode).toBe("open");
      expect(isAdapterTypeAllowed("cursor_cloud")).toBe(true);
    });

    it("falls back to the defaults when the allowlist is empty", () => {
      process.env.PAPERCLIP_LLM_ALLOWED_ADAPTERS = "   ,  ,";
      resetLlmPolicyCache();
      expect(isAdapterTypeAllowed("claude_local")).toBe(true);
      expect(isAdapterTypeAllowed("cursor_cloud")).toBe(false);
    });
  });

  describe("operator overrides", () => {
    it("honours an explicit allowlist", () => {
      process.env.PAPERCLIP_LLM_ALLOWED_ADAPTERS = "claude_local";
      resetLlmPolicyCache();
      expect(isAdapterTypeAllowed("claude_local")).toBe(true);
      expect(isAdapterTypeAllowed("opencode_local")).toBe(false);
    });

    it("re-reads the policy when env changes", () => {
      expect(isAdapterTypeAllowed("codex_local")).toBe(false);
      process.env.PAPERCLIP_LLM_ALLOWED_ADAPTERS = "codex_local";
      resetLlmPolicyCache();
      expect(isAdapterTypeAllowed("codex_local")).toBe(true);
    });
  });

  describe("Lane A — Claude via Bedrock", () => {
    it("recognises Bedrock inference-profile ids and ARNs", () => {
      expect(isBedrockModelId("us.anthropic.claude-sonnet-4-5-20250929-v2:0")).toBe(true);
      expect(isBedrockModelId("eu.anthropic.claude-opus-4-6-v1")).toBe(true);
      expect(isBedrockModelId("arn:aws:bedrock:us-east-1:123:inference-profile/x")).toBe(true);
      expect(isBedrockModelId("sonnet")).toBe(false);
      expect(isBedrockModelId("claude-haiku-4-5")).toBe(false);
    });

    it("accepts a Bedrock model id", () => {
      const result = checkModelForAdapter(
        "claude_local",
        "us.anthropic.claude-sonnet-4-5-20250929-v2:0",
      );
      expect(result.ok).toBe(true);
    });

    it.each(["sonnet", "opus", "claude-haiku-4-5", "claude-sonnet-4-6"])(
      "refuses the direct-API model id %s",
      (model) => {
        const result = checkModelForAdapter("claude_local", model);
        expect(result.ok).toBe(false);
        expect(() => assertModelAllowed("claude_local", model)).toThrow(/Bedrock/);
      },
    );
  });

  describe("Lane B — in-house open-weight endpoint", () => {
    it("accepts a model on the internal provider", () => {
      expect(checkModelForAdapter("opencode_local", "corp/my-coder-model").ok).toBe(true);
    });

    it.each(["openai/gpt-5.2-codex", "anthropic/claude-sonnet-4-6", "my-coder-model"])(
      "refuses %s",
      (model) => {
        const result = checkModelForAdapter("opencode_local", model);
        expect(result.ok).toBe(false);
      },
    );

    it("honours a custom provider id", () => {
      process.env.PAPERCLIP_LLM_INTERNAL_PROVIDER_IDS = "inhouse,lab";
      resetLlmPolicyCache();
      expect(checkModelForAdapter("opencode_local", "inhouse/qwen").ok).toBe(true);
      expect(checkModelForAdapter("opencode_local", "lab/qwen").ok).toBe(true);
      expect(checkModelForAdapter("opencode_local", "corp/qwen").ok).toBe(false);
    });
  });

  describe("escape hatches", () => {
    it("accepts an explicitly allow-listed model id", () => {
      process.env.PAPERCLIP_LLM_EXTRA_ALLOWED_MODELS = "sonnet";
      resetLlmPolicyCache();
      expect(checkModelForAdapter("claude_local", "sonnet").ok).toBe(true);
    });

    it("does not second-guess an empty model", () => {
      expect(checkModelForAdapter("claude_local", "").ok).toBe(true);
      expect(checkModelForAdapter("opencode_local", undefined).ok).toBe(true);
    });

    it("skips model rules entirely in open mode", () => {
      process.env.PAPERCLIP_LLM_POLICY_MODE = "open";
      resetLlmPolicyCache();
      expect(checkModelForAdapter("claude_local", "sonnet").ok).toBe(true);
    });
  });

  it("describes itself for error messages", () => {
    expect(describeLlmPolicy()).toContain("claude_local");
    expect(describeLlmPolicy()).toContain("opencode_local");
  });
});

describe("adapter registry enforcement", () => {
  beforeEach(clearPolicyEnv);
  afterEach(clearPolicyEnv);

  it("leaves read-only lookup alone so model listings keep working", () => {
    // The policy guards execution, not discovery: listAdapterModels and the
    // adapter-management routes go through findActiveServerAdapter and must
    // keep functioning for adapters the deployment does not permit to run.
    expect(findActiveServerAdapter("claude_local")).not.toBeNull();
    expect(findActiveServerAdapter("codex_local")).not.toBeNull();
  });

  it("refuses to hand back the process fallback for a disallowed type", () => {
    // Without the policy guard this returns the process adapter, which runs
    // arbitrary commands — the single most important bypass to keep closed.
    expect(() => getServerAdapter("cursor_cloud")).toThrow(/not permitted/);
    expect(() => getServerAdapter("definitely_not_an_adapter")).toThrow(/not permitted/);
  });

  it("still resolves permitted adapters", () => {
    expect(getServerAdapter("claude_local")).toBeTruthy();
    expect(getServerAdapter("opencode_local")).toBeTruthy();
  });
});
