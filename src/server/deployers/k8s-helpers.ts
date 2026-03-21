import process from "node:process";
import { randomBytes } from "node:crypto";
import type { DeployConfig } from "./types.js";
import { shouldUseLitellmProxy, litellmModelName, LITELLM_PORT } from "./litellm.js";
import { shouldUseOtel, OTEL_HTTP_PORT } from "./otel.js";
import { buildSandboxConfig } from "./sandbox.js";
import { buildSandboxToolPolicy } from "./tool-policy.js";
import { loadAgentSourceBundle } from "./agent-source.js";

export const DEFAULT_IMAGE = process.env.OPENCLAW_IMAGE || "ghcr.io/openclaw/openclaw:latest";
export const DEFAULT_VERTEX_IMAGE = process.env.OPENCLAW_VERTEX_IMAGE || DEFAULT_IMAGE;

export function defaultImage(config: DeployConfig): string {
  if (config.image) return config.image;
  return config.vertexEnabled ? DEFAULT_VERTEX_IMAGE : DEFAULT_IMAGE;
}

export function tryParseProjectId(saJson: string): string {
  try {
    const parsed = JSON.parse(saJson);
    return typeof parsed.project_id === "string" ? parsed.project_id : "";
  } catch {
    return "";
  }
}

export function sanitizeForRfc1123(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");
}

export function namespaceName(config: DeployConfig): string {
  const prefix = config.prefix || "openclaw";
  const explicitNamespace = config.namespace?.trim().toLowerCase();
  if (explicitNamespace && explicitNamespace !== "default") return explicitNamespace;
  const sanitizedAgent = sanitizeForRfc1123(config.agentName) || "agent";
  const sanitizedPrefix = sanitizeForRfc1123(prefix);
  return `${sanitizedPrefix}-${sanitizedAgent}-openclaw`;
}

export function agentId(config: DeployConfig): string {
  const prefix = config.prefix || "openclaw";
  return `${prefix}_${config.agentName}`;
}

export function generateToken(): string {
  return randomBytes(32).toString("base64");
}

export function normalizeModelRef(config: DeployConfig, modelRef: string): string {
  const trimmed = modelRef.trim();
  if (!trimmed) return trimmed;
  if (trimmed.includes("/")) return trimmed;

  if (config.inferenceProvider === "anthropic") return `anthropic/${trimmed}`;
  if (config.inferenceProvider === "openai" || config.inferenceProvider === "custom-endpoint") {
    return `openai/${trimmed}`;
  }
  // Fix for #1: check litellm proxy before falling back to direct vertex providers
  if (config.inferenceProvider === "vertex-anthropic") {
    return shouldUseLitellmProxy(config) ? `litellm/${trimmed}` : `anthropic-vertex/${trimmed}`;
  }
  if (config.inferenceProvider === "vertex-google") {
    return shouldUseLitellmProxy(config) ? `litellm/${trimmed}` : `google-vertex/${trimmed}`;
  }
  if (config.vertexEnabled && shouldUseLitellmProxy(config)) return `litellm/${trimmed}`;
  if (config.vertexEnabled) {
    return `${config.vertexProvider === "anthropic" ? "anthropic-vertex" : "google-vertex"}/${trimmed}`;
  }
  if (config.openaiApiKey || config.modelEndpoint) return `openai/${trimmed}`;
  return `anthropic/${trimmed}`;
}

export function buildDefaultAgentModelCatalog(modelRef: string): Record<string, { alias: string }> {
  const alias = modelRef.split("/").pop() || modelRef;
  return {
    [modelRef]: { alias },
  };
}

export function deriveModel(config: DeployConfig): string {
  if (config.agentModel) return normalizeModelRef(config, config.agentModel);
  if (config.inferenceProvider === "anthropic") return "anthropic/claude-sonnet-4-6";
  if (config.inferenceProvider === "openai") return "openai/gpt-5.4";
  if (config.inferenceProvider === "custom-endpoint") return "openai/default";
  if (config.inferenceProvider === "vertex-anthropic") {
    return config.litellmProxy ? `litellm/${litellmModelName(config)}` : "anthropic-vertex/claude-sonnet-4-6";
  }
  if (config.inferenceProvider === "vertex-google") {
    return config.litellmProxy ? `litellm/${litellmModelName(config)}` : "google-vertex/gemini-2.5-pro";
  }
  if (config.vertexEnabled && shouldUseLitellmProxy(config)) {
    return `litellm/${litellmModelName(config)}`;
  }
  if (config.vertexEnabled) {
    return config.vertexProvider === "anthropic"
      ? "anthropic-vertex/claude-sonnet-4-6"
      : "google-vertex/gemini-2.5-pro";
  }
  if (config.openaiApiKey) return "openai/gpt-5.4";
  if (config.modelEndpoint) return "openai/default";
  return "anthropic/claude-sonnet-4-6";
}

export function buildOpenClawConfig(config: DeployConfig, gatewayToken: string): object {
  const id = agentId(config);
  const model = deriveModel(config);
  const sourceBundle = loadAgentSourceBundle(config);
  const controlUi: Record<string, unknown> = {
    enabled: true,
  };
  controlUi.allowedOrigins = ["http://localhost:18789"];
  const useOtel = shouldUseOtel(config);
  const ocConfig: Record<string, unknown> = {
    // Enable diagnostics-otel plugin so the gateway emits OTLP traces
    ...(useOtel ? {
      plugins: {
        allow: ["diagnostics-otel"],
        entries: { "diagnostics-otel": { enabled: true } },
      },
      diagnostics: {
        enabled: true,
        otel: {
          enabled: true,
          endpoint: `http://localhost:${OTEL_HTTP_PORT}`,
          traces: true,
          metrics: true,
          logs: false,
        },
      },
    } : {}),
    gateway: {
      mode: "local",
      auth: { mode: "token", token: gatewayToken },
      controlUi,
    },
    agents: {
      defaults: {
        workspace: "~/.openclaw/workspace",
        model: { primary: model },
        models: buildDefaultAgentModelCatalog(model),
        ...(buildSandboxConfig(config) ? { sandbox: buildSandboxConfig(config) } : {}),
      },
      list: [
        {
          id,
          name: config.agentDisplayName || config.agentName,
          workspace: `~/.openclaw/workspace-${id}`,
          model: { primary: model },
          subagents: sourceBundle?.mainAgent?.subagents || { allowAgents: ["*"] },
          ...(sourceBundle?.mainAgent?.tools ? { tools: sourceBundle.mainAgent.tools } : {}),
        },
        ...((sourceBundle?.agents || []).map((entry) => ({
          id: entry.id,
          name: entry.name || entry.id,
          workspace: `~/.openclaw/workspace-${entry.id}`,
          model: entry.model || { primary: model },
          ...(entry.subagents ? { subagents: entry.subagents } : {}),
          ...(entry.tools ? { tools: entry.tools } : {}),
        }))),
      ],
    },
    ...(shouldUseLitellmProxy(config) ? {
      models: {
        providers: {
          litellm: {
            baseUrl: `http://localhost:${LITELLM_PORT}/v1`,
            api: "openai-completions",
            models: [
              { id: litellmModelName(config), name: litellmModelName(config) },
            ],
          },
        },
      },
    } : {}),
    skills: {
      load: { extraDirs: ["~/.openclaw/skills"], watch: true, watchDebounceMs: 1000 },
    },
    cron: { enabled: true },
  };

  const sandboxToolPolicy = buildSandboxToolPolicy(config);
  if (sandboxToolPolicy) {
    ocConfig.tools = sandboxToolPolicy;
  }

  if (config.telegramBotToken && config.telegramAllowFrom) {
    const allowFrom = config.telegramAllowFrom
      .split(",")
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => !isNaN(n));
    ocConfig.channels = { telegram: { dmPolicy: "allowlist", allowFrom } };
  }

  return ocConfig;
}
