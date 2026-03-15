import type { DeployConfig } from "./types.js";

export const OTEL_COLLECTOR_IMAGE = "ghcr.io/open-telemetry/opentelemetry-collector-releases/opentelemetry-collector-contrib:0.120.0";
export const JAEGER_IMAGE = "jaegertracing/jaeger:2.16.0";
export const JAEGER_UI_PORT = 16686;
export const OTEL_GRPC_PORT = 4317;
export const OTEL_HTTP_PORT = 4318;

/**
 * Returns true when the OTEL collector sidecar should be deployed.
 */
export function shouldUseOtel(config: DeployConfig): boolean {
  return !!(config.otelEnabled && (config.otelEndpoint || config.otelJaeger));
}

/**
 * Generate the OTEL collector config YAML.
 *
 * Supports two exporter modes:
 * - otlphttp: for MLflow, Grafana Tempo, or any OTLP/HTTP endpoint
 * - otlp (gRPC): for Jaeger, native OTLP collectors
 *
 * The config is generic — not OpenClaw-specific. Any containerized agent
 * that emits OTLP traces to localhost:4317/4318 will work.
 */
/**
 * Rewrite localhost endpoints for container networking.
 * Inside a pod/container, "localhost" is the pod itself, not the host machine.
 * For local deploys: podman uses host.containers.internal, docker uses host.docker.internal.
 * For K8s: endpoints should already be service DNS names, no rewrite needed.
 */
export function resolveEndpointForContainer(endpoint: string, runtime?: string): string {
  const hostAlias = runtime === "docker"
    ? "host.docker.internal"
    : "host.containers.internal";
  return endpoint
    .replace(/localhost/g, hostAlias)
    .replace(/127\.0\.0\.1/g, hostAlias);
}

export function generateOtelConfig(config: DeployConfig): string {
  // When Jaeger sidecar is enabled and no external endpoint is set,
  // export to the in-pod Jaeger on localhost:4317
  const rawEndpoint = config.otelEndpoint || (config.otelJaeger ? "localhost:4317" : "");
  // For local deploys with an external endpoint, rewrite localhost to host alias
  // so the collector can reach services on the host. Skip rewrite when Jaeger is
  // in the same pod (localhost is correct).
  const endpoint = config.mode === "local" && !config.otelJaeger
    ? resolveEndpointForContainer(rawEndpoint, config.containerRuntime || undefined)
    : rawEndpoint;
  const useGrpc = endpoint.includes(":4317");
  const ns = config.namespace || config.prefix || "default";

  const lines: string[] = [
    "receivers:",
    "  otlp:",
    "    protocols:",
    "      grpc:",
    `        endpoint: 127.0.0.1:${OTEL_GRPC_PORT}`,
    "      http:",
    `        endpoint: 127.0.0.1:${OTEL_HTTP_PORT}`,
    "",
    "processors:",
    "  batch:",
    "    timeout: 5s",
    "    send_batch_size: 100",
    "",
    "  memory_limiter:",
    "    check_interval: 1s",
    "    limit_mib: 256",
    "    spike_limit_mib: 64",
    "",
    "  resource:",
    "    attributes:",
    "      - key: service.namespace",
    `        value: "${ns}"`,
    "        action: upsert",
    "      - key: deployment.environment",
    "        value: production",
    "        action: upsert",
    "",
    "exporters:",
  ];

  if (useGrpc) {
    // gRPC exporter (Jaeger, native OTLP)
    lines.push(
      "  otlp:",
      `    endpoint: "${endpoint}"`,
      "    tls:",
      `      insecure: ${endpoint.startsWith("http://") || !endpoint.startsWith("https://") ? "true" : "false"}`,
    );
  } else {
    // HTTP exporter (MLflow, Tempo, generic OTLP/HTTP)
    const tls = endpoint.startsWith("https://") ? "false" : "true";
    lines.push(
      "  otlphttp:",
      `    endpoint: "${endpoint}"`,
    );
    if (config.otelExperimentId) {
      lines.push(
        "    headers:",
        `      x-mlflow-experiment-id: "${config.otelExperimentId}"`,
      );
    }
    lines.push(
      "    tls:",
      `      insecure: ${tls}`,
    );
  }

  lines.push(
    "",
    "  debug:",
    "    verbosity: basic",
    "",
    "service:",
    "  pipelines:",
    "    traces:",
    "      receivers: [otlp]",
    "      processors: [memory_limiter, resource, batch]",
    `      exporters: [${useGrpc ? "otlp" : "otlphttp"}, debug]`,
  );

  return lines.join("\n") + "\n";
}

/**
 * Environment variables to set on the agent container so it
 * knows where to send OTLP traces.
 */
export function otelAgentEnv(): Record<string, string> {
  return {
    OTEL_EXPORTER_OTLP_ENDPOINT: `http://localhost:${OTEL_HTTP_PORT}`,
    OTEL_EXPORTER_OTLP_PROTOCOL: "http/protobuf",
  };
}
