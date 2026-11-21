#!/usr/bin/env bash
set -euo pipefail

version=$(node -p "require('./package.json').version")
appimage="$PWD/dist/pilot-$version-linux-x86_64.AppImage"
deb="$PWD/dist/pilot-$version-linux-amd64.deb"

test -s "$appimage"
test -x "$appimage"
test -s "$deb"
test "$(dpkg-deb -f "$deb" Package)" = pilot
test "$(dpkg-deb -f "$deb" Conflicts)" = pi-desktop
test "$(dpkg-deb -f "$deb" Replaces)" = pi-desktop
test "$(dpkg-deb -f "$deb" Version)" = "$version"
test "$(dpkg-deb -f "$deb" Architecture)" = amd64

scratch=$(mktemp -d)
trap 'rm -rf -- "$scratch"' EXIT
export TMPDIR="$scratch"
dpkg-deb -x "$deb" "$scratch/deb"

smoke() {
  local platform="$1"
  shift
  xvfb-run -a timeout --kill-after=10s 90s "$@" --no-sandbox --smoke \
    "--user-data-dir=$scratch/$platform" | tee "$scratch/$platform.log"
  node -e '
    const report = require("node:fs").readFileSync(0, "utf8").match(/^SMOKE_RESULT (.+)$/m);
    if (!report || JSON.parse(report[1]).ok !== true) throw new Error("Packaged Electron smoke failed");
  ' < "$scratch/$platform.log"
  echo "Verified $platform $version"
}

smoke appimage env APPIMAGE_EXTRACT_AND_RUN=1 "$appimage"
smoke deb "$scratch/deb/opt/Pilot/pilot"
