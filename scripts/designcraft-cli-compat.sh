#!/bin/sh
set -eu

REAL="${DESIGNCRAFT_REAL_PATH:-/usr/local/lib/designcraft/designcraft-cli}"

if [ "${1:-}" != "script" ] || [ "${2:-}" = "" ] || [ "${2:-}" = "-" ]; then
  exec "$REAL" "$@"
fi

SOURCE="$2"
shift 2
TMP="$(mktemp "${TMPDIR:-/tmp}/designcraft-script.XXXXXX")"
OUT="$(mktemp "${TMPDIR:-/tmp}/designcraft-output.XXXXXX")"
trap 'rm -f "$TMP" "$OUT"' EXIT INT TERM

# Compatibility for the stable v0.7.1 binary. Current DesignCraft source has
# text.selectStory, but the published binary does not; text.select with an
# intentionally large focus is equivalent for our freshly-created stories.
awk '
  /^text\.selectStory / {
    print "text.select {\"story\":\"$last.story\",\"anchor\":0,\"focus\":1000000000}"
    next
  }
  {
    gsub(/"align":"justify"/, "\"align\":\"leftJustified\"")
    print
  }
' "$SOURCE" > "$TMP"

# Capture the complete CLI report before returning it to Node. The shared
# process runner deliberately caps stdout at 20 KB, while document.inspect and
# story.get can be hundreds of KB for a real book. Reduce only fields the
# adapter does not need for the current command.
set +e
"$REAL" script "$TMP" "$@" >"$OUT"
CODE=$?
set -e

if command -v node >/dev/null 2>&1; then
  if node - "$OUT" <<'NODE'
const fs = require('fs');
const file = process.argv[2];
const raw = fs.readFileSync(file, 'utf8');
let report;
try {
  report = JSON.parse(raw);
} catch {
  process.exit(2);
}
if (Array.isArray(report.results)) {
  report.results = report.results.map((value) => {
    if (!value || typeof value !== 'object') return value;

    // Full inspect repeats every item/story. The engine only needs page
    // geometry and logical page names for furniture and final page checks.
    if (Array.isArray(value.spreads)) {
      return {
        pageCount: value.pageCount,
        spreads: value.spreads.map((spread) => ({
          index: spread.index,
          pages: Array.isArray(spread.pages)
            ? spread.pages.map((page) => ({
                index: page.index,
                name: page.name,
                bounds: page.bounds,
              }))
            : [],
        })),
      };
    }

    // The reflow acceptance book has no illustrations, so its huge story is
    // queried only for `overset`. Returning 247 KB of text would be truncated
    // by the parent process before JSON.parse. Small/image-bearing stories
    // remain untouched because marker positions are still needed there.
    if (typeof value.text === 'string' && value.text.length > 8000) {
      const hasFlimg = value.text.includes('[[FLIMG:');
      if (!hasFlimg) {
        return { id: value.id, overset: value.overset ?? null, text: '' };
      }
    }

    return value;
  });
}
process.stdout.write(JSON.stringify(report));
NODE
  then
    :
  else
    cat "$OUT"
  fi
else
  cat "$OUT"
fi

exit "$CODE"
