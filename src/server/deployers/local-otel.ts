import { promisify } from "node:util";
import { execFile } from "node:child_process";
import {
  shouldUseOtel,
  generateOtelConfig,
  otelAgentEnv,
  OTEL_COLLECTOR_IMAGE,
  JAEGER_IMAGE,
  JAEGER_UI_PORT,
} from "./otel.js";
import type { DeployConfig, LogCallback } from "./types.js";

const execFileAsync = promisify(execFile);

const OTEL_STATE_DIR = "/otel-state";
const OTEL_CONFIG_PATH = `${OTEL_STATE_DIR}/otel/config.yaml`;

export function otelContainerName(config: DeployConfig): string {
  const prefix = config.prefix || "openclaw";
  return `openclaw-${prefix}-${config.agentName}-otel`.toLowerCase();
}

/**
 * Write the OTEL collector config into the data volume and start
 * the collector sidecar. Returns env vars to pass to the gateway.
 */
export async function startOtelSidecar(
  config: DeployConfig,
  runtime: string,
  volumeName: string,
  podNameOrNull: string | null,
  litellmContainerOrNull: string | null,
  port: number,
  image: string,
  log: LogCallback,
  runCommand: (cmd: string, args: string[], log: LogCallback) => Promise<{ code: number }>,
  removeContainer: (runtime: string, name: string) => Promise<void>,
): Promise<Record<string, string> | undefined> {
  if (!shouldUseOtel(config)) return undefined;

  log("OTEL collector enabled — writing config to volume...");

  const otelYaml = generateOtelConfig(config);
  const otelB64 = Buffer.from(otelYaml).toString("base64");

  const initScript = [
    `mkdir -p ${OTEL_STATE_DIR}/otel`,
    `echo '${otelB64}' | base64 -d > ${OTEL_CONFIG_PATH}`,
  ].join(" && ");

  const initResult = await runCommand(runtime, [
    "run", "--rm",
    "-v", `${volumeName}:${OTEL_STATE_DIR}`,
    image, "sh", "-c", initScript,
  ], log);

  if (initResult.code !== 0) {
    log("WARNING: Failed to write OTEL config to volume");
    return undefined;
  }

  const otelImage = config.otelImage || OTEL_COLLECTOR_IMAGE;
  const otelName = otelContainerName(config);
  const isPodman = runtime === "podman";

  // Pull image if needed
  try {
    await execFileAsync(runtime, ["image", "exists", otelImage]);
  } catch {
    log(`Pulling OTEL collector image: ${otelImage}...`);
    const pull = await runCommand(runtime, ["pull", otelImage], log);
    if (pull.code !== 0) {
      log("WARNING: Failed to pull OTEL collector image");
      return undefined;
    }
  }

  await removeContainer(runtime, otelName);

  let startResult: { code: number };
  if (isPodman && podNameOrNull) {
    startResult = await runCommand(runtime, [
      "run", "-d", "--rm",
      "--name", otelName,
      "--pod", podNameOrNull,
      "-v", `${volumeName}:${OTEL_STATE_DIR}:ro`,
      otelImage,
      "--config", OTEL_CONFIG_PATH,
    ], log);
  } else if (litellmContainerOrNull) {
    // Docker: share the LiteLLM container's network
    startResult = await runCommand(runtime, [
      "run", "-d", "--rm",
      "--name", otelName,
      "--network", `container:${litellmContainerOrNull}`,
      "-v", `${volumeName}:${OTEL_STATE_DIR}:ro`,
      otelImage,
      "--config", OTEL_CONFIG_PATH,
    ], log);
  } else {
    // OTEL is the only sidecar (or Docker without LiteLLM)
    // No published ports needed — OTEL listens on localhost for the gateway
    if (isPodman) {
      // Need a pod for shared localhost
      startResult = await runCommand(runtime, [
        "run", "-d", "--rm",
        "--name", otelName,
        "--pod", podNameOrNull || otelName + "-pod",
        "-v", `${volumeName}:${OTEL_STATE_DIR}:ro`,
        otelImage,
        "--config", OTEL_CONFIG_PATH,
      ], log);
    } else {
      // Docker standalone — gateway will --network container:otel
      startResult = await runCommand(runtime, [
        "run", "-d", "--rm",
        "--name", otelName,
        "-p", `${port}:18789`,
        "-v", `${volumeName}:${OTEL_STATE_DIR}:ro`,
        otelImage,
        "--config", OTEL_CONFIG_PATH,
      ], log);
    }
  }

  if (startResult.code !== 0) {
    log("WARNING: Failed to start OTEL collector");
    return undefined;
  }

  log(`OTEL collector started — exporting traces to ${config.otelEndpoint}`);
  return otelAgentEnv();
}

/**
 * Stop the OTEL sidecar container if it's running.
 */
export async function stopOtelSidecar(
  config: DeployConfig,
  runtime: string,
  log: LogCallback,
  runCommand: (cmd: string, args: string[], log: LogCallback) => Promise<{ code: number }>,
): Promise<void> {
  const otelName = otelContainerName(config);
  try {
    await execFileAsync(runtime, ["inspect", otelName]);
    log(`Stopping OTEL collector: ${otelName}`);
    await runCommand(runtime, ["stop", otelName], log);
  } catch {
    // Not running
  }

  const jaegerName = jaegerContainerName(config);
  try {
    await execFileAsync(runtime, ["inspect", jaegerName]);
    log(`Stopping Jaeger: ${jaegerName}`);
    await runCommand(runtime, ["stop", jaegerName], log);
  } catch {
    // Not running
  }
}

// ── Jaeger all-in-one sidecar ───────────────────────────────────────

export function jaegerContainerName(config: DeployConfig): string {
  const prefix = config.prefix || "openclaw";
  return `openclaw-${prefix}-${config.agentName}-jaeger`.toLowerCase();
}

/**
 * Start Jaeger all-in-one as a sidecar in the pod.
 * Receives OTLP on 4317/4318, serves UI on 16686.
 */
export async function startJaegerSidecar(
  config: DeployConfig,
  runtime: string,
  podNameStr: string,
  log: LogCallback,
  runCommand: (cmd: string, args: string[], log: LogCallback) => Promise<{ code: number }>,
  removeContainer: (runtime: string, name: string) => Promise<void>,
): Promise<void> {
  if (!config.otelJaeger) return;

  const jaegerImage = JAEGER_IMAGE;
  const jaegerName = jaegerContainerName(config);

  // Pull if needed
  try {
    await execFileAsync(runtime, ["image", "exists", jaegerImage]);
  } catch {
    log(`Pulling Jaeger image: ${jaegerImage}...`);
    await runCommand(runtime, ["pull", jaegerImage], log);
  }

  await removeContainer(runtime, jaegerName);

  const isPodman = runtime === "podman";
  if (isPodman) {
    await runCommand(runtime, [
      "run", "-d", "--rm",
      "--name", jaegerName,
      "--pod", podNameStr,
      "-e", "COLLECTOR_OTLP_ENABLED=true",
      jaegerImage,
    ], log);
  } else {
    // Docker: share network with the first sidecar in the group
    await runCommand(runtime, [
      "run", "-d", "--rm",
      "--name", jaegerName,
      "--network", `container:${otelContainerName(config)}`,
      "-e", "COLLECTOR_OTLP_ENABLED=true",
      jaegerImage,
    ], log);
  }

  log(`Jaeger UI available at http://localhost:${JAEGER_UI_PORT}`);
}
