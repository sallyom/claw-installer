import { describe, it, expect } from "vitest";
import {
  applyGatewayRuntimeConfig,
  buildOpenClawConfig,
  buildRunArgs,
  parseContainerRunArgs,
  redactCommandArgs,
  resolveLocalRuntimeModelEndpoint,
  runtimeOwnershipFixupCommand,
  shouldAlwaysPull,
} from "../local.js";
import { localStateMaintenanceUserArgs } from "../local-runtime.js";
import { __testing as localPluginsTesting } from "../local-plugins.js";

describe("shouldAlwaysPull", () => {
  it("returns true for :latest tag", () => {
    expect(shouldAlwaysPull("quay.io/sallyom/openclaw:latest")).toBe(true);
  });

  it("returns true for image with no tag (implies :latest)", () => {
    expect(shouldAlwaysPull("quay.io/sallyom/openclaw")).toBe(true);
  });

  it("returns true for simple image name with :latest", () => {
    expect(shouldAlwaysPull("nginx:latest")).toBe(true);
  });

  it("returns true for simple image name with no tag", () => {
    expect(shouldAlwaysPull("nginx")).toBe(true);
  });

  it("returns false for version-pinned tag", () => {
    expect(shouldAlwaysPull("quay.io/sallyom/openclaw:v2026.3.11")).toBe(false);
  });

  it("returns false for semver tag", () => {
    expect(shouldAlwaysPull("nginx:1.25.3")).toBe(false);
  });

  it("returns false for sha-based tag", () => {
    expect(shouldAlwaysPull("quay.io/sallyom/openclaw:abc123")).toBe(false);
  });

  it("returns false for custom tag", () => {
    expect(shouldAlwaysPull("myregistry.io/app:staging")).toBe(false);
  });

  it("returns false for digest reference", () => {
    expect(shouldAlwaysPull("quay.io/sallyom/openclaw@sha256:abcdef1234567890")).toBe(false);
  });
});

describe("applyGatewayRuntimeConfig", () => {
  it("enables OpenAI-compatible HTTP endpoints while preserving gateway config", () => {
    const updated = applyGatewayRuntimeConfig({
      gateway: {
        mode: "local",
        auth: { mode: "token", token: "abc" },
        controlUi: { enabled: true },
      },
    }, 18789) as {
      gateway?: {
        mode?: string;
        auth?: { token?: string };
        controlUi?: { allowedOrigins?: string[] };
        http?: {
          endpoints?: {
            chatCompletions?: { enabled?: boolean };
            responses?: { enabled?: boolean };
          };
        };
      };
    };

    expect(updated.gateway?.mode).toBe("local");
    expect(updated.gateway?.auth?.token).toBe("abc");
    expect(updated.gateway?.http?.endpoints?.chatCompletions?.enabled).toBe(true);
    expect(updated.gateway?.http?.endpoints?.responses?.enabled).toBe(true);
    expect(updated.gateway?.controlUi?.allowedOrigins).toEqual([
      "http://localhost:18789",
      "http://127.0.0.1:18789",
    ]);
  });

  it("can disable OpenAI-compatible HTTP endpoints while preserving gateway config", () => {
    const updated = applyGatewayRuntimeConfig({
      gateway: {
        mode: "local",
        auth: { mode: "token", token: "abc" },
        controlUi: { enabled: true },
      },
    }, 18789, false) as {
      gateway?: {
        http?: {
          endpoints?: {
            chatCompletions?: { enabled?: boolean };
            responses?: { enabled?: boolean };
          };
        };
      };
    };

    expect(updated.gateway?.http?.endpoints?.chatCompletions?.enabled).toBe(false);
    expect(updated.gateway?.http?.endpoints?.responses?.enabled).toBe(false);
  });

  it("preserves remote Control UI origins while refreshing the local port", () => {
    const updated = applyGatewayRuntimeConfig({
      gateway: {
        auth: { mode: "token", token: "abc" },
        controlUi: {
          enabled: true,
          allowedOrigins: [
            "http://localhost:18789",
            "http://127.0.0.1:18789",
            "https://openclaw-device.example-tailnet.ts.net",
          ],
        },
      },
    }, 18800) as {
      gateway?: {
        mode?: string;
        controlUi?: { allowedOrigins?: string[] };
      };
    };

    expect(updated.gateway?.mode).toBe("local");
    expect(updated.gateway?.controlUi?.allowedOrigins).toEqual([
      "http://localhost:18800",
      "http://127.0.0.1:18800",
      "https://openclaw-device.example-tailnet.ts.net",
    ]);
  });
});

describe("resolveLocalRuntimeModelEndpoint", () => {
  it("rewrites localhost endpoints for podman containers", () => {
    expect(resolveLocalRuntimeModelEndpoint("http://localhost:8080/v1", "podman"))
      .toBe("http://host.containers.internal:8080/v1");
    expect(resolveLocalRuntimeModelEndpoint("http://127.0.0.1:8080/v1", "podman"))
      .toBe("http://host.containers.internal:8080/v1");
  });

  it("rewrites localhost endpoints for docker containers", () => {
    expect(resolveLocalRuntimeModelEndpoint("http://localhost:8080/v1", "docker"))
      .toBe("http://host.docker.internal:8080/v1");
  });

  it("leaves already-routable endpoints unchanged", () => {
    expect(resolveLocalRuntimeModelEndpoint("http://host.containers.internal:8080/v1", "podman"))
      .toBe("http://host.containers.internal:8080/v1");
    expect(resolveLocalRuntimeModelEndpoint("http://10.0.0.20:8080/v1", "podman"))
      .toBe("http://10.0.0.20:8080/v1");
  });
});

describe("local Vault SecretRef wiring", () => {
  it("generates Vault and OpenAI provider config for local deploys", () => {
    const rendered = JSON.parse(buildOpenClawConfig({
      mode: "local",
      agentName: "demo",
      agentDisplayName: "Demo",
      inferenceProvider: "openai",
      vaultSecretsEnabled: true,
      vaultAddr: "https://vault.example.test",
      vaultKvMount: "secret",
      vaultKvVersion: "2",
      openaiApiKeyRef: {
        source: "exec",
        provider: "vault",
        id: "providers/openai/apiKey",
      },
    }, "gateway-token"));

    expect(rendered.secrets.providers.vault).toMatchObject({
      source: "exec",
      pluginIntegration: {
        pluginId: "vault",
        integrationId: "vault",
      },
    });
    expect(rendered.plugins.allow).toEqual(expect.arrayContaining(["vault"]));
    expect(rendered.plugins.entries.vault).toEqual({ enabled: true });
    expect(rendered.models.providers.openai).toMatchObject({
      baseUrl: "https://api.openai.com/v1",
      api: "openai-responses",
      agentRuntime: { id: "pi" },
      apiKey: {
        source: "exec",
        provider: "vault",
        id: "providers/openai/apiKey",
      },
      models: [{ id: "gpt-5.5", name: "gpt-5.5" }],
    });
  });

  it("passes local Vault environment to the gateway container", () => {
    const previousToken = process.env.VAULT_TOKEN;
    process.env.VAULT_TOKEN = "test-vault-token";
    try {
      const args = buildRunArgs({
        mode: "local",
        agentName: "demo",
        agentDisplayName: "Demo",
        vaultSecretsEnabled: true,
        vaultAddr: "https://vault.example.test",
        vaultNamespace: "admin",
        vaultKvMount: "secret",
        vaultKvVersion: "2",
      }, "podman", "openclaw-demo", 18789);

      expect(args).toContain("VAULT_ADDR=https://vault.example.test");
      expect(args).toContain("VAULT_NAMESPACE=admin");
      expect(args).toContain("CLAW_VAULT_KV_MOUNT=secret");
      expect(args).toContain("CLAW_VAULT_KV_VERSION=2");
      expect(args).toContain("VAULT_TOKEN=test-vault-token");
      expect(args).toContain("TMPDIR=/home/node/.openclaw/tmp");
    } finally {
      if (previousToken === undefined) {
        delete process.env.VAULT_TOKEN;
      } else {
        process.env.VAULT_TOKEN = previousToken;
      }
    }
  });

  it("runs local gateway as configured file owner after extra run args", () => {
    const args = buildRunArgs({
      mode: "local",
      agentName: "demo",
      agentDisplayName: "Demo",
      localFileOwner: "501:20",
      containerRunArgs: "--security-opt label=disable --user 1000:1000",
    }, "podman", "openclaw-demo", 18789);

    const imageIndex = args.indexOf("ghcr.io/openclaw/openclaw:latest");
    expect(args.slice(imageIndex - 2, imageIndex)).toEqual(["--user", "501:20"]);
  });

  it("auto-installs the Vault plugin for local containers", () => {
    const plan = localPluginsTesting.localPluginInstallPlan({
      mode: "local",
      agentName: "demo",
      agentDisplayName: "Demo",
      vaultSecretsEnabled: true,
    });

    expect(plan.specs).toEqual(["git:github.com/sallyom/claw-vault"]);
  });

  it("deduplicates configured Vault plugin installs", () => {
    const plan = localPluginsTesting.localPluginInstallPlan({
      mode: "local",
      agentName: "demo",
      agentDisplayName: "Demo",
      pluginInstallSpecs: ["git:github.com/sallyom/claw-vault"],
      vaultSecretsEnabled: true,
    });

    expect(plan.specs).toEqual(["git:github.com/sallyom/claw-vault"]);
  });
});

describe("local 1Password SecretRef wiring", () => {
  it("generates 1Password and OpenRouter provider config for local deploys", () => {
    const rendered = JSON.parse(buildOpenClawConfig({
      mode: "local",
      agentName: "demo",
      agentDisplayName: "Demo",
      inferenceProvider: "openrouter",
      onePasswordSecretsEnabled: true,
      onePasswordVault: "Engineering",
      openrouterApiKeyRef: {
        source: "exec",
        provider: "onepassword",
        id: "op://Engineering/OpenRouter/apiKey",
      },
    }, "gateway-token"));

    expect(rendered.secrets.providers.onepassword).toMatchObject({
      source: "exec",
      pluginIntegration: {
        pluginId: "1password",
        integrationId: "onepassword",
      },
    });
    expect(rendered.plugins.allow).toEqual(expect.arrayContaining(["1password"]));
    expect(rendered.plugins.entries["1password"]).toEqual({ enabled: true });
    expect(rendered.models.providers.openrouter.apiKey).toEqual({
      source: "exec",
      provider: "onepassword",
      id: "op://Engineering/OpenRouter/credential",
    });
  });

  it("passes local 1Password environment to the gateway container", () => {
    const previousToken = process.env.OP_SERVICE_ACCOUNT_TOKEN;
    process.env.OP_SERVICE_ACCOUNT_TOKEN = "test-op-token";
    try {
      const args = buildRunArgs({
        mode: "local",
        agentName: "demo",
        agentDisplayName: "Demo",
        onePasswordSecretsEnabled: true,
        onePasswordVault: "Engineering",
      }, "podman", "openclaw-demo", 18789);

      expect(args).toContain("OP_SERVICE_ACCOUNT_TOKEN=test-op-token");
      expect(args).toContain("CLAW_1PASSWORD_VAULT=Engineering");
    } finally {
      if (previousToken === undefined) {
        delete process.env.OP_SERVICE_ACCOUNT_TOKEN;
      } else {
        process.env.OP_SERVICE_ACCOUNT_TOKEN = previousToken;
      }
    }
  });

  it("auto-installs the 1Password plugin for local containers", () => {
    const plan = localPluginsTesting.localPluginInstallPlan({
      mode: "local",
      agentName: "demo",
      agentDisplayName: "Demo",
      onePasswordSecretsEnabled: true,
    });

    expect(plan.specs).toEqual(["git:github.com/sallyom/claw-1password"]);
  });
});

describe("parseContainerRunArgs", () => {
  it("parses quoted runtime args into argv tokens", () => {
    expect(
      parseContainerRunArgs("--userns=keep-id -v '/tmp/my data:/data:Z' --device /dev/kvm"),
    ).toEqual([
      "--userns=keep-id",
      "-v",
      "/tmp/my data:/data:Z",
      "--device",
      "/dev/kvm",
    ]);
  });

  it("rejects unterminated quotes", () => {
    expect(() => parseContainerRunArgs("--label 'broken")).toThrow("unterminated quote");
  });
});

describe("redactCommandArgs", () => {
  it("redacts sensitive local container env vars in deploy logs", () => {
    expect(redactCommandArgs([
      "run",
      "-e",
      "VAULT_TOKEN=hvs.secret",
      "-e",
      "OPENROUTER_API_KEY=sk-or-secret",
      "-e",
      "MODEL_ENDPOINT_API_KEY=endpoint-secret",
      "-e",
      "VAULT_ADDR=https://vault.example.test",
    ])).toEqual([
      "run",
      "-e",
      "VAULT_TOKEN=***",
      "-e",
      "OPENROUTER_API_KEY=***",
      "-e",
      "MODEL_ENDPOINT_API_KEY=***",
      "-e",
      "VAULT_ADDR=https://vault.example.test",
    ]);
  });

  it("redacts shell scripts from deploy logs", () => {
    expect(redactCommandArgs([
      "run",
      "image",
      "sh",
      "-c",
      "echo 'encoded-openclaw-config' | base64 -d > /home/node/.openclaw/openclaw.json",
    ])).toEqual([
      "run",
      "image",
      "sh",
      "-c",
      "<shell script redacted>",
    ]);
  });
});

// Regression test for https://github.com/sallyom/openclaw-installer/issues/71:
// The local bootstrap command must strip world bits from the state directory
// so that other users/processes on the host cannot read gateway tokens or API
// key references from openclaw.json.
describe("runtimeOwnershipFixupCommand", () => {
  it("sets doctor-clean state directory and config file permissions after chown (issue #71)", () => {
    const cmd = runtimeOwnershipFixupCommand();

    expect(cmd).toContain("chown -R node:node /home/node/.openclaw");
    expect(cmd).toContain("chmod -R o-rwx /home/node/.openclaw");
    expect(cmd).toContain("chmod 700 /home/node/.openclaw");
    expect(cmd).toContain("chmod 600 /home/node/.openclaw/openclaw.json");

    // chmod must run AFTER chown so ownership is correct before mode change.
    const chownIdx = cmd.indexOf("chown -R node:node /home/node/.openclaw");
    const stripWorldIdx = cmd.indexOf("chmod -R o-rwx /home/node/.openclaw");
    const stateDirIdx = cmd.indexOf("chmod 700 /home/node/.openclaw");
    const configIdx = cmd.indexOf("chmod 600 /home/node/.openclaw/openclaw.json");
    expect(stripWorldIdx).toBeGreaterThan(chownIdx);
    expect(stateDirIdx).toBeGreaterThan(stripWorldIdx);
    expect(configIdx).toBeGreaterThan(stateDirIdx);
  });

  it("can target a configured local file owner", () => {
    const cmd = runtimeOwnershipFixupCommand("501:20");

    expect(cmd).toContain("chown -R 501:20 /home/node/.openclaw");
    expect(cmd).toContain("chmod -R o-rwx /home/node/.openclaw");
  });

  it("rejects invalid local file owners", () => {
    expect(() => runtimeOwnershipFixupCommand("node:node")).toThrow("expected UID or UID:GID");
  });

  it("runs maintenance containers as root so ownership can be repaired", () => {
    expect(localStateMaintenanceUserArgs()).toEqual(["--user", "0"]);
    expect(localStateMaintenanceUserArgs("501:20")).toEqual(["--user", "0"]);
  });
});
