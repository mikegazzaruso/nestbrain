// Encrypted persistence for OAuth tokens.
//
// Uses Electron's safeStorage, which is backed by:
//   - macOS:   Keychain Services
//   - Windows: DPAPI
//   - Linux:   kwallet / libsecret (with a basic fallback when no keyring)
//
// We refuse to write credentials at all if real OS encryption is unavailable —
// better to fail sign-in than to write a refresh_token in cleartext.

import { app, safeStorage } from "electron";
import { join } from "node:path";
import { readFile, writeFile, unlink, mkdir } from "node:fs/promises";
import type { GoogleUser } from "@nestbrain/shared";
import type { OAuthTokens } from "./google-oauth";

export interface StoredSession {
  tokens: OAuthTokens;
  user: GoogleUser;
  signedInAt: number;
}

function getStorePath(): string {
  return join(app.getPath("userData"), "auth.enc");
}

export function isEncryptionAvailable(): boolean {
  return safeStorage.isEncryptionAvailable();
}

export async function saveSession(session: StoredSession): Promise<void> {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(
      "OS-level encryption is not available; refusing to persist credentials. " +
        "On Linux this usually means no Secret Service (kwallet/libsecret) is running.",
    );
  }
  const path = getStorePath();
  await mkdir(join(path, ".."), { recursive: true });
  const encrypted = safeStorage.encryptString(JSON.stringify(session));
  await writeFile(path, encrypted);
}

export async function loadSession(): Promise<StoredSession | null> {
  const path = getStorePath();
  let buf: Buffer;
  try {
    buf = await readFile(path);
  } catch {
    return null;
  }
  if (!safeStorage.isEncryptionAvailable()) {
    // We have a file on disk but can't decrypt: nothing we can do.
    console.warn("[auth] auth.enc present but safeStorage unavailable — ignoring");
    return null;
  }
  try {
    const json = safeStorage.decryptString(buf);
    return JSON.parse(json) as StoredSession;
  } catch (err) {
    console.warn("[auth] failed to decrypt auth.enc — clearing:", err);
    await clearSession().catch(() => { /* ignore */ });
    return null;
  }
}

export async function clearSession(): Promise<void> {
  try {
    await unlink(getStorePath());
  } catch {
    /* already gone */
  }
}
