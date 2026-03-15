import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { loadTextTree } from "../state-tree.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("loadTextTree", () => {
  it("loads nested sample skill files with relative paths", async () => {
    const root = await mkdtemp(join(tmpdir(), "openclaw-state-tree-"));
    tempDirs.push(root);

    await mkdir(join(root, "skills", "briefing-bot"), { recursive: true });
    await writeFile(
      join(root, "skills", "briefing-bot", "SKILL.md"),
      "# Briefing Bot\n\nSummarize the latest updates.\n",
      "utf8",
    );

    const skillEntries = await loadTextTree(join(root, "skills"));

    expect(skillEntries).toHaveLength(1);
    expect(skillEntries[0]?.path).toBe("briefing-bot/SKILL.md");
    expect(skillEntries[0]?.content).toContain("Briefing Bot");
  });
});
