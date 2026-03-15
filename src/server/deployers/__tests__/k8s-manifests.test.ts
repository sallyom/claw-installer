import { describe, expect, it } from "vitest";
import { deploymentManifest, fileConfigMapManifest, fileTreeConfigMapManifest } from "../k8s-manifests.js";
import type { DeployConfig } from "../types.js";

describe("k8s state sync manifests", () => {
  const config: DeployConfig = {
    mode: "kubernetes",
    prefix: "openclaw",
    agentName: "alpha",
    agentDisplayName: "Alpha",
    agentModel: "claude-sonnet-4-6",
  };

  it("renders skill and cron ConfigMaps from host state entries", () => {
    const skillsCm = fileTreeConfigMapManifest("openclaw-alpha-openclaw", "openclaw-skills", [
      { key: "f0", path: "briefing-bot/SKILL.md", content: "# Briefing Bot" },
    ]);
    const cronCm = fileConfigMapManifest(
      "openclaw-alpha-openclaw",
      "openclaw-cron",
      "jobs.json",
      "{\"jobs\":[{\"name\":\"daily-brief\"}]}",
    );

    expect(skillsCm.data).toEqual({ f0: "# Briefing Bot" });
    expect(cronCm.data).toEqual({ "jobs.json": "{\"jobs\":[{\"name\":\"daily-brief\"}]}" });
  });

  it("mounts and copies skill and cron state into the PVC", () => {
    const deployment = deploymentManifest(
      "openclaw-alpha-openclaw",
      config,
      false,
      false,
      [{ key: "f0", path: "briefing-bot/SKILL.md", content: "# Briefing Bot" }],
      "{\"jobs\":[{\"name\":\"daily-brief\"}]}",
    );

    const initContainer = deployment.spec?.template.spec?.initContainers?.[0];
    expect(initContainer?.command?.[2]).toContain("cp -r /skills-src/. /home/node/.openclaw/skills/");
    expect(initContainer?.command?.[2]).toContain("cp /cron-src/jobs.json /home/node/.openclaw/cron/jobs.json");

    const volumeMounts = initContainer?.volumeMounts?.map((mount) => mount.mountPath) ?? [];
    expect(volumeMounts).toContain("/skills-src");
    expect(volumeMounts).toContain("/cron-src");

    const volumes = deployment.spec?.template.spec?.volumes ?? [];
    const skillsVolume = volumes.find((volume) => volume.name === "skills-config");
    const cronVolume = volumes.find((volume) => volume.name === "cron-config");

    expect(skillsVolume?.configMap?.name).toBe("openclaw-skills");
    expect(skillsVolume?.configMap?.items).toEqual([{ key: "f0", path: "briefing-bot/SKILL.md" }]);
    expect(cronVolume?.configMap?.name).toBe("openclaw-cron");
    expect(cronVolume?.configMap?.items).toEqual([{ key: "jobs.json", path: "jobs.json" }]);
  });
});
