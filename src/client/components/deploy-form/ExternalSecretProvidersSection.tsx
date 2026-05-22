import React from "react";
import type { DeployFormConfig, InferenceProvider } from "./types.js";

interface ExternalSecretProvidersSectionProps {
  config: DeployFormConfig;
  isClusterMode: boolean;
  selectedProviders: InferenceProvider[];
  update: (field: string, value: string) => void;
  onVaultEnabledChange: (enabled: boolean) => void;
}

const VAULT_PROVIDER_PATHS: Partial<Record<InferenceProvider, { label: string; path: string }>> = {
  anthropic: { label: "Anthropic API key", path: "providers/anthropic/apiKey" },
  openai: { label: "OpenAI API key", path: "providers/openai/apiKey" },
  google: { label: "Google API key", path: "providers/google/apiKey" },
  openrouter: { label: "OpenRouter API key", path: "providers/openrouter/apiKey" },
  "custom-endpoint": { label: "OpenAI-compatible endpoint API key", path: "providers/endpoint/apiKey" },
};

export function ExternalSecretProvidersSection({
  config,
  isClusterMode,
  selectedProviders,
  update,
  onVaultEnabledChange,
}: ExternalSecretProvidersSectionProps) {
  const vaultPaths = selectedProviders
    .map((provider) => VAULT_PROVIDER_PATHS[provider])
    .filter((entry): entry is { label: string; path: string } => Boolean(entry));

  return (
    <details style={{ marginTop: "1rem" }}>
      <summary style={{ cursor: "pointer", fontWeight: 600 }}>External Secret Providers</summary>
      <div className="card" style={{ marginTop: "0.75rem" }}>
        <div className="hint" style={{ marginBottom: "0.75rem" }}>
          Configure OpenClaw to resolve credentials through SecretRef providers instead of writing provider API keys
          into the installer-managed Secret.
        </div>

        <div className="form-group">
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
            Creates the <code>vault</code> SecretRef provider and points selected credential SecretRefs at Vault paths
            such as <code>providers/openai/apiKey</code>. {isClusterMode
              ? "The Vault token must already exist as a Secret in the target namespace."
              : "For local deploys, the installer passes VAULT_TOKEN from its environment when present; otherwise provide it with container run args."}{" "}
            Add the Vault plugin in the Plugins section unless it is already installed in OpenClaw's home volume.
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
                  placeholder="secret"
                  value={config.vaultKvMount}
                  onChange={(e) => update("vaultKvMount", e.target.value)}
                />
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

            {isClusterMode && (
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

            {vaultPaths.length > 0 && (
              <div className="form-group">
                <label>Generated Vault SecretRefs</label>
                <div className="hint">
                  The installer will configure selected providers to resolve credentials from these Vault ids.
                </div>
                <ul style={{ margin: "0.5rem 0 0", paddingLeft: "1.25rem", color: "var(--text-secondary)" }}>
                  {vaultPaths.map((entry) => (
                    <li key={entry.path}>
                      {entry.label}: <code>{entry.path}</code>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}

        <div className="form-group">
          <label>Additional Secret Providers JSON (optional)</label>
          <textarea
            rows={6}
            placeholder={`{\n  "default": { "source": "env" },\n  "custom": {\n    "source": "file",\n    "baseDir": "/var/run/secrets/openclaw"\n  }\n}`}
            value={config.secretsProvidersJson}
            onChange={(e) => update("secretsProvidersJson", e.target.value)}
          />
          <div className="hint">
            Do not define <code>vault</code> here when Vault SecretRef wiring is enabled; the installer generates it.
          </div>
        </div>
      </div>
    </details>
  );
}
