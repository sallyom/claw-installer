import type { DeployConfig } from "./types.js";

export const CHROMIUM_IMAGE = "chromedp/headless-shell:stable";
export const CHROMIUM_CDP_PORT = 9222;

/**
 * Returns true when the Chromium browser sidecar should be deployed.
 */
export function shouldUseChromiumSidecar(config: DeployConfig): boolean {
  return !!config.chromiumSidecar;
}

/**
 * Container name for the Chromium sidecar in local deployments.
 */
export function chromiumContainerName(config: DeployConfig): string {
  const prefix = config.prefix || "openclaw";
  return `openclaw-${prefix}-${config.agentName}-chromium`.toLowerCase();
}

/**
 * Environment variables to set on the gateway container so it
 * knows where to connect to the browser via CDP.
 */
export function chromiumAgentEnv(): Record<string, string> {
  return {
    CHROME_CDP_URL: `http://localhost:${CHROMIUM_CDP_PORT}`,
  };
}
