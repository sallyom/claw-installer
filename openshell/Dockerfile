# OpenClaw image for the OpenShift + OpenShell sandbox PoC.
#
# This image carries the OS tools and OpenShell CLI needed by the OpenShell
# sandbox plugin. The plugin itself is installed into the PVC-backed OpenClaw
# home by the Kubernetes deployer so it is not hidden by the /home/node mount.
ARG OPENCLAW_BASE_IMAGE=quay.io/sallyom/openclaw:latest

ARG OPENSHELL_CLI_VERSION=0.0.44

FROM ${OPENCLAW_BASE_IMAGE} AS ssh-runtime
USER root

RUN apt-get update && \
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      openssh-client && \
    mkdir -p /ssh-root/usr/bin /ssh-root/etc/ssh && \
    cp /usr/bin/ssh /ssh-root/usr/bin/ssh && \
    cp /etc/ssh/ssh_config /ssh-root/etc/ssh/ssh_config && \
    if [ -d /etc/ssh/ssh_config.d ]; then \
      mkdir -p /ssh-root/etc/ssh/ssh_config.d; \
      cp -a /etc/ssh/ssh_config.d/. /ssh-root/etc/ssh/ssh_config.d/; \
    fi && \
    ldd /usr/bin/ssh | \
      awk '/=> \// { print $(NF - 1) } /^\/.*ld-linux/ { print $1 }' | \
      sort -u | \
      xargs -r -I '{}' cp --parents '{}' /ssh-root && \
    rm -rf /var/lib/apt/lists/*

FROM ${OPENCLAW_BASE_IMAGE} AS openshell-cli
ARG OPENSHELL_CLI_VERSION
USER root

RUN apt-get update && \
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      ca-certificates \
      curl && \
    rm -rf /var/lib/apt/lists/*

RUN set -eux; \
    arch="$(dpkg --print-architecture)"; \
    case "$arch" in amd64|arm64) ;; *) echo "unsupported OpenShell CLI architecture: $arch" >&2; exit 1 ;; esac; \
    tmp="$(mktemp -d)"; \
    deb="openshell_${OPENSHELL_CLI_VERSION}-1_${arch}.deb"; \
    curl -fsSL "https://github.com/NVIDIA/OpenShell/releases/download/v${OPENSHELL_CLI_VERSION}/${deb}" -o "$tmp/$deb"; \
    dpkg-deb -x "$tmp/$deb" "$tmp/root"; \
    install -d -m 0755 /openshell-root/opt/openshell/bin; \
    install -m 0755 "$tmp/root/usr/bin/openshell" /openshell-root/opt/openshell/bin/openshell; \
    /openshell-root/opt/openshell/bin/openshell --version; \
    rm -rf "$tmp"

FROM ${OPENCLAW_BASE_IMAGE}
USER root

# The plugin invokes `openshell sandbox ssh-config`, then runs `ssh -F ...`.
# Copy only that runtime surface into the final image; do not install the full
# openssh-client package, scp/sftp/key tools, curl, or rsync.
COPY --from=ssh-runtime /ssh-root/ /
COPY --from=openshell-cli /openshell-root/ /

RUN /opt/openshell/bin/openshell --version && ssh -V

USER node

# OpenShell gateway/auth registration is written into the PVC-backed home by the
# Kubernetes deployment before the OpenClaw gateway starts.
