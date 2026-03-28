# ADR 0003: Day 1 Scope Boundary

## Status

Proposed

## Context

The installer deploys OpenClaw to local containers, Kubernetes, and OpenShift. As the UI matures, there is a natural pull to add post-deployment management features — configuration editing, updates, plugin management, health dashboards, log viewers — because the installer already has a web interface and access to the running instance.

Upstream OpenClaw ships a comprehensive CLI (`openclaw`) that already covers these operations:

| Category | CLI commands |
| --- | --- |
| Configuration | `config get\|set\|unset\|validate`, `configure` |
| Updates | `update stable\|beta\|dev` |
| Plugin management | `plugins list\|install\|enable\|disable\|doctor` |
| Health & diagnostics | `health`, `doctor`, `status --deep` |
| Logs | `logs --follow` |
| Backup & restore | `backup create\|verify` |
| Secret management | `secrets audit\|configure\|apply\|reload` |
| Security audit | `security` |
| Channel management | `channels add\|remove\|login\|logout` |
| Scheduling | `cron add\|edit\|rm\|enable\|disable` |
| Hook & webhook management | `hooks`, `webhooks` |

Duplicating any of these capabilities in the installer creates the same problems that ADR 0001 identified for hardcoded deploy targets: unbounded scope, maintenance burden, and divergence from upstream behavior. It also fragments the user's mental model — they must learn which operations live in the installer UI versus the CLI.

## Decision

The installer's scope is limited to **Day 1 operations**: everything required to go from zero to a running OpenClaw instance. Anything that can be performed after deployment using the OpenClaw CLI or UI is out of scope for the installer.

### What is in scope (Day 1)

- Collecting deployment configuration (target platform, model providers, agent workspace)
- Secret injection at deploy time (API keys, SecretRefs)
- Provisioning infrastructure (containers, K8s resources, volumes)
- Writing initial `openclaw.json` and agent workspace files
- Instance lifecycle tied to deployment: start, stop, redeploy, delete
- One-way workspace sync from host into the running instance

### What is out of scope (Day 2)

Any operation that modifies a running instance's behavior or state after initial deployment, including but not limited to:

- **Configuration changes** — use `openclaw config` or `openclaw configure`
- **Version updates** — use `openclaw update`
- **Plugin management** — use `openclaw plugins`
- **Health monitoring and diagnostics** — use `openclaw health`, `openclaw doctor`, `openclaw status`
- **Log viewing** — use `openclaw logs`
- **Backup and restore** — use `openclaw backup`
- **Channel, hook, cron, and secret management** — use the respective CLI commands

### Decision framework

Before adding a feature to the installer, apply this test:

1. **Is this feature needed on first launch?** If no, it is out of scope.
2. **Can `openclaw <command>` already do this?** If yes, it is out of scope.
3. **Does this modify a running instance's behavior?** If yes, it is out of scope.

If a feature fails any of these checks, the correct response is to document how to use the CLI for that operation (e.g., in `docs/`) rather than to build it into the installer.

### Exceptions

The installer may provide **pointers** to Day 2 operations without implementing them:

- A post-deploy summary page that lists useful CLI commands
- Links to upstream documentation for common next steps
- `docs/` guides that show how to use the CLI with installer-provisioned instances (as `docs/openclaw-cli-local.md` already does)

## Consequences

### Positive

- Keeps the installer focused and maintainable.
- Avoids behavioral divergence between the installer UI and the upstream CLI.
- Reduces the risk of the installer becoming a parallel management plane that must track every upstream CLI change.
- Gives contributors a clear, testable criterion for evaluating feature requests.

### Negative

- Some users may expect a single UI for both deployment and management. They will need to learn the CLI for Day 2 operations.
- Feature requests that cross the boundary will need to be redirected upstream, which requires active triage.

### Risks

- The boundary may occasionally be ambiguous (e.g., "redeploy with new config" straddles Day 1 and Day 2). When this happens, prefer the narrower interpretation and discuss in the issue before implementing.

## References

- [Issue #59: Don't recreate the OpenClaw CLI](https://github.com/sallyom/openclaw-installer/issues/59)
- [ADR 0001: Deployer Plugin System](./0001-deployer-plugin-system.md) — precedent for avoiding unbounded scope
- [ADR 0002: Agent Security Surface](./0002-agent-security-surface.md) — precedent for preferring upstream OpenClaw features
- [docs/openclaw-cli-local.md](../docs/openclaw-cli-local.md) — existing example of pointing users to the CLI
