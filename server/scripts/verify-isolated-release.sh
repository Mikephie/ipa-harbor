#!/bin/bash
# 用隔離映像與暫存資料驗證。不讀正式密鑰，不接觸群暉容器。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SERVER="$ROOT/server"
DATA="$(mktemp -d /tmp/ipa-harbor-data.XXXXXX)"
DOCKER=(docker --context orbstack)
export KEYCHAIN_PASSPHRASE="$(openssl rand -base64 24)"
export JWT_SECRET="$(openssl rand -base64 32)"
export OTA_SIGNING_SECRET="$(openssl rand -base64 32)"
export ISOLATED_ADMIN_PASSWORD="$(openssl rand -base64 18)"
export ISOLATED_DATA_DIR="$DATA"
export ISOLATED_BASE_URL="http://127.0.0.1:18080"
ACCOUNT="aaaaaaaaaaaaaaaa"
IPA="$DATA/accounts/$ACCOUNT/123_1.ipa"

cleanup() {
  "${DOCKER[@]}" compose -f "$SERVER/docker-compose.isolated.yml" down --remove-orphans >/dev/null 2>&1 || true
  "${DOCKER[@]}" rm -f ipa-harbor-r5 ipa-harbor-r5-badurl >/dev/null 2>&1 || true
  rm -rf "$DATA"
}
trap cleanup EXIT

expect_exit() {
  local name="$1"
  shift
  "${DOCKER[@]}" rm -f "$name" >/dev/null 2>&1 || true
  set +e
  "${DOCKER[@]}" run --name "$name" "$@" ipa-harbor:isolated-r5 >/tmp/ipa-harbor-r5-boot.log 2>&1 &
  local pid=$!
  local waited=0
  while kill -0 "$pid" 2>/dev/null && [[ "$waited" -lt 25 ]]; do
    sleep 1
    waited=$((waited + 1))
  done
  if kill -0 "$pid" 2>/dev/null; then
    "${DOCKER[@]}" rm -f "$name" >/dev/null 2>&1 || true
    wait "$pid" || true
    echo "expected failure but process stayed up: $name" >&2
    exit 1
  fi
  wait "$pid"
  local code=$?
  set -e
  "${DOCKER[@]}" rm -f "$name" >/dev/null 2>&1 || true
  if [[ "$code" -eq 0 ]]; then
    echo "expected failure: $name" >&2
    exit 1
  fi
  if grep -F "$JWT_SECRET" /tmp/ipa-harbor-r5-boot.log >/dev/null \
    || grep -F "$KEYCHAIN_PASSPHRASE" /tmp/ipa-harbor-r5-boot.log >/dev/null \
    || grep -F "$OTA_SIGNING_SECRET" /tmp/ipa-harbor-r5-boot.log >/dev/null \
    || grep -F 'isolated-only' /tmp/ipa-harbor-r5-boot.log >/dev/null \
    || grep -F 'isolated-jwt' /tmp/ipa-harbor-r5-boot.log >/dev/null \
    || grep -F 'isolated-ota' /tmp/ipa-harbor-r5-boot.log >/dev/null; then
    echo "boot log contained a test secret" >&2
    exit 1
  fi
  echo "FAIL_CLOSED $name $code"
}

expect_exit ipa-harbor-r5-no-jwt \
  -e NODE_ENV=production \
  -e KEYCHAIN_PASSPHRASE=isolated-only \
  -e PUBLIC_BASE_URL=https://ipa.mikephie.com \
  -e OTA_SIGNING_SECRET=isolated-ota
expect_exit ipa-harbor-r5-empty-jwt \
  -e NODE_ENV=production \
  -e JWT_SECRET= \
  -e KEYCHAIN_PASSPHRASE=isolated-only \
  -e PUBLIC_BASE_URL=https://ipa.mikephie.com \
  -e OTA_SIGNING_SECRET=isolated-ota
expect_exit ipa-harbor-r5-blank-jwt \
  -e NODE_ENV=production \
  -e JWT_SECRET='   ' \
  -e KEYCHAIN_PASSPHRASE=isolated-only \
  -e PUBLIC_BASE_URL=https://ipa.mikephie.com \
  -e OTA_SIGNING_SECRET=isolated-ota
expect_exit ipa-harbor-r5-no-keychain \
  -e NODE_ENV=production \
  -e JWT_SECRET=isolated-jwt \
  -e PUBLIC_BASE_URL=https://ipa.mikephie.com \
  -e OTA_SIGNING_SECRET=isolated-ota
expect_exit ipa-harbor-r5-empty-keychain \
  -e NODE_ENV=production \
  -e JWT_SECRET=isolated-jwt \
  -e KEYCHAIN_PASSPHRASE= \
  -e PUBLIC_BASE_URL=https://ipa.mikephie.com \
  -e OTA_SIGNING_SECRET=isolated-ota
expect_exit ipa-harbor-r5-blank-keychain \
  -e NODE_ENV=production \
  -e JWT_SECRET=isolated-jwt \
  -e KEYCHAIN_PASSPHRASE='   ' \
  -e PUBLIC_BASE_URL=https://ipa.mikephie.com \
  -e OTA_SIGNING_SECRET=isolated-ota

mkdir -p "$(dirname "$IPA")"
python3 - "$IPA" <<'PY'
import sys, zipfile
from pathlib import Path
plist = """<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
<key>softwareVersionBundleId</key><string>app.local</string>
<key>bundleShortVersionString</key><string>1.0</string>
<key>itemName</key><string>Demo</string>
</dict></plist>
"""
path = Path(sys.argv[1])
with zipfile.ZipFile(path, "w") as archive:
    archive.writestr("iTunesMetadata.plist", plist)
    archive.writestr("payload.bin", b"A" * (2 * 1024 * 1024))
PY
chmod -R a+rwx "$DATA"
ln -s /etc/hosts "$DATA/accounts/$ACCOUNT/999_1.ipa"
outside="$DATA/outside.ipa"
printf 'outside' > "$outside"
ln -s "$outside" "$DATA/accounts/$ACCOUNT/888_1.ipa"

"${DOCKER[@]}" compose -f "$SERVER/docker-compose.isolated.yml" up -d
for _ in $(seq 1 30); do
  if curl -fsS "$ISOLATED_BASE_URL/health" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
curl -fsS "$ISOLATED_BASE_URL/health" >/dev/null
mounts="$("${DOCKER[@]}" inspect ipa-harbor-r5 --format '{{range .Mounts}}{{.Destination}} {{end}}')"
if [[ "$mounts" != *"/app/data"* ]]; then
  echo "data volume missing" >&2
  exit 1
fi
for dest in /app/app.js /app/api/auth/login.js /app/utils/appleAccount.js; do
  if [[ "$mounts" == *"$dest"* ]]; then
    echo "source mount still present: $dest" >&2
    exit 1
  fi
done
echo "MOUNTS_OK"

ISOLATED_IPA_PATH="$IPA" node "$SERVER/scripts/isolated-ota-check.js"

"${DOCKER[@]}" rm -f ipa-harbor-r5 >/dev/null
"${DOCKER[@]}" run -d --name ipa-harbor-r5-badurl \
  -p 18081:3080 \
  -e NODE_ENV=production \
  -e JWT_SECRET="$JWT_SECRET" \
  -e KEYCHAIN_PASSPHRASE="$KEYCHAIN_PASSPHRASE" \
  -e OTA_SIGNING_SECRET="$OTA_SIGNING_SECRET" \
  -e PUBLIC_BASE_URL='https://ipa.mikephie.com/ipa' \
  -e PORT=3080 \
  ipa-harbor:isolated-r5 >/dev/null
for _ in $(seq 1 20); do
  if curl -fsS http://127.0.0.1:18081/health >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
curl -fsS http://127.0.0.1:18081/health >/dev/null
bad="$(curl -sS -o /tmp/ipa-harbor-r5-ota.json -w '%{http_code}' "http://127.0.0.1:18081/v1/ipa/install-package/${ACCOUNT}/123_1/manifest.plist")"
if [[ "$bad" != "503" ]]; then
  echo "bad public url status $bad" >&2
  exit 1
fi
echo "BAD_PUBLIC_URL_ISOLATED"
echo "VERIFY_OK"
