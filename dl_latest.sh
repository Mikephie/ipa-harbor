#!/usr/bin/env bash
set -euo pipefail

# 容器必须使用官方 majd/ipatool 的 Linux 构建。
# macOS 过渡版 ipatool-sapfix 依赖 CommerceKit，不能放进 Linux 镜像。
# Apple SAP 签名认证从官方 2.4.0 起提供，生产最低要求 2.5.0。

API_URL="https://api.github.com/repos/majd/ipatool/releases/latest"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUTDIR="${SCRIPT_DIR}/server/bin"
MIN_MAJOR=2
MIN_MINOR=5

mkdir -p "$OUTDIR"

echo "Fetching latest release info from majd/ipatool …"

tmp_json="$(mktemp)"
trap 'rm -f "$tmp_json"' EXIT
curl -sL --fail "$API_URL" -o "$tmp_json"

eval "$(python3 - "$tmp_json" <<'PY'
import json, re, sys

data = json.load(open(sys.argv[1], encoding="utf-8"))
tag = data.get("tag_name") or ""
match = re.match(r"^v?(\d+)\.(\d+)\.(\d+)", tag)
if not match:
    raise SystemExit(f"unrecognized tag: {tag!r}")

urls = []
for asset in data.get("assets") or []:
    name = asset.get("name") or ""
    url = asset.get("browser_download_url") or ""
    if re.search(r"linux-(amd64|arm64)\.tar\.gz(\.sha256sum)?$", name) and url:
        urls.append(url)

print(f"tag_name={tag!r}")
print(f"version={match.group(0).lstrip('v')!r}")
print(f"major={match.group(1)}")
print(f"minor={match.group(2)}")
print(f"patch={match.group(3)}")
print("urls=(" + " ".join(repr(url) for url in urls) + ")")
PY
)"

if [[ -z "${tag_name:-}" || -z "${version:-}" ]]; then
  echo "Failed to get latest version tag"
  exit 1
fi

echo "Latest tag: $tag_name"

if (( major < MIN_MAJOR || (major == MIN_MAJOR && minor < MIN_MINOR) )); then
  echo "ipatool $tag_name is older than required v${MIN_MAJOR}.${MIN_MINOR}.0 (SAP-signed App Store auth)."
  exit 1
fi

if [[ ${#urls[@]} -eq 0 ]]; then
  echo "No linux amd64/arm64 assets found."
  exit 1
fi

echo "Found linux assets:"
printf '  - %s\n' "${urls[@]}"

for url in "${urls[@]}"; do
  filename="$(basename "$url")"
  echo "Downloading $filename …"
  curl -L --fail --output "${OUTDIR}/${filename}" "$url"
done

echo "Verifying checksums …"
# 官方 checksum 文件有时只有哈希、没有文件名，不能直接 shasum -c
for archive in "$OUTDIR"/ipatool-*-linux-*.tar.gz; do
  [[ -f "$archive" ]] || continue
  sumfile="${archive}.sha256sum"
  if [[ ! -f "$sumfile" ]]; then
    echo "Missing checksum: $sumfile"
    exit 1
  fi
  expected="$(tr -d '[:space:]' < "$sumfile" | awk '{print $1}')"
  actual="$(shasum -a 256 "$archive" | awk '{print $1}')"
  if [[ -z "$expected" || "$expected" != "$actual" ]]; then
    echo "Checksum mismatch for $(basename "$archive")"
    echo "  expected: $expected"
    echo "  actual:   $actual"
    exit 1
  fi
  echo "OK $(basename "$archive")"
done

# 只保留本次版本的 Linux 资产，避免 Dockerfile 因 sort -V 选到旧包
find "$OUTDIR" -maxdepth 1 \( \
    -name 'ipatool-*-linux-*.tar.gz' -o \
    -name 'ipatool-*-linux-*.tar.gz.sha256sum' \
  \) ! -name "ipatool-${version}-linux-*" -delete

echo "Download completed. Files are saved in: $OUTDIR"
echo "Using official ipatool $tag_name for Linux containers."
