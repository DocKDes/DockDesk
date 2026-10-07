#!/bin/sh
# Builds everything for a GitHub release into dist/release/: the .deb, a source tarball and SHA256SUMS.
set -e
cd "$(dirname "$0")/.."
VER=$(node -p "require('./package.json').version")
OUT=dist/release
rm -rf "$OUT" && mkdir -p "$OUT"
sh packaging/build-deb.sh >/dev/null
cp "dist/dockdesk_${VER}_all.deb" "$OUT/"
T="dockdesk-$VER"
S=$(mktemp -d)
mkdir "$S/$T"
cp -r server.js pty-shell.py dockdesk-polkit.rules public bin packaging install.sh uninstall.sh package.json README.md LICENSE THIRD_PARTY_NOTICES.md CHANGELOG.md SECURITY.md "$S/$T/"
tar -C "$S" --owner=0 --group=0 -czf "$OUT/$T.tar.gz" "$T"
rm -rf "$S"
(cd "$OUT" && sha256sum ./* | sed 's# \./# #' > SHA256SUMS)
echo "Built in $OUT:"; ls -la "$OUT" | tail -n +2
