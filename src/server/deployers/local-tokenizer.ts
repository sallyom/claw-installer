/**
 * Tokenizer sidecar container management for the local (podman/docker) deployer.
 *
 * Extracted to keep local.ts manageable — same pattern as the LiteLLM sidecar.
 */
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import {
  removeContainer,
  type ContainerRuntime,
} from "../services/container.js";
import {
  TOKENIZER_IMAGE,
  TOKENIZER_PORT,
} from "./tokenizer.js";
import type { DeployConfig, LogCallback } from "./types.js";

const execFileAsync = promisify(execFile);

const TOKENIZER_OPEN_KEY_PATH = "/home/node/.openclaw/tokenizer/open-key";

/** Container name for the tokenizer sidecar. */
export function tokenizerContainerName(containerName: string): string {
  return `${containerName}-tokenizer`;
}

/**
 * Common run args for the tokenizer sidecar.
 *
 * The OPEN_KEY is read from a file on the shared volume (written during init)
 * rather than passed as an env var, so it never leaks via `podman inspect`
 * or `docker inspect`.
 */
function tokenizerRunArgs(
  config: DeployConfig,
  tkzName: string,
  vol: string,
): string[] {
  const tkzImage = config.tokenizerImage || TOKENIZER_IMAGE;
  return [
    "run", "-d", "--rm",
    "--name", tkzName,
    "-v", `${vol}:/home/node/.openclaw:ro`,
    "-e", `LISTEN_ADDRESS=0.0.0.0:${TOKENIZER_PORT}`,
    "-e", "NO_FLY_SRC=true",
    "--entrypoint", "sh",
    tkzImage,
    "-c", `export OPEN_KEY=$(cat ${TOKENIZER_OPEN_KEY_PATH}) && exec tokenizer`,
  ];
}

export interface StartTokenizerOpts {
  config: DeployConfig;
  runtime: string;
  tkzName: string;
  vol: string;
  port: number;
  podName: string;
  /** Name of a container whose network namespace to share (docker only). */
  networkContainer?: string;
  log: LogCallback;
  runCommand: (cmd: string, args: string[], log: LogCallback) => Promise<{ code: number }>;
}

/**
 * Start the tokenizer sidecar container.
 *
 * Podman:  adds the container to the given pod.
 * Docker:  if `networkContainer` is set, shares its network namespace;
 *          otherwise publishes the gateway port itself.
 */
export async function startTokenizerContainer(opts: StartTokenizerOpts): Promise<void> {
  const { config, runtime, tkzName, vol, port, podName: pod, networkContainer, log, runCommand: run } = opts;
  const isPodman = runtime === "podman";
  const baseArgs = tokenizerRunArgs(config, tkzName, vol);

  if (isPodman) {
    // Insert --pod right after --name
    const args = [...baseArgs];
    const nameIdx = args.indexOf("--name");
    args.splice(nameIdx + 2, 0, "--pod", pod);
    const result = await run(runtime, args, log);
    if (result.code !== 0) {
      throw new Error("Failed to start Tokenizer sidecar");
    }
  } else {
    await removeContainer(runtime as ContainerRuntime, tkzName);
    const args = [...baseArgs];
    const nameIdx = args.indexOf("--name");
    if (networkContainer) {
      args.splice(nameIdx + 2, 0, "--network", `container:${networkContainer}`);
    } else {
      args.splice(nameIdx + 2, 0, "-p", `${port}:18789`);
    }
    const result = await run(runtime, args, log);
    if (result.code !== 0) {
      throw new Error("Failed to start Tokenizer sidecar");
    }
  }

  log("Waiting for Tokenizer proxy to start...");
  await new Promise((r) => setTimeout(r, 2000));
  log("Tokenizer proxy started");
}

/** Stop and remove the tokenizer sidecar (best-effort). */
export async function stopTokenizerContainer(
  runtime: string,
  containerName: string,
  log: LogCallback,
  runCommand: (cmd: string, args: string[], log: LogCallback) => Promise<{ code: number }>,
): Promise<void> {
  try {
    await execFileAsync(runtime, ["inspect", containerName]);
    log(`Stopping Tokenizer sidecar: ${containerName}`);
    await runCommand(runtime, ["stop", containerName], log);
  } catch {
    // No sidecar running
  }
}
