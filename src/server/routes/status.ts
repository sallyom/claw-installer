import { Router } from "express";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import {
  discoverContainers,
  discoverVolumes,
  detectRuntime,
  type DiscoveredContainer,
} from "../services/container.js";
import { LocalDeployer } from "../deployers/local.js";
import { KubernetesDeployer, discoverK8sInstances } from "../deployers/kubernetes.js";
import { isClusterReachable } from "../services/k8s.js";
import { createLogCallback, sendStatus } from "../ws.js";
import type { DeployResult } from "../deployers/types.js";

const router = Router();
const localDeployer = new LocalDeployer();
const k8sDeployer = new KubernetesDeployer();

function containerToInstance(c: DiscoveredContainer): DeployResult {
  const prefix = c.labels["openclaw.prefix"] || "";
  const agent = c.labels["openclaw.agent"] || "";

  let port = 18789;
  const portMatch = String(c.ports).match(/(\d+)->18789/);
  if (portMatch) port = parseInt(portMatch[1], 10);

  return {
    id: c.name,
    mode: "local",
    status: c.status,
    config: {
      mode: "local",
      prefix: prefix || c.name.replace(/^openclaw-/, "").replace(/-[^-]+$/, ""),
      agentName: agent || c.name.split("-").pop() || c.name,
      agentDisplayName: agent
        ? agent.charAt(0).toUpperCase() + agent.slice(1)
        : c.name,
    },
    startedAt: c.createdAt,
    url: c.status === "running" ? `http://localhost:${port}` : undefined,
    containerId: c.name,
  };
}

// List all instances: running containers + stopped volumes (no container due to --rm) + K8s
router.get("/", async (_req, res) => {
  const instances: DeployResult[] = [];

  // Local instances
  const runtime = await detectRuntime();
  if (runtime) {
    const containers = await discoverContainers(runtime);
    const volumes = await discoverVolumes(runtime);
    instances.push(...containers.map(containerToInstance));

    const runningContainerNames = new Set(instances.map((i) => i.containerId));

    for (const vol of volumes) {
      if (runningContainerNames.has(vol.containerName)) continue;

      const savedVars = await readSavedConfig(vol.containerName);
      const agentName = savedVars.OPENCLAW_AGENT_NAME || vol.containerName;
      const displayName = savedVars.OPENCLAW_DISPLAY_NAME || agentName;
      const prefix = savedVars.OPENCLAW_PREFIX || vol.containerName.replace(/^openclaw-/, "");

      instances.push({
        id: vol.containerName,
        mode: "local",
        status: "stopped",
        config: {
          mode: "local",
          prefix,
          agentName,
          agentDisplayName: displayName.charAt(0).toUpperCase() + displayName.slice(1),
          image: savedVars.OPENCLAW_IMAGE || undefined,
          port: savedVars.OPENCLAW_PORT ? parseInt(savedVars.OPENCLAW_PORT, 10) : undefined,
          anthropicApiKey: savedVars.ANTHROPIC_API_KEY || undefined,
          openaiApiKey: savedVars.OPENAI_API_KEY || undefined,
          telegramBotToken: savedVars.TELEGRAM_BOT_TOKEN || undefined,
          telegramAllowFrom: savedVars.TELEGRAM_ALLOW_FROM || undefined,
        },
        startedAt: "",
        containerId: vol.containerName,
      });
    }
  }

  // K8s instances
  if (await isClusterReachable()) {
    const k8sInstances = await discoverK8sInstances();
    for (const ki of k8sInstances) {
      instances.push({
        id: ki.namespace,
        mode: "kubernetes",
        status: ki.status,
        config: {
          mode: "kubernetes",
          prefix: ki.prefix,
          agentName: ki.agentName,
          agentDisplayName: ki.agentName
            ? ki.agentName.charAt(0).toUpperCase() + ki.agentName.slice(1)
            : ki.namespace,
          namespace: ki.namespace,
          image: ki.image,
        },
        startedAt: "",
        url: ki.url || undefined,
        containerId: ki.namespace,
        statusDetail: ki.statusDetail,
        pods: ki.pods,
      });
    }
  }

  res.json(instances);
});

// Get single instance by container name
router.get("/:id", async (req, res) => {
  const runtime = await detectRuntime();
  if (!runtime) {
    res.status(404).json({ error: "No container runtime" });
    return;
  }

  const containers = await discoverContainers(runtime);
  const c = containers.find((c) => c.name === req.params.id);
  if (!c) {
    // Check if there's a volume for it (stopped instance)
    const instance = await findInstance(req.params.id);
    if (instance) {
      res.json(instance);
      return;
    }
    res.status(404).json({ error: "Instance not found" });
    return;
  }

  res.json(containerToInstance(c));
});

// Start instance (re-creates container with --rm, volume has the state)
router.post("/:id/start", async (req, res) => {
  const instance = await findInstance(req.params.id);
  if (!instance) {
    res.status(404).json({ error: "Instance not found" });
    return;
  }

  const deployer = instance.mode === "kubernetes" ? k8sDeployer : localDeployer;
  const log = createLogCallback(instance.id);
  try {
    await deployer.start(instance, log);
    sendStatus(instance.id, "running");
    res.json({ status: "running" });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log(`ERROR: ${message}`);
    res.status(500).json({ error: message });
  }
});

// Stop instance (--rm auto-removes container, volume stays)
router.post("/:id/stop", async (req, res) => {
  const instance = await findInstance(req.params.id);
  if (!instance) {
    res.status(404).json({ error: "Instance not found" });
    return;
  }

  const deployer = instance.mode === "kubernetes" ? k8sDeployer : localDeployer;
  const log = createLogCallback(instance.id);
  await deployer.stop(instance, log);
  sendStatus(instance.id, "stopped");
  res.json({ status: "stopped" });
});

// Get gateway token from running container or K8s secret
router.get("/:id/token", async (req, res) => {
  // Check if this is a K8s instance
  const instance = await findInstance(req.params.id);
  if (instance?.mode === "kubernetes") {
    try {
      const core = (await import("../services/k8s.js")).coreApi();
      const ns = instance.config.namespace || instance.containerId || "";
      const secret = await core.readNamespacedSecret({ name: "openclaw-secrets", namespace: ns });
      const tokenB64 = secret.data?.["OPENCLAW_GATEWAY_TOKEN"] || "";
      const token = Buffer.from(tokenB64, "base64").toString("utf8");
      if (token) {
        res.json({ token });
      } else {
        res.status(404).json({ error: "No token found in secret" });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
    return;
  }

  const runtime = await detectRuntime();
  if (!runtime) {
    res.status(500).json({ error: "No container runtime" });
    return;
  }

  const containers = await discoverContainers(runtime);
  const c = containers.find((c) => c.name === req.params.id);
  if (!c || c.status !== "running") {
    res.status(400).json({ error: "Instance must be running to read token" });
    return;
  }

  try {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execFileAsync = promisify(execFile);
    const { stdout } = await execFileAsync(runtime, [
      "exec",
      req.params.id,
      "node",
      "-e",
      "const c=JSON.parse(require('fs').readFileSync('/home/node/.openclaw/openclaw.json','utf8'));console.log(c.gateway?.auth?.token||'')",
    ]);
    const token = stdout.trim();
    if (token) {
      res.json({ token });
    } else {
      res.status(404).json({ error: "No token found in config" });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// Get the run command (podman/docker for local, kubectl for K8s)
router.get("/:id/command", async (req, res) => {
  const instance = await findInstance(req.params.id);

  // K8s instance — return useful kubectl commands
  if (instance?.mode === "kubernetes") {
    const ns = instance.config.namespace || instance.containerId || "";
    const lines = [
      `# Port-forward to access the gateway locally`,
      `kubectl port-forward svc/openclaw 18789:18789 -n ${ns}`,
      ``,
      `# View pod status`,
      `kubectl get pods -n ${ns}`,
      ``,
      `# View gateway logs`,
      `kubectl logs deployment/openclaw -n ${ns} -c gateway -f`,
      ``,
      `# View init container logs`,
      `kubectl logs deployment/openclaw -n ${ns} -c init-config`,
      ``,
      `# Get gateway token`,
      `kubectl get secret openclaw-secrets -n ${ns} -o jsonpath='{.data.OPENCLAW_GATEWAY_TOKEN}' | base64 -d`,
      ``,
      `# Scale deployment`,
      `kubectl scale deployment/openclaw --replicas=0 -n ${ns}  # stop`,
      `kubectl scale deployment/openclaw --replicas=1 -n ${ns}  # start`,
      ``,
      `# Delete everything`,
      `kubectl delete namespace ${ns}`,
    ];
    res.json({ command: lines.join("\n") });
    return;
  }

  const runtime = await detectRuntime();
  if (!runtime) {
    res.status(500).json({ error: "No container runtime" });
    return;
  }

  const containers = await discoverContainers(runtime);
  const c = containers.find((c) => c.name === req.params.id);
  if (!c || c.status !== "running") {
    res.status(400).json({ error: "Instance must be running" });
    return;
  }

  try {
    const { execFile: ef } = await import("node:child_process");
    const { promisify: p } = await import("node:util");
    const exec = p(ef);

    const { stdout } = await exec(runtime, ["inspect", "--format", "json", req.params.id]);
    const info = JSON.parse(stdout)[0] || JSON.parse(stdout);
    const config = info.Config || {};
    const hostConfig = info.HostConfig || {};

    // Build the command string
    const parts = [runtime, "run", "-d", "--rm"];

    // Name
    parts.push("--name", req.params.id);

    // Network
    if (hostConfig.NetworkMode === "host") {
      parts.push("--network", "host");
    } else {
      // Port mappings
      const portBindings = hostConfig.PortBindings || {};
      for (const [containerPort, bindings] of Object.entries(portBindings)) {
        if (Array.isArray(bindings)) {
          for (const b of bindings as Array<{ HostPort?: string }>) {
            const hostPort = b.HostPort || "";
            const cp = containerPort.replace("/tcp", "");
            parts.push("-p", `${hostPort}:${cp}`);
          }
        }
      }
    }

    // Environment (filter out sensitive keys)
    const envList: string[] = config.Env || [];
    for (const e of envList) {
      // Skip default system env vars
      if (e.startsWith("PATH=") || e.startsWith("HOSTNAME=") || e.startsWith("container=")) continue;
      // Mask API keys
      if (e.includes("API_KEY=") || e.includes("TOKEN=")) {
        const [key] = e.split("=");
        parts.push("-e", `${key}=***`);
      } else {
        parts.push("-e", `"${e}"`);
      }
    }

    // Volumes
    const mounts = info.Mounts || [];
    for (const m of mounts) {
      if (m.Type === "volume") {
        parts.push("-v", `${m.Name}:${m.Destination}`);
      } else if (m.Type === "bind") {
        parts.push("-v", `${m.Source}:${m.Destination}`);
      }
    }

    // Labels (openclaw ones only)
    const labels: Record<string, string> = config.Labels || {};
    for (const [k, v] of Object.entries(labels)) {
      if (k.startsWith("openclaw.")) {
        parts.push("--label", `${k}=${v}`);
      }
    }

    // Image
    parts.push(config.Image || c.image);

    // Command (if not default)
    const cmd: string[] = config.Cmd || [];
    if (cmd.length > 0) {
      parts.push(...cmd);
    }

    res.json({ command: parts.join(" \\\n  ") });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// Get container/pod logs (last 50 lines)
router.get("/:id/logs", async (req, res) => {
  const instance = await findInstance(req.params.id);

  // K8s instance — read pod logs via K8s API
  if (instance?.mode === "kubernetes") {
    const ns = instance.config.namespace || instance.containerId || "";
    try {
      const core = (await import("../services/k8s.js")).coreApi();
      const podList = await core.listNamespacedPod({
        namespace: ns,
        labelSelector: "app=openclaw",
      });
      const pod = podList.items[0];
      if (!pod?.metadata?.name) {
        res.status(400).json({ error: "No pods found" });
        return;
      }
      const logs = await core.readNamespacedPodLog({
        name: pod.metadata.name,
        namespace: ns,
        container: "gateway",
        tailLines: 100,
      });
      res.json({ logs: typeof logs === "string" ? logs : String(logs) });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
    return;
  }

  const runtime = await detectRuntime();
  if (!runtime) {
    res.status(500).json({ error: "No container runtime" });
    return;
  }

  const containers = await discoverContainers(runtime);
  const c = containers.find((c) => c.name === req.params.id);
  if (!c || c.status !== "running") {
    res.status(400).json({ error: "Instance must be running to read logs" });
    return;
  }

  try {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execFileAsync = promisify(execFile);
    const { stdout, stderr } = await execFileAsync(runtime, [
      "logs", "--tail", "50", req.params.id,
    ]);
    res.json({ logs: (stdout + stderr).trim() });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// Delete data (remove volume or namespace — the nuclear option)
router.delete("/:id", async (req, res) => {
  const instance = await findInstance(req.params.id);
  if (!instance) {
    res.status(404).json({ error: "Instance not found" });
    return;
  }

  const deployer = instance.mode === "kubernetes" ? k8sDeployer : localDeployer;
  const log = createLogCallback(instance.id);
  await deployer.teardown(instance, log);
  res.json({ status: "deleted" });
});

/**
 * Read saved .env file from ~/.openclaw-installer/<dir>/.env
 * to reconstruct deploy config for stopped instances.
 */
async function readSavedConfig(containerName: string): Promise<Record<string, string>> {
  const vars: Record<string, string> = {};
  try {
    const envPath = join(homedir(), ".openclaw-installer", containerName, ".env");
    const content = await readFile(envPath, "utf8");
    for (const line of content.split("\n")) {
      if (line.startsWith("#") || !line.includes("=")) continue;
      const [key, ...rest] = line.split("=");
      vars[key.trim()] = rest.join("=").trim();
    }
  } catch {
    // no saved config
  }
  return vars;
}


// Helper: find instance by container name, volume, or K8s namespace
async function findInstance(name: string): Promise<DeployResult | null> {
  // Check local containers and volumes
  const runtime = await detectRuntime();
  if (runtime) {
    const containers = await discoverContainers(runtime);
    const c = containers.find((c) => c.name === name);
    if (c) return containerToInstance(c);

    const volumes = await discoverVolumes(runtime);
    const vol = volumes.find((v) => v.containerName === name);
    if (vol) {
      const savedVars = await readSavedConfig(name);
      const prefix = savedVars.OPENCLAW_PREFIX || name.replace(/^openclaw-/, "");
      const agentName = savedVars.OPENCLAW_AGENT_NAME || prefix;

      return {
        id: name,
        mode: "local",
        status: "stopped",
        config: {
          mode: "local",
          prefix,
          agentName,
          agentDisplayName: savedVars.OPENCLAW_DISPLAY_NAME || agentName,
          containerRuntime: runtime,
          image: savedVars.OPENCLAW_IMAGE || undefined,
          port: savedVars.OPENCLAW_PORT ? parseInt(savedVars.OPENCLAW_PORT, 10) : undefined,
          anthropicApiKey: savedVars.ANTHROPIC_API_KEY || undefined,
          openaiApiKey: savedVars.OPENAI_API_KEY || undefined,
          agentModel: savedVars.AGENT_MODEL || undefined,
          modelEndpoint: savedVars.MODEL_ENDPOINT || undefined,
          telegramBotToken: savedVars.TELEGRAM_BOT_TOKEN || undefined,
          telegramAllowFrom: savedVars.TELEGRAM_ALLOW_FROM || undefined,
        },
        startedAt: "",
        containerId: name,
      };
    }
  }

  // Check K8s namespaces
  if (await isClusterReachable()) {
    const k8sInstances = await discoverK8sInstances();
    const ki = k8sInstances.find((i) => i.namespace === name);
    if (ki) {
      return {
        id: ki.namespace,
        mode: "kubernetes",
        status: ki.status,
        config: {
          mode: "kubernetes",
          prefix: ki.prefix,
          agentName: ki.agentName,
          agentDisplayName: ki.agentName
            ? ki.agentName.charAt(0).toUpperCase() + ki.agentName.slice(1)
            : ki.namespace,
          namespace: ki.namespace,
          image: ki.image,
        },
        startedAt: "",
        url: ki.url || undefined,
        containerId: ki.namespace,
        statusDetail: ki.statusDetail,
        pods: ki.pods,
      };
    }
  }

  return null;
}

export default router;
