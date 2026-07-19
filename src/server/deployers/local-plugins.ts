import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import type { ContainerRuntime } from "../services/container.js";
import type { DeployConfig, LogCallback } from "./types.js";
import {
  buildOpenShellCliInstallScript,
  OPEN_SHELL_POLICY_YAML,
  OPEN_SHELL_PLUGIN_SPEC,
  OPEN_SHELL_POLICY_PATH,
  buildOpenShellPolicyYaml,
  usesOpenShellSandbox,
  usesOpenShellWorker,
} from "./sandbox.js";
import {
  bindMountSpec,
  localMaintenanceEntrypointArgs,
  localStateMaintenanceUserArgs,
  runCommand,
  runtimeOwnershipFixupCommand,
} from "./local-runtime.js";

const OPENCLAW_LOCAL_HOME = "/home/node";
const OPENCLAW_LOCAL_STATE_DIR = `${OPENCLAW_LOCAL_HOME}/.openclaw`;
const OPENCLAW_LOCAL_TMP_DIR = `${OPENCLAW_LOCAL_STATE_DIR}/tmp`;
const OPEN_SHELL_LOCAL_CLI_DIR = `${OPENCLAW_LOCAL_STATE_DIR}/bin`;
export const OPEN_SHELL_LOCAL_CLI_PATH = `${OPEN_SHELL_LOCAL_CLI_DIR}/openshell`;
const OPEN_SHELL_LOCAL_TLS_VOLUME = "openshell-client-tls";
const OPEN_SHELL_LOCAL_TLS_MOUNT_DIR = "/run/openshell-client-tls";
const OPEN_SHELL_LOCAL_TLS_DIR = `${OPENCLAW_LOCAL_HOME}/.config/openshell/gateways/openshell/mtls`;
const OPEN_SHELL_LOCAL_WIP_CLI_MOUNT_DIR = "/run/openshell-wip-cli";
const ONEPASSWORD_PLUGIN_SPEC = "git:github.com/sallyom/claw-1password";

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

  const installScript = buildLocalPluginInstallScript(
    plan.specs,
    params.config.localFileOwner,
    plan.openshellCliMountPath,
    buildOpenShellPolicyYaml(params.config),
  );

  const result = await runCommand(params.runtime, [
    "run", "--rm",
    ...localMaintenanceEntrypointArgs(),
    ...localStateMaintenanceUserArgs(params.config.localFileOwner),
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

function buildLocalPluginInstallScript(
  specs: string[],
  localFileOwner?: string,
  openshellCliMountPath?: string,
  openshellPolicyYaml = OPEN_SHELL_POLICY_YAML,
): string {
  const useOpenShell = specs.includes(OPEN_SHELL_PLUGIN_SPEC);
  const policy = Buffer.from(openshellPolicyYaml).toString("base64");
  return [
    "set -eu",
    `mkdir -p ${OPENCLAW_LOCAL_STATE_DIR} ${OPENCLAW_LOCAL_TMP_DIR} ${OPENCLAW_LOCAL_HOME}/.npm ${OPENCLAW_LOCAL_HOME}/.cache ${OPENCLAW_LOCAL_HOME}/.config`,
    ...(useOpenShell
      ? [
          ...(openshellCliMountPath
            ? [
                `test -x ${openshellCliMountPath} || { echo "OpenShell WIP CLI is missing or not executable" >&2; exit 1; }`,
                `install -m 0755 ${openshellCliMountPath} ${OPEN_SHELL_LOCAL_CLI_PATH}`,
                `${OPEN_SHELL_LOCAL_CLI_PATH} --version`,
              ]
            : [buildOpenShellCliInstallScript(OPEN_SHELL_LOCAL_CLI_DIR)]),
          `mkdir -p ${OPENCLAW_LOCAL_STATE_DIR}/openshell`,
          `echo '${policy}' | base64 -d > ${OPEN_SHELL_POLICY_PATH}`,
          `test -r ${OPEN_SHELL_LOCAL_TLS_MOUNT_DIR}/ca.crt -a -r ${OPEN_SHELL_LOCAL_TLS_MOUNT_DIR}/tls.crt -a -r ${OPEN_SHELL_LOCAL_TLS_MOUNT_DIR}/tls.key || { echo "OpenShell client TLS volume is missing or incomplete; follow docs/deploy-local.md#sandbox-backends" >&2; exit 1; }`,
          `mkdir -p ${OPEN_SHELL_LOCAL_TLS_DIR}`,
          `install -m 0644 ${OPEN_SHELL_LOCAL_TLS_MOUNT_DIR}/ca.crt ${OPEN_SHELL_LOCAL_TLS_DIR}/ca.crt`,
          `install -m 0644 ${OPEN_SHELL_LOCAL_TLS_MOUNT_DIR}/tls.crt ${OPEN_SHELL_LOCAL_TLS_DIR}/tls.crt`,
          `install -m 0600 ${OPEN_SHELL_LOCAL_TLS_MOUNT_DIR}/tls.key ${OPEN_SHELL_LOCAL_TLS_DIR}/tls.key`,
        ]
      : []),
    ...specs.flatMap((spec) => spec === OPEN_SHELL_PLUGIN_SPEC
      ? [
          "if node openclaw.mjs plugins list | grep -q openshell; then",
          '  echo "OpenShell plugin is bundled in the image; skipping package installation."',
          "else",
          nonFatalPluginInstallCommand(spec),
          "fi",
        ]
      : [nonFatalPluginInstallCommand(spec)]),
    ...(useOpenShell ? ["node openclaw.mjs plugins list | grep -q openshell"] : []),
    runtimeOwnershipFixupCommand(localFileOwner),
  ].join("\n");
}

function configuredPluginInstallSpecs(config: DeployConfig): string[] {
  const seen = new Set<string>();
  const specs: string[] = [];
  for (const spec of [
    ...(config.pluginInstallSpecs ?? []),
    ...(config.onePasswordSecretsEnabled ? [ONEPASSWORD_PLUGIN_SPEC] : []),
    ...(usesOpenShellSandbox(config) ? [OPEN_SHELL_PLUGIN_SPEC] : []),
  ]) {
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
  openshellCliMountPath?: string;
} {
  const specs: string[] = [];
  const mountArgs: string[] = [];
  const mountedHostPaths: string[] = [];
  if (usesOpenShellSandbox(config)) {
    mountArgs.push("-v", `${OPEN_SHELL_LOCAL_TLS_VOLUME}:${OPEN_SHELL_LOCAL_TLS_MOUNT_DIR}:ro`);
  }
  let openshellCliMountPath: string | undefined;
  if (usesOpenShellWorker(config)) {
    const configuredPath = config.sandboxOpenShellCliHostPath?.trim();
    if (!configuredPath) {
      throw new Error("OpenShell WorkerProvider WIP requires a local OpenShell CLI path");
    }
    const hostPath = resolve(configuredPath);
    if (!existsSync(hostPath)) {
      throw new Error(`OpenShell WorkerProvider WIP CLI does not exist: ${hostPath}`);
    }
    openshellCliMountPath = `${OPEN_SHELL_LOCAL_WIP_CLI_MOUNT_DIR}/openshell`;
    mountArgs.push("-v", bindMountSpec(hostPath, openshellCliMountPath, "ro"));
    mountedHostPaths.push(hostPath);
  }
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
  return { specs, mountArgs, mountedHostPaths, openshellCliMountPath };
}

export const __testing = {
  buildLocalPluginInstallScript,
  localPluginInstallPlan,
};
