import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetCode } = vi.hoisted(() => ({
  mockGetCode: vi.fn(),
}));

vi.mock("@kubernetes/client-node", () => {
  class KubeConfig {
    loadFromDefault(): void {}

    makeApiClient(client: unknown): unknown {
      if (client === VersionApi) {
        return { getCode: mockGetCode };
      }
      return {};
    }
  }

  class VersionApi {}
  class ApisApi {}
  class CoreV1Api {}
  class AppsV1Api {}
  class ApiextensionsV1Api {}

  return { KubeConfig, VersionApi, ApisApi, CoreV1Api, AppsV1Api, ApiextensionsV1Api };
});

describe("isClusterReachable", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("../k8s.js");
    mod.resetKubeConfig();
  });

  it("returns true when the apiserver responds to a version probe", async () => {
    mockGetCode.mockResolvedValue({ gitVersion: "v1.30.0" });

    const mod = await import("../k8s.js");
    await expect(mod.isClusterReachable()).resolves.toBe(true);
    expect(mockGetCode).toHaveBeenCalledTimes(1);
  });

  it("returns false when the version probe fails", async () => {
    mockGetCode.mockRejectedValue(new Error("forbidden"));

    const mod = await import("../k8s.js");
    await expect(mod.isClusterReachable()).resolves.toBe(false);
  });
});

describe("k8sApiHttpCode", () => {
  it("returns HTTP status from client-node ApiException-shaped errors", async () => {
    const mod = await import("../k8s.js");
    expect(mod.k8sApiHttpCode({ code: 403, message: "Forbidden" })).toBe(403);
    expect(mod.k8sApiHttpCode({ code: 404 })).toBe(404);
    expect(mod.k8sApiHttpCode(new Error("wrapped", { cause: { code: 403 } }))).toBe(403);
    expect(mod.k8sApiHttpCode(new Error("nope"))).toBeUndefined();
    expect(mod.k8sApiHttpCode(null)).toBeUndefined();
  });
});
