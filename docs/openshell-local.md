# Run OpenClaw with local OpenShell sandboxes

This guide connects a manually managed OpenClaw Gateway to an OpenShell
gateway running in Podman on macOS. It describes the same runtime contract that
the installer UI assembles automatically, including when OpenShell creates and
removes sandbox containers.

The recommended local layout keeps OpenClaw and OpenShell separate. OpenClaw
does not receive the Podman socket and does not start nested containers.

## Before you begin

You need:

- macOS with a running Podman machine (`podman info` must succeed)
- an existing OpenClaw installation or OpenClaw container
- port `18080` available on loopback for the OpenShell gateway
- an OpenClaw runtime with `ssh` and `rsync`
- the OpenShell-capable image
  `quay.io/sallyom/openclaw-openshell:latest` when OpenClaw runs in Podman

The examples match the installer pins in `src/server/deployers/sandbox.ts`:

- OpenShell CLI `0.0.83`
- `@openclaw/openshell-sandbox@2026.7.1`
- `quay.io/sallyom/openclaw-openshell:latest`

Update the guide and installer constants together when changing these pins.

## Understand the local architecture

```text
OpenClaw Gateway
  |
  | openshell CLI over mTLS
  v
OpenShell gateway container
  |
  | mounted Podman API socket
  v
openshell-sandbox-<scope>-<hash> container
  +-- persistent openshell-sandbox-<id>-workspace volume

OpenClaw tool execution
  `-- ssh -> openshell ssh-proxy -> sandbox supervisor
```

The OpenShell gateway is the only component with the Podman socket. It creates
sibling sandbox containers through the Podman API. The OpenClaw Gateway uses
the OpenShell CLI for lifecycle calls and as the SSH `ProxyCommand` for command
execution and file transfer.

On local Podman, these are containers even if other OpenShell documentation
uses the generic term _sandbox runtime_ or describes Kubernetes sandbox pods.
Their names begin with `openshell-sandbox-`.

## Start the local OpenShell gateway

Follow the one-time certificate and gateway setup in
[Deploying OpenClaw Locally](deploy-local.md#sandbox-backends). That procedure
creates:

- `openshell-state`, containing the gateway database, server certificate,
  sandbox-JWT signing keys, and other gateway state
- `openshell-client-tls`, containing only the client CA, certificate, and key
- `openshell-gateway`, the long-running gateway container bound to
  `127.0.0.1:18080`

Verify it before configuring OpenClaw:

```bash
podman ps --filter name=openshell-gateway
podman logs openshell-gateway
```

The logs should report that the gateway connected to Podman and that
gateway-minted sandbox JWTs are enabled.

The mounted Podman API socket is a privileged local control surface. Keep port
`18080` bound to loopback and do not expose the gateway to an untrusted
network.

## Prepare a manually managed OpenClaw runtime

Perform these steps in the environment where the OpenClaw Gateway process
runs. For a Podman-hosted OpenClaw, that means inside the OpenClaw image or in a
one-off container sharing its persistent `/home/node` volume.

### Install the plugin and CLI

Install the runtime plugin:

```bash
openclaw plugins install @openclaw/openshell-sandbox@2026.7.1
openclaw plugins list
```

Install OpenShell CLI `0.0.83` on the same `PATH` used by the OpenClaw Gateway.
The local deployer downloads the checksum-verified static Linux binary to:

```text
/home/node/.openclaw/bin/openshell
```

For a containerized OpenClaw, install the pinned static Linux binary into its
persistent home volume:

```bash
mkdir -p /home/node/.openclaw/bin
case "$(uname -m)" in
  x86_64) target="x86_64-unknown-linux-musl"; checksum="1307199935caece720eb63faa8f7df88a6201c846efc411bf3c1ef8a789c6821" ;;
  aarch64|arm64) target="aarch64-unknown-linux-musl"; checksum="17e718f9820756b1e507176c7562d5b463a8e5108d55980fc933e731e6154db8" ;;
  *) echo "unsupported OpenShell CLI architecture: $(uname -m)" >&2; exit 1 ;;
esac
archive="openshell-${target}.tar.gz"
curl -fsSL "https://github.com/NVIDIA/OpenShell/releases/download/v0.0.83/${archive}" -o "/tmp/${archive}"
echo "${checksum}  /tmp/${archive}" | sha256sum -c -
tar -xzf "/tmp/${archive}" -C /home/node/.openclaw/bin
chmod 0755 /home/node/.openclaw/bin/openshell
```

If OpenClaw runs directly on macOS, install only the matching CLI with
`uv tool install openshell==0.0.83`. The all-in-one OpenShell macOS installer
also starts a native gateway, which is unnecessary when this Podman gateway is
already running.

Verify the binary from the OpenClaw runtime:

```bash
openshell --version
ssh -V
rsync --version
```

### Install the client mTLS bundle

The OpenShell CLI needs the three files from `openshell-client-tls` under the
named gateway directory:

```text
$HOME/.config/openshell/gateways/openshell/mtls/ca.crt
$HOME/.config/openshell/gateways/openshell/mtls/tls.crt
$HOME/.config/openshell/gateways/openshell/mtls/tls.key
```

Set the private key mode to `0600`. If OpenClaw runs in Podman, persist the
whole `/home/node` directory rather than only `/home/node/.openclaw`; the TLS
directory is under `/home/node/.config`.

For example, copy the bundle into an existing OpenClaw home volume with a
one-off container:

```bash
OPENCLAW_HOME_VOLUME=<openclaw-home-volume>
podman run --rm --user 0 \
  -v "${OPENCLAW_HOME_VOLUME}:/home/node:nocopy" \
  -v openshell-client-tls:/source:ro \
  --entrypoint /bin/sh \
  quay.io/sallyom/openclaw-openshell:latest \
  -c 'dest=/home/node/.config/openshell/gateways/openshell/mtls; mkdir -p "$dest"; install -m 0644 /source/ca.crt "$dest/ca.crt"; install -m 0644 /source/tls.crt "$dest/tls.crt"; install -m 0600 /source/tls.key "$dest/tls.key"'
```

Set the gateway name in the OpenClaw process environment:

```bash
export OPENSHELL_GATEWAY=openshell
```

The installer copies only this client bundle into OpenClaw. It never exposes
the gateway's sandbox-JWT signing key.

### Add an OpenShell policy

Create a policy YAML readable by OpenClaw. The installer's managed baseline is
`OPEN_SHELL_POLICY_YAML` in `src/server/deployers/sandbox.ts`; it grants the
sandbox filesystem roots and restricts outbound network access to selected
executables and endpoints.

The installer writes it to:

```text
/home/node/.openclaw/openshell/policy.yaml
```

Treat the policy as part of the sandbox security boundary. Add endpoints and
canonical executable paths deliberately instead of disabling policy
enforcement to make a tool work.

### Configure OpenClaw

Merge this fragment into `openclaw.json` for a containerized OpenClaw Gateway:

```json5
{
  agents: {
    defaults: {
      sandbox: {
        mode: "all",
        backend: "openshell",
        scope: "session",
        workspaceAccess: "rw",
      },
    },
  },
  plugins: {
    allow: ["openshell"],
    entries: {
      openshell: {
        enabled: true,
        config: {
          command: "/home/node/.openclaw/bin/openshell",
          gatewayEndpoint: "https://host.containers.internal:18080",
          from: "quay.io/sallyom/openclaw-openshell:latest",
          mode: "remote",
          policy: "/home/node/.openclaw/openshell/policy.yaml",
          timeoutSeconds: 180,
        },
      },
    },
  },
}
```

The installer form accepts `https://localhost:18080` and rewrites it to
`host.containers.internal` because OpenClaw itself runs in a container. If the
OpenClaw Gateway runs directly on the Mac, use `command: "openshell"` and
`gatewayEndpoint: "https://localhost:18080"`. The gateway bootstrap includes
`localhost` in the server certificate for this case.

Restart the OpenClaw Gateway after installing or updating the plugin. Starting
OpenClaw registers the backend, but does not create a sandbox container.

## Know when Podman creates a sandbox

OpenShell sandbox creation is lazy:

1. OpenClaw starts a sandboxed agent turn and resolves the configured sandbox
   scope. This prepares the backend handle but does not call Podman.
2. The first sandbox-backed operation needs the remote runtime. This is
   commonly `exec`, `read`, `write`, `edit`, or `apply_patch`; staging inbound
   media can also require it.
3. The plugin runs `openshell sandbox get <name>`.
4. If the sandbox does not exist, the plugin runs `openshell sandbox create`
   with the configured source, policy, providers, and generated name.
5. The OpenShell gateway asks the Podman driver to create the
   `openshell-sandbox-<name>` container, its workspace volume, and its
   per-sandbox gateway credential.
6. The plugin requests `sandbox ssh-config`. OpenClaw then reaches the sandbox
   over SSH through `openshell ssh-proxy`.

An ordinary chat response that does not use a sandbox-backed operation does
not need to create the container. A single turn with several tool calls reuses
the same runtime.

The `mode` setting controls which sessions are sandboxed:

- `all`: sandbox the main session and other agent sessions
- `non-main`: keep the main session on the OpenClaw host and sandbox non-main
  sessions
- `off`: do not use a sandbox backend

The `scope` setting controls runtime reuse:

| Scope | Runtime lifetime and sharing |
| --- | --- |
| `session` | One OpenShell sandbox per OpenClaw session. |
| `agent` | One sandbox shared by all sandboxed sessions for an agent. |
| `shared` | One sandbox shared by all sandboxed agents and sessions. |

The generated OpenShell name is stable for the scope key, so restarting the
OpenClaw container finds and reuses the existing sandbox instead of creating a
new one.

## Understand workspace persistence

The installer selects OpenShell `remote` mode. On first creation, OpenClaw
uploads the local workspace into `/sandbox`. The OpenShell workspace volume is
then canonical: later file and command tools operate there, and changes are not
copied back to the OpenClaw host volume.

In `mirror` mode, OpenClaw uploads before each exec and downloads afterward.
Use it when the OpenClaw-side workspace must remain canonical, accepting the
extra synchronization cost.

Stopping the OpenClaw container does not delete an OpenShell sandbox or its
workspace volume. Stopping the OpenShell gateway also does not make the
sandbox disposable; it only makes lifecycle and proxy operations unavailable
until the gateway returns.

## Observe and manage sandboxes

Before the first sandbox-backed tool call, the gateway may be the only
OpenShell container:

```bash
podman ps --filter name=openshell
```

After the first tool call, inspect the new runtime:

```bash
podman ps --filter name=openshell-sandbox
openclaw sandbox list
openclaw sandbox explain
podman logs <openshell-sandbox-container>
```

Use OpenClaw or OpenShell lifecycle commands instead of deleting the Podman
container or volume directly. Direct Podman removal can leave the OpenShell
gateway database and OpenClaw sandbox registry out of sync.

To delete registered OpenShell sandboxes and recreate them lazily on the next
tool operation:

```bash
openclaw sandbox recreate --all
```

OpenClaw also prunes registered runtimes by default after 24 idle hours or 7
days of age. Pruning is opportunistic: a later sandboxed turn runs the check,
at most once every five minutes. It is not a background Podman timer.

Deleting an OpenShell sandbox removes its managed container, per-sandbox
workspace volume, and per-sandbox gateway credential. It does not remove the
shared `openshell-state` or `openshell-client-tls` volumes.

## Troubleshoot the local path

### The plugin is not registered

If OpenClaw reports `Sandbox backend "openshell" is not registered`, confirm
that the plugin is installed, enabled, allowed, and that the Gateway was
restarted after installation.

### No sandbox container appears

Confirm all of the following:

- the effective sandbox mode applies to the current session
- the agent actually invoked a sandbox-backed tool
- `openclaw sandbox explain` selects backend `openshell`
- the OpenClaw runtime can execute the configured OpenShell CLI
- the CLI can reach the mTLS gateway endpoint
- `podman logs openshell-gateway` shows a connected Podman driver

### The gateway logs SSRF or binary-path warnings

`host.openshell.internal maps to a non-link-local IP` is expected with the
macOS Podman bridge. OpenShell disables the special link-local exemption and
keeps normal SSRF checks in force.

Binary symlink-resolution warnings usually mean the policy lists an alternate
path that is absent from the selected image. Confirm the actual canonical path
inside the sandbox image. A mismatch can deny the intended network call; it
does not grant broader access.

## Clean up the local gateway

Delete sandboxes through OpenClaw before removing the shared gateway when
possible. Then stop and remove the gateway:

```bash
podman rm -f openshell-gateway
```

Keep `openshell-state` if you plan to restart the same gateway. Removing it
deletes the database, TLS identity, and sandbox-JWT signing keys. The derived
`openshell-client-tls` volume is needed by every manually managed OpenClaw
client using this gateway.

## Related docs

- [Sandbox backend reference](SANDBOX.md)
- [Local deployer guide](deploy-local.md)
- [Upstream OpenClaw OpenShell guide](https://docs.openclaw.ai/gateway/openshell)
