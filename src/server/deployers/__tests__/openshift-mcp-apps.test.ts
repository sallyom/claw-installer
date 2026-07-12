import { describe, expect, it } from "vitest";
import { mcpAppsSandboxProxyContainer } from "../../../../provider-plugins/openshift/src/oauth-proxy.js";
import { mcpAppsRouteManifest } from "../../../../provider-plugins/openshift/src/route.js";

describe("OpenShift MCP Apps proxy", () => {
  it("exposes only the sandbox path through the dedicated proxy port", () => {
    const container = mcpAppsSandboxProxyContainer("openclaw:test");
    const script = container.command?.at(-1) ?? "";

    expect(container.ports).toEqual([
      expect.objectContaining({ name: "mcp-apps-proxy", containerPort: 18792 }),
    ]);
    expect(script).toContain("http://127.0.0.1:18790");
    expect(script).toContain("url.pathname!=='/mcp-app-sandbox'");
  });

  it("uses a separate edge route limited to the sandbox path", () => {
    expect(mcpAppsRouteManifest("demo")).toMatchObject({
      metadata: { name: "openclaw-mcp-apps", namespace: "demo" },
      spec: {
        path: "/mcp-app-sandbox",
        port: { targetPort: "mcp-apps" },
        tls: { termination: "edge" },
      },
    });
  });
});
