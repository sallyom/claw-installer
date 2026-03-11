import React, { useEffect, useState } from "react";

type Mode = "local" | "kubernetes" | "ssh";

interface Props {
  onDeployStarted: (deployId: string) => void;
}

interface ServerDefaults {
  hasAnthropicKey: boolean;
  hasOpenaiKey: boolean;
  hasTelegramToken: boolean;
  telegramAllowFrom: string;
  modelEndpoint: string;
  prefix: string;
  image: string;
  k8sAvailable?: boolean;
  k8sContext?: string;
  isOpenShift?: boolean;
}

interface SavedConfig {
  name: string;
  vars: Record<string, string>;
}

const MODES: Array<{ id: Mode; icon: string; title: string; desc: string; disabled?: boolean }> = [
  {
    id: "local" as const,
    icon: "💻",
    title: "This Machine",
    desc: "Run OpenClaw locally with podman/docker",
  },
  {
    id: "kubernetes" as const,
    icon: "☸️",
    title: "Kubernetes / OpenShift",
    desc: "Deploy to a K8s or OpenShift cluster",
  },
  {
    id: "ssh" as const,
    icon: "🖥️",
    title: "🚧 Remote Host",
    desc: "Deploy via SSH to a Linux machine (coming soon)",
    disabled: true,
  },
];

export default function DeployForm({ onDeployStarted }: Props) {
  const [mode, setMode] = useState<Mode>("local");
  const [deploying, setDeploying] = useState(false);
  const [defaults, setDefaults] = useState<ServerDefaults | null>(null);
  const [savedConfigs, setSavedConfigs] = useState<SavedConfig[]>([]);
  const [config, setConfig] = useState({
    prefix: "",
    agentName: "",
    agentDisplayName: "",
    image: "",
    anthropicApiKey: "",
    openaiApiKey: "",
    agentModel: "",
    modelEndpoint: "",
    port: "18789",
    // Vertex AI
    vertexEnabled: false,
    vertexProvider: "google" as "google" | "anthropic",
    googleCloudProject: "",
    googleCloudLocation: "",
    gcpServiceAccountJson: "",
    gcpServiceAccountPath: "",
    // SSH fields
    sshHost: "",
    sshUser: "",
    // Agent provisioning
    agentSourceDir: "",
    // Telegram
    telegramEnabled: false,
    telegramBotToken: "",
    telegramAllowFrom: "",
    // Kubernetes
    namespace: "",
  });

  // Fetch server defaults (detected env vars + K8s availability)
  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((data) => {
        const d = {
          ...(data.defaults || {}),
          k8sAvailable: data.k8sAvailable,
          k8sContext: data.k8sContext,
          isOpenShift: data.isOpenShift,
        };
        setDefaults(d);
        if (d.prefix) {
          setConfig((prev) => ({ ...prev, prefix: d.prefix }));
        }
        if (d.modelEndpoint) {
          setConfig((prev) => ({ ...prev, modelEndpoint: d.modelEndpoint }));
        }
        if (d.image) {
          setConfig((prev) => ({ ...prev, image: d.image }));
        }
      })
      .catch(() => {});

    // Load saved configs from ~/.openclaw-installer/
    fetch("/api/configs")
      .then((r) => r.json())
      .then((configs: SavedConfig[]) => {
        setSavedConfigs(configs);
        if (configs.length > 0) {
          applyVars(configs[0].vars);
        }
      })
      .catch(() => {});
  }, []);

  const applyVars = (vars: Record<string, string>) => {
    setConfig((prev) => ({
      ...prev,
      prefix: vars.OPENCLAW_PREFIX || prev.prefix,
      agentName: vars.OPENCLAW_AGENT_NAME || prev.agentName,
      agentDisplayName: vars.OPENCLAW_DISPLAY_NAME || prev.agentDisplayName,
      image: vars.OPENCLAW_IMAGE || prev.image,
      port: vars.OPENCLAW_PORT || prev.port,
      agentModel: vars.AGENT_MODEL || prev.agentModel,
      modelEndpoint: vars.MODEL_ENDPOINT || prev.modelEndpoint,
      vertexEnabled: vars.VERTEX_ENABLED === "true" || prev.vertexEnabled,
      vertexProvider: (vars.VERTEX_PROVIDER as "google" | "anthropic") || prev.vertexProvider,
      googleCloudProject: vars.GOOGLE_CLOUD_PROJECT || prev.googleCloudProject,
      googleCloudLocation: vars.GOOGLE_CLOUD_LOCATION || prev.googleCloudLocation,
      agentSourceDir: vars.AGENT_SOURCE_DIR || prev.agentSourceDir,
      telegramBotToken: vars.TELEGRAM_BOT_TOKEN || prev.telegramBotToken,
      telegramAllowFrom: vars.TELEGRAM_ALLOW_FROM || prev.telegramAllowFrom,
    }));
  };

  const [displayNameManuallyEdited, setDisplayNameManuallyEdited] = useState(false);

  const update = (field: string, value: string) => {
    if (field === "agentDisplayName") {
      setDisplayNameManuallyEdited(true);
    }
    if (field === "agentName" && !displayNameManuallyEdited) {
      // Auto-derive display name from agent name
      setConfig((prev) => ({
        ...prev,
        agentName: value,
        agentDisplayName:
          value.charAt(0).toUpperCase() + value.slice(1).replace(/-/g, " "),
      }));
    } else {
      setConfig((prev) => ({ ...prev, [field]: value }));
    }
  };

  const handleDeploy = async () => {
    setDeploying(true);
    try {
      const body = {
        mode,
        prefix: config.prefix,
        agentName: config.agentName,
        agentDisplayName: config.agentDisplayName || config.agentName,
        image: config.image || undefined,
        anthropicApiKey: config.anthropicApiKey || undefined,
        openaiApiKey: config.openaiApiKey || undefined,
        agentModel: config.agentModel || undefined,
        modelEndpoint: config.modelEndpoint || undefined,
        port: parseInt(config.port, 10) || 18789,
        vertexEnabled: config.vertexEnabled || undefined,
        vertexProvider: config.vertexEnabled ? config.vertexProvider : undefined,
        googleCloudProject: config.vertexEnabled ? config.googleCloudProject : undefined,
        googleCloudLocation: config.vertexEnabled ? config.googleCloudLocation : undefined,
        gcpServiceAccountJson: config.vertexEnabled ? config.gcpServiceAccountJson || undefined : undefined,
        gcpServiceAccountPath: config.vertexEnabled ? config.gcpServiceAccountPath || undefined : undefined,
        namespace: config.namespace || undefined,
        sshHost: config.sshHost || undefined,
        sshUser: config.sshUser || undefined,
        agentSourceDir: config.agentSourceDir || undefined,
        telegramEnabled: config.telegramEnabled || undefined,
        telegramBotToken: config.telegramEnabled ? config.telegramBotToken || undefined : undefined,
        telegramAllowFrom: config.telegramEnabled ? config.telegramAllowFrom || undefined : undefined,
      };

      const res = await fetch("/api/deploy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (data.deployId) {
        onDeployStarted(data.deployId);
      }
    } catch (err) {
      console.error("Deploy failed:", err);
    } finally {
      setDeploying(false);
    }
  };

  const handleEnvUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result as string;
      const vars: Record<string, string> = {};
      for (const line of text.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx < 0) continue;
        vars[trimmed.slice(0, eqIdx)] = trimmed.slice(eqIdx + 1);
      }
      applyVars(vars);
    };
    reader.readAsText(file);
    // Reset so the same file can be re-uploaded
    e.target.value = "";
  };

  const isValid = config.agentName
    && (mode !== "kubernetes" || defaults?.k8sAvailable);

  return (
    <div>
      {/* Mode selector */}
      <div className="mode-grid">
        {MODES.map((m) => {
          const isSelected = mode === m.id;
          return (
            <div
              key={m.id}
              className={`mode-card ${isSelected ? "selected" : ""} ${m.disabled ? "disabled" : ""}`}
              onClick={() => !m.disabled && setMode(m.id)}
              style={m.disabled ? { opacity: 0.5, cursor: "not-allowed" } : undefined}
            >
              <div className="mode-radio">
                <span className={`radio-dot ${isSelected ? "checked" : ""}`} />
              </div>
              <div className="mode-icon">{m.icon}</div>
              <div className="mode-title">{m.title}</div>
              <div className="mode-desc">{m.desc}</div>
              {isSelected && <div className="mode-selected-badge">Selected</div>}
            </div>
          );
        })}
      </div>

      {mode === "kubernetes" && (
        <div className="card" style={{ marginBottom: "1rem", padding: "0.75rem 1rem" }}>
          {defaults?.k8sAvailable ? (
            <div style={{ color: "var(--text-secondary)", fontSize: "0.85rem" }}>
              Connected to cluster: <strong>{defaults.k8sContext}</strong>
              {defaults.isOpenShift && <span style={{ marginLeft: "0.5rem", color: "var(--accent)" }}>(OpenShift — Route will be created)</span>}
            </div>
          ) : (
            <div style={{ color: "#e74c3c", fontSize: "0.85rem" }}>
              No Kubernetes cluster detected. Configure kubectl/oc and ensure you are logged in.
            </div>
          )}
        </div>
      )}

      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
          <h3 style={{ margin: 0 }}>Configuration</h3>
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
            {savedConfigs.length > 0 && (
              <select
                className="btn btn-ghost"
                style={{ cursor: "pointer" }}
                onChange={(e) => {
                  const cfg = savedConfigs.find((c) => c.name === e.target.value);
                  if (cfg) applyVars(cfg.vars);
                }}
                defaultValue=""
              >
                <option value="" disabled>Load saved config...</option>
                {savedConfigs.map((c) => (
                  <option key={c.name} value={c.name}>{c.name}</option>
                ))}
              </select>
            )}
            <label className="btn btn-ghost" style={{ cursor: "pointer", margin: 0 }}>
              Upload .env
              <input
                type="file"
                accept=".env,text/plain"
                onChange={handleEnvUpload}
                style={{ display: "none" }}
              />
            </label>
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label>Agent Name</label>
            <input
              type="text"
              placeholder="e.g., lynx"
              value={config.agentName}
              onChange={(e) => update("agentName", e.target.value)}
            />
            <div className="hint">Your agent's identity</div>
          </div>
          <div className="form-group">
            <label>Owner Prefix <span style={{ color: "var(--text-secondary)", fontWeight: "normal" }}>(optional)</span></label>
            <input
              type="text"
              placeholder={defaults?.prefix || "username"}
              value={config.prefix}
              onChange={(e) => update("prefix", e.target.value)}
            />
            <div className="hint">
              Defaults to your OS username ({defaults?.prefix || "..."}).
              Used in naming: {mode === "local"
                ? `openclaw-${config.prefix || defaults?.prefix || "user"}-${config.agentName || "agent"}`
                : `${config.prefix || defaults?.prefix || "user"}-${config.agentName || "agent"}-openclaw`}
            </div>
          </div>
        </div>

        <div className="form-group">
          <label>Display Name</label>
          <input
            type="text"
            placeholder="e.g., Lynx"
            value={config.agentDisplayName}
            onChange={(e) => update("agentDisplayName", e.target.value)}
          />
        </div>

        <div className="form-group">
          <label>Container Image</label>
          <input
            type="text"
            placeholder="quay.io/sallyom/openclaw:latest"
            value={config.image}
            onChange={(e) => update("image", e.target.value)}
          />
          <div className="hint">
            Leave blank for the default image (quay.io/sallyom/openclaw:latest).
            This image includes Anthropic Vertex AI support not yet available upstream.
          </div>
        </div>

        {mode === "kubernetes" && (
          <div className="form-group">
            <label>Namespace</label>
            <input
              type="text"
              autoComplete="off"
              placeholder={`${config.prefix || defaults?.prefix || "user"}-${config.agentName || "agent"}-openclaw`}
              value={config.namespace || ""}
              onChange={(e) => setConfig((prev) => ({ ...prev, namespace: e.target.value }))}
            />
            <div className="hint">
              Leave blank to auto-generate (e.g., <code>{config.prefix || defaults?.prefix || "user"}-{config.agentName || "agent"}-openclaw</code>)
            </div>
          </div>
        )}

        {mode === "local" && (
          <div className="form-group">
            <label>Agent Source Directory</label>
            <input
              type="text"
              placeholder="/path/to/agents-dir (optional)"
              value={config.agentSourceDir}
              onChange={(e) => update("agentSourceDir", e.target.value)}
            />
            <div className="hint">
              Host directory with <code>agents/</code> and <code>skills/</code> subdirs to provision into the workspace.
              Defaults to <code>~/.openclaw-installer/agents/</code> if it exists.
            </div>
          </div>
        )}

        {mode === "local" && (
          <div className="form-group">
            <label>Port</label>
            <input
              type="text"
              placeholder="18789"
              value={config.port}
              onChange={(e) => update("port", e.target.value)}
            />
            <div className="hint">Local port for the gateway UI</div>
          </div>
        )}

        {mode === "ssh" && (
          <div className="form-row">
            <div className="form-group">
              <label>SSH Host</label>
              <input
                type="text"
                placeholder="nuc.local or 192.168.1.100"
                value={config.sshHost}
                onChange={(e) => update("sshHost", e.target.value)}
              />
            </div>
            <div className="form-group">
              <label>SSH User</label>
              <input
                type="text"
                placeholder="e.g., core"
                value={config.sshUser}
                onChange={(e) => update("sshUser", e.target.value)}
              />
            </div>
          </div>
        )}

        <h3 style={{ marginTop: "1.5rem" }}>Model Provider</h3>

        <div className="form-group">
          <label>Anthropic API Key</label>
          <input
            type="password"
            autoComplete="new-password"
            placeholder={defaults?.hasAnthropicKey ? "(using key from environment)" : "sk-ant-..."}
            value={config.anthropicApiKey}
            onChange={(e) => update("anthropicApiKey", e.target.value)}
          />
          <div className="hint">
            {defaults?.hasAnthropicKey
              ? "Detected ANTHROPIC_API_KEY from server environment — leave blank to use it"
              : "Optional — without it, agents use Vertex AI or the model endpoint"}
          </div>
        </div>

        <div className="form-group">
          <label>OpenAI API Key</label>
          <input
            type="password"
            placeholder={defaults?.hasOpenaiKey ? "(using key from environment)" : "sk-..."}
            value={config.openaiApiKey}
            onChange={(e) => update("openaiApiKey", e.target.value)}
          />
          <div className="hint">
            {defaults?.hasOpenaiKey
              ? "Detected OPENAI_API_KEY from server environment — leave blank to use it"
              : "Optional — for GPT-5, and other OpenAI models"}
          </div>
        </div>

        <div className="form-group">
          <label>Model</label>
          <input
            type="text"
            placeholder={
              config.vertexEnabled
                ? config.vertexProvider === "anthropic"
                  ? "anthropic-vertex/claude-sonnet-4-6"
                  : "google-vertex/gemini-2.5-pro"
                : config.openaiApiKey
                  ? "openai/gpt-5"
                  : "claude-sonnet-4-6"
            }
            value={config.agentModel}
            onChange={(e) => update("agentModel", e.target.value)}
          />
          <div className="hint">
            Model ID for the agent (leave blank for auto-detect). Examples: claude-sonnet-4-6, claude-opus-4-6, openai/gpt-5, openai/gpt-5.3
          </div>
        </div>

        <div className="form-group">
          <label>Model Endpoint</label>
          <input
            type="text"
            placeholder="http://vllm.openclaw-llms.svc.cluster.local/v1"
            value={config.modelEndpoint}
            onChange={(e) => update("modelEndpoint", e.target.value)}
          />
          <div className="hint">
            OpenAI-compatible endpoint for self-hosted models (leave blank for Anthropic/OpenAI/Vertex)
          </div>
        </div>

        <div className="form-group">
          <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <input
              type="checkbox"
              checked={config.vertexEnabled}
              onChange={(e) =>
                setConfig((prev) => ({ ...prev, vertexEnabled: e.target.checked }))
              }
              style={{ width: "auto" }}
            />
            Enable Google Vertex AI
          </label>
          <div className="hint">
            Use Claude or Gemini via Google Cloud Vertex AI
          </div>
        </div>

        {config.vertexEnabled && (
          <>
            <div className="form-group">
              <label>Vertex Provider</label>
              <select
                value={config.vertexProvider}
                onChange={(e) =>
                  setConfig((prev) => ({
                    ...prev,
                    vertexProvider: e.target.value as "google" | "anthropic",
                  }))
                }
              >
                <option value="google">Google (Gemini)</option>
                <option value="anthropic">Anthropic (Claude via Vertex)</option>
              </select>
              <div className="hint">
                {config.vertexProvider === "google"
                  ? "Agents use google-vertex/gemini-2.5-pro"
                  : "Agents use anthropic-vertex/claude-sonnet-4-6"}
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>GCP Project ID</label>
                <input
                  type="text"
                  placeholder="my-gcp-project"
                  value={config.googleCloudProject}
                  onChange={(e) => update("googleCloudProject", e.target.value)}
                />
              </div>
              <div className="form-group">
                <label>GCP Region</label>
                <input
                  type="text"
                  placeholder={config.vertexProvider === "anthropic" ? "us-east5" : "us-central1"}
                  value={config.googleCloudLocation}
                  onChange={(e) => update("googleCloudLocation", e.target.value)}
                />
              </div>
            </div>

            <div className="form-group">
              <label>GCP Service Account JSON</label>
              <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                {config.gcpServiceAccountJson ? (
                  <div
                    style={{
                      flex: 1,
                      padding: "0.5rem 0.75rem",
                      background: "var(--bg-primary)",
                      border: "1px solid var(--border)",
                      borderRadius: "6px",
                      fontFamily: "monospace",
                      fontSize: "0.85rem",
                      color: "var(--text-secondary)",
                    }}
                  >
                    {(() => {
                      try {
                        const parsed = JSON.parse(config.gcpServiceAccountJson);
                        return `${parsed.client_email || "service account"} (${parsed.project_id || "unknown project"})`;
                      } catch {
                        return "credentials loaded";
                      }
                    })()}
                  </div>
                ) : (
                  <div
                    style={{
                      flex: 1,
                      padding: "0.5rem 0.75rem",
                      border: "1px dashed var(--border)",
                      borderRadius: "6px",
                      fontSize: "0.85rem",
                      color: "var(--text-secondary)",
                    }}
                  >
                    No credentials file selected
                  </div>
                )}
                <label
                  className="btn btn-ghost"
                  style={{ cursor: "pointer", whiteSpace: "nowrap" }}
                >
                  {config.gcpServiceAccountJson ? "Change" : "Browse"}
                  <input
                    type="file"
                    accept=".json"
                    style={{ display: "none" }}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const reader = new FileReader();
                      reader.onload = () => {
                        const text = reader.result as string;
                        update("gcpServiceAccountJson", text);
                        // Auto-fill project ID if empty
                        if (!config.googleCloudProject) {
                          try {
                            const parsed = JSON.parse(text);
                            if (parsed.project_id) {
                              update("googleCloudProject", parsed.project_id);
                            }
                          } catch { /* ignore */ }
                        }
                      };
                      reader.readAsText(file);
                    }}
                  />
                </label>
                {config.gcpServiceAccountJson && (
                  <button
                    className="btn btn-ghost"
                    onClick={() => update("gcpServiceAccountJson", "")}
                  >
                    Clear
                  </button>
                )}
              </div>
              <div className="hint">
                Upload a service account key file, or provide a path below.
                Project ID is auto-extracted if not set above.
              </div>
            </div>

            <div className="form-group">
              <label>Or: SA JSON file path (on installer host)</label>
              <input
                type="text"
                placeholder="/path/to/service-account.json"
                value={config.gcpServiceAccountPath}
                onChange={(e) => update("gcpServiceAccountPath", e.target.value)}
                disabled={!!config.gcpServiceAccountJson}
              />
              <div className="hint">
                Absolute path to the SA JSON file. The installer reads it at deploy time.
                Disabled when a file is uploaded above.
              </div>
            </div>
          </>
        )}

        <h3 style={{ marginTop: "1.5rem" }}>Channels</h3>

        <div className="form-group">
          <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <input
              type="checkbox"
              checked={config.telegramEnabled}
              onChange={(e) =>
                setConfig((prev) => ({ ...prev, telegramEnabled: e.target.checked }))
              }
              style={{ width: "auto" }}
            />
            Connect Telegram Bot
          </label>
          <div className="hint">
            {defaults?.hasTelegramToken
              ? "Telegram bot token detected from environment"
              : <>Create a bot via <a href="https://t.me/BotFather" target="_blank" rel="noreferrer">@BotFather</a> on Telegram</>}
          </div>
        </div>

        {config.telegramEnabled && (
          <>
            <div className="form-group">
              <label>Telegram Bot Token</label>
              <input
                type="password"
                placeholder={defaults?.hasTelegramToken ? "(using token from environment)" : "123456:ABC-DEF..."}
                value={config.telegramBotToken}
                onChange={(e) => update("telegramBotToken", e.target.value)}
              />
              <div className="hint">
                {defaults?.hasTelegramToken
                  ? "Leave blank to use token from environment"
                  : "Bot token from @BotFather"}
              </div>
            </div>

            <div className="form-group">
              <label>Allowed Telegram User IDs</label>
              <input
                type="password"
                placeholder={defaults?.telegramAllowFrom ? "(using IDs from environment)" : "123456789, 987654321"}
                value={config.telegramAllowFrom}
                onChange={(e) => update("telegramAllowFrom", e.target.value)}
              />
              <div className="hint">
                {defaults?.telegramAllowFrom
                  ? "Leave blank to use IDs from environment"
                  : <>Comma-separated user IDs. Find yours via <a href="https://t.me/userinfobot" target="_blank" rel="noreferrer">@userinfobot</a></>}
              </div>
            </div>
          </>
        )}

        <div style={{ marginTop: "1.5rem" }}>
          <button
            className="btn btn-primary"
            disabled={!isValid || deploying}
            onClick={handleDeploy}
          >
            {deploying ? "Deploying..." : "Deploy OpenClaw"}
          </button>
        </div>
      </div>
    </div>
  );
}
