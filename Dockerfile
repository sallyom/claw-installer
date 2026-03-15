FROM registry.access.redhat.com/ubi9/nodejs-22 AS build
USER 0
WORKDIR /opt/app-root/src
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM registry.fedoraproject.org/fedora-minimal:41
WORKDIR /app

USER 0

# Install Node.js 22 and podman-remote 5.x
RUN microdnf install -y nodejs22 podman-remote && microdnf clean all
RUN ln -sf /usr/bin/podman-remote /usr/bin/podman

# Create node user (uid 1000) matching openclaw image.
# UBI minimal images default to uid 1001 — we need 1000 for compatibility.
RUN useradd -u 1000 -g 0 -d /home/node -m node && \
    chown node:0 /app

COPY --from=build --chown=node:0 /opt/app-root/src/package.json /opt/app-root/src/package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build --chown=node:0 /opt/app-root/src/dist ./dist

# Pre-create state directory with OpenShift-compatible perms (group 0 = root group)
RUN mkdir -p /home/node/.openclaw/installer && \
    chown -R node:0 /home/node && \
    chmod -R g=u /home/node

COPY --chmod=755 run.sh ./

ENV NODE_ENV=production
ENV HOME=/home/node
ENV CONTAINER_HOST=unix:///run/podman/podman.sock

USER node

EXPOSE 3000
CMD ["node", "dist/server/index.js"]
