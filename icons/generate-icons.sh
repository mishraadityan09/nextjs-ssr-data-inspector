#!/usr/bin/env bash
#
# Generate PNG icons (16/32/48/128) from icon.svg for the extension.
# Prefers rsvg-convert, then ImageMagick (magick/convert), then the macOS
# fallback (qlmanage + sips). Commit the resulting PNGs so end users need no
# tooling to load the extension.
#
# Usage: bash generate-icons.sh
#
set -e
cd "$(dirname "$0")"

SVG="icon.svg"
SIZES="16 32 48 128"

render() { # <size> <outfile>
  local size="$1" out="$2"
  if command -v rsvg-convert >/dev/null 2>&1; then
    rsvg-convert -w "$size" -h "$size" "$SVG" -o "$out"
  elif command -v magick >/dev/null 2>&1; then
    magick -background none -density 512 "$SVG" -resize "${size}x${size}" "$out"
  elif command -v convert >/dev/null 2>&1; then
    convert -background none -density 512 "$SVG" -resize "${size}x${size}" "$out"
  elif command -v qlmanage >/dev/null 2>&1 && command -v sips >/dev/null 2>&1; then
    if [ ! -f .ql-base.png ]; then
      qlmanage -t -s 512 -o . "$SVG" >/dev/null 2>&1
      mv "${SVG}.png" .ql-base.png
    fi
    sips -z "$size" "$size" .ql-base.png --out "$out" >/dev/null
  else
    echo "[icons] No SVG converter found (need rsvg-convert, ImageMagick, or macOS qlmanage+sips)." >&2
    exit 1
  fi
  echo "[icons] wrote $out"
}

for s in $SIZES; do render "$s" "${s}.png"; done
rm -f .ql-base.png
echo "[icons] done"
