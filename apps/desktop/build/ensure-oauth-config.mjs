// Make sure `apps/desktop/src/auth/oauth-config.ts` exists with the right
// credentials before the TS compiler runs.
//
// Four modes, in priority order:
//
//   1. Env vars NESTBRAIN_GOOGLE_CLIENT_ID + NESTBRAIN_GOOGLE_CLIENT_SECRET
//      are set → write a fresh oauth-config.ts with those values. This is
//      the CI / release-build path: GitHub Actions exports the secrets
//      before `pnpm desktop:build` runs, and the resulting DMG/exe carries
//      Mike's real OAuth client.
//
//   2. `apps/desktop/.env.local` exists and defines those vars → load them
//      and treat as mode 1. This is the local-dev path that lets Mike (or a
//      fork user) test the full sync flow without hand-editing TS sources or
//      exporting env vars on every shell. The .env.local file is gitignored.
//
//   3. oauth-config.ts already exists on disk → leave it alone. The user
//      hand-edited it with their own credentials and we mustn't clobber it.
//
//   4. None of the above → copy oauth-config.example.ts to oauth-config.ts so
//      the TS compile doesn't blow up. The resulting build runs, but sign-in
//      fails at runtime with a Google "invalid_client" until real credentials
//      are wired in.

import { existsSync, copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const example = join(__dirname, "../src/auth/oauth-config.example.ts");
const target = join(__dirname, "../src/auth/oauth-config.ts");
const envLocal = join(__dirname, "../.env.local");

let idFromEnv = process.env.NESTBRAIN_GOOGLE_CLIENT_ID;
let secretFromEnv = process.env.NESTBRAIN_GOOGLE_CLIENT_SECRET;

// Fall back to apps/desktop/.env.local — minimal KEY=VALUE parser, no quoting
// rules beyond stripping optional surrounding single/double quotes. We don't
// pull in dotenv because this script runs on a fresh `pnpm install` before
// dev deps are guaranteed to be present.
if ((!idFromEnv || !secretFromEnv) && existsSync(envLocal)) {
  const fileVars = parseEnvFile(readFileSync(envLocal, "utf-8"));
  idFromEnv = idFromEnv || fileVars.NESTBRAIN_GOOGLE_CLIENT_ID;
  secretFromEnv = secretFromEnv || fileVars.NESTBRAIN_GOOGLE_CLIENT_SECRET;
  if (idFromEnv && secretFromEnv) {
    console.log("[oauth] loaded credentials from apps/desktop/.env.local");
  }
}

function parseEnvFile(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

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
