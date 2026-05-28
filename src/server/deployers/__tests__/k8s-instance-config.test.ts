import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockReadNamespacedConfigMap,
  mockCreateNamespacedConfigMap,
  mockReplaceNamespacedConfigMap,
} = vi.hoisted(() => ({
  mockReadNamespacedConfigMap: vi.fn(),
  mockCreateNamespacedConfigMap: vi.fn(),
  mockReplaceNamespacedConfigMap: vi.fn(),
}));

vi.mock("../../services/k8s.js", () => ({
  coreApi: () => ({
    readNamespacedConfigMap: mockReadNamespacedConfigMap,
    createNamespacedConfigMap: mockCreateNamespacedConfigMap,
    replaceNamespacedConfigMap: mockReplaceNamespacedConfigMap,
  }),
  k8sApiHttpCode: (err: unknown) => (err as { code?: number }).code,
}));

describe("installer cluster deploy config", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("saves sanitized deploy config in a namespace ConfigMap", async () => {
    mockReadNamespacedConfigMap.mockRejectedValue({ code: 404 });
    const { applyInstallerConfigMap, INSTALLER_DEPLOY_CONFIG_KEY } = await import("../k8s-instance-config.js");

    await applyInstallerConfigMap("sallyom-shifty-openclaw", {
      mode: "openshift",
      prefix: "sallyom",
      agentName: "shifty",
      agentDisplayName: "Shifty",
      namespace: "sallyom-shifty-openclaw",
      image: "quay.io/sallyom/openclaw:test",
      providerSecretName: "openclaw-provider-secrets",
      inferenceProvider: "vertex-anthropic",
      gcpServiceAccountJson: "{\"private_key\":\"secret\"}",
      googleCloudProject: "example-project",
    }, vi.fn());

    const body = mockCreateNamespacedConfigMap.mock.calls[0][0].body;
    const saved = JSON.parse(body.data[INSTALLER_DEPLOY_CONFIG_KEY]);
    expect(saved).toMatchObject({
      mode: "openshift",
      prefix: "sallyom",
      agentName: "shifty",
      namespace: "sallyom-shifty-openclaw",
      image: "quay.io/sallyom/openclaw:test",
      providerSecretName: "openclaw-provider-secrets",
      googleCloudProject: "example-project",
    });
    expect(saved.gcpServiceAccountJson).toBeUndefined();
  });

  it("reads saved deploy config from the namespace ConfigMap", async () => {
    mockReadNamespacedConfigMap.mockResolvedValue({
      data: {
        "deploy-config.json": JSON.stringify({
          mode: "openshift",
          agentName: "shifty",
        }),
      },
    });
    const { readInstallerSavedDeployConfig } = await import("../k8s-instance-config.js");

    await expect(readInstallerSavedDeployConfig("sallyom-shifty-openclaw")).resolves.toEqual({
      mode: "openshift",
      agentName: "shifty",
    });
  });
});
