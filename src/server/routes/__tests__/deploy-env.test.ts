import { describe, expect, it } from "vitest";
import type { DeployConfig } from "../../deployers/types.js";
import {
  applyProviderSecretDataDefaults,
  applyOnePasswordSecretRefDefaults,
  applyServerEnvFallbacks,
  applyVaultSecretRefDefaults,
  normalizeVaultAddr,
} from "../deploy.js";

function makeConfig(overrides: Partial<DeployConfig> = {}): DeployConfig {
  return {
    mode: "local",
    agentName: "demo",
    agentDisplayName: "Demo",
    inferenceProvider: "anthropic",
    ...overrides,
  };
}

describe("applyServerEnvFallbacks", () => {
  it("hydrates secondary provider credentials from server env", () => {
    const config = makeConfig({
      inferenceProvider: "anthropic",
    });

    applyServerEnvFallbacks(config, {
      OPENAI_API_KEY: "sk-openai-env",
      ANTHROPIC_API_KEY: "sk-ant-env",
    });

    expect(config.anthropicApiKey).toBe("sk-ant-env");
    expect(config.openaiApiKey).toBe("sk-openai-env");
  });

  it("hydrates OpenRouter credentials from server env", () => {
    const config = makeConfig({
      inferenceProvider: "anthropic",
    });

    applyServerEnvFallbacks(config, {
      OPENROUTER_API_KEY: "sk-or-env",
    });

    expect(config.openrouterApiKey).toBe("sk-or-env");
  });

  it("hydrates Google credentials from either GEMINI_API_KEY or GOOGLE_API_KEY", () => {
    const geminiConfig = makeConfig({
      inferenceProvider: "anthropic",
    });
    applyServerEnvFallbacks(geminiConfig, {
      GEMINI_API_KEY: "gemini-env",
    });
    expect(geminiConfig.googleApiKey).toBe("gemini-env");

    const googleConfig = makeConfig({
      inferenceProvider: "anthropic",
    });
    applyServerEnvFallbacks(googleConfig, {
      GOOGLE_API_KEY: "google-env",
    });
    expect(googleConfig.googleApiKey).toBe("google-env");
  });

  it("hydrates provider credentials from server env even when Podman secret defaults are present", () => {
    const config = makeConfig({
      inferenceProvider: "anthropic",
      podmanSecretMappings: [
        { secretName: "anthropic_api_key", targetEnv: "ANTHROPIC_API_KEY" },
        { secretName: "openai_api_key", targetEnv: "OPENAI_API_KEY" },
        { secretName: "gemini_api_key", targetEnv: "GEMINI_API_KEY" },
        { secretName: "openrouter_api_key", targetEnv: "OPENROUTER_API_KEY" },
        { secretName: "model_endpoint_api_key", targetEnv: "MODEL_ENDPOINT_API_KEY" },
      ],
    });

    applyServerEnvFallbacks(config, {
      ANTHROPIC_API_KEY: "sk-ant-env",
      OPENAI_API_KEY: "sk-openai-env",
      GEMINI_API_KEY: "gemini-env",
      OPENROUTER_API_KEY: "sk-or-env",
    });

    expect(config.anthropicApiKey).toBe("sk-ant-env");
    expect(config.openaiApiKey).toBe("sk-openai-env");
    expect(config.googleApiKey).toBe("gemini-env");
    expect(config.openrouterApiKey).toBe("sk-or-env");
  });

  it("hydrates endpoint token independently from the OpenAI API key", () => {
    const config = makeConfig({
      inferenceProvider: "anthropic",
      modelEndpoint: "http://localhost:8000/v1",
    });

    applyServerEnvFallbacks(config, {
      OPENAI_API_KEY: "sk-openai-env",
      MODEL_ENDPOINT_API_KEY: "endpoint-token",
    });

    expect(config.openaiApiKey).toBe("sk-openai-env");
    expect(config.modelEndpointApiKey).toBe("endpoint-token");
  });

  it("skips env fallbacks for providers not in selectedProviders", () => {
    const config = makeConfig({
      inferenceProvider: "vertex-anthropic",
    });

    applyServerEnvFallbacks(config, {
      ANTHROPIC_API_KEY: "sk-ant-env",
      GEMINI_API_KEY: "gemini-env",
      OPENAI_API_KEY: "sk-openai-env",
    }, ["vertex-anthropic"]);

    expect(config.anthropicApiKey).toBeUndefined();
    expect(config.googleApiKey).toBeUndefined();
    expect(config.openaiApiKey).toBeUndefined();
  });

  it("hydrates env fallbacks only for selected providers", () => {
    const config = makeConfig({
      inferenceProvider: "anthropic",
    });

    applyServerEnvFallbacks(config, {
      ANTHROPIC_API_KEY: "sk-ant-env",
      OPENAI_API_KEY: "sk-openai-env",
      GEMINI_API_KEY: "gemini-env",
    }, ["anthropic", "openai"]);

    expect(config.anthropicApiKey).toBe("sk-ant-env");
    expect(config.openaiApiKey).toBe("sk-openai-env");
    expect(config.googleApiKey).toBeUndefined();
  });
});

describe("applyVaultSecretRefDefaults", () => {
  it("defaults selected provider refs to Vault when Vault wiring is enabled", () => {
    const config = makeConfig({
      mode: "openshift",
      vaultSecretsEnabled: true,
    });

    applyVaultSecretRefDefaults(config, ["openai"]);

    expect(config.openaiApiKeyRef).toEqual({
      source: "exec",
      provider: "vault",
      id: "providers/openai/apiKey",
    });
    expect(config.anthropicApiKeyRef).toBeUndefined();
  });

  it("does not overwrite explicit SecretRefs", () => {
    const config = makeConfig({
      mode: "openshift",
      vaultSecretsEnabled: true,
      openaiApiKeyRef: {
        source: "exec",
        provider: "custom",
        id: "openai",
      },
    });

    applyVaultSecretRefDefaults(config, ["openai"]);

    expect(config.openaiApiKeyRef).toEqual({
      source: "exec",
      provider: "custom",
      id: "openai",
    });
  });
});

describe("applyOnePasswordSecretRefDefaults", () => {
  it("defaults selected provider refs to 1Password when 1Password wiring is enabled", () => {
    const config = makeConfig({
      mode: "openshift",
      onePasswordSecretsEnabled: true,
      onePasswordVault: "Engineering",
    });

    applyOnePasswordSecretRefDefaults(config, ["openrouter"]);

    expect(config.openrouterApiKeyRef).toEqual({
      source: "exec",
      provider: "onepassword",
      id: "op://Engineering/OpenRouter/credential",
    });
    expect(config.openaiApiKeyRef).toBeUndefined();
  });

  it("does not overwrite explicit SecretRefs", () => {
    const config = makeConfig({
      mode: "openshift",
      onePasswordSecretsEnabled: true,
      openrouterApiKeyRef: {
        source: "exec",
        provider: "custom",
        id: "openrouter",
      },
    });

    applyOnePasswordSecretRefDefaults(config, ["openrouter"]);

    expect(config.openrouterApiKeyRef).toEqual({
      source: "exec",
      provider: "custom",
      id: "openrouter",
    });
  });
});

describe("applyProviderSecretDataDefaults", () => {
  it("hydrates Codex OAuth auth.json from a provider Secret", () => {
    const config = makeConfig({
      mode: "openshift",
      inferenceProvider: "openai-codex",
      codexOauthMode: "codex-cli",
      codexOauthProfileId: "openai-codex:default",
    });
    const authJson = JSON.stringify({
      auth_mode: "chatgpt",
      tokens: {
        access_token: "access",
        refresh_token: "refresh",
      },
    });

    applyProviderSecretDataDefaults(config, {
      OPENAI_CODEX_AUTH_JSON: authJson,
    });

    expect(config.codexOauthAuthJson).toBe(authJson);
  });

  it("hydrates Vertex credentials and location defaults from a provider Secret", () => {
    const config = makeConfig({
      mode: "openshift",
      inferenceProvider: "vertex-anthropic",
      vertexEnabled: true,
      vertexProvider: "anthropic",
    });
    const credentialsJson = JSON.stringify({
      type: "service_account",
      project_id: "vertex-project",
    });

    applyProviderSecretDataDefaults(config, {
      GOOGLE_APPLICATION_CREDENTIALS_JSON: credentialsJson,
      GOOGLE_CLOUD_PROJECT: "vertex-project",
      GOOGLE_CLOUD_LOCATION: "us-east5",
    });

    expect(config.gcpServiceAccountJson).toBe(credentialsJson);
    expect(config.googleCloudProject).toBe("vertex-project");
    expect(config.googleCloudLocation).toBe("us-east5");
  });

  it("hydrates Vertex project from ADC quota_project_id in a provider Secret", () => {
    const config = makeConfig({
      mode: "openshift",
      inferenceProvider: "vertex-anthropic",
      vertexEnabled: true,
      vertexProvider: "anthropic",
    });
    const credentialsJson = JSON.stringify({
      type: "authorized_user",
      quota_project_id: "quota-project",
    });

    applyProviderSecretDataDefaults(config, {
      GOOGLE_APPLICATION_CREDENTIALS_JSON: credentialsJson,
    });

    expect(config.gcpServiceAccountJson).toBe(credentialsJson);
    expect(config.googleCloudProject).toBe("quota-project");
  });

  it("does not overwrite explicit Vertex form values", () => {
    const config = makeConfig({
      mode: "openshift",
      inferenceProvider: "vertex-anthropic",
      vertexEnabled: true,
      vertexProvider: "anthropic",
      googleCloudProject: "form-project",
      googleCloudLocation: "us-west1",
      gcpServiceAccountJson: "{\"project_id\":\"form-project\"}",
    });

    applyProviderSecretDataDefaults(config, {
      GOOGLE_APPLICATION_CREDENTIALS_JSON: "{\"project_id\":\"secret-project\"}",
      GOOGLE_CLOUD_PROJECT: "secret-project",
      GOOGLE_CLOUD_LOCATION: "us-east5",
    });

    expect(config.gcpServiceAccountJson).toBe("{\"project_id\":\"form-project\"}");
    expect(config.googleCloudProject).toBe("form-project");
    expect(config.googleCloudLocation).toBe("us-west1");
  });
});

describe("normalizeVaultAddr", () => {
  it("normalizes the invalid Kubernetes service suffix seen in saved Vault config", () => {
    expect(normalizeVaultAddr("http://vault.vault.svc.cluster:8200")).toBe(
      "http://vault.vault.svc:8200",
    );
  });

  it("leaves valid service addresses unchanged", () => {
    expect(normalizeVaultAddr("http://vault.vault.svc:8200")).toBe(
      "http://vault.vault.svc:8200",
    );
    expect(normalizeVaultAddr("http://vault.vault.svc.cluster.local:8200")).toBe(
      "http://vault.vault.svc.cluster.local:8200",
    );
  });
});
