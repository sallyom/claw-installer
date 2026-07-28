#!/usr/bin/env bash
set -euo pipefail

image="${1:-openclaw-openshell:local}"
source_dir="${2:-../openclaw}"
source_dir="$(cd "$source_dir" && pwd)"
base_image="${image}-base"
version="$(node -p "require('${source_dir}/package.json').version")"

podman build \
  -t "$base_image" \
  --build-arg OPENCLAW_EXTENSIONS=openshell,codex \
  "$source_dir"

podman build \
  -t "$image" \
  -f openshell/Dockerfile.local-source \
  --build-arg "OPENCLAW_BASE_IMAGE=$base_image" \
  .

podman run --rm --entrypoint sh "$image" -lc \
  "test \"\$(node -p 'require(\"/app/package.json\").version')\" = '$version' && openclaw --version && command -v curl && command -v ssh && command -v rsync && node openclaw.mjs plugins inspect openshell --json >/dev/null && node openclaw.mjs plugins inspect codex --json >/dev/null"
