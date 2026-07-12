import type { DeployConfig } from "./types.js";

export const MCP_APPS_SANDBOX_PORT = 18790;
export const MCP_APPS_OPENSHIFT_PROXY_PORT = 18792;

export function mcpAppsPortPublishArgs(config: DeployConfig): string[] {
  return config.mcpAppsEnabled
    ? ["-p", `${MCP_APPS_SANDBOX_PORT}:${MCP_APPS_SANDBOX_PORT}`]
    : [];
}
