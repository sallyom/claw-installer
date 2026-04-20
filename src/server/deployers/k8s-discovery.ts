import * as k8s from "@kubernetes/client-node";
import { readdir, writeFile, unlink, access } from "node:fs/promises";
import { join } from "node:path";
import { coreApi, appsApi } from "../services/k8s.js";
import { installerDataDir } from "../paths.js";
import { debugPerf } from "../debug.js";

export interface K8sPodInfo {
  name: string;
  phase: string;          // Pending, Running, Succeeded, Failed, Unknown
  ready: boolean;
  restarts: number;
  containerStatus: string; // e.g. "Running", "ContainerCreating", "CrashLoopBackOff", "ImagePullBackOff"
  message: string;         // reason or message from waiting/terminated state
}

export interface K8sInstance {
  namespace: string;
  status: "running" | "stopped" | "deploying" | "error" | "unknown";
  prefix: string;
  agentName: string;
  image: string;
  url: string;
  replicas: number;
  readyReplicas: number;
  pods: K8sPodInfo[];
  statusDetail: string;   // human-readable progress line
}

export interface DiscoverK8sInstancesOptions {
  namespaces?: string[];
}

function staleMarkerPath(namespace: string): string {
  return join(installerDataDir(), "k8s", namespace, "stale.json");
}

async function isStale(namespace: string): Promise<boolean> {
  try {
    await access(staleMarkerPath(namespace));
    return true;
  } catch {
    return false;
  }
}

async function markStale(namespace: string): Promise<void> {
  try {
    await writeFile(staleMarkerPath(namespace), JSON.stringify({ markedAt: new Date().toISOString() }));
  } catch {
    // Directory may not exist — ignore
  }
}

export async function clearStaleMarker(namespace: string): Promise<void> {
  try {
    await unlink(staleMarkerPath(namespace));
  } catch {
    // No marker to remove
  }
}

async function loadSavedNamespaces(): Promise<string[]> {
  try {
    const k8sDir = join(installerDataDir(), "k8s");
    const entries = await readdir(k8sDir, { withFileTypes: true });
    const dirs = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    const results: string[] = [];
    for (const name of dirs) {
      if (!(await isStale(name))) {
        results.push(name);
      }
    }
    return results;
  } catch {
    return [];
  }
}

export function derivePodInfo(pod: k8s.V1Pod): K8sPodInfo {
  const cs = pod.status?.containerStatuses?.[0];
  let containerStatus = "Unknown";
  let message = "";

  if (cs) {
    if (cs.state?.running) {
      containerStatus = "Running";
    } else if (cs.state?.waiting) {
      containerStatus = cs.state.waiting.reason || "Waiting";
      message = cs.state.waiting.message || "";
    } else if (cs.state?.terminated) {
      containerStatus = cs.state.terminated.reason || "Terminated";
      message = cs.state.terminated.message || "";
    }
  } else {
    // No container status yet — check init containers
    const initCs = pod.status?.initContainerStatuses?.[0];
    if (initCs?.state?.running) {
      containerStatus = "InitRunning";
      message = `Init container: ${initCs.name}`;
    } else if (initCs?.state?.waiting) {
      containerStatus = initCs.state.waiting.reason || "InitWaiting";
      message = initCs.state.waiting.message || `Init container: ${initCs.name}`;
    } else if (initCs?.state?.terminated && initCs.state.terminated.exitCode !== 0) {
      containerStatus = "InitError";
      message = initCs.state.terminated.message || `Init container failed: ${initCs.name}`;
    }
  }

  return {
    name: pod.metadata?.name || "",
    phase: pod.status?.phase || "Unknown",
    ready: cs?.ready ?? false,
    restarts: cs?.restartCount ?? 0,
    containerStatus,
    message,
  };
}

export function deriveInstanceStatus(
  replicas: number,
  readyReplicas: number,
  pods: K8sPodInfo[],
): { status: K8sInstance["status"]; statusDetail: string } {
  if (replicas === 0) {
    return { status: "stopped", statusDetail: "Scaled to 0" };
  }

  if (pods.length === 0) {
    return { status: "deploying", statusDetail: "Waiting for pod..." };
  }

  const pod = pods[0];

  if (pod.ready && pod.containerStatus === "Running") {
    return { status: "running", statusDetail: `Ready (${readyReplicas}/${replicas})` };
  }

  // Error states
  const errorStates = ["CrashLoopBackOff", "ImagePullBackOff", "ErrImagePull", "InitError", "RunContainerError"];
  if (errorStates.includes(pod.containerStatus)) {
    const detail = pod.message
      ? `${pod.containerStatus}: ${pod.message}`
      : pod.containerStatus;
    return { status: "error", statusDetail: detail };
  }

  // In-progress states
  const progressMap: Record<string, string> = {
    ContainerCreating: "Creating container...",
    PodInitializing: "Initializing...",
    InitRunning: pod.message || "Running init container...",
    InitWaiting: pod.message || "Waiting for init container...",
    Pending: "Pending scheduling...",
    Waiting: "Waiting...",
  };

  const detail = progressMap[pod.containerStatus]
    || progressMap[pod.phase]
    || `${pod.phase} / ${pod.containerStatus}`;

  return { status: "deploying", statusDetail: detail };
}

async function probeNamespace(
  nsName: string,
  apps: ReturnType<typeof appsApi>,
  core: ReturnType<typeof coreApi>,
): Promise<K8sInstance | null> {
  const tNs = performance.now();
  try {
    const dep = await apps.readNamespacedDeployment({ name: "openclaw", namespace: nsName });
    debugPerf(`[perf]         discover: readDeployment(${nsName}): ${(performance.now() - tNs).toFixed(0)}ms`);
    const labels = dep.metadata?.labels || {};
    const replicas = dep.spec?.replicas ?? 1;
    const readyReplicas = dep.status?.readyReplicas ?? 0;
    const image = dep.spec?.template?.spec?.containers?.[0]?.image || "";

    const tPods = performance.now();
    const podList = await core.listNamespacedPod({
      namespace: nsName,
      labelSelector: "app=openclaw",
    });
    debugPerf(`[perf]         discover: listPods(${nsName}): ${(performance.now() - tPods).toFixed(0)}ms`);
    const pods = podList.items.map(derivePodInfo);

    const { status, statusDetail } = deriveInstanceStatus(replicas, readyReplicas, pods);

    await clearStaleMarker(nsName);

    return {
      namespace: nsName,
      status,
      prefix: labels["openclaw.prefix"] || nsName.replace(/-openclaw$/, ""),
      agentName: labels["openclaw.agent"] || "agent",
      image,
      url: "",
      replicas,
      readyReplicas,
      pods,
      statusDetail,
    };
  } catch {
    debugPerf(`[perf]         discover: namespace ${nsName}: ${(performance.now() - tNs).toFixed(0)}ms (failed — marking stale)`);
    await markStale(nsName);
    return null;
  }
}

export async function discoverK8sInstances(options: DiscoverK8sInstancesOptions = {}): Promise<K8sInstance[]> {
  const t0 = performance.now();
  try {
    const core = coreApi();
    const apps = appsApi();
    const namespaces = new Set((options.namespaces || []).filter(Boolean));

    const tSaved = performance.now();
    for (const nsName of await loadSavedNamespaces()) {
      namespaces.add(nsName);
    }
    debugPerf(`[perf]         discover: loadSavedNamespaces: ${(performance.now() - tSaved).toFixed(0)}ms, ${namespaces.size} saved`);

    const tListNs = performance.now();
    try {
      const nsList = await core.listNamespace({
        labelSelector: "app.kubernetes.io/managed-by=openclaw-installer",
      });
      for (const ns of nsList.items) {
        const nsName = ns.metadata?.name || "";
        if (nsName && ns.status?.phase !== "Terminating") {
          namespaces.add(nsName);
        }
      }
      debugPerf(`[perf]         discover: listNamespace: ${(performance.now() - tListNs).toFixed(0)}ms, ${namespaces.size} total namespaces`);
    } catch {
      debugPerf(`[perf]         discover: listNamespace: ${(performance.now() - tListNs).toFixed(0)}ms (failed/forbidden)`);
    }

    const probes = [...namespaces].map((nsName) => probeNamespace(nsName, apps, core));
    const settled = await Promise.all(probes);
    const results = settled.filter((r): r is K8sInstance => r !== null);

    debugPerf(`[perf]         discover total: ${(performance.now() - t0).toFixed(0)}ms, ${results.length} instances`);
    return results;
  } catch {
    debugPerf(`[perf]         discover total: ${(performance.now() - t0).toFixed(0)}ms (cluster unreachable)`);
    return [];
  }
}
