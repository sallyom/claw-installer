import { mkdirSync } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockExecFile } = vi.hoisted(() => ({ mockExecFile: vi.fn() }));

vi.mock("node:child_process", () => ({ execFile: mockExecFile }));

import { materializeAgentSourceGit, validateAgentSourceGitUrl } from "../agent-source-git.js";

describe("Agent Source Git", () => {
  let cacheRoot: string;

  beforeEach(async () => {
    cacheRoot = await mkdtemp(join(tmpdir(), "agent-source-git-test-"));
    mockExecFile.mockImplementation((_file, args: string[], _options, callback) => {
      const cloneDir = args[args.length - 1];
      mkdirSync(join(cloneDir, ".git", "objects"), { recursive: true });
      mkdirSync(join(cloneDir, "teams", "platform"), { recursive: true });
      callback(null, { stdout: "", stderr: "" });
    });
  });

  afterEach(async () => {
    vi.clearAllMocks();
    await rm(cacheRoot, { recursive: true, force: true });
  });

  it("clones an HTTPS repository at an optional ref and returns its configured path", async () => {
    const sourceDir = await materializeAgentSourceGit({
      url: "https://github.com/example/agents.git",
      ref: "release-v1",
      path: "teams/platform",
      cacheRoot,
    });

    expect(sourceDir).toMatch(/\/teams\/platform$/);
    await expect(stat(join(sourceDir, "..", "..", ".git"))).rejects.toThrow();
    expect(mockExecFile).toHaveBeenCalledWith(
      "git",
      expect.arrayContaining(["clone", "--depth", "1", "--branch", "release-v1", "https://github.com/example/agents.git"]),
      expect.objectContaining({ env: expect.objectContaining({ GIT_TERMINAL_PROMPT: "0" }) }),
      expect.any(Function),
    );
  });

  it("rejects non-HTTPS and credential-bearing URLs", () => {
    expect(() => validateAgentSourceGitUrl("git@github.com:example/agents.git")).toThrow(/valid HTTPS URL/);
    expect(() => validateAgentSourceGitUrl("https://user:token@github.com/example/agents.git")).toThrow(/must not contain credentials/);
  });

  it("rejects repository paths that escape the checkout", async () => {
    await expect(materializeAgentSourceGit({
      url: "https://github.com/example/agents.git",
      path: "../outside",
      cacheRoot,
    })).rejects.toThrow(/must stay within the repository/);
    expect(mockExecFile).not.toHaveBeenCalled();
  });
});
