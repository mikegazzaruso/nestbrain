// Google OAuth 2.0 — Desktop app, PKCE flow (loopback redirect).
//
// Spec: https://developers.google.com/identity/protocols/oauth2/native-app
//
// Flow:
//   1. Generate code_verifier + code_challenge (S256) and a CSRF state.
//   2. Start a local HTTP server on a free loopback port.
//   3. Open the system browser to Google's auth endpoint with redirect_uri = http://127.0.0.1:<port>/callback.
//   4. Google redirects the browser back to us with ?code=...&state=...
//   5. Exchange code + verifier for { access_token, refresh_token, id_token }.
//   6. Fetch userinfo for { email, name, picture }.
//   7. Return tokens + user to the caller, close the local server.

import { createHash, randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { shell } from "electron";
import { GOOGLE_OAUTH_ENDPOINTS } from "@nestbrain/shared";
import type { GoogleUser } from "@nestbrain/shared";
import { OAUTH_CLIENT_ID, OAUTH_CLIENT_SECRET } from "./oauth-config";

export interface OAuthTokens {
  accessToken: string;
  refreshToken: string;
  idToken: string;
  expiresAt: number; // ms epoch
  scope: string;
  tokenType: string;
}

export interface OAuthSuccess {
  tokens: OAuthTokens;
  user: GoogleUser;
}

export class OAuthError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "OAuthError";
  }
}

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function generatePkcePair(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

const SUCCESS_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>NestBrain — Signed in</title>
    <style>
      body { margin:0; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; background:#0a0a0a; color:#e5e5e5; display:grid; place-items:center; min-height:100vh; }
      .card { text-align:center; padding:48px 56px; border:1px solid #222; border-radius:14px; background:#111; max-width:420px; }
      h1 { margin:0 0 12px; font-size:22px; font-weight:600; }
      h1 span { color:#22c55e; }
      p { margin:0; color:#888; font-size:14px; line-height:1.5; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1><span>✓</span> Signed in to NestBrain</h1>
      <p>You can close this tab and return to the app.</p>
    </div>
  </body>
</html>`;

function errorHtml(message: string): string {
  const safe = message.replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c,
  );
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><title>NestBrain — Sign in failed</title>
<style>body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#0a0a0a;color:#e5e5e5;display:grid;place-items:center;min-height:100vh}.card{text-align:center;padding:48px 56px;border:1px solid #4a1a1a;border-radius:14px;background:#1a0e0e;max-width:480px}h1{margin:0 0 12px;font-size:22px;font-weight:600;color:#ef4444}p{margin:0;color:#aaa;font-size:14px;line-height:1.5}</style>
</head><body><div class="card"><h1>✕ Sign in failed</h1><p>${safe}</p></div></body></html>`;
}

/**
 * Run the full OAuth flow. Opens the system browser, waits for the loopback
 * callback, exchanges the code, and returns tokens + user.
 *
 * Throws OAuthError on any failure (user cancel, network, token exchange).
 */
export async function runOAuthFlow(signal?: AbortSignal): Promise<OAuthSuccess> {
  const { verifier, challenge } = generatePkcePair();
  const state = base64url(randomBytes(16));

  // 1. Local server. Bind on 127.0.0.1 with port 0 to get a free port.
  const { code, redirectUri } = await captureAuthCode({ state, verifier, challenge, signal });

  // 2. Exchange code → tokens.
  const tokens = await exchangeCodeForTokens(code, verifier, redirectUri);

  // 3. Fetch userinfo.
  const user = await fetchUserInfo(tokens.accessToken);

  return { tokens, user };
}

interface CaptureArgs {
  state: string;
  verifier: string;
  challenge: string;
  signal?: AbortSignal;
}

interface CaptureResult {
  code: string;
  redirectUri: string;
}

function captureAuthCode(args: CaptureArgs): Promise<CaptureResult> {
  return new Promise<CaptureResult>((resolve, reject) => {
    // Captured once at listen() time and reused for both the auth URL and
    // the token-exchange redirect_uri — they MUST be byte-identical strings
    // or Google rejects the exchange with redirect_uri_mismatch.
    let redirectUri = "";

    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      // Only handle GET /callback?...; ignore favicon, etc.
      if (!req.url || !req.url.startsWith("/callback")) {
        res.statusCode = 404;
        res.end();
        return;
      }
      const url = new URL(req.url, redirectUri);
      const code = url.searchParams.get("code");
      const returnedState = url.searchParams.get("state");
      const error = url.searchParams.get("error");

      if (error) {
        res.statusCode = 400;
        res.setHeader("content-type", "text/html; charset=utf-8");
        res.end(errorHtml(`Google returned: ${error}`));
        server.close();
        reject(new OAuthError(`Google authorization error: ${error}`));
        return;
      }
      if (!code || returnedState !== args.state) {
        res.statusCode = 400;
        res.setHeader("content-type", "text/html; charset=utf-8");
        res.end(errorHtml("Invalid callback (missing code or state mismatch)."));
        server.close();
        reject(new OAuthError("Invalid OAuth callback"));
        return;
      }

      res.statusCode = 200;
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.end(SUCCESS_HTML);
      server.close();
      resolve({ code, redirectUri });
    });

    server.on("error", (err) => reject(new OAuthError("Local OAuth server error", err)));

    // Abort support: if the caller cancels, tear everything down.
    const onAbort = () => {
      try { server.close(); } catch { /* ignore */ }
      reject(new OAuthError("Sign-in cancelled"));
    };
    args.signal?.addEventListener("abort", onAbort, { once: true });

    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr !== "object") {
        reject(new OAuthError("Failed to bind local OAuth server"));
        return;
      }
      redirectUri = `http://127.0.0.1:${addr.port}/callback`;
      const authUrl = buildAuthUrl({
        redirectUri,
        state: args.state,
        codeChallenge: args.challenge,
      });
      shell.openExternal(authUrl).catch((err) => {
        reject(new OAuthError("Failed to open system browser", err));
      });
    });
  });
}

function buildAuthUrl(args: { redirectUri: string; state: string; codeChallenge: string }): string {
  const params = new URLSearchParams({
    client_id: OAUTH_CLIENT_ID,
    redirect_uri: args.redirectUri,
    response_type: "code",
    scope: GOOGLE_OAUTH_ENDPOINTS.scopes.join(" "),
    code_challenge: args.codeChallenge,
    code_challenge_method: "S256",
    state: args.state,
    // access_type=offline + prompt=consent ensure we always get a refresh_token,
    // including on subsequent sign-ins of the same Google account.
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
  });
  return `${GOOGLE_OAUTH_ENDPOINTS.authEndpoint}?${params.toString()}`;
}

async function exchangeCodeForTokens(
  code: string,
  verifier: string,
  redirectUri: string,
): Promise<OAuthTokens> {
  const body = new URLSearchParams({
    client_id: OAUTH_CLIENT_ID,
    client_secret: OAUTH_CLIENT_SECRET,
    code,
    code_verifier: verifier,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
  });
  const res = await fetch(GOOGLE_OAUTH_ENDPOINTS.tokenEndpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new OAuthError(`Token exchange failed (${res.status}): ${text}`);
  }
  const json = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    id_token: string;
    expires_in: number;
    scope: string;
    token_type: string;
  };
  if (!json.refresh_token) {
    // With access_type=offline + prompt=consent this should always come back.
    throw new OAuthError("No refresh_token returned by Google (re-consent may be required)");
  }
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    idToken: json.id_token,
    expiresAt: Date.now() + json.expires_in * 1000,
    scope: json.scope,
    tokenType: json.token_type,
  };
}

/**
 * Use a refresh_token to mint a new access_token without user interaction.
 * Google does NOT issue a new refresh_token here — keep reusing the original.
 */
export async function refreshAccessToken(refreshToken: string): Promise<Pick<OAuthTokens, "accessToken" | "expiresAt" | "scope" | "tokenType">> {
  const body = new URLSearchParams({
    client_id: OAUTH_CLIENT_ID,
    client_secret: OAUTH_CLIENT_SECRET,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  const res = await fetch(GOOGLE_OAUTH_ENDPOINTS.tokenEndpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new OAuthError(`Token refresh failed (${res.status}): ${text}`);
  }
  const json = (await res.json()) as {
    access_token: string;
    expires_in: number;
    scope: string;
    token_type: string;
  };
  return {
    accessToken: json.access_token,
    expiresAt: Date.now() + json.expires_in * 1000,
    scope: json.scope,
    tokenType: json.token_type,
  };
}

/** Best-effort revocation; logging-only on failure. */
export async function revokeToken(token: string): Promise<void> {
  try {
    await fetch(`${GOOGLE_OAUTH_ENDPOINTS.revokeEndpoint}?token=${encodeURIComponent(token)}`, {
      method: "POST",
    });
  } catch (err) {
    console.warn("[auth] revoke failed:", err);
  }
}

async function fetchUserInfo(accessToken: string): Promise<GoogleUser> {
  const res = await fetch(GOOGLE_OAUTH_ENDPOINTS.userinfoEndpoint, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new OAuthError(`userinfo failed (${res.status})`);
  }
  const json = (await res.json()) as GoogleUser;
  return {
    sub: json.sub,
    email: json.email,
    name: json.name,
    picture: json.picture,
  };
}
