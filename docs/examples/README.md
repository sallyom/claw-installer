# Example YAMLs

These YAMLs document the plain Kubernetes resources that `openclaw-installer` creates. They are reference examples only; the installer generates resource objects in TypeScript and applies them directly through the Kubernetes API.

## Core resources

These are the standard resources created on a Kubernetes deploy:

| File | Resource |
|------|----------|
| `namespace.yaml` | Namespace used for the OpenClaw instance |
| `serviceaccount.yaml` | Service account used by the gateway pod |
| `pvc.yaml` | Persistent volume claim mounted at `/home/node`; runtime state lives in `/home/node/.openclaw` |
| `configmap-openclaw.yaml` | Generated `openclaw.json` |
| `configmap-agent.yaml` | Main workspace files |
| `configmap-agent-tree.yaml` | Additional bundled `workspace-*` directories |
| `configmap-skills.yaml` | Shared skills bundle |
| `configmap-cron.yaml` | Cron jobs bundle |
| `configmap-exec-approvals.yaml` | Optional `exec-approvals.json` source |
| `service.yaml` | ClusterIP service for port `18789` |
| `secrets.yaml` | Gateway token, model credentials, optional SSH sandbox material |
| `deployment.yaml` | Init container plus gateway container |

## Optional resources

These are only created for certain configurations:

| File | When it appears |
|------|------------------|
| `configmap-litellm.yaml` | Vertex through LiteLLM proxy |
| `configmap-otel.yaml` | OTEL enabled without the operator |
| `secrets.yaml` `gcp-sa` example | Direct Vertex credentials provided |

## Source

The manifest builders live in [k8s-manifests.ts](../../src/server/deployers/k8s-manifests.ts) and [kubernetes.ts](../../src/server/deployers/kubernetes.ts).
