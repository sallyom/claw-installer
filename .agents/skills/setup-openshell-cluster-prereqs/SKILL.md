---
name: setup-openshell-cluster-prereqs
description: >-
  Set up and verify cluster-scoped prerequisites for OpenShell-backed OpenClaw sandboxes on OpenShift/Kubernetes. Use for cluster-admin tasks before per-user deployments: Agent Sandbox CRDs/controller, cluster access validation, OpenShift SCC capability checks, and documenting the cluster as ready for one human / one OpenShell / one OpenClaw deployments.
---

# Set Up OpenShell Cluster Prerequisites

## Scope

Run the one-time cluster-admin setup needed before any per-user OpenShell/OpenClaw PoC deployment. Do not create per-user OpenShell or OpenClaw namespaces here; that belongs to `deploy-user-openshell-openclaw`.

## Preflight

Work from `../claw-installer` unless the user gives another path.

Confirm the active cluster and admin identity before making cluster-scoped changes:

```shell
kubectl config current-context
oc whoami
oc auth can-i create customresourcedefinitions.apiextensions.k8s.io
oc auth can-i use scc/privileged
```

If the context is unexpected or privileges are insufficient, stop and report the exact blocker.

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

## Install Agent Sandbox CRDs/Controller

Check whether the Agent Sandbox CRD is already installed:

```shell
oc get crd sandboxes.agents.x-k8s.io
```

If missing, install the upstream Agent Sandbox manifest once per cluster:

```shell
kubectl apply -f https://github.com/kubernetes-sigs/agent-sandbox/releases/latest/download/manifest.yaml
```

Verify after install:

```shell
oc get crd sandboxes.agents.x-k8s.io
oc api-resources | grep -i sandboxes
```

## Validate OpenShell Chart Inputs

Confirm the per-user OpenShift values file exists:

```shell
test -f openshell/configs/openshell-values-openshift.yaml
```

Confirm Helm can see both the discovered latest chart and the pinned fallback used by older PoC docs:

```shell
helm show chart oci://ghcr.io/nvidia/openshell/helm-chart --version "${openshell_version:-0.0.83}"
helm show chart oci://ghcr.io/nvidia/openshell/helm-chart --version 0.0.83 >/dev/null || true
```

If the discovered latest version differs from the deployer's `OPENSHELL_CLI_VERSION`, record the drift and recommend updating the injected CLI pin before the next deployment.

## Optional Smoke Namespace

Only if the user asks for a cluster-admin smoke test, create a disposable OpenShell namespace and Helm release, then delete it when done. Do not use `openshell-alice` or any known persistent user namespace for smoke tests.

Use a release name that includes the namespace name to avoid cluster-scoped RBAC ownership conflicts:

```shell
oc create ns openshell-smoke
oc adm policy add-scc-to-user privileged -z openshell-smoke-sandbox -n openshell-smoke
key_dir="$(mktemp -d)"
openssl genpkey -algorithm Ed25519 -out "${key_dir}/signing.pem"
openssl pkey -in "${key_dir}/signing.pem" -pubout -out "${key_dir}/public.pem"
printf 'openshell-0\n' > "${key_dir}/kid"
oc -n openshell-smoke create secret generic openshell-smoke-jwt-keys \
  --from-file=signing.pem="${key_dir}/signing.pem" \
  --from-file=public.pem="${key_dir}/public.pem" \
  --from-file=kid="${key_dir}/kid"
rm -rf "${key_dir}"
helm install openshell-smoke oci://ghcr.io/nvidia/openshell/helm-chart \
  --version "${openshell_version:-0.0.83}" \
  -n openshell-smoke \
  -f openshell/configs/openshell-values-openshift.yaml
oc wait --for=condition=Ready pod -l app.kubernetes.io/instance=openshell-smoke -n openshell-smoke --timeout=180s
```

Clean up the smoke release when requested or when the smoke test is complete:

```shell
helm uninstall openshell-smoke -n openshell-smoke
oc delete ns openshell-smoke
```

## Final Report

End with a compact readiness report:

```text
Cluster:
- context:
- user:
- can create CRDs:
- can use privileged SCC:

OpenShell prerequisites:
- Agent Sandbox CRD present:
- Agent Sandbox controller installed/verified:
- latest OpenShell release checked:
- Helm chart version verified:
- OpenShell CLI version checked:
- OpenShift values file present:

Per-user deployment defaults:
- OpenShell chart version:
- OpenShell CLI version:
- sandbox image:
- endpoint pattern:

Notes/blockers:
```
