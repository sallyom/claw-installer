import { describe, expect, it } from "vitest";
import {
  shouldUseChromiumSidecar,
  chromiumContainerName,
  chromiumAgentEnv,
  CHROMIUM_IMAGE,
  CHROMIUM_CDP_PORT,
} from "../chromium.js";
import type { DeployConfig } from "../types.js";

describe("chromium sidecar", () => {
  const baseConfig: DeployConfig = {
    mode: "local",
    agentName: "test-agent",
    agentDisplayName: "Test Agent",
  };

  describe("shouldUseChromiumSidecar", () => {
    it("returns false when chromiumSidecar is not set", () => {
      expect(shouldUseChromiumSidecar(baseConfig)).toBe(false);
    });

    it("returns false when chromiumSidecar is false", () => {
      expect(shouldUseChromiumSidecar({ ...baseConfig, chromiumSidecar: false })).toBe(false);
    });

    it("returns true when chromiumSidecar is true", () => {
      expect(shouldUseChromiumSidecar({ ...baseConfig, chromiumSidecar: true })).toBe(true);
    });
  });

  describe("chromiumContainerName", () => {
    it("generates correct container name with default prefix", () => {
      expect(chromiumContainerName(baseConfig)).toBe("openclaw-openclaw-test-agent-chromium");
    });

    it("generates correct container name with custom prefix", () => {
      expect(chromiumContainerName({ ...baseConfig, prefix: "myprefix" })).toBe(
        "openclaw-myprefix-test-agent-chromium",
      );
    });

    it("lowercases the container name", () => {
      expect(chromiumContainerName({ ...baseConfig, agentName: "MyAgent" })).toBe(
        "openclaw-openclaw-myagent-chromium",
      );
    });
  });

  describe("chromiumAgentEnv", () => {
    it("returns CHROME_CDP_URL pointing to localhost:9222", () => {
      const env = chromiumAgentEnv();
      expect(env).toEqual({
        CHROME_CDP_URL: "http://localhost:9222",
      });
    });
  });

  describe("constants", () => {
    it("exports correct default image", () => {
      expect(CHROMIUM_IMAGE).toBe("chromedp/headless-shell:stable");
    });

    it("exports correct CDP port", () => {
      expect(CHROMIUM_CDP_PORT).toBe(9222);
    });
  });
});
