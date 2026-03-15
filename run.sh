#!/usr/bin/env bash
# ============================================================================
# OpenClaw Installer Launcher
# ============================================================================
# Launches the OpenClaw Installer.
# - macOS (podman): runs from source (npm run dev) in the background
# - macOS (docker): runs as a container with Docker socket
# - Linux: runs as a container with podman or docker socket
#
# Usage:
#   ./run.sh                              # Pull image and start
#   ./run.sh --build                      # Build from source instead of pulling
#   ./run.sh --port 8080                  # Use a different port (default: 3000)
#   ./run.sh --runtime docker             # Force docker (default: auto-detect)
#   ANTHROPIC_API_KEY=sk-... ./run.sh     # Pass API key
#   OPENAI_API_KEY=sk-... ./run.sh        # Pass OpenAI key
# ============================================================================

set -euo pipefail

IMAGE_NAME="${CLAW_INSTALLER_IMAGE:-quay.io/sallyom/claw-installer:latest}"
CONTAINER_NAME="claw-installer"
PORT="${PORT:-3000}"
BUILD=false
RUNTIME=""

# Parse flags
while [[ $# -gt 0 ]]; do
  case "$1" in
    --build) BUILD=true; shift ;;
    --port) PORT="$2"; shift 2 ;;
    --runtime) RUNTIME="$2"; shift 2 ;;
    --help|-h) echo "Usage: ./run.sh [--build] [--port PORT] [--runtime podman|docker]"; exit 0 ;;
    *) echo "Unknown flag: $1"; exit 1 ;;
  esac
done

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

info()    { echo -e "${BLUE}$1${NC}"; }
success() { echo -e "${GREEN}$1${NC}"; }
error()   { echo -e "${RED}$1${NC}"; exit 1; }

# Auto-detect runtime
if [ -z "$RUNTIME" ]; then
  if command -v podman >/dev/null 2>&1; then
    RUNTIME="podman"
  elif command -v docker >/dev/null 2>&1; then
    RUNTIME="docker"
  else
    error "Neither podman nor docker found. Install one first."
  fi
fi

info "Using container runtime: $RUNTIME"

# Check podman version (libkrun/applehv requires 5.0+)
if [ "$RUNTIME" = "podman" ]; then
  PODMAN_VERSION=$(podman version --format '{{.Client.Version}}' 2>/dev/null || echo "0")
  PODMAN_MAJOR=$(echo "$PODMAN_VERSION" | cut -d. -f1)
  if [ "$PODMAN_MAJOR" -lt 5 ] 2>/dev/null; then
    error "Podman 5.0+ required (found $PODMAN_VERSION). Please upgrade podman."
  fi
fi

OS="$(uname -s)"

# ---- macOS + podman: extract app from image, run natively ----
# Podman socket forwarding into containers is not reliably supported
# across macOS VM backends (libkrun, applehv, qemu). Instead, we extract
# the built app from the container image and run it directly with Node.js.
if [ "$RUNTIME" = "podman" ] && [ "$OS" = "Darwin" ]; then
  info "Detected macOS + podman"

  # Check for Node.js
  if ! command -v node >/dev/null 2>&1; then
    error "Node.js not found. Install it first: brew install node"
  fi

  APP_DIR="$HOME/.openclaw/installer/.app"

  # Extract app from container image (or use local source if available)
  SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
  if [ -f "$SCRIPT_DIR/package.json" ] && [ -d "$SCRIPT_DIR/node_modules" ]; then
    # Running from cloned repo with deps installed — rebuild to pick up source changes
    APP_DIR="$SCRIPT_DIR"
    info "Building from source..."
    (cd "$APP_DIR" && npm run build)
  elif [ -f "$SCRIPT_DIR/package.json" ] && [ ! -d "$SCRIPT_DIR/node_modules" ]; then
    # Running from cloned repo, need to install deps
    APP_DIR="$SCRIPT_DIR"
    info "Installing dependencies..."
    (cd "$APP_DIR" && npm install && npm run build)
  else
    # Standalone run.sh — extract from container image
    if [ ! -f "$APP_DIR/dist/server/index.js" ]; then
      info "Extracting installer from $IMAGE_NAME..."

      # Pull image if needed
      if ! podman image exists "$IMAGE_NAME" 2>/dev/null; then
        podman pull "$IMAGE_NAME" || error "Failed to pull image."
      fi

      mkdir -p "$APP_DIR"
      EXTRACT_CTR="claw-installer-extract-$$"
      podman create --name "$EXTRACT_CTR" "$IMAGE_NAME" true >/dev/null
      podman cp "$EXTRACT_CTR:/app/." "$APP_DIR/"
      podman rm "$EXTRACT_CTR" >/dev/null
      success "Installer extracted to $APP_DIR"
    fi
  fi

  mkdir -p "$HOME/.openclaw/installer"

  info "Starting installer (Ctrl+C to stop)..."
  info "Open http://localhost:${PORT} in your browser."
  echo ""
  cd "$APP_DIR"
  PORT="$PORT" NODE_ENV=production exec node dist/server/index.js
fi

# Build or pull image (container modes only)
if $BUILD; then
  info "Building $IMAGE_NAME..."
  $RUNTIME build -t "$IMAGE_NAME" "$(dirname "$0")"
  success "Image built."
elif ! $RUNTIME image exists "$IMAGE_NAME" 2>/dev/null && ! $RUNTIME image inspect "$IMAGE_NAME" >/dev/null 2>&1; then
  info "Pulling $IMAGE_NAME..."
  $RUNTIME pull "$IMAGE_NAME" || error "Failed to pull image. Use --build to build locally."
  success "Image pulled."
fi

# Collect env var flags
ENV_FLAGS=()
for var in ANTHROPIC_API_KEY OPENAI_API_KEY OPENCLAW_IMAGE OPENCLAW_PREFIX MODEL_ENDPOINT TELEGRAM_BOT_TOKEN TELEGRAM_ALLOW_FROM \
           GOOGLE_CLOUD_PROJECT GCLOUD_PROJECT CLOUD_SDK_PROJECT \
           GOOGLE_VERTEX_PROJECT ANTHROPIC_VERTEX_PROJECT_ID \
           GOOGLE_CLOUD_LOCATION GOOGLE_VERTEX_LOCATION \
           VERTEX_ENABLED VERTEX_PROVIDER; do
  if [ -n "${!var:-}" ]; then
    ENV_FLAGS+=("-e" "$var=${!var}")
  fi
done

# Mount GCP credential files into the container
GCP_MOUNT_FLAGS=()
if [ -n "${GOOGLE_APPLICATION_CREDENTIALS:-}" ] && [ -f "$GOOGLE_APPLICATION_CREDENTIALS" ]; then
  GCP_MOUNT_FLAGS+=("-v" "${GOOGLE_APPLICATION_CREDENTIALS}:/tmp/gcp-creds/sa.json:ro")
  ENV_FLAGS+=("-e" "GOOGLE_APPLICATION_CREDENTIALS=/tmp/gcp-creds/sa.json")
fi
ADC_PATH="${HOME}/.config/gcloud/application_default_credentials.json"
if [ -f "$ADC_PATH" ]; then
  GCP_MOUNT_FLAGS+=("-v" "${ADC_PATH}:/tmp/gcp-adc/application_default_credentials.json:ro")
fi

# ---- Docker (simple on all platforms) ----
if [ "$RUNTIME" = "docker" ]; then
  info "Detected Docker"
  mkdir -p "$HOME/.openclaw/installer"

  # Stop existing container
  docker stop "$CONTAINER_NAME" 2>/dev/null || true
  docker rm "$CONTAINER_NAME" 2>/dev/null || true

  docker run -d \
    --name "$CONTAINER_NAME" \
    -p "${PORT}:3000" \
    -v /var/run/docker.sock:/var/run/docker.sock \
    -v "$HOME/.openclaw:/home/node/.openclaw:ro" \
    -v "$HOME/.openclaw/installer:/home/node/.openclaw/installer" \
    "${ENV_FLAGS[@]}" \
    "${GCP_MOUNT_FLAGS[@]}" \
    "$IMAGE_NAME"

  success "OpenClaw Installer running at http://localhost:${PORT}"
  echo ""
  info "Open http://localhost:${PORT} in your browser."
  info "To stop: docker stop $CONTAINER_NAME"
  exit 0
fi

# ---- Podman ----
case "$OS" in
  Linux)
    info "Detected Linux + podman"

    # Find rootless podman socket
    PODMAN_SOCK="/run/user/$(id -u)/podman/podman.sock"
    if [ ! -S "$PODMAN_SOCK" ]; then
      systemctl --user start podman.socket 2>/dev/null || true
      if [ ! -S "$PODMAN_SOCK" ]; then
        error "Podman socket not found at $PODMAN_SOCK. Run: systemctl --user start podman.socket"
      fi
    fi

    mkdir -p "$HOME/.openclaw/installer"

    # Stop existing container
    podman stop "$CONTAINER_NAME" 2>/dev/null || true
    podman rm "$CONTAINER_NAME" 2>/dev/null || true

    podman run -d \
      --name "$CONTAINER_NAME" \
      --security-opt label=disable \
      -p "${PORT}:3000" \
      -v "$PODMAN_SOCK:/run/podman/podman.sock" \
      -v "$HOME/.openclaw:/home/node/.openclaw:ro,Z" \
      -v "$HOME/.openclaw/installer:/home/node/.openclaw/installer:Z" \
      "${ENV_FLAGS[@]}" \
      "${GCP_MOUNT_FLAGS[@]}" \
      "$IMAGE_NAME"

    success "OpenClaw Installer running at http://localhost:${PORT}"
    ;;

  *)
    error "Unsupported platform: $OS"
    ;;
esac

echo ""
info "Open http://localhost:${PORT} in your browser."
info "To stop: $RUNTIME stop $CONTAINER_NAME"
