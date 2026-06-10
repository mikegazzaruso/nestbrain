#!/usr/bin/env bash
# Publish the auto-update feed for the latest CI build to updates.nestbrain.app.
#
# Downloads the release artifacts of the most recent successful "Build &
# Release" run (or the run id passed as $1), assembles the generic-provider
# feed layout and rsyncs it to forge:
#
#   /var/www/updates.nestbrain.app/mac/  ← NestBrain-x.y.z-arm64-mac.zip + .blockmap + latest-mac.yml
#   /var/www/updates.nestbrain.app/win/  ← NestBrain Setup x.y.z.exe + latest.yml
#
# Requires: gh CLI authenticated, ssh access to forge.
set -euo pipefail
cd "$(dirname "$0")/.."

RUN_ID="${1:-$(gh run list --workflow=release.yml --status=success --limit 1 --json databaseId -q '.[0].databaseId')}"
[ -n "$RUN_ID" ] || { echo "✗ no successful release run found"; exit 1; }
echo "▶ Publishing update feed from run $RUN_ID"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
gh run download "$RUN_ID" \
  -n nestbrain-update-mac -n nestbrain-update-win \
  -n nestbrain-macos-arm64 -n nestbrain-windows-x64 \
  -D "$TMP"

mkdir -p "$TMP/feed/mac" "$TMP/feed/win"
find "$TMP/nestbrain-update-mac" -type f -exec cp {} "$TMP/feed/mac/" \;
cp "$TMP/nestbrain-update-win/latest.yml" "$TMP/feed/win/"
find "$TMP/nestbrain-windows-x64" -name '*.exe' -exec cp {} "$TMP/feed/win/" \;

echo "▶ Feed contents:"
ls -lh "$TMP/feed/mac" "$TMP/feed/win" | sed 's/^/   /'

echo "▶ Uploading to forge…"
rsync -az --delete "$TMP/feed/mac/" mike@forge.gazzaruso.com:/var/www/updates.nestbrain.app/mac/
rsync -az --delete "$TMP/feed/win/" mike@forge.gazzaruso.com:/var/www/updates.nestbrain.app/win/

echo "✅ Update feed published."
ssh mike@forge.gazzaruso.com 'grep -m1 version /var/www/updates.nestbrain.app/mac/latest-mac.yml /var/www/updates.nestbrain.app/win/latest.yml'
