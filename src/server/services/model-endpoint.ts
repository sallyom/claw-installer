export interface ModelEndpointCatalogEntry {
  id: string;
  name: string;
}

function trimTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 47) {
    end -= 1;
  }
  return end === value.length ? value : value.slice(0, end);
}

export function normalizeModelEndpointBaseUrl(endpoint: string): string {
  const trimmed = trimTrailingSlashes(endpoint.trim());
  if (!trimmed) {
    throw new Error("Model endpoint is required");
  }
  if (trimmed.endsWith("/chat/completions")) {
    return trimmed.slice(0, -"/chat/completions".length);
  }
  if (trimmed.endsWith("/responses")) {
    return trimmed.slice(0, -"/responses".length);
  }
  if (trimmed.endsWith("/models")) {
    return trimmed.slice(0, -"/models".length);
  }
  if (trimmed.endsWith("/v1")) {
    return trimmed;
  }
  return `${trimmed}/v1`;
}

export function normalizeModelEndpointModelsUrl(endpoint: string): string {
  const trimmed = trimTrailingSlashes(endpoint.trim());
  if (!trimmed) {
    throw new Error("Model endpoint is required");
  }
  if (trimmed.endsWith("/models")) {
    return trimmed;
  }
  return `${normalizeModelEndpointBaseUrl(trimmed)}/models`;
}

export function parseModelEndpointCatalog(payload: unknown): ModelEndpointCatalogEntry[] {
  const entries = Array.isArray((payload as { data?: unknown })?.data)
    ? (payload as { data: unknown[] }).data
    : Array.isArray(payload)
      ? payload
      : [];

  const models: ModelEndpointCatalogEntry[] = [];
  const seen = new Set<string>();

  for (const rawEntry of entries) {
    if (!rawEntry || typeof rawEntry !== "object") {
      continue;
    }
    const entry = rawEntry as Record<string, unknown>;
    const id = typeof entry.id === "string" ? entry.id.trim() : "";
    if (!id || seen.has(id)) {
      continue;
    }
    const name = typeof entry.name === "string" && entry.name.trim()
      ? entry.name.trim()
      : typeof entry.display_name === "string" && entry.display_name.trim()
        ? entry.display_name.trim()
        : id;
    seen.add(id);
    models.push({ id, name });
  }

  return models;
}

export async function fetchModelEndpointCatalog(
  endpoint: string,
  apiKey?: string,
): Promise<ModelEndpointCatalogEntry[]> {
  const url = normalizeModelEndpointModelsUrl(endpoint);
  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  const trimmedKey = apiKey?.trim();
  if (trimmedKey) {
    headers.Authorization = `Bearer ${trimmedKey}`;
  }

  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`Model endpoint returned HTTP ${response.status}`);
  }

  const payload = await response.json();
  return parseModelEndpointCatalog(payload);
}
