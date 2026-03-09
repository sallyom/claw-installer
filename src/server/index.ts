import express from "express";
import { createServer } from "node:http";
import { join, resolve } from "node:path";
import { existsSync } from "node:fs";
import { setupWebSocket } from "./ws.js";
import deployRoutes from "./routes/deploy.js";
import statusRoutes from "./routes/status.js";
import agentsRoutes from "./routes/agents.js";
import { detectRuntime } from "./services/container.js";
import { isClusterReachable, isOpenShift, currentContext } from "./services/k8s.js";
import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";

const app = express();
const server = createServer(app);
const PORT = parseInt(process.env.PORT ?? "3000", 10);

app.use(express.json());

// API routes
app.use("/api/deploy", deployRoutes);
app.use("/api/instances", statusRoutes);
app.use("/api/agents", agentsRoutes);

// Health check + environment defaults for the frontend
app.get("/api/health", async (_req, res) => {
  const runtime = await detectRuntime();
  const k8sReachable = await isClusterReachable();
  const openShift = k8sReachable ? await isOpenShift() : false;

  res.json({
    status: "ok",
    containerRuntime: runtime,
    k8sAvailable: k8sReachable,
    k8sContext: k8sReachable ? currentContext() : "",
    isOpenShift: openShift,
    version: "0.1.0",
    defaults: {
      hasAnthropicKey: !!process.env.ANTHROPIC_API_KEY,
      hasOpenaiKey: !!process.env.OPENAI_API_KEY,
      hasTelegramToken: !!process.env.TELEGRAM_BOT_TOKEN,
      telegramAllowFrom: process.env.TELEGRAM_ALLOW_FROM || "",
      modelEndpoint: process.env.MODEL_ENDPOINT || "",
      prefix: process.env.OPENCLAW_PREFIX || "",
      image: process.env.OPENCLAW_IMAGE || "",
    },
  });
});

// List saved instance configs from ~/.openclaw-installer/*/. env
app.get("/api/configs", async (_req, res) => {
  const baseDir = join(homedir(), ".openclaw-installer");
  try {
    const entries = await readdir(baseDir, { withFileTypes: true });
    const configs: Array<{ name: string; vars: Record<string, string> }> = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        const envContent = await readFile(join(baseDir, entry.name, ".env"), "utf8");
        const vars: Record<string, string> = {};
        for (const line of envContent.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith("#")) continue;
          const eqIdx = trimmed.indexOf("=");
          if (eqIdx < 0) continue;
          vars[trimmed.slice(0, eqIdx)] = trimmed.slice(eqIdx + 1);
        }
        configs.push({ name: entry.name, vars });
      } catch {
        // No .env in this directory, skip
      }
    }
    res.json(configs);
  } catch {
    res.json([]);
  }
});

// Serve frontend — check both dev (vite build output) and production (Dockerfile) paths
const clientCandidates = [
  resolve(import.meta.dirname, "..", "..", "dist", "client"), // from src/server/ after vite build
  join(import.meta.dirname, "..", "client"),                   // from dist/server/ in container
];
const clientDir = clientCandidates.find((dir) =>
  existsSync(join(dir, "index.html")),
);
if (clientDir) {
  app.use(
    express.static(clientDir, {
      setHeaders: (res, filePath) => {
        if (filePath.endsWith(".js")) res.setHeader("Content-Type", "application/javascript");
        else if (filePath.endsWith(".css")) res.setHeader("Content-Type", "text/css");
      },
    }),
  );
  app.get("*", (_req, res) => {
    res.sendFile(join(clientDir, "index.html"));
  });
}

// WebSocket
setupWebSocket(server);

server.listen(PORT, "0.0.0.0", () => {
  console.log(`OpenClaw Installer running at http://0.0.0.0:${PORT}`);
});
