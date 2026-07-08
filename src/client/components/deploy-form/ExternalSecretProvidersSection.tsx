import React from "react";
import type { DeployFormConfig, InferenceProvider } from "./types.js";

export interface ProviderSecretStatus {
  namespace: string;
  name: string;
  checking: boolean;
  exists?: boolean;
  keys?: string[];
  error?: string;
  forbidden?: boolean;
}

interface ExternalSecretProvidersSectionProps {
  config: DeployFormConfig;
  isClusterMode: boolean;
  isHostedMode: boolean;
  providerSecretStatus: ProviderSecretStatus | null;
  selectedProviders: InferenceProvider[];
  suggestedNamespace: string;
  update: (field: string, value: string) => void;
  onVaultEnabledChange: (enabled: boolean) => void;
  onOnePasswordEnabledChange: (enabled: boolean) => void;
}

const VAULT_PROVIDER_REFS: Partial<Record<InferenceProvider, {
  label: string;
  idField: keyof DeployFormConfig;
  sourceField: keyof DeployFormConfig;
  providerField: keyof DeployFormConfig;
  defaultId: string;
}>> = {
  anthropic: {
    label: "Anthropic API key",
    idField: "anthropicApiKeyRefId",
    sourceField: "anthropicApiKeyRefSource",
    providerField: "anthropicApiKeyRefProvider",
    defaultId: "providers/anthropic/apiKey",
  },
  openai: {
    label: "OpenAI API key",
    idField: "openaiApiKeyRefId",
    sourceField: "openaiApiKeyRefSource",
    providerField: "openaiApiKeyRefProvider",
    defaultId: "providers/openai/apiKey",
  },
  google: {
    label: "Google API key",
    idField: "googleApiKeyRefId",
    sourceField: "googleApiKeyRefSource",
    providerField: "googleApiKeyRefProvider",
    defaultId: "providers/google/apiKey",
  },
  openrouter: {
    label: "OpenRouter API key",
    idField: "openrouterApiKeyRefId",
    sourceField: "openrouterApiKeyRefSource",
    providerField: "openrouterApiKeyRefProvider",
    defaultId: "providers/openrouter/apiKey",
  },
  "custom-endpoint": {
    label: "OpenAI-compatible endpoint API key",
    idField: "modelEndpointApiKeyRefId",
    sourceField: "modelEndpointApiKeyRefSource",
    providerField: "modelEndpointApiKeyRefProvider",
    defaultId: "providers/endpoint/apiKey",
  },
};

const ONEPASSWORD_PROVIDER_ITEMS: Partial<Record<InferenceProvider, { label: string; item: string }>> = {
  anthropic: { label: "Anthropic API key", item: "Anthropic" },
  openai: { label: "OpenAI API key", item: "OpenAI" },
  google: { label: "Google API key", item: "Google" },
  openrouter: { label: "OpenRouter API key", item: "OpenRouter" },
  "custom-endpoint": { label: "OpenAI-compatible endpoint API key", item: "Endpoint" },
};

export function ExternalSecretProvidersSection({
  config,
  isClusterMode,
  isHostedMode,
  providerSecretStatus,
  selectedProviders,
  suggestedNamespace,
  update,
  onVaultEnabledChange,
  onOnePasswordEnabledChange,
}: ExternalSecretProvidersSectionProps) {
  const vaultRefs = selectedProviders
    .map((provider) => VAULT_PROVIDER_REFS[provider])
    .filter((entry): entry is NonNullable<typeof VAULT_PROVIDER_REFS[InferenceProvider]> => Boolean(entry));
  const onePasswordVault = config.onePasswordVault.trim() || "OpenClaw";
  const onePasswordRefs = selectedProviders
    .map((provider) => ONEPASSWORD_PROVIDER_ITEMS[provider])
    .filter((entry): entry is { label: string; item: string } => Boolean(entry))
    .map((entry) => ({ ...entry, id: `op://${onePasswordVault}/${entry.item}/credential` }));

  const namespace = config.namespace.trim() || suggestedNamespace || "<target-namespace>";
  const providerSecretName = config.providerSecretName.trim() || "openclaw-provider-secrets";
  const updateVaultRefId = (entry: NonNullable<typeof VAULT_PROVIDER_REFS[InferenceProvider]>, value: string) => {
    update(entry.sourceField, "exec");
    update(entry.providerField, "vault");
    update(entry.idField, value);
  };

  const nestedDetailsStyle: React.CSSProperties = {
    marginTop: "1rem",
    paddingTop: "0.75rem",
    borderTop: "1px solid var(--border)",
  };
  const nestedSummaryStyle: React.CSSProperties = { cursor: "pointer", fontWeight: 600 };

  return (
    <details open={isHostedMode} style={{ marginTop: "1rem" }}>
      <summary style={{ cursor: "pointer", fontWeight: 600 }}>External Secret Providers</summary>
      <div className="card" style={{ marginTop: "0.75rem" }}>
        <div className="hint" style={{ marginBottom: "0.75rem" }}>
          Configure OpenClaw to resolve credentials through SecretRef providers instead of writing provider API keys
          into the installer-managed Secret. Each provider below is configured independently.
        </div>

        {isClusterMode && (
          <details open={isHostedMode} style={nestedDetailsStyle}>
            <summary style={nestedSummaryStyle}>OpenShift Provider Secret</summary>
          <div className="form-group" style={{ marginTop: "0.75rem" }}>
            <label>OpenShift Provider Secret Name</label>
            <input
              type="text"
              placeholder="openclaw-provider-secrets"
              value={config.providerSecretName}
              onChange={(e) => update("providerSecretName", e.target.value)}
            />
            <div className="hint">
              {isHostedMode
                ? "Create this Secret in the target namespace before deploying. The hosted installer reads JSON credentials from it and mounts it into the OpenClaw pod."
                : "Optional. Mounts an existing Secret from the target namespace as provider environment variables and configures selected providers to use SecretRefs."}{" "}
              Supported keys include <code>ANTHROPIC_API_KEY</code>, <code>OPENAI_API_KEY</code>,
              <code>GEMINI_API_KEY</code>, <code>OPENROUTER_API_KEY</code>,
              <code>OPENAI_CODEX_AUTH_JSON</code>, and <code>GOOGLE_APPLICATION_CREDENTIALS_JSON</code>.
            </div>
            {isHostedMode && (
              <>
                {providerSecretStatus?.checking && (
                  <div className="hint" style={{ marginTop: "0.5rem" }}>
                    Checking <code>{providerSecretName}</code> in <code>{namespace}</code>...
                  </div>
                )}
                {providerSecretStatus && !providerSecretStatus.checking && providerSecretStatus.exists === true && (
                  <div
                    style={{
                      marginTop: "0.5rem",
                      padding: "0.5rem 0.75rem",
                      background: "var(--accent-soft)",
                      border: "1px solid var(--border-focus)",
                      borderRadius: "var(--radius-sm)",
                      fontSize: "0.85rem",
                      color: "var(--text-secondary)",
                    }}
                  >
                    Found <code>{providerSecretStatus.name}</code> in <code>{providerSecretStatus.namespace}</code>
                    {providerSecretStatus.keys && providerSecretStatus.keys.length > 0
                      ? <> with keys: <code>{providerSecretStatus.keys.join(", ")}</code></>
                      : <>.</>}
                  </div>
                )}
                {providerSecretStatus && !providerSecretStatus.checking && providerSecretStatus.exists === false && (
                  <div
                    style={{
                      marginTop: "0.5rem",
                      padding: "0.5rem 0.75rem",
                      background: "var(--danger-soft)",
                      border: "1px solid var(--danger)",
                      borderRadius: "var(--radius-sm)",
                      fontSize: "0.85rem",
                      color: "var(--danger)",
                    }}
                  >
                    {providerSecretStatus.error || `Secret ${providerSecretName} is not ready.`}
                    {" "}Create the project and Secret before deploying, or pick a namespace where you have admin/edit access.
                  </div>
                )}
                <div className="hint" style={{ marginTop: "0.75rem" }}>
                  Create the target project first if it does not already exist:
                </div>
                <pre style={{ whiteSpace: "pre-wrap", fontSize: "0.78rem", marginTop: "0.35rem" }}>
{`oc new-project ${namespace}`}
                </pre>
                <div className="hint" style={{ marginTop: "0.75rem" }}>
                  For API-key providers, create the Secret with the keys you use and remove the rest:
                </div>
                <pre style={{ whiteSpace: "pre-wrap", fontSize: "0.78rem", marginTop: "0.35rem" }}>
{`oc create secret generic ${providerSecretName} \\
  -n ${namespace} \\
  --from-literal=ANTHROPIC_API_KEY=sk-ant-... \\
  --from-literal=OPENAI_API_KEY=sk-... \\
  --from-literal=GEMINI_API_KEY=AIza... \\
  --from-literal=OPENROUTER_API_KEY=sk-or-...`}
                </pre>
                <div className="hint" style={{ marginTop: "0.75rem" }}>
                  For OpenAI Codex OAuth or Google Vertex, add file-backed keys to the same Secret:
                </div>
                <pre style={{ whiteSpace: "pre-wrap", fontSize: "0.78rem", marginTop: "0.35rem" }}>
{`oc create secret generic ${providerSecretName} \\
  -n ${namespace} \\
  --from-file=OPENAI_CODEX_AUTH_JSON=$HOME/.codex/auth.json \\
  --from-file=GOOGLE_APPLICATION_CREDENTIALS_JSON=$HOME/.config/gcloud/application_default_credentials.json \\
  --from-literal=GOOGLE_CLOUD_LOCATION=us-east5`}
                </pre>
              </>
            )}
          </div>
          </details>
        )}

        <details open={config.vaultSecretsEnabled} style={nestedDetailsStyle}>
          <summary style={nestedSummaryStyle}>HashiCorp Vault</summary>
        <div className="form-group" style={{ marginTop: "0.75rem" }}>
          <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <input
              type="checkbox"
              checked={config.vaultSecretsEnabled}
              onChange={(e) => onVaultEnabledChange(e.target.checked)}
              style={{ width: "auto" }}
            />
            Configure HashiCorp Vault SecretRefs
          </label>
          <div className="hint">
            Creates the <code>vault</code> SecretRef provider backed by the <code>vault</code> plugin and points
            selected credential SecretRefs at Vault paths such as <code>providers/openai/apiKey</code>. {isClusterMode
              ? "The Vault token must already exist as a Secret in the target namespace."
              : "For local deploys, the installer passes VAULT_TOKEN from its environment when present; otherwise provide it with container run args."}{" "}
            The installer installs <code>git:github.com/sallyom/claw-vault</code> automatically when this is enabled.
          </div>
        </div>

        {config.vaultSecretsEnabled && (
          <>
            <div className="form-row">
              <div className="form-group">
                <label>Vault Address</label>
                <input
                  type="text"
                  placeholder="http://vault.vault.svc:8200"
                  value={config.vaultAddr}
                  onChange={(e) => update("vaultAddr", e.target.value)}
                />
              </div>
              <div className="form-group">
                <label>Vault Namespace</label>
                <input
                  type="text"
                  placeholder="optional"
                  value={config.vaultNamespace}
                  onChange={(e) => update("vaultNamespace", e.target.value)}
                />
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>KV Mount</label>
                <input
                  type="text"
                  placeholder="users"
                  value={config.vaultKvMount}
                  onChange={(e) => update("vaultKvMount", e.target.value)}
                />
                <div className="hint">
                  For API paths like <code>/v1/users/data/team-name/anthropic</code>, use mount <code>users</code>.
                </div>
              </div>
              <div className="form-group">
                <label>KV Version</label>
                <select
                  value={config.vaultKvVersion}
                  onChange={(e) => update("vaultKvVersion", e.target.value)}
                >
                  <option value="2">2</option>
                  <option value="1">1</option>
                </select>
              </div>
            </div>

            <div className="form-group">
              <label>Auth Method</label>
              <select
                value={config.vaultAuthMethod}
                onChange={(e) => update("vaultAuthMethod", e.target.value)}
              >
                <option value="token">token</option>
                <option value="kubernetes">kubernetes</option>
                <option value="jwt">jwt</option>
                <option value="token_file">token_file</option>
              </select>
              <div className="hint">
                {config.vaultAuthMethod === "token" && (isClusterMode
                  ? <>The client token is read from the Secret below. Mint it however your Vault allows (for an OIDC/Keycloak Vault, run <code>vault login -method=oidc</code> and store the resulting token).</>
                  : <>The installer forwards <code>VAULT_TOKEN</code> from its own environment. For an OIDC/Keycloak Vault, run <code>vault login -method=oidc</code>, then <code>export VAULT_TOKEN=$(vault print token)</code> before deploying.</>)}
                {config.vaultAuthMethod === "kubernetes" &&
                  <>Vault authenticates the pod&apos;s ServiceAccount token via Vault&apos;s <code>kubernetes</code> backend. <strong>Only works for in-cluster (OpenShift) deploys</strong> — a local podman container has no ServiceAccount token to present.</>}
                {config.vaultAuthMethod === "jwt" &&
                  <>Non-interactive login with a JWT file (e.g. a Keycloak-issued token). Requires a Vault <code>role_type=jwt</code> role on the JWT/OIDC backend. Works locally and in-cluster.</>}
                {config.vaultAuthMethod === "token_file" &&
                  <>Reads the client token from a file (e.g. a Vault Agent token sink).</>}
              </div>
            </div>

            {(config.vaultAuthMethod === "jwt" || config.vaultAuthMethod === "kubernetes") && (
              <div className="form-row">
                <div className="form-group">
                  <label>Auth Role</label>
                  <input
                    type="text"
                    placeholder="openclaw"
                    value={config.vaultAuthRole}
                    onChange={(e) => update("vaultAuthRole", e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label>Auth Mount (optional)</label>
                  <input
                    type="text"
                    placeholder={config.vaultAuthMethod}
                    value={config.vaultAuthMount}
                    onChange={(e) => update("vaultAuthMount", e.target.value)}
                  />
                  <div className="hint">
                    Vault auth path. Defaults to <code>{config.vaultAuthMethod}</code>; set it if your role lives on a
                    different mount (e.g. <code>oidc</code>).
                  </div>
                </div>
              </div>
            )}

            {config.vaultAuthMethod === "jwt" && (
              <div className="form-group">
                <label>JWT File Path</label>
                <input
                  type="text"
                  placeholder="/home/node/.config/openclaw/vault-jwt"
                  value={config.vaultJwtFile}
                  onChange={(e) => update("vaultJwtFile", e.target.value)}
                />
                <div className="hint">
                  Path, inside the OpenClaw container, to the JWT the plugin presents to Vault. The token is re-read on
                  each resolve, so keep it fresh (refresh job or Vault Agent).
                </div>
              </div>
            )}

            {config.vaultAuthMethod === "token_file" && (
              <div className="form-group">
                <label>Token File Path</label>
                <input
                  type="text"
                  placeholder="/vault/secrets/token"
                  value={config.vaultTokenFile}
                  onChange={(e) => update("vaultTokenFile", e.target.value)}
                />
              </div>
            )}

            {isClusterMode && config.vaultAuthMethod === "token" && (
              <div className="form-row">
                <div className="form-group">
                  <label>Token Secret Name</label>
                  <input
                    type="text"
                    placeholder="openclaw-vault-token"
                    value={config.vaultTokenSecretName}
                    onChange={(e) => update("vaultTokenSecretName", e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label>Token Secret Key</label>
                  <input
                    type="text"
                    placeholder="token"
                    value={config.vaultTokenSecretKey}
                    onChange={(e) => update("vaultTokenSecretKey", e.target.value)}
                  />
                </div>
              </div>
            )}

            {vaultRefs.length > 0 && (
              <div className="form-group">
                <label>Vault SecretRef IDs</label>
                <div className="hint">
                  Use <code>{"<secret path>/<field>"}</code>. For <code>vault kv get -mount=&quot;users&quot; &quot;team-name/anthropic&quot;</code>
                  with an <code>apiKey</code> field, use <code>team-name/anthropic/apiKey</code>.
                </div>
                {vaultRefs.map((entry) => (
                  <div className="form-group" key={entry.idField} style={{ marginTop: "0.75rem" }}>
                    <label>{entry.label}</label>
                    <input
                      type="text"
                      placeholder={entry.defaultId}
                      value={String(config[entry.idField] || "")}
                      onChange={(e) => updateVaultRefId(entry, e.target.value)}
                    />
                  </div>
                ))}
              </div>
            )}
          </>
        )}
        </details>

        <details open={config.onePasswordSecretsEnabled} style={nestedDetailsStyle}>
          <summary style={nestedSummaryStyle}>1Password</summary>
        <div className="form-group" style={{ marginTop: "0.75rem" }}>
          <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <input
              type="checkbox"
              checked={config.onePasswordSecretsEnabled}
              onChange={(e) => onOnePasswordEnabledChange(e.target.checked)}
              style={{ width: "auto" }}
            />
            Configure 1Password SecretRefs
          </label>
          <div className="hint">
            Creates the <code>onepassword</code> SecretRef provider backed by the <code>1password</code> plugin and
            points selected credential SecretRefs at ids such as <code>op://OpenClaw/OpenRouter/credential</code>. {isClusterMode
              ? "The 1Password service account token must already exist as a Secret in the target namespace."
              : "For local deploys, the installer passes OP_SERVICE_ACCOUNT_TOKEN from its environment when present."}{" "}
            Use an OpenClaw image that includes the bundled <code>1password</code> plugin, or install
            <code> @openclaw/1password</code> before deploying.
          </div>
        </div>

        {config.onePasswordSecretsEnabled && (
          <>
            <div className="form-row">
              <div className="form-group">
                <label>1Password Vault</label>
                <input
                  type="text"
                  placeholder="OpenClaw"
                  value={config.onePasswordVault}
                  onChange={(e) => update("onePasswordVault", e.target.value)}
                />
                <div className="hint">
                  Used for generated <code>op://</code> SecretRef ids. Your 1Password items should be named
                  <code> Anthropic</code>, <code> OpenAI</code>, <code> Google</code>, <code> OpenRouter</code>, or
                  <code> Endpoint</code> with a <code>credential</code> field.
                </div>
              </div>
            </div>

            {isClusterMode && (
              <>
                <div className="form-row">
                  <div className="form-group">
                    <label>Token Secret Name</label>
                    <input
                      type="text"
                      placeholder="openclaw-1password-token"
                      value={config.onePasswordTokenSecretName}
                      onChange={(e) => update("onePasswordTokenSecretName", e.target.value)}
                    />
                  </div>
                  <div className="form-group">
                    <label>Token Secret Key</label>
                    <input
                      type="text"
                      placeholder="OP_SERVICE_ACCOUNT_TOKEN"
                      value={config.onePasswordTokenSecretKey}
                      onChange={(e) => update("onePasswordTokenSecretKey", e.target.value)}
                    />
                  </div>
                </div>
                <div className="hint" style={{ marginTop: "0.75rem" }}>
                  Create the 1Password token Secret in the target namespace:
                </div>
                <pre style={{ whiteSpace: "pre-wrap", fontSize: "0.78rem", marginTop: "0.35rem" }}>
{`oc create secret generic ${config.onePasswordTokenSecretName.trim() || "openclaw-1password-token"} \\
  -n ${namespace} \\
  --from-literal=${config.onePasswordTokenSecretKey.trim() || "OP_SERVICE_ACCOUNT_TOKEN"}=ops_...`}
                </pre>
              </>
            )}

            {onePasswordRefs.length > 0 && (
              <div className="form-group">
                <label>Generated 1Password SecretRefs</label>
                <div className="hint">
                  The installer will configure selected providers to resolve credentials from these 1Password ids.
                </div>
                <ul style={{ margin: "0.5rem 0 0", paddingLeft: "1.25rem", color: "var(--text-secondary)" }}>
                  {onePasswordRefs.map((entry) => (
                    <li key={entry.id}>
                      {entry.label}: <code>{entry.id}</code>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
        </details>

        <details style={nestedDetailsStyle}>
          <summary style={nestedSummaryStyle}>Additional Secret Providers JSON (advanced)</summary>
        <div className="form-group" style={{ marginTop: "0.75rem" }}>
          <textarea
            rows={6}
            placeholder={`{\n  "default": { "source": "env" },\n  "custom": {\n    "source": "file",\n    "baseDir": "/var/run/secrets/openclaw"\n  }\n}`}
            value={config.secretsProvidersJson}
            onChange={(e) => update("secretsProvidersJson", e.target.value)}
          />
          <div className="hint">
            Do not define <code>vault</code> or <code>onepassword</code> here when managed SecretRef wiring is enabled;
            the installer generates those providers.
          </div>
        </div>
        </details>
      </div>
    </details>
  );
}
