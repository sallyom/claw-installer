import type { DeployConfig } from "./types.js";

function nonEmpty(value?: string): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

const OPEN_SHELL_CLI_MOUNT_PATH = "/opt/openshell/bin/openshell";
export const OPEN_SHELL_POLICY_PATH = "/home/node/.openclaw/openshell/policy.yaml";
// TODO(openshell): pin this by digest once the Fedora sandbox image contract stabilizes.
const DEFAULT_OPEN_SHELL_SANDBOX_FROM = "quay.io/sallyom/openclaw-openshell-sandbox:latest";

export const OPEN_SHELL_POLICY_YAML = `version: 1
filesystem_policy:
  include_workdir: true
  read_only:
    - /usr
    - /lib
    - /proc
    - /dev/urandom
    - /app
    - /etc
    - /var/log
    - /home/sandbox
  read_write:
    - /sandbox
    - /tmp
    - /dev/null
landlock:
  compatibility: best_effort
process:
  run_as_user: sandbox
  run_as_group: sandbox
`;

export function buildOpenShellPluginConfig(config: DeployConfig): Record<string, unknown> | undefined {
  if (!config.sandboxEnabled || config.sandboxBackend !== "openshell") {
    return undefined;
  }
  return {
    command: OPEN_SHELL_CLI_MOUNT_PATH,
    gateway: "openshell",
    from: nonEmpty(config.sandboxOpenShellFrom) || DEFAULT_OPEN_SHELL_SANDBOX_FROM,
    mode: config.sandboxOpenShellMode || "remote",
    gatewayEndpoint: nonEmpty(config.sandboxOpenShellGatewayEndpoint),
    policy: OPEN_SHELL_POLICY_PATH,
    timeoutSeconds: 180,
  };
}

export function buildSandboxConfig(config: DeployConfig): Record<string, unknown> | undefined {
  if (!config.sandboxEnabled) {
    return undefined;
  }

  const backend = config.sandboxBackend || "ssh";
  const sandbox: Record<string, unknown> = {
    mode: config.sandboxMode || "all",
    backend,
    scope: config.sandboxScope || "session",
    workspaceAccess: config.sandboxWorkspaceAccess || "rw",
  };

  if (backend === "ssh") {
    sandbox.ssh = {
      target: nonEmpty(config.sandboxSshTarget),
      workspaceRoot: nonEmpty(config.sandboxSshWorkspaceRoot) || "/tmp/openclaw-sandboxes",
      strictHostKeyChecking: config.sandboxSshStrictHostKeyChecking ?? true,
      updateHostKeys: config.sandboxSshUpdateHostKeys ?? true,
      ...(nonEmpty(config.sandboxSshIdentityPath)
        ? {
            identityFile: nonEmpty(config.sandboxSshIdentityPath),
          }
        : nonEmpty(config.sandboxSshIdentity)
        ? {
            identityData: {
              source: "env",
              provider: "default",
              id: "SSH_IDENTITY",
            },
          }
        : {}),
      ...(nonEmpty(config.sandboxSshCertificatePath)
        ? {
            certificateFile: nonEmpty(config.sandboxSshCertificatePath),
          }
        : nonEmpty(config.sandboxSshCertificate)
        ? {
            certificateData: {
              source: "env",
              provider: "default",
              id: "SSH_CERTIFICATE",
            },
          }
        : {}),
      ...(nonEmpty(config.sandboxSshKnownHostsPath)
        ? {
            knownHostsFile: nonEmpty(config.sandboxSshKnownHostsPath),
          }
        : nonEmpty(config.sandboxSshKnownHosts)
        ? {
            knownHostsData: {
              source: "env",
              provider: "default",
              id: "SSH_KNOWN_HOSTS",
            },
          }
        : {}),
    };
  }

  return sandbox;
}
