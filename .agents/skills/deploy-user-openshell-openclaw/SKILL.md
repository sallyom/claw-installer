---
name: deploy-user-openshell-openclaw
description: >-
  Provision exactly one human user's OpenShift PoC environment from claw-installer without requiring the human to run the installer manually: one per-user OpenShell namespace with one OpenShell Helm release, one per-user OpenClaw namespace/OpenClaw deployment, OpenShell sandbox backend wiring, and required post-checks. Use when asked to deploy, create, test, or reproduce a one human / one OpenShell / one OpenClaw setup after cluster prerequisites are ready.
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
OpenShell version: discover latest release before install; pinned fallback 0.0.44
OpenShell values: openshell/configs/openshell-values-openshift.yaml
OpenClaw image: quay.io/sallyom/openclaw-openshell:latest
OpenShell sandbox image: quay.io/sallyom/openclaw-openshell-sandbox:latest
OpenShell endpoint: http://openshell-<user>.openshell-<user>.svc.cluster.local:8080
sandbox backend: openshell
sandbox mode: all
sandbox scope: session
workspace access: rw
OpenShell plugin mode: mirror
```

Use a unique OpenShell Helm release name per user. The chart creates cluster-scoped node-reader RBAC; reusing release name `openshell` across namespaces causes Helm ownership conflicts.

## OpenShell Version Check

Before installing or building, check the latest OpenShell release and compare it with the local PoC defaults. OpenShell moves quickly; do not silently deploy an old chart/CLI when a newer release is available.

Preferred check with `gh`:

```shell
latest_tag="$(gh release view --repo NVIDIA/OpenShell --json tagName --jq .tagName)"
openshell_version="${latest_tag#v}"
current_cli_version="$(sed -n 's/^ARG OPENSHELL_CLI_VERSION=//p' openshell/Dockerfile)"
helm show chart oci://ghcr.io/nvidia/openshell/helm-chart --version "$openshell_version" >/dev/null
printf 'latest OpenShell release: %s\nlocal Dockerfile CLI: %s\n' "$openshell_version" "$current_cli_version"
```

Fallback without `gh`:

```shell
latest_tag="$(node -e 'fetch("https://api.github.com/repos/NVIDIA/OpenShell/releases/latest").then(r=>r.json()).then(j=>console.log(j.tag_name))')"
openshell_version="${latest_tag#v}"
current_cli_version="$(sed -n 's/^ARG OPENSHELL_CLI_VERSION=//p' openshell/Dockerfile)"
helm show chart oci://ghcr.io/nvidia/openshell/helm-chart --version "$openshell_version" >/dev/null
printf 'latest OpenShell release: %s\nlocal Dockerfile CLI: %s\n' "$openshell_version" "$current_cli_version"
```

If `openshell_version` differs from `current_cli_version`, report version drift and ask whether to update `openshell/Dockerfile` before building. Keep the Helm chart version, gateway/supervisor images, and OpenShell CLI version aligned unless the user explicitly asks to test a mixed-version combination.

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
oc adm policy add-scc-to-user privileged -z default -n openshell-<user>
```

Install OpenShell:

```shell
helm install openshell-<user> oci://ghcr.io/nvidia/openshell/helm-chart \
  --version "${openshell_version:-0.0.44}" \
  -n openshell-<user> \
  -f openshell/configs/openshell-values-openshift.yaml \
  --set server.sandboxImage=quay.io/sallyom/openclaw-openshell-sandbox:latest
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

Use an OpenClaw image that includes `/opt/openshell/bin/openshell`. If the user has just built an image by digest, prefer that digest over `latest`.

If building from local `../openclaw`, use:

```shell
OPENSHELL_CLI_VERSION="${openshell_version:-0.0.44}" \
  ./openshell/build-openclaw-source-image.sh quay.io/<org>/openclaw:openshell
podman push quay.io/<org>/openclaw:openshell
```

For `podman farm build`, build the OpenClaw base first, capture its digest, then layer the OpenShell CLI image on that digest:

```shell
podman farm build \
  -f ../openclaw/Dockerfile \
  --build-arg OPENCLAW_EXTENSIONS=diagnostics-otel,codex \
  --build-arg OPENCLAW_IMAGE_APT_PACKAGES="openssh-client rsync" \
  ../openclaw

podman farm build \
  -f openshell/Dockerfile \
  --build-arg OPENCLAW_BASE_IMAGE=quay.io/<org>/openclaw@sha256:<base-digest> \
  --build-arg OPENSHELL_CLI_VERSION="${openshell_version:-0.0.44}" \
  .
```

## Step 3: Deploy OpenClaw (No Cluster Admin Required After OpenShell Exists)

Use the installer UI/API rather than hand-writing Kubernetes manifests, because the installer owns the sane defaults and config generation. Once the cluster admin has provisioned OpenShell and provided the gateway endpoint, this step only needs permissions to deploy into the chosen `openclaw-<user>` namespace.

Required OpenClaw deploy values:

```text
mode: kubernetes/OpenShift
namespace: openclaw-<user>
image: CLI-bearing OpenClaw image, default quay.io/sallyom/openclaw-openshell:latest
sandbox enabled: true
sandbox backend: openshell
OpenShell gateway endpoint: http://openshell-<user>.openshell-<user>.svc.cluster.local:8080
OpenShell sandbox image/from: quay.io/sallyom/openclaw-openshell-sandbox:latest
OpenShell mode: mirror
```

Do not require the human to run `./run.sh` or hand-drive the UI. Prefer an agent-run deploy through the installer API:

1. If the installer server is not already running, start it from `../claw-installer` in a background terminal:

```shell
npm run dev
```

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
  "sandboxOpenShellMode": "mirror",
  "sandboxOpenShellFrom": "quay.io/sallyom/openclaw-openshell-sandbox:latest"
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

Verify the baked OpenShell CLI inside the gateway:

```shell
oc exec -n openclaw-<user> deployment/openclaw -c gateway -- \
  /opt/openshell/bin/openshell --version
```

Verify the old CLI init-container path is gone:

```shell
oc get pod -n openclaw-<user> -l app=openclaw -o jsonpath='{.items[0].spec.initContainers[*].name}'
```

Expected init containers include `init-config` and `install-openclaw-plugins`, not `install-openshell-cli`.

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
