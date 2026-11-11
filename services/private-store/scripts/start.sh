#!/usr/bin/env sh
# Запуск локального сервера приватного сховища (Linux/macOS): Docker, .env, головний ключ, збірка й запуск, стан.
set -eu
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
command -v docker >/dev/null 2>&1 || { echo "Docker не знайдено. Встановіть Docker і повторіть." >&2; exit 1; }
docker info >/dev/null 2>&1 || { echo "Docker не запущено." >&2; exit 1; }
if [ ! -f .env ]; then
  cp .env.example .env
  echo "Створено файл .env. Відкрийте його, вкажіть STUDIO_URL і PAIRING_CODE (код видає адмінпанель Studio після підтвердження поштою), потім запустіть скрипт знову."
  exit 0
fi
sh "$root/scripts/init-secrets.sh"
docker compose up -d --build
port="$(sed -n 's/^PRIVATE_STORE_PORT=\([0-9][0-9]*\).*/\1/p' .env | head -n 1)"
port="${port:-8787}"
echo "Чекаю, поки сервер відповість..."
i=0
while [ "$i" -lt 30 ]; do
  if out="$(curl -fsS "http://127.0.0.1:$port/v1/health" 2>/dev/null)"; then echo "Сервер працює: $out"; break; fi
  i=$((i + 1)); sleep 1
done
docker compose logs --tail 15
