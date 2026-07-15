import { describe, expect, it } from "vitest";
import { homedir } from "node:os";
import { join } from "node:path";
import type { DeployResult } from "../deployers/types.js";
import {
  installerBindHost,
  installerDisplayHost,
  installerPort,
  sanitizeDeployResult,
  sanitizeSavedConfigVars,
  validateUserSuppliedPath,
} from "../security.js";
import { installerDataDir, installerStateDir, validateInstallerPathSegment } from "../paths.js";

describe("security helpers", () => {
  it("redacts sensitive values from saved config payloads", () => {
    const sanitized = sanitizeSavedConfigVars({
      OPENCLAW_AGENT_NAME: "lynx",
      OPENAI_API_KEY: "sk-openai-secret",
      TELEGRAM_BOT_TOKEN: "tg-secret",
      googleApiKey: "gemini-secret",
      gcpServiceAccountJson: "{\"private_key\":\"secret\"}",
    });

    expect(sanitized).toEqual({
      OPENCLAW_AGENT_NAME: "lynx",
    });
  });

  it("redacts sensitive values from public instance payloads", () => {
    const result: DeployResult = {
      id: "openclaw-lynx",
      mode: "local",
      status: "running",
      startedAt: "",
      config: {
        mode: "local",
        agentName: "lynx",
        agentDisplayName: "Lynx",
        openaiApiKey: "sk-openai-secret",
        modelEndpointApiKey: "endpoint-secret",
        openaiApiKeyRef: { source: "env", provider: "default", id: "OPENAI_API_KEY" },
      },
    };

    expect(sanitizeDeployResult(result).config).toEqual({
      mode: "local",
      agentName: "lynx",
      agentDisplayName: "Lynx",
      openaiApiKeyRef: { source: "env", provider: "default", id: "OPENAI_API_KEY" },
    });
  });

  it("allows user-supplied paths inside approved roots and rejects paths outside them", () => {
    expect(validateUserSuppliedPath("README.md", "test path")).toMatch(/README\.md$/);
    expect(() => validateUserSuppliedPath("/etc/passwd", "test path")).toThrow(
      /must be under your home directory, the current repository, or the system temp directory/,
    );
  });

  it("rejects installer path segments that could escape instance directories", () => {
    expect(validateInstallerPathSegment("openclaw-sally-lynx", "instance")).toBe("openclaw-sally-lynx");
    expect(() => validateInstallerPathSegment("../openclaw-sally-lynx", "instance")).toThrow(
      /contains invalid characters/,
    );
    expect(() => validateInstallerPathSegment("openclaw/sally", "instance")).toThrow(
      /contains invalid characters/,
    );
  });

  it("uses a configurable installer state root", () => {
    const env = { OPENCLAW_INSTALLER_STATE_DIR: "/tmp/openclaw-installer-state" };
    expect(installerStateDir(env)).toBe("/tmp/openclaw-installer-state");
  });

  it("keeps the legacy installer state root by default", () => {
    expect(installerStateDir({})).toBe(join(homedir(), ".openclaw"));
    expect(installerDataDir()).toBe(`${installerStateDir()}/installer`);
  });

  it("rejects a relative installer state root", () => {
    expect(() => installerStateDir({ OPENCLAW_INSTALLER_STATE_DIR: "relative/state" })).toThrow(
      /must be an absolute path/,
    );
  });

  it("binds to loopback by default and preserves explicit container binds", () => {
    expect(installerBindHost({})).toBe("127.0.0.1");
    expect(installerBindHost({ OPENCLAW_INSTALLER_BIND_HOST: "0.0.0.0" })).toBe("0.0.0.0");
    expect(installerDisplayHost("0.0.0.0")).toBe("localhost");
  });

  it("uses the installer-specific port and ignores ambient PORT", () => {
    expect(installerPort({ PORT: "58127" })).toBe(3000);
    expect(installerPort({ OPENCLAW_INSTALLER_PORT: "3100", PORT: "58127" })).toBe(3100);
    expect(installerPort({ OPENCLAW_INSTALLER_PORT: "not-a-port" })).toBe(3000);
  });
});
