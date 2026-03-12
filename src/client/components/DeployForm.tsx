import React, { useEffect, useState } from "react";

type Mode = "local" | "kubernetes" | "ssh";
type InferenceProvider = "anthropic" | "openai" | "vertex-anthropic" | "vertex-google" | "custom-endpoint";

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

interface GcpDefaults {
  projectId: string | null;
  location: string | null;
  hasServiceAccountJson: boolean;
  credentialType: string | null;
  sources: {
    projectId?: string;
    location?: string;
    credentials?: string;
  };
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

const PROVIDER_OPTIONS: Array<{ id: InferenceProvider; label: string; desc: string }> = [
  { id: "anthropic", label: "Anthropic (Direct API)", desc: "Claude models via Anthropic API" },
  { id: "openai", label: "OpenAI", desc: "GPT models via OpenAI API" },
  { id: "vertex-anthropic", label: "Google Vertex AI (Claude)", desc: "Claude models via Google Cloud" },
  { id: "vertex-google", label: "Google Vertex AI (Gemini)", desc: "Gemini models via Google Cloud" },
  { id: "custom-endpoint", label: "Custom Endpoint", desc: "OpenAI-compatible self-hosted model server" },
];

const MODEL_DEFAULTS: Record<InferenceProvider, string> = {
  "anthropic": "claude-sonnet-4-6",
  "openai": "openai/gpt-5",
  "vertex-anthropic": "anthropic-vertex/claude-sonnet-4-6",
  "vertex-google": "google-vertex/gemini-2.5-pro",
  "custom-endpoint": "",
};

const MODEL_HINTS: Record<InferenceProvider, string> = {
  "anthropic": "Examples: claude-sonnet-4-6, claude-opus-4-6, claude-haiku-4-5",
  "openai": "Examples: openai/gpt-5, openai/gpt-5.3",
  "vertex-anthropic": "Examples: anthropic-vertex/claude-sonnet-4-6, anthropic-vertex/claude-opus-4-6",
  "vertex-google": "Examples: google-vertex/gemini-2.5-pro, google-vertex/gemini-2.5-flash",
  "custom-endpoint": "Specify the model ID served by your endpoint",
};

export default function DeployForm({ onDeployStarted }: Props) {
  const [mode, setMode] = useState<Mode>("local");
  const [deploying, setDeploying] = useState(false);
  const [defaults, setDefaults] = useState<ServerDefaults | null>(null);
  const [savedConfigs, setSavedConfigs] = useState<SavedConfig[]>([]);
  const [inferenceProvider, setInferenceProvider] = useState<InferenceProvider>("anthropic");
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
    // Vertex AI / GCP
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

  const [gcpDefaults, setGcpDefaults] = useState<GcpDefaults | null>(null);
  const [gcpDefaultsFetched, setGcpDefaultsFetched] = useState(false);

  const isVertex = inferenceProvider === "vertex-anthropic" || inferenceProvider === "vertex-google";

  // Fetch GCP defaults when a Vertex provider is first selected
  useEffect(() => {
    if (!isVertex || gcpDefaultsFetched) return;
    setGcpDefaultsFetched(true);
    fetch("/api/configs/gcp-defaults")
      .then((r) => r.json())
      .then((data: GcpDefaults) => {
        setGcpDefaults(data);
        setConfig((prev) => ({
          ...prev,
          googleCloudProject: prev.googleCloudProject || data.projectId || "",
          googleCloudLocation: prev.googleCloudLocation || data.location || "",
        }));
      })
      .catch(() => {});
  }, [isVertex, gcpDefaultsFetched]);

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
          setInferenceProvider("custom-endpoint");
        } else if (d.hasOpenaiKey && !d.hasAnthropicKey) {
          setInferenceProvider("openai");
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
    // Map legacy VERTEX_ENABLED / VERTEX_PROVIDER to inferenceProvider
    if (vars.VERTEX_ENABLED === "true") {
      const vp = vars.VERTEX_PROVIDER || "anthropic";
      setInferenceProvider(vp === "google" ? "vertex-google" : "vertex-anthropic");
    } else if (vars.MODEL_ENDPOINT) {
      setInferenceProvider("custom-endpoint");
    }

    setConfig((prev) => ({
      ...prev,
      prefix: vars.OPENCLAW_PREFIX || prev.prefix,
      agentName: vars.OPENCLAW_AGENT_NAME || prev.agentName,
      agentDisplayName: vars.OPENCLAW_DISPLAY_NAME || prev.agentDisplayName,
      image: vars.OPENCLAW_IMAGE || prev.image,
      port: vars.OPENCLAW_PORT || prev.port,
      agentModel: vars.AGENT_MODEL || prev.agentModel,
      modelEndpoint: vars.MODEL_ENDPOINT || prev.modelEndpoint,
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
      const vertexEnabled = isVertex;
      const vertexProvider = inferenceProvider === "vertex-google" ? "google" : "anthropic";

      const body = {
        mode,
        prefix: config.prefix,
        agentName: config.agentName,
        agentDisplayName: config.agentDisplayName || config.agentName,
        image: config.image || undefined,
        anthropicApiKey: inferenceProvider === "anthropic" ? config.anthropicApiKey || undefined : undefined,
        openaiApiKey: inferenceProvider === "openai" ? config.openaiApiKey || undefined : undefined,
        agentModel: config.agentModel || undefined,
        modelEndpoint: inferenceProvider === "custom-endpoint" ? config.modelEndpoint || undefined : undefined,
        port: parseInt(config.port, 10) || 18789,
        vertexEnabled: vertexEnabled || undefined,
        vertexProvider: vertexEnabled ? vertexProvider : undefined,
        googleCloudProject: vertexEnabled ? config.googleCloudProject : undefined,
        googleCloudLocation: vertexEnabled ? config.googleCloudLocation : undefined,
        gcpServiceAccountJson: vertexEnabled ? config.gcpServiceAccountJson || undefined : undefined,
        gcpServiceAccountPath: vertexEnabled ? config.gcpServiceAccountPath || undefined : undefined,
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

        <h3 style={{ marginTop: "1.5rem" }}>Inference Provider</h3>

        <div className="form-group">
          <label>Provider</label>
          <select
            value={inferenceProvider}
            onChange={(e) => setInferenceProvider(e.target.value as InferenceProvider)}
          >
            {PROVIDER_OPTIONS.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
          <div className="hint">
            {PROVIDER_OPTIONS.find((p) => p.id === inferenceProvider)?.desc}
          </div>
        </div>

        {inferenceProvider === "anthropic" && (
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
                : "Your Anthropic API key"}
            </div>
          </div>
        )}

        {inferenceProvider === "openai" && (
          <div className="form-group">
            <label>OpenAI API Key</label>
            <input
              type="password"
              autoComplete="new-password"
              placeholder={defaults?.hasOpenaiKey ? "(using key from environment)" : "sk-..."}
              value={config.openaiApiKey}
              onChange={(e) => update("openaiApiKey", e.target.value)}
            />
            <div className="hint">
              {defaults?.hasOpenaiKey
                ? "Detected OPENAI_API_KEY from server environment — leave blank to use it"
                : "Your OpenAI API key"}
            </div>
          </div>
        )}

        {isVertex && (
          <>
            {inferenceProvider === "vertex-google"
              && gcpDefaults?.credentialType === "authorized_user"
              && !config.gcpServiceAccountJson && (
              <div style={{
                marginBottom: "1rem",
                padding: "0.5rem 0.75rem",
                background: "rgba(231, 76, 60, 0.1)",
                border: "1px solid rgba(231, 76, 60, 0.3)",
                borderRadius: "6px",
                fontSize: "0.85rem",
                color: "#e74c3c",
              }}>
                Your environment credentials are Application Default Credentials (from <code>gcloud auth</code>),
                which are not supported by Gemini on Vertex. Either upload a Service Account JSON below,
                or switch to Google Vertex AI (Claude) which works with Application Default Credentials.
              </div>
            )}

            <div className="form-row">
              <div className="form-group">
                <label>GCP Project ID</label>
                <input
                  type="text"
                  placeholder="my-gcp-project"
                  value={config.googleCloudProject}
                  onChange={(e) => update("googleCloudProject", e.target.value)}
                />
                {gcpDefaults?.sources.projectId && config.googleCloudProject === gcpDefaults.projectId ? (
                  <div className="hint">from {gcpDefaults.sources.projectId}</div>
                ) : !config.googleCloudProject && (
                  <div className="hint">Auto-extracted from credentials JSON if not set</div>
                )}
              </div>
              <div className="form-group">
                <label>GCP Region</label>
                <input
                  type="text"
                  placeholder={inferenceProvider === "vertex-anthropic" ? "us-east5 (default)" : "us-central1 (default)"}
                  value={config.googleCloudLocation}
                  onChange={(e) => update("googleCloudLocation", e.target.value)}
                />
                {gcpDefaults?.sources.location && config.googleCloudLocation === gcpDefaults.location ? (
                  <div className="hint">from {gcpDefaults.sources.location}</div>
                ) : !config.googleCloudLocation && (
                  <div className="hint">
                    Defaults to {inferenceProvider === "vertex-anthropic" ? "us-east5" : "us-central1"} if not set
                  </div>
                )}
              </div>
            </div>

            <div className="form-group">
              <label>Google Cloud Credentials (JSON)</label>
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
                  <input
                    type="text"
                    placeholder={
                      gcpDefaults?.hasServiceAccountJson
                        ? `Using credentials from ${gcpDefaults.sources.credentials}`
                        : "/path/to/service-account.json"
                    }
                    value={config.gcpServiceAccountPath}
                    onChange={(e) => update("gcpServiceAccountPath", e.target.value)}
                    style={{ flex: 1 }}
                  />
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
                        update("gcpServiceAccountPath", "");
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
                Type a path to a credentials JSON file, or use Browse to upload one.
                {gcpDefaults?.hasServiceAccountJson && !config.gcpServiceAccountJson && !config.gcpServiceAccountPath
                  && " Leave blank to use credentials detected from environment."}
              </div>
            </div>
          </>
        )}

        {inferenceProvider === "custom-endpoint" && (
          <div className="form-group">
            <label>Model Endpoint</label>
            <input
              type="text"
              placeholder="http://vllm.openclaw-llms.svc.cluster.local/v1"
              value={config.modelEndpoint}
              onChange={(e) => update("modelEndpoint", e.target.value)}
            />
            <div className="hint">
              OpenAI-compatible endpoint URL for your self-hosted model server
            </div>
          </div>
        )}

        <div className="form-group">
          <label>Model</label>
          <input
            type="text"
            placeholder={MODEL_DEFAULTS[inferenceProvider] || "model-id"}
            value={config.agentModel}
            onChange={(e) => update("agentModel", e.target.value)}
          />
          <div className="hint">
            {config.agentModel
              ? "Custom model override"
              : `Leave blank for default${MODEL_DEFAULTS[inferenceProvider] ? ` (${MODEL_DEFAULTS[inferenceProvider]})` : ""}. ${MODEL_HINTS[inferenceProvider]}`}
          </div>
        </div>

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
