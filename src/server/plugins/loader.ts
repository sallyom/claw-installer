import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { homedir } from "node:os";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import type { DeployerRegistry, InstallerPlugin } from "../deployers/registry.js";

const PLUGIN_PREFIX = "openclaw-installer-";
const CONFIG_PATH = join(homedir(), ".openclaw", "installer", "plugins.json");
const BUILT_RUNTIME_SEGMENT = `${sep}dist${sep}`;

export interface PluginConfig {
  plugins?: string[];
  disabled?: string[];
}

function isBuiltRuntime(): boolean {
  return import.meta.dirname.includes(BUILT_RUNTIME_SEGMENT);
}

async function readPluginConfig(): Promise<PluginConfig> {
  if (!existsSync(CONFIG_PATH)) return {};

  try {
    const content = await readFile(CONFIG_PATH, "utf8");
    return JSON.parse(content) as PluginConfig;
  } catch {
    return {};
  }
}

async function writePluginConfig(config: PluginConfig): Promise<void> {
  const dir = dirname(CONFIG_PATH);
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
  await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n", "utf8");
}

export async function getDisabledModes(): Promise<string[]> {
  const config = await readPluginConfig();
  if (Array.isArray(config.disabled)) {
    return config.disabled.filter((m): m is string => typeof m === "string");
  }
  return [];
}

export async function setModeDisabled(mode: string, disabled: boolean): Promise<void> {
  const config = await readPluginConfig();
  const current = new Set(
    Array.isArray(config.disabled)
      ? config.disabled.filter((m): m is string => typeof m === "string")
      : [],
  );

  if (disabled) {
    current.add(mode);
  } else {
    current.delete(mode);
  }

  config.disabled = [...current];
  await writePluginConfig(config);
}

async function discoverProviderPlugins(registry: DeployerRegistry): Promise<void> {
  // Resolve repo root: this file is at src/server/plugins/loader.ts, so 3 levels up
  const repoRoot = join(import.meta.dirname, "..", "..", "..");
  const builtRuntime = isBuiltRuntime();
  const providerPluginsDir = builtRuntime
    ? join(repoRoot, "dist", "provider-plugins")
    : join(repoRoot, "provider-plugins");

  if (!existsSync(providerPluginsDir)) return;

  let entries;
  try {
    entries = await readdir(providerPluginsDir, { withFileTypes: true });
  } catch {
    return;
  }

  registry.currentSource = "provider-plugin";

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const name = String(entry.name);
    const jsIndex = join(providerPluginsDir, name, "src", "index.js");
    const srcIndex = join(providerPluginsDir, name, "src", "index.ts");

    const entryPoint = builtRuntime
      ? (existsSync(jsIndex) ? jsIndex : null)
      : (existsSync(srcIndex) ? srcIndex : existsSync(jsIndex) ? jsIndex : null);
    if (!entryPoint) continue;

    try {
      const mod = await import(pathToFileURL(entryPoint).href);
      const plugin: InstallerPlugin | undefined = mod.default ?? mod;

      if (typeof plugin?.register !== "function") {
        console.warn(`Provider plugin "${name}" does not export a register function, skipping`);
        registry.addLoadError({ pluginId: name, error: "Does not export a register function" });
        continue;
      }

      plugin.register(registry);
      console.log(`Loaded provider plugin: ${name}`);
    } catch (err) {
      console.warn(`Failed to load provider plugin "${name}":`, err);
      registry.addLoadError({ pluginId: name, error: String(err) });
    }
  }
}

async function discoverNpmPlugins(): Promise<string[]> {
  const require = createRequire(import.meta.url);
  const plugins: string[] = [];

  try {
    const expressPath = require.resolve("express");
    const nodeModulesDir = join(expressPath.split("node_modules")[0], "node_modules");
    const entries = await readdir(nodeModulesDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;

      if (entry.name.startsWith(PLUGIN_PREFIX)) {
        plugins.push(entry.name);
        continue;
      }

      // Check scoped packages (@scope/openclaw-installer-*)
      if (entry.name.startsWith("@")) {
        try {
          const scopedEntries = await readdir(join(nodeModulesDir, entry.name), { withFileTypes: true });
          for (const scoped of scopedEntries) {
            if ((scoped.isDirectory() || scoped.isSymbolicLink()) && scoped.name.startsWith(PLUGIN_PREFIX)) {
              plugins.push(`${entry.name}/${scoped.name}`);
            }
          }
        } catch {
          // skip unreadable scope dirs
        }
      }
    }
  } catch {
    // node_modules not found or unreadable
  }
  return plugins;
}

async function loadConfigPlugins(): Promise<string[]> {
  const config = await readPluginConfig();
  if (Array.isArray(config.plugins)) {
    return config.plugins.filter((p: unknown) => typeof p === "string");
  }
  return [];
}

async function loadPlugin(registry: DeployerRegistry, moduleId: string, source: "npm" | "config"): Promise<void> {
  console.log(`Attempting to load plugin: ${moduleId}`);
  registry.currentSource = source;
  try {
    const mod = await import(moduleId);
    const plugin: InstallerPlugin | undefined = mod.default ?? mod;

    if (typeof plugin?.register !== "function") {
      console.warn(`Plugin "${moduleId}" does not export a register function, skipping`);
      registry.addLoadError({ pluginId: moduleId, error: "Does not export a register function" });
      return;
    }

    plugin.register(registry);
    console.log(`Loaded plugin: ${moduleId}`);
  } catch (err) {
    console.warn(`Failed to load plugin "${moduleId}":`, err);
    registry.addLoadError({ pluginId: moduleId, error: String(err) });
  }
}

export async function loadPlugins(registry: DeployerRegistry): Promise<void> {
  // Load provider plugins from provider-plugins/ before npm plugins
  await discoverProviderPlugins(registry);

  const npmPlugins = await discoverNpmPlugins();
  const configPlugins = await loadConfigPlugins();

  // Determine source for each plugin (npm takes precedence for duplicates)
  const npmSet = new Set(npmPlugins);
  const allPlugins = [...new Set([...npmPlugins, ...configPlugins])];

  if (allPlugins.length === 0) return;

  for (const pluginId of allPlugins) {
    const source = npmSet.has(pluginId) ? "npm" as const : "config" as const;
    await loadPlugin(registry, pluginId, source);
  }

  // Reset source to built-in as default
  registry.currentSource = "built-in";
}
