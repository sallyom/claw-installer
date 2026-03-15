import * as k8s from "@kubernetes/client-node";

let _kc: k8s.KubeConfig | null = null;

/**
 * Load kubeconfig from default locations (~/.kube/config or in-cluster SA).
 * Cached after first call.
 */
export function loadKubeConfig(): k8s.KubeConfig {
  if (_kc) return _kc;
  const kc = new k8s.KubeConfig();
  kc.loadFromDefault();
  _kc = kc;
  return kc;
}

/** Reset cached config (useful if context changes). */
export function resetKubeConfig(): void {
  _kc = null;
}

export function coreApi(): k8s.CoreV1Api {
  return loadKubeConfig().makeApiClient(k8s.CoreV1Api);
}

export function appsApi(): k8s.AppsV1Api {
  return loadKubeConfig().makeApiClient(k8s.AppsV1Api);
}

/**
 * Check whether the cluster has the route.openshift.io API group,
 * indicating it's an OpenShift cluster.
 */
export async function isOpenShift(): Promise<boolean> {
  try {
    const client = loadKubeConfig().makeApiClient(k8s.ApisApi);
    const result = await client.getAPIVersions();
    const groups = result.groups || [];
    return groups.some((g: k8s.V1APIGroup) => g.name === "route.openshift.io");
  } catch {
    return false;
  }
}

/**
 * Check if we can connect to a K8s cluster at all.
 */
export async function isClusterReachable(): Promise<boolean> {
  try {
    const api = coreApi();
    await api.listNamespace();
    return true;
  } catch {
    return false;
  }
}

/**
 * Check whether the OpenTelemetry Operator CRD is installed on the cluster.
 */
export async function hasOtelOperator(): Promise<boolean> {
  try {
    const client = loadKubeConfig().makeApiClient(k8s.ApiextensionsV1Api);
    await client.readCustomResourceDefinition({ name: "opentelemetrycollectors.opentelemetry.io" });
    return true;
  } catch {
    return false;
  }
}

export function currentContext(): string {
  try {
    const kc = loadKubeConfig();
    return kc.getCurrentContext();
  } catch {
    return "";
  }
}
