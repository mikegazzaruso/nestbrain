// AuthManager — single source of truth for the user's auth state in the
// main process. Owns the OAuth flow, persisted session, in-memory state,
// and broadcasts state changes to subscribers (typically the renderer).

import type { AuthState } from "@nestbrain/shared";
import {
  runOAuthFlow,
  refreshAccessToken,
  revokeToken,
  OAuthError,
  type OAuthTokens,
} from "./google-oauth";
import {
  loadSession,
  saveSession,
  clearSession,
  isEncryptionAvailable,
  type StoredSession,
} from "./token-store";

// Refresh the access token this many ms before it actually expires.
const REFRESH_LEAD_MS = 5 * 60 * 1000; // 5 minutes

type Listener = (state: AuthState) => void;

export class AuthManager {
  private state: AuthState = { status: "signed-out" };
  private session: StoredSession | null = null;
  private listeners = new Set<Listener>();
  private signInAbort: AbortController | null = null;

  /** Load any previously persisted session. Call once on app startup. */
  async init(): Promise<void> {
    if (!isEncryptionAvailable()) {
      console.warn("[auth] safeStorage unavailable on this platform");
    }
    const session = await loadSession();
    if (session) {
      this.session = session;
      this.setState({ status: "signed-in", user: session.user });
    }
  }

  getState(): AuthState {
    return this.state;
  }

  onChange(cb: Listener): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  /** Cancel any in-flight sign-in (e.g. user closed the browser tab). */
  cancelSignIn(): void {
    this.signInAbort?.abort();
    this.signInAbort = null;
  }

  async signIn(): Promise<void> {
    if (this.state.status === "signing-in") {
      // Already running — ignore double-clicks.
      return;
    }
    this.setState({ status: "signing-in" });
    this.signInAbort = new AbortController();
    try {
      const { tokens, user } = await runOAuthFlow(this.signInAbort.signal);
      const session: StoredSession = { tokens, user, signedInAt: Date.now() };
      await saveSession(session);
      this.session = session;
      this.setState({ status: "signed-in", user });
    } catch (err) {
      const message = err instanceof OAuthError ? err.message : String(err);
      console.error("[auth] sign-in failed:", err);
      this.setState({ status: "error", error: message });
      // Settle back to signed-out so the UI can offer a retry.
      setTimeout(() => {
        if (this.state.status === "error") this.setState({ status: "signed-out" });
      }, 4000);
    } finally {
      this.signInAbort = null;
    }
  }

  async signOut(): Promise<void> {
    const refresh = this.session?.tokens.refreshToken;
    this.session = null;
    await clearSession();
    if (refresh) {
      // Best-effort: revoke at Google so the refresh_token can't be reused.
      void revokeToken(refresh);
    }
    this.setState({ status: "signed-out" });
  }

  /**
   * Return a valid access token, refreshing if necessary. Used by the sync
   * engine. Returns null if there's no session.
   *
   * `forceRefresh` makes us go to Google even if the cached token still
   * looks valid — used when Drive itself reports 401 (e.g. the user
   * revoked access).
   */
  async getAccessToken(forceRefresh = false): Promise<string | null> {
    if (!this.session) return null;
    const { tokens } = this.session;
    if (!forceRefresh && tokens.expiresAt - REFRESH_LEAD_MS > Date.now()) {
      return tokens.accessToken;
    }
    try {
      const refreshed = await refreshAccessToken(tokens.refreshToken);
      const next: OAuthTokens = {
        ...tokens,
        accessToken: refreshed.accessToken,
        expiresAt: refreshed.expiresAt,
        scope: refreshed.scope,
        tokenType: refreshed.tokenType,
      };
      this.session = { ...this.session, tokens: next };
      await saveSession(this.session);
      return next.accessToken;
    } catch (err) {
      console.error("[auth] refresh failed, signing out:", err);
      // Refresh token revoked / expired — force the user back to sign-in.
      await this.signOut();
      return null;
    }
  }

  private setState(next: AuthState): void {
    this.state = next;
    for (const cb of this.listeners) {
      try { cb(next); } catch (err) { console.error("[auth] listener threw:", err); }
    }
  }
}
