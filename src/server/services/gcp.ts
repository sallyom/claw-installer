import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface GcpDefaults {
  projectId: string | null;
  location: string | null;
  serviceAccountJsonPath: string | null;
  serviceAccountJson: string | null;
  credentialType: string | null; // "service_account", "authorized_user", etc.
  sources: {
    projectId?: string;
    location?: string;
    credentials?: string;
  };
}

const PROJECT_ID_VARS = [
  "GOOGLE_CLOUD_PROJECT",
  "GCLOUD_PROJECT",
  "ANTHROPIC_VERTEX_PROJECT_ID",
  "CLOUD_SDK_PROJECT",
  "GOOGLE_VERTEX_PROJECT",
];

const LOCATION_VARS = [
  "GOOGLE_CLOUD_LOCATION",
  "GOOGLE_VERTEX_LOCATION",
];

function tryParseProjectId(json: string): string {
  try {
    const parsed = JSON.parse(json);
    if (typeof parsed.project_id === "string") return parsed.project_id;
    return typeof parsed.quota_project_id === "string" ? parsed.quota_project_id : "";
  } catch {
    return "";
  }
}

export async function detectGcpDefaults(): Promise<GcpDefaults> {
  const result: GcpDefaults = {
    projectId: null,
    location: null,
    serviceAccountJsonPath: null,
    serviceAccountJson: null,
    credentialType: null,
    sources: {},
  };

  // Detect project ID from env vars
  for (const varName of PROJECT_ID_VARS) {
    const val = process.env[varName];
    if (val) {
      result.projectId = val;
      result.sources.projectId = varName;
      break;
    }
  }

  // Detect location from env vars
  for (const varName of LOCATION_VARS) {
    const val = process.env[varName];
    if (val) {
      result.location = val;
      result.sources.location = varName;
      break;
    }
  }

  // Detect credentials file
  const credPaths: Array<{ path: string; source: string }> = [];

  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    credPaths.push({
      path: process.env.GOOGLE_APPLICATION_CREDENTIALS,
      source: `GOOGLE_APPLICATION_CREDENTIALS (${process.env.GOOGLE_APPLICATION_CREDENTIALS})`,
    });
  }

  const adcPath = join(homedir(), ".config", "gcloud", "application_default_credentials.json");
  credPaths.push({
    path: adcPath,
    source: `default ADC (${adcPath})`,
  });

  // Also check the container-mounted ADC path (from run.sh)
  const containerAdcPath = "/tmp/gcp-adc/application_default_credentials.json";
  if (containerAdcPath !== adcPath) {
    credPaths.push({
      path: containerAdcPath,
      source: "default ADC (mounted from host)",
    });
  }

  for (const { path, source } of credPaths) {
    if (existsSync(path)) {
      try {
        const content = await readFile(path, "utf-8");
        const parsed = JSON.parse(content);
        result.serviceAccountJsonPath = path;
        result.serviceAccountJson = content;
        result.credentialType = typeof parsed.type === "string" ? parsed.type : null;
        result.sources.credentials = source;

        // Extract project ID from JSON if not already found
        if (!result.projectId) {
          const pid = tryParseProjectId(content);
          if (pid) {
            result.projectId = pid;
            result.sources.projectId = `${source} (project_id field)`;
          }
        }
        break;
      } catch {
        // Invalid JSON, skip
      }
    }
  }

  return result;
}

/**
 * Return the default Vertex AI location for a given provider.
 * OpenClaw requires a location to register the provider — without it,
 * the model is reported as "Unknown".
 */
export function defaultVertexLocation(vertexProvider: string): string {
  return vertexProvider === "anthropic" ? "us-east5" : "us-central1";
}
