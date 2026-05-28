import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetCode, mockCreateSelfSubjectRulesReview, mockLoadFromOptions } = vi.hoisted(() => ({
  mockGetCode: vi.fn(),
  mockCreateSelfSubjectRulesReview: vi.fn(),
  mockLoadFromOptions: vi.fn(),
}));

vi.mock("@kubernetes/client-node", () => {
  class KubeConfig {
    clusters: unknown[] = [{ name: "test-cluster", server: "https://api.example.test", skipTLSVerify: false }];
    users: unknown[] = [];
    contexts: unknown[] = [];
    currentContext = "default";

    loadFromDefault(): void {}
    loadFromOptions(options: unknown): void {
      mockLoadFromOptions(options);
      this.clusters = (options as { clusters: [] }).clusters;
      this.users = (options as { users: [] }).users;
      this.contexts = (options as { contexts: [] }).contexts;
      this.currentContext = (options as { currentContext: string }).currentContext;
    }
    getCurrentCluster(): unknown {
      return this.clusters[0];
    }
    getCurrentContext(): string {
      return this.currentContext;
    }
    getContextObject(name: string): unknown {
      return this.contexts.find((ctx) => (ctx as { name: string }).name === name) || null;
    }

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

describe("loadKubeConfig", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("../k8s.js");
    mod.resetKubeConfig();
  });

  it("uses the hosted request token when request context provides one", async () => {
    const { runWithRequestContext } = await import("../../request-context.js");
    const mod = await import("../k8s.js");

    runWithRequestContext({
      hostedUser: {
        username: "sallyom",
        token: "user-token",
        groups: ["openclaw-pilot-users"],
      },
    }, () => {
      mod.loadKubeConfig();
    });

    expect(mockLoadFromOptions).toHaveBeenCalledWith({
      clusters: [{ name: "test-cluster", server: "https://api.example.test", skipTLSVerify: false }],
      users: [{ name: "hosted:sallyom", token: "user-token" }],
      contexts: [{ name: "hosted-user", cluster: "test-cluster", user: "hosted:sallyom" }],
      currentContext: "hosted-user",
    });
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
