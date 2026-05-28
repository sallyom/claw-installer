import { describe, expect, it } from "vitest";
import { allowedDeployModes, installerRunMode, isDeployModeAllowed } from "../installer-mode.js";

describe("installer mode", () => {
  it("defaults to desktop mode with all deploy modes allowed", () => {
    const env = {};

    expect(installerRunMode(env)).toBe("desktop");
    expect(allowedDeployModes(env)).toEqual(new Set());
    expect(isDeployModeAllowed("local", env)).toBe(true);
    expect(isDeployModeAllowed("openshift", env)).toBe(true);
  });

  it("defaults hosted mode to cluster deployers", () => {
    const env = { OPENCLAW_INSTALLER_RUN_MODE: "hosted" };

    expect(installerRunMode(env)).toBe("hosted");
    expect(allowedDeployModes(env)).toEqual(new Set(["kubernetes", "openshift"]));
    expect(isDeployModeAllowed("local", env)).toBe(false);
    expect(isDeployModeAllowed("openshift", env)).toBe(true);
  });

  it("honors an explicit deploy mode allowlist", () => {
    const env = {
      OPENCLAW_INSTALLER_RUN_MODE: "hosted",
      OPENCLAW_INSTALLER_DEPLOY_MODES: " openshift, kubernetes ",
    };

    expect(allowedDeployModes(env)).toEqual(new Set(["openshift", "kubernetes"]));
    expect(isDeployModeAllowed("local", env)).toBe(false);
    expect(isDeployModeAllowed("kubernetes", env)).toBe(true);
  });
});
