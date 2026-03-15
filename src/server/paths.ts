import { homedir } from "node:os";
import { join } from "node:path";

export function openclawHomeDir(): string {
  return join(homedir(), ".openclaw");
}

export function installerDataDir(): string {
  return join(openclawHomeDir(), "installer");
}

export function agentWorkspaceDir(id: string): string {
  return join(openclawHomeDir(), `workspace-${id}`);
}

export function installerLocalInstanceDir(name: string): string {
  return join(installerDataDir(), "local", name);
}

export function installerK8sInstanceDir(namespace: string): string {
  return join(installerDataDir(), "k8s", namespace);
}
