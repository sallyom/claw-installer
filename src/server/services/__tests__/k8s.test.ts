import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetCode, mockCreateSelfSubjectRulesReview } = vi.hoisted(() => ({
  mockGetCode: vi.fn(),
  mockCreateSelfSubjectRulesReview: vi.fn(),
}));

vi.mock("@kubernetes/client-node", () => {
  class KubeConfig {
    loadFromDefault(): void {}

    makeApiClient(client: unknown): unknown {
      if (client === VersionApi) {
        return { getCode: mockGetCode };
      }
      if (client === AuthorizationV1Api) {
        return { createSelfSubjectRulesReview: mockCreateSelfSubjectRulesReview };
      }
      return {};
    }
  }

  class VersionApi {}
  class AuthorizationV1Api {}
  class ApisApi {}
  class CoreV1Api {}
  class AppsV1Api {}
  class ApiextensionsV1Api {}

  return { KubeConfig, VersionApi, AuthorizationV1Api, ApisApi, CoreV1Api, AppsV1Api, ApiextensionsV1Api };
});

describe("isClusterReachable", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("../k8s.js");
    mod.resetKubeConfig();
  });

  it("returns true when both version probe and auth check succeed", async () => {
    mockGetCode.mockResolvedValue({ gitVersion: "v1.30.0" });
    mockCreateSelfSubjectRulesReview.mockResolvedValue({ status: {} });

    const mod = await import("../k8s.js");
    await expect(mod.isClusterReachable()).resolves.toBe(true);
    expect(mockGetCode).toHaveBeenCalledTimes(1);
    expect(mockCreateSelfSubjectRulesReview).toHaveBeenCalledTimes(1);
  });

  it("returns false when the version probe fails (no cluster)", async () => {
    mockGetCode.mockRejectedValue(new Error("ECONNREFUSED"));

    const mod = await import("../k8s.js");
    await expect(mod.isClusterReachable()).resolves.toBe(false);
    expect(mockCreateSelfSubjectRulesReview).not.toHaveBeenCalled();
  });

  it("returns false when version succeeds but auth check fails (logged out)", async () => {
    mockGetCode.mockResolvedValue({ gitVersion: "v1.30.0" });
    mockCreateSelfSubjectRulesReview.mockRejectedValue(
      Object.assign(new Error("Unauthorized"), { code: 401 }),
    );

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
