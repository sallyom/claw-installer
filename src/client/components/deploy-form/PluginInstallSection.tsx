import React from "react";
import type { DeployFormConfig } from "./types.js";

interface PluginInstallSectionProps {
  config: DeployFormConfig;
  update: (field: string, value: string) => void;
}

export function PluginInstallSection({ config, update }: PluginInstallSectionProps) {
  const installsOpenShellPlugin = config.sandboxEnabled && config.sandboxBackend === "openshell";

  return (
    <details style={{ marginTop: "1rem" }}>
      <summary style={{ cursor: "pointer", fontWeight: 600 }}>Plugins</summary>
      <div className="card" style={{ marginTop: "0.75rem" }}>
        <div className="hint" style={{ marginBottom: "0.75rem" }}>
          Install OpenClaw plugins before the gateway starts.
        </div>

        <div className="form-group">
          <label>Plugins to Install (optional)</label>
          <textarea
            rows={4}
            placeholder={`@openclaw/openshell-sandbox\n/app/extensions/custom-plugin`}
            value={config.pluginInstallSpecsText}
            onChange={(e) => update("pluginInstallSpecsText", e.target.value)}
          />
          <div className="hint">
            One plugin spec per line. Use ClawHub/npm/git specs, or a path that will exist inside the OpenClaw
            container. For local Podman/Docker deploys, host paths are mounted automatically when they exist.
          </div>
          {installsOpenShellPlugin && (
            <div className="hint">
              OpenShell sandbox is enabled, so <code>@openclaw/openshell-sandbox</code> will be installed
              automatically.
            </div>
          )}
        </div>
      </div>
    </details>
  );
}
