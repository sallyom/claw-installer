import * as k8s from "@kubernetes/client-node";
import { loadKubeConfig } from "../../../src/server/services/k8s.js";
import type { LogCallback } from "../../../src/server/deployers/types.js";

export async function applyRoute(ns: string, log: LogCallback, withOauth = false): Promise<void> {
  const kc = loadKubeConfig();
  const customApi = kc.makeApiClient(k8s.CustomObjectsApi);
  const routeParams = {
    group: "route.openshift.io",
    version: "v1",
    namespace: ns,
    plural: "routes",
    name: "openclaw",
  };

  try {
    await customApi.getNamespacedCustomObject(routeParams);
    log("Route openclaw already exists (skipping)");
    return;
  } catch {
    // does not exist — create it
  }

  const route = {
    apiVersion: "route.openshift.io/v1",
    kind: "Route",
    metadata: {
      name: "openclaw",
      namespace: ns,
      labels: { app: "openclaw" },
      annotations: {
        "haproxy.router.openshift.io/timeout": "30m",
      },
    },
    spec: {
      to: { kind: "Service", name: "openclaw", weight: 100 },
      port: { targetPort: withOauth ? "oauth-ui" : "gateway" },
      tls: { termination: "edge", insecureEdgeTerminationPolicy: "Redirect" },
    },
  };

  log("Creating Route...");
  await customApi.createNamespacedCustomObject({
    group: "route.openshift.io",
    version: "v1",
    namespace: ns,
    plural: "routes",
    body: route,
  });
  log("Route openclaw applied");
}

export async function getRouteUrl(ns: string): Promise<string> {
  try {
    const kc = loadKubeConfig();
    const customApi = kc.makeApiClient(k8s.CustomObjectsApi);
    const result = await customApi.getNamespacedCustomObject({
      group: "route.openshift.io",
      version: "v1",
      namespace: ns,
      plural: "routes",
      name: "openclaw",
    });
    const spec = (result as Record<string, unknown>).spec as Record<string, unknown> | undefined;
    const host = spec?.host as string | undefined;
    if (host) return `https://${host}`;
  } catch {
    // fall through
  }
  return "";
}

/**
 * Delete the Route (BUG FIX: claw-installer teardown did not delete Routes).
 */
export async function deleteRoute(ns: string, log: LogCallback): Promise<void> {
  try {
    const kc = loadKubeConfig();
    const customApi = kc.makeApiClient(k8s.CustomObjectsApi);
    await customApi.deleteNamespacedCustomObject({
      group: "route.openshift.io",
      version: "v1",
      namespace: ns,
      plural: "routes",
      name: "openclaw",
    });
    log("Deleted Route openclaw");
  } catch {
    // Route may not exist
  }
}
