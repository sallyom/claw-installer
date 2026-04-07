import React from "react";
import type { DeployFormConfig, SecretRefValue } from "./types.js";

interface SecretRefsSectionProps {
  config: DeployFormConfig;
  update: (field: string, value: string) => void;
  mode: string;
  effectiveAnthropicApiKeyRef?: SecretRefValue;
  effectiveOpenaiApiKeyRef?: SecretRefValue;
  effectiveModelEndpointApiKeyRef?: SecretRefValue;
  anthropicApiKeyRefIsInferred?: boolean;
  openaiApiKeyRefIsInferred?: boolean;
  modelEndpointApiKeyRefIsInferred?: boolean;
}

function formatSecretRef(ref?: SecretRefValue): string {
  return ref ? `${ref.source}/${ref.provider}/${ref.id}` : "None";
}

export function SecretRefsSection({
  config,
  update,
  mode,
  effectiveAnthropicApiKeyRef,
  effectiveOpenaiApiKeyRef,
  effectiveModelEndpointApiKeyRef,
  anthropicApiKeyRefIsInferred = false,
  openaiApiKeyRefIsInferred = false,
  modelEndpointApiKeyRefIsInferred = false,
}: SecretRefsSectionProps) {
  const isLocal = mode === "local";
  const isCluster = mode === "kubernetes" || mode === "openshift";

  const anthropicHint = anthropicApiKeyRefIsInferred
    ? isLocal
      ? "Currently inferred from local Podman secret mappings or the local API key field."
      : isCluster
        ? "Currently inferred from the installer-managed openclaw-secrets Secret."
        : "Currently inferred from the deploy form."
    : "Optional override. Leave blank to use the installer-managed SecretRef automatically.";

  const openaiHint = openaiApiKeyRefIsInferred
    ? isLocal
      ? "Currently inferred from local Podman secret mappings or the local API key field."
      : isCluster
        ? "Currently inferred from the installer-managed openclaw-secrets Secret."
        : "Currently inferred from the deploy form."
    : "Optional override. Leave blank to use the installer-managed SecretRef automatically.";

  const modelEndpointHint = modelEndpointApiKeyRefIsInferred
    ? isLocal
      ? "Currently inferred from local Podman secret mappings or the local endpoint API key field."
      : isCluster
        ? "Currently inferred from the installer-managed openclaw-secrets Secret."
        : "Currently inferred from the deploy form."
    : "This endpoint API key SecretRef is inferred automatically when the model endpoint key is configured.";

  return (
    <details style={{ marginTop: "1.5rem" }}>
      <summary style={{ cursor: "pointer", fontWeight: 600 }}>Advanced: SecretRefs</summary>
      <div className="card" style={{ marginTop: "0.75rem" }}>
        <div className="hint" style={{ marginBottom: "0.75rem" }}>
          These control how generated OpenClaw config references provider credentials. The installer can infer the
          built-in Anthropic and OpenAI SecretRefs automatically from your local Podman secret mappings or the managed
          Kubernetes <code>openclaw-secrets</code> Secret. Override them here only when you need a different source,
          provider, or id.
        </div>

        <div className="card" style={{ marginBottom: "1rem" }}>
          <div className="hint" style={{ marginBottom: "0.75rem" }}>
            Effective Anthropic SecretRef: <code>{formatSecretRef(effectiveAnthropicApiKeyRef)}</code>
            {anthropicApiKeyRefIsInferred ? " (inferred)" : ""}
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Anthropic SecretRef Source</label>
              <select
                value={config.anthropicApiKeyRefSource}
                onChange={(e) => update("anthropicApiKeyRefSource", e.target.value)}
              >
                <option value="env">env</option>
                <option value="file">file</option>
                <option value="exec">exec</option>
              </select>
            </div>
            <div className="form-group">
              <label>Anthropic SecretRef Provider</label>
              <input
                type="text"
                placeholder="default"
                value={config.anthropicApiKeyRefProvider}
                onChange={(e) => update("anthropicApiKeyRefProvider", e.target.value)}
              />
            </div>
          </div>
          <div className="form-group">
            <label>Anthropic SecretRef ID</label>
            <input
              type="text"
              placeholder="ANTHROPIC_API_KEY or /providers/anthropic/apiKey or providers/anthropic/apiKey"
              value={config.anthropicApiKeyRefId}
              onChange={(e) => update("anthropicApiKeyRefId", e.target.value)}
            />
            <div className="hint">{anthropicHint}</div>
          </div>
        </div>

        <div className="card" style={{ marginBottom: "1rem" }}>
          <div className="hint" style={{ marginBottom: "0.75rem" }}>
            Effective OpenAI SecretRef: <code>{formatSecretRef(effectiveOpenaiApiKeyRef)}</code>
            {openaiApiKeyRefIsInferred ? " (inferred)" : ""}
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>OpenAI SecretRef Source</label>
              <select
                value={config.openaiApiKeyRefSource}
                onChange={(e) => update("openaiApiKeyRefSource", e.target.value)}
              >
                <option value="env">env</option>
                <option value="file">file</option>
                <option value="exec">exec</option>
              </select>
            </div>
            <div className="form-group">
              <label>OpenAI SecretRef Provider</label>
              <input
                type="text"
                placeholder="default"
                value={config.openaiApiKeyRefProvider}
                onChange={(e) => update("openaiApiKeyRefProvider", e.target.value)}
              />
            </div>
          </div>
          <div className="form-group">
            <label>OpenAI SecretRef ID</label>
            <input
              type="text"
              placeholder="OPENAI_API_KEY or /providers/openai/apiKey or providers/openai/apiKey"
              value={config.openaiApiKeyRefId}
              onChange={(e) => update("openaiApiKeyRefId", e.target.value)}
            />
            <div className="hint">{openaiHint}</div>
          </div>
        </div>

        <div className="card" style={{ marginBottom: "1rem" }}>
          <div className="hint" style={{ marginBottom: "0.75rem" }}>
            Effective Model Endpoint API Key SecretRef: <code>{formatSecretRef(effectiveModelEndpointApiKeyRef)}</code>
            {modelEndpointApiKeyRefIsInferred ? " (inferred)" : ""}
          </div>
          <div className="hint">
            {modelEndpointHint}
          </div>
        </div>

        <div className="hint">
          The installer currently auto-manages SecretRefs for the built-in model provider credentials. Arbitrary new
          SecretRefs are not exposed here yet unless there is a deploy form field that consumes them.
        </div>
      </div>
    </details>
  );
}
