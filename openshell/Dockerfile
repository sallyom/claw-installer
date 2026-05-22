# OpenClaw image for the OpenShift + OpenShell sandbox PoC.
#
# This image carries the OS tools and OpenShell CLI needed by the OpenShell
# sandbox plugin. The plugin itself is installed into the PVC-backed OpenClaw
# home by the Kubernetes deployer so it is not hidden by the /home/node mount.
ARG OPENCLAW_BASE_IMAGE=quay.io/sallyom/openclaw:latest
FROM ${OPENCLAW_BASE_IMAGE}

ARG OPENSHELL_CLI_VERSION=0.0.44

USER root

# openssh-client is required because the OpenShell plugin obtains SSH config
# from `openshell sandbox ssh-config` and then uses the OpenClaw SSH transport.
RUN apt-get update && \
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      ca-certificates \
      curl \
      openssh-client \
      rsync && \
    rm -rf /var/lib/apt/lists/*

RUN set -eux; \
    arch="$(dpkg --print-architecture)"; \
    case "$arch" in amd64|arm64) ;; *) echo "unsupported OpenShell CLI architecture: $arch" >&2; exit 1 ;; esac; \
    tmp="$(mktemp -d)"; \
    deb="openshell_${OPENSHELL_CLI_VERSION}-1_${arch}.deb"; \
    curl -fsSL "https://github.com/NVIDIA/OpenShell/releases/download/v${OPENSHELL_CLI_VERSION}/${deb}" -o "$tmp/$deb"; \
    dpkg-deb -x "$tmp/$deb" "$tmp/root"; \
    install -d -m 0755 /opt/openshell/bin; \
    install -m 0755 "$tmp/root/usr/bin/openshell" /opt/openshell/bin/openshell; \
    /opt/openshell/bin/openshell --version; \
    rm -rf "$tmp"

USER node

# OpenShell gateway/auth registration is written into the PVC-backed home by the
# Kubernetes deployment before the OpenClaw gateway starts.
