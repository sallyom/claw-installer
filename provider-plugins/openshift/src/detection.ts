import * as k8s from "@kubernetes/client-node";
import { loadKubeConfig } from "../../../src/server/services/k8s.js";

const K8S_PROBE_TIMEOUT_MS = 2000;

async function withTimeout<T>(promise: Promise<T>, timeoutMs = K8S_PROBE_TIMEOUT_MS): Promise<T> {
  return await Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(`Timed out after ${timeoutMs}ms`)), timeoutMs);
    }),
  ]);
}

/**
 * Check whether the cluster has the route.openshift.io API group,
 * indicating it's an OpenShift cluster.
 */
export async function isOpenShift(): Promise<boolean> {
  try {
    const client = loadKubeConfig().makeApiClient(k8s.ApisApi);
    const result = await withTimeout(client.getAPIVersions());
    const groups = result.groups || [];
    return groups.some((g: k8s.V1APIGroup) => g.name === "route.openshift.io");
  } catch {
    return false;
  }
}
