#!/bin/sh
set -eu

REAL="${DESIGNCRAFT_REAL_PATH:-/usr/local/lib/designcraft/designcraft-cli}"

if [ "${1:-}" != "script" ] || [ "${2:-}" = "" ] || [ "${2:-}" = "-" ]; then
  exec "$REAL" "$@"
fi

SOURCE="$2"
shift 2
TMP="$(mktemp "${TMPDIR:-/tmp}/designcraft-script.XXXXXX")"
trap 'rm -f "$TMP"' EXIT INT TERM

# Fusion Lab targets the stable v0.7.1 binary. The source tree already has
# text.selectStory, but that command was not present in the published v0.7.1
# CLI build. text.select is present and accepts a focus past the story end
# (it clamps to the final UTF-8 boundary), so it is an equivalent stable
# operation for our freshly-created frame stories.
#
# Studio calls normal book justification `justify`; DesignCraft's serialized
# enum calls the same mode `leftJustified` (justify all lines except the last).
awk '
  /^text\.selectStory / {
    print "text.select {\"story\":\"$last.story\",\"anchor\":0,\"focus\":1000000000}"
    next
  }
  {
    gsub(/\"align\":\"justify\"/, "\"align\":\"leftJustified\"")
    print
  }
' "$SOURCE" > "$TMP"

exec "$REAL" script "$TMP" "$@"
