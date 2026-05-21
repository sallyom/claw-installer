import React from "react";
import type { DeployFormConfig } from "./types.js";

interface ExternalSecretProvidersSectionProps {
  config: DeployFormConfig;
  isClusterMode: boolean;
  update: (field: string, value: string) => void;
  onVaultEnabledChange: (enabled: boolean) => void;
}

export function ExternalSecretProvidersSection({
  config,
  isClusterMode,
  update,
  onVaultEnabledChange,
}: ExternalSecretProvidersSectionProps) {
  return (
    <details style={{ marginTop: "1rem" }}>
      <summary style={{ cursor: "pointer", fontWeight: 600 }}>External Secret Providers</summary>
      <div className="card" style={{ marginTop: "0.75rem" }}>
        <div className="hint" style={{ marginBottom: "0.75rem" }}>
          Configure OpenClaw to resolve credentials through a bundled plugin instead of writing provider API keys into
          the installer-managed Secret.
        </div>

        <div className="form-group">
          <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <input
              type="checkbox"
              checked={config.vaultSecretsEnabled}
              disabled={!isClusterMode}
              onChange={(e) => onVaultEnabledChange(e.target.checked)}
              style={{ width: "auto" }}
            />
            Use bundled HashiCorp Vault plugin
          </label>
          <div className="hint">
            Creates the <code>vault</code> SecretRef provider and points selected credential SecretRefs at Vault paths
            such as <code>providers/openai/apiKey</code>. The Vault token must already exist as a Secret in the target
            namespace.
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
                  placeholder="VAULT_TOKEN"
                  value={config.vaultTokenSecretKey}
                  onChange={(e) => update("vaultTokenSecretKey", e.target.value)}
                />
              </div>
            </div>
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
            Do not define <code>vault</code> here when the bundled Vault plugin is enabled; the installer generates it.
          </div>
        </div>
      </div>
    </details>
  );
}
