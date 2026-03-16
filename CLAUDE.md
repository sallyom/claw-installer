# OpenClaw Installer

Browser-based deployment tool for OpenClaw (AI agent platform). Deploy OpenClaw instances to local containers (podman/docker), Kubernetes, or OpenShift — all from a web UI. Built with React, Vite, Express, and TypeScript.

## Structure

- `src/client/` - React frontend (Vite, deploy form, log streaming, instance management)
- `src/server/` - Express backend (API routes, WebSocket, deployer plugins)
- `src/server/deployers/` - Pluggable deployers: `local.ts` (podman/docker), `kubernetes.ts` (K8s/OpenShift)
- `src/server/services/` - Runtime detection (container engine, kubeconfig, GCP credentials)
- `docs/` - Deployment guides and annotated K8s YAML examples

## Key Files

- Server entry point: `src/server/index.ts`
- Client entry point: `src/client/App.tsx`
- Deployer interface & DeployConfig type: `src/server/deployers/types.ts`
- K8s manifest generation: `src/server/deployers/k8s-manifests.ts`
- Home directory layout helpers: `src/server/paths.ts`
- Container engine detection: `src/server/services/container.ts`
- Production image: `Dockerfile`
- Launch script (auto-detect runtime): `run.sh`

## Commands

```bash
npm run dev      # Start dev server (tsx watch + vite, concurrent)
npm run build    # Production build (vite + tsc)
npm run test     # Run tests once (vitest)
npm run lint     # ESLint
npm start        # Start production server
```

## Architecture

- REST API (`/api/deploy`, `/api/instances`, `/api/agents`, `/api/health`) + WebSocket (`/ws`) for real-time deploy logs
- Host files in `~/.openclaw/` are source of truth; pushed to instances on deploy/redeploy
- K8s resources generated dynamically via `@kubernetes/client-node` (no Helm/Kustomize)
- Local containers labeled (`openclaw.managed`, `openclaw.prefix`) for stateless discovery
- Multi-provider: Anthropic, OpenAI, Vertex AI (Gemini + Claude), self-hosted (vLLM)

## Commits

Use Conventional Commits: `type(scope): description`

- Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `ci`
- Scopes: `client`, `server`, `deployer`, `k8s`, `otel`
- Example: `feat(deployer): add SSH deploy target`

## More Info

See [BOOKMARKS.md](BOOKMARKS.md) for deployment guides, architecture docs, and external references.
