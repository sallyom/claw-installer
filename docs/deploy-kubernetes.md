# Deploying OpenClaw on Kubernetes

This installer deploys OpenClaw to a standard Kubernetes cluster using the Kubernetes API. It creates a namespace, PVC, ConfigMaps, Secrets, Service, and Deployment, then opens the gateway locally through a managed `kubectl port-forward` from the Instances tab.

## Prerequisites

- a working Kubernetes cluster
- `kubectl` configured against that cluster
- permission to create a namespace and standard namespaced resources

## Quick Start

```bash
curl -fsSLo run.sh https://raw.githubusercontent.com/sallyom/openclaw-installer/main/run.sh
chmod +x run.sh
./run.sh
```

Or from source:

```bash
git clone https://github.com/sallyom/openclaw-installer.git
cd openclaw-installer
npm ci
npm run dev
```

Open `http://localhost:3000`, choose `Kubernetes`, fill in the deploy form, and click `Deploy`.

## Secret Handling

For Kubernetes deploys, the installer now uses the safer upstream-compatible secret path by default:

- secrets you enter in the form are written to the installer-managed `openclaw-secrets` Kubernetes Secret
- the pod receives them through `secretKeyRef`
- generated `openclaw.json` references them with env-backed OpenClaw SecretRefs instead of embedding raw secret values
- OpenAI Codex uses Codex CLI OAuth: the installer reads the selected Codex CLI `auth.json`, writes the imported OpenClaw auth profile store into `openclaw-secrets`, and the init container copies it into each managed agent directory as `auth-profiles.json`

You can enable HashiCorp Vault SecretRef wiring from the **External Secret Providers** section. Add the Vault OpenClaw runtime plugin in the **Plugins** section unless it is already installed in the OpenClaw home volume.

You can still provide optional `secrets.providers` JSON and explicit SecretRef overrides when you want other `file` or `exec`-based providers.

The browser never receives the raw Codex OAuth JSON. The installer stores the imported Codex OAuth profile in the Kubernetes Secret and saves only non-secret deploy metadata locally. Anyone with permission to read the `openclaw-secrets` Secret or the OpenClaw persistent volume can read runtime credentials, so keep normal cluster RBAC and Secret access controls in place.

## Access

After deploy, the simplest path is:

1. Open the `Instances` tab
2. Click `Open`

The installer will:

- start or reuse a managed `kubectl port-forward`
- choose a free local port automatically
- fetch the gateway token
- open the UI with the saved gateway token

Control UI device pairing remains enabled by default for the base Kubernetes deployer, so first browser connect may require approving the pending pairing request from the **Instances** tab with **Approve Pairing**.

Manual access is still available if you prefer:

```bash
kubectl port-forward svc/openclaw 18789:18789 -n <namespace>
```

Then visit `http://localhost:18789`.

When the Agent Source `mcp.json` contains `"mcpAppsEnabled": true`, the
generated config and Service also expose the isolated sandbox listener on
`18790`. The installer-managed **Open** action forwards both ports. For manual
access, forward both ports:

```bash
kubectl port-forward svc/openclaw 18789:18789 18790:18790 -n <namespace>
```

MCP Apps are globally enabled for the instance, not per server. Set the Agent
Source flag only when every enabled MCP server is trusted. MCP Apps cannot be
combined with A2A because both currently reserve port `18790`.

## Sandbox

For Kubernetes deployments, the installer supports both SSH and OpenShell sandbox backends.

SSH sandbox material is stored in the generated `openclaw-secrets` Secret and passed to the gateway container.

OpenShell sandboxing requires an existing OpenShell gateway endpoint, usually provisioned by a cluster admin. When enabled, the installer installs the OpenShell runtime plugin before gateway startup, writes a managed OpenShell policy file, and points OpenClaw at the provided gateway endpoint.

See [SANDBOX.md](SANDBOX.md) for the recommended form values, secret handling, and troubleshooting.

For upstream sandbox behavior, see the [OpenClaw sandboxing docs](https://github.com/openclaw/openclaw/blob/main/docs/gateway/sandboxing.md).

## Notes

- Kubernetes access in this repo is plain K8s only. Platform-specific ingress and auth proxy flows are intentionally out of scope here.
- Re-deploy updates ConfigMaps from your local agent files and restarts the pod.
- Manual `kubectl port-forward` still works, but the `Open` action is now the recommended path for local access.
