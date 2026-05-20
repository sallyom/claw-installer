import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { loadAgentSourceCronJobs, loadAgentSourceMcpServers, loadAgentSourceExecApprovals, subagentIds, mainWorkspaceShellCondition } from "../agent-source.js";
import type { AgentSourceBundle } from "../agent-source.js";

const tempDirs: string[] = [];

describe("loadAgentSourceCronJobs", () => {
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup failures in tests.
      }
    }
  });

  it("loads cron/jobs.json from the agent source directory", () => {
    const dir = mkdtempSync(join(tmpdir(), "openclaw-agent-source-"));
    tempDirs.push(dir);
    mkdirSync(join(dir, "cron"), { recursive: true });
    writeFileSync(join(dir, "cron", "jobs.json"), "{\"jobs\":[{\"name\":\"briefing\"}]}", "utf8");

    expect(loadAgentSourceCronJobs(dir)).toBe("{\"jobs\":[{\"name\":\"briefing\"}]}");
  });

  it("returns undefined when no cron/jobs.json exists", () => {
    const dir = mkdtempSync(join(tmpdir(), "openclaw-agent-source-"));
    tempDirs.push(dir);

    expect(loadAgentSourceCronJobs(dir)).toBeUndefined();
  });
});

describe("subagentIds", () => {
  it("returns empty array for undefined bundle", () => {
    expect(subagentIds(undefined)).toEqual([]);
  });

  it("returns empty array when bundle has no agents", () => {
    expect(subagentIds({ mainAgent: {} })).toEqual([]);
  });

  it("extracts IDs from bundle agents", () => {
    const bundle: AgentSourceBundle = {
      agents: [
        { id: "builder" },
        { id: "research" },
        { id: "ops" },
      ],
    };
    expect(subagentIds(bundle)).toEqual(["builder", "research", "ops"]);
  });
});

// Regression tests for #62: workspace-shadowman not recognized as main agent workspace
describe("mainWorkspaceShellCondition", () => {
  const mainDest = "/home/node/.openclaw/workspace-openclaw_shadowman";

  it("maps all workspace-* dirs to main when bundle is undefined", () => {
    const result = mainWorkspaceShellCondition(mainDest, undefined);
    expect(result).toBe(`dest="${mainDest}"`);
  });

  it("maps all workspace-* dirs to main when bundle has no subagents", () => {
    const bundle: AgentSourceBundle = { mainAgent: {} };
    const result = mainWorkspaceShellCondition(mainDest, bundle);
    expect(result).toBe(`dest="${mainDest}"`);
  });

  it("routes subagent workspaces to their own paths and everything else to main", () => {
    const bundle: AgentSourceBundle = {
      agents: [
        { id: "builder" },
        { id: "research" },
        { id: "ops" },
      ],
    };
    const result = mainWorkspaceShellCondition(mainDest, bundle);

    // Subagent dirs should be routed to /home/node/.openclaw/$base
    expect(result).toContain('[ "$base" = "workspace-builder" ]');
    expect(result).toContain('[ "$base" = "workspace-research" ]');
    expect(result).toContain('[ "$base" = "workspace-ops" ]');
    expect(result).toContain('dest="/home/node/.openclaw/$base"');

    // Non-subagent dirs (workspace-shadowman, workspace-main, etc.) go to main
    expect(result).toContain(`dest="${mainDest}"`);

    // The subagent check is in the "then" branch, main is in the "else" branch
    expect(result).toMatch(/^if .+ then dest="\/home\/node\/.openclaw\/\$base"; else dest=".*"; fi$/);
  });

  it("handles single subagent", () => {
    const bundle: AgentSourceBundle = {
      agents: [{ id: "builder" }],
    };
    const result = mainWorkspaceShellCondition(mainDest, bundle);
    expect(result).toBe(
      `if [ "$base" = "workspace-builder" ]; then dest="/home/node/.openclaw/$base"; else dest="${mainDest}"; fi`,
    );
  });

  it("workspace-main still works (never matches a subagent ID)", () => {
    // workspace-main would have base="workspace-main", which won't match
    // workspace-builder, workspace-research, or workspace-ops — so it falls
    // through to the else branch (main dest). Backwards compatible.
    const bundle: AgentSourceBundle = {
      agents: [{ id: "builder" }, { id: "research" }],
    };
    const result = mainWorkspaceShellCondition(mainDest, bundle);
    // "workspace-main" doesn't appear in any check condition
    expect(result).not.toContain('"workspace-main"');
    // It will fall to the else branch → main dest
    expect(result).toContain(`else dest="${mainDest}"`);
  });
});

describe("loadAgentSourceMcpServers", () => {
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup failures in tests.
      }
    }
  });

  it("loads mcpServers from mcp.json with wrapper format", () => {
    const dir = mkdtempSync(join(tmpdir(), "openclaw-agent-source-"));
    tempDirs.push(dir);
    writeFileSync(
      join(dir, "mcp.json"),
      JSON.stringify({ mcpServers: { test: { url: "https://example.com" } } }),
      "utf8",
    );

    expect(loadAgentSourceMcpServers(dir)).toEqual({
      test: { url: "https://example.com" },
    });
  });

  it("loads mcpServers from mcp.json with flat format", () => {
    const dir = mkdtempSync(join(tmpdir(), "openclaw-agent-source-"));
    tempDirs.push(dir);
    writeFileSync(
      join(dir, "mcp.json"),
      JSON.stringify({ test: { url: "https://example.com" } }),
      "utf8",
    );

    expect(loadAgentSourceMcpServers(dir)).toEqual({
      test: { url: "https://example.com" },
    });
  });

  it("returns undefined when no mcp.json exists", () => {
    const dir = mkdtempSync(join(tmpdir(), "openclaw-agent-source-"));
    tempDirs.push(dir);

    expect(loadAgentSourceMcpServers(dir)).toBeUndefined();
  });

  it("returns undefined for invalid JSON", () => {
    const dir = mkdtempSync(join(tmpdir(), "openclaw-agent-source-"));
    tempDirs.push(dir);
    writeFileSync(join(dir, "mcp.json"), "not json", "utf8");

    expect(loadAgentSourceMcpServers(dir)).toBeUndefined();
  });

  it("returns undefined for empty object", () => {
    const dir = mkdtempSync(join(tmpdir(), "openclaw-agent-source-"));
    tempDirs.push(dir);
    writeFileSync(join(dir, "mcp.json"), "{}", "utf8");

    expect(loadAgentSourceMcpServers(dir)).toBeUndefined();
  });

  it("returns undefined when agentSourceDir is undefined", () => {
    expect(loadAgentSourceMcpServers(undefined)).toBeUndefined();
  });
});

describe("loadAgentSourceExecApprovals", () => {
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup failures in tests.
      }
    }
  });

  it("loads exec-approvals.json content", () => {
    const dir = mkdtempSync(join(tmpdir(), "openclaw-agent-source-"));
    tempDirs.push(dir);
    const content = JSON.stringify({ approvals: [{ command: "npm test" }] });
    writeFileSync(join(dir, "exec-approvals.json"), content, "utf8");

    expect(loadAgentSourceExecApprovals(dir)).toBe(content);
  });

  it("returns undefined when no exec-approvals.json exists", () => {
    const dir = mkdtempSync(join(tmpdir(), "openclaw-agent-source-"));
    tempDirs.push(dir);

    expect(loadAgentSourceExecApprovals(dir)).toBeUndefined();
  });

  it("returns undefined when agentSourceDir is undefined", () => {
    expect(loadAgentSourceExecApprovals(undefined)).toBeUndefined();
  });
});
