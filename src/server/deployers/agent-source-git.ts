import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, realpath, rename, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, normalize, relative, sep } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface AgentSourceGitOptions {
  url: string;
  ref?: string;
  path?: string;
  cacheRoot?: string;
}

export function validateAgentSourceGitUrl(value: string): string {
  const trimmed = value.trim();
  if (/[\r\n\0]/.test(trimmed)) {
    throw new Error("Agent Source Git URL contains invalid characters");
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("Agent Source Git URL must be a valid HTTPS URL");
  }
  if (parsed.protocol !== "https:") {
    throw new Error("Agent Source Git URL must use HTTPS");
  }
  if (parsed.username || parsed.password) {
    throw new Error("Agent Source Git URL must not contain credentials");
  }
  return parsed.toString();
}

function validateRepositoryPath(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  if (/[\r\n\0]/.test(trimmed)) {
    throw new Error("Agent Source Git path contains invalid characters");
  }
  if (isAbsolute(trimmed)) {
    throw new Error("Agent Source Git path must be relative to the repository root");
  }
  const normalized = normalize(trimmed);
  if (normalized === ".." || normalized.startsWith(`..${sep}`)) {
    throw new Error("Agent Source Git path must stay within the repository");
  }
  return normalized === "." ? undefined : normalized;
}

function isWithin(candidate: string, root: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

export async function materializeAgentSourceGit(options: AgentSourceGitOptions): Promise<string> {
  const url = validateAgentSourceGitUrl(options.url);
  const ref = options.ref?.trim() || undefined;
  if (ref && /[\r\n\0]/.test(ref)) {
    throw new Error("Agent Source Git ref contains invalid characters");
  }
  const repositoryPath = validateRepositoryPath(options.path);
  const cacheRoot = options.cacheRoot || join(homedir(), ".openclaw", "installer", "agent-sources");
  const cacheKey = createHash("sha256").update(`${url}\0${ref || ""}`).digest("hex").slice(0, 16);
  const checkoutDir = join(cacheRoot, cacheKey);

  await mkdir(cacheRoot, { recursive: true });
  const tempDir = await mkdtemp(join(cacheRoot, `${cacheKey}-`));
  const args = ["clone", "--depth", "1"];
  if (ref) args.push("--branch", ref);
  args.push(url, tempDir);

  try {
    await execFileAsync("git", args, {
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      maxBuffer: 10 * 1024 * 1024,
    });
    await rm(join(tempDir, ".git"), { recursive: true, force: true });
    await rm(checkoutDir, { recursive: true, force: true });
    await rename(tempDir, checkoutDir);
  } catch (err) {
    await rm(tempDir, { recursive: true, force: true });
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`Unable to clone Agent Source Git repository: ${detail}`, { cause: err });
  }

  const sourceDir = repositoryPath ? join(checkoutDir, repositoryPath) : checkoutDir;
  let sourceRealPath: string;
  try {
    const sourceStats = await stat(sourceDir);
    if (!sourceStats.isDirectory()) throw new Error("not a directory");
    sourceRealPath = await realpath(sourceDir);
  } catch {
    throw new Error(`Agent Source Git path not found: ${repositoryPath || "."}`);
  }
  const checkoutRealPath = await realpath(checkoutDir);
  if (!isWithin(sourceRealPath, checkoutRealPath)) {
    throw new Error("Agent Source Git path must stay within the repository");
  }
  return sourceRealPath;
}
