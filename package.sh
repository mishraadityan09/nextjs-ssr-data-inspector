#!/usr/bin/env bash
#
# Package the extension into a distributable zip for a GitHub release or for
# loading via "Load unpacked" from an unzipped copy.
#
# Output: dist/nextjs-ssr-data-inspector-<version>.zip
# Excludes dev-only files (this script, the SVG source, dist/, OS cruft).
#
# Usage: bash package.sh
#
set -e
cd "$(dirname "$0")"

NAME="nextjs-ssr-data-inspector"
VERSION="$(node -p "require('./manifest.json').version" 2>/dev/null || echo "0.0.0")"
OUT="dist/${NAME}-${VERSION}.zip"

echo "[pack] building ${OUT}"
mkdir -p dist
rm -f "$OUT"

# Zip the runtime files only.
zip -r -q "$OUT" . \
  -x "dist/*" \
  -x "package.sh" \
  -x ".gitignore" \
  -x "icons/generate-icons.sh" \
  -x "icons/icon.svg" \
  -x "*.DS_Store" \
  -x "*/.DS_Store"

echo "[pack] done: ${OUT}"
unzip -l "$OUT" | tail -n +2
