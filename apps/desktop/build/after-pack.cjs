// electron-builder afterPack hook: scrub macOS extended attributes on the
// packaged .app bundle before code signing. On recent macOS (Sonoma+),
// `xattr -cr` alone does NOT clear `com.apple.provenance`, which codesign
// rejects with "resource fork, Finder information, or similar detritus not
// allowed". Workaround: use `ditto --noextattr --noqtn` to make a clean
// copy (ditto strips all xattrs and quarantine), then swap it in place.
const { execSync } = require("node:child_process");
const { rmSync, renameSync } = require("node:fs");

exports.default = async function afterPack(context) {
  if (process.platform !== "darwin") return;
  const { appOutDir, packager } = context;
  const appName = packager.appInfo.productFilename;
  const appPath = `${appOutDir}/${appName}.app`;
  const tmpPath = `${appOutDir}/.${appName}.sanitized.app`;
  try {
    execSync(`ditto --noextattr --noqtn "${appPath}" "${tmpPath}"`);
    rmSync(appPath, { recursive: true, force: true });
    renameSync(tmpPath, appPath);
    console.log(`  • afterPack: sanitized ${appName}.app (ditto strip xattrs)`);
  } catch (err) {
    console.warn(`  • afterPack: sanitize failed: ${err.message}`);
    try {
      rmSync(tmpPath, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
};
