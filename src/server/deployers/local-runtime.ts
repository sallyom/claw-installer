import { spawn } from "node:child_process";
import type { LogCallback } from "./types.js";

export function parseContainerRunArgs(value?: string): string[] {
  const input = value?.trim();
  if (!input) {
    return [];
  }

  const args: string[] = [];
  let current = "";
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let escaping = false;

  const pushCurrent = () => {
    if (current) {
      args.push(current);
      current = "";
    }
  };

  for (const char of input) {
    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }

    if (char === "\\") {
      if (inSingleQuote) {
        current += char;
      } else {
        escaping = true;
      }
      continue;
    }

    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      continue;
    }

    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }

    if (!inSingleQuote && !inDoubleQuote && /\s/.test(char)) {
      pushCurrent();
      continue;
    }

    current += char;
  }

  if (escaping) {
    throw new Error("Invalid container run args: trailing escape");
  }
  if (inSingleQuote || inDoubleQuote) {
    throw new Error("Invalid container run args: unterminated quote");
  }

  pushCurrent();
  return args;
}

export function runCommand(
  cmd: string,
  args: string[],
  log: LogCallback,
): Promise<{ code: number }> {
  return new Promise((resolve, reject) => {
    const redacted = redactCommandArgs(args);
    log(`$ ${cmd} ${redacted.join(" ")}`);
    const proc = spawn(cmd, args);
    proc.stdout.on("data", (data: Buffer) => {
      for (const line of data.toString().split("\n")) {
        if (line) log(line);
      }
    });
    proc.stderr.on("data", (data: Buffer) => {
      for (const line of data.toString().split("\n")) {
        if (line) log(line);
      }
    });
    proc.on("error", reject);
    proc.on("close", (code) => resolve({ code: code ?? 1 }));
  });
}

export function redactCommandArgs(args: string[]): string[] {
  return args.map((arg, index) => {
    if (args[index - 1] === "-c") {
      return "<shell script redacted>";
    }
    if (args[index - 1] !== "-e") {
      return arg;
    }
    const equalsIndex = arg.indexOf("=");
    if (equalsIndex < 1) {
      return arg;
    }
    const key = arg.slice(0, equalsIndex);
    if (!isSensitiveEnvKey(key)) {
      return arg;
    }
    return `${key}=***`;
  });
}

function isSensitiveEnvKey(key: string): boolean {
  return /(^|_)(API_KEY|TOKEN|SECRET|PASSWORD|PRIVATE_KEY|IDENTITY|CERTIFICATE|KNOWN_HOSTS)$/i.test(key);
}

export function bindMountSpec(hostPath: string, containerPath: string, options?: string): string {
  const optionParts = options ? options.split(",").filter(Boolean) : [];
  if (process.platform === "linux") {
    optionParts.push("Z");
  }
  const suffix = optionParts.length > 0 ? `:${optionParts.join(",")}` : "";
  return `${hostPath}:${containerPath}${suffix}`;
}

export function normalizeLocalFileOwner(value?: string): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  if (!/^[0-9]+(?::[0-9]+)?$/.test(trimmed)) {
    throw new Error("Invalid local file owner: expected UID or UID:GID");
  }
  return trimmed;
}

export function localGatewayUserArgs(value?: string): string[] {
  const owner = normalizeLocalFileOwner(value);
  return owner ? ["--user", owner] : [];
}

export function localStateMaintenanceUserArgs(value?: string): string[] {
  normalizeLocalFileOwner(value);
  return ["--user", "0"];
}

export function localMaintenanceEntrypointArgs(): string[] {
  return ["--entrypoint", ""];
}

export function runtimeOwnershipFixupCommand(localFileOwner?: string): string {
  const owner = normalizeLocalFileOwner(localFileOwner) || "node:node";
  // Fix for #71: strip world bits after chown so other users/processes on the
  // host cannot read credentials (gateway tokens, API key refs) from openclaw.json
  // or traverse the state directory.
  return [
    `chown ${owner} /home/node 2>/dev/null || true`,
    `chown -R ${owner} /home/node/.openclaw /home/node/.npm /home/node/.cache /home/node/.config 2>/dev/null || true`,
    "chmod -R o-rwx /home/node/.openclaw 2>/dev/null || true",
    "chmod 700 /home/node/.openclaw 2>/dev/null || true",
    "chmod 700 /home/node/.openclaw/tmp /home/node/.npm /home/node/.cache /home/node/.config /home/node/.config/openclaw 2>/dev/null || true",
    "chmod 600 /home/node/.openclaw/openclaw.json 2>/dev/null || true",
  ].join(" && ");
}
