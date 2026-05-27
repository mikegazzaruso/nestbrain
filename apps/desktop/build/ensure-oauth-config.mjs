// Make sure `apps/desktop/src/auth/oauth-config.ts` exists with the right
// credentials before the TS compiler runs.
//
// Three modes, in priority order:
//
//   1. Env vars NESTBRAIN_GOOGLE_CLIENT_ID + NESTBRAIN_GOOGLE_CLIENT_SECRET
//      are set → write a fresh oauth-config.ts with those values. This is
//      the CI / release-build path: GitHub Actions exports the secrets
//      before `pnpm desktop:build` runs, and the resulting DMG/exe carries
//      Mike's real OAuth client.
//
//   2. oauth-config.ts already exists on disk → leave it alone. This is the
//      local-dev path: Mike (or any fork user) has hand-edited the file
//      with their own credentials and we mustn't clobber it.
//
//   3. Neither env nor file → copy oauth-config.example.ts to
//      oauth-config.ts so the TS compile doesn't blow up. The resulting
//      build runs, but sign-in fails at runtime with a Google "invalid_client"
//      until real credentials are wired in.

import { existsSync, copyFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const example = join(__dirname, "../src/auth/oauth-config.example.ts");
const target = join(__dirname, "../src/auth/oauth-config.ts");

const idFromEnv = process.env.NESTBRAIN_GOOGLE_CLIENT_ID;
const secretFromEnv = process.env.NESTBRAIN_GOOGLE_CLIENT_SECRET;

if (idFromEnv && secretFromEnv) {
  // Defensive escaping for the (extremely unlikely) case the env var contains
  // a quote or backslash. Lets the script be safe even if someone pastes a
  // weird value into the GitHub secret.
  const escape = (s) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const contents = [
    "// Google OAuth client credentials — written by build/ensure-oauth-config.mjs.",
    "// Source of truth in CI: NESTBRAIN_GOOGLE_CLIENT_ID / NESTBRAIN_GOOGLE_CLIENT_SECRET",
    "// env vars (set from GitHub Actions secrets). DO NOT commit this file.",
    "",
    `export const OAUTH_CLIENT_ID = "${escape(idFromEnv)}";`,
    `export const OAUTH_CLIENT_SECRET = "${escape(secretFromEnv)}";`,
    "",
  ].join("\n");
  writeFileSync(target, contents, "utf-8");
  console.log("[oauth] wrote oauth-config.ts from env vars (NESTBRAIN_GOOGLE_CLIENT_ID / *_SECRET).");
  process.exit(0);
}

if (existsSync(target)) {
  // Local dev path — file is already set up, leave it alone.
  process.exit(0);
}

if (!existsSync(example)) {
  console.error(`[oauth] expected template at ${example} — aborting.`);
  process.exit(1);
}
copyFileSync(example, target);
console.log(
  `[oauth] created ${target} from template. Sign-in will fail at runtime until you provide real credentials (edit the file or set NESTBRAIN_GOOGLE_CLIENT_ID + NESTBRAIN_GOOGLE_CLIENT_SECRET).`,
);
