import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockReadDir,
  mockListNamespace,
  mockListClusterCustomObject,
  mockListNamespacedPod,
  mockReadNamespacedDeployment,
} = vi.hoisted(() => ({
  mockReadDir: vi.fn(),
  mockListNamespace: vi.fn(),
  mockListClusterCustomObject: vi.fn(),
  mockListNamespacedPod: vi.fn(),
  mockReadNamespacedDeployment: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
  readdir: mockReadDir,
}));

vi.mock("../../services/k8s.js", () => ({
  coreApi: () => ({
    listNamespace: mockListNamespace,
    listNamespacedPod: mockListNamespacedPod,
  }),
  appsApi: () => ({
    readNamespacedDeployment: mockReadNamespacedDeployment,
  }),
  loadKubeConfig: () => ({
    makeApiClient: () => ({
      listClusterCustomObject: mockListClusterCustomObject,
    }),
  }),
}));

vi.mock("../../paths.js", () => ({
  installerDataDir: () => "/tmp/openclaw-installer",
}));

describe("discoverK8sInstances", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListClusterCustomObject.mockRejectedValue(new Error("not openshift"));
  });

  it("discovers saved namespaces even when cluster-wide namespace listing is forbidden", async () => {
    mockReadDir.mockResolvedValue([
      { isDirectory: () => true, name: "user1-agent-openclaw" },
    ]);
    mockListNamespace.mockRejectedValue(new Error("forbidden"));
    mockReadNamespacedDeployment.mockResolvedValue({
      metadata: {
        labels: {
          "openclaw.prefix": "user1",
          "openclaw.agent": "agent",
        },
      },
      spec: {
        replicas: 1,
        template: {
          spec: {
            containers: [{ image: "quay.io/aicatalyst/openclaw:test" }],
          },
        },
      },
      status: {
        readyReplicas: 1,
      },
    });
    mockListNamespacedPod.mockResolvedValue({
      items: [{
        metadata: { name: "openclaw-abc123" },
        status: {
          phase: "Running",
          containerStatuses: [{
            ready: true,
            restartCount: 0,
            state: { running: {} },
          }],
        },
      }],
    });

    const { discoverK8sInstances } = await import("../k8s-discovery.js");
    await expect(discoverK8sInstances()).resolves.toEqual([
      expect.objectContaining({
        namespace: "user1-agent-openclaw",
        prefix: "user1",
        agentName: "agent",
        image: "quay.io/aicatalyst/openclaw:test",
        status: "running",
        statusDetail: "Ready (1/1)",
      }),
    ]);
  });

  it("skips stale saved namespaces that no longer contain an OpenClaw deployment", async () => {
    mockReadDir.mockResolvedValue([
      { isDirectory: () => true, name: "stale-agent-openclaw" },
    ]);
    mockListNamespace.mockRejectedValue(new Error("forbidden"));
    mockReadNamespacedDeployment.mockRejectedValue(new Error("not found"));

    const { discoverK8sInstances } = await import("../k8s-discovery.js");
    await expect(discoverK8sInstances()).resolves.toEqual([]);
  });

  it("discovers OpenShift projects visible to the current user", async () => {
    mockReadDir.mockRejectedValue(new Error("no saved state"));
    mockListNamespace.mockRejectedValue(new Error("forbidden"));
    mockListClusterCustomObject.mockResolvedValue({
      items: [
        { metadata: { name: "user1-agent-openclaw" }, status: { phase: "Active" } },
        { metadata: { name: "terminating-openclaw" }, status: { phase: "Terminating" } },
      ],
    });
    mockReadNamespacedDeployment.mockResolvedValue({
      metadata: {
        labels: {
          "openclaw.prefix": "user1",
          "openclaw.agent": "agent",
        },
      },
      spec: {
        replicas: 1,
        template: {
          spec: {
            containers: [{ image: "quay.io/aicatalyst/openclaw:test" }],
          },
        },
      },
      status: {
        readyReplicas: 1,
      },
    });
    mockListNamespacedPod.mockResolvedValue({
      items: [{
        metadata: { name: "openclaw-abc123" },
        status: {
          phase: "Running",
          containerStatuses: [{
            ready: true,
            restartCount: 0,
            state: { running: {} },
          }],
        },
      }],
    });

    const { discoverK8sInstances } = await import("../k8s-discovery.js");
    await expect(discoverK8sInstances()).resolves.toEqual([
      expect.objectContaining({
        namespace: "user1-agent-openclaw",
        status: "running",
      }),
    ]);
    expect(mockReadNamespacedDeployment).toHaveBeenCalledWith({
      name: "openclaw",
      namespace: "user1-agent-openclaw",
    });
  });

  it("uses the gateway container image when OpenShift oauth-proxy is first", async () => {
    mockReadDir.mockRejectedValue(new Error("no saved state"));
    mockListNamespace.mockRejectedValue(new Error("forbidden"));
    mockListClusterCustomObject.mockResolvedValue({
      items: [
        { metadata: { name: "user1-agent-openclaw" }, status: { phase: "Active" } },
      ],
    });
    mockReadNamespacedDeployment.mockResolvedValue({
      metadata: {
        labels: {
          "openclaw.prefix": "user1",
          "openclaw.agent": "agent",
        },
      },
      spec: {
        replicas: 1,
        template: {
          spec: {
            containers: [
              { name: "oauth-proxy", image: "quay.io/openshift/origin-oauth-proxy:4.14" },
              { name: "gateway", image: "quay.io/sallyom/openclaw:test" },
            ],
          },
        },
      },
      status: {
        readyReplicas: 1,
      },
    });
    mockListNamespacedPod.mockResolvedValue({
      items: [{
        metadata: { name: "openclaw-abc123" },
        status: {
          phase: "Running",
          containerStatuses: [{
            ready: true,
            restartCount: 0,
            state: { running: {} },
          }],
        },
      }],
    });

    const { discoverK8sInstances } = await import("../k8s-discovery.js");
    await expect(discoverK8sInstances()).resolves.toEqual([
      expect.objectContaining({
        image: "quay.io/sallyom/openclaw:test",
      }),
    ]);
  });
});
