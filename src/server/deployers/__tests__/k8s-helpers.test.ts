import { describe, expect, it } from "vitest";
import { buildOpenClawConfig, deriveModel, normalizeModelRef } from "../k8s-helpers.js";
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
});
