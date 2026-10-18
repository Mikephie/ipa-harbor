#!/bin/bash
# 在暫存目錄建置前端與映像。不改寫工作區 server/static，不推送映像。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SERVER="$ROOT/server"
CONTEXT="$(mktemp -d /tmp/ipa-harbor-context.XXXXXX)"
FRONTEND="$(mktemp -d /tmp/ipa-harbor-frontend.XXXXXX)"
STATIC_BEFORE="$(stat -f %m "$SERVER/static/index.html")"
DB_BEFORE="$(stat -f %m "$SERVER/data/users.db")"

cleanup() {
  rm -rf "$CONTEXT" "$FRONTEND"
}
trap cleanup EXIT

cd "$ROOT/client"
npm exec --yes pnpm@10 -- exec vite build --outDir "$FRONTEND" --emptyOutDir

rsync -a \
  --exclude node_modules \
  --exclude data \
  --exclude static \
  --exclude .env \
  --exclude '.env.*' \
  "$SERVER/" "$CONTEXT/"
mkdir -p "$CONTEXT/static"
cp -R "$FRONTEND"/. "$CONTEXT/static/"

STATIC_AFTER="$(stat -f %m "$SERVER/static/index.html")"
DB_AFTER="$(stat -f %m "$SERVER/data/users.db")"
if [[ "$STATIC_AFTER" != "$STATIC_BEFORE" || "$DB_AFTER" != "$DB_BEFORE" ]]; then
  echo "workspace static or database changed" >&2
  exit 1
fi

docker --context orbstack build \
  -t ipa-harbor:isolated-r5 \
  -f "$CONTEXT/Dockerfile" \
  "$CONTEXT"

docker --context orbstack run --rm --entrypoint node ipa-harbor:isolated-r5 -e '
const fs = require("fs");
const path = require("path");
const files = fs.readdirSync("/app/static/assets").filter((name) => name.endsWith(".js"));
const hit = files.some((name) => fs.readFileSync(path.join("/app/static/assets", name), "utf8").includes("/v1/ipa/install-link"));
if (!hit) process.exit(2);
if (process.env.PORT !== "3080") process.exit(3);
if (!fs.existsSync("/app/utils/otaLink.js")) process.exit(4);
if (!fs.existsSync("/app/config/jwtSecret.js")) process.exit(5);
console.log("IMAGE_FRONTEND_OK");
console.log("IMAGE_PORT", process.env.PORT);
'

echo "STATIC_MTIME $STATIC_AFTER"
echo "DB_MTIME $DB_AFTER"
echo "IMAGE_TAG ipa-harbor:isolated-r5"
