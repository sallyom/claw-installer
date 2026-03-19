import type { DeployConfig } from "./types.js";

function nonEmpty(value?: string): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
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
