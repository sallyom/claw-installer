import { describe, it, expect } from "vitest";
import { DeployerRegistry } from "../registry.js";
import type { Deployer, DeployConfig, DeployResult, LogCallback } from "../types.js";

function stubDeployer(): Deployer {
  return {
    async deploy(_config: DeployConfig, _log: LogCallback): Promise<DeployResult> {
      return { id: "test", mode: "test", status: "running", config: { mode: "test", agentName: "t" }, startedAt: "" };
    },
    async start(result: DeployResult): Promise<DeployResult> { return result; },
    async status(result: DeployResult): Promise<DeployResult> { return result; },
    async stop(): Promise<void> {},
    async teardown(): Promise<void> {},
  };
}

describe("DeployerRegistry", () => {
  it("registers and retrieves a deployer by mode", () => {
    const reg = new DeployerRegistry();
    const deployer = stubDeployer();
    reg.register({ mode: "test", title: "Test", description: "A test deployer", deployer });

    expect(reg.get("test")).toBe(deployer);
  });

  it("returns null for unknown mode", () => {
    const reg = new DeployerRegistry();
    expect(reg.get("nonexistent")).toBeNull();
  });

  it("lists all registrations", () => {
    const reg = new DeployerRegistry();
    reg.register({ mode: "a", title: "A", description: "First", deployer: stubDeployer() });
    reg.register({ mode: "b", title: "B", description: "Second", deployer: stubDeployer() });

    const list = reg.list();
    expect(list).toHaveLength(2);
    expect(list.map((r) => r.mode)).toEqual(["a", "b"]);
  });

  it("overwrites duplicate mode registrations", () => {
    const reg = new DeployerRegistry();
    const first = stubDeployer();
    const second = stubDeployer();
    reg.register({ mode: "dup", title: "First", description: "First", deployer: first });
    reg.register({ mode: "dup", title: "Second", description: "Second", deployer: second });

    expect(reg.get("dup")).toBe(second);
    expect(reg.list()).toHaveLength(1);
    expect(reg.list()[0].title).toBe("Second");
  });

  it("detect returns registrations where detect() returns true", async () => {
    const reg = new DeployerRegistry();
    reg.register({ mode: "yes", title: "Yes", description: "Available", deployer: stubDeployer(), detect: async () => true });
    reg.register({ mode: "no", title: "No", description: "Unavailable", deployer: stubDeployer(), detect: async () => false });

    const detected = await reg.detect();
    expect(detected).toHaveLength(1);
    expect(detected[0].mode).toBe("yes");
  });

  it("detect includes registrations without detect function", async () => {
    const reg = new DeployerRegistry();
    reg.register({ mode: "nodetect", title: "No Detect", description: "Always available", deployer: stubDeployer() });

    const detected = await reg.detect();
    expect(detected).toHaveLength(1);
    expect(detected[0].mode).toBe("nodetect");
  });

  it("detect handles detect() throwing gracefully", async () => {
    const reg = new DeployerRegistry();
    reg.register({
      mode: "broken",
      title: "Broken",
      description: "Throws",
      deployer: stubDeployer(),
      detect: async () => { throw new Error("boom"); },
    });
    reg.register({ mode: "ok", title: "OK", description: "Fine", deployer: stubDeployer(), detect: async () => true });

    const detected = await reg.detect();
    expect(detected).toHaveLength(1);
    expect(detected[0].mode).toBe("ok");
  });

  it("preserves priority in registrations", () => {
    const reg = new DeployerRegistry();
    reg.register({ mode: "low", title: "Low", description: "Low priority", deployer: stubDeployer(), priority: -1 });
    reg.register({ mode: "high", title: "High", description: "High priority", deployer: stubDeployer(), priority: 10 });

    const list = reg.list();
    const low = list.find((r) => r.mode === "low");
    const high = list.find((r) => r.mode === "high");
    expect(low?.priority).toBe(-1);
    expect(high?.priority).toBe(10);
  });

  it("preserves builtIn flag in registrations", () => {
    const reg = new DeployerRegistry();
    reg.register({ mode: "core", title: "Core", description: "Built-in", deployer: stubDeployer(), builtIn: true });
    reg.register({ mode: "plugin", title: "Plugin", description: "External", deployer: stubDeployer() });

    const list = reg.list();
    const core = list.find((r) => r.mode === "core");
    const plugin = list.find((r) => r.mode === "plugin");
    expect(core?.builtIn).toBe(true);
    expect(plugin?.builtIn).toBeUndefined();
  });

  it("applies currentSource to registrations", () => {
    const reg = new DeployerRegistry();
    reg.currentSource = "built-in";
    reg.register({ mode: "local", title: "Local", description: "Local deploy", deployer: stubDeployer() });

    reg.currentSource = "provider-plugin";
    reg.register({ mode: "openshift", title: "OpenShift", description: "OpenShift deploy", deployer: stubDeployer() });

    const list = reg.list();
    expect(list.find((r) => r.mode === "local")?.source).toBe("built-in");
    expect(list.find((r) => r.mode === "openshift")?.source).toBe("provider-plugin");
  });

  it("explicit source in registration overrides currentSource", () => {
    const reg = new DeployerRegistry();
    reg.currentSource = "npm";
    reg.register({ mode: "custom", title: "Custom", description: "Custom", deployer: stubDeployer(), source: "config" });

    expect(reg.list()[0].source).toBe("config");
  });

  it("tracks load errors", () => {
    const reg = new DeployerRegistry();
    expect(reg.loadErrors()).toHaveLength(0);

    reg.addLoadError({ pluginId: "bad-plugin", error: "Missing register function" });
    reg.addLoadError({ pluginId: "broken-plugin", error: "Import failed" });

    const errors = reg.loadErrors();
    expect(errors).toHaveLength(2);
    expect(errors[0].pluginId).toBe("bad-plugin");
    expect(errors[1].error).toBe("Import failed");
  });

  it("loadErrors returns a copy", () => {
    const reg = new DeployerRegistry();
    reg.addLoadError({ pluginId: "test", error: "err" });
    const a = reg.loadErrors();
    const b = reg.loadErrors();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});
