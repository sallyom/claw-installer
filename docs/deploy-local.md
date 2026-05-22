# Deploying OpenClaw Locally (podman / docker)

The local deployer runs OpenClaw as a single container on your machine. It works on macOS and Linux with podman or docker.

## Quick Start

### No git clone required (Linux + podman)

On Linux with podman, you can run the installer directly from its container image:

```bash
curl -fsSLo run.sh https://raw.githubusercontent.com/sallyom/openclaw-installer/main/run.sh
chmod +x run.sh
./run.sh
```

The script pulls the installer image, starts it as a container with your rootless podman socket mounted, and opens the UI at `http://localhost:3000`. No clone, no Node.js, no build step.

With Docker, or with podman on macOS, the script extracts the app from the image and runs it natively with Node.js so the installer can use the host container CLI.

The installer uses the native OpenClaw home layout:

- `~/.openclaw/workspace-*` for agent workspaces
- `~/.openclaw/skills` for shared skills
- `~/.openclaw/installer` for installer state

### From source

```bash
git clone https://github.com/sallyom/openclaw-installer.git
cd openclaw-installer
npm ci && npm run build && npm run dev
```

Open `http://localhost:3000`, pick **"This Machine"**, fill in the form, and hit Deploy.

**Requirements:** podman or docker. On macOS with podman, Node.js is also needed (`brew install node`).

## Deploy Form

1. Pick **"This Machine"**
2. Fill in an **agent name** (e.g., `myagent`) and optionally an **owner prefix** (defaults to your OS username)
3. Pick a model provider and add the required credential source
   - API-key providers use their API key fields or inferred SecretRefs
   - OpenAI Codex uses Codex CLI OAuth from `~/.codex/auth.json` by default
   - Select OpenAI as an additional provider when OpenAI platform APIs need `OPENAI_API_KEY`
4. Optional: enable **SSH sandbox backend** if you want sandboxed tool execution on a remote host
5. For Vertex AI: upload your GCP service account JSON or provide an absolute path
6. Hit **Deploy OpenClaw**
7. Go to the **Instances** tab to manage your deployment — copy the gateway token, view the run command, open the UI, stop/start the container, or delete the data volume

The installer pulls the image, provisions your agent with a default identity and security guidelines, starts the container, and streams logs in real time. Your OpenClaw instance will be running at `http://localhost:18789`.

## First Browser Connect

For installer-managed local containerized installs, the Control UI opens with the saved gateway token.
Browser device pairing remains enabled by default, so the first browser connect may still require the normal pairing/approval flow.

If the browser prompts for pairing approval, go to the **Instances** tab and click **Approve Pairing** on the running instance.

If you prefer to do it manually from the container instead, with podman:

```bash
podman exec -it openclaw-<prefix>-<name> openclaw devices list
podman exec -it openclaw-<prefix>-<name> openclaw devices approve <requestId>
```

Or with docker:

```bash
docker exec -it openclaw-<prefix>-<name> openclaw devices list
docker exec -it openclaw-<prefix>-<name> openclaw devices approve <requestId>
```

If you already have the upstream OpenClaw CLI installed on the host, you can use that instead by either exporting `OPENCLAW_CONTAINER=openclaw-<prefix>-<name>` directly or sourcing the saved per-instance `.env`.

This is Control UI/browser device pairing, not channel DM pairing. You can find the local container name in the **Instances** tab.

## Secret Handling

For local deploys, the installer now follows the upstream OpenClaw secret model by default:

- secrets you enter in the form are injected into the container as environment variables
- generated `openclaw.json` uses env-backed SecretRefs instead of storing those raw values directly
- you can enable Vault SecretRef wiring from the form, or provide `secrets.providers` JSON and explicit SecretRef overrides for other `env`, `file`, or `exec` providers
- for Podman setups, you can also use the **Podman secret mappings** field to expand `podman secret create` entries into runtime `--secret` flags automatically
- OpenAI Codex is OAuth-based: the installer reads the Codex CLI `auth.json` on the installer host, imports inline OAuth token material into the OpenClaw auth profile `openai-codex:default`, and configures canonical `openai/*` model refs with the Codex runtime

This means the container still receives the credentials it needs, but `openclaw.json` does not embed the plaintext API keys or Telegram bot token.

For local Podman Codex OAuth imports, the installer stages the generated auth profile through a short-lived Podman secret, mounts it into a one-off import container, copies it into the OpenClaw data volume, and removes the transient Podman secret. Docker uses a short-lived `0600` temp file fallback for the same import step.

For credentials like GitHub PATs, API keys, and bot tokens, see [podman-secrets.md](podman-secrets.md)
for current options including Podman secrets, 1Password, and HashiCorp Vault.

Runtime plugins listed in the deploy form's **Plugins** section are installed before the gateway starts. Supported specs include ClawHub, npm, git, and local paths. For local Podman/Docker deploys, existing host paths are mounted automatically.

## Using The OpenClaw CLI

Installer-managed local instances save `OPENCLAW_CONTAINER` in their instance `.env`, so the upstream OpenClaw CLI can target the running local container directly.

If the host does not have the upstream OpenClaw CLI installed, use `podman exec` or `docker exec` against the running container instead. See [openclaw-cli-local.md](openclaw-cli-local.md) for both workflows.

## SSH Sandbox

If you enable **SSH sandbox backend** in the form, the installer writes OpenClaw sandbox config into `openclaw.json` and provisions the SSH material needed by the local container.

See [SANDBOX.md](SANDBOX.md) for the recommended form values, credential handling, and troubleshooting.

For upstream sandbox behavior, see the [OpenClaw sandboxing docs](https://github.com/openclaw/openclaw/blob/main/docs/gateway/sandboxing.md).

## What the Installer Does

### Container setup

The installer runs a podman (or docker) container with:

- `-p <port>:18789` — port mapping (works on macOS and Linux)
- `--bind lan` — gateway listens on `0.0.0.0` (required for port mapping)
- Labels: `openclaw.managed=true`, `openclaw.prefix=<prefix>`, `openclaw.agent=<name>`
- Installer-managed local state volume `openclaw-<prefix>-data` at `/home/node/.openclaw`
- Optional read-only agent source mount at `/tmp/agent-source` when `AGENT_SOURCE_DIR` or the form field is set

The installer does not disable Control UI device auth by default. This keeps the upstream browser pairing check in place for local deploys.

### Init script

Before starting the gateway, the installer runs an init script inside the container that:

1. Creates workspace directories (`workspace`, `skills`, `cron`, `workspace-<agentId>`)
2. Writes `openclaw.json` configuration to the data volume
3. Copies agent workspace files (`AGENTS.md`, `SOUL.md`, etc.) to the agent workspace
4. Sets permissions for the `node` user

If OpenAI Codex is selected, the installer then runs a separate one-off import step that writes `auth-profiles.json` for the main agent and any bundled subagents. The generated `openclaw.json` contains non-secret routing metadata for `openai-codex:default` plus model-scoped Codex runtime policy on `openai/*` refs; the OAuth access and refresh tokens live in the agent auth profile store. This is separate from OpenAI API-key auth, so deployments can use Codex OAuth for agent turns and `OPENAI_API_KEY` for embeddings or image generation.

### GCP credentials (Vertex AI)

When you provide a GCP service account JSON, the installer:

1. Base64-encodes the JSON
2. Runs a separate `podman run --rm` step (after the init script) to decode and write it to the data volume at `/home/node/.openclaw/gcp/sa.json`
3. Sets `GOOGLE_APPLICATION_CREDENTIALS=/home/node/.openclaw/gcp/sa.json` on the main container
4. Auto-extracts the `project_id` from the JSON for `GOOGLE_CLOUD_PROJECT`

The SA JSON is written to the podman volume, not bind-mounted, to avoid UID mismatch permission issues between the host user and the container's `node` user.

## Launcher Script

`run.sh` abstracts platform-specific container plumbing:

```bash
./run.sh                              # Pull image and start
./run.sh --build                      # Build from source instead of pulling
./run.sh --port 8080                  # Custom port (default: 3000)
OPENCLAW_INSTALLER_PORT=8080 ./run.sh # Same, via env var
./run.sh --runtime docker             # Force docker (default: auto-detect)
ANTHROPIC_API_KEY=sk-... ./run.sh     # Anthropic
OPENAI_API_KEY=sk-... ./run.sh        # OpenAI
```

| Platform | Runtime | What the script does |
|----------|---------|---------------------|
| macOS | podman | Extracts app from image, runs natively with Node.js |
| macOS | docker | Extracts app from image, runs natively with Node.js |
| Linux | podman | Runs as a container with rootless podman socket |
| Linux | docker | Extracts app from image, runs natively with Node.js |

To stop: `Ctrl+C` for native launcher runs, or `podman stop claw-installer` for the Linux podman containerized launcher.

### Manual container setup

If `run.sh` doesn't work for your setup:

```bash
# Linux (podman)
podman run -d --name claw-installer \
  --security-opt label=disable \
  -p 3000:3000 \
  -v /run/user/$(id -u)/podman/podman.sock:/run/podman/podman.sock \
  -v ~/.openclaw:/home/node/.openclaw:ro,Z \
  -v ~/.openclaw/installer:/home/node/.openclaw/installer:Z \
  -v ~/.codex:/home/node/.codex:ro \
  -e ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY \
  quay.io/sallyom/openclaw-installer:latest

# macOS with podman or Docker uses the native launcher path
./run.sh
```

## Remote Access

Running the installer on a remote machine:

```bash
# On the remote machine
ANTHROPIC_API_KEY=sk-... ./run.sh --build

# On your laptop
ssh -L 3000:localhost:3000 user@remote-host
# Open http://localhost:3000
```

## Updating Your Agent

After the initial deploy, your agent files live in `~/.openclaw/workspace-<prefix>_<name>/` on the host. To update a running agent:

1. Edit the files locally (e.g., change `AGENTS.md` to update instructions, `SOUL.md` to change personality)
2. Go to the **Instances** tab and **Stop** the container
3. **Start** it again — the installer copies your updated files into the local runtime store before starting the container

Every Start syncs agent files from the host, so Stop/Start is all you need. No separate re-deploy step is required for local instances.

## Instance Management

The **Instances** tab discovers all OpenClaw containers via labels and image name. For each instance you can:

- **Copy gateway token** — needed to authenticate with the Control UI
- **View run command** — the exact `podman run` command used
- **Open UI** — link to `http://localhost:<port>`
- **Stop** — stops and removes the container (volume preserved)
- **Start** — syncs agent files from host, then restarts the container
- **Delete data** — removes the podman volume

## Host Filesystem

```
~/.openclaw/
├── installer/
│   └── local/                               # Local instance configs
│       └── openclaw-<prefix>-<name>/
│           ├── .env                         # Instance variables
│           └── gateway-token                # Gateway auth token
├── skills/
│   └── <skill-name>/
│       └── SKILL.md
└── workspace-<prefix>_<name>/
    ├── AGENTS.md
    ├── agent.json
    ├── SOUL.md
    ├── IDENTITY.md
    ├── TOOLS.md
    ├── USER.md
    ├── HEARTBEAT.md
    └── MEMORY.md
```

Edit files in `workspace-<id>/`, then Stop and Start the container to push changes. The installer copies your local files into the volume on every Start, falling back to generated defaults for anything missing.

## Environment Variables

Pass these to `run.sh` or `npm run dev` to set server-side defaults (users can leave corresponding form fields blank):

| Variable | Purpose |
|----------|---------|
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `OPENAI_API_KEY` | OpenAI API key |
| `GEMINI_API_KEY` | Google AI Studio Gemini API key |
| `OPENROUTER_API_KEY` | OpenRouter API key |
| `GOOGLE_APPLICATION_CREDENTIALS` | Path to Google Cloud credentials for Vertex AI |
| `GOOGLE_CLOUD_PROJECT` | Google Cloud project for Vertex AI |
| `GOOGLE_CLOUD_LOCATION` | Google Cloud region for Vertex AI |
| `MODEL_ENDPOINT` | OpenAI-compatible endpoint for self-hosted models |
| `OPENCLAW_IMAGE` | Default container image |
| `OPENCLAW_PREFIX` | Default name prefix |

Starter templates:

- `.env.example` at the repo root for a generic local or Kubernetes setup
- `demos/builder-research-ops-ssh-sandbox/.env.example` for the bundled multi-agent SSH sandbox demo

## Troubleshooting SSH Sandbox

See [SANDBOX.md](SANDBOX.md#troubleshooting).
