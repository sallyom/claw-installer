import console from "node:console";
import type { Deployer } from "./types.js";

export type PluginSource = "built-in" | "provider-plugin" | "npm" | "config";

export interface DeployerRegistration {
  mode: string;
  title: string;
  description: string;
  deployer: Deployer;
  detect?: () => Promise<boolean>;
  unavailableReason?: string;
  priority?: number;
  builtIn?: boolean;
  source?: PluginSource;
}

export interface PluginLoadError {
  pluginId: string;
  error: string;
}

export interface InstallerPlugin {
  register(registry: DeployerRegistry): void;
}

export class DeployerRegistry {
  private registrations = new Map<string, DeployerRegistration>();
  private _loadErrors: PluginLoadError[] = [];

  /** Set before calling plugin.register() so that source is auto-applied. */
  currentSource: PluginSource = "built-in";

  register(reg: DeployerRegistration): void {
    if (this.registrations.has(reg.mode)) {
      console.warn(`DeployerRegistry: overwriting existing registration for mode "${reg.mode}"`);
    }
    this.registrations.set(reg.mode, { ...reg, source: reg.source ?? this.currentSource });
  }

  get(mode: string): Deployer | null {
    return this.registrations.get(mode)?.deployer ?? null;
  }

  list(): DeployerRegistration[] {
    return Array.from(this.registrations.values());
  }

  addLoadError(err: PluginLoadError): void {
    this._loadErrors.push(err);
  }

  loadErrors(): PluginLoadError[] {
    return [...this._loadErrors];
  }

  async detect(): Promise<DeployerRegistration[]> {
    const results: DeployerRegistration[] = [];
    for (const reg of this.registrations.values()) {
      if (!reg.detect) {
        results.push(reg);
        continue;
      }
      try {
        if (await reg.detect()) {
          results.push(reg);
        }
      } catch {
        // detect failed — treat as unavailable
      }
    }
    return results;
  }
}

export const registry = new DeployerRegistry();
