import type { DeployConfig } from "./types.js";
import {
  CODEX_AGENT_RUNTIME_ID,
  CODEX_PLUGIN_ID,
  CODEX_PROVIDER,
  DEFAULT_CODEX_MODEL,
  OPENAI_CODEX_PROVIDER,
  OPENAI_PROVIDER,
} from "./openclaw-compat.js";

export {
  CODEX_AGENT_RUNTIME_ID,
  CODEX_PLUGIN_ID,
  CODEX_PROVIDER,
  DEFAULT_CODEX_MODEL,
  OPENAI_CODEX_PROVIDER,
  OPENAI_PROVIDER,
};
export const DEFAULT_CODEX_PROFILE_ID = `${OPENAI_PROVIDER}:chatgpt-default`;
export const CODEX_AUTH_PROFILES_SECRET_KEY = "OPENAI_CODEX_AUTH_PROFILES_JSON";

type CodexCliAuthFile = {
  auth_mode?: unknown;
  tokens?: {
    access_token?: unknown;
    refresh_token?: unknown;
    account_id?: unknown;
  };
};

type AuthProfileStoreJson = {
  version: 1;
  profiles: Record<string, Record<string, unknown>>;
};

type AgentModelCatalogEntry = {
  alias?: string;
  agentRuntime?: { id?: string };
  [key: string]: unknown;
};

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function decodeBase64UrlJson(segment: string): Record<string, unknown> | undefined {
  try {
    const normalized = segment.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const decoded = Buffer.from(padded, "base64").toString("utf8");
    const parsed = JSON.parse(decoded);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}

function resolveJwtExpiresMs(accessToken: string): number {
  const payload = accessToken.split(".")[1];
  if (!payload) {
    return 0;
  }
  const parsed = decodeBase64UrlJson(payload);
  const exp = parsed?.exp;
  return typeof exp === "number" && Number.isFinite(exp) ? exp * 1000 : 0;
}

export function normalizeCodexOauthProfileId(value?: string): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    return DEFAULT_CODEX_PROFILE_ID;
  }
  const separatorIndex = trimmed.indexOf(":");
  if (separatorIndex < 0) {
    return `${OPENAI_PROVIDER}:${trimmed}`;
  }
  const provider = trimmed.slice(0, separatorIndex);
  const profile = trimmed.slice(separatorIndex + 1) || "default";
  if (
    provider === OPENAI_CODEX_PROVIDER
    || provider === CODEX_PROVIDER
    || provider === CODEX_PLUGIN_ID
  ) {
    return `${OPENAI_PROVIDER}:chatgpt-${profile}`;
  }
  return trimmed;
}

export function normalizeCodexModelRef(modelRef?: string): string {
  const trimmed = modelRef?.trim() || DEFAULT_CODEX_MODEL;
  if (trimmed.startsWith(`${CODEX_PROVIDER}/`)) {
    return trimmed;
  }
  if (trimmed.startsWith(`${OPENAI_PROVIDER}/`)) {
    return `${CODEX_PROVIDER}/${trimmed.slice(`${OPENAI_PROVIDER}/`.length)}`;
  }
  if (trimmed.startsWith(`${OPENAI_CODEX_PROVIDER}/`)) {
    return `${CODEX_PROVIDER}/${trimmed.slice(`${OPENAI_CODEX_PROVIDER}/`.length)}`;
  }
  return `${CODEX_PROVIDER}/${trimmed}`;
}

export function codexModelIdFromRef(modelRef?: string): string {
  const ref = normalizeCodexModelRef(modelRef);
  return ref.slice(`${CODEX_PROVIDER}/`.length);
}

export function shouldUseCodexOauth(config: DeployConfig): boolean {
  return config.inferenceProvider === OPENAI_CODEX_PROVIDER
    || Boolean(config.codexOauthProfileId?.trim())
    || Boolean(config.codexOauthAuthJson?.trim())
    || Boolean(config.codexModel?.trim())
    || Boolean(config.codexModels?.length);
}

export function buildCodexOauthCredentialFromCliAuthJson(raw: string): Record<string, unknown> {
  let parsed: CodexCliAuthFile;
  try {
    parsed = JSON.parse(raw) as CodexCliAuthFile;
  } catch {
    throw new Error("Codex OAuth auth.json is not valid JSON");
  }
  if (!parsed || typeof parsed !== "object" || parsed.auth_mode !== "chatgpt") {
    throw new Error('Codex OAuth auth.json must have auth_mode: "chatgpt"');
  }
  const access = readString(parsed.tokens?.access_token);
  const refresh = readString(parsed.tokens?.refresh_token);
  if (!access || !refresh) {
    throw new Error("Codex OAuth auth.json is missing access_token or refresh_token");
  }
  const accountId = readString(parsed.tokens?.account_id);
  return {
    type: "oauth",
    provider: OPENAI_PROVIDER,
    access,
    refresh,
    expires: resolveJwtExpiresMs(access),
    ...(accountId ? { accountId } : {}),
  };
}

export function buildCodexOauthAuthProfileStore(
  config: DeployConfig,
  baseProfiles: Record<string, Record<string, unknown>> = {},
): AuthProfileStoreJson | undefined {
  const raw = config.codexOauthAuthJson?.trim();
  if (!raw) {
    return undefined;
  }
  const profileId = normalizeCodexOauthProfileId(config.codexOauthProfileId);
  return {
    version: 1,
    profiles: {
      ...baseProfiles,
      [profileId]: buildCodexOauthCredentialFromCliAuthJson(raw),
    },
  };
}

export function codexOauthAuthProfileStoreJson(
  config: DeployConfig,
  baseProfiles: Record<string, Record<string, unknown>> = {},
): string | undefined {
  const store = buildCodexOauthAuthProfileStore(config, baseProfiles);
  return store ? JSON.stringify(store, null, 2) : undefined;
}

export function attachCodexOauthConfig(ocConfig: Record<string, unknown>, config: DeployConfig): void {
  if (!shouldUseCodexOauth(config)) {
    return;
  }
  const profileId = normalizeCodexOauthProfileId(config.codexOauthProfileId);
  const auth = (ocConfig.auth as Record<string, unknown> | undefined) || {};
  const profiles = (auth.profiles as Record<string, unknown> | undefined) || {};
  const order = (auth.order as Record<string, string[]> | undefined) || {};
  profiles[profileId] = {
    provider: OPENAI_PROVIDER,
    mode: "oauth",
  };
  order[OPENAI_PROVIDER] = [profileId];
  ocConfig.auth = {
    ...auth,
    profiles,
    order,
  };

  const agents = (ocConfig.agents as Record<string, unknown> | undefined) || {};
  const defaults = (agents.defaults as Record<string, unknown> | undefined) || {};
  const models = (defaults.models as Record<string, AgentModelCatalogEntry> | undefined) || {};
  const codexModelRefs = [
    normalizeCodexModelRef(config.codexModel),
    ...(config.codexModels || []).map((model) => normalizeCodexModelRef(model)),
  ];
  for (const modelRef of codexModelRefs) {
    const existing = models[modelRef] || {};
    models[modelRef] = {
      ...existing,
      alias: existing.alias || codexModelIdFromRef(modelRef),
      agentRuntime: {
        ...(existing.agentRuntime || {}),
        id: CODEX_AGENT_RUNTIME_ID,
      },
    };
  }

  ocConfig.agents = {
    ...agents,
    defaults: {
      ...defaults,
      models,
    },
  };
}
