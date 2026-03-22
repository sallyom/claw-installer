import { Router } from "express";
import { registry } from "../deployers/registry.js";
import { getDisabledModes, setModeDisabled } from "../plugins/loader.js";

const router = Router();

// List all plugins with status info
router.get("/", async (_req, res) => {
  const detected = await registry.detect();
  const detectedModes = new Set(detected.map((d) => d.mode));
  const disabledModes = new Set(await getDisabledModes());

  const plugins = registry.list().map((reg) => ({
    mode: reg.mode,
    title: reg.title,
    description: reg.description,
    source: reg.source ?? (reg.builtIn ? "built-in" : "unknown"),
    enabled: !disabledModes.has(reg.mode),
    available: detectedModes.has(reg.mode),
    builtIn: reg.builtIn ?? false,
    priority: reg.priority ?? 0,
  }));

  res.json({
    plugins,
    errors: registry.loadErrors(),
  });
});

// Disable a plugin by mode
router.post("/:mode/disable", async (req, res) => {
  const { mode } = req.params;

  const reg = registry.list().find((r) => r.mode === mode);
  if (!reg) {
    res.status(404).json({ error: `Unknown deployer mode: ${mode}` });
    return;
  }

  if (reg.builtIn) {
    res.status(400).json({ error: "Built-in deployers cannot be disabled" });
    return;
  }

  await setModeDisabled(mode, true);
  res.json({ ok: true });
});

// Enable a plugin by mode
router.post("/:mode/enable", async (req, res) => {
  const { mode } = req.params;

  const reg = registry.list().find((r) => r.mode === mode);
  if (!reg) {
    res.status(404).json({ error: `Unknown deployer mode: ${mode}` });
    return;
  }

  await setModeDisabled(mode, false);
  res.json({ ok: true });
});

export default router;
