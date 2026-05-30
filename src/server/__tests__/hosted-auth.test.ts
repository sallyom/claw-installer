import { afterEach, describe, expect, it, vi } from "vitest";
import { hostedRequestContextMiddleware, hostedUserFromRequest, hostedUserPrefix } from "../hosted-auth.js";
import { runWithRequestContext } from "../request-context.js";

function mockReq(headers: Record<string, string>): Parameters<typeof hostedUserFromRequest>[0] {
  return {
    get(name: string) {
      const key = Object.keys(headers).find((entry) => entry.toLowerCase() === name.toLowerCase());
      return key ? headers[key] : undefined;
    },
  } as Parameters<typeof hostedUserFromRequest>[0];
}

describe("hostedUserFromRequest", () => {
  it("reads OpenShift OAuth proxy user and access token headers", () => {
    const user = hostedUserFromRequest(mockReq({
      "X-Forwarded-User": "sallyom",
      "X-Forwarded-Access-Token": "token-123",
      "X-Forwarded-Groups": "openclaw-pilot-users, system:authenticated",
    }));

    expect(user).toEqual({
      username: "sallyom",
      token: "token-123",
      groups: ["openclaw-pilot-users", "system:authenticated"],
    });
  });

  it("falls back to bearer auth when proxy token header is unavailable", () => {
    const user = hostedUserFromRequest(mockReq({
      "X-Forwarded-User": "sallyom",
      Authorization: "Bearer token-456",
    }));

    expect(user?.token).toBe("token-456");
  });

  it("parses bearer auth without regex backtracking risk", () => {
    const user = hostedUserFromRequest(mockReq({
      "X-Forwarded-User": "sallyom",
      Authorization: `  bEaReR\t${"x".repeat(10_000)}  `,
    }));

    expect(user?.token).toBe("x".repeat(10_000));
    expect(hostedUserFromRequest(mockReq({
      "X-Forwarded-User": "sallyom",
      Authorization: "Bearer",
    }))).toBeNull();
    expect(hostedUserFromRequest(mockReq({
      "X-Forwarded-User": "sallyom",
      Authorization: "BearerToken",
    }))).toBeNull();
  });

  it("requires both user and token", () => {
    expect(hostedUserFromRequest(mockReq({ "X-Forwarded-User": "sallyom" }))).toBeNull();
    expect(hostedUserFromRequest(mockReq({ "X-Forwarded-Access-Token": "token-123" }))).toBeNull();
  });
});

describe("hostedUserPrefix", () => {
  it("sanitizes the hosted username for project prefixes", () => {
    const prefix = runWithRequestContext({
      hostedUser: {
        username: "Sally.O'Malley@example.com",
        token: "token",
        groups: [],
      },
    }, hostedUserPrefix);

    expect(prefix).toBe("sally-o-malley-example-com");
  });
});

describe("hostedRequestContextMiddleware", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("allows unauthenticated health probes in hosted mode", () => {
    vi.stubEnv("OPENCLAW_INSTALLER_RUN_MODE", "hosted");
    const next = vi.fn();
    const res = { status: vi.fn(), json: vi.fn() };

    hostedRequestContextMiddleware(
      { method: "GET", path: "/health", get: () => undefined } as Parameters<typeof hostedRequestContextMiddleware>[0],
      res as unknown as Parameters<typeof hostedRequestContextMiddleware>[1],
      next,
    );

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });
});
