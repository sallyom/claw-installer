# Sandbox

This installer currently supports OpenClaw's `ssh` sandbox backend.

For upstream sandbox concepts and backend behavior, start with the OpenClaw docs:

- [OpenClaw sandboxing docs](https://github.com/openclaw/openclaw/blob/main/docs/gateway/sandboxing.md)

## Why this installer uses SSH

For this installer, `ssh` is the practical sandbox path because it works across:

- local podman/docker deployments
- Kubernetes deployments
- OpenShift deployments

It avoids Docker-in-Docker, nested container runtime setup inside the gateway, and privileged cluster requirements.

## What it does

When enabled, OpenClaw runs sandboxed tool execution on a separate SSH-reachable host instead of inside the main gateway container.

That remote host becomes the sandbox runtime for:

- `exec`
- file tools like `read`, `write`, `edit`, `apply_patch`
- other tool operations routed through the sandbox backend

Important behavior:

- the SSH sandbox is remote-canonical after the initial seed
- OpenClaw copies the local workspace to the remote sandbox on first use
- later sandboxed changes happen on the remote side
- if you change host files and want the sandbox to see them again, recreate the sandbox runtime from inside OpenClaw

## Recommended first setup

Use these deploy form values:

- `Enable SSH sandbox backend`: checked
- `Sandbox Mode`: `all`
- `Sandbox Scope`: `session`
- `Workspace Access`: `rw`
- `Remote Workspace Root`: `/tmp/openclaw-sandboxes`
- `SSH Target`: `user@gateway-host:22`

Start with `mode=all` and `scope=session` unless you have a reason to optimize for reuse.

## Credentials

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

Kubernetes / OpenShift deployments:

- SSH material is stored in the generated `openclaw-secrets` Secret
- the gateway container receives it through environment variables
- OpenClaw maps those env vars into sandbox SSH config

## Remote host requirements

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

Typical failure patterns:

- host verification failures: add the server entry to `Known Hosts`
- auth failures: verify the key path, cert, and remote user
- host file changes not appearing in sandbox: recreate the sandbox runtime after the first seed

## Related docs

- [Local deployment guide](docs/deploy-local.md)
- [OpenShift / Kubernetes deployment guide](docs/deploy-openshift.md)
