import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import type { ContainerRuntime } from "../services/container.js";
import type { DeployConfig, LogCallback } from "./types.js";
import { bindMountSpec, runCommand, runtimeOwnershipFixupCommand } from "./local-runtime.js";

const OPENCLAW_LOCAL_HOME = "/home/node";
const OPENCLAW_LOCAL_STATE_DIR = `${OPENCLAW_LOCAL_HOME}/.openclaw`;
const OPENCLAW_LOCAL_TMP_DIR = `${OPENCLAW_LOCAL_STATE_DIR}/tmp`;

export async function installLocalPlugins(params: {
  runtime: ContainerRuntime;
  config: DeployConfig;
  image: string;
  log: LogCallback;
  stateMountArgs: string[];
}): Promise<void> {
  const plan = localPluginInstallPlan(params.config);
  if (plan.specs.length === 0) {
    return;
  }

  for (const hostPath of plan.mountedHostPaths) {
    params.log(`Mounting plugin source: ${hostPath}`);
  }
  params.log(`Installing OpenClaw plugins: ${configuredPluginInstallSpecs(params.config).join(", ")}`);

  const installScript = [
    "set -eu",
    `mkdir -p ${OPENCLAW_LOCAL_STATE_DIR} ${OPENCLAW_LOCAL_TMP_DIR} ${OPENCLAW_LOCAL_HOME}/.npm ${OPENCLAW_LOCAL_HOME}/.cache ${OPENCLAW_LOCAL_HOME}/.config`,
    ...plan.specs.map(nonFatalPluginInstallCommand),
    runtimeOwnershipFixupCommand(),
  ].join("\n");

  const result = await runCommand(params.runtime, [
    "run", "--rm",
    ...params.stateMountArgs,
    ...plan.mountArgs,
    "-e", `HOME=${OPENCLAW_LOCAL_HOME}`,
    "-e", `TMPDIR=${OPENCLAW_LOCAL_TMP_DIR}`,
    "-e", `OPENCLAW_CONFIG_DIR=${OPENCLAW_LOCAL_STATE_DIR}`,
    "-e", `OPENCLAW_STATE_DIR=${OPENCLAW_LOCAL_STATE_DIR}`,
    "-e", `NPM_CONFIG_CACHE=${OPENCLAW_LOCAL_HOME}/.npm`,
    "-e", `npm_config_cache=${OPENCLAW_LOCAL_HOME}/.npm`,
    "-e", `XDG_CACHE_HOME=${OPENCLAW_LOCAL_HOME}/.cache`,
    "-e", `XDG_CONFIG_HOME=${OPENCLAW_LOCAL_HOME}/.config`,
    params.image,
    "sh", "-c", installScript,
  ], params.log);
  if (result.code !== 0) {
    throw new Error("Failed to install configured OpenClaw plugins");
  }
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function nonFatalPluginInstallCommand(spec: string): string {
  const quotedSpec = shellQuote(spec);
  return [
    `node openclaw.mjs plugins install ${quotedSpec} --force || {`,
    `  echo "WARNING: OpenClaw plugin install failed for ${quotedSpec}; continuing. Run openclaw doctor after install." >&2`,
    "  true",
    "}",
  ].join("\n");
}

function configuredPluginInstallSpecs(config: DeployConfig): string[] {
  const seen = new Set<string>();
  const specs: string[] = [];
  for (const spec of config.pluginInstallSpecs ?? []) {
    const trimmed = spec.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    specs.push(trimmed);
  }
  return specs;
}

function hostPluginSourcePath(spec: string): string | undefined {
  if (spec.startsWith("~/")) {
    return resolve(homedir(), spec.slice(2));
  }
  if (spec.startsWith("/") || spec.startsWith("./") || spec.startsWith("../")) {
    return resolve(spec);
  }
  return undefined;
}

function localPluginInstallPlan(config: DeployConfig): {
  specs: string[];
  mountArgs: string[];
  mountedHostPaths: string[];
} {
  const specs: string[] = [];
  const mountArgs: string[] = [];
  const mountedHostPaths: string[] = [];
  configuredPluginInstallSpecs(config).forEach((spec, index) => {
    const hostPath = hostPluginSourcePath(spec);
    if (hostPath && existsSync(hostPath)) {
      const containerPath = `/tmp/openclaw-plugin-sources/plugin-${index}`;
      mountArgs.push("-v", bindMountSpec(hostPath, containerPath, "ro"));
      mountedHostPaths.push(hostPath);
      specs.push(containerPath);
      return;
    }
    specs.push(spec);
  });
  return { specs, mountArgs, mountedHostPaths };
}

export const __testing = {
  localPluginInstallPlan,
};
