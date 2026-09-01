import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

import { env } from "@/env";

/**
 * Server-side secret handling.
 *
 * Two distinct jobs, deliberately kept apart:
 *
 *   encrypt/decrypt — for secrets we must be able to *use* later (tenant AI API
 *   keys, Google OAuth refresh tokens). AES-256-GCM, authenticated.
 *
 *   hashSecret      — for secrets we only ever need to *verify* (MCP API keys,
 *   invitation tokens). One-way; the raw value is shown once and never stored.
 */

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // 96-bit nonce, the GCM standard
const AUTH_TAG_LENGTH = 16;
const VERSION = "v1";

function key(): Buffer {
  return Buffer.from(env.ENCRYPTION_KEY, "base64");
}

/**
 * Returns `v1.<iv>.<authTag>.<ciphertext>`, all base64url.
 * The version prefix lets us rotate the scheme without a data migration.
 */
export function encryptSecret(plaintext: string): string {
  if (!plaintext) throw new Error("Refusing to encrypt an empty secret");

  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key(), iv, { authTagLength: AUTH_TAG_LENGTH });
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [
    VERSION,
    iv.toString("base64url"),
    authTag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

export function decryptSecret(envelope: string): string {
  const parts = envelope.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error("Malformed secret envelope");
  }

  const [, ivPart, tagPart, dataPart] = parts;
  const decipher = createDecipheriv(ALGORITHM, key(), Buffer.from(ivPart, "base64url"), {
    authTagLength: AUTH_TAG_LENGTH,
  });
  decipher.setAuthTag(Buffer.from(tagPart, "base64url"));

  return Buffer.concat([
    decipher.update(Buffer.from(dataPart, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

/** SHA-256, hex. Used for invitation tokens and MCP key lookup. */
export function hashSecret(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

/** Constant-time comparison of two hex digests. */
export function verifyHash(raw: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashSecret(raw), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

/** A URL-safe random token. 32 bytes = 256 bits of entropy. */
export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/**
 * Mints an MCP API key.
 *
 * The prefix is stored in the clear so keys are identifiable in lists and logs;
 * only the hash of the full secret is persisted.
 */
export function generateApiKey(): { raw: string; prefix: string; hash: string } {
  const scope = env.APP_ENV === "production" ? "live" : "test";
  const body = generateToken(32);
  const raw = `sco_${scope}_${body}`;
  return {
    raw,
    prefix: raw.slice(0, 16),
    hash: hashSecret(raw),
  };
}

/** Last four characters of a provider key, for "…a1b2" style display. */
export function secretHint(raw: string): string {
  return raw.length <= 4 ? "****" : raw.slice(-4);
}
