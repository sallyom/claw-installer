import { describe, expect, it } from "vitest";
import {
  __testing as localTesting,
  buildOpenClawConfig,
  buildRunArgs,
} from "../local.js";

describe("local MCP Apps deployment", () => {
  it("writes the opt-in config and publishes the sandbox port", () => {
    const config = {
      mode: "local",
      agentName: "demo",
      agentDisplayName: "Demo",
      mcpAppsEnabled: true,
    } as const;
    const args = buildRunArgs(config, "podman", "openclaw-demo", 18789);
    const rendered = JSON.parse(buildOpenClawConfig(config, ""));

    expect(args).toContain("18790:18790");
    expect(rendered).toMatchObject({
      mcp: { apps: { enabled: true, sandboxPort: 18790 } },
    });
  });

  it("refreshes MCP servers from the Agent Source config", () => {
    const script = localTesting.mcpServersRuntimeConfigUpdateScript({
      "customer-segmentation": { command: "npx" },
    });

    expect(script).toContain("c.mcp.servers=JSON.parse");
    expect(script).not.toContain("customer-segmentation");
  });
});
