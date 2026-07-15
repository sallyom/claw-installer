import { homedir } from "node:os";
import { isAbsolute, join, normalize } from "node:path";

const INSTALLER_PATH_SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;

export function validateInstallerPathSegment(value: string, label: string): string {
  const trimmed = value.trim();
  if (!INSTALLER_PATH_SEGMENT_PATTERN.test(trimmed)) {
    throw new Error(`${label} contains invalid characters`);
  }
  return trimmed;
}

export function installerStateDir(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.OPENCLAW_INSTALLER_STATE_DIR?.trim();
  if (!configured) {
    return join(homedir(), ".openclaw");
  }

  const expanded = configured === "~"
    ? homedir()
    : configured.startsWith("~/")
      ? join(homedir(), configured.slice(2))
      : configured;
  if (!isAbsolute(expanded)) {
    throw new Error("OPENCLAW_INSTALLER_STATE_DIR must be an absolute path");
  }
  return normalize(expanded);
}

export function openclawHomeDir(): string {
  return installerStateDir();
}

export function installerDataDir(): string {
  return join(openclawHomeDir(), "installer");
}

export function agentWorkspaceDir(id: string): string {
  return join(openclawHomeDir(), `workspace-${id}`);
}

export function skillsDir(): string {
  return join(openclawHomeDir(), "skills");
}

export function cronDir(): string {
  return join(openclawHomeDir(), "cron");
}

export function cronJobsFile(): string {
  return join(cronDir(), "jobs.json");
}

export function installerLocalInstanceDir(name: string): string {
  return join(installerDataDir(), "local", validateInstallerPathSegment(name, "Local instance name"));
}

export function installerK8sInstanceDir(namespace: string): string {
  return join(installerDataDir(), "k8s", validateInstallerPathSegment(namespace, "Kubernetes namespace"));
}
