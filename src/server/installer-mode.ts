export type InstallerRunMode = "desktop" | "hosted";

const DEPLOY_MODE_ENV = "OPENCLAW_INSTALLER_DEPLOY_MODES";
const RUN_MODE_ENV = "OPENCLAW_INSTALLER_RUN_MODE";

function parseCsv(value: string | undefined): string[] {
  return (value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function installerRunMode(env: NodeJS.ProcessEnv = process.env): InstallerRunMode {
  return env[RUN_MODE_ENV] === "hosted" ? "hosted" : "desktop";
}

export function allowedDeployModes(env: NodeJS.ProcessEnv = process.env): Set<string> {
  const explicit = parseCsv(env[DEPLOY_MODE_ENV]);
  if (explicit.length > 0) {
    return new Set(explicit);
  }
  return installerRunMode(env) === "hosted"
    ? new Set(["kubernetes", "openshift"])
    : new Set();
}

export function isDeployModeAllowed(mode: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const allowed = allowedDeployModes(env);
  return allowed.size === 0 || allowed.has(mode);
}
