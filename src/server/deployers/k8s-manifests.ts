import * as k8s from "@kubernetes/client-node";
import {
  defaultImage,
  agentId,
  tryParseProjectId,
  buildOpenClawConfig,
  buildManagedAgentAuthProfilesSecretJson,
  resolveEnvSecretRefId,
} from "./k8s-helpers.js";
import type { DeployConfig } from "./types.js";
import { shouldUseLitellmProxy, LITELLM_IMAGE, LITELLM_PORT } from "./litellm.js";
import { shouldUseOtel, OTEL_COLLECTOR_IMAGE, OTEL_GRPC_PORT, OTEL_HTTP_PORT, otelAgentEnv } from "./otel.js";
import { shouldUseChromiumSidecar, CHROMIUM_IMAGE, CHROMIUM_CDP_PORT, chromiumAgentEnv } from "./chromium.js";
import { ANTHROPIC_VERTEX_PROVIDER } from "./openclaw-compat.js";
import type { TreeEntry } from "../state-tree.js";
import { loadAgentSourceBundle, mainWorkspaceShellCondition } from "./agent-source.js";
import {
  buildManagedVaultHelperScript,
  DEFAULT_VAULT_ADDR,
  MANAGED_VAULT_HELPER_PATH,
  OPENCLAW_SERVICE_ACCOUNT_NAME,
} from "./vault-helper.js";
import { CODEX_AUTH_PROFILES_SECRET_KEY } from "./codex-oauth.js";
import { OPEN_SHELL_POLICY_PATH, OPEN_SHELL_POLICY_YAML } from "./sandbox.js";

export const OPENCLAW_HOME_VOLUME_MOUNT = "/home/node";
export const OPENCLAW_RUNTIME_HOME = OPENCLAW_HOME_VOLUME_MOUNT;
export const OPENCLAW_RUNTIME_DIR = `${OPENCLAW_RUNTIME_HOME}/.openclaw`;
export const OPENCLAW_RUNTIME_TMP_DIR = `${OPENCLAW_RUNTIME_DIR}/tmp`;
const OPENSHELL_CLI_PATH = "/opt/openshell/bin/openshell";
const OPENSHELL_PLUGIN_SPEC = "@openclaw/openshell-sandbox";
const ANTHROPIC_VERTEX_PLUGIN_SPEC = "@openclaw/anthropic-vertex-provider";
const VAULT_PLUGIN_SPEC = "git:github.com/sallyom/claw-vault";
const ONEPASSWORD_PLUGIN_SPEC = "git:github.com/sallyom/claw-1password";
const ONEPASSWORD_CLI_IMAGE = "docker.io/1password/op:2";
const ONEPASSWORD_CLI_BINARY_PATH = `${OPENCLAW_RUNTIME_DIR}/bin/op`;
const ONEPASSWORD_CLI_PATH = `${OPENCLAW_RUNTIME_DIR}/bin/openclaw-op`;
const ONEPASSWORD_CONFIG_DIR = `${OPENCLAW_RUNTIME_HOME}/.config/op`;

function configuredPluginInstallSpecs(config: DeployConfig): string[] {
  const seen = new Set<string>();
  const specs: string[] = [];
  for (const spec of [
    ...(config.pluginInstallSpecs ?? []),
    ...(config.vaultSecretsEnabled ? [VAULT_PLUGIN_SPEC] : []),
    ...(config.onePasswordSecretsEnabled ? [ONEPASSWORD_PLUGIN_SPEC] : []),
    ...(usesDirectAnthropicVertex(config) ? [ANTHROPIC_VERTEX_PLUGIN_SPEC] : []),
    ...(usesOpenShellSandbox(config) ? [OPENSHELL_PLUGIN_SPEC] : []),
  ]) {
    const trimmed = spec.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    specs.push(trimmed);
  }
  return specs;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function pluginInstallCommand(spec: string): string {
  const quotedSpec = shellQuote(spec);
  return [
    `node openclaw.mjs plugins install ${quotedSpec} --force || {`,
    `  echo "WARNING: OpenClaw plugin install failed for ${quotedSpec}; continuing. Run openclaw doctor after install." >&2`,
    "  true",
    "}",
  ].join("\n");
}

function usesOpenShellSandbox(config: DeployConfig): boolean {
  return Boolean(config.sandboxEnabled && config.sandboxBackend === "openshell");
}

function usesDirectAnthropicVertex(config: DeployConfig): boolean {
  if (shouldUseLitellmProxy(config)) {
    return false;
  }
  return config.inferenceProvider === "vertex-anthropic"
    || Boolean(config.vertexEnabled && config.vertexProvider === "anthropic");
}

function openShellGatewayRegistrationScript(): string {
  return `
if [ -z "\${OPENSHELL_GATEWAY_ENDPOINT:-}" ]; then
  echo "OpenShell gateway endpoint is required when the OpenShell sandbox backend is enabled" >&2
  exit 1
fi
if [ ! -x ${OPENSHELL_CLI_PATH} ]; then
  echo "OpenShell CLI not found at ${OPENSHELL_CLI_PATH}; use the OpenShell PoC OpenClaw image" >&2
  exit 1
fi
mkdir -p ${OPENCLAW_RUNTIME_HOME}/.config
${OPENSHELL_CLI_PATH} gateway remove openshell >/dev/null 2>&1 || true
${OPENSHELL_CLI_PATH} gateway add "\${OPENSHELL_GATEWAY_ENDPOINT}" --local --name openshell
${OPENSHELL_CLI_PATH} -g openshell status
`.trim();
}

function managedAuthProfilesSqliteImportScript(agentIds: string[], sourcePath: string): string {
  const uniqueAgentIds = Array.from(new Set(agentIds));
  if (uniqueAgentIds.length === 0) {
    return "";
  }
  const nodeScript = [
    "const { existsSync, mkdirSync, readFileSync, chmodSync } = require('node:fs');",
    "const path = require('node:path');",
    "let DatabaseSync;",
    "try { ({ DatabaseSync } = require('node:sqlite')); } catch { process.exit(0); }",
    `const agentIds = ${JSON.stringify(uniqueAgentIds)};`,
    `const runtimeDir = ${JSON.stringify(OPENCLAW_RUNTIME_DIR)};`,
    `const sourcePath = ${JSON.stringify(sourcePath)};`,
    "if (!existsSync(sourcePath)) process.exit(0);",
    "const incoming = JSON.parse(readFileSync(sourcePath, 'utf8'));",
    "if (!incoming || typeof incoming !== 'object' || !incoming.profiles || typeof incoming.profiles !== 'object') process.exit(0);",
    "for (const agentId of agentIds) {",
    "  const agentDir = path.join(runtimeDir, 'agents', agentId, 'agent');",
    "  mkdirSync(agentDir, { recursive: true, mode: 0o700 });",
    "  const dbPath = path.join(agentDir, 'openclaw-agent.sqlite');",
    "  const db = new DatabaseSync(dbPath);",
    "  try {",
    "    db.exec('PRAGMA busy_timeout = 5000');",
    "    db.exec('CREATE TABLE IF NOT EXISTS schema_meta (meta_key TEXT NOT NULL PRIMARY KEY, role TEXT NOT NULL, schema_version INTEGER NOT NULL, agent_id TEXT, app_version TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)');",
    "    db.exec('CREATE TABLE IF NOT EXISTS auth_profile_store (store_key TEXT NOT NULL PRIMARY KEY, store_json TEXT NOT NULL, updated_at INTEGER NOT NULL)');",
    "    db.exec('CREATE TABLE IF NOT EXISTS auth_profile_state (state_key TEXT NOT NULL PRIMARY KEY, state_json TEXT NOT NULL, updated_at INTEGER NOT NULL)');",
    "    const now = Date.now();",
    "    db.prepare('INSERT INTO schema_meta (meta_key, role, schema_version, agent_id, app_version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(meta_key) DO UPDATE SET role=excluded.role, schema_version=excluded.schema_version, agent_id=excluded.agent_id, updated_at=excluded.updated_at').run('primary', 'agent', 1, agentId, null, now, now);",
    "    const row = db.prepare(\"SELECT store_json FROM auth_profile_store WHERE store_key = 'primary'\").get();",
    "    let existing = { version: 1, profiles: {} };",
    "    if (row && typeof row.store_json === 'string') {",
    "      try {",
    "        const parsed = JSON.parse(row.store_json);",
    "        if (parsed && typeof parsed === 'object') existing = parsed;",
    "      } catch {}",
    "    }",
    "    const next = { ...existing, version: Number(existing.version) || 1, profiles: { ...(existing.profiles || {}), ...incoming.profiles } };",
    "    db.prepare('INSERT INTO auth_profile_store (store_key, store_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(store_key) DO UPDATE SET store_json=excluded.store_json, updated_at=excluded.updated_at').run('primary', JSON.stringify(next), now);",
    "  } finally {",
    "    db.close();",
    "    chmodSync(agentDir, 0o700);",
    "    if (existsSync(dbPath)) chmodSync(dbPath, 0o600);",
    "  }",
    "}",
  ].join("\n");
  return [
    "node <<'EOF_OPENCLAW_AUTH_IMPORT'",
    nodeScript,
    "EOF_OPENCLAW_AUTH_IMPORT",
  ].join("\n");
}

function gatewayStartupScript(useOpenShell: boolean, managedAgentIds: string[]): string {
  return [
    "umask 007",
    managedAuthProfilesSqliteImportScript(
      managedAgentIds,
      `/openclaw-secrets/${CODEX_AUTH_PROFILES_SECRET_KEY}`,
    ),
    ...(useOpenShell ? [openShellGatewayRegistrationScript()] : []),
    "exec node openclaw.mjs gateway run --bind lan --port 18789",
  ].filter((line) => line.length > 0).join("\n");
}

function pluginInstallEnv(): k8s.V1EnvVar[] {
  return [
    { name: "HOME", value: OPENCLAW_RUNTIME_HOME },
    { name: "TMPDIR", value: OPENCLAW_RUNTIME_TMP_DIR },
    { name: "OPENCLAW_CONFIG_DIR", value: OPENCLAW_RUNTIME_DIR },
    { name: "OPENCLAW_STATE_DIR", value: OPENCLAW_RUNTIME_DIR },
    { name: "NPM_CONFIG_CACHE", value: `${OPENCLAW_RUNTIME_HOME}/.npm` },
    { name: "npm_config_cache", value: `${OPENCLAW_RUNTIME_HOME}/.npm` },
    { name: "XDG_CACHE_HOME", value: `${OPENCLAW_RUNTIME_HOME}/.cache` },
    { name: "XDG_CONFIG_HOME", value: `${OPENCLAW_RUNTIME_HOME}/.config` },
  ];
}

function pluginInstallVolumeMounts(): k8s.V1VolumeMount[] {
  return [
    { name: "openclaw-home", mountPath: OPENCLAW_HOME_VOLUME_MOUNT },
    { name: "tmp-volume", mountPath: "/tmp" },
  ];
}

function pluginInstallInitContainer(name: string, image: string, script: string): k8s.V1Container {
  return {
    name,
    image,
    imagePullPolicy: "IfNotPresent",
    command: ["sh", "-c", script],
    env: pluginInstallEnv(),
    resources: {
      requests: { memory: "512Mi", cpu: "100m" },
      limits: { memory: "1Gi", cpu: "500m" },
    },
    volumeMounts: pluginInstallVolumeMounts(),
    securityContext: {
      allowPrivilegeEscalation: false,
      capabilities: { drop: ["ALL"] },
    },
  };
}

function configuredPluginsInstallScript(specs: string[]): string {
  return [
    "set -eu",
    `mkdir -p ${OPENCLAW_RUNTIME_DIR} ${OPENCLAW_RUNTIME_TMP_DIR} ${OPENCLAW_RUNTIME_HOME}/.npm ${OPENCLAW_RUNTIME_HOME}/.cache ${OPENCLAW_RUNTIME_HOME}/.config`,
    ...specs.map(pluginInstallCommand),
    ...(specs.includes(OPENSHELL_PLUGIN_SPEC)
      ? ["node openclaw.mjs plugins list | grep -q openshell"]
      : []),
    ...(specs.includes(ANTHROPIC_VERTEX_PLUGIN_SPEC)
      ? [`node openclaw.mjs plugins list | grep -q ${shellQuote(ANTHROPIC_VERTEX_PROVIDER)}`]
      : []),
    "node openclaw.mjs plugins list || true",
  ].join("\n");
}

function configuredPluginsInitContainer(image: string, specs: string[]): k8s.V1Container {
  return pluginInstallInitContainer(
    "install-openclaw-plugins",
    image,
    configuredPluginsInstallScript(specs),
  );
}

function onePasswordCliInitContainer(): k8s.V1Container {
  return {
    name: "install-1password-cli",
    image: ONEPASSWORD_CLI_IMAGE,
    imagePullPolicy: "IfNotPresent",
    command: [
      "sh",
      "-c",
      [
        "set -eu",
        `mkdir -p ${OPENCLAW_RUNTIME_DIR}/bin ${ONEPASSWORD_CONFIG_DIR}`,
        `chmod 0700 ${ONEPASSWORD_CONFIG_DIR}`,
        "op_path=$(command -v op)",
        `cp "$op_path" ${ONEPASSWORD_CLI_BINARY_PATH}`,
        `chmod 0755 ${ONEPASSWORD_CLI_BINARY_PATH}`,
        `cat > ${ONEPASSWORD_CLI_PATH} <<'EOF_OPENCLAW_OP'`,
        "#!/bin/sh",
        "set -eu",
        `mkdir -p ${ONEPASSWORD_CONFIG_DIR}`,
        `find ${ONEPASSWORD_CONFIG_DIR} -type d -exec chmod 0700 {} + 2>/dev/null || true`,
        `find ${ONEPASSWORD_CONFIG_DIR} -type f -exec chmod 0600 {} + 2>/dev/null || true`,
        "umask 077",
        `exec ${ONEPASSWORD_CLI_BINARY_PATH} --config ${ONEPASSWORD_CONFIG_DIR} "$@"`,
        "EOF_OPENCLAW_OP",
        `chmod 0755 ${ONEPASSWORD_CLI_PATH}`,
        `${ONEPASSWORD_CLI_PATH} --version`,
      ].join("\n"),
    ],
    resources: {
      requests: { memory: "32Mi", cpu: "25m" },
      limits: { memory: "128Mi", cpu: "100m" },
    },
    volumeMounts: pluginInstallVolumeMounts(),
    securityContext: {
      allowPrivilegeEscalation: false,
      capabilities: { drop: ["ALL"] },
    },
  };
}

export function namespaceManifest(ns: string): k8s.V1Namespace {
  return {
    apiVersion: "v1",
    kind: "Namespace",
    metadata: { name: ns, labels: { "app.kubernetes.io/managed-by": "openclaw-installer" } },
  };
}

export function pvcManifest(ns: string): k8s.V1PersistentVolumeClaim {
  return {
    apiVersion: "v1",
    kind: "PersistentVolumeClaim",
    metadata: {
      name: "openclaw-home-pvc",
      namespace: ns,
      labels: { app: "openclaw" },
    },
    spec: {
      accessModes: ["ReadWriteOnce"],
      resources: { requests: { storage: "10Gi" } },
    },
  };
}

export function serviceAccountManifest(ns: string): k8s.V1ServiceAccount {
  return {
    apiVersion: "v1",
    kind: "ServiceAccount",
    metadata: {
      name: OPENCLAW_SERVICE_ACCOUNT_NAME,
      namespace: ns,
      labels: { app: "openclaw" },
    },
  };
}

export function configMapManifest(ns: string, config: DeployConfig, gatewayToken: string): k8s.V1ConfigMap {
  return {
    apiVersion: "v1",
    kind: "ConfigMap",
    metadata: {
      name: "openclaw-config",
      namespace: ns,
      labels: { app: "openclaw" },
    },
    data: {
      "openclaw.json": JSON.stringify(buildOpenClawConfig(config, gatewayToken)),
    },
  };
}

export function agentConfigMapManifest(ns: string, config: DeployConfig, workspaceFiles: Record<string, string>): k8s.V1ConfigMap {
  return {
    apiVersion: "v1",
    kind: "ConfigMap",
    metadata: {
      name: "openclaw-agent",
      namespace: ns,
      labels: { app: "openclaw" },
    },
    data: workspaceFiles,
  };
}

export function fileTreeConfigMapManifest(ns: string, name: string, entries: TreeEntry[]): k8s.V1ConfigMap {
  return {
    apiVersion: "v1",
    kind: "ConfigMap",
    metadata: {
      name,
      namespace: ns,
      labels: { app: "openclaw" },
    },
    data: Object.fromEntries(entries.map((entry) => [entry.key, entry.content])),
  };
}

export function fileConfigMapManifest(ns: string, name: string, filename: string, content?: string): k8s.V1ConfigMap {
  return {
    apiVersion: "v1",
    kind: "ConfigMap",
    metadata: {
      name,
      namespace: ns,
      labels: { app: "openclaw" },
    },
    data: content !== undefined ? { [filename]: content } : {},
  };
}

export function gcpSaSecretManifest(ns: string, saJson: string): k8s.V1Secret {
  return {
    apiVersion: "v1",
    kind: "Secret",
    metadata: {
      name: "gcp-sa",
      namespace: ns,
      labels: { app: "openclaw" },
    },
    stringData: { "sa.json": saJson },
  };
}

export function litellmConfigMapManifest(ns: string, configYaml: string): k8s.V1ConfigMap {
  return {
    apiVersion: "v1",
    kind: "ConfigMap",
    metadata: {
      name: "litellm-config",
      namespace: ns,
      labels: { app: "openclaw" },
    },
    data: { "config.yaml": configYaml },
  };
}

export function otelConfigMapManifest(ns: string, configYaml: string): k8s.V1ConfigMap {
  return {
    apiVersion: "v1",
    kind: "ConfigMap",
    metadata: {
      name: "otel-collector-config",
      namespace: ns,
      labels: { app: "openclaw" },
    },
    data: { "config.yaml": configYaml },
  };
}

export function secretManifest(ns: string, config: DeployConfig, gatewayToken: string, litellmMasterKey?: string): k8s.V1Secret {
  const data: Record<string, string> = {
    OPENCLAW_GATEWAY_TOKEN: gatewayToken,
  };
  const anthropicEnvRefId = resolveEnvSecretRefId(config.anthropicApiKeyRef, "ANTHROPIC_API_KEY");
  if (config.anthropicApiKey && anthropicEnvRefId) {
    data[anthropicEnvRefId] = config.anthropicApiKey;
  }
  const openaiEnvRefId = resolveEnvSecretRefId(config.openaiApiKeyRef, "OPENAI_API_KEY");
  if (config.openaiApiKey && openaiEnvRefId) {
    data[openaiEnvRefId] = config.openaiApiKey;
  }
  const googleEnvRefId = resolveEnvSecretRefId(config.googleApiKeyRef, "GEMINI_API_KEY");
  if (config.googleApiKey && googleEnvRefId) {
    data[googleEnvRefId] = config.googleApiKey;
  }
  const openrouterEnvRefId = resolveEnvSecretRefId(config.openrouterApiKeyRef, "OPENROUTER_API_KEY");
  if (config.openrouterApiKey && openrouterEnvRefId) {
    data[openrouterEnvRefId] = config.openrouterApiKey;
  }
  if (config.modelEndpoint) data.MODEL_ENDPOINT = config.modelEndpoint;
  if (config.modelEndpointApiKey) data.MODEL_ENDPOINT_API_KEY = config.modelEndpointApiKey;
  const authProfilesJson = buildManagedAgentAuthProfilesSecretJson(config);
  if (authProfilesJson) data[CODEX_AUTH_PROFILES_SECRET_KEY] = authProfilesJson;
  const telegramEnvRefId = resolveEnvSecretRefId(config.telegramBotTokenRef, "TELEGRAM_BOT_TOKEN");
  if (config.telegramBotToken && telegramEnvRefId) {
    data[telegramEnvRefId] = config.telegramBotToken;
  }

  // Resolve project ID from config or from the SA JSON
  const projectId = config.googleCloudProject
    || (config.gcpServiceAccountJson ? tryParseProjectId(config.gcpServiceAccountJson) : "");
  if (projectId) data.GOOGLE_CLOUD_PROJECT = projectId;
  if (config.googleCloudLocation) data.GOOGLE_CLOUD_LOCATION = config.googleCloudLocation;
  if (litellmMasterKey) data.LITELLM_MASTER_KEY = litellmMasterKey;
  if (config.sandboxEnabled) {
    if (config.sandboxSshIdentity) data.SSH_IDENTITY = config.sandboxSshIdentity;
    if (config.sandboxSshCertificate) data.SSH_CERTIFICATE = config.sandboxSshCertificate;
    if (config.sandboxSshKnownHosts) data.SSH_KNOWN_HOSTS = config.sandboxSshKnownHosts;
  }

  return {
    apiVersion: "v1",
    kind: "Secret",
    metadata: {
      name: "openclaw-secrets",
      namespace: ns,
      labels: { app: "openclaw" },
    },
    stringData: data,
  };
}

function appendVaultPluginEnv(envVars: k8s.V1EnvVar[], config: DeployConfig): void {
  if (!config.vaultSecretsEnabled) {
    return;
  }
  const authMethod = config.vaultAuthMethod || "token";
  envVars.push(
    { name: "VAULT_ADDR", value: config.vaultAddr || DEFAULT_VAULT_ADDR },
    { name: "OPENCLAW_VAULT_KV_MOUNT", value: config.vaultKvMount || "secret" },
    { name: "OPENCLAW_VAULT_KV_VERSION", value: config.vaultKvVersion || "2" },
    { name: "CLAW_VAULT_KV_MOUNT", value: config.vaultKvMount || "secret" },
    { name: "CLAW_VAULT_KV_VERSION", value: config.vaultKvVersion || "2" },
  );
  if (authMethod !== "token") {
    envVars.push({ name: "OPENCLAW_VAULT_AUTH_METHOD", value: authMethod });
  }
  if (authMethod === "token") {
    envVars.push({
      name: "VAULT_TOKEN",
      valueFrom: {
        secretKeyRef: {
          name: config.vaultTokenSecretName || "openclaw-vault-token",
          key: config.vaultTokenSecretKey || "VAULT_TOKEN",
        },
      },
    });
  } else if (authMethod === "token_file") {
    if (config.vaultTokenFile) {
      envVars.push({ name: "VAULT_TOKEN_FILE", value: config.vaultTokenFile });
    }
  } else {
    // jwt or kubernetes
    if (config.vaultAuthRole) {
      envVars.push({ name: "OPENCLAW_VAULT_AUTH_ROLE", value: config.vaultAuthRole });
    }
    if (config.vaultAuthMount) {
      envVars.push({ name: "OPENCLAW_VAULT_AUTH_MOUNT", value: config.vaultAuthMount });
    }
    // kubernetes defaults to the in-pod service account token; jwt needs an explicit file.
    if (config.vaultJwtFile) {
      envVars.push({ name: "OPENCLAW_VAULT_JWT_FILE", value: config.vaultJwtFile });
    }
  }
  if (config.vaultNamespace) {
    envVars.push({ name: "VAULT_NAMESPACE", value: config.vaultNamespace });
  }
}

function appendOnePasswordPluginEnv(envVars: k8s.V1EnvVar[], config: DeployConfig): void {
  if (!config.onePasswordSecretsEnabled) {
    return;
  }
  if (config.onePasswordVault) {
    envVars.push({ name: "CLAW_1PASSWORD_VAULT", value: config.onePasswordVault });
  }
  envVars.push({ name: "CLAW_1PASSWORD_OP", value: ONEPASSWORD_CLI_PATH });
  envVars.push({
    name: "OP_SERVICE_ACCOUNT_TOKEN",
    valueFrom: {
      secretKeyRef: {
        name: config.onePasswordTokenSecretName || "openclaw-1password-token",
        key: config.onePasswordTokenSecretKey || "OP_SERVICE_ACCOUNT_TOKEN",
      },
    },
  });
}

export function serviceManifest(ns: string, config: DeployConfig): k8s.V1Service {
  const withA2a = Boolean(config.withA2a);
  return {
    apiVersion: "v1",
    kind: "Service",
    metadata: {
      name: "openclaw",
      namespace: ns,
      labels: {
        app: "openclaw",
        ...(withA2a
          ? {
              "kagenti.io/type": "agent",
              "kagenti.io/protocol": "a2a",
              "app.kubernetes.io/name": "openclaw",
            }
          : {}),
      },
      annotations: {
        ...(withA2a ? { "kagenti.io/description": "OpenClaw AI Agent Gateway" } : {}),
      },
    },
    spec: {
      type: "ClusterIP",
      selector: { app: "openclaw" },
      ports: [
        ...(withA2a
          ? [
              { name: "a2a", port: 8080, targetPort: "a2a" as unknown as k8s.IntOrString, protocol: "TCP" as const },
            ]
          : []),
        { name: "gateway", port: 18789, targetPort: 18789 as unknown as k8s.IntOrString, protocol: "TCP" },
        ...(withA2a
          ? [
              { name: "bridge", port: 18790, targetPort: 18790 as unknown as k8s.IntOrString, protocol: "TCP" as const },
            ]
          : []),
      ],
    },
  };
}

export function buildInitScript(config: DeployConfig): string {
  const id = agentId(config);
  const bundle = loadAgentSourceBundle(config);
  const agentFiles = ["AGENTS.md", "agent.json", "SOUL.md", "IDENTITY.md", "TOOLS.md", "USER.md", "HEARTBEAT.md", "MEMORY.md"];
  const copyLines = agentFiles
    .map((f) => `  cp /agents/${f} ${OPENCLAW_RUNTIME_DIR}/workspace-${id}/${f} 2>/dev/null || true`)
    .join("\n");

  const mainWorkspaceDest = `${OPENCLAW_RUNTIME_DIR}/workspace-${id}`;
  const workspaceRouting = mainWorkspaceShellCondition(mainWorkspaceDest, bundle);
  const vaultHelperScript = buildManagedVaultHelperScript();
  const managedAgentIds = Array.from(new Set([id, ...((bundle?.agents || []).map((entry) => entry.id).filter(Boolean))]));
  const openShellPolicyLines = usesOpenShellSandbox(config)
    ? [
        `mkdir -p "$(dirname ${OPEN_SHELL_POLICY_PATH})"`,
        `cat > ${OPEN_SHELL_POLICY_PATH} <<'EOF_OPENSHELL_POLICY'`,
        OPEN_SHELL_POLICY_YAML.trimEnd(),
        "EOF_OPENSHELL_POLICY",
        `chmod 0644 ${OPEN_SHELL_POLICY_PATH}`,
      ].join("\n")
    : "";
  const workspaceSetupLines = managedAgentIds
    .map((agentId) => [
      `mkdir -p ${OPENCLAW_RUNTIME_DIR}/workspace-${agentId}`,
      `mkdir -p ${OPENCLAW_RUNTIME_DIR}/workspace-${agentId}/memory`,
      `mkdir -p ${OPENCLAW_RUNTIME_DIR}/workspace-${agentId}/skills`,
      `touch ${OPENCLAW_RUNTIME_DIR}/workspace-${agentId}/.env`,
    ].join("\n"))
    .join("\n");
  const sessionStoreLines = managedAgentIds
    .map((agentId) => `mkdir -p ${OPENCLAW_RUNTIME_DIR}/agents/${agentId}/sessions`)
    .join("\n");

  return `
mkdir -p ${OPENCLAW_RUNTIME_HOME} ${OPENCLAW_RUNTIME_DIR} ${OPENCLAW_RUNTIME_TMP_DIR}
if [ -f ${OPENCLAW_HOME_VOLUME_MOUNT}/openclaw.json ] || [ -d ${OPENCLAW_HOME_VOLUME_MOUNT}/workspace ]; then
  for path in ${OPENCLAW_HOME_VOLUME_MOUNT}/* ${OPENCLAW_HOME_VOLUME_MOUNT}/.[!.]* ${OPENCLAW_HOME_VOLUME_MOUNT}/..?*; do
    [ -e "$path" ] || continue
    base="$(basename "$path")"
    case "$base" in .|..|.openclaw|gcp|lost+found) continue ;; esac
    [ -e "${OPENCLAW_RUNTIME_DIR}/$base" ] && continue
    mv "$path" "${OPENCLAW_RUNTIME_DIR}/$base" 2>/dev/null || cp -R "$path" "${OPENCLAW_RUNTIME_DIR}/$base" 2>/dev/null || true
  done
fi
mkdir -p ${OPENCLAW_RUNTIME_TMP_DIR} ${OPENCLAW_RUNTIME_HOME}/.npm ${OPENCLAW_RUNTIME_HOME}/.cache ${OPENCLAW_RUNTIME_HOME}/.config ${ONEPASSWORD_CONFIG_DIR}
chmod 700 ${OPENCLAW_RUNTIME_DIR} ${OPENCLAW_RUNTIME_TMP_DIR} ${OPENCLAW_RUNTIME_HOME}/.npm ${OPENCLAW_RUNTIME_HOME}/.cache ${OPENCLAW_RUNTIME_HOME}/.config ${ONEPASSWORD_CONFIG_DIR} 2>/dev/null || true
cp /config/openclaw.json ${OPENCLAW_RUNTIME_DIR}/openclaw.json
chmod 600 ${OPENCLAW_RUNTIME_DIR}/openclaw.json
mkdir -p ${OPENCLAW_RUNTIME_DIR}/bin
mkdir -p ${OPENCLAW_RUNTIME_DIR}/workspace
mkdir -p ${OPENCLAW_RUNTIME_DIR}/skills
mkdir -p ${OPENCLAW_RUNTIME_DIR}/cron
${openShellPolicyLines}
${workspaceSetupLines}
cat > ${MANAGED_VAULT_HELPER_PATH} <<'EOF_VAULT_HELPER'
${vaultHelperScript}
EOF_VAULT_HELPER
chmod 0755 ${MANAGED_VAULT_HELPER_PATH}
${copyLines}
for dir in /agents-tree/workspace-*; do
  [ -d "$dir" ] || continue
  base="$(basename "$dir")"
  ${workspaceRouting}
  mkdir -p "$dest"
  mkdir -p "$dest/memory" "$dest/skills"
  cp -r "$dir"/. "$dest"/ 2>/dev/null || true
done
cp -r /skills-src/. ${OPENCLAW_RUNTIME_DIR}/skills/ 2>/dev/null || true
cp /cron-src/jobs.json ${OPENCLAW_RUNTIME_DIR}/cron/jobs.json 2>/dev/null || true
cp /exec-approvals-src/exec-approvals.json ${OPENCLAW_RUNTIME_DIR}/exec-approvals.json 2>/dev/null || true
rm -f ${OPENCLAW_RUNTIME_DIR}/agents/*/agent/auth-profiles.json ${OPENCLAW_RUNTIME_DIR}/agents/*/agent/models.json ${OPENCLAW_RUNTIME_DIR}/agents/*/agent/auth-state.json 2>/dev/null || true
${sessionStoreLines}
chown -R 1000:0 ${OPENCLAW_RUNTIME_DIR} 2>/dev/null || true
chmod -R g=u ${OPENCLAW_RUNTIME_DIR} 2>/dev/null || true
chmod -R o-rwx ${OPENCLAW_RUNTIME_DIR} 2>/dev/null || true
chmod 700 ${OPENCLAW_RUNTIME_DIR} 2>/dev/null || true
chmod 600 ${OPENCLAW_RUNTIME_DIR}/openclaw.json 2>/dev/null || true
chmod 0755 ${MANAGED_VAULT_HELPER_PATH} 2>/dev/null || true
echo "Config initialized"
`.trim();
}

export function deploymentManifest(
  ns: string,
  config: DeployConfig,
  otelViaOperator = false,
  skillEntries: TreeEntry[] = [],
  agentTreeEntries: TreeEntry[] = [],
  cronJobsContent?: string,
  _execApprovalsContent?: string,
): k8s.V1Deployment {
  const image = defaultImage(config);

  const envVars: k8s.V1EnvVar[] = [
    { name: "HOME", value: OPENCLAW_RUNTIME_HOME },
    { name: "TMPDIR", value: OPENCLAW_RUNTIME_TMP_DIR },
    { name: "NODE_ENV", value: "production" },
    { name: "OPENCLAW_CONFIG_DIR", value: OPENCLAW_RUNTIME_DIR },
    { name: "OPENCLAW_STATE_DIR", value: OPENCLAW_RUNTIME_DIR },
    { name: "NPM_CONFIG_CACHE", value: `${OPENCLAW_RUNTIME_HOME}/.npm` },
    { name: "npm_config_cache", value: `${OPENCLAW_RUNTIME_HOME}/.npm` },
    { name: "XDG_CACHE_HOME", value: `${OPENCLAW_RUNTIME_HOME}/.cache` },
    { name: "XDG_CONFIG_HOME", value: `${OPENCLAW_RUNTIME_HOME}/.config` },
    {
      name: "OPENCLAW_GATEWAY_TOKEN",
      valueFrom: { secretKeyRef: { name: "openclaw-secrets", key: "OPENCLAW_GATEWAY_TOKEN" } },
    },
  ];

  const useProxy = shouldUseLitellmProxy(config);
  const useOtel = shouldUseOtel(config);
  const withA2a = Boolean(config.withA2a);
  // Direct sidecar only when OTEL is enabled and operator is NOT handling it
  const useOtelDirect = useOtel && !otelViaOperator;
  const useChromium = shouldUseChromiumSidecar(config);
  const useOpenShell = usesOpenShellSandbox(config);
  const pluginInstallSpecs = configuredPluginInstallSpecs(config);
  const sourceBundle = loadAgentSourceBundle(config);
  const managedAgentIds = Array.from(new Set([
    agentId(config),
    ...((sourceBundle?.agents || []).map((entry) => entry.id).filter(Boolean)),
  ]));
  const authProfilesSecretJson = buildManagedAgentAuthProfilesSecretJson(config);

  const optionalKeys: string[] = [
    "TELEGRAM_BOT_TOKEN",
    // In proxy mode LiteLLM gets project/location from its config.yaml;
    // the gateway doesn't need them.
    ...(!useProxy ? ["GOOGLE_CLOUD_PROJECT", "GOOGLE_CLOUD_LOCATION"] : []),
    "SSH_IDENTITY",
    "SSH_CERTIFICATE",
    "SSH_KNOWN_HOSTS",
  ];
  if (config.anthropicApiKey || config.anthropicApiKeyRef)
    optionalKeys.push("ANTHROPIC_API_KEY");
  if (config.openaiApiKey || config.openaiApiKeyRef)
    optionalKeys.push("OPENAI_API_KEY");
  if (config.googleApiKey || config.googleApiKeyRef)
    optionalKeys.push("GEMINI_API_KEY");
  if (config.openrouterApiKey || config.openrouterApiKeyRef)
    optionalKeys.push("OPENROUTER_API_KEY");
  if (config.modelEndpoint)
    optionalKeys.push("MODEL_ENDPOINT");
  if (config.modelEndpointApiKey || config.modelEndpoint)
    optionalKeys.push("MODEL_ENDPOINT_API_KEY");
  for (const key of optionalKeys) {
    envVars.push({
      name: key,
      valueFrom: { secretKeyRef: { name: "openclaw-secrets", key, optional: true } },
    });
  }
  appendVaultPluginEnv(envVars, config);
  appendOnePasswordPluginEnv(envVars, config);
  const providerSecretName = config.providerSecretName?.trim();

  // OTEL collector env vars (tell the agent where to send traces)
  if (useOtel) {
    for (const [key, val] of Object.entries(otelAgentEnv())) {
      envVars.push({ name: key, value: val });
    }
  }

  // Chromium CDP env var (tell the agent where to connect to the browser)
  if (useChromium) {
    for (const [key, val] of Object.entries(chromiumAgentEnv())) {
      envVars.push({ name: key, value: val });
    }
  }

  if (useOpenShell) {
    envVars.push({ name: "OPENSHELL_GATEWAY_ENDPOINT", value: config.sandboxOpenShellGatewayEndpoint?.trim() || "" });
  }

  if (config.vertexEnabled && useProxy) {
    // LiteLLM proxy mode: provider config in openclaw.json points to the sidecar,
    // just need the API key for authentication
    envVars.push({
      name: "LITELLM_API_KEY",
      valueFrom: { secretKeyRef: { name: "openclaw-secrets", key: "LITELLM_MASTER_KEY", optional: true } },
    });
  } else if (config.vertexEnabled) {
    // Direct Vertex mode (legacy): gateway gets GCP creds directly
    envVars.push({ name: "VERTEX_ENABLED", value: "true" });
    envVars.push({ name: "VERTEX_PROVIDER", value: config.vertexProvider || "anthropic" });
    if (config.gcpServiceAccountJson) {
      envVars.push({ name: "GOOGLE_APPLICATION_CREDENTIALS", value: "/home/node/gcp/sa.json" });
    }
  }

  const initScript = buildInitScript(config);

  return {
    apiVersion: "apps/v1",
    kind: "Deployment",
    metadata: {
      name: "openclaw",
      namespace: ns,
      labels: {
        app: "openclaw",
        "app.kubernetes.io/managed-by": "openclaw-installer",
        "openclaw.prefix": (config.prefix || "openclaw").toLowerCase(),
        "openclaw.agent": config.agentName.toLowerCase(),
        ...(withA2a
          ? {
              "kagenti.io/type": "agent",
              "kagenti.io/protocol": "a2a",
              "kagenti.io/framework": "OpenClaw",
              "app.kubernetes.io/name": "openclaw",
              "app.kubernetes.io/component": "agent",
            }
          : {}),
      },
    },
    spec: {
      replicas: 1,
      selector: { matchLabels: { app: "openclaw" } },
      strategy: { type: "Recreate" },
      template: {
        metadata: {
          labels: {
            app: "openclaw",
            ...(withA2a
              ? {
                  "kagenti.io/type": "agent",
                  "kagenti.io/protocol": "a2a",
                  "kagenti.io/inject": "enabled",
                }
              : {}),
          },
          annotations: {
            "openclaw.io/restart-at": new Date().toISOString(),
            // When OTel Operator is available, it injects the collector sidecar
            ...(otelViaOperator ? { "sidecar.opentelemetry.io/inject": "openclaw-sidecar" } : {}),
            ...(withA2a
              ? {
                  "kagenti.io/description": "OpenClaw AI Agent Gateway",
                  "kagenti.io/outbound-ports-exclude": "443,4317,4318,18789",
                  "kagenti.io/inbound-ports-exclude": "8080,8443,18789,18790",
                }
              : {}),
          },
        },
        spec: {
          serviceAccountName: withA2a ? "openclaw-oauth-proxy" : OPENCLAW_SERVICE_ACCOUNT_NAME,
          initContainers: [
            {
              name: "init-config",
              image: "registry.access.redhat.com/ubi9-minimal:latest",
              imagePullPolicy: "IfNotPresent",
              command: ["sh", "-c", initScript],
              resources: {
                requests: { memory: "64Mi", cpu: "50m" },
                limits: { memory: "128Mi", cpu: "200m" },
              },
              volumeMounts: [
                { name: "openclaw-home", mountPath: OPENCLAW_HOME_VOLUME_MOUNT },
                { name: "config-template", mountPath: "/config" },
                { name: "openclaw-secrets", mountPath: "/openclaw-secrets", readOnly: true },
                { name: "agent-config", mountPath: "/agents" },
                { name: "agent-tree-config", mountPath: "/agents-tree", readOnly: true },
                { name: "skills-config", mountPath: "/skills-src", readOnly: true },
                { name: "cron-config", mountPath: "/cron-src", readOnly: true },
                { name: "exec-approvals-config", mountPath: "/exec-approvals-src", readOnly: true },
              ],
            },
            ...(config.onePasswordSecretsEnabled ? [onePasswordCliInitContainer()] : []),
            ...(pluginInstallSpecs.length > 0
              ? [configuredPluginsInitContainer(image, pluginInstallSpecs)]
              : []),
          ],
          containers: [
            {
              name: "gateway",
              image,
              imagePullPolicy: "IfNotPresent",
              command: ["sh", "-c", gatewayStartupScript(useOpenShell, managedAgentIds)],
              ports: [
                { name: "gateway", containerPort: 18789, protocol: "TCP" },
                ...(withA2a ? [{ name: "bridge", containerPort: 18790, protocol: "TCP" as const }] : []),
              ],
              env: envVars,
              ...(providerSecretName
                ? { envFrom: [{ secretRef: { name: providerSecretName, optional: true } }] }
                : {}),
              resources: {
                requests: { memory: "1Gi", cpu: "250m" },
                limits: { memory: "4Gi", cpu: "1000m" },
              },
              livenessProbe: {
                exec: {
                  command: [
                    "node", "-e",
                    "require('http').get('http://127.0.0.1:18789/',r=>process.exit(r.statusCode<400?0:1)).on('error',()=>process.exit(1))",
                  ],
                },
                initialDelaySeconds: 60,
                periodSeconds: 30,
                timeoutSeconds: 10,
                failureThreshold: 3,
              },
              readinessProbe: {
                exec: {
                  command: [
                    "node", "-e",
                    "require('http').get('http://127.0.0.1:18789/',r=>process.exit(r.statusCode<400?0:1)).on('error',()=>process.exit(1))",
                  ],
                },
                initialDelaySeconds: 30,
                periodSeconds: 10,
                timeoutSeconds: 5,
                failureThreshold: 2,
              },
              volumeMounts: [
                { name: "openclaw-home", mountPath: OPENCLAW_HOME_VOLUME_MOUNT },
                { name: "tmp-volume", mountPath: "/tmp" },
                ...(authProfilesSecretJson
                  ? [{ name: "openclaw-secrets", mountPath: "/openclaw-secrets", readOnly: true }]
                  : []),
                // Only mount GCP creds on gateway in direct (non-proxy) mode
                ...(!useProxy && config.gcpServiceAccountJson
                  ? [{ name: "gcp-sa", mountPath: "/home/node/gcp", readOnly: true }]
                  : []),
              ],
              securityContext: {
                allowPrivilegeEscalation: false,
                readOnlyRootFilesystem: true,
                capabilities: { drop: ["ALL"] },
              },
            },
            // LiteLLM proxy sidecar: holds GCP creds, exposes OpenAI-compatible API.
            // Only handles Vertex models — secondary providers (OpenAI, Anthropic)
            // are routed directly by the gateway using their native API keys.
            ...(useProxy ? [{
              name: "litellm",
              image: config.litellmImage || LITELLM_IMAGE,
              args: ["--config", "/etc/litellm/config.yaml", "--port", String(LITELLM_PORT)],
              ports: [{ name: "litellm", containerPort: LITELLM_PORT, protocol: "TCP" as const }],
              env: [
                ...(config.gcpServiceAccountJson
                  ? [{ name: "GOOGLE_APPLICATION_CREDENTIALS", value: "/home/node/gcp/sa.json" }]
                  : []),
              ],
              volumeMounts: [
                { name: "litellm-config", mountPath: "/etc/litellm", readOnly: true },
                { name: "litellm-tmp", mountPath: "/tmp" },
                ...(config.gcpServiceAccountJson
                  ? [{ name: "gcp-sa", mountPath: "/home/node/gcp", readOnly: true }]
                  : []),
              ],
              resources: {
                requests: { memory: "512Mi", cpu: "100m" },
                limits: { memory: "1Gi", cpu: "500m" },
              },
              readinessProbe: {
                httpGet: { path: "/health/readiness", port: LITELLM_PORT as unknown as k8s.IntOrString },
                initialDelaySeconds: 10,
                periodSeconds: 10,
                timeoutSeconds: 5,
              },
              securityContext: {
                allowPrivilegeEscalation: false,
                capabilities: { drop: ["ALL"] },
              },
            }] : []),
            // OTEL collector sidecar: receives OTLP traces and exports to configured backend
            ...(useOtelDirect ? [{
              name: "otel-collector",
              image: config.otelImage || OTEL_COLLECTOR_IMAGE,
              imagePullPolicy: "IfNotPresent" as const,
              args: ["--config", "/etc/otel/config.yaml"],
              ports: [
                { name: "otlp-grpc", containerPort: OTEL_GRPC_PORT, protocol: "TCP" as const },
                { name: "otlp-http", containerPort: OTEL_HTTP_PORT, protocol: "TCP" as const },
              ],
              volumeMounts: [
                { name: "otel-config", mountPath: "/etc/otel", readOnly: true },
              ],
              resources: {
                requests: { memory: "128Mi", cpu: "100m" },
                limits: { memory: "256Mi", cpu: "200m" },
              },
              securityContext: {
                allowPrivilegeEscalation: false,
                readOnlyRootFilesystem: true,
                capabilities: { drop: ["ALL"] },
              },
            }] : []),
            // Chromium browser sidecar: headless browser for web browsing via CDP
            ...(useChromium ? [{
              name: "chromium",
              image: config.chromiumImage || CHROMIUM_IMAGE,
              imagePullPolicy: "IfNotPresent" as const,
              ports: [
                { name: "cdp", containerPort: CHROMIUM_CDP_PORT, protocol: "TCP" as const },
              ],
              volumeMounts: [
                { name: "chromium-shm", mountPath: "/dev/shm" },
                { name: "chromium-tmp", mountPath: "/tmp" },
              ],
              resources: {
                requests: { memory: "512Mi", cpu: "100m" },
                limits: { memory: "1Gi", cpu: "500m" },
              },
              securityContext: {
                allowPrivilegeEscalation: false,
                runAsNonRoot: true,
                capabilities: { drop: ["ALL"] },
              },
              readinessProbe: {
                httpGet: { path: "/json/version", port: CHROMIUM_CDP_PORT as unknown as k8s.IntOrString },
                initialDelaySeconds: 5,
                periodSeconds: 10,
                timeoutSeconds: 5,
              },
            }] : []),
            ...(withA2a ? [{
              name: "agent-card",
              image: "registry.redhat.io/ubi9:latest",
              command: ["python3", "-u", "/scripts/a2a-bridge.py"],
              ports: [{ name: "a2a", containerPort: 8080, protocol: "TCP" as const }],
              env: [
                {
                  name: "GATEWAY_TOKEN",
                  valueFrom: { secretKeyRef: { name: "openclaw-secrets", key: "OPENCLAW_GATEWAY_TOKEN" } },
                },
                { name: "GATEWAY_URL", value: "http://localhost:18789" },
                { name: "AGENT_ID", value: "" },
              ],
              volumeMounts: [
                { name: "agent-card-data", mountPath: "/srv/.well-known", readOnly: true },
                { name: "a2a-bridge-script", mountPath: "/scripts", readOnly: true },
              ],
              resources: {
                requests: { memory: "32Mi", cpu: "10m" },
                limits: { memory: "64Mi", cpu: "50m" },
              },
              securityContext: {
                allowPrivilegeEscalation: false,
                readOnlyRootFilesystem: true,
                capabilities: { drop: ["ALL"] },
              },
            }] : []),
          ],
          volumes: [
            { name: "openclaw-home", persistentVolumeClaim: { claimName: "openclaw-home-pvc" } },
            { name: "openclaw-secrets", secret: { secretName: "openclaw-secrets" } },
            { name: "config-template", configMap: { name: "openclaw-config" } },
            { name: "agent-config", configMap: { name: "openclaw-agent" } },
            {
              name: "skills-config",
              configMap: {
                name: "openclaw-skills",
                ...(skillEntries.length > 0
                  ? { items: skillEntries.map((entry) => ({ key: entry.key, path: entry.path })) }
                  : {}),
              },
            },
            {
              name: "cron-config",
              configMap: {
                name: "openclaw-cron",
                ...(cronJobsContent !== undefined
                  ? { items: [{ key: "jobs.json", path: "jobs.json" }] }
                  : {}),
              },
            },
            {
              name: "exec-approvals-config",
              configMap: {
                name: "openclaw-exec-approvals",
                optional: true,
              },
            },
            {
              name: "agent-tree-config",
              configMap: {
                name: "openclaw-agent-tree",
                ...(agentTreeEntries.length > 0
                  ? { items: agentTreeEntries.map((entry) => ({ key: entry.key, path: entry.path })) }
                  : {}),
              },
            },
            { name: "tmp-volume", emptyDir: {} },
            ...(config.gcpServiceAccountJson
              ? [{ name: "gcp-sa", secret: { secretName: "gcp-sa" } }]
              : []),
            ...(useProxy
              ? [
                  { name: "litellm-config", configMap: { name: "litellm-config" } },
                  { name: "litellm-tmp", emptyDir: {} },
                ]
              : []),
            ...(useOtelDirect
              ? [{ name: "otel-config", configMap: { name: "otel-collector-config" } }]
              : []),
            ...(useChromium
              ? [
                  { name: "chromium-shm", emptyDir: { medium: "Memory", sizeLimit: "256Mi" } },
                  { name: "chromium-tmp", emptyDir: {} },
                ]
              : []),
            ...(withA2a
              ? [
                  { name: "agent-card-data", configMap: { name: "openclaw-agent-card" } },
                  { name: "a2a-bridge-script", configMap: { name: "a2a-bridge" } },
                ]
              : []),
          ],
        },
      },
    },
  };
}
