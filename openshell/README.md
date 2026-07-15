# OpenClaw with OpenShell Sandboxes

This directory is a proof-of-concept package for running many personal OpenClaw
instances on OpenShift while delegating command execution to OpenShell
sandboxes.

The intended model is:

```text
OpenShift cluster
  openshell-<user> namespace
    OpenShell gateway
    OpenShell-created sandbox pods

  openclaw-<user> namespace
    OpenClaw gateway
    OpenClaw PVC, Secret, Service, Route
    @openclaw/openshell-sandbox plugin
```

OpenClaw is not itself inside an OpenShell sandbox. OpenClaw is the persistent
user-facing app. Its sandboxed tools call the OpenShell plugin, which creates or
reuses OpenShell sandboxes for risky runtime work.

The installer deploys OpenClaw against an existing OpenShell gateway; it does
not install that gateway. A cluster admin follows [demo.md](demo.md) to install
the Agent Sandbox prerequisites, create the per-user OpenShell namespace and
signing secret, grant the scoped SCC, and install the gateway Helm release.

## What is included

- [Dockerfile](Dockerfile) is a standalone UBI source build matching Ryan's
  OpenShift builder/runtime layout. It pins OpenClaw `v2026.7.1`, uses UBI 9
  Node 22 for its SQLite 3.51.3 runtime, and adds the
  runtime tools and `sandbox` account required to use the same image as an
  OpenShell sandbox source. The Kubernetes/OpenShift path injects the OpenShell
  CLI and plugin at pod startup.
- [build-openclaw-source-image.sh](build-openclaw-source-image.sh) builds
  OpenClaw from `../openclaw` with the core extensions used by the PoC. The
  OpenShell plugin remains external and is installed by the Kubernetes deployer.
- [configs/openshell-values-openshift.yaml](configs/openshell-values-openshift.yaml)
  contains the OpenShift-friendly OpenShell Helm overrides.
- [configs/openshell-namespace.yaml](configs/openshell-namespace.yaml)
  creates the per-user OpenShell namespace.
- [configs/openclaw-openshell-overlay.json](configs/openclaw-openshell-overlay.json)
  is the OpenClaw config fragment that enables the OpenShell sandbox backend.
- [configs/openclaw-namespace-rbac.yaml](configs/openclaw-namespace-rbac.yaml)
  is a minimal namespace/service-account example for a user OpenClaw namespace.
- [configs/networkpolicy-openclaw-to-openshell.yaml](configs/networkpolicy-openclaw-to-openshell.yaml)
  allows OpenClaw-to-OpenShell gateway traffic on clusters with default-deny
  egress.
- [demo.md](demo.md) is the step-by-step PoC runbook.

## Image options

The Kubernetes/OpenShift installer temporarily defaults to this image for both
OpenClaw and the OpenShell sandbox source:

```text
quay.io/sallyom/openclaw-openshell:latest
```

This is the multi-arch UBI 9 source build from [Dockerfile](Dockerfile), built
from OpenClaw `v2026.7.1` for `linux/amd64` and `linux/arm64`. The mutable
`latest` tag is an interim PoC default; pin its manifest digest for a
reproducible deployment.

The UBI 10 Node images tested during this work embed SQLite 3.46.1, which
OpenClaw 2026.7.1 rejects for WAL safety. The local Dockerfile therefore keeps
Ryan's builder/runtime layout but uses UBI 9 Node 22, verified with SQLite
3.51.3 on both target architectures.

The installer injects the OpenShell CLI and plugin at pod startup; they are not
baked into this image. The image itself supplies the compatible Node/SQLite
runtime plus `ssh`, `rsync`, and the sandbox user. To build it locally:

```shell
podman build -t registry/name/openclaw:openshell -f openshell/Dockerfile .
```

Override the pinned OpenClaw release when intentionally testing another tag:

```shell
podman build -t registry/name/openclaw:openshell \
  -f openshell/Dockerfile \
  --build-arg OPENCLAW_REF=v2026.7.1 \
  .
```

The helper builds the same Dockerfile and checks the OpenClaw version,
`sandbox` account, and required runtime tools:

```shell
./openshell/build-openclaw-source-image.sh quay.io/yourname/openclaw:openshell
```

The image installs `curl`, Git, OpenSSH client tools, `rsync`, and `tar`. It
does not embed the OpenShell CLI or bundle the OpenShell plugin into
`/app/dist/extensions/openshell`; the Kubernetes deployer injects both before
gateway startup. Avoid relying on image-build plugin installs under
`/home/node`; the Kubernetes deployer mounts the OpenClaw PVC at `/home/node`,
which hides image-layer home content.

The OpenShell plugin is intentionally externalized. The Kubernetes deployer installs the published
`@openclaw/openshell-sandbox` package into the PVC-backed OpenClaw home before
the gateway starts. If that initContainer cannot reach npm, the gateway config
can select `backend: "openshell"` but agents fail with:

```text
Sandbox backend "openshell" is not registered.
```

This can be remedied by running `openclaw doctor` from the OpenClaw container's terminal.

## OpenShell sandbox image

The installer uses `quay.io/sallyom/openclaw-openshell:latest` as both the
OpenClaw image and OpenShell sandbox source. A slimmer Fedora-based sandbox
remains available for experiments:

```shell
podman build -t registry/name/openclaw-openshell-sandbox:latest \
  -f openshell/Dockerfile.sandbox .

# public image at quay.io/sallyom/openclaw-openshell-sandbox:latest
podman image inspect quay.io/sallyom/openclaw-openshell-sandbox:latest \
  --format '{{ index .RepoDigests 0 }}'
```

The default image includes common shell, network, archive, Git, Python, and Node
tooling. It does not include Claude, Codex, Copilot, or OpenCode CLIs.

OpenShell's default sandbox policy drops privileges to `sandbox:sandbox`, so the
image must include a non-root `sandbox` user and group. The Dockerfile uses a
non-root UID/GID of `65532:65532`: high enough to avoid the common UID 1000
`RLIMIT_NPROC` collision on shared OpenShift nodes, but still within the
usual rootless Podman container UID range. Override these only if your cluster
needs a specific range:

```shell
podman build -t quay.io/sallyom/openclaw-openshell-sandbox:build-tools \
  -f openshell/Dockerfile.sandbox \
  --build-arg INSTALL_BUILD_TOOLS=true .
```

Use the pushed image as an explicit OpenShell sandbox source override. The
OpenShift values in this directory set `server.sandboxImagePullPolicy:
IfNotPresent`; pin a digest when changing the image behind a reused tag.

## OpenClaw OpenShell plugin install

For OpenShift/Kubernetes, the installer includes the OpenShell backend in the
consolidated `install-openclaw-plugins` initContainer when the OpenShell
sandbox backend is enabled. It runs:

```shell
node openclaw.mjs plugins install @openclaw/openshell-sandbox@2026.7.1 --force
node openclaw.mjs plugins list | grep -q openshell
```

The install writes to `/home/node/.openclaw` on the OpenClaw PVC, so the plugin
is present before the gateway reads config and registers sandbox backends.

## OpenShell CLI injection

The NVIDIA OpenShell CLI is mounted inside the OpenClaw gateway container at:

```text
/openshell-bin/openshell
```

The consolidated plugin init container downloads the OpenShell `0.0.83` static
Linux CLI for `x86_64` or `aarch64`, verifies its release checksum, and extracts
it into an `openshell-cli` `emptyDir`. The gateway mounts that volume read-only
and adds `/openshell-bin` to `PATH`.

There are two related connections. The plugin invokes the OpenShell CLI with
`gatewayEndpoint` to manage sandbox lifecycle and obtain sandbox-specific SSH
configuration. OpenClaw then uses its SSH client with that generated config;
the config's `ProxyCommand` runs `openshell ssh-proxy` to tunnel execution and
file transfer through the OpenShell gateway to the sandbox. OpenClaw does not
SSH into the gateway, and the user does not provide a static SSH key or target
for the OpenShell backend. The deployment also does not add or select a named
gateway in CLI state.

## OpenClaw configuration

The important OpenClaw config is:

```json
{
  "agents": {
    "defaults": {
      "sandbox": {
        "mode": "all",
        "backend": "openshell",
        "scope": "session",
        "workspaceAccess": "rw"
      }
    }
  },
  "plugins": {
    "entries": {
      "openshell": {
        "enabled": true,
        "config": {
          "from": "quay.io/sallyom/openclaw-openshell:latest",
          "mode": "remote",
          "gatewayEndpoint": "http://openshell-alice.openshell-alice.svc.cluster.local:8080",
          "policy": "/home/node/.openclaw/openshell/policy.yaml",
          "timeoutSeconds": 180
        }
      }
    }
  }
}
```

`remote` matches the lab: the OpenShell sandbox owns workspace state after the
first seed. `mirror` remains available when the OpenClaw PVC should remain
canonical and sync around each execution.

Set `from` to another full image reference when testing a different custom
OpenShell sandbox image. Bare names such as `openclaw` resolve through
OpenShell's community sandbox registry.

Do not mount the OpenClaw home directory or PVC into OpenShell sandbox pods for
this PoC. The sandbox should receive only seeded workspace content. Keeping
`/home/node/.openclaw` in the OpenClaw namespace avoids exposing auth profiles,
session state, plugin installs, and other control-plane data to disposable
sandbox pods.

## Tenancy assumptions

For the PoC, assume a cluster admin creates one OpenShell namespace per user and
one OpenClaw namespace per user:

```text
openshell-alice
openclaw-alice
openshell-bob
openclaw-bob
```

Keep OpenClaw out of the OpenShell namespace. The OpenShell namespace needs
privileged SCC for sandbox execution; the OpenClaw namespace should remain a
normal application namespace with only the permissions OpenClaw needs.

Users should select the OpenShell sandbox backend in the installer only after a
cluster admin has provisioned their OpenShell gateway namespace and confirmed
their OpenClaw namespace can reach that gateway service.

## Current installer integration status

`claw-installer` now exposes OpenShell as a Kubernetes/OpenShift sandbox backend
option. Use it after a cluster admin has provisioned the user's OpenShell
gateway namespace.
