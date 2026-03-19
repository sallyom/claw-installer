import * as k8s from "@kubernetes/client-node";
import { randomBytes } from "node:crypto";
import { loadKubeConfig } from "../services/k8s.js";
import type { DeployConfig, LogCallback } from "./types.js";
import { shouldUseLitellmProxy, litellmModelName, LITELLM_PORT } from "./litellm.js";
import { shouldUseOtel, OTEL_HTTP_PORT } from "./otel.js";
import { buildSandboxConfig } from "./sandbox.js";
import { buildSandboxToolPolicy } from "./tool-policy.js";
import { loadAgentSourceBundle } from "./agent-source.js";

export const DEFAULT_IMAGE = process.env.OPENCLAW_IMAGE || "quay.io/aicatalyst/openclaw:latest";
export const DEFAULT_VERTEX_IMAGE = process.env.OPENCLAW_VERTEX_IMAGE || "quay.io/aicatalyst/openclaw:vertex-anthropic";

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

export function namespaceName(config: DeployConfig): string {
  const prefix = config.prefix || "openclaw";
  const ns = config.namespace || `${prefix}-${config.agentName}-openclaw`;
  return ns.toLowerCase();
}

export function agentId(config: DeployConfig): string {
  const prefix = config.prefix || "openclaw";
  return `${prefix}_${config.agentName}`;
}

export function generateToken(): string {
  return randomBytes(32).toString("base64");
}

export function deriveModel(config: DeployConfig): string {
  if (config.agentModel) return config.agentModel;
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
  return "claude-sonnet-4-6";
}

function subagentConfig(policy?: string): { allowAgents: string[] } {
  switch (policy) {
    case "self": return { allowAgents: ["self"] };
    case "unrestricted": return { allowAgents: ["*"] };
    default: return { allowAgents: [] };
  }
}

export function buildOpenClawConfig(config: DeployConfig, gatewayToken: string, opts?: { routeUrl?: string }): object {
  const id = agentId(config);
  const model = deriveModel(config);
  const sourceBundle = loadAgentSourceBundle(config);
  const controlUi: Record<string, unknown> = {
    enabled: true,
  };
  if (opts?.routeUrl) {
    controlUi.allowedOrigins = [opts.routeUrl];
    // Safe: the OAuth proxy already authenticates users via OpenShift login
    // before requests reach the gateway. Device pairing is redundant here and
    // actually breaks the flow — the proxy forwards X-Forwarded-For headers
    // that make the gateway think requests are non-local, triggering an
    // interactive pairing prompt that can't complete through the proxy.
    controlUi.dangerouslyDisableDeviceAuth = true;
  } else {
    // Plain K8s: accessed via port-forward on localhost
    controlUi.allowedOrigins = ["http://localhost:18789"];
  }
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
      bind: opts?.routeUrl ? "loopback" : undefined,
      auth: { mode: "token", token: gatewayToken },
      controlUi,
    },
    agents: {
      defaults: {
        workspace: "~/.openclaw/workspace",
        model: { primary: model },
        ...(buildSandboxConfig(config) ? { sandbox: buildSandboxConfig(config) } : {}),
      },
      list: [
        {
          id,
          name: config.agentDisplayName || config.agentName,
          workspace: `~/.openclaw/workspace-${id}`,
          model: { primary: model },
          subagents: sourceBundle?.mainAgent?.subagents || subagentConfig(config.subagentPolicy),
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
    cron: { enabled: !!config.cronEnabled },
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

// ── OpenShift Route helpers ──────────────────────────────────────────

export async function applyRoute(ns: string, log: LogCallback, withOauth = false): Promise<void> {
  const kc = loadKubeConfig();
  const customApi = kc.makeApiClient(k8s.CustomObjectsApi);
  const routeParams = {
    group: "route.openshift.io",
    version: "v1",
    namespace: ns,
    plural: "routes",
    name: "openclaw",
  };

  try {
    await customApi.getNamespacedCustomObject(routeParams);
    log("Route openclaw already exists (skipping)");
    return;
  } catch {
    // does not exist — create it
  }

  const route = {
    apiVersion: "route.openshift.io/v1",
    kind: "Route",
    metadata: {
      name: "openclaw",
      namespace: ns,
      labels: { app: "openclaw" },
      annotations: {
        "haproxy.router.openshift.io/timeout": "30m",
      },
    },
    spec: {
      to: { kind: "Service", name: "openclaw", weight: 100 },
      port: { targetPort: withOauth ? "oauth-ui" : "gateway" },
      tls: { termination: "edge", insecureEdgeTerminationPolicy: "Redirect" },
    },
  };

  log("Creating Route...");
  await customApi.createNamespacedCustomObject({
    group: "route.openshift.io",
    version: "v1",
    namespace: ns,
    plural: "routes",
    body: route,
  });
  log("Route openclaw applied");
}

export async function getRouteUrl(ns: string): Promise<string> {
  try {
    const kc = loadKubeConfig();
    const customApi = kc.makeApiClient(k8s.CustomObjectsApi);
    const result = await customApi.getNamespacedCustomObject({
      group: "route.openshift.io",
      version: "v1",
      namespace: ns,
      plural: "routes",
      name: "openclaw",
    });
    const spec = (result as Record<string, unknown>).spec as Record<string, unknown> | undefined;
    const host = spec?.host as string | undefined;
    if (host) return `https://${host}`;
  } catch {
    // fall through
  }
  return "";
}
