// Make sure `apps/desktop/src/auth/oauth-config.ts` exists before the TS
// compiler runs.
//
// The real `oauth-config.ts` is gitignored — it holds the OAuth Client ID /
// Secret for whichever Google Cloud project this build is bound to. Fresh
// clones (CI, fork users) won't have it yet, and TS would fail at compile
// time with "Cannot find module './oauth-config'".
//
// This script copies `oauth-config.example.ts` over to `oauth-config.ts` if
// the latter is missing. The example has placeholder strings, so a fresh
// build *compiles* but sign-in will fail at runtime with a clear Google
// error until you edit the file with real credentials.

import { existsSync, copyFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const example = join(__dirname, "../src/auth/oauth-config.example.ts");
const target = join(__dirname, "../src/auth/oauth-config.ts");

if (existsSync(target)) {
  process.exit(0);
}
if (!existsSync(example)) {
  console.error(`[oauth] expected template at ${example} — aborting.`);
  process.exit(1);
}
copyFileSync(example, target);
console.log(
  `[oauth] created ${target} from template. Sign-in will fail until you edit it with a real Google OAuth Desktop Client ID + Secret. See README "Build from Source".`,
);
