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

# Fusion Lab targets the stable v0.7.1 binary. The current source tree has
# text.selectStory, but the published v0.7.1 CLI does not. text.select clamps
# an over-large focus to the final UTF-8 boundary, so this is equivalent for
# the freshly-created one-story frames used by the adapter.
#
# Studio calls normal paragraph justification `justify`; DesignCraft's enum
# calls that mode `leftJustified` (all lines justified except the last).
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

# DesignCraft's inspect/story queries can be intentionally comprehensive.
# The shared Node process runner keeps only the first 20 KB, so capture the
# complete report here and reduce only data the adapter does not need.
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

    // Keep only the page geometry used for headers/footers. Full inspect
    // repeats every item and story and becomes huge on realistic books.
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

    // story.get is used twice: first to locate FLIMG placeholders, then only
    // to assert `overset === null`. A long text with no image placeholders
    // therefore does not need to be echoed back through the 20 KB runner.
    if (
      typeof value.text === 'string' &&
      value.text.length > 8000 &&
      !value.text.includes('[[FLIMG:') &&
      Object.prototype.hasOwnProperty.call(value, 'overset')
    ) {
      return { id: value.id, overset: value.overset, text: '' };
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
