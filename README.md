# OpenClaw Installer

Deploy [OpenClaw](https://github.com/openclaw) from your browser — to local containers or Kubernetes.

### From source

```bash
git clone https://github.com/sallyom/openclaw-installer.git
cd openclaw-installer
npm install && npm run build && npm run dev
```

Open `http://localhost:3000`, pick your deploy target, fill in the form, and click Deploy.

## Native Layout

`openclaw-installer` uses the same home directory layout as a native OpenClaw install:

- `~/.openclaw/workspace-*` for agent workspaces
- `~/.openclaw/skills` for shared skills
- `~/.openclaw/installer` for installer-only metadata

That keeps local, Kubernetes, and native OpenClaw agent files in one place without introducing a separate installer-specific home.

## Deploy Targets

| Target | Guide | What it does |
|--------|-------|-------------|
| **Kubernetes** | [deploy-kubernetes.md](docs/deploy-kubernetes.md) | Creates namespace, PVC, ConfigMaps, Secrets, Service, and Deployment via the Kubernetes API. The Instances tab can start a managed port-forward and open the UI with the gateway token. |
| **OpenShift** | [deploy-openshift.md](provider-plugins/openshift/docs/deploy-openshift.md) | Extends Kubernetes with OAuth proxy sidecar, Route, and ServiceAccount. Auto-detected on OpenShift clusters. |
| **Local (podman / docker)** | [deploy-local.md](docs/deploy-local.md) | Pulls the image, provisions your agent, starts a container on localhost. Works on macOS and Linux. |

## Provider Plugins

Provider plugins live in `provider-plugins/` and are loaded automatically at startup -- no extra install steps needed. They extend the installer with platform-specific deployers.

| Plugin | Directory | Description |
|--------|-----------|-------------|
| **OpenShift** | [`provider-plugins/openshift/`](provider-plugins/openshift/) | OAuth proxy, Routes, and ServiceAccounts for OpenShift clusters. Auto-detected when logged into an OpenShift cluster (`oc login`). |

To deploy on OpenShift, just log in with `oc login` before starting the installer. The OpenShift option will appear automatically in the deploy form.

Third-party plugins can also be installed as npm packages named `openclaw-installer-*`. See [ADR 0001](adr/0001-deployer-plugin-system.md) for the plugin system design.

## Why not Helm or kustomize?

OpenClaw is a single-container deployment. The Kubernetes resources are straightforward — the real complexity is in the *content* the installer generates and manages:

- **Agent workspace files** — `AGENTS.md`, `SOUL.md`, `IDENTITY.md`, and other markdown files that define the agent's personality, security rules, and operational behavior. These get packed into a ConfigMap and copied to the PVC by the init container.
- **`openclaw.json` configuration** — generated from the deploy form with gateway settings, model selection, and agent definitions.
- **Subagents, jobs, and skills** (coming soon) — markdown files and JSON that need to be woven into the OpenClaw config, not separate Kubernetes resources. A Helm values file can't express "add this SKILL.md to the agent workspace and register it in the gateway config."

The installer builds every Kubernetes resource as a TypeScript object and applies it via the `@kubernetes/client-node` SDK. The deploy form, the resource definitions, and the agent provisioning logic all live in the same codebase. Adding a new skill or subagent means updating the config and workspace files together — something a template engine can't coordinate.

For the ~10 Kubernetes resources involved, this is simpler than maintaining a chart with `values.yaml`, templates, and a separate release lifecycle. The tradeoff is that you need the installer to deploy rather than `helm install`, but you get a UI, real-time logs, instance management, and agent customization in return.

See [`docs/examples/`](docs/examples/) for annotated YAMLs showing the generated Kubernetes resources.

## Model Providers

| Provider | Default Model | What you need |
|----------|---------------|---------------|
| Anthropic | `claude-sonnet-4-6` | `ANTHROPIC_API_KEY` |
| OpenAI | `openai/gpt-5` | `OPENAI_API_KEY` |
| Vertex AI (Gemini) | `google-vertex/gemini-2.5-pro` | GCP service account JSON |
| Self-hosted (vLLM, etc.) | `openai/default` | `MODEL_ENDPOINT` URL |

For Vertex AI, upload your GCP service account JSON file (or provide an absolute path). The installer extracts the `project_id` automatically.

## SSH Sandbox

The installer supports OpenClaw's `ssh` sandbox backend for local and Kubernetes deployments.

For the installer-specific setup, credential handling, and troubleshooting, see [SANDBOX.md](SANDBOX.md).

For upstream sandbox concepts and backend behavior, see the [OpenClaw sandboxing docs](https://github.com/openclaw/openclaw/blob/main/docs/gateway/sandboxing.md).

## Customizing Your Agent

After the first deploy, agent files are saved to `~/.openclaw/workspace-<id>/` on the host:

```
AGENTS.md       # Agent identity, instructions, security rules
agent.json      # Metadata (name, description, capabilities)
SOUL.md         # Personality and communication style
IDENTITY.md     # Who the agent is
TOOLS.md        # Environment and tool usage notes
USER.md         # Instance owner info
HEARTBEAT.md    # Health check behavior
MEMORY.md       # Learned preferences (populated over time)
```

Edit these files locally, then push the changes to your running instance:

| Deploy target | How to update agent files |
|---------------|--------------------------|
| **Local (podman/docker)** | Edit files in `~/.openclaw/workspace-<id>/`, then **Stop** and **Start** the container from the Instances tab. The installer copies your local files into the volume on every Start. |
| **Kubernetes** | Edit files in `~/.openclaw/workspace-<id>/`, then click **Re-deploy** from the Instances tab. This updates the ConfigMap from your local files and restarts the pod. A plain Stop/Start only scales replicas — it does *not* sync files from the host. |

The installer uses your local files when they exist, falling back to generated defaults for anything missing.

Current sync model is intentionally one-way by default: host files in `~/.openclaw` are the source of truth, and changes are pushed into the running instance on Local Start or Kubernetes Re-deploy. If an agent or user edits files inside the running OpenClaw UI, those changes affect the live instance immediately but do not sync back to local files yet, so they may not survive a restart or re-deploy.

Planned next steps:

- explicit `Pull running changes to local` sync for local and Kubernetes instances
- optional GitOps-backed sync, so `~/.openclaw` can be treated as a tracked working tree and re-deploys can follow git state

## Demo Bundles

`Agent Source Directory` can now point at a bundled multi-agent demo tree.

Try:

- `demos/openclaw-builder-research-ops`

This demo includes:

- `workspace-main/` for the orchestrator agent
- `workspace-builder/`
- `workspace-research/`
- `workspace-ops/`
- `openclaw-agents.json` to register extra named agents and simple per-agent sandbox tool policies

`workspace-main/` is applied to the computed main agent workspace for the current deploy.
Other `workspace-*` directories are copied through as named agent workspaces and can be
registered as additional agents through `openclaw-agents.json`.

Environment templates are included too:

- `.env.example` for a generic installer setup
- `demos/openclaw-builder-research-ops/.env.example` for the bundled sandbox demo

## Architecture

```
┌─────────────────────────────────────────┐
│           Browser (React + Vite)        │
│  ┌────────────┬──────────┬───────────┐  │
│  │ DeployForm │ LogStream│ Instances │  │
│  └─────┬──────┴────┬─────┴─────┬─────┘  │
│        │ REST      │ WebSocket │ REST   │
└────────┼───────────┼───────────┼────────┘
         ▼           ▼           ▼
┌─────────────────────────────────────────┐
│        Express + WebSocket Server       │
│  ┌──────────────┐  ┌────────────────┐   │
│  │  Deployers   │  │  Services      │   │
│  │   local      │  │  container     │   │
│  │   kubernetes │  │  discovery     │   │
│  └──────────────┘  └────────────────┘   │
└─────────────────────────────────────────┘
         │                   │
   ┌─────┴─────┐      ┌──────┴──────┐
   │ K8s API   │      │ podman /    │
   │           │      │ docker sock │
   └───────────┘      └─────────────┘
```

## Project Structure

```
openclaw-installer/
├── run.sh                        # Launcher script
├── Dockerfile                    # Multi-stage build
├── provider-plugins/
│   └── openshift/                # OpenShift deployer plugin
│       ├── src/                  # Plugin source (auto-loaded)
│       ├── templates/            # OAuth proxy YAML templates
│       └── docs/                 # OpenShift deployment guide
├── docs/
│   ├── deploy-local.md           # Local deployment guide
│   ├── deploy-kubernetes.md      # Kubernetes deployment guide
│   └── examples/                 # Annotated YAMLs for every K8s resource
├── src/
│   ├── server/
│   │   ├── index.ts              # Express + WS server
│   │   ├── ws.ts                 # WebSocket log streaming
│   │   ├── routes/
│   │   │   ├── deploy.ts         # POST /api/deploy
│   │   │   ├── status.ts         # Instance discovery and lifecycle
│   │   │   └── agents.ts         # Agent browsing
│   │   ├── deployers/
│   │   │   ├── types.ts          # Deployer interface
│   │   │   ├── local.ts          # Podman/docker deployer
│   │   │   ├── kubernetes.ts     # Kubernetes deployer
│   │   └── services/
│   │       ├── container.ts      # Runtime detection, container discovery
│   │       └── k8s.ts            # Kubeconfig helpers
│   └── client/
│       ├── App.tsx               # Tabs: Deploy | Instances | Agents
│       └── components/
│           ├── DeployForm.tsx     # Config form + credential upload
│           ├── LogStream.tsx      # Real-time deploy output
│           ├── InstanceList.tsx   # Manage running instances
│           └── AgentBrowser.tsx   # Browse agents
└── package.json
```

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

## Roadmap

- [x] Local deployer (podman + docker, macOS + Linux)
- [x] Kubernetes deployer
- [x] Vertex AI support (Google Gemini via GCP SA JSON)
- [x] Instance discovery and lifecycle management
- [x] Agent provisioning with full workspace files
- [x] Custom agent/skill provisioning from host directory
- [x] Deploy config persistence for re-deploy
- [x] One-way host-to-instance workspace sync on Local Start / K8s Re-deploy
- [ ] Subagent provisioning
- [ ] Cron job provisioning from JOB.md files
- [ ] Pull running changes back to local files
- [ ] GitOps-backed workspace sync
- [ ] Skill import from git repos
- [ ] SSH deployer (remote host)
