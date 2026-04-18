# Installing OpenClaw on Red Hat AI (OpenShift)

OpenClaw is an open-source AI agent gateway - a single Node.js process that coordinates agents, tools, and sessions through HTTP and WebSocket on a single port. It connects to model providers (Anthropic, OpenAI, Google, etc.) over HTTPS and serves a web UI for interacting with your agents.

The **openclaw-installer** is a web-based tool that deploys OpenClaw to OpenShift (or any Kubernetes cluster, or local podman) through a browser form. Fill in your namespace, pick a model provider, provide its credential source, and click Deploy. The installer handles all the Kubernetes resources, OpenShift OAuth integration, and agent workspace setup.

This post walks through deploying OpenClaw on OpenShift using the openclaw-installer, what gets created under the hood, and how the security model works.

## Why OpenShift?

OpenClaw runs on any Kubernetes cluster, but OpenShift adds security layers that matter when you're running AI agents that can call tools, execute code, and interact with external services.

### What OpenShift gives you for free

**OAuth integration** - The deployment includes an [oauth-proxy](https://github.com/openshift/oauth-proxy) sidecar that authenticates users against OpenShift's built-in OAuth server. No external identity provider to configure. If you can `oc login`, you can access your agent. No cluster-admin is required - the installer uses SA-based OAuth with the `user:info` scope.

**Security Context Constraints (SCCs)** - OpenShift's default `restricted-v2` SCC enforces a strict posture on every container:

- Runs as a random, non-root UID assigned by the namespace
- Read-only root filesystem
- All Linux capabilities dropped
- No privilege escalation

Every container in the pod - gateway, oauth-proxy, and init-config - runs unprivileged under `restricted-v2` with no custom SCC required. The init container sets GID 0 permissions on the PVC (`chgrp -R 0` + `chmod -R g=u`), so all containers can access shared state regardless of their assigned UID.

**Routes with TLS** - OpenShift Routes provide automatic TLS termination via the cluster's wildcard certificate. The gateway listens on loopback only (`127.0.0.1:18789`) - all external traffic goes through the oauth-proxy, which handles authentication before forwarding to the gateway. OpenShift's HAProxy-based Ingress Controller handles WebSocket natively. The Route carries a 30-minute timeout annotation to accommodate long-running agent sessions.

### The pod architecture

```
                     +-----------------------+
                     |   OpenShift Route     |
                     |   (TLS termination)   |
                     +-----------+-----------+
                                 |
                                 v
              +------------------+------------------+
              |              Pod                     |
              |                                      |
              |  +---------------+  +-------------+  |
              |  | oauth-proxy   |  | gateway     |  |
              |  | port 8443     +->| port 18789  |  |
              |  | (OpenShift    |  | (loopback)  |  |
              |  |  OAuth SSO)   |  |             |  |
              |  +-------+-------+  +------+------+  |
              |          |                 |         |
              |  +-------+-------+ +------+------+   |
              |  | oauth-config  | | openclaw-   |   |
              |  | secret        | | home-pvc    |   |
              |  +---------------+ +-------------+   |
              |                                      |
              |  +---------------+                   |
              |  | init-config   | (runs first,      |
              |  | (init cont.)  |  copies config    |
              |  +---------------+  to PVC)          |
              +--------------------------------------+

                     +------------------+
                     | OpenShift OAuth  |
                     | (cluster SSO)    |
                     +------------------+
```

A few things worth noting:

- **Single port.** HTTP health checks and WebSocket upgrades share port 18789. No second port needed for health probes.
- **Filesystem-backed state.** All persistent state - session transcripts (JSONL), agent memory (SQLite with vector search), and configuration (JSON5) - lives on a single PVC. No external database. Backup is a volume snapshot.
- **Single replica.** OpenClaw's session transcripts and memory index don't support concurrent writers, so the deployment uses Recreate strategy. This avoids a deadlock with RollingUpdate and ReadWriteOnce PVCs: the new pod can't mount the volume until the old pod releases it.

## Prerequisites

- An OpenShift cluster where you can create a namespace (no cluster-admin required)
- `oc` CLI authenticated (`oc login`) on the machine running the installer
- A credential source for at least one model provider: API key, GCP service account JSON, or Codex CLI OAuth

**A note on storage:** OpenClaw uses SQLite for its agent memory index, which requires POSIX file locking via `fcntl()`. Block storage classes (gp3-csi on AWS, managed-csi on Azure, thin-csi on vSphere) work correctly. Avoid NFS-backed storage classes — they don't reliably support the locking SQLite needs.

## Deploy with openclaw-installer

### 1. Start the installer

```bash
git clone https://github.com/sallyom/openclaw-installer.git
cd openclaw-installer
npm install && npm run dev
```

Open `http://localhost:3000` in your browser.

### 2. Fill in the form

The installer UI presents a deploy form with these fields:

| Field | Example | Notes |
|-------|---------|-------|
| **Agent name** | `myagent` | ID for your default agent |
| **Display name** | `My Agent` | Human-friendly name shown in the UI |
| **Owner prefix** | *(optional)* | Defaults to your OS username. Combined with agent name for the namespace: `alice-myagent-openclaw` |
| **Image** | `ghcr.io/openclaw/openclaw:latest` | Container image to deploy |
| **Provider credentials** | *(provider-specific)* | API key, Vertex credentials, or Codex CLI OAuth |
| **Google Cloud Credentials (JSON)** | *(file upload or path)* | For Vertex AI - project ID is auto-extracted |

For Vertex AI with Anthropic models, upload your GCP service account JSON file. The installer extracts the `project_id` automatically and sets the right environment variables.

For OpenAI Codex, run Codex CLI login on the machine running the installer, select **OpenAI Codex**, and leave the Codex auth path blank to use `~/.codex/auth.json`. The installer imports that OAuth profile into OpenClaw as `openai-codex:default`.

### 3. Click Deploy

The installer detects OpenShift automatically and deploys with OAuth proxy integration. You'll see a real-time log in the browser as each resource is created. The deploy takes about 2 minutes, mostly waiting for the image pull.

When complete, the installer prints the Route URL and your gateway token.

## What gets created

The installer creates these Kubernetes resources in a dedicated namespace. Example YAMLs for each are in [`docs/examples/`](examples/).

### Resource overview

| Resource | Name | Purpose |
|----------|------|---------|
| [**Namespace**](examples/namespace.yaml) | `alice-myagent-openclaw` | Isolated namespace, labeled for installer discovery |
| [**ServiceAccount**](examples/serviceaccount.yaml) | `openclaw-oauth-proxy` | SA for the oauth-proxy with OAuth redirect annotation |
| [**Secret**](examples/oauth-config-secret.yaml) | `openclaw-oauth-config` | OAuth client-secret (SA token) and cookie secret |
| [**Service**](examples/service.yaml) | `openclaw` | ClusterIP with gateway (18789) and oauth-ui (8443) ports |
| [**Route**](examples/route.yaml) | `openclaw` | TLS-terminated route targeting the oauth-proxy |
| [**PVC**](examples/pvc.yaml) | `openclaw-home-pvc` | 10Gi volume for all persistent state |
| [**ConfigMap**](examples/configmap-openclaw.yaml) | `openclaw-config` | Main `openclaw.json` configuration |
| [**ConfigMap**](examples/configmap-agent.yaml) | `openclaw-agent` | Agent workspace files (AGENTS.md, SOUL.md, etc.) |
| [**Secret**](examples/secrets.yaml) | `openclaw-secrets` | Gateway token and provider credentials |
| [**Secret**](examples/secrets.yaml) | `gcp-sa` | GCP service account JSON (Vertex AI only) |
| [**Secret**](examples/secrets.yaml) | `openclaw-proxy-tls` | Auto-generated by OpenShift serving-cert controller |
| [**Deployment**](examples/deployment.yaml) | `openclaw` | Pod spec with init, oauth-proxy sidecar, and gateway |

### How the OAuth proxy works (no cluster-admin needed)

OpenShift supports SA-based OAuth: a ServiceAccount can act as an OAuth client without creating a cluster-scoped `OAuthClient` resource. Here's how the installer sets it up:

1. **ServiceAccount** with an `oauth-redirectreference` annotation pointing to the Route
2. **Client ID** is `system:serviceaccount:<namespace>:<sa-name>`
3. **Client secret** is a ServiceAccount token created via the [TokenRequest API](https://kubernetes.io/docs/reference/kubernetes-api/authentication-resources/token-request-v1/)
4. **Scope** is `user:info` — any authenticated OpenShift user can access the instance

This means a regular OpenShift user (no cluster-admin) can deploy a fully OAuth-protected OpenClaw instance.

To restrict access to specific users, you can switch to `--openshift-sar` with a namespace-scoped check. This requires a `ClusterRoleBinding` for `system:auth-delegator` (which does need cluster-admin to create). See the comments in [`oauth-proxy-container.yaml`](../src/server/deployers/openshift/oauth-proxy-container.yaml) for details.

### Deployment details

The [Deployment](examples/deployment.yaml) includes three containers:

**init-config** - A UBI9-minimal init container that copies the generated `openclaw.json` from the ConfigMap to the PVC, creates workspace directories, and sets GID 0 permissions for OpenShift's random UID assignment.

**oauth-proxy** - The [OpenShift OAuth Proxy](https://github.com/openshift/oauth-proxy) sidecar. Listens on port 8443, authenticates against OpenShift OAuth, and forwards authenticated requests to the gateway on localhost:18789. Uses the serving-cert auto-generated by OpenShift for the TLS secret.

**gateway** - The OpenClaw gateway. Binds to loopback (since the oauth-proxy fronts it), reads config from the PVC, and connects to model providers over HTTPS. API-key style provider credentials are injected from the `openclaw-secrets` Secret with `optional: true` so only the keys you provide are required. OpenAI Codex OAuth is imported from the same Secret into each managed agent's `auth-profiles.json`.

## Access your instance

After deployment, open the Route URL printed in the installer logs:

```
https://openclaw-alice-myagent-openclaw.apps.your-cluster.example.com
```

You'll be redirected to the OpenShift login page. After authenticating, the Control UI asks for your **Gateway Token** — this was printed in the deploy log and saved to `~/.openclaw/installer/k8s/<namespace>/gateway-token` on the machine running the installer.

## Model providers

The installer supports multiple model providers. Select your provider in the deploy form.

| Provider | Model example | What you need |
|----------|---------------|---------------|
| Anthropic | `anthropic/claude-sonnet-4-6` | API key |
| OpenAI | `openai/gpt-5.4` | API key |
| OpenAI Codex | `openai-codex/gpt-5.4` | Codex CLI OAuth at `~/.codex/auth.json` |
| Google Vertex AI | `google-vertex/gemini-2.5-pro` | GCP service account JSON |
| Claude via Vertex AI | `anthropic-vertex/claude-sonnet-4-6` | GCP service account JSON |
| Custom endpoint (vLLM, etc.) | Any OpenAI-compatible model | Endpoint URL |

For Vertex AI providers, upload or specify the path to your GCP service account JSON. The installer creates a Kubernetes Secret (`gcp-sa`) and mounts it into the gateway container at `/home/node/gcp/sa.json`.

For OpenAI Codex, the browser sends only the selected file path. The server reads the Codex CLI `auth.json`, stores the imported OpenClaw auth profile in the `openclaw-secrets` Secret, and the init container copies it into the OpenClaw PVC as `auth-profiles.json`.

The installer stores local agent content in the same `~/.openclaw` home used by native OpenClaw. Workspaces live in `~/.openclaw/workspace-*`, shared skills live in `~/.openclaw/skills`, and installer-only metadata lives in `~/.openclaw/installer`.

## Updating your agent

Agent workspace files are saved to `~/.openclaw/workspace-<agentId>/` on the host after the first deploy. To change your agent's personality, instructions, or behavior:

1. Edit the files locally — `AGENTS.md` (instructions and security rules), `SOUL.md` (personality), `IDENTITY.md` (who the agent is), etc.
2. Go to the **Instances** tab and click **Re-deploy**

Re-deploy reads your local files, updates the `openclaw-agent` ConfigMap, and restarts the pod. The init container copies the updated files from the ConfigMap into the PVC on startup.

**Stop/Start vs Re-deploy:** Stop and Start only scale replicas (0 and 1). They do *not* sync agent files from the host. Use Re-deploy when you've changed agent files locally.

## Re-deploying the full configuration

To change deploy-level settings - new image, different model provider, updated credentials - fill in the deploy form and deploy to the same namespace. The installer uses create-or-replace logic on every resource, and the Deployment's `openclaw.io/restart-at` annotation forces a pod rollout.

The deploy config (with secrets redacted) is saved to `~/.openclaw/installer/k8s/<namespace>/deploy-config.json`. The gateway token is saved alongside.

## Managing instances

The installer's **Instances** tab shows all OpenClaw namespaces on your cluster (discovered via the `app.kubernetes.io/managed-by=openclaw-installer` label). For each instance you can:

- **View status** - pod phase, container state, ready/not-ready, restart count
- **Re-deploy** - updates agent files from host to ConfigMap and restarts the pod
- **Stop** - scales the deployment to 0 (PVC preserved)
- **Start** - scales back to 1
- **Delete** - tears down all resources and deletes the namespace

## Teardown

From the Instances tab, click Delete on the instance. The installer explicitly deletes each resource before removing the namespace to avoid stuck Terminating states. Resources cleaned up:

- Deployment, Service, Route
- All Secrets (openclaw-secrets, gcp-sa, openclaw-oauth-config, openclaw-proxy-tls)
- ServiceAccount (openclaw-oauth-proxy)
- ConfigMaps (openclaw-config, openclaw-agent)
- PVC (openclaw-home-pvc)
- Namespace

## Next steps

| What | How |
|------|-----|
| Customize your agent | Edit files in `~/.openclaw/workspace-<id>/` and click Re-deploy |
| Use Vertex AI with Claude | Upload credentials JSON, select Anthropic as the Vertex provider |
| Run locally first | The installer also supports local podman deployment - select "Local" mode |
| View example YAMLs | See [`docs/examples/`](examples/) for annotated templates of every resource |

## Links

- **openclaw-installer**: [github.com/sallyom/openclaw-installer](https://github.com/sallyom/openclaw-installer)
- **OpenClaw**: [github.com/openclaw](https://github.com/openclaw)
- **OpenShift OAuth Proxy**: [github.com/openshift/oauth-proxy](https://github.com/openshift/oauth-proxy)
