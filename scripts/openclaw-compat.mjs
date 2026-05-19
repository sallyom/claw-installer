#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

const repoRoot = resolve(import.meta.dirname, "..");
const openclawDir = resolve(argValue("--openclaw-dir", process.env.OPENCLAW_SOURCE_DIR || "../openclaw"));
const checkGenerated = hasFlag("--check-generated");
const compatPath = resolve(repoRoot, "src/server/deployers/openclaw-compat.ts");
const failures = [];

function fail(message) {
  failures.push(message);
}

function read(path) {
  if (!existsSync(path)) {
    throw new Error(`Missing required OpenClaw file: ${path}`);
  }
  return readFileSync(path, "utf8");
}

function matchRequired(text, pattern, label) {
  const match = text.match(pattern);
  if (!match?.[1]) {
    throw new Error(`Could not read ${label} from OpenClaw main`);
  }
  return match[1];
}

function replaceExportConst(source, name, value) {
  const pattern = new RegExp(`export const ${name} = "([^"]*)";`);
  if (!pattern.test(source)) {
    throw new Error(`Missing export const ${name} in ${compatPath}`);
  }
  return source.replace(pattern, `export const ${name} = "${value}";`);
}

function collectContracts() {
  const anthropicCatalog = read(resolve(openclawDir, "extensions/anthropic-vertex/provider-catalog.ts"));
  const anthropicIndex = read(resolve(openclawDir, "extensions/anthropic-vertex/index.ts"));
  const googleManifest = JSON.parse(read(resolve(openclawDir, "extensions/google/openclaw.plugin.json")));
  const codexManifest = JSON.parse(read(resolve(openclawDir, "extensions/codex/openclaw.plugin.json")));
  const googleTransport = read(resolve(openclawDir, "extensions/google/transport-stream.ts"));
  const pluginAutoEnable = read(resolve(openclawDir, "src/config/plugin-auto-enable.core.test.ts"));
  const modelResolver = read(resolve(openclawDir, "src/agents/pi-embedded-runner/model.ts"));

  const anthropicMarker = matchRequired(
    anthropicCatalog,
    /const GCP_VERTEX_CREDENTIALS_MARKER = "([^"]+)";/,
    "Anthropic Vertex credentials marker",
  );
  const googleVertexSetup = googleManifest.setup?.providers?.find((provider) => provider.id === "google-vertex");
  const googleMarker = googleVertexSetup?.authEvidence?.find((entry) => entry.credentialMarker)?.credentialMarker;
  if (googleMarker !== anthropicMarker) {
    fail(`Google Vertex credential marker ${googleMarker || "(missing)"} does not match Anthropic Vertex marker ${anthropicMarker}`);
  }

  if (!googleManifest.providers?.includes("google-vertex")) {
    fail("OpenClaw Google plugin no longer declares the google-vertex provider");
  }
  if (!/"google-vertex"/.test(googleTransport)) {
    fail("OpenClaw Google transport no longer exposes the google-vertex route");
  }
  if (!/Found agents\.defaults\.models/.test(modelResolver) || !/models\.providers/.test(modelResolver)) {
    fail("OpenClaw model resolver no longer exposes the dynamic provider model registration check this installer validates");
  }
  if (!/model: "openai\/[^"]+"/.test(pluginAutoEnable) || !/id: "codex"/.test(pluginAutoEnable)) {
    fail("OpenClaw Codex runtime auto-enable contract was not found");
  }

  return {
    OPENAI_PROVIDER: "openai",
    OPENAI_CODEX_PROVIDER: "openai-codex",
    CODEX_AGENT_RUNTIME_ID: "codex",
    CODEX_PLUGIN_ID: codexManifest.id,
    DEFAULT_CODEX_MODEL: matchRequired(pluginAutoEnable, /model: "openai\/([^"]+)"/, "Codex default OpenAI model"),
    ANTHROPIC_VERTEX_PROVIDER: matchRequired(anthropicIndex, /const PROVIDER_ID = "([^"]+)";/, "Anthropic Vertex provider id"),
    ANTHROPIC_VERTEX_DEFAULT_MODEL: matchRequired(
      anthropicCatalog,
      /export const ANTHROPIC_VERTEX_DEFAULT_MODEL_ID = "([^"]+)";/,
      "Anthropic Vertex default model",
    ),
    ANTHROPIC_VERTEX_API: matchRequired(anthropicCatalog, /api: "([^"]+)"/, "Anthropic Vertex API"),
    GOOGLE_VERTEX_PROVIDER: "google-vertex",
    GOOGLE_VERTEX_API: "google-vertex",
    GCP_VERTEX_CREDENTIALS_MARKER: anthropicMarker,
  };
}

function updateCompatFile(contracts) {
  let source = readFileSync(compatPath, "utf8");
  for (const [name, value] of Object.entries(contracts)) {
    source = replaceExportConst(source, name, value);
  }
  writeFileSync(compatPath, source);
}

function getProviderModelIds(providerConfig) {
  return new Set(
    (Array.isArray(providerConfig?.models) ? providerConfig.models : [])
      .map((entry) => String(entry?.id || "").trim())
      .filter(Boolean),
  );
}

async function validateGeneratedConfig() {
  const helperPath = resolve(repoRoot, "dist/server/deployers/k8s-helpers.js");
  if (!existsSync(helperPath)) {
    throw new Error("dist/server/deployers/k8s-helpers.js is missing; run npm run build before --check-generated");
  }
  const { buildOpenClawConfig, detectUnavailableProvider, resolveSubagentModel } = await import(pathToFileURL(helperPath));

  const codexConfig = {
    mode: "kubernetes",
    agentName: "compat",
    inferenceProvider: "openai-codex",
    codexModels: ["gpt-5.2"],
    openaiApiKey: "fake-openai-api-key",
  };
  const codex = buildOpenClawConfig(codexConfig, "gateway-token");
  const codexPrimary = codex.agents?.defaults?.model?.primary;
  if (codexPrimary !== "openai/gpt-5.5") {
    fail(`Codex OAuth primary model should be openai/gpt-5.5, got ${codexPrimary}`);
  }
  if (codex.agents?.defaults?.models?.["openai/gpt-5.5"]?.agentRuntime?.id !== "codex") {
    fail("Codex OAuth openai/gpt-5.5 model is missing agentRuntime.id=codex");
  }
  if (!codex.plugins?.allow?.includes("openai") || !codex.plugins?.allow?.includes("codex")) {
    fail("Codex OAuth config must allow both openai provider and codex runtime plugins");
  }
  if (codex.plugins?.entries?.openai?.enabled !== true || codex.plugins?.entries?.codex?.enabled !== true) {
    fail("Codex OAuth config must enable both openai provider and codex runtime plugin entries");
  }
  if (detectUnavailableProvider("openai/gpt-5.2", codexConfig)) {
    fail("Configured Codex OAuth OpenAI model was detected as unavailable");
  }
  const subagentModel = resolveSubagentModel(
    { primary: "openai/gpt-5.2" },
    "openai/gpt-5.5",
    codexConfig,
  );
  if (subagentModel.primary !== "openai/gpt-5.2") {
    fail("Configured Codex OAuth subagent model was not preserved");
  }

  const anthropicVertex = buildOpenClawConfig({
    mode: "kubernetes",
    agentName: "compat",
    inferenceProvider: "vertex-anthropic",
    vertexEnabled: true,
    vertexProvider: "anthropic",
    litellmProxy: false,
    googleCloudLocation: "us-central1",
    vertexAnthropicModel: "claude-sonnet-4-6",
  }, "gateway-token");
  const anthropicProvider = anthropicVertex.models?.providers?.["anthropic-vertex"];
  if (anthropicProvider?.api !== "anthropic-messages") {
    fail(`Anthropic Vertex provider API should be anthropic-messages, got ${anthropicProvider?.api || "(missing)"}`);
  }
  if (anthropicProvider?.apiKey !== "gcp-vertex-credentials") {
    fail("Anthropic Vertex provider is missing the gcp-vertex-credentials marker");
  }
  if (!getProviderModelIds(anthropicProvider).has("claude-sonnet-4-6")) {
    fail("Anthropic Vertex provider model list does not include claude-sonnet-4-6");
  }

  const vertexWithCodex = buildOpenClawConfig({
    mode: "kubernetes",
    agentName: "compat",
    inferenceProvider: "vertex-anthropic",
    vertexEnabled: true,
    vertexProvider: "anthropic",
    litellmProxy: false,
    vertexAnthropicModel: "claude-sonnet-4-6",
    codexOauthProfileId: "openai-codex:default",
    codexModel: "gpt-5.5",
  }, "gateway-token");
  if (!vertexWithCodex.plugins?.allow?.includes("openai") || !vertexWithCodex.plugins?.allow?.includes("codex")) {
    fail("Additional Codex OAuth provider must allow both openai and codex plugins");
  }
  if (vertexWithCodex.plugins?.entries?.openai?.enabled !== true || vertexWithCodex.plugins?.entries?.codex?.enabled !== true) {
    fail("Additional Codex OAuth provider must enable both openai and codex plugin entries");
  }
  if (vertexWithCodex.agents?.defaults?.models?.["openai/gpt-5.5"]?.agentRuntime?.id !== "codex") {
    fail("Additional Codex OAuth provider is missing openai/gpt-5.5 with codex runtime");
  }

  const googleVertex = buildOpenClawConfig({
    mode: "kubernetes",
    agentName: "compat",
    inferenceProvider: "vertex-google",
    vertexEnabled: true,
    vertexProvider: "google",
    litellmProxy: false,
    vertexGoogleModel: "gemini-2.5-pro",
  }, "gateway-token");
  const googleProvider = googleVertex.models?.providers?.["google-vertex"];
  if (googleProvider?.api !== "google-vertex") {
    fail(`Google Vertex provider API should be google-vertex, got ${googleProvider?.api || "(missing)"}`);
  }
  if (googleProvider?.apiKey !== "gcp-vertex-credentials") {
    fail("Google Vertex provider is missing the gcp-vertex-credentials marker");
  }
  if (!getProviderModelIds(googleProvider).has("gemini-2.5-pro")) {
    fail("Google Vertex provider model list does not include gemini-2.5-pro");
  }
}

const contracts = collectContracts();
updateCompatFile(contracts);

if (checkGenerated) {
  await validateGeneratedConfig();
}

if (failures.length > 0) {
  console.error("OpenClaw compatibility check failed:");
  for (const message of failures) {
    console.error(`- ${message}`);
  }
  process.exit(1);
}

console.log("OpenClaw compatibility contracts are current.");
