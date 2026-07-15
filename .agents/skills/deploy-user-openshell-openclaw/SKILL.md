---
name: deploy-user-openshell-openclaw
description: >-
  Provision exactly one human user's OpenShift PoC environment from claw-installer without requiring the human to hand-drive the installer UI: one per-user OpenShell namespace with one OpenShell Helm release, one per-user OpenClaw namespace/OpenClaw deployment, OpenShell sandbox backend wiring, and required post-checks. Use when asked to deploy, create, test, or reproduce a one human / one OpenShell / one OpenClaw setup after cluster prerequisites are ready.
---

# Deploy One User OpenShell/OpenClaw PoC

## Scope

Run exactly one deployment round for one human user. Do not batch multiple users in one run. If asked for multiple users, repeat this skill separately for each user.

This end-to-end skill requires cluster-admin or delegated platform-operator privileges because it provisions OpenShell: it creates the `openshell-<user>` namespace, grants privileged SCC in that namespace, installs the OpenShell Helm release, and may create chart cluster-scoped RBAC. A non-admin OpenClaw owner should not run the OpenShell provisioning steps.

Privilege split:

```text
cluster admin / platform operator:
  - install cluster-scoped Agent Sandbox prerequisites
  - create openshell-<user>
  - grant privileged SCC only in openshell-<user>
  - install or upgrade the per-user OpenShell Helm release
  - provide the OpenShell gateway endpoint and approved OpenClaw image

OpenClaw namespace owner / user:
  - create or use openclaw-<user>, if permitted by cluster policy
  - deploy OpenClaw with the approved image
  - select OpenShell sandbox backend using the provided endpoint
```

The target shape is:

```text
openshell-<user>  # OpenShell gateway and OpenShell-created sandbox pods
openclaw-<user>   # OpenClaw gateway/control UI/PVC/config
```

OpenClaw is not inside OpenShell. OpenClaw calls the `@openclaw/openshell-sandbox` plugin, and the plugin asks that user's OpenShell gateway to create or reuse sandbox pods.

## RBAC Model

Use stable groups so an IdP can map users later:

```text
openclaw-platform-admins       # cluster/platform operators
openclaw-<user>-owners         # manage only openclaw-<user>
openshell-<user>-observers     # optional read-only debug access to openshell-<user>
```

Default posture: do not give normal users write access in `openshell-<user>`. Sandbox cleanup should go through OpenClaw/OpenShell APIs, not Kubernetes pod or Sandbox CR deletion. If read-only debug access is requested, use `openshell/platform-users/user-namespace-rbac.yaml` and bind only `get/list/watch` permissions in the OpenShell namespace.

## Defaults

Use these defaults unless the user gives a different value:

```text
repo: ../claw-installer
user: derive from request; must be RFC1123-safe lowercase alphanumeric plus hyphen
openshell namespace: openshell-<user>
openshell Helm release: openshell-<user>
openclaw namespace: openclaw-<user>
OpenShell version: discover latest release before install; pinned fallback 0.0.83
OpenShell values: openshell/configs/openshell-values-openshift.yaml
OpenClaw image: quay.io/sallyom/openclaw-openshell:latest
OpenShell sandbox image: quay.io/sallyom/openclaw-openshell:latest
OpenClaw image platform: linux/amd64 and linux/arm64
OpenShell endpoint: http://openshell-<user>.openshell-<user>.svc.cluster.local:8080
sandbox backend: openshell
sandbox mode: all
sandbox scope: session
workspace access: rw
OpenShell plugin mode: remote
use image entrypoint: false
```

Use a unique OpenShell Helm release name per user. The chart creates cluster-scoped node-reader RBAC; reusing release name `openshell` across namespaces causes Helm ownership conflicts.

## OpenShell Version Check

Before installing or building, check the latest OpenShell release and compare it with the local PoC defaults. OpenShell moves quickly; do not silently deploy an old chart/CLI when a newer release is available.

Preferred check with `gh`:

```shell
latest_tag="$(gh release view --repo NVIDIA/OpenShell --json tagName --jq .tagName)"
openshell_version="${latest_tag#v}"
current_cli_version="$(sed -n 's/^const OPENSHELL_CLI_VERSION = "\([^"]*\)";/\1/p' src/server/deployers/k8s-manifests.ts)"
helm show chart oci://ghcr.io/nvidia/openshell/helm-chart --version "$openshell_version" >/dev/null
printf 'latest OpenShell release: %s\ninjected CLI pin: %s\n' "$openshell_version" "$current_cli_version"
```

Fallback without `gh`:

```shell
latest_tag="$(node -e 'fetch("https://api.github.com/repos/NVIDIA/OpenShell/releases/latest").then(r=>r.json()).then(j=>console.log(j.tag_name))')"
openshell_version="${latest_tag#v}"
current_cli_version="$(sed -n 's/^const OPENSHELL_CLI_VERSION = "\([^"]*\)";/\1/p' src/server/deployers/k8s-manifests.ts)"
helm show chart oci://ghcr.io/nvidia/openshell/helm-chart --version "$openshell_version" >/dev/null
printf 'latest OpenShell release: %s\ninjected CLI pin: %s\n' "$openshell_version" "$current_cli_version"
```

If `openshell_version` differs from `current_cli_version`, report version drift and ask whether to update the injected CLI pin before deploying. Keep the Helm chart version, gateway/supervisor images, and OpenShell CLI version aligned unless the user explicitly asks to test a mixed-version combination.

## Preflight

This skill assumes cluster-scoped prerequisites are already installed. If `sandboxes.agents.x-k8s.io` is missing, stop and use the `setup-openshell-cluster-prereqs` skill first.

1. `cd ../claw-installer`.
2. Confirm the Kubernetes/OpenShift context before changing the cluster:

```shell
kubectl config current-context
oc whoami
```

3. Check the cluster-scoped Agent Sandbox CRD without installing it:

```shell
oc get crd sandboxes.agents.x-k8s.io
```

4. Check for existing user resources before creating anything:

```shell
oc get ns openshell-<user> openclaw-<user> --ignore-not-found
helm list -n openshell-<user>
```

If `openshell-<user>` or a Helm release already exists, stop and ask whether to reuse, upgrade, or create a different user name unless the user explicitly requested working with that existing environment.

## Step 1: Provision OpenShell (Cluster Admin Required)

Create the OpenShell namespace and grant privileged SCC only there. These commands require cluster-admin or equivalent delegated privileges:

```shell
oc create ns openshell-<user>
oc adm policy add-scc-to-user privileged -z openshell-<user>-sandbox -n openshell-<user>
```

Create the JWT signing secret required when the OpenShift values disable the
chart PKI job:

```shell
key_dir="$(mktemp -d)"
openssl genpkey -algorithm Ed25519 -out "${key_dir}/signing.pem"
openssl pkey -in "${key_dir}/signing.pem" -pubout -out "${key_dir}/public.pem"
printf 'openshell-0\n' > "${key_dir}/kid"
oc -n openshell-<user> create secret generic openshell-<user>-jwt-keys \
  --from-file=signing.pem="${key_dir}/signing.pem" \
  --from-file=public.pem="${key_dir}/public.pem" \
  --from-file=kid="${key_dir}/kid"
rm -rf "${key_dir}"
```

Install OpenShell:

```shell
helm install openshell-<user> oci://ghcr.io/nvidia/openshell/helm-chart \
  --version "${openshell_version:-0.0.83}" \
  -n openshell-<user> \
  -f openshell/configs/openshell-values-openshift.yaml
```

Wait and verify:

```shell
oc wait --for=condition=Ready pod -l app.kubernetes.io/instance=openshell-<user> -n openshell-<user> --timeout=180s
oc get statefulset,svc,pod -n openshell-<user>
oc logs -n openshell-<user> pod/openshell-<user>-0 --tail=80
```

Expected endpoint:

```text
http://openshell-<user>.openshell-<user>.svc.cluster.local:8080
```

## Step 2: Prepare OpenClaw Inputs

Use the multi-arch UBI 9 image from the defaults. The deployer injects the
OpenShell CLI and external plugin at pod startup; the image supplies OpenClaw,
a compatible Node/SQLite runtime, SSH/rsync tools, and the sandbox account.

To rebuild the default image from the pinned OpenClaw release, use:

```shell
./openshell/build-openclaw-source-image.sh quay.io/<org>/openclaw:openshell
podman push quay.io/<org>/openclaw:openshell
```

`OPENSHELL_CLI_VERSION` is not a Dockerfile build argument; the CLI remains an
init-container concern. For a multi-arch `podman farm build`, build the
standalone Dockerfile directly:

```shell
podman farm build \
  -f openshell/Dockerfile \
  --build-arg OPENCLAW_REF=v2026.7.1 \
  .
```

Do not pass `OPENCLAW_EXTENSIONS` to this Dockerfile. It performs the full
OpenClaw build, which includes bundled plugins such as `codex` and
`diagnostics-otel`. OpenShell is an external plugin (`bundledDist: false`), so
the image deliberately excludes its source and the deployer installs the
published `@openclaw/openshell-sandbox@2026.7.1` package into persistent
OpenClaw state.

## Step 3: Deploy OpenClaw (No Cluster Admin Required After OpenShell Exists)

Use the installer UI/API rather than hand-writing Kubernetes manifests, because the installer owns the sane defaults and config generation. Once the cluster admin has provisioned OpenShell and provided the gateway endpoint, this step only needs permissions to deploy into the chosen `openclaw-<user>` namespace.

Required OpenClaw deploy values:

```text
mode: kubernetes/OpenShift
namespace: openclaw-<user>
image: quay.io/sallyom/openclaw-openshell:latest
sandbox enabled: true
sandbox backend: openshell
OpenShell gateway endpoint: http://openshell-<user>.openshell-<user>.svc.cluster.local:8080
OpenShell sandbox image/from: quay.io/sallyom/openclaw-openshell:latest
OpenShell mode: remote
use image entrypoint: false
```

Do not require the human to hand-drive the UI. Prefer an agent-run deploy
through the installer API, but follow the repository's user-managed installer
lifecycle rule:

1. Reuse the installer if it is already running. If it is not running, ask the
   human to start it from `../claw-installer` with a persistent state directory
   and leave it running. Do not start or stop the installer automatically:

```shell
OPENCLAW_INSTALLER_STATE_DIR="$HOME/.local/share/openclaw-installer" ./run.sh
```

Use the same `OPENCLAW_INSTALLER_STATE_DIR` for later launches so saved
instances and deployment inputs remain discoverable.

2. POST a normal `DeployConfig` to `http://127.0.0.1:3000/api/deploy`. Use provider credentials or SecretRefs according to the user's chosen model provider. Do not invent credentials, paste secrets into logs, or hard-code credentials into files.

Minimal OpenShell fields for the POST body:

```json
{
  "mode": "kubernetes",
  "agentName": "<user>",
  "agentDisplayName": "<User>",
  "namespace": "openclaw-<user>",
  "image": "quay.io/sallyom/openclaw-openshell:latest",
  "sandboxEnabled": true,
  "sandboxMode": "all",
  "sandboxScope": "session",
  "sandboxWorkspaceAccess": "rw",
  "sandboxBackend": "openshell",
  "sandboxOpenShellGatewayEndpoint": "http://openshell-<user>.openshell-<user>.svc.cluster.local:8080",
  "sandboxOpenShellMode": "remote",
  "sandboxOpenShellFrom": "quay.io/sallyom/openclaw-openshell:latest",
  "useImageEntrypoint": false
}
```

If credentials are not available to the agent, stop after OpenShell is ready and give the exact installer/API fields the human must provide.

## Step 4: Required Post-Checks

After OpenClaw deploys:

```shell
oc wait --for=condition=Available deployment/openclaw -n openclaw-<user> --timeout=180s
oc get deployment,svc,pod,pvc -n openclaw-<user>
oc logs -n openclaw-<user> deployment/openclaw -c gateway --tail=120
```

Verify the injected OpenShell CLI inside the gateway:

```shell
oc exec -n openclaw-<user> deployment/openclaw -c gateway -- \
  /openshell-bin/openshell --version
```

Verify the CLI was injected by the consolidated plugin init container:

```shell
oc get pod -n openclaw-<user> -l app=openclaw -o jsonpath='{.items[0].spec.initContainers[*].name}'
```

Expected init containers include `init-config` and `install-openclaw-plugins`;
the latter downloads the CLI and ensures the plugin is available, installing
the published package when it is not bundled in the image.

Verify that OpenClaw loaded the OpenShell plugin rather than merely discovering
its name:

```shell
oc exec -n openclaw-<user> deployment/openclaw -c gateway -- \
  node /app/openclaw.mjs plugins list --json
```

The JSON entry with `id` `openshell` must report `status` `loaded`. A disabled
or error entry does not pass this check.

Record the immutable image ID used by the running gateway, especially while
the PoC default uses the mutable `:latest` tag:

```shell
oc get pod -n openclaw-<user> -l app=openclaw \
  -o jsonpath='{.items[0].status.containerStatuses[?(@.name=="gateway")].imageID}{"\n"}'
```

Trigger one OpenClaw agent turn that uses `exec`, then watch OpenShell sandbox pods:

```shell
oc get pods -n openshell-<user> -w
```

Expected result:

- OpenClaw gateway remains in `openclaw-<user>`.
- OpenShell gateway remains in `openshell-<user>`.
- One or more agent sandbox pods appear in `openshell-<user>` for the session.
- Agent command output returns through OpenClaw.

## Final Report

End with a compact report:

```text
Created/used:
- OpenShell namespace:
- OpenShell release:
- OpenShell version:
- OpenShell endpoint:
- OpenClaw namespace:
- OpenClaw image:
- OpenClaw image digest:

Post-checks:
- cluster prerequisites already present:
- OpenShell gateway Ready:
- OpenClaw deployment Available:
- OpenShell CLI in gateway:
- OpenShell CLI version matches chart:
- OpenShell plugin installed:
- sandbox pod observed:

Notes/blockers:
```

Mention any reused resources, existing namespaces, auth gaps, or credentials that required human action.
