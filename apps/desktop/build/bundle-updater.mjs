// Bundle the auto-updater (src/updater.ts + electron-updater and its tree)
// into a single CJS file in dist/. The packaged app's node_modules carries
// only node-pty (see "files" in package.json), so electron-updater can't be
// required from there — bundling sidesteps pnpm-symlink packaging entirely.
import { build } from "esbuild";

await build({
  entryPoints: ["src/updater.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  outfile: "dist/updater.cjs",
  external: ["electron"],
  logLevel: "warning",
});
console.log("[updates] bundled dist/updater.cjs");
