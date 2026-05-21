#!/usr/bin/env bash
set -euo pipefail

image="${1:-openclaw-openshell:local}"
openclaw_dir="${OPENCLAW_DIR:-../openclaw}"

podman farm build \
  -t "$image" \
  -f "$openclaw_dir/Dockerfile" \
  --build-arg OPENCLAW_EXTENSIONS=diagnostics-otel,codex,openshell \
  --build-arg OPENCLAW_IMAGE_APT_PACKAGES="openssh-client rsync" \
  "$openclaw_dir"
