import { describe, expect, it } from "vitest";
import { deploymentManifest, fileConfigMapManifest, fileTreeConfigMapManifest, secretManifest } from "../k8s-manifests.js";
import type { DeployConfig } from "../types.js";
import type * as k8s from "@kubernetes/client-node";

function makeConfig(overrides: Partial<DeployConfig> = {}): DeployConfig {
  return {
    mode: "kubernetes",
    prefix: "openclaw",
    agentName: "alpha",
    agentDisplayName: "Alpha",
    agentModel: "claude-sonnet-4-6",
    ...overrides,
  };
}

/** Extract env var names from the gateway container in a deployment manifest. */
function gatewayEnvNames(deployment: k8s.V1Deployment): string[] {
  const container = deployment.spec?.template.spec?.containers?.find((c) => c.name === "gateway");
  return (container?.env ?? []).map((e) => e.name);
}

function gatewayEnvMap(deployment: k8s.V1Deployment): Record<string, string | undefined> {
  const container = deployment.spec?.template.spec?.containers?.find((c) => c.name === "gateway");
  return Object.fromEntries((container?.env ?? []).map((e) => [e.name, e.value]));
}

function gatewayEnv(deployment: k8s.V1Deployment, name: string): k8s.V1EnvVar | undefined {
  const container = deployment.spec?.template.spec?.containers?.find((c) => c.name === "gateway");
  return (container?.env ?? []).find((e) => e.name === name);
}

function gatewayContainer(deployment: k8s.V1Deployment): k8s.V1Container | undefined {
  return deployment.spec?.template.spec?.containers?.find((c) => c.name === "gateway");
}

describe("k8s state sync manifests", () => {
  const config: DeployConfig = makeConfig();

  it("uses IfNotPresent for the gateway container image pull policy", () => {
    const deployment = deploymentManifest("openclaw-alpha-openclaw", config);
    const gatewayContainer = deployment.spec?.template.spec?.containers?.find((c) => c.name === "gateway");

    expect(gatewayContainer?.imagePullPolicy).toBe("IfNotPresent");
  });

  it("renders skill and cron ConfigMaps from host state entries", () => {
    const skillsCm = fileTreeConfigMapManifest("openclaw-alpha-openclaw", "openclaw-skills", [
      { key: "f0", path: "briefing-bot/SKILL.md", content: "# Briefing Bot" },
    ]);
    const cronCm = fileConfigMapManifest(
      "openclaw-alpha-openclaw",
      "openclaw-cron",
      "jobs.json",
      "{\"jobs\":[{\"name\":\"daily-brief\"}]}",
    );

    expect(skillsCm.data).toEqual({ f0: "# Briefing Bot" });
    expect(cronCm.data).toEqual({ "jobs.json": "{\"jobs\":[{\"name\":\"daily-brief\"}]}" });
  });

  it("mounts and copies skill and cron state into the PVC", () => {
    const deployment = deploymentManifest(
      "openclaw-alpha-openclaw",
      config,
      false,
      [{ key: "f0", path: "briefing-bot/SKILL.md", content: "# Briefing Bot" }],
      [{ key: "f1", path: "workspace-main/AGENTS.md", content: "# Alpha" }],
      "{\"jobs\":[{\"name\":\"daily-brief\"}]}",
    );

    const initContainer = deployment.spec?.template.spec?.initContainers?.[0];
    expect(initContainer?.command?.[2]).toContain("for dir in /agents-tree/workspace-*; do");
    expect(initContainer?.command?.[2]).toContain("cp -r /skills-src/. /home/node/.openclaw/skills/");
    expect(initContainer?.command?.[2]).toContain("cp /cron-src/jobs.json /home/node/.openclaw/cron/jobs.json");

    const volumeMounts = initContainer?.volumeMounts?.map((mount) => mount.mountPath) ?? [];
    expect(volumeMounts).toContain("/agents-tree");
    expect(volumeMounts).toContain("/skills-src");
    expect(volumeMounts).toContain("/cron-src");

    const volumes = deployment.spec?.template.spec?.volumes ?? [];
    const agentTreeVolume = volumes.find((volume) => volume.name === "agent-tree-config");
    const skillsVolume = volumes.find((volume) => volume.name === "skills-config");
    const cronVolume = volumes.find((volume) => volume.name === "cron-config");

    expect(agentTreeVolume?.configMap?.name).toBe("openclaw-agent-tree");
    expect(agentTreeVolume?.configMap?.items).toEqual([{ key: "f1", path: "workspace-main/AGENTS.md" }]);
    expect(skillsVolume?.configMap?.name).toBe("openclaw-skills");
    expect(skillsVolume?.configMap?.items).toEqual([{ key: "f0", path: "briefing-bot/SKILL.md" }]);
    expect(cronVolume?.configMap?.name).toBe("openclaw-cron");
    expect(cronVolume?.configMap?.items).toEqual([{ key: "jobs.json", path: "jobs.json" }]);
  });

  it("uses a writable PVC-backed runtime home at /home/node", () => {
    const deployment = deploymentManifest("openclaw-alpha-openclaw", config);
    const initContainer = deployment.spec?.template.spec?.initContainers?.[0];
    const gatewayContainer = deployment.spec?.template.spec?.containers?.find((c) => c.name === "gateway");
    const env = gatewayEnvMap(deployment);

    expect(initContainer?.volumeMounts?.find((mount) => mount.name === "openclaw-home")?.mountPath).toBe("/home/node");
    expect(initContainer?.command?.[2]).toContain("mkdir -p /home/node /home/node/.openclaw /home/node/.openclaw/tmp");
    expect(gatewayContainer?.volumeMounts?.find((mount) => mount.name === "openclaw-home")?.mountPath).toBe("/home/node");
    expect(env.HOME).toBe("/home/node");
    expect(env.TMPDIR).toBe("/home/node/.openclaw/tmp");
    expect(env.OPENCLAW_CONFIG_DIR).toBe("/home/node/.openclaw");
    expect(env.OPENCLAW_STATE_DIR).toBe("/home/node/.openclaw");
    expect(env.NPM_CONFIG_CACHE).toBe("/home/node/.npm");
    expect(env.XDG_CACHE_HOME).toBe("/home/node/.cache");
    expect(env.XDG_CONFIG_HOME).toBe("/home/node/.config");
  });

  it("installs the external OpenShell plugin and registers the baked OpenShell CLI when enabled", () => {
    const deployment = deploymentManifest(
      "openclaw-alpha-openclaw",
      makeConfig({
        sandboxEnabled: true,
        sandboxBackend: "openshell",
        sandboxOpenShellGatewayEndpoint: "http://openshell.openshell-alpha.svc.cluster.local:8080",
      }),
    );

    const initContainers = deployment.spec?.template.spec?.initContainers ?? [];
    const pluginInit = initContainers.find((container) => container.name === "install-openclaw-plugins");
    const gatewayContainer = deployment.spec?.template.spec?.containers?.find((c) => c.name === "gateway");
    const volumes = deployment.spec?.template.spec?.volumes ?? [];

    expect(pluginInit?.image).toBe("quay.io/sallyom/openclaw:latest");
    expect(gatewayContainer?.image).toBe("quay.io/sallyom/openclaw:latest");
    expect(pluginInit?.command?.[2]).toContain("node openclaw.mjs plugins install '@openclaw/openshell-sandbox' --force");
    expect(pluginInit?.command?.[2]).toContain("node openclaw.mjs plugins list | grep -q openshell");
    expect(initContainers.find((container) => container.name === "install-openshell-plugin")).toBeUndefined();
    expect(initContainers.find((container) => container.name === "install-openshell-cli")).toBeUndefined();
    expect(pluginInit?.env).toEqual(
      expect.arrayContaining([
        { name: "HOME", value: "/home/node" },
        { name: "TMPDIR", value: "/home/node/.openclaw/tmp" },
        { name: "OPENCLAW_CONFIG_DIR", value: "/home/node/.openclaw" },
        { name: "OPENCLAW_STATE_DIR", value: "/home/node/.openclaw" },
      ]),
    );
    expect(pluginInit?.volumeMounts).toEqual(
      expect.arrayContaining([
        { name: "openclaw-home", mountPath: "/home/node" },
        { name: "tmp-volume", mountPath: "/tmp" },
      ]),
    );
    expect(gatewayContainer?.command?.[2]).toContain("/opt/openshell/bin/openshell gateway remove openshell");
    expect(gatewayContainer?.command?.[2]).toContain("/opt/openshell/bin/openshell gateway add \"${OPENSHELL_GATEWAY_ENDPOINT}\" --local --name openshell");
    expect(gatewayContainer?.command?.[2]).toContain("/opt/openshell/bin/openshell -g openshell status");
    expect(deployment.spec?.template.spec?.initContainers?.[0]?.command?.[2]).toContain("cat > /home/node/.openclaw/openshell/policy.yaml");
    expect(deployment.spec?.template.spec?.initContainers?.[0]?.command?.[2]).toContain("- /home/sandbox");
    expect(gatewayContainer?.env).toEqual(
      expect.arrayContaining([
        {
          name: "OPENSHELL_GATEWAY_ENDPOINT",
          value: "http://openshell.openshell-alpha.svc.cluster.local:8080",
        },
      ]),
    );
    expect(gatewayContainer?.volumeMounts).not.toEqual(
      expect.arrayContaining([{ name: "openshell-cli", mountPath: "/opt/openshell", readOnly: true }]),
    );
    expect(volumes).not.toEqual(expect.arrayContaining([{ name: "openshell-cli", emptyDir: {} }]));
  });

  it("installs configured OpenClaw plugins before gateway startup", () => {
    const deployment = deploymentManifest(
      "openclaw-alpha-openclaw",
      makeConfig({
        pluginInstallSpecs: ["git:github.com/sallyom/claw-vault", "/app/extensions/vault"],
      }),
    );

    const initContainers = deployment.spec?.template.spec?.initContainers ?? [];
    const pluginInit = initContainers.find((container) => container.name === "install-openclaw-plugins");

    expect(pluginInit?.image).toBe("ghcr.io/openclaw/openclaw:latest");
    expect(pluginInit?.command?.[2]).toContain("node openclaw.mjs plugins install 'git:github.com/sallyom/claw-vault' --force");
    expect(pluginInit?.command?.[2]).toContain("node openclaw.mjs plugins install '/app/extensions/vault' --force");
    expect(pluginInit?.command?.[2]).toContain("continuing. Run openclaw doctor after install.");
    expect(pluginInit?.command?.[2]).not.toContain("vault-secret-ref-resolver.js");
    expect(pluginInit?.command?.[2]).toContain("node openclaw.mjs plugins list || true");
    expect(pluginInit?.env).toEqual(
      expect.arrayContaining([
        { name: "HOME", value: "/home/node" },
        { name: "OPENCLAW_CONFIG_DIR", value: "/home/node/.openclaw" },
        { name: "OPENCLAW_STATE_DIR", value: "/home/node/.openclaw" },
      ]),
    );
    expect(pluginInit?.volumeMounts).toEqual(
      expect.arrayContaining([
        { name: "openclaw-home", mountPath: "/home/node" },
        { name: "tmp-volume", mountPath: "/tmp" },
      ]),
    );
  });

  it("installs the Vault plugin when Vault SecretRefs are enabled", () => {
    const deployment = deploymentManifest(
      "openclaw-alpha-openclaw",
      makeConfig({
        vaultSecretsEnabled: true,
      }),
    );

    const initContainers = deployment.spec?.template.spec?.initContainers ?? [];
    const pluginInit = initContainers.find((container) => container.name === "install-openclaw-plugins");

    expect(pluginInit?.command?.[2]).toContain("node openclaw.mjs plugins install 'git:github.com/sallyom/claw-vault' --force");
  });

  it("installs the Anthropic Vertex provider plugin for direct Claude Vertex mode", () => {
    const deployment = deploymentManifest(
      "openclaw-alpha-openclaw",
      makeConfig({
        inferenceProvider: "vertex-anthropic",
        vertexEnabled: true,
        vertexProvider: "anthropic",
        litellmProxy: false,
        googleCloudProject: "test-project",
        googleCloudLocation: "us-east5",
      }),
    );

    const initContainers = deployment.spec?.template.spec?.initContainers ?? [];
    const pluginInit = initContainers.find((container) => container.name === "install-openclaw-plugins");
    const containers = deployment.spec?.template.spec?.containers ?? [];

    expect(pluginInit?.command?.[2]).toContain("node openclaw.mjs plugins install '@openclaw/anthropic-vertex-provider' --force");
    expect(pluginInit?.command?.[2]).toContain("node openclaw.mjs plugins list | grep -q 'anthropic-vertex'");
    expect(containers.some((container) => container.name === "litellm")).toBe(false);
  });

  it("does not install the Anthropic Vertex provider plugin when LiteLLM handles Claude Vertex", () => {
    const deployment = deploymentManifest(
      "openclaw-alpha-openclaw",
      makeConfig({
        inferenceProvider: "vertex-anthropic",
        vertexEnabled: true,
        vertexProvider: "anthropic",
        litellmProxy: true,
        googleCloudProject: "test-project",
        googleCloudLocation: "us-east5",
      }),
    );

    const initContainers = deployment.spec?.template.spec?.initContainers ?? [];
    const pluginInit = initContainers.find((container) => container.name === "install-openclaw-plugins");
    const containers = deployment.spec?.template.spec?.containers ?? [];

    expect(pluginInit).toBeUndefined();
    expect(containers.some((container) => container.name === "litellm")).toBe(true);
  });

  it("migrates the legacy PVC-root state layout into the runtime home", () => {
    const deployment = deploymentManifest("openclaw-alpha-openclaw", config);
    const initScript = deployment.spec?.template.spec?.initContainers?.[0]?.command?.[2] ?? "";

    expect(initScript).toContain("if [ -f /home/node/openclaw.json ] || [ -d /home/node/workspace ]; then");
    expect(initScript).toContain("case \"$base\" in .|..|.openclaw|gcp|lost+found) continue ;; esac");
    expect(initScript).toContain("mv \"$path\" \"/home/node/.openclaw/$base\"");
  });

  it("provisions the managed Vault helper in the writable home volume", () => {
    const deployment = deploymentManifest("openclaw-alpha-openclaw", config);
    const initContainer = deployment.spec?.template.spec?.initContainers?.[0];
    const initScript = initContainer?.command?.[2] ?? "";

    expect(initScript).toContain("cat > /home/node/.openclaw/bin/openclaw-vault <<'EOF_VAULT_HELPER'");
    expect(initScript).toContain("#!/usr/local/bin/node");
    expect(initScript).not.toContain("EOF_NODE");
    expect(initScript).toContain("env.HOME = env.HOME || '/home/node';");
    expect(initScript).toContain("vault kubernetes auth");
    expect(initScript).toContain("chmod 0755 /home/node/.openclaw/bin/openclaw-vault");
  });

  it("does not copy external Vault resolver files into generated provider paths", () => {
    const deployment = deploymentManifest(
      "openclaw-alpha-openclaw",
      makeConfig({
        vaultSecretsEnabled: true,
      }),
    );
    const initContainer = deployment.spec?.template.spec?.initContainers?.[0];
    const initScript = initContainer?.command?.[2] ?? "";

    expect(initScript).not.toContain("/home/node/.openclaw/extensions/vault/vault-secret-ref-resolver.js");
    expect(initScript).not.toContain("find /home/node/.openclaw/git /home/node/.openclaw/npm/node_modules");
  });

  it("writes SecretRef-backed auth profiles into each managed agent directory", () => {
    const config = makeConfig({
      anthropicApiKeyRef: {
        source: "exec",
        provider: "vault",
        id: "providers/anthropic/apiKey",
      },
      openaiApiKeyRef: {
        source: "exec",
        provider: "vault",
        id: "providers/openai/apiKey",
      },
    });
    const secret = secretManifest("openclaw-alpha-openclaw", config, "gateway-token");
    const deployment = deploymentManifest(
      "openclaw-alpha-openclaw",
      config,
    );
    const initContainer = deployment.spec?.template.spec?.initContainers?.[0];
    const initScript = initContainer?.command?.[2] ?? "";
    const gateway = gatewayContainer(deployment);
    const gatewayScript = gateway?.command?.[2] ?? "";
    const gatewayVolumeMounts = gateway?.volumeMounts?.map((mount) => mount.mountPath) ?? [];

    expect(secret.stringData?.OPENAI_CODEX_AUTH_PROFILES_JSON).toContain('"anthropic:default"');
    expect(secret.stringData?.OPENAI_CODEX_AUTH_PROFILES_JSON).toContain('"openai:default"');
    expect(secret.stringData?.OPENAI_CODEX_AUTH_PROFILES_JSON).toContain('"provider": "vault"');
    expect(secret.stringData?.OPENAI_CODEX_AUTH_PROFILES_JSON).toContain('"id": "providers/anthropic/apiKey"');
    expect(secret.stringData?.OPENAI_CODEX_AUTH_PROFILES_JSON).toContain('"id": "providers/openai/apiKey"');
    expect(initScript).not.toContain("auth-profiles.json");
    expect(initScript).not.toContain("/openclaw-secrets/OPENAI_CODEX_AUTH_PROFILES_JSON");
    expect(gatewayVolumeMounts).toContain("/openclaw-secrets");
    expect(gatewayScript).toContain("/openclaw-secrets/OPENAI_CODEX_AUTH_PROFILES_JSON");
    expect(gatewayScript).toContain("openclaw-agent.sqlite");
    expect(gatewayScript).toContain("auth_profile_store");
    expect(gatewayScript).toContain('"openclaw-alpha"');
    expect(gatewayScript).not.toContain("doctor --non-interactive --fix");
  });

  it("creates the session store directory for each managed agent", () => {
    const deployment = deploymentManifest(
      "openclaw-alpha-openclaw",
      makeConfig({
        agentSourceDir: "/tmp/does-not-exist",
      }),
      false,
      [],
      [],
    );
    const initScript = deployment.spec?.template.spec?.initContainers?.[0]?.command?.[2] ?? "";

    expect(initScript).toContain("mkdir -p /home/node/.openclaw/agents/openclaw-alpha/sessions");
  });

  it("stores imported Codex OAuth profiles in the Secret instead of the init command", () => {
    const codexAuthJson = JSON.stringify({
      auth_mode: "chatgpt",
      tokens: {
        access_token: "codex-access-token",
        refresh_token: "codex-refresh-token",
        account_id: "acct_123",
      },
    });
    const codexConfig = makeConfig({
      inferenceProvider: "openai-codex",
      codexOauthAuthJson: codexAuthJson,
      codexOauthProfileId: "openai-codex:default",
      codexModel: "gpt-5.4",
    });

    const secret = secretManifest("openclaw-alpha-openclaw", codexConfig, "gateway-token");
    const deployment = deploymentManifest("openclaw-alpha-openclaw", codexConfig);
    const initScript = deployment.spec?.template.spec?.initContainers?.[0]?.command?.[2] ?? "";
    const gatewayScript = gatewayContainer(deployment)?.command?.[2] ?? "";

    expect(secret.stringData?.OPENAI_CODEX_AUTH_PROFILES_JSON).toContain('"openai:chatgpt-default"');
    expect(secret.stringData?.OPENAI_CODEX_AUTH_PROFILES_JSON).toContain("codex-refresh-token");
    expect(gatewayScript).toContain("/openclaw-secrets/OPENAI_CODEX_AUTH_PROFILES_JSON");
    expect(initScript).not.toContain("/openclaw-secrets/OPENAI_CODEX_AUTH_PROFILES_JSON");
    expect(initScript).not.toContain("codex-refresh-token");
  });

  it("does not install the external Codex plugin for a Codex OAuth gateway", () => {
    const deployment = deploymentManifest(
      "openclaw-alpha-openclaw",
      makeConfig({
        inferenceProvider: "vertex-anthropic",
        codexModel: "gpt-5.5",
      }),
    );

    const names = deployment.spec?.template.spec?.initContainers?.map((container) => container.name) ?? [];

    expect(names).not.toContain("install-codex-plugin");
  });

  it("does not install the Codex plugin when Codex OAuth is not configured", () => {
    const deployment = deploymentManifest("openclaw-alpha-openclaw", config);
    const names = deployment.spec?.template.spec?.initContainers?.map((container) => container.name) ?? [];

    expect(names).not.toContain("install-codex-plugin");
  });

  it("uses the dedicated openclaw service account for non-A2A deployments", () => {
    const deployment = deploymentManifest("openclaw-alpha-openclaw", config);
    expect(deployment.spec?.template?.spec?.serviceAccountName).toBe("openclaw");
  });

  it("volume indices used by redeploy match the deployment manifest order", () => {
    // Regression test for #131: redeploy() uses hardcoded JSON Patch indices
    // to update specific volume ConfigMaps. If volumes are reordered or new
    // volumes are inserted, these indices must be updated to match.
    const deployment = deploymentManifest("openclaw-alpha-openclaw", config);
    const volumes = deployment.spec?.template.spec?.volumes ?? [];

    // These are the indices redeploy() patches — keep in sync with kubernetes.ts
    expect(volumes[4]?.name).toBe("skills-config");
    expect(volumes[4]?.configMap?.name).toBe("openclaw-skills");

    expect(volumes[5]?.name).toBe("cron-config");
    expect(volumes[5]?.configMap?.name).toBe("openclaw-cron");

    expect(volumes[7]?.name).toBe("agent-tree-config");
    expect(volumes[7]?.configMap?.name).toBe("openclaw-agent-tree");
  });
});

// Regression test for #62: workspace-shadowman not recognized as main agent workspace
describe("workspace routing in init script", () => {
  it("does not hard-code workspace-main in the init script", () => {
    const deployment = deploymentManifest("ns", makeConfig());
    const initContainer = deployment.spec?.template.spec?.initContainers?.[0];
    const initScript = initContainer?.command?.[2] ?? "";

    // The old bug: init script contained a hard-coded check for "workspace-main"
    // which caused persona-named workspaces (e.g. workspace-shadowman) to be
    // copied to dead paths. The fix uses bundle-aware routing instead.
    expect(initScript).not.toContain('"workspace-main"');
    expect(initScript).not.toContain("= \"workspace-main\"");
  });

  it("still copies workspace-* directories via a shell loop", () => {
    const deployment = deploymentManifest("ns", makeConfig());
    const initContainer = deployment.spec?.template.spec?.initContainers?.[0];
    const initScript = initContainer?.command?.[2] ?? "";

    expect(initScript).toContain("for dir in /agents-tree/workspace-*; do");
    expect(initScript).toContain("[ -d \"$dir\" ] || continue");
  });
});

// Regression test for #63: workspace copy must not depend on findutils in minimal init images
describe("workspace copy in init script", () => {
  it("copies workspace projections without find", () => {
    const deployment = deploymentManifest("ns", makeConfig());
    const initContainer = deployment.spec?.template.spec?.initContainers?.[0];
    const initScript = initContainer?.command?.[2] ?? "";

    expect(initScript).toContain("for dir in /agents-tree/workspace-*; do");
    expect(initScript).toContain("cp -r \"$dir\"/. \"$dest\"/");
    expect(initScript).not.toContain("find -L /agents-tree");
  });

  it("uses ownership and group permissions that work on Kind and OpenShift", () => {
    const deployment = deploymentManifest("ns", makeConfig());
    const initContainer = deployment.spec?.template.spec?.initContainers?.[0];
    const initScript = initContainer?.command?.[2] ?? "";

    expect(initScript).toContain("chown -R 1000:0 /home/node/.openclaw");
    expect(initScript).toContain("chmod -R g=u /home/node/.openclaw");
    expect(initScript).toContain("chmod 0755 /home/node/.openclaw/bin/openclaw-vault");
    expect(initScript).not.toContain("chown -R 1000:1000 /home/node/.openclaw");
  });

  it("creates per-agent memory and skills directories in workspaces", () => {
    const deployment = deploymentManifest("ns", makeConfig());
    const initContainer = deployment.spec?.template.spec?.initContainers?.[0];
    const initScript = initContainer?.command?.[2] ?? "";

    expect(initScript).toContain("mkdir -p /home/node/.openclaw/workspace-openclaw-alpha/memory");
    expect(initScript).toContain("mkdir -p /home/node/.openclaw/workspace-openclaw-alpha/skills");
    expect(initScript).toContain('mkdir -p "$dest/memory" "$dest/skills"');
  });

  // Regression test for https://github.com/sallyom/openclaw-installer/issues/71:
  // openclaw.json contains gateway tokens and API key refs — it must not be
  // world-readable, and the state directory must not be world-writable.
  it("strips world bits from the state directory and config file (issue #71)", () => {
    const deployment = deploymentManifest("ns", makeConfig());
    const initContainer = deployment.spec?.template.spec?.initContainers?.[0];
    const initScript = initContainer?.command?.[2] ?? "";

    // openclaw.json must start at 600, not 644, so even before the g=u pass
    // the file is not world-readable.
    expect(initScript).toContain("chmod 600 /home/node/.openclaw/openclaw.json");
    expect(initScript).not.toContain("chmod 644 /home/node/.openclaw/openclaw.json");

    // World bits must be stripped after the g=u pass.
    expect(initScript).toContain("chmod -R o-rwx /home/node/.openclaw");

    // Stripping world bits must happen BEFORE the vault binary re-open so the
    // binary's world-execute bit is intentionally restored.
    const oRwxIdx = initScript.indexOf("chmod -R o-rwx /home/node/.openclaw");
    const configChmodIdx = initScript.indexOf("chmod 600 /home/node/.openclaw/openclaw.json", oRwxIdx);
    const vaultChmodIdx = initScript.indexOf("chmod 0755 /home/node/.openclaw/bin/openclaw-vault", oRwxIdx);
    expect(oRwxIdx).toBeGreaterThan(-1);
    expect(configChmodIdx).toBeGreaterThan(oRwxIdx);
    expect(vaultChmodIdx).toBeGreaterThan(oRwxIdx);
  });
});

// Gateway always gets provider API keys — LiteLLM only handles Vertex,
// secondary providers (OpenAI, Anthropic) are routed directly by the gateway.
describe("gateway env vars in proxy mode", () => {
  it("includes ANTHROPIC_API_KEY and OPENAI_API_KEY even when litellm proxy is active", () => {
    const proxyConfig = makeConfig({
      inferenceProvider: "vertex-anthropic",
      litellmProxy: true,
      anthropicApiKey: "fake-anthropic-key",
      openaiApiKey: "fake-openai-key",
      gcpServiceAccountJson: '{"project_id":"test"}',
    });

    const deployment = deploymentManifest("ns", proxyConfig);
    const envNames = gatewayEnvNames(deployment);

    expect(envNames).toContain("ANTHROPIC_API_KEY");
    expect(envNames).toContain("OPENAI_API_KEY");
  });

  it("includes ANTHROPIC_API_KEY and OPENAI_API_KEY when proxy is not active", () => {
    const directConfig = makeConfig({
      inferenceProvider: "anthropic",
      anthropicApiKey: "fake-anthropic-key",
      openaiApiKey: "fake-openai-key",
    });

    const deployment = deploymentManifest("ns", directConfig);
    const envNames = gatewayEnvNames(deployment);

    expect(envNames).toContain("ANTHROPIC_API_KEY");
    expect(envNames).toContain("OPENAI_API_KEY");
  });

  it("mounts an existing provider Secret as gateway environment", () => {
    const deployment = deploymentManifest("ns", makeConfig({
      providerSecretName: "openclaw-provider-secrets",
    }));

    expect(gatewayContainer(deployment)?.envFrom).toEqual([
      { secretRef: { name: "openclaw-provider-secrets", optional: true } },
    ]);
  });

  it("materializes default env SecretRefs into the backing Secret data", () => {
    const config = makeConfig({
      inferenceProvider: "openai",
      openaiApiKey: "fake-openai-key",
      openaiApiKeyRef: {
        source: "env",
        provider: "default",
        id: "OPENAI_API_KEY",
      },
      telegramBotToken: "123:abc",
      telegramBotTokenRef: {
        source: "env",
        provider: "default",
        id: "TELEGRAM_BOT_TOKEN",
      },
    });

    const secret = secretManifest("ns", config, "gateway-token");

    expect(secret.stringData?.OPENAI_API_KEY).toBe("fake-openai-key");
    expect(secret.stringData?.TELEGRAM_BOT_TOKEN).toBe("123:abc");
  });

  it("materializes Google credentials into the backing Secret data", () => {
    const config = makeConfig({
      inferenceProvider: "google",
      googleApiKey: "google-key",
      googleApiKeyRef: {
        source: "env",
        provider: "default",
        id: "GOOGLE_API_KEY",
      },
    });

    const secret = secretManifest("ns", config, "gateway-token");

    expect(secret.stringData?.GOOGLE_API_KEY).toBe("google-key");
    expect(secret.stringData?.GEMINI_API_KEY).toBeUndefined();
  });

  it("materializes custom env/default SecretRef ids into the backing Secret data", () => {
    const config = makeConfig({
      inferenceProvider: "openai",
      openaiApiKey: "fake-openai-key",
      openaiApiKeyRef: {
        source: "env",
        provider: "default",
        id: "JOY_OPENAI_API_KEY",
      },
      telegramBotToken: "123:abc",
      telegramBotTokenRef: {
        source: "env",
        provider: "default",
        id: "JOY_TELEGRAM_BOT_TOKEN",
      },
    });

    const secret = secretManifest("ns", config, "gateway-token");

    expect(secret.stringData?.JOY_OPENAI_API_KEY).toBe("fake-openai-key");
    expect(secret.stringData?.JOY_TELEGRAM_BOT_TOKEN).toBe("123:abc");
    expect(secret.stringData?.OPENAI_API_KEY).toBeUndefined();
    expect(secret.stringData?.TELEGRAM_BOT_TOKEN).toBeUndefined();
  });

  it("excludes GOOGLE_CLOUD_PROJECT and GOOGLE_CLOUD_LOCATION when proxy is active", () => {
    const proxyConfig = makeConfig({
      inferenceProvider: "vertex-anthropic",
      litellmProxy: true,
      gcpServiceAccountJson: '{"project_id":"test"}',
    });

    const deployment = deploymentManifest("ns", proxyConfig);
    const envNames = gatewayEnvNames(deployment);

    expect(envNames).not.toContain("GOOGLE_CLOUD_PROJECT");
    expect(envNames).not.toContain("GOOGLE_CLOUD_LOCATION");
  });

  it("injects Vault plugin runtime env vars from the configured token Secret", () => {
    const config = makeConfig({
      vaultSecretsEnabled: true,
      vaultAddr: "http://vault.vault.svc:8200",
      vaultNamespace: "admin",
      vaultKvMount: "secret",
      vaultKvVersion: "2",
      vaultTokenSecretName: "openclaw-vault-token",
      vaultTokenSecretKey: "token",
    });

    const deployment = deploymentManifest("ns", config);
    const env = gatewayEnvMap(deployment);

    expect(env.VAULT_ADDR).toBe("http://vault.vault.svc:8200");
    expect(env.VAULT_NAMESPACE).toBe("admin");
    expect(env.OPENCLAW_VAULT_KV_MOUNT).toBe("secret");
    expect(env.OPENCLAW_VAULT_KV_VERSION).toBe("2");
    expect(env.CLAW_VAULT_KV_MOUNT).toBe("secret");
    expect(env.CLAW_VAULT_KV_VERSION).toBe("2");
    expect(gatewayEnv(deployment, "VAULT_TOKEN")?.valueFrom?.secretKeyRef).toEqual({
      name: "openclaw-vault-token",
      key: "token",
    });
  });

  it("wires Vault Kubernetes auth without a token Secret", () => {
    const config = makeConfig({
      vaultSecretsEnabled: true,
      vaultAddr: "http://vault.vault.svc:8200",
      vaultKvMount: "secret",
      vaultKvVersion: "2",
      vaultAuthMethod: "kubernetes",
      vaultAuthRole: "openclaw",
    });

    const deployment = deploymentManifest("ns", config);
    const env = gatewayEnvMap(deployment);
    const envNames = gatewayEnvNames(deployment);

    expect(env.OPENCLAW_VAULT_AUTH_METHOD).toBe("kubernetes");
    expect(env.OPENCLAW_VAULT_AUTH_ROLE).toBe("openclaw");
    expect(envNames).not.toContain("VAULT_TOKEN");
  });

  it("wires Vault JWT auth with role and JWT file", () => {
    const config = makeConfig({
      vaultSecretsEnabled: true,
      vaultAddr: "http://vault.vault.svc:8200",
      vaultKvMount: "secret",
      vaultKvVersion: "2",
      vaultAuthMethod: "jwt",
      vaultAuthRole: "openclaw",
      vaultAuthMount: "oidc",
      vaultJwtFile: "/var/run/secrets/openclaw/vault-jwt",
    });

    const deployment = deploymentManifest("ns", config);
    const env = gatewayEnvMap(deployment);
    const envNames = gatewayEnvNames(deployment);

    expect(env.OPENCLAW_VAULT_AUTH_METHOD).toBe("jwt");
    expect(env.OPENCLAW_VAULT_AUTH_ROLE).toBe("openclaw");
    expect(env.OPENCLAW_VAULT_AUTH_MOUNT).toBe("oidc");
    expect(env.OPENCLAW_VAULT_JWT_FILE).toBe("/var/run/secrets/openclaw/vault-jwt");
    expect(envNames).not.toContain("VAULT_TOKEN");
  });

  it("installs the 1Password plugin and injects its token Secret", () => {
    const config = makeConfig({
      onePasswordSecretsEnabled: true,
      onePasswordVault: "Engineering",
      onePasswordTokenSecretName: "openclaw-1password-token",
      onePasswordTokenSecretKey: "token",
    });

    const deployment = deploymentManifest("ns", config);
    const initContainers = deployment.spec?.template.spec?.initContainers ?? [];
    const cliInit = initContainers.find((container) => container.name === "install-1password-cli");
    const pluginInit = initContainers.find((container) => container.name === "install-openclaw-plugins");
    const env = gatewayEnvMap(deployment);

    expect(cliInit?.image).toBe("docker.io/1password/op:2");
    expect(cliInit?.command?.[2]).toContain("cp \"$op_path\" /home/node/.openclaw/bin/op");
    expect(cliInit?.command?.[2]).toContain("chmod 0700 /home/node/.config/op");
    expect(cliInit?.command?.[2]).toContain("find /home/node/.config/op -type f -exec chmod 0600 {} +");
    expect(cliInit?.command?.[2]).toContain("exec /home/node/.openclaw/bin/op --config /home/node/.config/op \"$@\"");
    expect(cliInit?.volumeMounts).toEqual(
      expect.arrayContaining([
        { name: "openclaw-home", mountPath: "/home/node" },
        { name: "tmp-volume", mountPath: "/tmp" },
      ]),
    );
    expect(pluginInit?.command?.[2]).toContain("node openclaw.mjs plugins install 'git:github.com/sallyom/claw-1password' --force");
    expect(env.CLAW_1PASSWORD_VAULT).toBe("Engineering");
    expect(env.CLAW_1PASSWORD_OP).toBe("/home/node/.openclaw/bin/openclaw-op");
    expect(gatewayEnv(deployment, "OP_SERVICE_ACCOUNT_TOKEN")?.valueFrom?.secretKeyRef).toEqual({
      name: "openclaw-1password-token",
      key: "token",
    });
  });
});

/** Extract env var names from the LiteLLM sidecar container in a deployment manifest. */
function litellmEnvNames(deployment: k8s.V1Deployment): string[] {
  const container = deployment.spec?.template.spec?.containers?.find((c) => c.name === "litellm");
  return (container?.env ?? []).map((e) => e.name);
}

// LiteLLM sidecar only handles Vertex — no secondary provider keys needed
describe("litellm sidecar env vars in proxy mode", () => {
  it("does not inject secondary provider keys into litellm sidecar", () => {
    const config = makeConfig({
      inferenceProvider: "vertex-anthropic",
      litellmProxy: true,
      gcpServiceAccountJson: '{"project_id":"test"}',
      openaiApiKey: "fake-openai-key",
      anthropicApiKey: "fake-anthropic-key",
    });

    const deployment = deploymentManifest("ns", config);
    const envNames = litellmEnvNames(deployment);

    // LiteLLM only needs GCP creds for Vertex
    expect(envNames).toContain("GOOGLE_APPLICATION_CREDENTIALS");
    expect(envNames).not.toContain("OPENAI_API_KEY");
    expect(envNames).not.toContain("ANTHROPIC_API_KEY");
  });

  it("gateway gets secondary keys even in proxy mode", () => {
    const config = makeConfig({
      inferenceProvider: "vertex-anthropic",
      litellmProxy: true,
      gcpServiceAccountJson: '{"project_id":"test"}',
      openaiApiKey: "fake-openai-key",
      anthropicApiKey: "fake-anthropic-key",
    });

    const deployment = deploymentManifest("ns", config);
    const gwEnvNames = gatewayEnvNames(deployment);

    // Gateway routes to OpenAI/Anthropic directly
    expect(gwEnvNames).toContain("OPENAI_API_KEY");
    expect(gwEnvNames).toContain("ANTHROPIC_API_KEY");
  });

  it("injects placeholder MODEL_ENDPOINT_API_KEY in Secret for keyless custom endpoints", () => {
    const config = makeConfig({
      inferenceProvider: "custom-endpoint",
      modelEndpoint: "http://vllm.local:8000/v1",
      modelEndpointModel: "mistral-small",
    });

    const secret = secretManifest("ns", config, "gateway-token");

    expect(secret.stringData?.MODEL_ENDPOINT_API_KEY).toBe("no-key-required");
    expect(secret.stringData?.MODEL_ENDPOINT).toBe("http://vllm.local:8000/v1");
  });

  it("uses real API key in Secret when provided for custom endpoints", () => {
    const config = makeConfig({
      inferenceProvider: "custom-endpoint",
      modelEndpoint: "http://vllm.local:8000/v1",
      modelEndpointApiKey: "real-key",
      modelEndpointModel: "mistral-small",
    });

    const secret = secretManifest("ns", config, "gateway-token");

    expect(secret.stringData?.MODEL_ENDPOINT_API_KEY).toBe("real-key");
  });
});
