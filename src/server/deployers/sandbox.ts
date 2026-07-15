import type { DeployConfig } from "./types.js";

function nonEmpty(value?: string): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export const OPEN_SHELL_POLICY_PATH = "/home/node/.openclaw/openshell/policy.yaml";
const DEFAULT_OPEN_SHELL_SANDBOX_FROM = "quay.io/sallyom/openclaw-openshell:latest";

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
  read_write:
    - /sandbox
    - /tmp
    - /dev/null
    - /opt/openclaw
landlock:
  compatibility: best_effort
process:
  run_as_user: sandbox
  run_as_group: sandbox
network_policies:
  openai_api:
    endpoints:
      - host: api.openai.com
        port: 443
        protocol: rest
        access: full
        enforcement: enforce
    binaries:
      - { path: /usr/bin/node }
      - { path: /usr/local/bin/node }
      - { path: "/app/**" }
  github_api_read_only:
    endpoints:
      - host: api.github.com
        port: 443
        protocol: rest
        access: read-only
        enforcement: enforce
    binaries:
      - { path: /usr/bin/curl }
      - { path: /usr/local/bin/curl }
      - { path: /usr/bin/gh }
      - { path: /usr/local/bin/gh }
  github_content_reachability:
    endpoints:
      - host: github.com
        port: 443
      - host: raw.githubusercontent.com
        port: 443
      - host: objects.githubusercontent.com
        port: 443
      - host: release-assets.githubusercontent.com
        port: 443
    binaries:
      - { path: /usr/bin/curl }
      - { path: /usr/local/bin/curl }
      - { path: /usr/bin/git }
      - { path: /usr/local/bin/git }
  npm_registry_reachability:
    endpoints:
      - host: registry.npmjs.org
        port: 443
    binaries:
      - { path: /usr/bin/node }
      - { path: /usr/local/bin/node }
      - { path: /usr/bin/npm }
      - { path: /usr/local/bin/npm }
`;

export function buildOpenShellPluginConfig(config: DeployConfig): Record<string, unknown> | undefined {
  if (!config.sandboxEnabled || config.sandboxBackend !== "openshell") {
    return undefined;
  }
  return {
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
