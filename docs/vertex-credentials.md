# Vertex AI Credential Resolution

When Vertex AI is enabled, the installer resolves GCP project ID, location,
and credentials through multiple layers of fallbacks. This document explains
the full resolution order so you can predict which value will be used when
multiple sources are configured.

## Resolution order

At each layer, the first non-empty value wins. Later layers only apply if
previous layers didn't produce a value.

### Layer 1: User input (deploy form)

Values typed or uploaded directly in the deploy form always take precedence.
This includes:

- **GCP Project ID** field
- **GCP Region** field
- **Google Cloud Credentials (JSON)** (file upload or typed path)

### Layer 2: Saved instance config

When loading a saved config (from the dropdown or a `.env` upload), its values
are applied to the form. User edits on top of a loaded config still win.

### Layer 3: Environment variable detection

When Vertex is first enabled in the form, the installer fetches detected
defaults from `GET /api/configs/gcp-defaults`. These pre-fill empty fields
only; they never overwrite values you've already entered.

At deploy time, the server also falls back to these defaults for any values
still missing from the request.

#### GCP Project ID (checked in order)

| Priority | Environment Variable | Notes |
|----------|---------------------|-------|
| 1 | `GOOGLE_CLOUD_PROJECT` | Modern standard for Google Cloud client libraries |
| 2 | `GCLOUD_PROJECT` | Legacy Google Cloud SDK standard |
| 3 | `ANTHROPIC_VERTEX_PROJECT_ID` | Used by Claude Code and Anthropic tooling |
| 4 | `CLOUD_SDK_PROJECT` | Occasionally used by gcloud CLI |
| 5 | `GOOGLE_VERTEX_PROJECT` | Vertex AI-specific |
| 6 | `project_id` field from credentials JSON | Parsed from the service account or ADC file (see below) |

#### GCP Location / Region (checked in order)

| Priority | Environment Variable | Notes |
|----------|---------------------|-------|
| 1 | `GOOGLE_CLOUD_LOCATION` | Standard for Google Cloud services |
| 2 | `GOOGLE_VERTEX_LOCATION` | Vertex AI-specific |

#### Credentials file (checked in order)

| Priority | Source | Notes |
|----------|--------|-------|
| 1 | Path in `GOOGLE_APPLICATION_CREDENTIALS` | Must point to a valid JSON file |
| 2 | `~/.config/gcloud/application_default_credentials.json` | Default ADC path (created by `gcloud auth application-default login`) |
| 3 | `/tmp/gcp-adc/application_default_credentials.json` | Container-mounted ADC path (used when the installer runs in a container via `run.sh`) |

The installer validates that the file exists and contains valid JSON before
using it. If a file is found but contains invalid JSON, it is skipped and the
next source is tried.

### Layer 4: Built-in defaults

If no location is provided after all the above, the installer applies a
default based on the Vertex provider:

| Provider | Default Location |
|----------|-----------------|
| Anthropic (Claude via Vertex) | `us-east5` |
| Google (Gemini) | `us-central1` |

This default is required because OpenClaw's provider registration fails
without a location set.

## Credential types

The credentials JSON file has a `type` field that affects compatibility:

| Type | Created by | Works with |
|------|-----------|------------|
| `service_account` | Downloading a key from GCP Console or `gcloud iam service-accounts keys create` | Both Anthropic and Google Vertex providers |
| `authorized_user` | `gcloud auth application-default login` | Anthropic Vertex provider only |

If you have `authorized_user` credentials and select the Google (Gemini)
provider, the installer shows a warning. Your options are:

1. **Switch to Anthropic (Claude via Vertex)** -- works with ADC credentials
2. **Provide a Service Account key** -- upload or type a path to a
   `service_account` type JSON file, which works with both providers

## LiteLLM proxy (recommended)

When Vertex AI is enabled with service account credentials, the installer
deploys a LiteLLM proxy sidecar alongside the OpenClaw gateway. This is
enabled by default and can be toggled via the "Use LiteLLM proxy" checkbox
in the deploy form.

### Security benefit

When you deploy an OpenClaw agent with Vertex AI, your Google Cloud
credentials need to be available somewhere to authenticate API calls.
Without LiteLLM, those credentials are mounted directly into the agent
container — meaning if the agent or its container is ever compromised,
an attacker gets your full GCP service account key and can access any
Google Cloud resource that key has permissions for. With the LiteLLM
proxy, the credentials stay in a separate sidecar container that the
agent can't access. The agent only gets a randomly generated internal
API key that's useless outside the local pod — it can make LLM calls
through the proxy, but it can never see or exfiltrate your Google
credentials.

```
Agent/Gateway  -->  LiteLLM proxy (localhost:4000)  -->  Vertex AI
     |                      |
  only has a           holds the real
  LiteLLM key          GCP credentials
```

### Performance

There is a small amount of added latency per request — one extra HTTP
hop through localhost. In practice this is negligible (sub-millisecond)
since both containers share the same network namespace and the LiteLLM
proxy is just forwarding the request. The first deployment is noticeably
slower due to the ~1.5 GB image pull, but subsequent deploys reuse the
cached image. You won't notice any difference in conversation speed.

### How it works

- **Kubernetes**: LiteLLM runs as a sidecar container in the same pod.
  The `gcp-sa` secret is mounted only on the LiteLLM container.
- **Local (podman)**: A pod is created with both containers sharing
  localhost. GCP credentials are only accessible to the LiteLLM container.
- **Local (docker)**: LiteLLM starts first; the gateway shares its
  network namespace via `--network=container:`.

The gateway connects to `http://localhost:4000/v1` using an auto-generated
internal API key. The model is routed through LiteLLM's OpenAI-compatible
API to Vertex AI.

### LiteLLM container image

The proxy uses `ghcr.io/berriai/litellm:v1.82.3-stable.patch.2` (~1.5 GB). The first
deployment will take extra time while this image is pulled. You can
pre-pull it to speed things up:

```bash
podman pull ghcr.io/berriai/litellm:v1.82.3-stable.patch.2
# or
docker pull ghcr.io/berriai/litellm:v1.82.3-stable.patch.2
```

### Disabling the proxy

Uncheck "Use LiteLLM proxy" in the deploy form to revert to the legacy
behavior where GCP credentials are passed directly to the agent container.
This is not recommended but may be needed if LiteLLM introduces
compatibility issues with your model.

### Model naming with the proxy

When the proxy is active, the model string changes from the Vertex format
(e.g., `anthropic-vertex/claude-sonnet-4-6`) to an OpenAI-compatible
format (e.g., `openai/claude-sonnet-4-6`). This is handled automatically
when using the default model. If you override the model field, use the
model name as registered in LiteLLM (e.g., `claude-sonnet-4-6` without
any prefix).

## Containerized installer (run.sh)

When the installer runs inside a container via `run.sh`, environment
variables and credential files from the host must be explicitly forwarded.
The script handles this automatically:

- All GCP-related environment variables listed above are passed through
  with `-e` flags
- `GOOGLE_APPLICATION_CREDENTIALS` file is bind-mounted to
  `/tmp/gcp-creds/sa.json` and the env var is rewritten to match
- The default ADC file (`~/.config/gcloud/application_default_credentials.json`)
  is bind-mounted to `/tmp/gcp-adc/` if it exists

## Troubleshooting

**Wrong project ID being used?**
Check which environment variables are set: `env | grep -E 'GOOGLE_CLOUD_PROJECT|GCLOUD_PROJECT|ANTHROPIC_VERTEX_PROJECT_ID|CLOUD_SDK_PROJECT|GOOGLE_VERTEX_PROJECT'`.
The first one found in priority order wins. Unset the unwanted ones or
type the correct value in the deploy form (which always takes precedence).

**"Unknown model" error after deploying?**
The Vertex location is probably missing. Check that `GOOGLE_CLOUD_LOCATION`
is set in the pod: `oc exec -n <namespace> deployment/openclaw -c gateway -- env | grep LOCATION`.

**"Cannot convert undefined or null to object" with Gemini?**
Your credentials are likely `authorized_user` type (ADC). Gemini on Vertex
doesn't support this. Switch to the Anthropic provider or use a Service
Account key file.

**Credentials not detected in the UI?**
If running the installer in a container, make sure `run.sh` is forwarding
your environment. Check that `GOOGLE_APPLICATION_CREDENTIALS` points to an
existing file on the host, or that `~/.config/gcloud/application_default_credentials.json` exists.

**LiteLLM proxy not starting?**
Check the sidecar logs. For local mode: `podman logs <name>-litellm` or
`docker logs <name>-litellm`. For K8s: `kubectl logs -n <namespace>
deployment/openclaw -c litellm`. Common issues include an invalid
credentials file or a missing project/location in the config.

**First deployment is very slow?**
The LiteLLM image (`ghcr.io/berriai/litellm:v1.82.3-stable.patch.2`) is ~1.5 GB.
Pre-pull it before deploying:
`podman pull ghcr.io/berriai/litellm:v1.82.3-stable.patch.2`
