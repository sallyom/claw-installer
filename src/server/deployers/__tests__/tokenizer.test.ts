import { describe, it, expect } from "vitest";
import nacl from "tweetnacl";
import { blake2b } from "blakejs";
import {
  generateTokenizerOpenKey,
  deriveTokenizerSealKey,
  sealCredential,
  shouldUseTokenizer,
  tokenizerAgentEnv,
  generateTokenizerSkill,
  TOKENIZER_PORT,
  type SealedCredential,
} from "../tokenizer.js";
import type { DeployConfig } from "../types.js";

// ── Helpers ─────────────────────────────────────────────────────────

/** Recreate the NaCl sealed-box open (decrypt) for verification. */
function sealedBoxOpen(
  sealed: Uint8Array,
  recipientPublicKey: Uint8Array,
  recipientSecretKey: Uint8Array,
): Uint8Array | null {
  if (sealed.length < 48) return null; // 32 (ephemeral pk) + 16 (mac)
  const ephemeralPk = sealed.subarray(0, 32);
  const ct = sealed.subarray(32);

  const nonceInput = new Uint8Array(64);
  nonceInput.set(ephemeralPk, 0);
  nonceInput.set(recipientPublicKey, 32);
  const nonce = blake2b(nonceInput, undefined, 24);

  return nacl.box.open(ct, nonce, ephemeralPk, recipientSecretKey);
}

function minimalConfig(overrides: Partial<DeployConfig> = {}): DeployConfig {
  return {
    mode: "local",
    agentName: "test",
    agentDisplayName: "Test",
    ...overrides,
  };
}

// ── Key management ──────────────────────────────────────────────────

describe("generateTokenizerOpenKey", () => {
  it("returns a 64-char hex string (32 bytes)", () => {
    const key = generateTokenizerOpenKey();
    expect(key).toMatch(/^[0-9a-f]{64}$/);
  });

  it("returns unique keys on each call", () => {
    const a = generateTokenizerOpenKey();
    const b = generateTokenizerOpenKey();
    expect(a).not.toBe(b);
  });
});

describe("deriveTokenizerSealKey", () => {
  it("returns a 64-char hex string (32 bytes)", () => {
    const openKey = generateTokenizerOpenKey();
    const sealKey = deriveTokenizerSealKey(openKey);
    expect(sealKey).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic for the same open key", () => {
    const openKey = generateTokenizerOpenKey();
    const a = deriveTokenizerSealKey(openKey);
    const b = deriveTokenizerSealKey(openKey);
    expect(a).toBe(b);
  });

  it("produces different seal keys for different open keys", () => {
    const a = deriveTokenizerSealKey(generateTokenizerOpenKey());
    const b = deriveTokenizerSealKey(generateTokenizerOpenKey());
    expect(a).not.toBe(b);
  });

  it("matches tweetnacl key pair derivation", () => {
    const openKey = generateTokenizerOpenKey();
    const sealKey = deriveTokenizerSealKey(openKey);

    const keyPair = nacl.box.keyPair.fromSecretKey(
      new Uint8Array(Buffer.from(openKey, "hex")),
    );
    const expected = Buffer.from(keyPair.publicKey).toString("hex");
    expect(sealKey).toBe(expected);
  });
});

// ── Sealed box round-trip ───────────────────────────────────────────

describe("sealCredential", () => {
  it("produces a SealedCredential with all fields", () => {
    const openKey = generateTokenizerOpenKey();
    const sealKey = deriveTokenizerSealKey(openKey);

    const result = sealCredential(
      {
        name: "github",
        secret: "ghp_test123",
        allowedHosts: ["api.github.com"],
      },
      sealKey,
    );

    expect(result.name).toBe("github");
    expect(result.allowedHosts).toEqual(["api.github.com"]);
    expect(result.sealedToken).toBeTruthy();
    expect(result.bearerPassword).toMatch(/^[0-9a-f]{64}$/);
  });

  it("sealed token can be decrypted with the open key", () => {
    const openKey = generateTokenizerOpenKey();
    const sealKey = deriveTokenizerSealKey(openKey);

    const result = sealCredential(
      {
        name: "test",
        secret: "my-secret-token",
        allowedHosts: ["api.example.com"],
      },
      sealKey,
    );

    // Decrypt the sealed token
    const sealedBytes = new Uint8Array(
      Buffer.from(result.sealedToken, "base64"),
    );
    const pubKey = new Uint8Array(Buffer.from(sealKey, "hex"));
    const privKey = new Uint8Array(Buffer.from(openKey, "hex"));

    const plaintext = sealedBoxOpen(sealedBytes, pubKey, privKey);
    expect(plaintext).not.toBeNull();

    const secret = JSON.parse(new TextDecoder().decode(plaintext!));
    expect(secret.inject_processor.token).toBe("my-secret-token");
    expect(secret.allowed_hosts).toEqual(["api.example.com"]);
    expect(secret.bearer_auth.digest).toBeTruthy();
  });

  it("includes custom header dst/fmt when provided", () => {
    const openKey = generateTokenizerOpenKey();
    const sealKey = deriveTokenizerSealKey(openKey);

    const result = sealCredential(
      {
        name: "custom",
        secret: "tok",
        allowedHosts: ["api.test.com"],
        headerDst: "X-Custom-Token",
        headerFmt: "token=%s",
      },
      sealKey,
    );

    const sealedBytes = new Uint8Array(
      Buffer.from(result.sealedToken, "base64"),
    );
    const pubKey = new Uint8Array(Buffer.from(sealKey, "hex"));
    const privKey = new Uint8Array(Buffer.from(openKey, "hex"));

    const plaintext = sealedBoxOpen(sealedBytes, pubKey, privKey);
    const secret = JSON.parse(new TextDecoder().decode(plaintext!));
    expect(secret.inject_processor.dst).toBe("X-Custom-Token");
    expect(secret.inject_processor.fmt).toBe("token=%s");
  });

  it("bearer_auth digest is SHA-256 of the bearer password", async () => {
    const { createHash } = await import("node:crypto");
    const openKey = generateTokenizerOpenKey();
    const sealKey = deriveTokenizerSealKey(openKey);

    const result = sealCredential(
      {
        name: "test",
        secret: "tok",
        allowedHosts: ["example.com"],
      },
      sealKey,
    );

    const sealedBytes = new Uint8Array(
      Buffer.from(result.sealedToken, "base64"),
    );
    const pubKey = new Uint8Array(Buffer.from(sealKey, "hex"));
    const privKey = new Uint8Array(Buffer.from(openKey, "hex"));
    const plaintext = sealedBoxOpen(sealedBytes, pubKey, privKey);
    const secret = JSON.parse(new TextDecoder().decode(plaintext!));

    const expectedDigest = createHash("sha256")
      .update(result.bearerPassword)
      .digest("base64");
    expect(secret.bearer_auth.digest).toBe(expectedDigest);
  });

  it("produces different sealed tokens for the same input (ephemeral keys)", () => {
    const openKey = generateTokenizerOpenKey();
    const sealKey = deriveTokenizerSealKey(openKey);
    const entry = {
      name: "test",
      secret: "tok",
      allowedHosts: ["example.com"],
    };

    const a = sealCredential(entry, sealKey);
    const b = sealCredential(entry, sealKey);
    // Sealed tokens differ (different ephemeral keys)
    expect(a.sealedToken).not.toBe(b.sealedToken);
    // Bearer passwords differ (different random values)
    expect(a.bearerPassword).not.toBe(b.bearerPassword);
  });
});

// ── shouldUseTokenizer ──────────────────────────────────────────────

describe("shouldUseTokenizer", () => {
  it("returns false when not enabled", () => {
    expect(shouldUseTokenizer(minimalConfig())).toBe(false);
  });

  it("returns false when enabled but no credentials", () => {
    expect(
      shouldUseTokenizer(
        minimalConfig({ tokenizerEnabled: true, tokenizerCredentials: [] }),
      ),
    ).toBe(false);
  });

  it("returns true when enabled with credentials", () => {
    expect(
      shouldUseTokenizer(
        minimalConfig({
          tokenizerEnabled: true,
          tokenizerCredentials: [
            { name: "test", secret: "tok", allowedHosts: ["example.com"] },
          ],
        }),
      ),
    ).toBe(true);
  });
});

// ── tokenizerAgentEnv ───────────────────────────────────────────────

describe("tokenizerAgentEnv", () => {
  it("includes proxy URL and seal key", () => {
    const sealed: SealedCredential[] = [];
    const env = tokenizerAgentEnv(sealed, "aabbccdd");
    expect(env.TOKENIZER_PROXY_URL).toBe(`http://localhost:${TOKENIZER_PORT}`);
    expect(env.TOKENIZER_SEAL_KEY).toBe("aabbccdd");
  });

  it("generates correctly named env vars for each credential", () => {
    const sealed: SealedCredential[] = [
      {
        name: "github",
        allowedHosts: ["api.github.com"],
        sealedToken: "sealed-1",
        bearerPassword: "pass-1",
      },
      {
        name: "slack-api",
        allowedHosts: ["slack.com"],
        sealedToken: "sealed-2",
        bearerPassword: "pass-2",
      },
    ];
    const env = tokenizerAgentEnv(sealed, "key");

    expect(env.TOKENIZER_CRED_GITHUB).toBe("sealed-1");
    expect(env.TOKENIZER_AUTH_GITHUB).toBe("pass-1");
    expect(env.TOKENIZER_CRED_SLACK_API).toBe("sealed-2");
    expect(env.TOKENIZER_AUTH_SLACK_API).toBe("pass-2");
  });

  it("sanitizes non-alphanumeric chars in names to underscores", () => {
    const sealed: SealedCredential[] = [
      {
        name: "my.api-key",
        allowedHosts: ["x.com"],
        sealedToken: "s",
        bearerPassword: "p",
      },
    ];
    const env = tokenizerAgentEnv(sealed, "key");
    expect(env.TOKENIZER_CRED_MY_API_KEY).toBe("s");
    expect(env.TOKENIZER_AUTH_MY_API_KEY).toBe("p");
  });
});

// ── generateTokenizerSkill ──────────────────────────────────────────

describe("generateTokenizerSkill", () => {
  it("contains proxy URL", () => {
    const skill = generateTokenizerSkill([]);
    expect(skill).toContain(`http://localhost:${TOKENIZER_PORT}`);
  });

  it("lists each credential with env var names", () => {
    const sealed: SealedCredential[] = [
      {
        name: "github",
        allowedHosts: ["api.github.com"],
        sealedToken: "s",
        bearerPassword: "p",
      },
    ];
    const skill = generateTokenizerSkill(sealed);
    expect(skill).toContain("### github");
    expect(skill).toContain("TOKENIZER_CRED_GITHUB");
    expect(skill).toContain("TOKENIZER_AUTH_GITHUB");
    expect(skill).toContain("api.github.com");
  });

  it("includes curl example with the first credential", () => {
    const sealed: SealedCredential[] = [
      {
        name: "stripe",
        allowedHosts: ["api.stripe.com"],
        sealedToken: "s",
        bearerPassword: "p",
      },
    ];
    const skill = generateTokenizerSkill(sealed);
    expect(skill).toContain("curl -x");
    expect(skill).toContain("TOKENIZER_CRED_STRIPE");
    expect(skill).toContain("api.stripe.com");
  });

  it("explains http:// requirement and TLS upgrade", () => {
    const skill = generateTokenizerSkill([]);
    expect(skill).toContain("http://");
    expect(skill).toContain("HTTPS");
  });
});
