# Sandbox

This installer supports two OpenClaw sandbox backends:

- `ssh` for local, Kubernetes, and OpenShift deployments
- `openshell` for local Podman deployments and for Kubernetes/OpenShift deployments with a provisioned OpenShell gateway

For upstream sandbox concepts and backend behavior, start with the OpenClaw docs:

- [OpenClaw sandboxing docs](https://github.com/openclaw/openclaw/blob/main/docs/gateway/sandboxing.md)

## Backend Choice

Use `ssh` when you want a simple remote Linux sandbox host that works from local containers and clusters.

Use `openshell` with a Podman-hosted gateway for local development, or with a shared platform gateway and sandbox image for cluster deployments.

Both backends avoid giving the OpenClaw gateway container its own nested container runtime. The local OpenShell gateway container owns Podman access through the mounted API socket; a cluster OpenShell gateway and runtime remain platform-owned.

## What it does

When enabled, OpenClaw runs sandboxed tool execution outside the main gateway container.

The sandbox runtime handles:

- `exec`
- file tools like `read`, `write`, `edit`, `apply_patch`
- other tool operations routed through the sandbox backend

Important behavior:

- with SSH, the remote sandbox is remote-canonical after the initial seed
- with OpenShell remote mode, the sandbox owns workspace state after the initial seed
- OpenClaw copies or mirrors the workspace to the sandbox on first use
- sandboxed changes happen inside the sandbox runtime and are synchronized according to the selected backend and workspace mode
- if you change host files and want an existing SSH sandbox to see them again, recreate the sandbox runtime from inside OpenClaw

## Recommended SSH Setup

Use these deploy form values:

- `Enable sandbox backend`: checked
- `Sandbox Backend`: `SSH`
- `Sandbox Mode`: `all`
- `Sandbox Scope`: `session`
- `Workspace Access`: `rw`
- `Remote Workspace Root`: `/tmp/openclaw-sandboxes`
- `SSH Target`: `user@gateway-host:22`

Start with `mode=all` and `scope=session` unless you have a reason to optimize for reuse.

## Recommended OpenShell Setup

OpenShell is available for local, Kubernetes, and OpenShift deploy targets.

The default OpenClaw/OpenShell image is the multi-arch UBI 9 build of OpenClaw
`v2026.7.1`, `quay.io/sallyom/openclaw-openshell:latest`. Pin its manifest
digest when reproducibility matters.

For local Podman on macOS, follow the [local OpenShell gateway setup](deploy-local.md#sandbox-backends).
It initializes persistent sandbox-JWT keys, configures the callback endpoint,
and starts the published gateway image with the Podman socket mounted. Use
`https://localhost:18080` as the installer endpoint; the installer rewrites that
loopback host to `host.containers.internal` inside the OpenClaw container.
For the equivalent setup without the deployer UI, including lazy sandbox
creation, scope reuse, persistence, pruning, and cleanup, see
[Run OpenClaw with local OpenShell sandboxes](openshell-local.md).

For Kubernetes/OpenShift, a cluster admin must install the Agent Sandbox
prerequisites and the OpenShell gateway first. See the runnable [OpenShift +
OpenShell demo](../openshell/demo.md#1-install-openshell-cluster-prerequisites)
for the CRD/controller, SCC, signing secret, Helm install, and verification
steps.

Use these deploy form values:

- `Enable sandbox backend`: checked
- `Sandbox Backend`: `OpenShell`
- `Sandbox Mode`: `non-main` when a trusted manager agent should run on the gateway and worker sessions should be sandboxed, or `all` when every agent session should be sandboxed
- `Sandbox Scope`: `agent` for one sandbox per agent, or `session` for one sandbox per session
- `Workspace Access`: `rw`
- `OpenShell Gateway Endpoint`: `https://localhost:18080` for local Podman, or the provisioned cluster-internal URL such as `http://openshell-alice.openshell-alice.svc.cluster.local:8080`
- `OpenShell Workspace Mode`: `remote`
- `OpenShell Sandbox Source`: a full sandbox image reference, or leave the default when the approved image is already configured

When OpenShell is enabled, the installer automatically installs `@openclaw/openshell-sandbox@2026.7.1` before gateway startup and writes a managed OpenShell policy file at `/home/node/.openclaw/openshell/policy.yaml`. Local deployments also copy the client-only mTLS bundle from the `openshell-client-tls` volume and persist the checksum-verified OpenShell CLI at `/home/node/.openclaw/bin/openshell`; cluster deployments mount the CLI at `/openshell-bin/openshell`.

## SSH Credentials

Required:

- an SSH-accessible Linux host
- `ssh` available inside the OpenClaw image
- a target string like `user@gateway-host:22`

Optional:

- `SSH Private Key`: path on the installer host to the private key file
- `SSH Certificate`: path on the installer host, or pasted certificate text
- `Known Hosts`: path on the installer host, or pasted `known_hosts` entries

## How this installer passes SSH material

Local deployments:

- the installer copies SSH auth files into the OpenClaw writable volume with container-readable permissions
- OpenClaw then uses file-backed sandbox config inside the container

Kubernetes deployments:

- SSH material is stored in the generated `openclaw-secrets` Secret
- the gateway container receives it through environment variables
- OpenClaw maps those env vars into sandbox SSH config

## How this installer configures OpenShell

Local deployments:

- the OpenShell gateway container owns the mounted Podman socket and creates sibling sandbox containers
- the installer rewrites loopback gateway endpoints for container networking
- the installer installs the pinned runtime plugin and OpenShell CLI into the OpenClaw volume
- the OpenClaw container uses the OpenShell-capable image by default so `ssh` and `rsync` are available
- the installer writes the managed OpenShell policy into the OpenClaw volume

The Podman socket is a privileged local control surface. OpenClaw does not
receive it, and the OpenShell gateway port should not be exposed to an
untrusted network.

Kubernetes and OpenShift deployments:

- the OpenShell gateway endpoint is written into the generated OpenClaw plugin config
- the installer downloads the checksum-verified OpenShell CLI into a shared `emptyDir`
- the installer installs the pinned OpenShell runtime plugin automatically
- the init container writes a managed OpenShell policy file into the OpenClaw PVC
- the gateway adds `/openshell-bin` to `PATH`, allowing both the plugin and its generated SSH `ProxyCommand` to invoke the CLI
- the policy matches the lab's filesystem and network allowlist baseline

The plugin calls the configured gateway endpoint for sandbox lifecycle and to
request sandbox-specific SSH config. OpenClaw then uses `ssh` with that config;
its `ProxyCommand` runs `openshell ssh-proxy` to reach the sandbox through the
gateway. It does not SSH into the gateway, and the OpenShell backend does not
use the installer fields for a static SSH target, key, certificate, or
known-hosts file.

## SSH Remote Host Requirements

Your sandbox host should provide:

- SSH access for the configured user
- a writable directory for `Remote Workspace Root`
- enough disk space for sandbox workspaces
- standard shell tools expected by OpenClaw's SSH sandbox flow

## Troubleshooting

Common checks:

- `SSH Target` is reachable from the gateway container or pod
- the configured key or certificate is valid for that host
- `Known Hosts` matches the target when strict checking is enabled
- the remote user can create directories under `Remote Workspace Root`
- the OpenClaw image actually contains the `ssh` client
- for local OpenShell, `podman logs openshell-gateway` reports `Connected to Podman` and `gateway-minted sandbox JWT enabled`
- for local OpenShell, `/home/node/.openclaw/bin/openshell --version` succeeds in the OpenClaw container
- for cluster OpenShell, the gateway endpoint is reachable from the OpenClaw pod
- for cluster OpenShell, `/openshell-bin/openshell --version` succeeds in the gateway pod
- for OpenShell, the `@openclaw/openshell-sandbox` plugin install init container completed successfully

Typical failure patterns:

- host verification failures: add the server entry to `Known Hosts`
- auth failures: verify the key path, cert, and remote user
- host file changes not appearing in an SSH sandbox: recreate the sandbox runtime after the first seed
- OpenShell CLI failures: inspect the `install-openclaw-plugins` init container for download or checksum errors

## Related docs

- [Manual local OpenShell guide](openshell-local.md)
- [Local deployment guide](deploy-local.md)
- [Kubernetes deployment guide](deploy-kubernetes.md)
