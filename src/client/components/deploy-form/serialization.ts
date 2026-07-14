import {
  decodeBase64,
  decodeJsonBase64,
  encodeBase64,
  trimToUndefined,
} from "./utils.js";
import {
  DEFAULT_PROVIDER_PODMAN_SECRET_MAPPINGS_TEXT,
  formatPodmanSecretMappingsText,
  normalizePodmanSecretMappings,
  parsePodmanSecretMappingsText,
} from "../../../shared/podman-secrets.js";
import type {
  DeployFormConfig,
  InferenceProvider,
  ModelEndpointOption,
  SecretRefValue,
} from "./types.js";

// TODO(openshell): pin this by digest once the Fedora sandbox image contract stabilizes.
const DEFAULT_OPENSHELL_SANDBOX_FROM = "quay.io/sallyom/openclaw-openshell-sandbox:latest";

export function createInitialDeployFormConfig(): DeployFormConfig {
  return {
    prefix: "",
    agentName: "",
    agentDisplayName: "",
    image: "",
    containerRunArgs: "",
    localFileOwner: "",
    podmanSecretMappingsText: DEFAULT_PROVIDER_PODMAN_SECRET_MAPPINGS_TEXT,
    vaultSecretsEnabled: false,
    vaultAddr: "http://vault.vault.svc:8200",
    vaultNamespace: "",
    vaultKvMount: "secret",
    vaultKvVersion: "2",
    vaultAuthMethod: "token",
    vaultAuthRole: "",
    vaultAuthMount: "",
    vaultJwtFile: "",
    vaultTokenFile: "",
    vaultTokenSecretName: "openclaw-vault-token",
    vaultTokenSecretKey: "VAULT_TOKEN",
    onePasswordSecretsEnabled: false,
    onePasswordVault: "OpenClaw",
    onePasswordTokenSecretName: "openclaw-1password-token",
    onePasswordTokenSecretKey: "OP_SERVICE_ACCOUNT_TOKEN",
    providerSecretName: "",
    pluginInstallSpecsText: "",
    secretsProvidersJson: "",
    anthropicApiKeyRefSource: "env",
    anthropicApiKeyRefProvider: "default",
    anthropicApiKeyRefId: "",
    openaiApiKeyRefSource: "env",
    openaiApiKeyRefProvider: "default",
    openaiApiKeyRefId: "",
    googleApiKeyRefSource: "env",
    googleApiKeyRefProvider: "default",
    googleApiKeyRefId: "",
    openrouterApiKeyRefSource: "env",
    openrouterApiKeyRefProvider: "default",
    openrouterApiKeyRefId: "",
    modelEndpointApiKeyRefSource: "env",
    modelEndpointApiKeyRefProvider: "default",
    modelEndpointApiKeyRefId: "",
    telegramBotTokenRefSource: "env",
    telegramBotTokenRefProvider: "default",
    telegramBotTokenRefId: "",
    sandboxEnabled: false,
    sandboxBackend: "ssh",
    sandboxMode: "all",
    sandboxScope: "session",
    sandboxWorkspaceAccess: "rw",
    sandboxOpenShellGatewayEndpoint: "http://openshell.openshell-alice.svc.cluster.local:8080",
    sandboxOpenShellMode: "mirror",
    sandboxOpenShellFrom: DEFAULT_OPENSHELL_SANDBOX_FROM,
    sandboxToolPolicyEnabled: false,
    sandboxToolAllowFiles: true,
    sandboxToolAllowSessions: true,
    sandboxToolAllowMemory: true,
    sandboxToolAllowRuntime: false,
    sandboxToolAllowBrowser: false,
    sandboxToolAllowAutomation: false,
    sandboxToolAllowMessaging: false,
    sandboxToolAllowWebFetch: false,
    sandboxSshTarget: "",
    sandboxSshWorkspaceRoot: "/tmp/openclaw-sandboxes",
    sandboxSshStrictHostKeyChecking: true,
    sandboxSshUpdateHostKeys: true,
    sandboxSshIdentityPath: "",
    sandboxSshCertificate: "",
    sandboxSshCertificatePath: "",
    sandboxSshKnownHosts: "",
    sandboxSshKnownHostsPath: "",
    anthropicApiKey: "",
    openaiApiKey: "",
    googleApiKey: "",
    openrouterApiKey: "",
    codexOauthMode: "codex-cli",
    codexOauthProfileId: "openai:chatgpt-default",
    codexOauthAuthJsonPath: "",
    anthropicModel: "",
    openaiModel: "",
    codexModel: "",
    googleModel: "",
    openrouterModel: "",
    anthropicModels: [],
    openaiModels: [],
    codexModels: [],
    googleModels: [],
    openrouterModels: [],
    agentModel: "",
    vertexAnthropicModel: "",
    vertexAnthropicModels: [],
    vertexGoogleModel: "",
    vertexGoogleModels: [],
    openaiCompatibleEndpointsEnabled: true,
    modelEndpoint: "",
    modelEndpointApiKey: "",
    modelEndpointModel: "",
    modelEndpointModelLabel: "",
    modelEndpointModels: [],
    port: "18789",
    googleCloudProject: "",
    googleCloudLocation: "",
    gcpServiceAccountJson: "",
    gcpServiceAccountPath: "",
    sshHost: "",
    sshUser: "",
    agentSourceType: "directory",
    agentSourceDir: "",
    agentSourceGitUrl: "",
    agentSourceGitRef: "",
    agentSourceGitPath: "",
    telegramEnabled: false,
    telegramBotToken: "",
    telegramAllowFrom: "",
    cronEnabled: false,
    subagentPolicy: "none",
    namespace: "",
    withA2a: false,
    a2aRealm: "",
    a2aKeycloakNamespace: "keycloak",
    litellmProxy: true,
    otelEnabled: false,
    otelJaeger: false,
    otelEndpoint: "",
    otelExperimentId: "",
    otelTlsSkipVerify: false,
    chromiumSidecar: false,
    chromiumImage: "",
  };
}

function getStringVar(vars: Record<string, unknown>, envKey: string, jsonKey: string): string {
  const value = vars[envKey] ?? vars[jsonKey];
  return typeof value === "string" ? value : "";
}

function decodeSecretRefVar(
  vars: Record<string, unknown>,
  b64Key: string,
  jsonKey: "anthropicApiKeyRef" | "openaiApiKeyRef" | "googleApiKeyRef" | "openrouterApiKeyRef" | "modelEndpointApiKeyRef" | "telegramBotTokenRef",
): SecretRefValue | undefined {
  const decoded = decodeJsonBase64<SecretRefValue>(vars[b64Key] as string | undefined);
  if (decoded) return decoded;
  const raw = vars[jsonKey];
  return typeof raw === "object" && raw ? (raw as SecretRefValue) : undefined;
}

function decodeEndpointModelsVar(vars: Record<string, unknown>): ModelEndpointOption[] | undefined {
  const decoded = decodeJsonBase64<ModelEndpointOption[]>(vars.MODEL_ENDPOINT_MODELS_B64 as string | undefined);
  if (decoded) return decoded;
  return Array.isArray(vars.modelEndpointModels)
    ? (vars.modelEndpointModels as ModelEndpointOption[])
    : undefined;
}

function decodeStringArrayVar(vars: Record<string, unknown>, b64Key: string, jsonKey: string): string[] | undefined {
  const decoded = decodeJsonBase64<string[]>(vars[b64Key] as string | undefined);
  if (decoded && Array.isArray(decoded)) return decoded;
  return Array.isArray(vars[jsonKey]) ? (vars[jsonKey] as string[]) : undefined;
}

function decodeSecretsProvidersJson(vars: Record<string, unknown>): string {
  const decoded = decodeBase64(vars.SECRETS_PROVIDERS_JSON_B64 as string | undefined);
  if (decoded) return decoded;
  return typeof vars.secretsProvidersJson === "string" ? vars.secretsProvidersJson : "";
}

export function parsePluginInstallSpecsText(value: string): string[] {
  const seen = new Set<string>();
  const specs: string[] = [];
  for (const line of value.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    specs.push(trimmed);
  }
  return specs;
}

function formatPluginInstallSpecsText(specs: string[] | undefined): string {
  return (specs ?? []).filter((spec) => typeof spec === "string" && spec.trim()).join("\n");
}

function decodePluginInstallSpecsText(vars: Record<string, unknown>): string {
  const decoded = decodeJsonBase64<string[]>(
    vars.OPENCLAW_PLUGIN_INSTALL_SPECS_B64 as string | undefined,
  );
  if (decoded) {
    return formatPluginInstallSpecsText(decoded);
  }
  if (Array.isArray(vars.pluginInstallSpecs)) {
    return formatPluginInstallSpecsText(vars.pluginInstallSpecs as string[]);
  }
  return typeof vars.pluginInstallSpecsText === "string" ? vars.pluginInstallSpecsText : "";
}

function decodePodmanSecretMappingsText(vars: Record<string, unknown>): string {
  const decoded = decodeJsonBase64<{ secretName: string; targetEnv: string }[]>(
    vars.PODMAN_SECRET_MAPPINGS_B64 as string | undefined,
  );
  if (decoded) {
    return formatPodmanSecretMappingsText(normalizePodmanSecretMappings(decoded));
  }
  return typeof vars.podmanSecretMappingsText === "string" ? vars.podmanSecretMappingsText : "";
}

function inferredEnvSecretRefFromPodmanMappings(
  mappingsText: string,
  targetEnv: string | string[],
): SecretRefValue | undefined {
  const parsed = parsePodmanSecretMappingsText(mappingsText);
  const targetEnvs = Array.isArray(targetEnv) ? targetEnv : [targetEnv];
  const matched = parsed.mappings.find((mapping) => targetEnvs.includes(mapping.targetEnv));
  if (matched) {
    return {
      source: "env",
      provider: "default",
      id: matched.targetEnv,
    };
  }
  return undefined;
}

export function inferSavedInferenceProvider(vars: Record<string, unknown>): InferenceProvider | undefined {
  const savedInferenceProvider = getStringVar(vars, "INFERENCE_PROVIDER", "inferenceProvider");
  if (
    savedInferenceProvider === "anthropic"
    || savedInferenceProvider === "openai"
    || savedInferenceProvider === "openai-codex"
    || savedInferenceProvider === "google"
    || savedInferenceProvider === "openrouter"
    || savedInferenceProvider === "vertex-anthropic"
    || savedInferenceProvider === "vertex-google"
    || savedInferenceProvider === "custom-endpoint"
  ) {
    return savedInferenceProvider;
  }

  const anthropicApiKeyRef = decodeSecretRefVar(vars, "ANTHROPIC_API_KEY_REF_B64", "anthropicApiKeyRef");
  const openaiApiKeyRef = decodeSecretRefVar(vars, "OPENAI_API_KEY_REF_B64", "openaiApiKeyRef");
  const googleApiKeyRef = decodeSecretRefVar(vars, "GOOGLE_API_KEY_REF_B64", "googleApiKeyRef");
  const openrouterApiKeyRef = decodeSecretRefVar(vars, "OPENROUTER_API_KEY_REF_B64", "openrouterApiKeyRef");
  const modelEndpointApiKeyRef = decodeSecretRefVar(vars, "MODEL_ENDPOINT_API_KEY_REF_B64", "modelEndpointApiKeyRef");
  const vertexEnabled = vars.VERTEX_ENABLED === "true" || vars.vertexEnabled === "true";
  if (vertexEnabled) {
    const vertexProvider = vars.VERTEX_PROVIDER || vars.vertexProvider || "anthropic";
    return vertexProvider === "google" ? "vertex-google" : "vertex-anthropic";
  }
  if (getStringVar(vars, "MODEL_ENDPOINT", "modelEndpoint") || modelEndpointApiKeyRef) {
    return "custom-endpoint";
  }
  if (
    getStringVar(vars, "CODEX_OAUTH_PROFILE_ID", "codexOauthProfileId")
    || getStringVar(vars, "CODEX_OAUTH_AUTH_JSON_PATH", "codexOauthAuthJsonPath")
    || getStringVar(vars, "CODEX_MODEL", "codexModel")
  ) {
    return "openai-codex";
  }
  if (getStringVar(vars, "OPENROUTER_API_KEY", "openrouterApiKey") || openrouterApiKeyRef) {
    return "openrouter";
  }
  if (getStringVar(vars, "ANTHROPIC_API_KEY", "anthropicApiKey") || anthropicApiKeyRef) {
    return "anthropic";
  }
  if (getStringVar(vars, "OPENAI_API_KEY", "openaiApiKey") || openaiApiKeyRef) {
    return "openai";
  }
  if (
    getStringVar(vars, "GEMINI_API_KEY", "googleApiKey")
    || getStringVar(vars, "GOOGLE_API_KEY", "googleApiKey")
    || googleApiKeyRef
  ) {
    return "google";
  }
  return undefined;
}

/**
 * Infer which providers are active by scanning a restored config for non-empty
 * provider-specific data (model, models array, or API key).
 * Fix for #122: restoring additional providers from saved configs.
 *
 * Note: SecretRef IDs are NOT checked because default Podman secret mappings
 * pre-populate them for all providers regardless of selection.
 */
export function inferSelectedProviders(
  config: DeployFormConfig,
  primaryProvider: InferenceProvider,
): InferenceProvider[] {
  const providers: InferenceProvider[] = [primaryProvider];

  function addIf(provider: InferenceProvider, hasData: boolean) {
    if (provider !== primaryProvider && hasData) {
      providers.push(provider);
    }
  }

  addIf("anthropic",
    Boolean(config.anthropicModel) || config.anthropicModels.length > 0
    || Boolean(config.anthropicApiKey));
  addIf("openai",
    Boolean(config.openaiModel) || config.openaiModels.length > 0
    || Boolean(config.openaiApiKey));
  addIf("openai-codex",
    Boolean(config.codexModel) || config.codexModels.length > 0
    || Boolean(config.codexOauthAuthJsonPath));
  addIf("google",
    Boolean(config.googleModel) || config.googleModels.length > 0
    || Boolean(config.googleApiKey));
  addIf("openrouter",
    Boolean(config.openrouterModel) || config.openrouterModels.length > 0
    || Boolean(config.openrouterApiKey));
  addIf("vertex-anthropic",
    Boolean(config.vertexAnthropicModel) || config.vertexAnthropicModels.length > 0);
  addIf("vertex-google",
    Boolean(config.vertexGoogleModel) || config.vertexGoogleModels.length > 0);
  addIf("custom-endpoint",
    Boolean(config.modelEndpoint) || Boolean(config.modelEndpointModel)
    || Boolean(config.modelEndpointApiKey));

  return providers;
}

export function applySavedVarsToConfig(
  vars: Record<string, unknown>,
  prev: DeployFormConfig,
): { config: DeployFormConfig; namespaceManuallyEdited: boolean } {
  const anthropicApiKeyRef = decodeSecretRefVar(vars, "ANTHROPIC_API_KEY_REF_B64", "anthropicApiKeyRef");
  const openaiApiKeyRef = decodeSecretRefVar(vars, "OPENAI_API_KEY_REF_B64", "openaiApiKeyRef");
  const googleApiKeyRef = decodeSecretRefVar(vars, "GOOGLE_API_KEY_REF_B64", "googleApiKeyRef");
  const openrouterApiKeyRef = decodeSecretRefVar(vars, "OPENROUTER_API_KEY_REF_B64", "openrouterApiKeyRef");
  const modelEndpointApiKeyRef = decodeSecretRefVar(vars, "MODEL_ENDPOINT_API_KEY_REF_B64", "modelEndpointApiKeyRef");
  const telegramBotTokenRef = decodeSecretRefVar(vars, "TELEGRAM_BOT_TOKEN_REF_B64", "telegramBotTokenRef");
  const savedProvidersJson = decodeSecretsProvidersJson(vars);
  const savedPodmanSecretMappingsText = decodePodmanSecretMappingsText(vars);
  const savedPluginInstallSpecsText = decodePluginInstallSpecsText(vars);
  const inferredAnthropicRef = anthropicApiKeyRef || inferredEnvSecretRefFromPodmanMappings(savedPodmanSecretMappingsText, "ANTHROPIC_API_KEY");
  const inferredOpenaiRef = openaiApiKeyRef || inferredEnvSecretRefFromPodmanMappings(savedPodmanSecretMappingsText, "OPENAI_API_KEY");
  const inferredGoogleRef = googleApiKeyRef
    || inferredEnvSecretRefFromPodmanMappings(savedPodmanSecretMappingsText, ["GEMINI_API_KEY", "GOOGLE_API_KEY"]);
  const inferredOpenrouterRef = openrouterApiKeyRef || inferredEnvSecretRefFromPodmanMappings(savedPodmanSecretMappingsText, "OPENROUTER_API_KEY");
  const inferredModelEndpointRef = modelEndpointApiKeyRef
    || inferredEnvSecretRefFromPodmanMappings(savedPodmanSecretMappingsText, "MODEL_ENDPOINT_API_KEY");
  const explicitNamespace = getStringVar(vars, "K8S_NAMESPACE", "namespace");
  const savedEndpointModels = decodeEndpointModelsVar(vars);
  const agentSourceDir = getStringVar(vars, "AGENT_SOURCE_DIR", "agentSourceDir");
  const agentSourceGitUrl = getStringVar(vars, "AGENT_SOURCE_GIT_URL", "agentSourceGitUrl");

  return {
    namespaceManuallyEdited: Boolean(explicitNamespace),
    config: {
      ...prev,
      prefix: getStringVar(vars, "OPENCLAW_PREFIX", "prefix") || prev.prefix,
      agentName: getStringVar(vars, "OPENCLAW_AGENT_NAME", "agentName") || prev.agentName,
      agentDisplayName: getStringVar(vars, "OPENCLAW_DISPLAY_NAME", "agentDisplayName") || prev.agentDisplayName,
      image: getStringVar(vars, "OPENCLAW_IMAGE", "image") || prev.image,
      containerRunArgs: getStringVar(vars, "OPENCLAW_CONTAINER_RUN_ARGS", "containerRunArgs") || prev.containerRunArgs,
      localFileOwner: getStringVar(vars, "OPENCLAW_LOCAL_FILE_OWNER", "localFileOwner") || prev.localFileOwner,
      podmanSecretMappingsText: savedPodmanSecretMappingsText || prev.podmanSecretMappingsText,
      vaultSecretsEnabled:
        vars.VAULT_SECRETS_ENABLED === "true"
          || vars.vaultSecretsEnabled === true
          || vars.vaultSecretsEnabled === "true"
          || prev.vaultSecretsEnabled,
      vaultAddr: getStringVar(vars, "VAULT_ADDR", "vaultAddr") || prev.vaultAddr,
      vaultNamespace: getStringVar(vars, "VAULT_NAMESPACE", "vaultNamespace") || prev.vaultNamespace,
      vaultKvMount:
        getStringVar(vars, "OPENCLAW_VAULT_KV_MOUNT", "vaultKvMount")
        || getStringVar(vars, "CLAW_VAULT_KV_MOUNT")
        || prev.vaultKvMount,
      vaultKvVersion:
        getStringVar(vars, "OPENCLAW_VAULT_KV_VERSION", "vaultKvVersion")
        || getStringVar(vars, "CLAW_VAULT_KV_VERSION")
        || prev.vaultKvVersion,
      vaultAuthMethod:
        (getStringVar(vars, "OPENCLAW_VAULT_AUTH_METHOD", "vaultAuthMethod") as DeployFormConfig["vaultAuthMethod"])
        || prev.vaultAuthMethod,
      vaultAuthRole:
        getStringVar(vars, "OPENCLAW_VAULT_AUTH_ROLE", "vaultAuthRole") || prev.vaultAuthRole,
      vaultAuthMount:
        getStringVar(vars, "OPENCLAW_VAULT_AUTH_MOUNT", "vaultAuthMount") || prev.vaultAuthMount,
      vaultJwtFile:
        getStringVar(vars, "OPENCLAW_VAULT_JWT_FILE", "vaultJwtFile") || prev.vaultJwtFile,
      vaultTokenFile:
        getStringVar(vars, "VAULT_TOKEN_FILE", "vaultTokenFile") || prev.vaultTokenFile,
      vaultTokenSecretName:
        getStringVar(vars, "VAULT_TOKEN_SECRET_NAME", "vaultTokenSecretName") || prev.vaultTokenSecretName,
      vaultTokenSecretKey:
        getStringVar(vars, "VAULT_TOKEN_SECRET_KEY", "vaultTokenSecretKey") || prev.vaultTokenSecretKey,
      onePasswordSecretsEnabled:
        vars.ONEPASSWORD_SECRETS_ENABLED === "true"
          || vars.onePasswordSecretsEnabled === true
          || vars.onePasswordSecretsEnabled === "true"
          || prev.onePasswordSecretsEnabled,
      onePasswordVault:
        getStringVar(vars, "CLAW_1PASSWORD_VAULT", "onePasswordVault") || prev.onePasswordVault,
      onePasswordTokenSecretName:
        getStringVar(vars, "ONEPASSWORD_TOKEN_SECRET_NAME", "onePasswordTokenSecretName")
        || prev.onePasswordTokenSecretName,
      onePasswordTokenSecretKey:
        getStringVar(vars, "ONEPASSWORD_TOKEN_SECRET_KEY", "onePasswordTokenSecretKey")
        || prev.onePasswordTokenSecretKey,
      providerSecretName:
        getStringVar(vars, "OPENCLAW_PROVIDER_SECRET_NAME", "providerSecretName") || prev.providerSecretName,
      pluginInstallSpecsText: savedPluginInstallSpecsText || prev.pluginInstallSpecsText,
      secretsProvidersJson: savedProvidersJson || prev.secretsProvidersJson,
      anthropicApiKeyRefSource: inferredAnthropicRef?.source || prev.anthropicApiKeyRefSource,
      anthropicApiKeyRefProvider: inferredAnthropicRef?.provider || prev.anthropicApiKeyRefProvider,
      anthropicApiKeyRefId: inferredAnthropicRef?.id || prev.anthropicApiKeyRefId,
      openaiApiKeyRefSource: inferredOpenaiRef?.source || prev.openaiApiKeyRefSource,
      openaiApiKeyRefProvider: inferredOpenaiRef?.provider || prev.openaiApiKeyRefProvider,
      openaiApiKeyRefId: inferredOpenaiRef?.id || prev.openaiApiKeyRefId,
      googleApiKeyRefSource: inferredGoogleRef?.source || prev.googleApiKeyRefSource,
      googleApiKeyRefProvider: inferredGoogleRef?.provider || prev.googleApiKeyRefProvider,
      googleApiKeyRefId: inferredGoogleRef?.id || prev.googleApiKeyRefId,
      openrouterApiKeyRefSource: inferredOpenrouterRef?.source || prev.openrouterApiKeyRefSource,
      openrouterApiKeyRefProvider: inferredOpenrouterRef?.provider || prev.openrouterApiKeyRefProvider,
      openrouterApiKeyRefId: inferredOpenrouterRef?.id || prev.openrouterApiKeyRefId,
      modelEndpointApiKeyRefSource: inferredModelEndpointRef?.source || prev.modelEndpointApiKeyRefSource,
      modelEndpointApiKeyRefProvider: inferredModelEndpointRef?.provider || prev.modelEndpointApiKeyRefProvider,
      modelEndpointApiKeyRefId: inferredModelEndpointRef?.id || prev.modelEndpointApiKeyRefId,
      telegramBotTokenRefSource: telegramBotTokenRef?.source || prev.telegramBotTokenRefSource,
      telegramBotTokenRefProvider: telegramBotTokenRef?.provider || prev.telegramBotTokenRefProvider,
      telegramBotTokenRefId: telegramBotTokenRef?.id || prev.telegramBotTokenRefId,
      sandboxEnabled:
        vars.SANDBOX_ENABLED === "true" || vars.sandboxEnabled === "true" || prev.sandboxEnabled,
      sandboxBackend:
        getStringVar(vars, "SANDBOX_BACKEND", "sandboxBackend") === "openshell" ? "openshell" : prev.sandboxBackend,
      sandboxMode: getStringVar(vars, "SANDBOX_MODE", "sandboxMode") || prev.sandboxMode,
      sandboxScope: getStringVar(vars, "SANDBOX_SCOPE", "sandboxScope") || prev.sandboxScope,
      sandboxToolPolicyEnabled:
        vars.SANDBOX_TOOL_POLICY_ENABLED === "true"
          || vars.sandboxToolPolicyEnabled === "true"
          || prev.sandboxToolPolicyEnabled,
      sandboxToolAllowFiles:
        vars.SANDBOX_TOOL_ALLOW_FILES === "false"
          ? false
          : vars.sandboxToolAllowFiles === "false"
            ? false
            : prev.sandboxToolAllowFiles,
      sandboxToolAllowSessions:
        vars.SANDBOX_TOOL_ALLOW_SESSIONS === "false"
          ? false
          : vars.sandboxToolAllowSessions === "false"
            ? false
            : prev.sandboxToolAllowSessions,
      sandboxToolAllowMemory:
        vars.SANDBOX_TOOL_ALLOW_MEMORY === "false"
          ? false
          : vars.sandboxToolAllowMemory === "false"
            ? false
            : prev.sandboxToolAllowMemory,
      sandboxToolAllowRuntime:
        vars.SANDBOX_TOOL_ALLOW_RUNTIME === "true"
          || vars.sandboxToolAllowRuntime === "true"
          || prev.sandboxToolAllowRuntime,
      sandboxToolAllowBrowser:
        vars.SANDBOX_TOOL_ALLOW_BROWSER === "true"
          || vars.sandboxToolAllowBrowser === "true"
          || prev.sandboxToolAllowBrowser,
      sandboxToolAllowAutomation:
        vars.SANDBOX_TOOL_ALLOW_AUTOMATION === "true"
          || vars.sandboxToolAllowAutomation === "true"
          || prev.sandboxToolAllowAutomation,
      sandboxToolAllowMessaging:
        vars.SANDBOX_TOOL_ALLOW_MESSAGING === "true"
          || vars.sandboxToolAllowMessaging === "true"
          || prev.sandboxToolAllowMessaging,
      sandboxToolAllowWebFetch:
        vars.SANDBOX_TOOL_ALLOW_WEB_FETCH === "true"
          || vars.sandboxToolAllowWebFetch === "true"
          || prev.sandboxToolAllowWebFetch,
      sandboxWorkspaceAccess:
        getStringVar(vars, "SANDBOX_WORKSPACE_ACCESS", "sandboxWorkspaceAccess") || prev.sandboxWorkspaceAccess,
      sandboxOpenShellGatewayEndpoint:
        getStringVar(vars, "SANDBOX_OPENSHELL_GATEWAY_ENDPOINT", "sandboxOpenShellGatewayEndpoint")
        || prev.sandboxOpenShellGatewayEndpoint,
      sandboxOpenShellMode:
        getStringVar(vars, "SANDBOX_OPENSHELL_MODE", "sandboxOpenShellMode") === "remote"
          ? "remote"
          : prev.sandboxOpenShellMode,
      sandboxOpenShellFrom:
        getStringVar(vars, "SANDBOX_OPENSHELL_FROM", "sandboxOpenShellFrom") || prev.sandboxOpenShellFrom,
      sandboxSshTarget:
        getStringVar(vars, "SANDBOX_SSH_TARGET", "sandboxSshTarget") || prev.sandboxSshTarget,
      sandboxSshWorkspaceRoot:
        getStringVar(vars, "SANDBOX_SSH_WORKSPACE_ROOT", "sandboxSshWorkspaceRoot") || prev.sandboxSshWorkspaceRoot,
      sandboxSshIdentityPath:
        getStringVar(vars, "SANDBOX_SSH_IDENTITY_PATH", "sandboxSshIdentityPath") || prev.sandboxSshIdentityPath,
      sandboxSshCertificatePath:
        getStringVar(vars, "SANDBOX_SSH_CERTIFICATE_PATH", "sandboxSshCertificatePath") || prev.sandboxSshCertificatePath,
      sandboxSshKnownHostsPath:
        getStringVar(vars, "SANDBOX_SSH_KNOWN_HOSTS_PATH", "sandboxSshKnownHostsPath") || prev.sandboxSshKnownHostsPath,
      sandboxSshStrictHostKeyChecking:
        vars.SANDBOX_SSH_STRICT_HOST_KEY_CHECKING === "false"
          ? false
          : vars.sandboxSshStrictHostKeyChecking === "false"
            ? false
            : prev.sandboxSshStrictHostKeyChecking,
      sandboxSshUpdateHostKeys:
        vars.SANDBOX_SSH_UPDATE_HOST_KEYS === "false"
          ? false
          : vars.sandboxSshUpdateHostKeys === "false"
            ? false
            : prev.sandboxSshUpdateHostKeys,
      sandboxSshCertificate:
        decodeBase64(vars.SANDBOX_SSH_CERTIFICATE_B64 as string | undefined)
        || getStringVar(vars, "sandboxSshCertificate", "sandboxSshCertificate")
        || prev.sandboxSshCertificate,
      sandboxSshKnownHosts:
        decodeBase64(vars.SANDBOX_SSH_KNOWN_HOSTS_B64 as string | undefined)
        || getStringVar(vars, "sandboxSshKnownHosts", "sandboxSshKnownHosts")
        || prev.sandboxSshKnownHosts,
      port: getStringVar(vars, "OPENCLAW_PORT", "port") || prev.port,
      anthropicModel: getStringVar(vars, "ANTHROPIC_MODEL", "anthropicModel") || prev.anthropicModel,
      codexOauthMode: "codex-cli",
      codexOauthProfileId:
        getStringVar(vars, "CODEX_OAUTH_PROFILE_ID", "codexOauthProfileId") || prev.codexOauthProfileId,
      codexOauthAuthJsonPath:
        getStringVar(vars, "CODEX_OAUTH_AUTH_JSON_PATH", "codexOauthAuthJsonPath") || prev.codexOauthAuthJsonPath,
      openaiModel: getStringVar(vars, "OPENAI_MODEL", "openaiModel") || prev.openaiModel,
      codexModel: getStringVar(vars, "CODEX_MODEL", "codexModel") || prev.codexModel,
      googleApiKey:
        getStringVar(vars, "GEMINI_API_KEY", "googleApiKey")
          || getStringVar(vars, "GOOGLE_API_KEY", "googleApiKey")
          || prev.googleApiKey,
      googleModel: getStringVar(vars, "GOOGLE_MODEL", "googleModel") || prev.googleModel,
      openrouterApiKey:
        getStringVar(vars, "OPENROUTER_API_KEY", "openrouterApiKey") || prev.openrouterApiKey,
      openrouterModel: getStringVar(vars, "OPENROUTER_MODEL", "openrouterModel") || prev.openrouterModel,
      anthropicModels:
        decodeStringArrayVar(vars, "ANTHROPIC_MODELS_B64", "anthropicModels") || prev.anthropicModels,
      openaiModels:
        decodeStringArrayVar(vars, "OPENAI_MODELS_B64", "openaiModels") || prev.openaiModels,
      codexModels:
        decodeStringArrayVar(vars, "CODEX_MODELS_B64", "codexModels") || prev.codexModels,
      googleModels:
        decodeStringArrayVar(vars, "GOOGLE_MODELS_B64", "googleModels") || prev.googleModels,
      openrouterModels:
        decodeStringArrayVar(vars, "OPENROUTER_MODELS_B64", "openrouterModels") || prev.openrouterModels,
      agentModel: getStringVar(vars, "AGENT_MODEL", "agentModel") || prev.agentModel,
      vertexAnthropicModel: getStringVar(vars, "VERTEX_ANTHROPIC_MODEL", "vertexAnthropicModel") || prev.vertexAnthropicModel,
      vertexAnthropicModels:
        decodeStringArrayVar(vars, "VERTEX_ANTHROPIC_MODELS_B64", "vertexAnthropicModels") || prev.vertexAnthropicModels,
      vertexGoogleModel: getStringVar(vars, "VERTEX_GOOGLE_MODEL", "vertexGoogleModel") || prev.vertexGoogleModel,
      vertexGoogleModels:
        decodeStringArrayVar(vars, "VERTEX_GOOGLE_MODELS_B64", "vertexGoogleModels") || prev.vertexGoogleModels,
      openaiCompatibleEndpointsEnabled:
        vars.OPENAI_COMPATIBLE_ENDPOINTS_ENABLED === "false"
          ? false
          : vars.openaiCompatibleEndpointsEnabled === false
            ? false
            : prev.openaiCompatibleEndpointsEnabled,
      modelEndpoint: getStringVar(vars, "MODEL_ENDPOINT", "modelEndpoint") || prev.modelEndpoint,
      modelEndpointApiKey:
        getStringVar(vars, "MODEL_ENDPOINT_API_KEY", "modelEndpointApiKey") || prev.modelEndpointApiKey,
      modelEndpointModel:
        getStringVar(vars, "MODEL_ENDPOINT_MODEL", "modelEndpointModel") || prev.modelEndpointModel,
      modelEndpointModelLabel:
        getStringVar(vars, "MODEL_ENDPOINT_MODEL_LABEL", "modelEndpointModelLabel") || prev.modelEndpointModelLabel,
      modelEndpointModels: savedEndpointModels || prev.modelEndpointModels,
      googleCloudProject:
        getStringVar(vars, "GOOGLE_CLOUD_PROJECT", "googleCloudProject") || prev.googleCloudProject,
      googleCloudLocation:
        getStringVar(vars, "GOOGLE_CLOUD_LOCATION", "googleCloudLocation") || prev.googleCloudLocation,
      agentSourceType: agentSourceGitUrl ? "git" : agentSourceDir ? "directory" : prev.agentSourceType,
      agentSourceDir: agentSourceGitUrl
        ? ""
        : agentSourceDir || prev.agentSourceDir,
      agentSourceGitUrl: agentSourceGitUrl || (agentSourceDir ? "" : prev.agentSourceGitUrl),
      agentSourceGitRef:
        getStringVar(vars, "AGENT_SOURCE_GIT_REF", "agentSourceGitRef")
        || (agentSourceDir ? "" : prev.agentSourceGitRef),
      agentSourceGitPath:
        getStringVar(vars, "AGENT_SOURCE_GIT_PATH", "agentSourceGitPath")
        || (agentSourceDir ? "" : prev.agentSourceGitPath),
      telegramBotToken:
        getStringVar(vars, "TELEGRAM_BOT_TOKEN", "telegramBotToken") || prev.telegramBotToken,
      telegramAllowFrom:
        getStringVar(vars, "TELEGRAM_ALLOW_FROM", "telegramAllowFrom") || prev.telegramAllowFrom,
      namespace: explicitNamespace || prev.namespace,
      withA2a: vars.WITH_A2A === "true" || vars.withA2a === "true" || prev.withA2a,
      a2aRealm: getStringVar(vars, "A2A_REALM", "a2aRealm") || prev.a2aRealm,
      a2aKeycloakNamespace:
        getStringVar(vars, "A2A_KEYCLOAK_NAMESPACE", "a2aKeycloakNamespace") || prev.a2aKeycloakNamespace,
      litellmProxy: vars.litellmProxy === "false" ? false : prev.litellmProxy,
      otelEnabled: vars.OTEL_ENABLED === "true" || vars.otelEnabled === "true" || prev.otelEnabled,
      otelJaeger: vars.OTEL_JAEGER === "true" || vars.otelJaeger === "true" || prev.otelJaeger,
      otelEndpoint: getStringVar(vars, "OTEL_ENDPOINT", "otelEndpoint") || prev.otelEndpoint,
      otelExperimentId:
        getStringVar(vars, "OTEL_EXPERIMENT_ID", "otelExperimentId") || prev.otelExperimentId,
      otelTlsSkipVerify:
        vars.OTEL_TLS_SKIP_VERIFY === "true" || vars.otelTlsSkipVerify === "true" || prev.otelTlsSkipVerify,
      chromiumSidecar:
        vars.CHROMIUM_SIDECAR === "true" || vars.chromiumSidecar === "true" || prev.chromiumSidecar,
      chromiumImage: getStringVar(vars, "CHROMIUM_IMAGE", "chromiumImage") || prev.chromiumImage,
      otelImage: prev.otelImage,
      cronEnabled: vars.cronEnabled === "true" ? true : prev.cronEnabled,
      subagentPolicy:
        (vars.subagentPolicy as DeployFormConfig["subagentPolicy"]) || prev.subagentPolicy,
    },
  };
}

function isProviderSelected(
  provider: InferenceProvider,
  selectedProviders: InferenceProvider[] | undefined,
): boolean {
  if (!selectedProviders) return true;
  return selectedProviders.includes(provider);
}

function vaultSecretRef(id: string): SecretRefValue {
  return {
    source: "exec",
    provider: "vault",
    id,
  };
}

function onePasswordSecretRef(vault: string, item: string): SecretRefValue {
  const vaultName = trimToUndefined(vault) || "OpenClaw";
  return {
    source: "exec",
    provider: "onepassword",
    id: `op://${vaultName}/${item}/credential`,
  };
}

export function buildDeployRequestBody(params: {
  mode: string;
  inferenceProvider: InferenceProvider;
  config: DeployFormConfig;
  isVertex: boolean;
  suggestedNamespace: string;
  selectedProviders?: InferenceProvider[];
  anthropicApiKeyRef?: SecretRefValue;
  openaiApiKeyRef?: SecretRefValue;
  googleApiKeyRef?: SecretRefValue;
  openrouterApiKeyRef?: SecretRefValue;
  modelEndpointApiKeyRef?: SecretRefValue;
  telegramBotTokenRef?: SecretRefValue;
}): Record<string, unknown> {
  const {
    mode,
    inferenceProvider,
    config,
    isVertex: _isVertex,
    suggestedNamespace,
    selectedProviders,
    anthropicApiKeyRef,
    openaiApiKeyRef,
    googleApiKeyRef,
    openrouterApiKeyRef,
    modelEndpointApiKeyRef,
    telegramBotTokenRef,
  } = params;
  const vertexProvider = inferenceProvider === "vertex-google" ? "google" : "anthropic";
  const podmanSecretMappings = parsePodmanSecretMappingsText(config.podmanSecretMappingsText).mappings;
  const pluginInstallSpecs = parsePluginInstallSpecsText(config.pluginInstallSpecsText);
  const sel = (p: InferenceProvider) => isProviderSelected(p, selectedProviders);
  const anyVertexSelected = sel("vertex-anthropic") || sel("vertex-google");
  const useProviderSecret = mode !== "local" && Boolean(config.providerSecretName.trim());
  const providerSecretRef = (id: string): SecretRefValue | undefined =>
    useProviderSecret ? { source: "env", provider: "default", id } : undefined;
  const effectiveAnthropicApiKeyRef =
    anthropicApiKeyRef || (config.vaultSecretsEnabled && sel("anthropic")
      ? vaultSecretRef("providers/anthropic/apiKey")
      : config.onePasswordSecretsEnabled && sel("anthropic")
        ? onePasswordSecretRef(config.onePasswordVault, "Anthropic")
      : providerSecretRef("ANTHROPIC_API_KEY"));
  const effectiveOpenaiApiKeyRef =
    openaiApiKeyRef || (config.vaultSecretsEnabled && sel("openai")
      ? vaultSecretRef("providers/openai/apiKey")
      : config.onePasswordSecretsEnabled && sel("openai")
        ? onePasswordSecretRef(config.onePasswordVault, "OpenAI")
      : providerSecretRef("OPENAI_API_KEY"));
  const effectiveGoogleApiKeyRef =
    googleApiKeyRef || (config.vaultSecretsEnabled && sel("google")
      ? vaultSecretRef("providers/google/apiKey")
      : config.onePasswordSecretsEnabled && sel("google")
        ? onePasswordSecretRef(config.onePasswordVault, "Google")
      : providerSecretRef("GEMINI_API_KEY"));
  const effectiveOpenrouterApiKeyRef =
    openrouterApiKeyRef || (config.vaultSecretsEnabled && sel("openrouter")
      ? vaultSecretRef("providers/openrouter/apiKey")
      : config.onePasswordSecretsEnabled && sel("openrouter")
        ? onePasswordSecretRef(config.onePasswordVault, "OpenRouter")
      : providerSecretRef("OPENROUTER_API_KEY"));
  const effectiveModelEndpointApiKeyRef =
    modelEndpointApiKeyRef || (config.vaultSecretsEnabled && sel("custom-endpoint")
      ? vaultSecretRef("providers/endpoint/apiKey")
      : config.onePasswordSecretsEnabled && sel("custom-endpoint")
        ? onePasswordSecretRef(config.onePasswordVault, "Endpoint")
      : providerSecretRef("MODEL_ENDPOINT_API_KEY"));

  return {
    mode,
    inferenceProvider,
    selectedProviders,
    prefix: config.prefix,
    agentName: config.agentName,
    agentDisplayName: config.agentDisplayName || config.agentName,
    image: trimToUndefined(config.image),
    containerRunArgs: mode === "local" ? trimToUndefined(config.containerRunArgs) : undefined,
    localFileOwner: mode === "local" ? trimToUndefined(config.localFileOwner) : undefined,
    podmanSecretMappings: mode === "local" && podmanSecretMappings.length > 0 ? podmanSecretMappings : undefined,
    vaultSecretsEnabled: config.vaultSecretsEnabled || undefined,
    vaultAddr: config.vaultSecretsEnabled ? trimToUndefined(config.vaultAddr) : undefined,
    vaultNamespace: config.vaultSecretsEnabled ? trimToUndefined(config.vaultNamespace) : undefined,
    vaultKvMount: config.vaultSecretsEnabled ? trimToUndefined(config.vaultKvMount) : undefined,
    vaultKvVersion: config.vaultSecretsEnabled ? trimToUndefined(config.vaultKvVersion) : undefined,
    vaultAuthMethod: config.vaultSecretsEnabled ? config.vaultAuthMethod : undefined,
    vaultAuthRole: config.vaultSecretsEnabled ? trimToUndefined(config.vaultAuthRole) : undefined,
    vaultAuthMount: config.vaultSecretsEnabled ? trimToUndefined(config.vaultAuthMount) : undefined,
    vaultJwtFile: config.vaultSecretsEnabled ? trimToUndefined(config.vaultJwtFile) : undefined,
    vaultTokenFile: config.vaultSecretsEnabled ? trimToUndefined(config.vaultTokenFile) : undefined,
    vaultTokenSecretName: config.vaultSecretsEnabled ? trimToUndefined(config.vaultTokenSecretName) : undefined,
    vaultTokenSecretKey: config.vaultSecretsEnabled ? trimToUndefined(config.vaultTokenSecretKey) : undefined,
    onePasswordSecretsEnabled: config.onePasswordSecretsEnabled || undefined,
    onePasswordVault: config.onePasswordSecretsEnabled ? trimToUndefined(config.onePasswordVault) : undefined,
    onePasswordTokenSecretName:
      config.onePasswordSecretsEnabled ? trimToUndefined(config.onePasswordTokenSecretName) : undefined,
    onePasswordTokenSecretKey:
      config.onePasswordSecretsEnabled ? trimToUndefined(config.onePasswordTokenSecretKey) : undefined,
    providerSecretName: mode !== "local" ? trimToUndefined(config.providerSecretName) : undefined,
    pluginInstallSpecs: pluginInstallSpecs.length > 0 ? pluginInstallSpecs : undefined,
    secretsProvidersJson: trimToUndefined(config.secretsProvidersJson),
    anthropicApiKeyRef: sel("anthropic") ? effectiveAnthropicApiKeyRef : undefined,
    openaiApiKeyRef: sel("openai") ? effectiveOpenaiApiKeyRef : undefined,
    googleApiKeyRef: sel("google") ? effectiveGoogleApiKeyRef : undefined,
    openrouterApiKeyRef: sel("openrouter") ? effectiveOpenrouterApiKeyRef : undefined,
    modelEndpointApiKeyRef: sel("custom-endpoint") ? effectiveModelEndpointApiKeyRef : undefined,
    telegramBotTokenRef: config.telegramEnabled ? telegramBotTokenRef : undefined,
    sandboxEnabled: config.sandboxEnabled || undefined,
    sandboxBackend: config.sandboxEnabled ? config.sandboxBackend : undefined,
    sandboxMode: config.sandboxEnabled ? config.sandboxMode : undefined,
    sandboxScope: config.sandboxEnabled ? config.sandboxScope : undefined,
    sandboxToolPolicyEnabled:
      config.sandboxEnabled ? config.sandboxToolPolicyEnabled || undefined : undefined,
    sandboxToolAllowFiles: config.sandboxEnabled ? config.sandboxToolAllowFiles : undefined,
    sandboxToolAllowSessions: config.sandboxEnabled ? config.sandboxToolAllowSessions : undefined,
    sandboxToolAllowMemory: config.sandboxEnabled ? config.sandboxToolAllowMemory : undefined,
    sandboxToolAllowRuntime: config.sandboxEnabled ? config.sandboxToolAllowRuntime : undefined,
    sandboxToolAllowBrowser: config.sandboxEnabled ? config.sandboxToolAllowBrowser : undefined,
    sandboxToolAllowAutomation: config.sandboxEnabled ? config.sandboxToolAllowAutomation : undefined,
    sandboxToolAllowMessaging: config.sandboxEnabled ? config.sandboxToolAllowMessaging : undefined,
    sandboxToolAllowWebFetch: config.sandboxEnabled ? config.sandboxToolAllowWebFetch : undefined,
    sandboxWorkspaceAccess: config.sandboxEnabled ? config.sandboxWorkspaceAccess : undefined,
    sandboxOpenShellGatewayEndpoint:
      config.sandboxEnabled && config.sandboxBackend === "openshell"
        ? config.sandboxOpenShellGatewayEndpoint || undefined
        : undefined,
    sandboxOpenShellMode:
      config.sandboxEnabled && config.sandboxBackend === "openshell"
        ? config.sandboxOpenShellMode
        : undefined,
    sandboxOpenShellFrom:
      config.sandboxEnabled && config.sandboxBackend === "openshell"
        ? trimToUndefined(config.sandboxOpenShellFrom)
        : undefined,
    sandboxSshTarget:
      config.sandboxEnabled && config.sandboxBackend === "ssh"
        ? config.sandboxSshTarget || undefined
        : undefined,
    sandboxSshWorkspaceRoot:
      config.sandboxEnabled && config.sandboxBackend === "ssh"
        ? config.sandboxSshWorkspaceRoot || undefined
        : undefined,
    sandboxSshIdentityPath:
      config.sandboxEnabled && config.sandboxBackend === "ssh"
        ? config.sandboxSshIdentityPath || undefined
        : undefined,
    sandboxSshCertificatePath:
      config.sandboxEnabled && config.sandboxBackend === "ssh"
        ? config.sandboxSshCertificatePath || undefined
        : undefined,
    sandboxSshKnownHostsPath:
      config.sandboxEnabled && config.sandboxBackend === "ssh"
        ? config.sandboxSshKnownHostsPath || undefined
        : undefined,
    sandboxSshStrictHostKeyChecking:
      config.sandboxEnabled && config.sandboxBackend === "ssh"
        ? config.sandboxSshStrictHostKeyChecking
        : undefined,
    sandboxSshUpdateHostKeys:
      config.sandboxEnabled && config.sandboxBackend === "ssh"
        ? config.sandboxSshUpdateHostKeys
        : undefined,
    sandboxSshCertificate:
      config.sandboxEnabled && config.sandboxBackend === "ssh"
        ? config.sandboxSshCertificate || undefined
        : undefined,
    sandboxSshKnownHosts:
      config.sandboxEnabled && config.sandboxBackend === "ssh"
        ? config.sandboxSshKnownHosts || undefined
        : undefined,
    anthropicApiKey: sel("anthropic") && !effectiveAnthropicApiKeyRef ? trimToUndefined(config.anthropicApiKey) : undefined,
    openaiApiKey: sel("openai") && !effectiveOpenaiApiKeyRef ? trimToUndefined(config.openaiApiKey) : undefined,
    codexOauthMode: sel("openai-codex") ? "codex-cli" : undefined,
    codexOauthProfileId: sel("openai-codex") ? trimToUndefined(config.codexOauthProfileId) : undefined,
    codexOauthAuthJsonPath: sel("openai-codex") ? trimToUndefined(config.codexOauthAuthJsonPath) : undefined,
    googleApiKey: sel("google") && !effectiveGoogleApiKeyRef ? trimToUndefined(config.googleApiKey) : undefined,
    openrouterApiKey: sel("openrouter") && !effectiveOpenrouterApiKeyRef ? trimToUndefined(config.openrouterApiKey) : undefined,
    anthropicModel: sel("anthropic") ? trimToUndefined(config.anthropicModel) : undefined,
    anthropicModels: sel("anthropic") && config.anthropicModels.length > 0 ? config.anthropicModels : undefined,
    openaiModel: sel("openai") ? trimToUndefined(config.openaiModel) : undefined,
    openaiModels: sel("openai") && config.openaiModels.length > 0 ? config.openaiModels : undefined,
    codexModel: sel("openai-codex") ? trimToUndefined(config.codexModel) : undefined,
    codexModels: sel("openai-codex") && config.codexModels.length > 0 ? config.codexModels : undefined,
    googleModel: sel("google") ? trimToUndefined(config.googleModel) : undefined,
    googleModels: sel("google") && config.googleModels.length > 0 ? config.googleModels : undefined,
    openrouterModel: sel("openrouter") ? trimToUndefined(config.openrouterModel) : undefined,
    openrouterModels: sel("openrouter") && config.openrouterModels.length > 0 ? config.openrouterModels : undefined,
    agentModel: config.agentModel || undefined,
    vertexAnthropicModel: sel("vertex-anthropic") ? trimToUndefined(config.vertexAnthropicModel) : undefined,
    vertexAnthropicModels: sel("vertex-anthropic") && config.vertexAnthropicModels.length > 0 ? config.vertexAnthropicModels : undefined,
    vertexGoogleModel: sel("vertex-google") ? trimToUndefined(config.vertexGoogleModel) : undefined,
    vertexGoogleModels: sel("vertex-google") && config.vertexGoogleModels.length > 0 ? config.vertexGoogleModels : undefined,
    openaiCompatibleEndpointsEnabled: config.openaiCompatibleEndpointsEnabled,
    modelEndpoint: sel("custom-endpoint") ? trimToUndefined(config.modelEndpoint) : undefined,
    modelEndpointApiKey: sel("custom-endpoint") && !effectiveModelEndpointApiKeyRef ? trimToUndefined(config.modelEndpointApiKey) : undefined,
    modelEndpointModel: sel("custom-endpoint") ? trimToUndefined(config.modelEndpointModel) : undefined,
    modelEndpointModelLabel: sel("custom-endpoint") ? trimToUndefined(config.modelEndpointModelLabel) : undefined,
    modelEndpointModels: sel("custom-endpoint") && config.modelEndpointModels.length > 0 ? config.modelEndpointModels : undefined,
    port: parseInt(config.port, 10) || 18789,
    vertexEnabled: anyVertexSelected || undefined,
    vertexProvider: anyVertexSelected ? vertexProvider : undefined,
    googleCloudProject: anyVertexSelected ? trimToUndefined(config.googleCloudProject) : undefined,
    googleCloudLocation: anyVertexSelected ? trimToUndefined(config.googleCloudLocation) : undefined,
    gcpServiceAccountJson: anyVertexSelected ? trimToUndefined(config.gcpServiceAccountJson) : undefined,
    gcpServiceAccountPath: anyVertexSelected ? trimToUndefined(config.gcpServiceAccountPath) : undefined,
    litellmProxy: anyVertexSelected ? config.litellmProxy : undefined,
    namespace: trimToUndefined(config.namespace) || suggestedNamespace || undefined,
    withA2a: config.withA2a || undefined,
    a2aRealm: config.withA2a ? trimToUndefined(config.a2aRealm) : undefined,
    a2aKeycloakNamespace: config.withA2a ? trimToUndefined(config.a2aKeycloakNamespace) : undefined,
    sshHost: trimToUndefined(config.sshHost),
    sshUser: trimToUndefined(config.sshUser),
    agentSourceDir:
      config.agentSourceType === "directory" ? trimToUndefined(config.agentSourceDir) : undefined,
    agentSourceGitUrl:
      config.agentSourceType === "git" ? trimToUndefined(config.agentSourceGitUrl) : undefined,
    agentSourceGitRef:
      config.agentSourceType === "git" ? trimToUndefined(config.agentSourceGitRef) : undefined,
    agentSourceGitPath:
      config.agentSourceType === "git" ? trimToUndefined(config.agentSourceGitPath) : undefined,
    telegramEnabled: config.telegramEnabled || undefined,
    telegramBotToken:
      config.telegramEnabled && !telegramBotTokenRef ? trimToUndefined(config.telegramBotToken) : undefined,
    telegramAllowFrom: config.telegramEnabled ? trimToUndefined(config.telegramAllowFrom) : undefined,
    otelEnabled: config.otelEnabled || undefined,
    otelJaeger: config.otelEnabled ? config.otelJaeger || undefined : undefined,
    otelEndpoint: config.otelEnabled ? trimToUndefined(config.otelEndpoint) : undefined,
    otelExperimentId: config.otelEnabled ? trimToUndefined(config.otelExperimentId) : undefined,
    otelTlsSkipVerify: config.otelEnabled ? config.otelTlsSkipVerify || undefined : undefined,
    chromiumSidecar: config.chromiumSidecar || undefined,
    chromiumImage: config.chromiumSidecar ? trimToUndefined(config.chromiumImage) : undefined,
    cronEnabled: config.cronEnabled || undefined,
    subagentPolicy: config.subagentPolicy !== "none" ? config.subagentPolicy : undefined,
  };
}

export function buildEnvFileContent(params: {
  config: DeployFormConfig;
  inferenceProvider: InferenceProvider;
  isVertex: boolean;
  suggestedNamespace: string;
  selectedProviders?: InferenceProvider[];
  anthropicApiKeyRef?: SecretRefValue;
  openaiApiKeyRef?: SecretRefValue;
  googleApiKeyRef?: SecretRefValue;
  openrouterApiKeyRef?: SecretRefValue;
  modelEndpointApiKeyRef?: SecretRefValue;
  telegramBotTokenRef?: SecretRefValue;
}): string {
  const {
    config,
    inferenceProvider,
    isVertex: _isVertex,
    suggestedNamespace,
    selectedProviders,
    anthropicApiKeyRef,
    openaiApiKeyRef,
    googleApiKeyRef,
    openrouterApiKeyRef,
    modelEndpointApiKeyRef,
    telegramBotTokenRef,
  } = params;
  const sel = (p: InferenceProvider) => isProviderSelected(p, selectedProviders);
  const anyVertexSelected = sel("vertex-anthropic") || sel("vertex-google");
  const pluginInstallSpecs = parsePluginInstallSpecsText(config.pluginInstallSpecsText);
  const useProviderSecret = Boolean(config.providerSecretName.trim());
  const providerSecretRef = (id: string): SecretRefValue | undefined =>
    useProviderSecret ? { source: "env", provider: "default", id } : undefined;
  const effectiveAnthropicApiKeyRef =
    anthropicApiKeyRef || (config.vaultSecretsEnabled && sel("anthropic")
      ? vaultSecretRef("providers/anthropic/apiKey")
      : config.onePasswordSecretsEnabled && sel("anthropic")
        ? onePasswordSecretRef(config.onePasswordVault, "Anthropic")
      : providerSecretRef("ANTHROPIC_API_KEY"));
  const effectiveOpenaiApiKeyRef =
    openaiApiKeyRef || (config.vaultSecretsEnabled && sel("openai")
      ? vaultSecretRef("providers/openai/apiKey")
      : config.onePasswordSecretsEnabled && sel("openai")
        ? onePasswordSecretRef(config.onePasswordVault, "OpenAI")
      : providerSecretRef("OPENAI_API_KEY"));
  const effectiveGoogleApiKeyRef =
    googleApiKeyRef || (config.vaultSecretsEnabled && sel("google")
      ? vaultSecretRef("providers/google/apiKey")
      : config.onePasswordSecretsEnabled && sel("google")
        ? onePasswordSecretRef(config.onePasswordVault, "Google")
      : providerSecretRef("GEMINI_API_KEY"));
  const effectiveOpenrouterApiKeyRef =
    openrouterApiKeyRef || (config.vaultSecretsEnabled && sel("openrouter")
      ? vaultSecretRef("providers/openrouter/apiKey")
      : config.onePasswordSecretsEnabled && sel("openrouter")
        ? onePasswordSecretRef(config.onePasswordVault, "OpenRouter")
      : providerSecretRef("OPENROUTER_API_KEY"));
  const effectiveModelEndpointApiKeyRef =
    modelEndpointApiKeyRef || (config.vaultSecretsEnabled && sel("custom-endpoint")
      ? vaultSecretRef("providers/endpoint/apiKey")
      : config.onePasswordSecretsEnabled && sel("custom-endpoint")
        ? onePasswordSecretRef(config.onePasswordVault, "Endpoint")
      : providerSecretRef("MODEL_ENDPOINT_API_KEY"));

  const lines = [
    "# OpenClaw installer config",
    `OPENCLAW_PREFIX=${config.prefix}`,
    `OPENCLAW_AGENT_NAME=${config.agentName}`,
    `OPENCLAW_DISPLAY_NAME=${config.agentDisplayName}`,
    `OPENCLAW_IMAGE=${config.image}`,
    `OPENCLAW_CONTAINER_RUN_ARGS=${config.containerRunArgs}`,
    `OPENCLAW_LOCAL_FILE_OWNER=${config.localFileOwner}`,
    `PODMAN_SECRET_MAPPINGS_B64=${encodeBase64(JSON.stringify(parsePodmanSecretMappingsText(config.podmanSecretMappingsText).mappings))}`,
    `VAULT_SECRETS_ENABLED=${config.vaultSecretsEnabled}`,
    `VAULT_ADDR=${config.vaultAddr}`,
    `VAULT_NAMESPACE=${config.vaultNamespace}`,
    `OPENCLAW_VAULT_KV_MOUNT=${config.vaultKvMount}`,
    `OPENCLAW_VAULT_KV_VERSION=${config.vaultKvVersion}`,
    `CLAW_VAULT_KV_MOUNT=${config.vaultKvMount}`,
    `CLAW_VAULT_KV_VERSION=${config.vaultKvVersion}`,
    `VAULT_TOKEN_SECRET_NAME=${config.vaultTokenSecretName}`,
    `VAULT_TOKEN_SECRET_KEY=${config.vaultTokenSecretKey}`,
    `ONEPASSWORD_SECRETS_ENABLED=${config.onePasswordSecretsEnabled}`,
    `CLAW_1PASSWORD_VAULT=${config.onePasswordVault}`,
    `ONEPASSWORD_TOKEN_SECRET_NAME=${config.onePasswordTokenSecretName}`,
    `ONEPASSWORD_TOKEN_SECRET_KEY=${config.onePasswordTokenSecretKey}`,
    `OPENCLAW_PROVIDER_SECRET_NAME=${config.providerSecretName}`,
    `OPENCLAW_PLUGIN_INSTALL_SPECS_B64=${encodeBase64(JSON.stringify(pluginInstallSpecs))}`,
    `OPENCLAW_PORT=${config.port}`,
    `AGENT_SOURCE_DIR=${config.agentSourceType === "directory" ? config.agentSourceDir : ""}`,
    `AGENT_SOURCE_GIT_URL=${config.agentSourceType === "git" ? config.agentSourceGitUrl : ""}`,
    `AGENT_SOURCE_GIT_REF=${config.agentSourceType === "git" ? config.agentSourceGitRef : ""}`,
    `AGENT_SOURCE_GIT_PATH=${config.agentSourceType === "git" ? config.agentSourceGitPath : ""}`,
    "",
    `INFERENCE_PROVIDER=${inferenceProvider}`,
    `ANTHROPIC_API_KEY=${sel("anthropic") && !effectiveAnthropicApiKeyRef ? config.anthropicApiKey : ""}`,
    `OPENAI_API_KEY=${sel("openai") && !effectiveOpenaiApiKeyRef ? config.openaiApiKey : ""}`,
    `CODEX_OAUTH_MODE=${sel("openai-codex") ? "codex-cli" : ""}`,
    `CODEX_OAUTH_PROFILE_ID=${sel("openai-codex") ? config.codexOauthProfileId : ""}`,
    `CODEX_OAUTH_AUTH_JSON_PATH=${sel("openai-codex") ? config.codexOauthAuthJsonPath : ""}`,
    `GEMINI_API_KEY=${sel("google") && !effectiveGoogleApiKeyRef ? config.googleApiKey : ""}`,
    `OPENROUTER_API_KEY=${sel("openrouter") && !effectiveOpenrouterApiKeyRef ? config.openrouterApiKey : ""}`,
    `ANTHROPIC_MODEL=${sel("anthropic") ? config.anthropicModel : ""}`,
    `ANTHROPIC_MODELS_B64=${encodeBase64(JSON.stringify(sel("anthropic") ? config.anthropicModels : []))}`,
    `OPENAI_MODEL=${sel("openai") ? config.openaiModel : ""}`,
    `OPENAI_MODELS_B64=${encodeBase64(JSON.stringify(sel("openai") ? config.openaiModels : []))}`,
    `CODEX_MODEL=${sel("openai-codex") ? config.codexModel : ""}`,
    `CODEX_MODELS_B64=${encodeBase64(JSON.stringify(sel("openai-codex") ? config.codexModels : []))}`,
    `GOOGLE_MODEL=${sel("google") ? config.googleModel : ""}`,
    `GOOGLE_MODELS_B64=${encodeBase64(JSON.stringify(sel("google") ? config.googleModels : []))}`,
    `OPENROUTER_MODEL=${sel("openrouter") ? config.openrouterModel : ""}`,
    `OPENROUTER_MODELS_B64=${encodeBase64(JSON.stringify(sel("openrouter") ? config.openrouterModels : []))}`,
    `OPENAI_COMPATIBLE_ENDPOINTS_ENABLED=${config.openaiCompatibleEndpointsEnabled}`,
    `MODEL_ENDPOINT=${sel("custom-endpoint") ? config.modelEndpoint : ""}`,
    `MODEL_ENDPOINT_API_KEY=${sel("custom-endpoint") && !effectiveModelEndpointApiKeyRef ? config.modelEndpointApiKey : ""}`,
    `MODEL_ENDPOINT_MODEL=${sel("custom-endpoint") ? config.modelEndpointModel : ""}`,
    `MODEL_ENDPOINT_MODEL_LABEL=${sel("custom-endpoint") ? config.modelEndpointModelLabel : ""}`,
    `MODEL_ENDPOINT_MODELS_B64=${encodeBase64(JSON.stringify(sel("custom-endpoint") ? config.modelEndpointModels : []))}`,
    `AGENT_MODEL=${config.agentModel}`,
    `VERTEX_ANTHROPIC_MODEL=${sel("vertex-anthropic") ? config.vertexAnthropicModel : ""}`,
    `VERTEX_ANTHROPIC_MODELS_B64=${encodeBase64(JSON.stringify(sel("vertex-anthropic") ? config.vertexAnthropicModels : []))}`,
    `VERTEX_GOOGLE_MODEL=${sel("vertex-google") ? config.vertexGoogleModel : ""}`,
    `VERTEX_GOOGLE_MODELS_B64=${encodeBase64(JSON.stringify(sel("vertex-google") ? config.vertexGoogleModels : []))}`,
    "",
    `VERTEX_ENABLED=${anyVertexSelected}`,
    `VERTEX_PROVIDER=${inferenceProvider === "vertex-google" ? "google" : "anthropic"}`,
    `GOOGLE_CLOUD_PROJECT=${config.googleCloudProject}`,
    `GOOGLE_CLOUD_LOCATION=${config.googleCloudLocation}`,
    `GCP_SERVICE_ACCOUNT_PATH=${config.gcpServiceAccountPath}`,
    `LITELLM_PROXY=${config.litellmProxy}`,
    "",
    `SANDBOX_ENABLED=${config.sandboxEnabled}`,
    `SANDBOX_BACKEND=${config.sandboxBackend}`,
    `SANDBOX_MODE=${config.sandboxMode}`,
    `SANDBOX_SCOPE=${config.sandboxScope}`,
    `SANDBOX_WORKSPACE_ACCESS=${config.sandboxWorkspaceAccess}`,
    `SANDBOX_OPENSHELL_GATEWAY_ENDPOINT=${config.sandboxOpenShellGatewayEndpoint}`,
    `SANDBOX_OPENSHELL_MODE=${config.sandboxOpenShellMode}`,
    `SANDBOX_OPENSHELL_FROM=${config.sandboxOpenShellFrom}`,
    `SANDBOX_SSH_TARGET=${config.sandboxSshTarget}`,
    `SANDBOX_SSH_WORKSPACE_ROOT=${config.sandboxSshWorkspaceRoot}`,
    `SANDBOX_SSH_IDENTITY_PATH=${config.sandboxSshIdentityPath}`,
    `SANDBOX_SSH_CERTIFICATE_PATH=${config.sandboxSshCertificatePath}`,
    `SANDBOX_SSH_KNOWN_HOSTS_PATH=${config.sandboxSshKnownHostsPath}`,
    `SANDBOX_SSH_STRICT_HOST_KEY_CHECKING=${config.sandboxSshStrictHostKeyChecking}`,
    `SANDBOX_SSH_UPDATE_HOST_KEYS=${config.sandboxSshUpdateHostKeys}`,
    `SANDBOX_TOOL_POLICY_ENABLED=${config.sandboxToolPolicyEnabled}`,
    `SANDBOX_TOOL_ALLOW_FILES=${config.sandboxToolAllowFiles}`,
    `SANDBOX_TOOL_ALLOW_SESSIONS=${config.sandboxToolAllowSessions}`,
    `SANDBOX_TOOL_ALLOW_MEMORY=${config.sandboxToolAllowMemory}`,
    `SANDBOX_TOOL_ALLOW_RUNTIME=${config.sandboxToolAllowRuntime}`,
    `SANDBOX_TOOL_ALLOW_BROWSER=${config.sandboxToolAllowBrowser}`,
    `SANDBOX_TOOL_ALLOW_AUTOMATION=${config.sandboxToolAllowAutomation}`,
    `SANDBOX_TOOL_ALLOW_MESSAGING=${config.sandboxToolAllowMessaging}`,
    `SANDBOX_TOOL_ALLOW_WEB_FETCH=${config.sandboxToolAllowWebFetch}`,
    "",
    `TELEGRAM_ENABLED=${config.telegramEnabled}`,
    `TELEGRAM_BOT_TOKEN=${telegramBotTokenRef ? "" : config.telegramBotToken}`,
    `TELEGRAM_ALLOW_FROM=${config.telegramAllowFrom}`,
    `OTEL_ENABLED=${config.otelEnabled}`,
    `OTEL_JAEGER=${config.otelJaeger}`,
    `OTEL_ENDPOINT=${config.otelEndpoint}`,
    `OTEL_EXPERIMENT_ID=${config.otelExperimentId}`,
    `OTEL_TLS_SKIP_VERIFY=${config.otelTlsSkipVerify}`,
    `CHROMIUM_SIDECAR=${config.chromiumSidecar}`,
    `CHROMIUM_IMAGE=${config.chromiumImage}`,
    "",
    `K8S_NAMESPACE=${config.namespace || suggestedNamespace}`,
    `WITH_A2A=${config.withA2a}`,
    `A2A_REALM=${config.a2aRealm}`,
    `A2A_KEYCLOAK_NAMESPACE=${config.a2aKeycloakNamespace}`,
  ];

  if (config.sandboxSshCertificate && !config.sandboxSshCertificatePath) {
    lines.push(`SANDBOX_SSH_CERTIFICATE_B64=${encodeBase64(config.sandboxSshCertificate)}`);
  }
  if (config.sandboxSshKnownHosts && !config.sandboxSshKnownHostsPath) {
    lines.push(`SANDBOX_SSH_KNOWN_HOSTS_B64=${encodeBase64(config.sandboxSshKnownHosts)}`);
  }
  if (config.secretsProvidersJson.trim()) {
    lines.push(`SECRETS_PROVIDERS_JSON_B64=${encodeBase64(config.secretsProvidersJson)}`);
  }
  if (sel("anthropic") && effectiveAnthropicApiKeyRef) {
    lines.push(`ANTHROPIC_API_KEY_REF_B64=${encodeBase64(JSON.stringify(effectiveAnthropicApiKeyRef))}`);
  }
  if (sel("openai") && effectiveOpenaiApiKeyRef) {
    lines.push(`OPENAI_API_KEY_REF_B64=${encodeBase64(JSON.stringify(effectiveOpenaiApiKeyRef))}`);
  }
  if (sel("google") && effectiveGoogleApiKeyRef) {
    lines.push(`GOOGLE_API_KEY_REF_B64=${encodeBase64(JSON.stringify(effectiveGoogleApiKeyRef))}`);
  }
  if (sel("openrouter") && effectiveOpenrouterApiKeyRef) {
    lines.push(`OPENROUTER_API_KEY_REF_B64=${encodeBase64(JSON.stringify(effectiveOpenrouterApiKeyRef))}`);
  }
  if (sel("custom-endpoint") && effectiveModelEndpointApiKeyRef) {
    lines.push(`MODEL_ENDPOINT_API_KEY_REF_B64=${encodeBase64(JSON.stringify(effectiveModelEndpointApiKeyRef))}`);
  }
  if (telegramBotTokenRef) {
    lines.push(`TELEGRAM_BOT_TOKEN_REF_B64=${encodeBase64(JSON.stringify(telegramBotTokenRef))}`);
  }

  return lines.join("\n") + "\n";
}
