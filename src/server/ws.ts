import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "node:http";

interface DeploySession {
  ws: WebSocket;
  deployId: string;
}

const sessions = new Map<string, DeploySession>();
const logBuffers = new Map<string, string[]>();
const statuses = new Map<string, string>();
const MAX_LOG_BUFFER_LINES = 500;

export function setupWebSocket(server: Server): WebSocketServer {
  const wss = new WebSocketServer({ server, path: "/ws" });

  wss.on("connection", (ws) => {
    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === "subscribe" && msg.deployId) {
          sessions.set(msg.deployId, { ws, deployId: msg.deployId });
          for (const line of logBuffers.get(msg.deployId) || []) {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: "log", deployId: msg.deployId, line }));
            }
          }
          const status = statuses.get(msg.deployId);
          if (status && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "status", deployId: msg.deployId, status }));
          }
        }
      } catch {
        // ignore invalid messages
      }
    });

    ws.on("close", () => {
      for (const [id, session] of sessions) {
        if (session.ws === ws) {
          sessions.delete(id);
        }
      }
    });
  });

  return wss;
}

export function createLogCallback(deployId: string): (line: string) => void {
  return (line: string) => {
    const buffered = logBuffers.get(deployId) || [];
    buffered.push(line);
    if (buffered.length > MAX_LOG_BUFFER_LINES) {
      buffered.splice(0, buffered.length - MAX_LOG_BUFFER_LINES);
    }
    logBuffers.set(deployId, buffered);

    const session = sessions.get(deployId);
    if (session && session.ws.readyState === WebSocket.OPEN) {
      session.ws.send(JSON.stringify({ type: "log", deployId, line }));
    }
  };
}

export function sendStatus(deployId: string, status: string): void {
  statuses.set(deployId, status);
  const session = sessions.get(deployId);
  if (session && session.ws.readyState === WebSocket.OPEN) {
    session.ws.send(JSON.stringify({ type: "status", deployId, status }));
  }
}
