# OpenClaw on UBI 9 for the OpenShift + OpenShell sandbox PoC.
#
# This follows Ryan Nix's OpenShift image layout: build OpenClaw from a pinned
# release in a UBI Node.js builder, then copy the production tree into a clean
# UBI Node.js runtime. OpenShell-specific runtime tools and the sandbox account
# are added because this image can be used both for OpenClaw and as `from` for
# OpenShell sandboxes.
#
# Source reference:
# https://github.com/ryannix123/openclaw-on-openshift/blob/main/Containerfile

# UBI 10's current Node 22 and Node 24 images embed SQLite 3.46.1, which
# OpenClaw 2026.7.1 rejects for WAL safety. UBI 9 Node 22 currently provides
# Node 22.23.1 with SQLite 3.51.3 on linux/amd64 and linux/arm64.
ARG OPENCLAW_BUILDER_IMAGE=registry.access.redhat.com/ubi9/nodejs-22:latest
ARG OPENCLAW_RUNTIME_IMAGE=registry.access.redhat.com/ubi9/nodejs-22:latest

FROM ${OPENCLAW_BUILDER_IMAGE} AS builder

ARG OPENCLAW_REF=v2026.7.1
ARG PNPM_VERSION=11.2.2

USER 0
WORKDIR /build

ENV CI=true

RUN dnf install -y --setopt=install_weak_deps=False \
      gcc \
      gcc-c++ \
      git \
      make \
      python3 \
    && dnf clean all \
    && rm -rf /var/cache/dnf /var/cache/yum

RUN npm install --global "pnpm@${PNPM_VERSION}"

RUN git clone --depth 1 --branch "${OPENCLAW_REF}" \
      https://github.com/openclaw/openclaw.git .

RUN pnpm install --frozen-lockfile

RUN pnpm build

# A bare `pnpm prune --prod` can spend hours walking the full workspace on
# overlayfs, particularly on arm64 Podman machines. Recreate node_modules from
# the already-populated pnpm store instead; the builder (and its store) is not
# copied into the runtime image.
RUN find . -type d -name node_modules -prune -exec rm -rf {} + \
    && pnpm install --prod --frozen-lockfile

RUN rm -rf \
      .git \
      .github \
      extensions/openshell \
      examples \
      scripts \
      test \
      tests \
      __tests__

FROM ${OPENCLAW_RUNTIME_IMAGE} AS runtime

ARG SANDBOX_UID=65532
ARG SANDBOX_GID=65532

LABEL org.opencontainers.image.title="OpenClaw OpenShell UBI" \
      org.opencontainers.image.description="OpenClaw 2026.7.1 on UBI 9 for OpenShift and OpenShell sandboxes" \
      org.opencontainers.image.source="https://github.com/openclaw/claw-installer" \
      io.k8s.display-name="OpenClaw OpenShell UBI 9" \
      io.openshift.expose-services="18789:http" \
      io.openshift.tags="ai,agent,nodejs,openclaw,openshell,ubi9"

USER 0

RUN dnf install -y --setopt=install_weak_deps=False \
      ca-certificates \
      curl-minimal \
      git \
      gzip \
      openssh-clients \
      rsync \
      shadow-utils \
      tar \
    && dnf clean all \
    && rm -rf /var/cache/dnf /var/cache/yum \
    && groupadd --gid "${SANDBOX_GID}" sandbox \
    && useradd --no-log-init \
      --uid "${SANDBOX_UID}" \
      --gid "${SANDBOX_GID}" \
      --create-home \
      --home-dir /home/sandbox \
      --shell /bin/bash \
      sandbox \
    && mkdir -p \
      /app \
      /opt/openclaw/config \
      /opt/openclaw/workspace \
      /sandbox \
      /workspace \
    && chown -R 1001:0 /app /opt/openclaw \
    && chmod -R g=u /opt/openclaw \
    && chown -R sandbox:sandbox /home/sandbox /sandbox /workspace \
    && chmod 0770 /sandbox /workspace

COPY --from=builder --chown=1001:0 /build /app

RUN ln -sf /app/openclaw.mjs /usr/local/bin/openclaw \
    && chmod 0755 /app/openclaw.mjs \
    && chmod -R g+rwX /app /opt/openclaw \
    && command -v npm \
    && command -v ssh \
    && command -v rsync \
    && test ! -e /app/extensions/openshell \
    && test ! -e /app/dist/extensions/openshell

ENV OPENCLAW_CONFIG_DIR=/opt/openclaw/config \
    OPENCLAW_WORKSPACE_DIR=/opt/openclaw/workspace \
    OPENCLAW_DISABLE_BONJOUR=1 \
    NODE_ENV=production \
    HOME=/opt/openclaw \
    PATH=/app/node_modules/.bin:$PATH

WORKDIR /app
EXPOSE 18789

USER 1001

ENTRYPOINT ["node", "/app/openclaw.mjs"]
CMD ["gateway", "run", "--bind", "lan", "--port", "18789"]
