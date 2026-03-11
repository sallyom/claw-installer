# Example YAMLs

These YAMLs show what the claw-installer creates when you deploy OpenClaw to OpenShift. They are **reference examples only** — the installer does not apply static YAML files.

## How the installer works

Instead of Helm charts or kustomize overlays, the installer builds Kubernetes resources dynamically in TypeScript using the `@kubernetes/client-node` SDK. When you click Deploy, it constructs each resource as a JavaScript object (with your namespace, agent name, API keys, etc. interpolated), then creates or replaces it via the Kubernetes API directly.

This means there are no templates to render, no `kubectl apply`, and no generated YAML directory. The installer talks to the API server the same way `oc` or `kubectl` do — just programmatically.

The two exceptions are the OpenShift OAuth proxy files in [`src/server/deployers/openshift/`](../../src/server/deployers/openshift/), which are static YAML loaded at runtime with placeholder substitution for namespace and client-id. Everything else is built in code.

## Why not Helm or kustomize?

OpenClaw is a single-container deployment (plus an oauth-proxy sidecar on OpenShift). The configuration is driven by a handful of form fields — namespace, agent name, image, API keys. A Helm chart or kustomize base would add packaging and templating machinery for what amounts to ~10 resources with straightforward logic. The installer's approach keeps the deployment logic in the same TypeScript codebase as the UI, so the deploy form and the resource definitions stay in sync without a separate template layer.

## What's in each file

| File | What the installer creates |
|------|---------------------------|
| `namespace.yaml` | Labeled namespace for installer discovery |
| `serviceaccount.yaml` | OAuth proxy SA (OpenShift only) |
| `oauth-config-secret.yaml` | SA token + cookie secret (OpenShift only) |
| `service.yaml` | ClusterIP with gateway and oauth-ui ports |
| `route.yaml` | TLS-terminated Route (OpenShift only) |
| `pvc.yaml` | 10Gi volume for all persistent state |
| `configmap-openclaw.yaml` | Main `openclaw.json` configuration |
| `configmap-agent.yaml` | Agent workspace files (AGENTS.md, SOUL.md, etc.) |
| `secrets.yaml` | Gateway token, API keys, and GCP credentials JSON |
| `deployment.yaml` | Full pod spec: init container, oauth-proxy sidecar, gateway |

Resources marked "OpenShift only" are skipped on plain Kubernetes clusters. The installer detects OpenShift at deploy time and adjusts accordingly.

## Source

The resource definitions live in [`src/server/deployers/kubernetes.ts`](../../src/server/deployers/kubernetes.ts).
