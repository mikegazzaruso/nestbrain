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

# `gh run download` 401s on artifact zips even with a valid token (CLI quirk);
# the raw REST endpoint works fine, so fetch via gh api + curl instead.
TOK="$(gh auth token)"
fetch_artifact() {
  local name="$1"
  local id
  id="$(gh api "repos/mikegazzaruso/nestbrain/actions/runs/${RUN_ID}/artifacts" \
        -q ".artifacts[] | select(.name==\"$name\") | .id")"
  [ -n "$id" ] || { echo "✗ artifact not found: $name"; exit 1; }
  mkdir -p "$TMP/$name"
  # GitHub intermittently 401s these; retry hard before giving up.
  curl -fSL --retry 6 --retry-all-errors --retry-delay 5 --speed-limit 10240 --speed-time 30 -H "Authorization: Bearer $TOK" \
    "https://api.github.com/repos/mikegazzaruso/nestbrain/actions/artifacts/${id}/zip" \
    -o "$TMP/$name.zip"
  unzip -q "$TMP/$name.zip" -d "$TMP/$name"
}
fetch_artifact nestbrain-update-mac
fetch_artifact nestbrain-update-win
fetch_artifact nestbrain-windows-x64

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
