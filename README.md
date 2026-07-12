# OpenClaw Installer

Deploy [OpenClaw](https://github.com/openclaw) from your browser — to local containers or Kubernetes.

### From source

```bash
git clone https://github.com/sallyom/openclaw-installer.git
cd openclaw-installer
./run.sh
```

Open `http://localhost:3000`, pick your deploy target, fill in the form, and click Deploy.
After dependencies are installed, the usual local development flow is `npm run build && npm run dev`.

## OpenClaw Across an Org Reference

This repo includes a reference implementation for running many individual human-owned
OpenClaw instances on K8s/OpenShift with centrally managed OpenShell sandboxes. It
models one human user as one OpenShell runtime namespace plus one OpenClaw app
namespace:

```text
openshell-<user>  # platform-owned OpenShell gateway and sandbox pods
openclaw-<user>   # user/team-owned OpenClaw app namespace
```

Start with [`openshell/README.md`](openshell/README.md) for the design overview
and [`openshell/demo.md`](openshell/demo.md) for the runnable PoC flow. The
[`openshell/platform-users/`](openshell/platform-users/) directory contains the
per-user group and RBAC template for later IdP integration.

Privilege split:

- OpenShell install is cluster-admin/platform-operator work because it creates
  privileged sandbox namespaces and chart cluster-scoped RBAC.
- OpenClaw deploy is normal namespace-owner work after the cluster admin provides
  the OpenShell gateway endpoint and approved OpenClaw image.
- Users should clean up sessions/sandboxes through OpenClaw/OpenShell APIs, not
  by getting write access to `openshell-*` Kubernetes resources.

Agent-run workflows live under [`.agents/skills/`](.agents/skills/):

- `setup-openshell-cluster-prereqs` for one-time cluster-admin setup
- `deploy-user-openshell-openclaw` for one per-user OpenShell/OpenClaw PoC round

## Secret Handling

The installer now always uses upstream OpenClaw SecretRefs where it can.

- Local deploys inject secrets as container environment variables and reference them from `openclaw.json`
- Local Podman deploys can optionally derive those env vars from a guided Podman secret mapping list instead of hand-writing `--secret ...` flags
- Kubernetes and OpenShift deploys store secrets in the installer-managed `openclaw-secrets` Secret, inject them with `secretKeyRef`, and reference them from `openclaw.json`
- OpenAI Codex uses ChatGPT OAuth from the Codex CLI `auth.json` for agent turns; OpenAI platform features such as embeddings and images still use normal `OPENAI_API_KEY` auth
- You can configure HashiCorp Vault SecretRefs from the **External Secret Providers** section, or provide explicit SecretRef overrides and optional `secrets.providers` JSON for other `env`, `file`, or `exec`-based setups

This keeps raw third-party secrets out of generated `openclaw.json` while staying aligned with upstream OpenClaw secret handling.

For local Podman installs, the recommended path is: create Podman secrets, map them in the installer, and let OpenClaw resolve them through SecretRefs. See [docs/podman-secrets.md](docs/podman-secrets.md).
Codex OAuth is handled separately: leave the Codex auth path blank to use `~/.codex/auth.json`, or provide the path to a Codex CLI `auth.json`.
For Vault-backed SecretRefs, add the Vault OpenClaw runtime plugin in the **Plugins** section unless it is already installed in the OpenClaw home volume.
Vault SecretRef support depends on the OpenClaw secret-provider integration work in [openclaw/openclaw#82326](https://github.com/openclaw/openclaw/pull/82326). Until that PR is available in the latest `ghcr.io/openclaw/openclaw` image, use `quay.io/sallyom/openclaw:latest` for deployments that enable this feature.

### With the launcher script

```bash
./run.sh
```

Useful variants:

```bash
./run.sh --build
./run.sh --port 8080
OPENCLAW_INSTALLER_PORT=8080 ./run.sh
./run.sh --runtime docker
./run.sh --plugin @acme/openclaw-installer-aws
./run.sh --plugins @acme/openclaw-installer-aws,@acme/openclaw-installer-gke
```

`run.sh` uses `OPENCLAW_INSTALLER_PORT` and `OPENCLAW_INSTALLER_IMAGE`; it also accepts the older generic `PORT` fallback.

## Deploy Targets

| Target | Guide | What it does |
|--------|-------|-------------|
| **Kubernetes** | [deploy-kubernetes.md](docs/deploy-kubernetes.md) | Creates namespace, PVC, ConfigMaps, Secrets, Service, and Deployment via the Kubernetes API. The Instances tab can start a managed port-forward and open the UI with the gateway token. |
| **OpenShift** | [deploy-openshift.md](provider-plugins/openshift/docs/deploy-openshift.md) | Extends Kubernetes with OAuth proxy sidecar, Route, and ServiceAccount. |
| **Local (podman / docker)** | [deploy-local.md](docs/deploy-local.md) | Pulls the image, provisions your agent, starts a container on localhost. Works on macOS and Linux. |

## Installer Provider Plugins

These are installer provider plugins, not OpenClaw runtime plugins.

They extend the installer with additional deployment targets such as OpenShift or other platform-specific deployers. This is not the ClawHub runtime plugin path; deploy-time OpenClaw runtime plugins are configured separately in the form's **Plugins** section.

This repo supports two plugin paths:

1. **In-repo installer provider plugins** in `provider-plugins/`
2. **External plugins** installed as npm packages and listed in `~/.openclaw/installer/plugins.json`

In-repo installer provider plugins are loaded automatically at startup -- no extra install steps needed.

| Plugin | Directory | Description |
|--------|-----------|-------------|
| **OpenShift** | [`provider-plugins/openshift/`](provider-plugins/openshift/) | OAuth proxy, Routes, and ServiceAccounts for OpenShift clusters. Auto-detected when logged into an OpenShift cluster (`oc login`). |

To deploy on OpenShift, just log in with `oc login` before starting the installer. The OpenShift option will appear automatically in the deploy form.

### In-repo installer provider plugins

Anything under `provider-plugins/<name>/src/index.ts` is discovered by the server at startup. That is how the OpenShift plugin is activated in this repo.

This is the preferred model for provider-specific deployers that ship with the main repository.

### External installer provider plugins

Third-party installer provider plugins can also be installed as npm packages. The loader discovers:

- unscoped packages named `openclaw-installer-*`
- scoped packages whose package name starts with `openclaw-installer-`

Examples:

- `openclaw-installer-aws`
- `@acme/openclaw-installer-gke`

You can activate external installer provider plugins by writing `~/.openclaw/installer/plugins.json` directly, or by using `run.sh`:

```bash
./run.sh --plugin @acme/openclaw-installer-aws
./run.sh --plugins @acme/openclaw-installer-aws,@acme/openclaw-installer-gke
OPENCLAW_INSTALLER_PLUGINS=@acme/openclaw-installer-aws ./run.sh
```

`run.sh` writes the requested package list to `~/.openclaw/installer/plugins.json`, which is then consumed by the server plugin loader on startup.

These packages must implement the installer plugin `register()` contract and register deployers with the installer. Pointing this at a random OpenClaw plugin or ClawHub package will not work unless that package was specifically built as an installer provider plugin for `openclaw-installer`.

### Recommended provider strategy

For this repo, the clean split is:

- ship first-party installer provider plugins under `provider-plugins/`
- use external npm packages for optional or third-party installer provider plugins

That keeps the installer startup generic. Users start the same installer, and the available deployers come from the loaded plugins.

See [ADR 0001](adr/0001-deployer-plugin-system.md) for the plugin system design.

## OpenClaw Runtime Plugins

The deploy form also has a **Plugins** section for OpenClaw runtime plugins that should be installed before the gateway starts.

Use one plugin spec per line:

```text
@openclaw/openshell-sandbox
/app/extensions/custom-plugin
```

Supported specs follow the OpenClaw plugin installer: ClawHub specs, npm packages, git specs, and local paths that exist inside the OpenClaw container. For local Podman/Docker deploys, existing host paths are mounted automatically. When the OpenShell sandbox backend is enabled, the installer automatically adds `@openclaw/openshell-sandbox`; you do not need to list it yourself.

This is separate from installer provider plugins. Installer provider plugins add deploy targets to this app; OpenClaw runtime plugins add capabilities to the deployed OpenClaw instance.

## Model Providers

| Provider | Default Model | What you need |
|----------|---------------|---------------|
| Anthropic | `claude-sonnet-4-6` | `ANTHROPIC_API_KEY` |
| OpenAI | `openai/gpt-5.5` | `OPENAI_API_KEY` |
| OpenAI Codex | `openai/gpt-5.5` with Codex runtime | Codex CLI OAuth at `~/.codex/auth.json` |
| Google (Gemini) | `google/gemini-3.1-pro-preview` | `GEMINI_API_KEY` |
| OpenRouter | `openrouter/auto` | `OPENROUTER_API_KEY` |
| Google Vertex AI (Claude) | `anthropic-vertex/claude-sonnet-4-6` | GCP service account JSON or compatible ADC |
| Google Vertex AI (Gemini) | `google-vertex/gemini-2.5-pro` | GCP service account JSON |
| Self-hosted (vLLM, etc.) | custom model ID | `MODEL_ENDPOINT` URL |

For Vertex AI, upload your GCP service account JSON file (or provide an absolute path). The installer extracts the `project_id` automatically.
For OpenAI Codex, run Codex CLI login on the installer host first, then select **OpenAI Codex** in the installer. The installer imports inline OAuth token material into OpenClaw as `openai-codex:default` and configures canonical `openai/*` model refs with the Codex runtime. Select **OpenAI** as an additional provider when embeddings, image generation, or other OpenAI platform APIs need `OPENAI_API_KEY`.

## Sandbox

The installer supports OpenClaw sandboxing with:

- `ssh` for local, Kubernetes, and OpenShift deployments
- `openshell` for Kubernetes and OpenShift deployments when a platform admin has provisioned an OpenShell gateway

For the installer-specific setup, credential handling, and troubleshooting, see [SANDBOX.md](docs/SANDBOX.md).

For upstream sandbox concepts and backend behavior, see the [OpenClaw sandboxing docs](https://github.com/openclaw/openclaw/blob/main/docs/gateway/sandboxing.md).

## Demo Bundles

`Agent Source Directory` can now point at a bundled multi-agent demo tree.

Try:

- `demos/builder-research-ops-no-sandbox`
- `demos/builder-research-ops-ssh-sandbox`
- `demos/mcp-apps-example`
- `demos/software-qa-mcp`

This demo includes:

- `workspace-main/` for the orchestrator agent
- `workspace-builder/`
- `workspace-research/`
- `workspace-ops/`
- `openclaw-agents.json` to register extra named agents and simple per-agent sandbox tool policies

`workspace-main/` is applied to the computed main agent workspace for the current deploy.
Other `workspace-*` directories are copied through as named agent workspaces and can be
registered as additional agents through `openclaw-agents.json`.

The `software-qa-mcp` demo includes:

- `mcp.json` for the Context7 MCP server
- `exec-approvals.json` for baseline tool approval policy
- `workspace-main/` with a software Q&A agent persona

Environment templates are included too:

- `.env.example` for a generic installer setup
- `demos/builder-research-ops-ssh-sandbox/.env.example` for the bundled sandbox demo

## MCP Servers

The installer supports provisioning MCP servers through the Agent Source Directory. Place a `mcp.json` file in your agent source directory:

```json
{
  "mcpServers": {
    "my-server": {
      "url": "https://mcp.example.com/mcp"
    }
  }
}
```

The installer merges these into the generated `openclaw.json` at deploy time.
For trusted MCP App servers, add `"mcpAppsEnabled": true` alongside
`mcpServers`. The installer then configures and exposes the isolated MCP Apps
sandbox listener automatically; no separate form setting is required. Omit the
field for ordinary MCP servers, and set it only when every configured server is
trusted to supply interactive UI.

For tool approval policies, add an `exec-approvals.json`:

```json
{
  "version": 1,
  "defaults": {
    "security": "allowlist",
    "ask": "on-miss",
    "askFallback": "deny"
  }
}
```

This file is copied directly to `~/.openclaw/exec-approvals.json` in the deployed instance.

See `demos/software-qa-mcp` for a documentation-server example and
`demos/mcp-apps-example` for an interactive MCP Apps showcase.

## Agent Workspaces

After the first deploy, agent files live under `~/.openclaw/workspace-*` on the host. Edit those files locally, then:

- for Local deployments, stop and start the instance
- for Kubernetes/OpenShift deployments, use Re-deploy

The installer treats the host files as the source of truth and pushes them into the running instance.

For Local deployments, the default is an isolated container data volume for `/home/node/.openclaw`.
That keeps runtime state, config, pairing data, cron state, and plugin state out of the host
`~/.openclaw` tree while still syncing host workspaces into the instance on start/redeploy.

## API

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/health` | GET | Runtime detection, version, server defaults |
| `/api/deploy` | POST | Start a deployment (streams logs via WebSocket) |
| `/api/configs` | GET | List saved instance configs |
| `/api/instances` | GET | List all discovered instances |
| `/api/instances/:name/start` | POST | Start a stopped instance |
| `/api/instances/:name/stop` | POST | Stop and remove container (volume preserved) |
| `/api/instances/:name/redeploy` | POST | Update agent ConfigMap and restart pod (K8s only) |
| `/api/instances/:name/token` | GET | Get the gateway auth token |
| `/api/instances/:name/open` | POST | Start or reuse a managed K8s port-forward and return a localhost URL |
| `/api/instances/:name/command` | GET | Get the run command |
| `/api/instances/:name/data` | DELETE | Delete the data volume |
| `/ws` | WebSocket | Subscribe to deploy logs |
