# ADR 0001: OpenShift Deployer Plugin Design

## Status

Accepted

## Context

OpenShift clusters require platform-specific resources beyond what a standard Kubernetes deployment provides:

- **OAuth Proxy** — OpenShift's built-in OAuth server provides SSO for web applications. The installer deploys an `oauth-proxy` sidecar container that authenticates users via OpenShift OAuth before they reach the OpenClaw gateway.
- **Routes** — OpenShift uses Route resources (not Ingress) for external access with automatic TLS termination.
- **ServiceAccounts with OAuth annotations** — the OAuth proxy requires a ServiceAccount with an `oauth-redirectreference` annotation pointing to the Route.
- **Serving certificates** — OpenShift can auto-issue TLS certificates for services via the `serving-cert` annotation.
- **Security constraints** — OpenShift enforces the `restricted-v2` Security Context Constraint by default. The deployment must run non-root with a read-only root filesystem and no custom SCCs.

These features don't belong in the vendor-neutral openclaw-installer core. This plugin provides them as a standalone npm package using the core's deployer plugin system.

## Decision

### Full Deployer Pattern

The plugin registers an `OpenShiftDeployer` that implements the full `Deployer` interface from openclaw-installer. Internally, it composes (wraps) the core `KubernetesDeployer` and adds OpenShift-specific behavior before and after delegation.

We chose the full deployer pattern over a hooks/middleware approach because:

1. OpenShift-specific features will continue to grow (OpenShift AI integration, model serving, GPU scheduling). A full deployer lets the plugin evolve independently without requiring new hook points in the core.
2. The OpenShift additions touch nearly every phase of deployment (pre-deploy SA creation, manifest customization, post-deploy Route creation, teardown cleanup). Hooks would need to be very granular, adding complexity to the core for a single consumer.
3. The plugin can override any lifecycle method completely if delegation to `KubernetesDeployer` is insufficient for a particular operation.

### Plugin Registration

The plugin's entry point (`src/index.ts`) exports an `InstallerPlugin` that registers the deployer:

```typescript
registry.register({
  mode: "openshift",
  title: "OpenShift",
  description: "Deploy to an OpenShift cluster with OAuth proxy and Routes",
  deployer: new OpenShiftDeployer(),
  detect: isOpenShift,
  priority: 10,  // higher than base kubernetes (0)
});
```

- **Detection**: `isOpenShift()` checks for the `route.openshift.io` API group in the cluster's API list. This reliably distinguishes OpenShift from plain Kubernetes.
- **Priority 10**: When both Kubernetes and OpenShift deployers detect availability (an OpenShift cluster satisfies both), the OpenShift deployer is auto-selected in the UI due to its higher priority. Users can still manually select plain Kubernetes if they prefer.

### Connection to openclaw-installer Plugin Points

The plugin uses these exported APIs from the core:

| Import Path | What | Why |
|-------------|------|-----|
| `@openclaw/installer/deployers/types` | `Deployer`, `DeployConfig`, `DeployResult`, `LogCallback` | Implement the deployer interface |
| `@openclaw/installer/deployers/kubernetes` | `KubernetesDeployer` | Delegate base K8s operations |
| `@openclaw/installer/deployers/registry` | `InstallerPlugin` | Type-safe plugin registration |
| `@openclaw/installer/deployers/k8s-helpers` | `namespaceName()` | Derive namespace from config (shared convention) |
| `@openclaw/installer/services/k8s` | `coreApi()`, `appsApi()`, `loadKubeConfig()` | K8s API client access for OpenShift-specific resources |

### Deployment Lifecycle

The `OpenShiftDeployer.deploy()` method follows this sequence:

1. **Create namespace** — same as base K8s deployer
2. **Create OpenShift-specific resources** (pre-deploy):
   - ServiceAccount with OAuth redirect annotation
   - OAuth config Secret (cookie secret + SA token)
3. **Delegate to KubernetesDeployer** — creates PVC, ConfigMaps, Secrets, Service, Deployment
4. **Patch K8s resources** for OpenShift (post-deploy):
   - Service: add `oauth-ui` port, `serving-cert` annotation
   - Deployment: inject oauth-proxy sidecar, set `serviceAccountName`, add OAuth/TLS volumes, change gateway bind to loopback
   - ConfigMap: add Route URL to allowed origins, disable device auth (OAuth handles authentication)
5. **Create Route** — TLS-terminated Route pointing to the oauth-ui port
6. **Return result** with Route URL as the access endpoint

For `teardown()`, the plugin:
1. Deletes the Route (this fixes a bug from the predecessor project where Routes were orphaned)
2. Deletes OAuth-specific Secrets
3. Delegates remaining cleanup (namespace deletion) to `KubernetesDeployer`

### Module Structure

| File | Responsibility |
|------|---------------|
| `src/index.ts` | Plugin entry point — registers OpenShiftDeployer with the registry |
| `src/openshift-deployer.ts` | Full deployer implementation — orchestrates the deploy/start/stop/status/teardown lifecycle |
| `src/oauth-proxy.ts` | Generates OAuth proxy container spec, ServiceAccount, and config Secret from YAML templates |
| `src/route.ts` | Route CRUD — create, get URL, delete via the `route.openshift.io/v1` CustomObjects API |
| `src/detection.ts` | `isOpenShift()` — detects OpenShift by checking for `route.openshift.io` API group |
| `templates/` | YAML templates for the OAuth proxy container and ServiceAccount |

## Consequences

### Positive

- OpenShift-specific code is fully isolated from the core installer. The core has zero vendor awareness.
- The plugin can be developed, versioned, and released independently.
- New OpenShift features (OpenShift AI, model serving) can be added here without touching the core.
- Generic K8s improvements in the core are inherited automatically via delegation to `KubernetesDeployer`.
- The Route deletion bug is fixed — teardown properly cleans up all OpenShift resources.

### Negative

- The plugin is coupled to `KubernetesDeployer`'s internal behavior (container ordering, resource naming, manifest structure). If the core changes these, the plugin's patches may break.
- The patch-after-deploy approach (creating resources via `KubernetesDeployer` then modifying them) adds extra API calls compared to generating correct manifests upfront.
- OAuth proxy image version (`quay.io/openshift/origin-oauth-proxy:4.14`) is hardcoded in the YAML template. Future OpenShift versions may need a different image.

### Mitigations

- The core's semver versioning signals breaking changes. The plugin's `peerDependency` on `@openclaw/installer` constrains compatible versions.
- If `KubernetesDeployer` internals change significantly, the plugin can override `deploy()` entirely rather than patching — the full deployer pattern supports this.
- The OAuth proxy image can be made configurable via `DeployConfig` if needed in the future.
