# OpenClaw Installer

Deploy [OpenClaw](https://github.com/openclaw) from your browser — to OpenShift, Kubernetes, or local podman.

### No git clone required

On Linux, you can run the installer directly from its container image — no clone, no Node.js, no build step. Just podman (or docker) and a single script:

```bash
curl -fsSLo run.sh https://raw.githubusercontent.com/sallyom/claw-installer/main/run.sh
chmod +x run.sh
./run.sh
```

The script pulls the installer image, starts it as a container (with your podman or docker socket mounted), and opens the UI at `http://localhost:3000`. On macOS with podman, it extracts the app from the image and runs it natively with Node.js.

### From source

```bash
git clone https://github.com/sallyom/claw-installer.git
cd claw-installer
npm install && npm run build && npm run dev
```

Open `http://localhost:3000`, pick your deploy target, fill in the form, and click Deploy.

## Native Layout

`claw-installer` now uses the same home directory layout as a native OpenClaw install:

- `~/.openclaw/workspace-*` for agent workspaces
- `~/.openclaw/skills` for shared skills
- `~/.openclaw/installer` for installer-only metadata

That keeps local, Kubernetes, and native OpenClaw agent files in one place without introducing a separate installer-specific home.

## Deploy Targets

| Target | Guide | What it does |
|--------|-------|-------------|
| **OpenShift / Kubernetes** | [deploy-openshift.md](docs/deploy-openshift.md) | Creates namespace, PVC, ConfigMaps, Secrets, Service, Deployment via K8s API. On OpenShift, adds OAuth proxy sidecar for SSO — no cluster-admin required. |
| **Local (podman / docker)** | [deploy-local.md](docs/deploy-local.md) | Pulls the image, provisions your agent, starts a container on localhost. Works on macOS and Linux. |

## Why not Helm or kustomize?

OpenClaw is a single-container deployment (plus an oauth-proxy sidecar on OpenShift). The Kubernetes resources are straightforward — the real complexity is in the *content* the installer generates and manages:

- **Agent workspace files** — `AGENTS.md`, `SOUL.md`, `IDENTITY.md`, and other markdown files that define the agent's personality, security rules, and operational behavior. These get packed into a ConfigMap and copied to the PVC by the init container.
- **`openclaw.json` configuration** — generated from the deploy form with gateway settings, model selection, agent definitions, and (on OpenShift) the Route URL for `allowedOrigins`.
- **Subagents, jobs, and skills** (coming soon) — markdown files and JSON that need to be woven into the OpenClaw config, not separate Kubernetes resources. A Helm values file can't express "add this SKILL.md to the agent workspace and register it in the gateway config."

The installer builds every Kubernetes resource as a TypeScript object and applies it via the `@kubernetes/client-node` SDK. The deploy form, the resource definitions, and the agent provisioning logic all live in the same codebase. Adding a new skill or subagent means updating the config and workspace files together — something a template engine can't coordinate.

For the ~10 Kubernetes resources involved, this is simpler than maintaining a chart with `values.yaml`, templates, and a separate release lifecycle. The tradeoff is that you need the installer to deploy rather than `helm install`, but you get a UI, real-time logs, instance management, and agent customization in return.

See [`docs/examples/`](docs/examples/) for annotated YAMLs showing every resource the installer creates on OpenShift.

## Model Providers

| Provider | Default Model | What you need |
|----------|---------------|---------------|
| Anthropic | `claude-sonnet-4-6` | `ANTHROPIC_API_KEY` |
| OpenAI | `openai/gpt-5` | `OPENAI_API_KEY` |
| Vertex AI (Gemini) | `google-vertex/gemini-2.5-pro` | GCP service account JSON |
| Vertex AI (Claude) | `anthropic-vertex/claude-sonnet-4-6` | GCP service account JSON |
| Self-hosted (vLLM, etc.) | `openai/default` | `MODEL_ENDPOINT` URL |

For Vertex AI, upload your GCP service account JSON file (or provide an absolute path). The installer extracts the `project_id` automatically.

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
| **Kubernetes / OpenShift** | Edit files in `~/.openclaw/workspace-<id>/`, then click **Re-deploy** from the Instances tab. This updates the ConfigMap from your local files and restarts the pod. A plain Stop/Start only scales replicas — it does *not* sync files from the host. |

The installer uses your local files when they exist, falling back to generated defaults for anything missing.

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
   │ K8s API / │      │ podman /    │
   │ OpenShift │      │ docker sock │
   └───────────┘      └─────────────┘
```

## Project Structure

```
claw-installer/
├── run.sh                        # Launcher script
├── Dockerfile                    # Multi-stage build
├── docs/
│   ├── deploy-local.md           # Local deployment guide
│   ├── deploy-openshift.md       # OpenShift/K8s deployment guide
│   ├── blog-installing-openclaw-on-openshift.md
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
│   │   │   ├── kubernetes.ts     # K8s/OpenShift deployer
│   │   │   └── openshift/        # Static YAMLs for OAuth proxy
│   │   └── services/
│   │       ├── container.ts      # Runtime detection, container discovery
│   │       └── k8s.ts            # Kubeconfig, OpenShift detection
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
| `/api/instances/:name/command` | GET | Get the run command |
| `/api/instances/:name/data` | DELETE | Delete the data volume |
| `/ws` | WebSocket | Subscribe to deploy logs |

## Roadmap

- [x] Local deployer (podman + docker, macOS + Linux)
- [x] Kubernetes / OpenShift deployer
- [x] OpenShift OAuth proxy (no cluster-admin)
- [x] Vertex AI support (Google and Anthropic via GCP SA JSON)
- [x] Instance discovery and lifecycle management
- [x] Agent provisioning with full workspace files
- [x] Custom agent/skill provisioning from host directory
- [x] Deploy config persistence for re-deploy
- [ ] Subagent provisioning
- [ ] Cron job provisioning from JOB.md files
- [ ] Skill import from git repos
- [ ] SSH deployer (remote host)
