export type DeployMode = "local" | "kubernetes" | "ssh" | "fleet";

export interface DeployConfig {
  mode: DeployMode;
  // Common
  agentName: string;
  agentDisplayName: string;
  prefix?: string;
  // Model provider (all optional — without them, agents use in-cluster model)
  anthropicApiKey?: string;
  openaiApiKey?: string;
  agentModel?: string;
  modelEndpoint?: string;
  // Vertex AI
  vertexEnabled?: boolean;
  vertexProvider?: "google" | "anthropic"; // google = Gemini, anthropic = Claude via Vertex
  googleCloudProject?: string;
  googleCloudLocation?: string;
  gcpServiceAccountJson?: string; // raw JSON content of GCP service account key file
  gcpServiceAccountPath?: string; // absolute path to SA JSON file (server reads it)
  // LiteLLM proxy sidecar (default: true when Vertex + SA JSON)
  litellmProxy?: boolean;
  litellmImage?: string;
  // Agent security
  cronEnabled?: boolean; // default: false (opt-in)
  subagentPolicy?: "none" | "self" | "unrestricted"; // default: "none"
  // Telegram channel
  telegramEnabled?: boolean;
  telegramBotToken?: string;
  telegramAllowFrom?: string; // comma-separated user IDs
  // Local mode
  containerRuntime?: "podman" | "docker";
  image?: string;
  port?: number;
  agentSourceDir?: string; // Host directory with agents/ and skills/ to provision
  // Kubernetes mode
  namespace?: string;
  withA2a?: boolean;
  // SSH mode
  sshHost?: string;
  sshUser?: string;
  sshKeyPath?: string;
}

export interface DeployResult {
  id: string;
  mode: DeployMode;
  status: "running" | "stopped" | "failed" | "deploying" | "error" | "unknown";
  config: DeployConfig;
  startedAt: string;
  url?: string;
  containerId?: string;
  error?: string;
  // K8s-specific
  statusDetail?: string;
  pods?: Array<{
    name: string;
    phase: string;
    ready: boolean;
    restarts: number;
    containerStatus: string;
    message: string;
  }>;
}

export type LogCallback = (line: string) => void;

export interface Deployer {
  deploy(config: DeployConfig, log: LogCallback): Promise<DeployResult>;
  start(result: DeployResult, log: LogCallback): Promise<DeployResult>;
  status(result: DeployResult): Promise<DeployResult>;
  stop(result: DeployResult, log: LogCallback): Promise<void>;
  teardown(result: DeployResult, log: LogCallback): Promise<void>;
}
