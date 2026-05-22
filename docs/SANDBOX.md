# Sandbox

This installer supports two OpenClaw sandbox backends:

- `ssh` for local, Kubernetes, and OpenShift deployments
- `openshell` for Kubernetes and OpenShift deployments when a platform admin has provisioned an OpenShell gateway

For upstream sandbox concepts and backend behavior, start with the OpenClaw docs:

- [OpenClaw sandboxing docs](https://github.com/openclaw/openclaw/blob/main/docs/gateway/sandboxing.md)

## Backend Choice

Use `ssh` when you want a simple remote Linux sandbox host that works from local containers and clusters.

Use `openshell` when the platform provides a shared OpenShell gateway and sandbox image for per-user or per-team cluster deployments.

Both backends avoid giving the OpenClaw gateway container its own nested container runtime. OpenShell setup is platform-owned because the gateway and sandbox runtime need cluster-side installation and policy.

## What it does

When enabled, OpenClaw runs sandboxed tool execution outside the main gateway container.

The sandbox runtime handles:

- `exec`
- file tools like `read`, `write`, `edit`, `apply_patch`
- other tool operations routed through the sandbox backend

Important behavior:

- with SSH, the remote sandbox is remote-canonical after the initial seed
- with OpenShell mirror mode, the OpenClaw PVC remains the canonical workspace and changes are mirrored into the sandbox
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

OpenShell is available for Kubernetes and OpenShift deploy targets.

Use these deploy form values:

- `Enable sandbox backend`: checked
- `Sandbox Backend`: `OpenShell`
- `Sandbox Mode`: `non-main` when a trusted manager agent should run on the gateway and worker sessions should be sandboxed, or `all` when every agent session should be sandboxed
- `Sandbox Scope`: `agent` for one sandbox per agent, or `session` for one sandbox per session
- `Workspace Access`: `rw`
- `OpenShell Gateway Endpoint`: cluster-internal URL for the provisioned OpenShell gateway, for example `http://openshell.openshell-alice.svc.cluster.local:8080`
- `OpenShell Workspace Mode`: `mirror`
- `OpenShell Sandbox Source`: a full sandbox image reference, or leave the default when the approved image is already configured

When OpenShell is enabled, the installer automatically installs the `@openclaw/openshell-sandbox` OpenClaw runtime plugin before gateway startup and writes a managed OpenShell policy file at `/home/node/.openclaw/openshell/policy.yaml`.

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

Kubernetes and OpenShift deployments:

- the OpenShell gateway endpoint is written into the generated OpenClaw plugin config
- the installer installs the OpenShell runtime plugin automatically
- the init container writes a managed OpenShell policy file into the OpenClaw PVC
- the policy keeps `/sandbox`, `/tmp`, and `/dev/null` writable, and allows read-only access to standard runtime paths plus `/home/sandbox` for shell startup files

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
- for OpenShell, the gateway endpoint is reachable from the OpenClaw pod
- for OpenShell, the OpenClaw image contains the OpenShell CLI at `/opt/openshell/bin/openshell`
- for OpenShell, the `@openclaw/openshell-sandbox` plugin install init container completed successfully

Typical failure patterns:

- host verification failures: add the server entry to `Known Hosts`
- auth failures: verify the key path, cert, and remote user
- host file changes not appearing in an SSH sandbox: recreate the sandbox runtime after the first seed
- OpenShell `.bash_profile` permission warnings: ensure the generated policy includes read-only `/home/sandbox`, then recreate the affected sandbox so the new policy applies

## Related docs

- [Local deployment guide](deploy-local.md)
- [Kubernetes deployment guide](deploy-kubernetes.md)
