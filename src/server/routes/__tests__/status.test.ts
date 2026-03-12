import { describe, it, expect } from "vitest";
import { parseContainerName } from "../status.js";

describe("parseContainerName", () => {
  it("splits openclaw-{prefix}-{agentName} correctly (issue #31)", () => {
    const result = parseContainerName("openclaw-bmurdock-rabbit");
    expect(result).toEqual({ prefix: "bmurdock", agentName: "rabbit" });
  });

  it("handles multi-segment prefix", () => {
    const result = parseContainerName("openclaw-my-team-lynx");
    expect(result).toEqual({ prefix: "my-team", agentName: "lynx" });
  });

  it("handles single-segment name (no prefix beyond openclaw-)", () => {
    const result = parseContainerName("openclaw-rabbit");
    expect(result).toEqual({ prefix: "rabbit", agentName: "rabbit" });
  });

  it("produces values consistent with volumeName composition", () => {
    // volumeName(config) = `openclaw-${prefix}-${agentName}-data`
    // So parsing a container name and recomposing should round-trip
    const containerName = "openclaw-sally-fox";
    const { prefix, agentName } = parseContainerName(containerName);
    const recomposedContainer = `openclaw-${prefix}-${agentName}`;
    const recomposedVolume = `openclaw-${prefix}-${agentName}-data`;
    expect(recomposedContainer).toBe(containerName);
    expect(recomposedVolume).toBe("openclaw-sally-fox-data");
  });

  it("round-trips multi-segment prefix with volume name", () => {
    const containerName = "openclaw-team-alpha-wolf";
    const { prefix, agentName } = parseContainerName(containerName);
    expect(prefix).toBe("team-alpha");
    expect(agentName).toBe("wolf");
    expect(`openclaw-${prefix}-${agentName}-data`).toBe("openclaw-team-alpha-wolf-data");
  });

  it("handles name without openclaw- prefix gracefully", () => {
    const result = parseContainerName("custom-prefix-agent");
    expect(result).toEqual({ prefix: "custom-prefix", agentName: "agent" });
  });
});
