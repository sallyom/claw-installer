import { describe, expect, it } from "vitest";
import { buildOpenClawConfig, deriveModel, namespaceName, normalizeModelRef, sanitizeForRfc1123 } from "../k8s-helpers.js";
import type { DeployConfig } from "../types.js";

function makeConfig(overrides: Partial<DeployConfig> = {}): DeployConfig {
  return {
    mode: "kubernetes",
    agentName: "demo",
    agentDisplayName: "Demo",
    ...overrides,
  };
}

describe("model config generation", () => {
  it("never deploys into the default namespace implicitly", () => {
    const config = makeConfig({
      prefix: "alice",
      agentName: "lynx",
      namespace: "default",
    });

    expect(namespaceName(config)).toBe("alice-lynx-openclaw");
  });

  it("uses an explicit namespace when it is not default", () => {
    const config = makeConfig({
      prefix: "alice",
      agentName: "lynx",
      namespace: "team-space",
    });

    expect(namespaceName(config)).toBe("team-space");
  });

  it("normalizes bare Anthropic model ids to provider/model refs", () => {
    const config = makeConfig({
      anthropicApiKey: "test-key",
      agentModel: "claude-sonnet-4-6",
    });

    expect(normalizeModelRef(config, "claude-sonnet-4-6")).toBe("anthropic/claude-sonnet-4-6");
    expect(deriveModel(config)).toBe("anthropic/claude-sonnet-4-6");
  });

  it("publishes only the configured default model in the agent catalog", () => {
    const config = makeConfig({
      anthropicApiKey: "test-key",
      agentModel: "claude-sonnet-4-6",
    });

    const rendered = buildOpenClawConfig(config, "gateway-token") as {
      agents?: {
        defaults?: {
          model?: { primary?: string };
          models?: Record<string, { alias?: string }>;
        };
      };
    };

    expect(rendered.agents?.defaults?.model?.primary).toBe("anthropic/claude-sonnet-4-6");
    expect(rendered.agents?.defaults?.models).toEqual({
      "anthropic/claude-sonnet-4-6": { alias: "claude-sonnet-4-6" },
    });
  });

  it("prefers the selected Anthropic provider even when an OpenAI key is also present", () => {
    const config = makeConfig({
      inferenceProvider: "anthropic",
      anthropicApiKey: "anthropic-key",
      openaiApiKey: "openai-key",
    });

    expect(deriveModel(config)).toBe("anthropic/claude-sonnet-4-6");
  });

  // Regression tests for #1: normalizeModelRef must use litellm/ prefix when proxy is active
  it("normalizes vertex-anthropic custom model to litellm/ when proxy is enabled", () => {
    const config = makeConfig({
      inferenceProvider: "vertex-anthropic",
      litellmProxy: true,
      agentModel: "claude-opus-4-6",
    });

    expect(normalizeModelRef(config, "claude-opus-4-6")).toBe("litellm/claude-opus-4-6");
    expect(deriveModel(config)).toBe("litellm/claude-opus-4-6");
  });

  it("normalizes vertex-google custom model to litellm/ when proxy is enabled", () => {
    const config = makeConfig({
      inferenceProvider: "vertex-google",
      litellmProxy: true,
      agentModel: "gemini-2.5-pro",
    });

    expect(normalizeModelRef(config, "gemini-2.5-pro")).toBe("litellm/gemini-2.5-pro");
    expect(deriveModel(config)).toBe("litellm/gemini-2.5-pro");
  });

  it("normalizes vertex-anthropic custom model to anthropic-vertex/ when proxy is disabled", () => {
    const config = makeConfig({
      inferenceProvider: "vertex-anthropic",
      litellmProxy: false,
      agentModel: "claude-opus-4-6",
    });

    expect(normalizeModelRef(config, "claude-opus-4-6")).toBe("anthropic-vertex/claude-opus-4-6");
    expect(deriveModel(config)).toBe("anthropic-vertex/claude-opus-4-6");
  });

  it("passes through model refs that already contain a provider prefix", () => {
    const config = makeConfig({
      inferenceProvider: "vertex-anthropic",
      litellmProxy: true,
    });

    expect(normalizeModelRef(config, "litellm/my-model")).toBe("litellm/my-model");
    expect(normalizeModelRef(config, "anthropic-vertex/my-model")).toBe("anthropic-vertex/my-model");
  });
});

// Regression tests for #7: agent names with underscores must produce valid namespaces
describe("sanitizeForRfc1123", () => {
  it("replaces underscores with hyphens", () => {
    expect(sanitizeForRfc1123("a_0")).toBe("a-0");
  });

  it("collapses consecutive hyphens", () => {
    expect(sanitizeForRfc1123("a__b")).toBe("a-b");
  });

  it("removes leading and trailing hyphens", () => {
    expect(sanitizeForRfc1123("_hello_")).toBe("hello");
  });

  it("lowercases input", () => {
    expect(sanitizeForRfc1123("MyAgent")).toBe("myagent");
  });

  it("passes through already-valid names", () => {
    expect(sanitizeForRfc1123("my-agent-01")).toBe("my-agent-01");
  });
});

describe("namespaceName", () => {
  it("sanitizes agent names with underscores (issue #7)", () => {
    const config = makeConfig({ agentName: "a_0", prefix: "bmurdock" });
    expect(namespaceName(config)).toBe("bmurdock-a-0-openclaw");
  });

  it("produces RFC 1123-valid namespaces for normal names", () => {
    const config = makeConfig({ agentName: "demo", prefix: "user" });
    expect(namespaceName(config)).toBe("user-demo-openclaw");
  });

  it("uses explicit namespace when provided", () => {
    const config = makeConfig({ agentName: "demo", namespace: "Custom-NS" });
    expect(namespaceName(config)).toBe("custom-ns");
  });

  it("falls back to 'agent' when agent name sanitizes to empty", () => {
    const config = makeConfig({ agentName: "___", prefix: "user" });
    expect(namespaceName(config)).toBe("user-agent-openclaw");
  });
});
