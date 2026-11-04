#!/usr/bin/env bash
# scripts/container-smoke.sh — збирає образ з Dockerfile і перевіряє його так, як запустить Railway (потрібен Docker):
#  - порт приходить у PORT (не GRABFUSION_PORT), хост 0.0.0.0 з Dockerfile;
#  - префікс /grabfisionstidio, secure-cookie, сесії на томі /data;
#  - "Studio" — мок-сервер у сусідньому контейнері (справжній токен не потрібен).
set -u
SVC=$(cd "$(dirname "$0")/.." && { pwd -W 2>/dev/null || pwd; })   # у Git Bash docker.exe потрібен Windows-шлях
TMP=$(mktemp -d); cd "$TMP"; trap "rm -rf $TMP" EXIT
export MSYS_NO_PATHCONV=1   # Git Bash інакше перетворює -e VAR=/шлях на C:/Program Files/Git/…
IMG=grabfusion-smoke
docker build -q -t $IMG "$SVC" >/dev/null || { echo "Образ не зібрався"; exit 1; }
fail=0
ok()   { echo "  ✓ $1"; }
bad()  { echo "  ✗ $1"; fail=$((fail+1)); }
check(){ if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (очікувалось '$3', є '$2')"; fi; }

cleanup() { docker rm -f gf-app gf-mock >/dev/null 2>&1; docker network rm gfnet >/dev/null 2>&1; }
cleanup
docker network create gfnet >/dev/null
docker volume rm -f gf-smoke-data >/dev/null 2>&1

docker run -d --name gf-mock --network gfnet -e GRABFUSION_HOST=0.0.0.0 $IMG grabfusion-mock >/dev/null
docker run -d --name gf-app --network gfnet -p 18080:8080 -v gf-smoke-data:/data \
  -e PORT=8080 \
  -e GRABFUSION_BASE_PATH=/grabfisionstidio \
  -e GRABFUSION_COOKIE_SECURE=1 \
  -e GRABFUSION_MARKET_URL=https://www.fusionlab.in.ua \
  -e GRABFUSION_SESSION_DB=/data/sessions.sqlite3 \
  -e GRABFUSION_STUDIO_URL=http://gf-mock:8765/api/external/v1 \
  $IMG >/dev/null

for i in $(seq 1 30); do
  curl -s -o /dev/null -m 2 http://127.0.0.1:18080/healthz && break
  sleep 1
done

B=http://127.0.0.1:18080
echo "Життя й префікс:"
check "/healthz відповідає на порту з PORT" "$(curl -s -o /dev/null -w '%{http_code}' $B/healthz)" 200
check "/grabfisionstidio/healthz (проксі передає префікс)" "$(curl -s -o /dev/null -w '%{http_code}' $B/grabfisionstidio/healthz)" 200
check "/grabfisionstidio (без слеша, як у правилі rewrite) віддає сторінку" "$(curl -s -o /dev/null -w '%{http_code}' $B/grabfisionstidio)" 200
html=$(curl -s $B/)
echo "$html" | grep -q '<base href="/grabfisionstidio/">' && ok "base href = /grabfisionstidio/" || bad "base href не /grabfisionstidio/"
check "manifest" "$(curl -s -o /dev/null -w '%{http_code}' $B/manifest.webmanifest)" 200
check "sw.js: тип JavaScript" "$(curl -s -D - -o /dev/null $B/sw.js | tr -d '\r' | grep -i '^content-type' | grep -ci javascript)" 1
check "sw.js: Cache-Control no-cache" "$(curl -s -D - -o /dev/null $B/sw.js | tr -d '\r' | grep -i '^cache-control' | grep -ci no-cache)" 1

echo "Підключення кодом (через префікс, Studio — мок):"
hdr=$(curl -s -D - -o ./gf-pair.json -X POST -H 'Content-Type: application/json' -d '{"code":"123456"}' $B/grabfisionstidio/api/pair | tr -d '\r')
check "POST /pair → 200" "$(echo "$hdr" | head -1 | awk '{print $2}')" 200
cookie=$(echo "$hdr" | grep -i '^set-cookie')
echo "  cookie: $(echo "$cookie" | sed 's/gf_session=[^;]*/gf_session=<схов.>/')"
echo "$cookie" | grep -qi 'HttpOnly' && ok "HttpOnly" || bad "немає HttpOnly"
echo "$cookie" | grep -qi 'Secure' && ok "Secure" || bad "немає Secure"
echo "$cookie" | grep -qi 'Path=/grabfisionstidio' && ok "Path=/grabfisionstidio" || bad "Path не /grabfisionstidio"
echo "$cookie" | grep -qi 'SameSite=strict' && ok "SameSite=Strict" || bad "немає SameSite=Strict"
grep -q 'nst_' ./gf-pair.json && bad "токен Studio потрапив у відповідь браузеру" || ok "токен Studio не у відповіді браузеру"

echo "Помилки Studio доходять до користувача:"
check "BAD → 404" "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d '{"code":"BAD"}' $B/grabfisionstidio/api/pair)" 404
check "порожній код → 400" "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d '{}' $B/grabfisionstidio/api/pair)" 400

echo "Сесія переживає перезапуск контейнера (том /data):"
sid=$(echo "$cookie" | sed -n 's/.*gf_session=\([^;]*\).*/\1/p')
before=$(curl -s -H "Cookie: gf_session=$sid" $B/grabfisionstidio/api/session | head -c 200)
docker restart gf-app >/dev/null
for i in $(seq 1 30); do curl -s -o /dev/null -m 2 $B/healthz && break; sleep 1; done
after=$(curl -s -H "Cookie: gf_session=$sid" $B/grabfisionstidio/api/session | head -c 200)
echo "  до:    $before"
echo "  після: $after"
check "відповідь /session збігається до і після перезапуску" "$after" "$before"
echo "$after" | grep -qi 'paired\|Тестова' && ok "після перезапуску сесія жива" || bad "сесія зникла після перезапуску"

echo "Велике фото через сервіс (ліміт тіла):"
head -c 3000000 /dev/urandom > ./gf-big.bin
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H "Cookie: gf_session=$sid" -H 'Content-Type: application/octet-stream' --data-binary @./gf-big.bin $B/grabfisionstidio/api/drafts/none/photos)
echo "  POST 3 МБ → $code (не 413 від самого сервісу)"
case "$code" in 000|413|"") bad "3 МБ не дійшли до застосунку (код $code)";; *) ok "3 МБ дійшли до застосунку (код $code, не 413)";; esac

cleanup
docker volume rm -f gf-smoke-data >/dev/null 2>&1
rm -f ./gf-pair.json ./gf-big.bin
echo
[ "$fail" = 0 ] && echo "УСЕ ДОБРЕ" || echo "ПРОВАЛІВ: $fail"
exit $fail
