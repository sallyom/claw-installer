import type { DeployConfig } from "./types.js";

export function buildSandboxToolPolicy(config: DeployConfig): Record<string, unknown> | undefined {
  if (!config.sandboxEnabled || !config.sandboxToolPolicyEnabled) {
    return undefined;
  }

  const allow: string[] = [];
  if (config.sandboxToolAllowFiles !== false) allow.push("group:fs");
  if (config.sandboxToolAllowSessions !== false) allow.push("group:sessions");
  if (config.sandboxToolAllowMemory !== false) allow.push("group:memory");
  if (config.sandboxToolAllowRuntime) allow.push("group:runtime");
  if (config.sandboxToolAllowBrowser) allow.push("group:ui");
  if (config.sandboxToolAllowAutomation) allow.push("group:automation");
  if (config.sandboxToolAllowMessaging) allow.push("group:messaging");

  return {
    sandbox: {
      tools: {
        allow,
      },
    },
  };
}
