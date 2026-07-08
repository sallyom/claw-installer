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

## What is included

- [Dockerfile](Dockerfile) layers OS tools and the OpenShell CLI onto an
  OpenClaw base image. By default it extends `quay.io/sallyom/openclaw:latest`;
  override `OPENCLAW_BASE_IMAGE` to use a digest-pinned or locally built base.
  Use this final image for the OpenShift PoC OpenClaw deployment.
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

Use an OpenClaw image that includes the OpenShell CLI at `/opt/openshell/bin/openshell`. For this PoC, the Kubernetes/OpenShift installer defaults OpenShell sandbox deployments to:

```text
quay.io/sallyom/openclaw-openshell:latest
```

Build a CLI-bearing image from the default PoC base:

```shell
podman build -t registry/name/openclaw:openshell -f openshell/Dockerfile .
```

Or layer the OpenShell CLI onto a specific OpenClaw image or digest:

```shell
podman build -t registry/name/openclaw:openshell \
  -f openshell/Dockerfile \
  --build-arg OPENCLAW_BASE_IMAGE=quay.io/sallyom/openclaw@sha256:<digest> \
  .
```

For source-based testing from `../openclaw`, use the helper. It first builds
OpenClaw from source, then layers the OpenShell CLI on top:

```shell
./openshell/build-openclaw-source-image.sh quay.io/yourname/openclaw:openshell
```

The image installs `openssh-client`, `rsync`, and the OpenShell CLI. It does not
bundle the OpenShell plugin into `/app/dist/extensions/openshell`; the
Kubernetes deployer installs the plugin into the PVC-backed OpenClaw home before
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

The OpenShell `openclaw` community sandbox image is large because it carries
multiple agent CLIs. For this PoC, build a slimmer Fedora-based sandbox image
for OpenClaw exec sessions:

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

Use the pushed image as the OpenShell sandbox source in the installer. TODO:
pin this by digest once the Fedora sandbox image contract stabilizes. The
OpenShift values in this directory also set `server.sandboxImagePullPolicy:
IfNotPresent` so sandbox pods do not repull the same tag on every start.

## OpenClaw OpenShell plugin install

For OpenShift/Kubernetes, the installer includes the OpenShell backend in the
consolidated `install-openclaw-plugins` initContainer when the OpenShell
sandbox backend is enabled. It runs:

```shell
node openclaw.mjs plugins install @openclaw/openshell-sandbox --force
node openclaw.mjs plugins list | grep -q openshell
```

The install writes to `/home/node/.openclaw` on the OpenClaw PVC, so the plugin
is present before the gateway reads config and registers sandbox backends.

## OpenShell CLI in the OpenClaw image

The NVIDIA OpenShell CLI must be available inside the OpenClaw gateway container at:

```text
/opt/openshell/bin/openshell
```

For this PoC, [Dockerfile](Dockerfile) installs the OpenShell `0.0.44` Debian
package into the OpenClaw image. The OpenShift deployer no longer creates a
separate CLI download initContainer or mounts an `openshell-cli` `emptyDir`.
At gateway startup, the OpenClaw container verifies the baked CLI and registers
the configured OpenShell gateway endpoint under the local name `openshell`.

For production, use an admin-owned internal image that carries a digest-pinned
OpenShell CLI artifact.

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
          "command": "/opt/openshell/bin/openshell",
          "gateway": "openshell",
          "from": "quay.io/sallyom/openclaw-openshell-sandbox:latest",
          "mode": "mirror",
          "gatewayEndpoint": "http://openshell.openshell-alice.svc.cluster.local:8080",
          "timeoutSeconds": 180
        }
      }
    }
  }
}
```

Use `mirror` for the first PoC. It keeps the OpenClaw PVC workspace canonical and
syncs to/from the OpenShell sandbox around exec. Use `remote` later when the
OpenShell sandbox should own workspace state after the first seed.

Set `from` to another full image reference when testing a different custom
OpenShell sandbox image. Bare names such as `openclaw` resolve through
OpenShell's community sandbox registry.

Do not mount the OpenClaw home directory or PVC into OpenShell sandbox pods for
this PoC. The sandbox should receive only mirrored workspace content. Keeping
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
their OpenClaw namespace can reach that gateway service and their OpenClaw image
includes the OpenShell CLI at `/opt/openshell/bin/openshell`.

## Current installer integration status

`claw-installer` now exposes OpenShell as a Kubernetes/OpenShift sandbox backend
option. Use it after a cluster admin has provisioned the user's OpenShell
gateway namespace.
