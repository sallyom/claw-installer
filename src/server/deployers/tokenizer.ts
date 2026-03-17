import { randomBytes, createHash } from "node:crypto";
import nacl from "tweetnacl";
import { blake2b } from "blakejs";
import type { DeployConfig } from "./types.js";

// ── Constants ────────────────────────────────────────────────────────

/** Default image — no published image exists, so users build from GitHub repo. */
export const TOKENIZER_IMAGE = "ghcr.io/superfly/tokenizer:latest";
export const TOKENIZER_PORT = 4001;

// ── Key management ──────────────────────────────────────────────────

/** Generate a 32-byte hex-encoded private ("open") key. */
export function generateTokenizerOpenKey(): string {
  return randomBytes(32).toString("hex");
}

/** Derive the public ("seal") key from the private ("open") key. */
export function deriveTokenizerSealKey(openKeyHex: string): string {
  const privBytes = Buffer.from(openKeyHex, "hex");
  const keyPair = nacl.box.keyPair.fromSecretKey(new Uint8Array(privBytes));
  return Buffer.from(keyPair.publicKey).toString("hex");
}

// ── NaCl sealed box ─────────────────────────────────────────────────
// crypto_box_seal: anonymous public-key encryption compatible with
// golang.org/x/crypto/nacl/box.SealAnonymous used by Tokenizer.

/**
 * NaCl sealed box encryption (crypto_box_seal).
 *
 * Construction:
 *   1. Generate ephemeral X25519 key pair
 *   2. nonce = blake2b(ek_pk || recipient_pk, outputLength=24)
 *   3. ct = nacl.box(msg, nonce, recipient_pk, ek_sk)
 *   4. output = ek_pk || ct
 */
function sealedBox(message: Uint8Array, recipientPublicKey: Uint8Array): Uint8Array {
  const ephemeral = nacl.box.keyPair();

  // Derive nonce: blake2b(ek_pk || recipient_pk) truncated to 24 bytes
  const nonceInput = new Uint8Array(64);
  nonceInput.set(ephemeral.publicKey, 0);
  nonceInput.set(recipientPublicKey, 32);
  const nonce = blake2b(nonceInput, undefined, 24);

  // Encrypt
  const ct = nacl.box(message, nonce, recipientPublicKey, ephemeral.secretKey);
  if (!ct) throw new Error("nacl.box encryption failed");

  // Prepend ephemeral public key
  const out = new Uint8Array(32 + ct.length);
  out.set(ephemeral.publicKey, 0);
  out.set(ct, 32);
  return out;
}

// ── Secret building & sealing ───────────────────────────────────────

export interface TokenizerCredentialEntry {
  /** Human-readable name, e.g. "github" */
  name: string;
  /** Raw API key / token (never sent to the agent) */
  secret: string;
  /** Hosts this credential may be used against, e.g. ["api.github.com"] */
  allowedHosts: string[];
  /** Target header (default: "Authorization") */
  headerDst?: string;
  /** Header format string (default: "Bearer %s") */
  headerFmt?: string;
}

export interface SealedCredential {
  name: string;
  allowedHosts: string[];
  /** Base64 NaCl sealed box containing the secret JSON */
  sealedToken: string;
  /** Plaintext password the agent sends in Proxy-Authorization */
  bearerPassword: string;
}

/** Build the Tokenizer secret JSON wire format and seal it. */
export function sealCredential(
  entry: TokenizerCredentialEntry,
  sealKeyHex: string,
): SealedCredential {
  const bearerPassword = randomBytes(32).toString("hex");
  const digest = createHash("sha256").update(bearerPassword).digest("base64");

  const secretObj: Record<string, unknown> = {
    inject_processor: {
      token: entry.secret,
      ...(entry.headerDst ? { dst: entry.headerDst } : {}),
      ...(entry.headerFmt ? { fmt: entry.headerFmt } : {}),
    },
    bearer_auth: { digest },
    allowed_hosts: entry.allowedHosts,
  };

  const plaintext = new TextEncoder().encode(JSON.stringify(secretObj));
  const sealKey = new Uint8Array(Buffer.from(sealKeyHex, "hex"));
  const sealed = sealedBox(plaintext, sealKey);

  return {
    name: entry.name,
    allowedHosts: entry.allowedHosts,
    sealedToken: Buffer.from(sealed).toString("base64"),
    bearerPassword,
  };
}

// ── Config helpers ──────────────────────────────────────────────────

/** Returns true when the Tokenizer proxy should be deployed. */
export function shouldUseTokenizer(config: DeployConfig): boolean {
  return !!(config.tokenizerEnabled && config.tokenizerCredentials?.length);
}

/** Environment variables passed to the gateway container. */
export function tokenizerAgentEnv(
  sealed: SealedCredential[],
  sealKeyHex: string,
): Record<string, string> {
  const env: Record<string, string> = {
    TOKENIZER_PROXY_URL: `http://localhost:${TOKENIZER_PORT}`,
    TOKENIZER_SEAL_KEY: sealKeyHex,
  };
  for (const s of sealed) {
    const key = s.name.toUpperCase().replace(/[^A-Z0-9]/g, "_");
    env[`TOKENIZER_CRED_${key}`] = s.sealedToken;
    env[`TOKENIZER_AUTH_${key}`] = s.bearerPassword;
  }
  return env;
}

// ── Skill generation ────────────────────────────────────────────────

/** Generate SKILL.md content that teaches the agent how to use Tokenizer. */
export function generateTokenizerSkill(sealed: SealedCredential[]): string {
  const lines: string[] = [
    "# Tokenizer — Secure API Credential Proxy",
    "",
    "## What is this?",
    "",
    "A Tokenizer proxy (https://github.com/superfly/tokenizer) is running as",
    "a sidecar alongside this agent. It lets you make authenticated HTTP",
    "requests to external APIs **without ever seeing the actual credentials**.",
    "The credentials are encrypted; the proxy decrypts them and injects the",
    "real tokens into your outgoing requests.",
    "",
    "## Proxy URL",
    "",
    "`http://localhost:" + TOKENIZER_PORT + "`",
    "",
    "## Available Credentials",
    "",
  ];

  for (const s of sealed) {
    const key = s.name.toUpperCase().replace(/[^A-Z0-9]/g, "_");
    lines.push(`### ${s.name}`);
    lines.push("");
    lines.push(`- **Allowed hosts**: ${s.allowedHosts.join(", ")}`);
    lines.push(`- **Sealed token env var**: \`TOKENIZER_CRED_${key}\``);
    lines.push(`- **Auth password env var**: \`TOKENIZER_AUTH_${key}\``);
    lines.push("");
  }

  lines.push(
    "## How to make requests",
    "",
    "Route HTTP requests through the Tokenizer proxy, including the sealed",
    "token and bearer password in the request headers.",
    "",
    "### Important rules",
    "",
    "1. Use `http://` (not `https://`) for the target URL in the request.",
    "   The proxy upgrades all upstream connections to HTTPS automatically.",
    "2. Each sealed token is restricted to its listed allowed hosts.",
    "3. The proxy blocks connections to private/loopback addresses — it only",
    "   works for external (public) APIs.",
    "",
    "### curl example",
    "",
  );

  if (sealed.length > 0) {
    const ex = sealed[0];
    const key = ex.name.toUpperCase().replace(/[^A-Z0-9]/g, "_");
    const host = ex.allowedHosts[0] || "api.example.com";
    lines.push(
      "```bash",
      `curl -x http://localhost:${TOKENIZER_PORT} \\`,
      `  -H "Proxy-Tokenizer: $TOKENIZER_CRED_${key}" \\`,
      `  -H "Proxy-Authorization: Bearer $TOKENIZER_AUTH_${key}" \\`,
      `  http://${host}/`,
      "```",
      "",
    );
  }

  lines.push(
    "### Node.js / fetch example",
    "",
    "```javascript",
    "// The Tokenizer acts as an HTTP proxy. Set the proxy headers and",
    "// point the request at the target host via the proxy.",
    `const proxyUrl = process.env.TOKENIZER_PROXY_URL; // http://localhost:${TOKENIZER_PORT}`,
    "",
    "// Build the request through the proxy",
    "const resp = await fetch(`http://api.example.com/endpoint`, {",
    "  headers: {",
    "    'Proxy-Tokenizer': process.env.TOKENIZER_CRED_EXAMPLE,",
    "    'Proxy-Authorization': `Bearer ${process.env.TOKENIZER_AUTH_EXAMPLE}`,",
    "  },",
    "  // In Node.js, configure HTTP_PROXY=http://localhost:" + TOKENIZER_PORT,
    "  // or use an HTTP proxy agent library.",
    "});",
    "```",
    "",
    "### Python requests example",
    "",
    "```python",
    "import os, requests",
    "",
    `proxies = {"http": "http://localhost:${TOKENIZER_PORT}"}`,
    "headers = {",
    '    "Proxy-Tokenizer": os.environ["TOKENIZER_CRED_EXAMPLE"],',
    '    "Proxy-Authorization": f"Bearer {os.environ[\'TOKENIZER_AUTH_EXAMPLE\']}",',
    "}",
    '# Use http:// — the proxy upgrades to HTTPS automatically',
    'resp = requests.get("http://api.example.com/endpoint",',
    "                     proxies=proxies, headers=headers)",
    "```",
    "",
    "### Shell / environment variable approach",
    "",
    "You can also set `http_proxy` so that all HTTP requests go through the proxy:",
    "",
    "```bash",
    `export http_proxy=http://localhost:${TOKENIZER_PORT}`,
    "```",
    "",
    "Then include the Proxy-Tokenizer and Proxy-Authorization headers in each request.",
    "",
  );

  return lines.join("\n");
}
