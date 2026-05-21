# OpenClaw image for the OpenShift + OpenShell sandbox PoC.
#
# This is the fast smoke-test path: extend the published beta image and install
# OS tools used by the OpenShell sandbox plugin. For the OpenShift PoC, prefer
# build-openclaw-source-image.sh so the OpenShell plugin is bundled under /app
# and is not hidden by the Kubernetes PVC mounted at /home/node.
FROM ghcr.io/openclaw/openclaw:2026.5.19-beta.2

USER root

# openssh-client is required because the OpenShell plugin obtains SSH config
# from `openshell sandbox ssh-config` and then uses OpenClaw's SSH transport.
RUN apt-get update && \
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      openssh-client \
      rsync && \
    rm -rf /var/lib/apt/lists/*

USER node

# Keep this image generic. OpenShell gateway/auth configuration is mounted or
# injected by the OpenShift deployment, not baked into the image.
