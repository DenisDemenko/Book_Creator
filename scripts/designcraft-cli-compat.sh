#!/bin/sh
# Обгортка над DesignCraft CLI у production-образі.
#
# ЩО ТУТ БУЛО І ЧОГО БІЛЬШЕ НЕМА. Донедавна цей шим awk-ом ПЕРЕПИСУВАВ уже
# згенерований `.dcs`-скрипт перед запуском: `text.selectStory` →
# `text.select` із великим focus, і `"align":"justify"` →
# `"align":"leftJustified"`. Обидва шаблони виявились мертвими — їх не
# емітує жоден виробник скриптів у цьому репозиторії, а `leftJustified` є
# єдиним правильним написанням, яке приймає рушій (не пережитком старої
# версії). Правка мови команд регуляркою маскувала б регресію виробника й
# нічого не знала про те, що вміє прибитий бінарник, тож її прибрано.
# Натомість рушій звіряє скрипт із самим бінарником ПЕРЕД запуском:
# `server/pdf/designcraft/capabilities.ts` (`designcraft-cli commands` →
# перелік id команд) і `assertScriptSupported` у
# `server/pdf/engines/designcraftEngineV3.ts`.
#
# ЩО ЛИШИЛОСЬ. Тільки обрізання звіту: спільний запускач процесів у Node
# обмежує stdout, а `document.inspect` і `story.get` на справжній книзі
# дають сотні КБ. Це інша хвороба, і її правильне лікування — сесійний
# транспорт замість процесу на крок (див. PLAN_DESIGNCRAFT_BRIDGE.md).
# Коли транспорт зміниться, цей файл зникне разом із
# DESIGNCRAFT_REAL_PATH.
set -eu

REAL="${DESIGNCRAFT_REAL_PATH:-/usr/local/lib/designcraft/designcraft-cli}"

# Усе, крім `script`, іде в бінарник без змін: обрізати нічого.
if [ "${1:-}" != "script" ]; then
  exec "$REAL" "$@"
fi

OUT="$(mktemp "${TMPDIR:-/tmp}/designcraft-output.XXXXXX")"
trap 'rm -f "$OUT"' EXIT INT TERM

set +e
"$REAL" "$@" >"$OUT"
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
