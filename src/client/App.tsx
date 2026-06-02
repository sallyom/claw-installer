import React, { useState } from "react";
import DeployForm from "./components/DeployForm";
import InstanceList from "./components/InstanceList";
import LogStream from "./components/LogStream";
import PluginList from "./components/PluginList";

type Tab = "deploy" | "instances";
const SHOW_PLUGINS_TAB = false;

export default function App() {
  const [tab, setTab] = useState<Tab>("deploy");
  const [activeDeployId, setActiveDeployId] = useState<string | null>(null);
  const [instanceCount, setInstanceCount] = useState<number>(0);

  return (
    <div className="app">
      <div className="header">
        <h1>OpenClaw Installer</h1>
        <span className="version">v0.1.0</span>
      </div>

      <div className="tabs">
        <button
          className={`tab ${tab === "deploy" ? "active" : ""}`}
          onClick={() => setTab("deploy")}
        >
          Deploy
        </button>
        <button
          className={`tab ${tab === "instances" ? "active" : ""}`}
          onClick={() => setTab("instances")}
        >
          Instances
          {instanceCount > 0 && <span className="tab-badge">{instanceCount}</span>}
        </button>
        {SHOW_PLUGINS_TAB && (
          <button
            className={`tab ${tab === "plugins" ? "active" : ""}`}
            onClick={() => setTab("plugins" as Tab)}
          >
            Plugins
          </button>
        )}
      </div>

      <div style={{ display: tab === "deploy" ? "block" : "none" }}>
        <DeployForm
          onDeployStarted={(id) => {
            setActiveDeployId(id);
          }}
          instanceCount={instanceCount}
          onShowInstances={() => setTab("instances")}
        />
        {activeDeployId && (
          <LogStream deployId={activeDeployId} onDeploySuccess={() => setTab("instances")} />
        )}
      </div>

      <div style={{ display: tab === "instances" ? "block" : "none" }}>
        <InstanceList active={tab === "instances"} onCountChange={setInstanceCount} />
      </div>

      {SHOW_PLUGINS_TAB && (
        <div style={{ display: tab === "plugins" ? "block" : "none" }}>
          <PluginList />
        </div>
      )}
    </div>
  );
}
