#!/usr/bin/env bash
set -euo pipefail

image="${1:-openclaw-openshell:local}"
openclaw_dir="${OPENCLAW_DIR:-../openclaw}"
base_image="${OPENCLAW_BASE_IMAGE:-${image}-base}"

podman build \
  -t "$base_image" \
  -f "$openclaw_dir/Dockerfile" \
  --build-arg OPENCLAW_EXTENSIONS=diagnostics-otel,codex \
  --build-arg OPENCLAW_IMAGE_APT_PACKAGES="openssh-client rsync" \
  "$openclaw_dir"

podman build \
  -t "$image" \
  -f openshell/Dockerfile \
  --build-arg OPENCLAW_BASE_IMAGE="$base_image" \
  --build-arg OPENSHELL_CLI_VERSION="${OPENSHELL_CLI_VERSION:-0.0.44}" \
  .

podman run --rm "$image" sh -lc \
  'test -x /opt/openshell/bin/openshell && /opt/openshell/bin/openshell --version && test -f /app/dist/extensions/diagnostics-otel/package.json && test ! -e /app/dist/extensions/openshell/package.json'
