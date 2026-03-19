import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";
import net from "node:net";

type PortForwardProcess = ChildProcessByStdio<null, Readable, Readable>;

type ManagedPortForward = {
  namespace: string;
  localPort: number;
  process: PortForwardProcess;
  ready: Promise<number>;
};

const portForwards = new Map<string, ManagedPortForward>();

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Failed to allocate local port")));
        return;
      }
      const port = address.port;
      server.close((err) => {
        if (err) reject(err);
        else resolve(port);
      });
    });
  });
}

function waitForPort(localPort: number, timeoutMs = 10000): Promise<void> {
  const started = Date.now();

  return new Promise((resolve, reject) => {
    const tryConnect = () => {
      const socket = net.createConnection({ host: "127.0.0.1", port: localPort });

      socket.once("connect", () => {
        socket.destroy();
        resolve();
      });

      socket.once("error", () => {
        socket.destroy();
        if (Date.now() - started >= timeoutMs) {
          reject(new Error(`Timed out waiting for kubectl port-forward on localhost:${localPort}`));
          return;
        }
        setTimeout(tryConnect, 200);
      });
    };

    tryConnect();
  });
}

async function startPortForward(namespace: string): Promise<ManagedPortForward> {
  const localPort = await getFreePort();
  const child = spawn(
    "kubectl",
    ["port-forward", "svc/openclaw", `${localPort}:18789`, "-n", namespace],
    {
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  const ready = Promise.race<number>([
    waitForPort(localPort).then(() => localPort),
    new Promise<number>((_, reject) => {
      let stderr = "";
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString("utf8");
      });
      child.once("exit", (code) => {
        reject(
          new Error(
            stderr.trim() || `kubectl port-forward exited with code ${code ?? "unknown"}`,
          ),
        );
      });
      child.once("error", reject);
    }),
  ]);

  const managed: ManagedPortForward = {
    namespace,
    localPort,
    process: child,
    ready,
  };

  const cleanup = () => {
    const current = portForwards.get(namespace);
    if (current?.process === child) {
      portForwards.delete(namespace);
    }
  };

  child.once("exit", cleanup);
  child.once("error", cleanup);

  return managed;
}

export async function ensureK8sPortForward(namespace: string): Promise<{ localPort: number; url: string }> {
  const existing = portForwards.get(namespace);
  if (existing) {
    await existing.ready;
    return {
      localPort: existing.localPort,
      url: `http://localhost:${existing.localPort}`,
    };
  }

  const managed = await startPortForward(namespace);
  portForwards.set(namespace, managed);
  const localPort = await managed.ready;
  return {
    localPort,
    url: `http://localhost:${localPort}`,
  };
}

export function stopAllK8sPortForwards(): void {
  for (const managed of portForwards.values()) {
    managed.process.kill();
  }
  portForwards.clear();
}
