#!/usr/bin/env bash
set -euo pipefail

image="${1:-openclaw-openshell:local}"

podman build \
  -t "$image" \
  -f openshell/Dockerfile \
  --build-arg OPENCLAW_REF="${OPENCLAW_REF:-v2026.7.1}" \
  .

podman run --rm --entrypoint sh "$image" -lc \
  'test "$(node -p "require(\"/app/package.json\").version")" = "2026.7.1" && test "$(node -p process.versions.sqlite)" = "3.51.3" && test "$(command -v openclaw)" = "/usr/local/bin/openclaw" && openclaw --version && id sandbox && command -v curl && command -v ssh && command -v rsync && command -v tar && test ! -e /opt/openshell/bin/openshell'
