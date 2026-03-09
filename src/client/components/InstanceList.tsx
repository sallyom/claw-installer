import React, { useEffect, useState } from "react";

interface PodInfo {
  name: string;
  phase: string;
  ready: boolean;
  restarts: number;
  containerStatus: string;
  message: string;
}

interface Instance {
  id: string;
  mode: string;
  status: string;
  config: {
    prefix: string;
    agentName: string;
    agentDisplayName: string;
  };
  startedAt: string;
  url?: string;
  containerId?: string;
  error?: string;
  statusDetail?: string;
  pods?: PodInfo[];
}

type ExpandedPanel = "token" | "command" | "logs" | null;

function StatusBadge({ inst, isActing }: { inst: Instance; isActing: boolean }) {
  const badgeColor: Record<string, string> = {
    running: "",
    stopped: "",
    deploying: "#f39c12",
    error: "#e74c3c",
    unknown: "",
  };
  const style = badgeColor[inst.status]
    ? { marginLeft: "0.5rem", background: badgeColor[inst.status], color: "#fff" }
    : { marginLeft: "0.5rem" };

  let label = inst.status;
  if (isActing) label = "...";
  else if (inst.status === "deploying") label = "deploying";
  else if (inst.status === "error") label = "error";

  return (
    <span className={`badge badge-${inst.status}`} style={style}>
      {label}
    </span>
  );
}

function K8sProgress({ inst }: { inst: Instance }) {
  if (inst.mode !== "kubernetes") return null;
  if (!inst.statusDetail && (!inst.pods || inst.pods.length === 0)) return null;
  if (inst.status === "running") return null;

  const pod = inst.pods?.[0];

  return (
    <div
      style={{
        padding: "0.5rem 1rem",
        fontSize: "0.8rem",
        color: inst.status === "error" ? "#e74c3c" : "var(--text-secondary)",
        borderTop: "1px solid var(--border)",
        fontFamily: "var(--font-mono)",
      }}
    >
      <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
        {inst.statusDetail && <span>{inst.statusDetail}</span>}
        {pod && pod.restarts > 0 && (
          <span style={{ color: "#e74c3c" }}>
            Restarts: {pod.restarts}
          </span>
        )}
      </div>
      {pod?.message && (
        <div style={{ marginTop: "0.25rem", opacity: 0.8, wordBreak: "break-word" }}>
          {pod.message}
        </div>
      )}
    </div>
  );
}

export default function InstanceList() {
  const [instances, setInstances] = useState<Instance[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, ExpandedPanel>>({});
  const [panelData, setPanelData] = useState<Record<string, string>>({});

  const fetchInstances = async () => {
    try {
      const res = await fetch("/api/instances");
      const data = await res.json();
      setInstances(data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchInstances();
    const interval = setInterval(fetchInstances, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleStart = async (id: string) => {
    setActing(id);
    await fetch(`/api/instances/${id}/start`, { method: "POST" });
    await fetchInstances();
    setActing(null);
  };

  const handleStop = async (id: string) => {
    setActing(id);
    await fetch(`/api/instances/${id}/stop`, { method: "POST" });
    setExpanded((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    await fetchInstances();
    setActing(null);
  };

  const handleDeleteData = async (id: string, mode?: string) => {
    if (
      !confirm(
        mode === "kubernetes"
          ? "Delete namespace and all data? This removes the PVC, secrets, deployment, and namespace. Cannot be undone."
          : "Delete all data? This removes the data volume (config, sessions, workspaces). Cannot be undone.",
      )
    )
      return;
    setActing(id);
    await fetch(`/api/instances/${id}`, { method: "DELETE" });
    await fetchInstances();
    setActing(null);
  };

  const togglePanel = async (id: string, panel: ExpandedPanel) => {
    if (expanded[id] === panel) {
      setExpanded((prev) => ({ ...prev, [id]: null }));
      return;
    }

    const endpoint = panel === "token" ? "token" : panel === "logs" ? "logs" : "command";
    try {
      const res = await fetch(`/api/instances/${id}/${endpoint}`);
      const data = await res.json();
      const value = panel === "token" ? data.token : panel === "logs" ? data.logs : data.command;
      if (value) {
        setPanelData((prev) => ({ ...prev, [`${id}-${panel}`]: value }));
        setExpanded((prev) => ({ ...prev, [id]: panel }));
      }
    } catch {
      // ignore
    }
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  if (loading) {
    return <div className="card">Loading...</div>;
  }

  if (instances.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-icon">📦</div>
        <p>No OpenClaw instances found</p>
        <p style={{ fontSize: "0.85rem" }}>
          Deploy from the Deploy tab, or start a container manually — any
          container running an OpenClaw image will appear here automatically.
        </p>
      </div>
    );
  }

  return (
    <div className="card" style={{ padding: 0 }}>
      {instances.map((inst) => {
        const isActing = acting === inst.id;
        const activePanel = expanded[inst.id];
        const panelContent = panelData[`${inst.id}-${activePanel}`];
        const isRunning = inst.status === "running";
        const isStopped = inst.status === "stopped";
        const isDeploying = inst.status === "deploying";
        const isError = inst.status === "error";
        const canStop = isRunning || isDeploying || isError;
        const canDelete = !isRunning && !isDeploying;

        return (
          <div key={inst.id} style={{ borderBottom: "1px solid var(--border)" }}>
            <div className="instance-row">
              <div className="instance-info">
                <div className="instance-name">
                  {inst.containerId || inst.id}
                  <StatusBadge inst={inst} isActing={isActing} />
                  {inst.mode === "kubernetes" && (
                    <span
                      className="badge"
                      style={{ marginLeft: "0.25rem", background: "var(--accent)", color: "#fff", fontSize: "0.65rem" }}
                    >
                      K8s
                    </span>
                  )}
                </div>
                <div className="instance-meta">
                  {inst.config.prefix && `${inst.config.prefix} · `}
                  {inst.config.agentName && `${inst.config.agentName} · `}
                  {isRunning && inst.url ? (
                    <a
                      href={inst.url}
                      target="_blank"
                      rel="noopener"
                      style={{ color: "var(--accent)" }}
                    >
                      {inst.url}
                    </a>
                  ) : isDeploying ? (
                    "deploying..."
                  ) : isError ? (
                    <span style={{ color: "#e74c3c" }}>
                      deployment error — check pod status
                    </span>
                  ) : (
                    "stopped — data volume preserved"
                  )}
                </div>
              </div>
              <div className="instance-actions">
                {isRunning && (
                  <>
                    <button
                      className="btn btn-ghost"
                      onClick={() => togglePanel(inst.id, "token")}
                    >
                      {activePanel === "token" ? "Hide" : "Token"}
                    </button>
                    <button
                      className="btn btn-ghost"
                      onClick={() => togglePanel(inst.id, "command")}
                    >
                      {activePanel === "command" ? "Hide" : "Command"}
                    </button>
                    <button
                      className="btn btn-ghost"
                      onClick={() => togglePanel(inst.id, "logs")}
                    >
                      {activePanel === "logs" ? "Hide" : "Logs"}
                    </button>
                  </>
                )}
                {isStopped && (
                  <button
                    className="btn btn-primary"
                    disabled={isActing}
                    onClick={() => handleStart(inst.id)}
                  >
                    Start
                  </button>
                )}
                {canStop && (
                  <button
                    className="btn btn-ghost"
                    disabled={isActing}
                    onClick={() => handleStop(inst.id)}
                  >
                    Stop
                  </button>
                )}
                <button
                  className="btn btn-danger"
                  disabled={isActing || !canDelete}
                  onClick={() => handleDeleteData(inst.id, inst.mode)}
                  title={
                    !canDelete
                      ? "Stop the instance first"
                      : inst.mode === "kubernetes"
                        ? "Delete namespace and all data"
                        : "Delete data volume (config, sessions, workspaces)"
                  }
                >
                  Delete Data
                </button>
              </div>
            </div>
            <K8sProgress inst={inst} />
            {activePanel && panelContent && (
              <div
                style={{
                  padding: "0 1rem 1rem",
                  display: "flex",
                  alignItems: "flex-start",
                  gap: "0.5rem",
                }}
              >
                <code
                  style={{
                    flex: 1,
                    padding: "0.5rem 0.75rem",
                    background: "var(--bg-primary)",
                    border: "1px solid var(--border)",
                    borderRadius: "var(--radius-sm)",
                    fontFamily: "var(--font-mono)",
                    fontSize: "0.8rem",
                    color: "var(--text-secondary)",
                    wordBreak: "break-all",
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {panelContent}
                </code>
                <button
                  className="btn btn-ghost"
                  onClick={() => handleCopy(panelContent)}
                >
                  Copy
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
