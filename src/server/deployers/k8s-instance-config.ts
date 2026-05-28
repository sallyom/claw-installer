import type * as k8s from "@kubernetes/client-node";
import type { DeployConfig, LogCallback } from "./types.js";
import { coreApi, k8sApiHttpCode } from "../services/k8s.js";
import { sanitizeDeployConfig } from "../security.js";

export const INSTALLER_CONFIG_MAP_NAME = "openclaw-installer-config";
export const INSTALLER_DEPLOY_CONFIG_KEY = "deploy-config.json";

export function installerSavedDeployConfig(ns: string, config: DeployConfig): DeployConfig {
  return sanitizeDeployConfig({
    ...config,
    namespace: ns,
    anthropicApiKey: undefined,
    openaiApiKey: undefined,
    googleApiKey: undefined,
    openrouterApiKey: undefined,
    modelEndpointApiKey: undefined,
    gcpServiceAccountJson: undefined,
    codexOauthAuthJson: undefined,
    telegramBotToken: undefined,
    sandboxSshIdentity: undefined,
  });
}

export async function readInstallerSavedDeployConfig(ns: string): Promise<Record<string, unknown> | undefined> {
  const core = coreApi();
  try {
    const cm = await core.readNamespacedConfigMap({ name: INSTALLER_CONFIG_MAP_NAME, namespace: ns });
    const raw = cm.data?.[INSTALLER_DEPLOY_CONFIG_KEY];
    if (!raw) return undefined;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined;
  } catch (err: unknown) {
    const status = k8sApiHttpCode(err);
    if (status === 403 || status === 404) {
      return undefined;
    }
    throw err;
  }
}

export async function applyInstallerConfigMap(
  ns: string,
  config: DeployConfig,
  log: LogCallback,
): Promise<void> {
  const core = coreApi();
  const savedConfig = installerSavedDeployConfig(ns, config);
  const body: k8s.V1ConfigMap = {
    apiVersion: "v1",
    kind: "ConfigMap",
    metadata: {
      name: INSTALLER_CONFIG_MAP_NAME,
      namespace: ns,
      labels: {
        app: "openclaw",
        "app.kubernetes.io/managed-by": "openclaw-installer",
      },
    },
    data: {
      [INSTALLER_DEPLOY_CONFIG_KEY]: JSON.stringify(savedConfig, null, 2),
    },
  };

  try {
    await core.readNamespacedConfigMap({ name: INSTALLER_CONFIG_MAP_NAME, namespace: ns });
    await core.replaceNamespacedConfigMap({ name: INSTALLER_CONFIG_MAP_NAME, namespace: ns, body });
  } catch (err: unknown) {
    if (k8sApiHttpCode(err) !== 404) {
      throw err;
    }
    await core.createNamespacedConfigMap({ namespace: ns, body });
  }
  log(`Deploy config saved to ConfigMap ${INSTALLER_CONFIG_MAP_NAME}`);
}
