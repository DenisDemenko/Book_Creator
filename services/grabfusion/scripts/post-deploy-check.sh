#!/usr/bin/env bash
# Перевірка GrabFusion ПІСЛЯ розгортання. Лише читання, без облікових даних і без запису в Studio.
#
#   scripts/post-deploy-check.sh https://www.fusionlab.in.ua/grabfisionstidio     # через маркетплейс
#   scripts/post-deploy-check.sh https://<домен-railway>                          # сервіс напряму (префікс не потрібен)
#   scripts/post-deploy-check.sh <URL> --with-studio                              # + один запит коду до справжньої Studio
#
# --with-studio надсилає у Studio ОДИН завідомо хибний код підключення (`BAD`). Це перевіряє, що GRABFUSION_STUDIO_URL
# правильний і Studio досяжна із сервісу; у відповідь має прийти 404 `invalid_code` від Studio. Запит враховується в
# лічильнику спроб Studio (`too_many_attempts`), тому за замовчуванням вимкнений.
#
# Код виходу = кількість невдалих перевірок.
set -u
BASE="${1:-}"
[ -z "$BASE" ] && { echo "Використання: $0 <базовий URL> [--with-studio]"; exit 64; }
BASE="${BASE%/}"
WITH_STUDIO=0; [ "${2:-}" = "--with-studio" ] && WITH_STUDIO=1
fail=0
ok()  { echo "  ✓ $1"; }
bad() { echo "  ✗ $1"; fail=$((fail+1)); }
code() { curl -s -o /dev/null -m 30 -w '%{http_code}' "$@"; }
hdrs() { curl -s -D - -o /dev/null -m 30 "$@" | tr -d '\r'; }

echo "Сторінка й PWA ($BASE):"
c=$(code -L "$BASE"); [ "$c" = 200 ] && ok "сторінка відкривається (200)" || bad "сторінка: код $c (404 з X-Matched-Path /404 — у збірці маркетплейсу немає правила rewrite)"
html=$(curl -s -L -m 30 "$BASE")
path=$(echo "$BASE" | sed -E 's#^https?://[^/]+##')
echo "$html" | grep -q "<base href=\"${path}/\">" && ok "base href = ${path}/" || bad "base href не ${path}/ (перевірте GRABFUSION_BASE_PATH)"
echo "$html" | grep -qi 'GrabFusion\|Grab' && ok "це сторінка GrabFusion" || bad "у тілі немає ознак GrabFusion"

c=$(code -L "$BASE/manifest.webmanifest"); [ "$c" = 200 ] && ok "manifest.webmanifest (200)" || bad "manifest: код $c"
mf=$(curl -s -L -m 30 "$BASE/manifest.webmanifest")
echo "$mf" | grep -q '"name"' && echo "$mf" | grep -q '"icons"' && echo "$mf" | grep -q '"start_url"' \
  && ok "manifest має name, icons, start_url" || bad "manifest без name/icons/start_url"

h=$(hdrs -L "$BASE/sw.js")
echo "$h" | grep -i '^content-type' | tail -1 | grep -qi javascript && ok "sw.js віддається як JavaScript" || bad "sw.js не JavaScript"
echo "$h" | grep -i '^cache-control' | tail -1 | grep -qi 'no-cache\|max-age=0' && ok "sw.js не кешується (оновлення дійде)" || bad "sw.js кешується — оновлення не доходитимуть"
c=$(code -L "$BASE/static/app.js"); [ "$c" = 200 ] && ok "static/app.js (200)" || bad "static/app.js: код $c"

echo "Сервіс:"
hz=$(curl -s -L -m 30 "$BASE/healthz")
echo "$hz" | grep -q '"ok":true' && ok "/healthz: $hz" || bad "/healthz не ok: ${hz:0:120}"
echo "$hz" | grep -q '"contractVersion":"1.3.0"' && ok "контракт 1.3.0" || bad "версія контракту не 1.3.0 (Studio і сервіс мають збігатися)"

echo "Безпека:"
h=$(hdrs -L "$BASE/api/session")
echo "$h" | grep -qi '^set-cookie' && bad "сервіс ставить cookie без підключення" || ok "без підключення cookie не ставиться"
curl -s -L -m 30 "$BASE/api/session" | grep -q '"paired":false' && ok "/api/session без cookie: paired=false" || bad "/api/session без cookie не paired=false"
c=$(code -L "$BASE/api/drafts"); [ "$c" = 401 ] && ok "/api/drafts без сесії → 401" || bad "/api/drafts без сесії: код $c, очікувалось 401"
echo "$BASE" | grep -q '^https://' && ok "адреса за https (потрібно для service worker і Secure-cookie)" || bad "адреса не https — PWA й Secure-cookie не працюватимуть"

if [ "$WITH_STUDIO" = 1 ]; then
  echo "Studio (один хибний код):"
  out=$(curl -s -L -m 40 -X POST -H 'Content-Type: application/json' -d '{"code":"BAD"}' -w '\n%{http_code}' "$BASE/api/pair")
  c=$(echo "$out" | tail -1); body=$(echo "$out" | head -n -1)
  if [ "$c" = 404 ] && echo "$body" | grep -q 'invalid_code'; then ok "Studio досяжна, відповіла invalid_code (404)"
  elif [ "$c" = 502 ]; then bad "502: сервіс не бачить Studio — перевірте GRABFUSION_STUDIO_URL"
  elif [ "$c" = 429 ]; then bad "429 too_many_attempts: ліміт спроб Studio, повторіть через 10 хв"
  else bad "несподівано: код $c, ${body:0:140}"; fi
fi

echo
[ "$fail" = 0 ] && echo "УСЕ ДОБРЕ" || echo "ПРОВАЛІВ: $fail"
exit $fail
