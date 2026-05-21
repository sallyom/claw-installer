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

- [Dockerfile](Dockerfile) extends `ghcr.io/openclaw/openclaw:2026.5.19-beta.2`
  with OS tools needed for the OpenShell plugin path. Use this only for smoke
  tests when the base image already has the plugin available.
- [build-openclaw-source-image.sh](build-openclaw-source-image.sh) builds
  OpenClaw from `../openclaw` with bundled extensions. This is the reliable
  OpenShift PoC image path.
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

Use the fast image only for smoke tests:

```shell
podman build -t openclaw-openshell:2026.5.19-beta.2 -f openshell/Dockerfile .
```

That image starts from the published OpenClaw beta and installs `openssh-client`
and `rsync`. It does not guarantee the OpenShell plugin is bundled in `/app`.
Avoid relying on image-build plugin installs under `/home/node`; the Kubernetes
deployer mounts the OpenClaw PVC at `/home/node`, which hides image-layer home
content.

For the OpenShift PoC, build from `../openclaw`:

```shell
./openshell/build-openclaw-source-image.sh openclaw-openshell:local
```

The bundled extension directory is named `openshell` in the OpenClaw repository;
the published package name is `@openclaw/openshell-sandbox`.

## OpenShell CLI mount

OpenClaw does not install the OpenShell CLI in its image for this PoC. The
NVIDIA OpenShell CLI must be available inside the OpenClaw gateway container at:

```text
/opt/openshell/bin/openshell
```

For OpenShift/Kubernetes, keep this mount read-only. A clean production pattern is an admin-owned
initContainer that copies a digest-pinned OpenShell CLI artifact from a trusted
internal image into an `emptyDir`, then mounts that `emptyDir` into the gateway
container read-only. The OpenClaw image stays independent of OpenShell release
packaging, while the platform team controls the CLI version.

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
          "from": "openclaw",
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
their OpenClaw namespace can reach that gateway service and has the OpenShell
CLI mounted at `/opt/openshell/bin/openshell`.

## Current installer integration status

`claw-installer` now exposes OpenShell as a Kubernetes/OpenShift sandbox backend
option. Use it after a cluster admin has provisioned the user's OpenShell
gateway namespace.

The next implementation step is to teach the installer form/deployers to:

- default the OpenClaw image to the image built from this directory for the PoC
- generate the platform-provided OpenShell CLI mount for Kubernetes/OpenShift
- mount or provide any OpenShell auth config needed by secured gateway setups
