# Managing Credentials with Podman Secrets

> **Note:** This space is evolving fast. Here are some current solutions that
> work well for local setup — expect more options and tighter integrations over time.

For API-key style credentials, the goal is no secrets at rest inside the
container or data volume. OpenAI Codex OAuth is the exception because OpenClaw
needs a refreshable auth profile file at runtime.

## Why Not Just Use `.env`?

Placing API keys directly in the data volume works but has a significant
downside: the volume backup (`podman volume export`) captures those secrets too.
The options below keep API-key style secrets out of the volume entirely.

---

## Option 1: Podman Secrets

Podman has a built-in secrets manager. Secrets are stored outside the container
and injected at runtime as environment variables — they never touch the volume.

OpenAI Codex OAuth is a special case. It is not configured through the generic
Podman secret mappings field because OpenClaw needs a refreshable auth profile,
not a single API-key environment variable. When you select **OpenAI Codex**, the
installer reads the Codex CLI `auth.json` on the installer host, creates a
short-lived Podman secret containing the generated OpenClaw auth profile, copies
that into the OpenClaw data volume as `auth-profiles.json`, and immediately
removes the transient Podman secret. The long-lived runtime credential then lives
in the OpenClaw agent auth profile store.

### Create a secret

```bash
echo "ghp_yourtoken" | podman secret create gh_token -
```

### Create a secret from an existing environment variable

If you already have a provider key exported in your shell, create the Podman
secret from that environment variable instead of retyping it:

```bash
printf '%s' "$ANTHROPIC_API_KEY" | podman secret create anthropic_api_key -
printf '%s' "$OPENAI_API_KEY" | podman secret create openai_api_key -
```

This works well with the installer's **Podman secret mappings** field:

```text
anthropic_api_key=ANTHROPIC_API_KEY
openai_api_key=OPENAI_API_KEY
```

### Inject at container start

Add `--secret` to the `podman run` command:

```bash
podman run \
  --secret gh_token,type=env,target=GH_TOKEN \
  ... # rest of your openclaw run flags
```

The secret is available inside the container as `$GH_TOKEN`. It is not written to disk.

In the openclaw-installer UI, use **Podman secret mappings** instead of typing the raw
`--secret` syntax yourself. Enter one mapping per line:

```text
gh_token=GH_TOKEN
anthropic_api_key=ANTHROPIC_API_KEY
```

The installer appends the matching `--secret <name>,type=env,target=<ENV>` flags automatically
and preserves them across Stop/Start cycles.

If you also use explicit OpenClaw `env/default/...` SecretRefs, make sure the SecretRef ID matches
the target environment variable name from the mapping.

### Manage secrets

```bash
podman secret ls                                       # list registered secrets
podman secret rm gh_token                              # delete a secret
echo "new_token" | podman secret create gh_token -     # rotate
```

### Portability note

Podman secrets are local to the machine — they do not travel with volume exports
or backups. When moving to a new host, recreate secrets before starting the container.

---

## Advanced External Providers

OpenClaw also supports external `exec` secret providers, but those flows are
bring-your-own runtime integrations rather than a tested local installer path.

For local installer deployments, the recommended and documented approach is:

- use Podman secrets for runtime injection
- use OpenClaw `env/default/...` SecretRefs where needed

If you need an external provider such as Vault or 1Password, treat that as an
advanced custom integration and validate it end to end in your own runtime.

## Naming Conventions

Use consistent secret names so scripts and docs are predictable:

| Purpose | Podman secret name | Env var in container |
|---|---|---|
| GitHub PAT | `gh_token` | `GH_TOKEN` |
| Anthropic API key | `anthropic_api_key` | `ANTHROPIC_API_KEY` |
| OpenAI API key | `openai_api_key` | `OPENAI_API_KEY` |
| OpenAI Codex OAuth | handled automatically | `openai-codex:default` auth profile |
| Telegram bot token | `telegram_bot_token` | `TELEGRAM_BOT_TOKEN` |
| OpenClaw gateway token | `openclaw_gateway_token` | `OPENCLAW_GATEWAY_TOKEN` |

---

## Summary

| Approach | Secret at rest? | Travels with volume backup? |
|---|---|---|
| Podman secrets | No (Podman store) | No |
| OpenAI Codex OAuth import | Yes (`auth-profiles.json` in OpenClaw volume) | Yes |
