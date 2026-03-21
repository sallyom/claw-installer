import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockExecFile } = vi.hoisted(() => ({
  mockExecFile: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  execFile: mockExecFile,
}));

describe("discoverContainers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("includes installer-managed containers by label", async () => {
    mockExecFile.mockImplementation((_file, _args, cb) => {
      cb(null, {
        stdout: JSON.stringify([
          {
            Image: "quay.io/sallyom/openclaw-installer:latest",
            Names: ["openclaw-user-agent"],
            State: "running",
            Labels: {
              "openclaw.managed": "true",
              "openclaw.prefix": "user",
              "openclaw.agent": "agent",
            },
            CreatedAt: "now",
            Ports: "",
          },
        ]),
        stderr: "",
      });
    });

    const { discoverContainers } = await import("../container.js");
    await expect(discoverContainers("podman")).resolves.toEqual([
      expect.objectContaining({
        name: "openclaw-user-agent",
        status: "running",
      }),
    ]);
  });

  it("includes manually launched OpenClaw runtime containers", async () => {
    mockExecFile.mockImplementation((_file, _args, cb) => {
      cb(null, {
        stdout: JSON.stringify([
          {
            Image: "ghcr.io/openclaw/openclaw:latest",
            Names: ["manual-openclaw"],
            State: "running",
            Labels: {},
            CreatedAt: "now",
            Ports: "",
          },
        ]),
        stderr: "",
      });
    });

    const { discoverContainers } = await import("../container.js");
    await expect(discoverContainers("podman")).resolves.toEqual([
      expect.objectContaining({
        name: "manual-openclaw",
        image: "ghcr.io/openclaw/openclaw:latest",
      }),
    ]);
  });

  it("excludes installer containers that only match openclaw-installer by image name", async () => {
    mockExecFile.mockImplementation((_file, _args, cb) => {
      cb(null, {
        stdout: JSON.stringify([
          {
            Image: "quay.io/sallyom/openclaw-installer:latest",
            Names: ["openclaw-installer"],
            State: "running",
            Labels: {},
            CreatedAt: "now",
            Ports: "",
          },
        ]),
        stderr: "",
      });
    });

    const { discoverContainers } = await import("../container.js");
    await expect(discoverContainers("podman")).resolves.toEqual([]);
  });
});
