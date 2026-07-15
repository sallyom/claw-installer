# Demo: Many OpenClaws on OpenShift with OpenShell Sandboxes

This runbook proves the target platform shape for many human users running
personal OpenClaw instances with centrally managed OpenShell sandboxes.

## Decided PoC setup

Use one OpenShell install and one OpenClaw install per human user:

```text
OpenShift cluster
  Agent Sandbox CRDs/controller        # cluster-admin installs once

  openshell-alice                      # cluster-admin owns/provisions
    OpenShell gateway
    OpenShell-created sandbox pods
    privileged SCC on this namespace only

  openclaw-alice                       # normal app namespace
    OpenClaw gateway/control UI/PVC/config
    @openclaw/openshell-sandbox plugin

  openshell-bob
    OpenShell gateway
    OpenShell-created sandbox pods

  openclaw-bob
    OpenClaw gateway/control UI/PVC/config
```

OpenClaw is not itself inside an OpenShell sandbox. OpenClaw is the persistent
user-facing app. Its sandboxed command execution calls the OpenShell plugin,
which asks that user's OpenShell gateway to create or reuse sandbox pods.

Keep OpenShell and OpenClaw in separate namespaces. The OpenShell namespace gets
privileged SCC so sandbox pods can run; the OpenClaw namespace should remain a
normal app namespace with only the permissions OpenClaw needs.

Privilege boundary: installing OpenShell is cluster-admin/platform-operator work.
Deploying OpenClaw does not require cluster-admin after OpenShell exists, as long
as the user or installer has normal permissions in the target `openclaw-<user>`
namespace and can reach the provided OpenShell gateway service.

## Cluster-admin responsibilities

The cluster admin does the cluster-scoped and privileged setup:

- install Agent Sandbox CRDs/controller once per cluster
- create one `openshell-<user>` namespace per human user
- grant privileged SCC only in that user's OpenShell namespace
- install one OpenShell Helm release per human user
- provide the OpenShell gateway service URL to the OpenClaw installer/user
- provide or approve the digest-pinned OpenClaw/sandbox image

The OpenShell Helm chart does not install the Agent Sandbox CRDs. It does create
cluster-scoped RBAC for node reads, so use a unique Helm release name per user to
avoid release ownership conflicts. For example:

```text
user alice: release openshell-alice in namespace openshell-alice
user bob:   release openshell-bob   in namespace openshell-bob
```

The resulting gateway endpoint pattern is:

```text
http://<helm-release>.<openshell-namespace>.svc.cluster.local:8080
```

Examples:

```text
http://openshell-alice.openshell-alice.svc.cluster.local:8080
http://openshell-bob.openshell-bob.svc.cluster.local:8080
```

If an older environment used release name `openshell`, its endpoint is instead:

```text
http://openshell.openshell-alice.svc.cluster.local:8080
```

## Human user / OpenClaw owner responsibilities

The OpenClaw owner deploys or requests one normal OpenClaw namespace per user:

- create or select `openclaw-<user>`
- deploy OpenClaw with the approved digest-pinned UBI/S2I image
- choose the OpenShell sandbox backend only after the cluster admin has provided
  the user's OpenShell gateway endpoint
- set the OpenShell gateway endpoint in the installer
- use the normal provider credential flow for that user's OpenClaw instance

The installer installs the external `@openclaw/openshell-sandbox@2026.7.1`
plugin into the PVC-backed OpenClaw home before gateway startup. The same init
container downloads the checksum-verified OpenShell CLI into an `openshell-cli`
volume shared with the gateway.

## RBAC and IdP group model

Create groups now with stable names, then later map IdP groups into them when
SSO/IdP integration is activated.

Recommended groups:

```text
openclaw-platform-admins       # cluster/platform operators
openclaw-<user>-owners         # can manage OpenClaw resources in openclaw-<user>
openshell-<user>-observers     # optional read-only OpenShell debug access
```

Default access model:

```text
openshell-<user>
  owner: platform
  writers: OpenShell Helm release/service accounts only
  user access: none by default, optional read-only observer
  cleanup: mediated by OpenClaw/OpenShell API, not raw pod/CR deletes

openclaw-<user>
  owner: user/team
  writers: openclaw-<user>-owners
  user access: normal namespace-owner/admin access, subject to org policy
```

Do not grant normal users `admin`, `edit`, `create`, `update`, `patch`, or
`delete` in `openshell-<user>`. That namespace has privileged sandbox execution
surface. Users should clean up sessions/sandboxes through OpenClaw ControlUI/API
or a mediated OpenClaw/OpenShell admin command, so ownership checks and audit
logs stay in the application layer.

Optional read-only OpenShell access is useful for advanced debugging, but keep it
to `get/list/watch` on pods, logs, events, services, StatefulSets, and Sandbox
CRs. Start from [platform-users/user-namespace-rbac.yaml](platform-users/user-namespace-rbac.yaml)
and replace `USER` with the per-user id.

## Prerequisites

- OpenShift cluster access
- `oc`, `helm`, `openssl`, and the `claw-installer` checkout

## 1. Install OpenShell cluster prerequisites

Install the Agent Sandbox CRDs/controller once per cluster:

```shell
kubectl apply -f https://github.com/kubernetes-sigs/agent-sandbox/releases/latest/download/manifest.yaml
```

Verify:

```shell
oc get crd sandboxes.agents.x-k8s.io
```

## 2. Create a user's OpenShell namespace (cluster admin)

Example for Bob:

```shell
oc create ns openshell-bob
oc adm policy add-scc-to-user privileged -z openshell-bob-sandbox -n openshell-bob
```

Create the signing secret required when the OpenShift values disable the chart
PKI job:

```shell
key_dir="$(mktemp -d)"
openssl genpkey -algorithm Ed25519 -out "${key_dir}/signing.pem"
openssl pkey -in "${key_dir}/signing.pem" -pubout -out "${key_dir}/public.pem"
printf 'openshell-0\n' > "${key_dir}/kid"
oc -n openshell-bob create secret generic openshell-bob-jwt-keys \
  --from-file=signing.pem="${key_dir}/signing.pem" \
  --from-file=public.pem="${key_dir}/public.pem" \
  --from-file=kid="${key_dir}/kid"
rm -rf "${key_dir}"
```

Deploy OpenShell with a unique release name:

```shell
helm install openshell-bob oci://ghcr.io/nvidia/openshell/helm-chart \
  --version 0.0.83 \
  -n openshell-bob \
  -f openshell/configs/openshell-values-openshift.yaml
```

> **PoC security warning:** the checked-in values disable gateway TLS and allow
> unauthenticated clients. Keep this ClusterIP private and use the setup only
> on an isolated evaluation cluster. The privileged SCC grant is scoped to the
> per-user OpenShell sandbox service account.

Verify:

```shell
oc wait --for=condition=Ready pod -l app.kubernetes.io/instance=openshell-bob -n openshell-bob --timeout=180s
oc get statefulset,svc,pod -n openshell-bob
```

Expected service DNS for Bob's OpenClaw install:

```text
http://openshell-bob.openshell-bob.svc.cluster.local:8080
```

## 3. Select the OpenClaw image

Use the current multi-arch OpenClaw `2026.7.1` UBI image:

```text
quay.io/sallyom/openclaw-openshell:latest
```

The `latest` tag supports `linux/amd64` and `linux/arm64`. It is an interim PoC
default; pin its manifest digest when reproducibility matters.

The installer injects the OpenShell CLI into the pod. Building
`openshell/Dockerfile` is optional and is not required for this flow.

## 4. Create the user's OpenClaw namespace

Create a normal application namespace for the user's OpenClaw instance. Example:

```shell
oc create ns openclaw-bob
```

If the cluster uses default-deny egress, apply a NetworkPolicy that allows
OpenClaw to reach the user's OpenShell gateway service.

## 5. Deploy OpenClaw with the installer (namespace owner)

Start the installer from `../claw-installer`:

```shell
./run.sh
```

In the UI:

- choose OpenShift
- set Project / Namespace to `openclaw-bob`
- set Image to the image from step 3, or rely on the OpenShell PoC default image
- use the normal provider credential flow
- enable the sandbox backend
- choose `OpenShell`
- set OpenShell Gateway Endpoint to
  `http://openshell-bob.openshell-bob.svc.cluster.local:8080`

The resulting config must include:

```json
{
  "agents": {
    "defaults": {
      "sandbox": {
        "mode": "all",
        "backend": "openshell",
        "scope": "session",
        "workspaceAccess": "rw"
      }
    }
  },
  "plugins": {
    "entries": {
      "openshell": {
        "enabled": true,
        "config": {
          "from": "quay.io/sallyom/openclaw-openshell:latest",
          "mode": "remote",
          "gatewayEndpoint": "http://openshell-bob.openshell-bob.svc.cluster.local:8080",
          "policy": "/home/node/.openclaw/openshell/policy.yaml",
          "timeoutSeconds": 180
        }
      }
    }
  }
}
```

Before testing an agent turn, verify the injected CLI:

```shell
oc exec -n openclaw-bob deployment/openclaw -c gateway -- \
  /openshell-bin/openshell --version
```

The OpenShell backend still uses SSH for command execution and file transfer,
but it does not SSH into the gateway. The plugin calls the configured HTTP
gateway endpoint for lifecycle operations and sandbox-specific SSH config.
OpenClaw then uses that config with `openshell ssh-proxy` as the SSH
`ProxyCommand`, tunneling through the gateway to the sandbox. No SSH key,
known-hosts entry, or static SSH target is entered in the installer for this
backend.

## 6. Verify the sandbox path

Open the OpenClaw route and run an agent turn that uses `exec`, for example:

```text
Run `pwd`, write the output to sandbox-proof.txt, then read it back.
```

Watch OpenShell create sandbox resources:

```shell
oc get pods -n openshell-bob -w
```

Inspect OpenClaw logs:

```shell
oc logs -n openclaw-bob deployment/openclaw -f
```

Inside OpenClaw, verify the backend:

```shell
openclaw sandbox list
openclaw sandbox explain
```

Expected result:

- OpenClaw remains deployed in `openclaw-bob`
- OpenShell sandbox pods appear in `openshell-bob`
- command execution output comes back through the OpenClaw UI

## 7. Repeat for another user

Repeat the namespace pair for each human user:

```text
openshell-<user>
openclaw-<user>
```

Update only:

- OpenShell namespace and Helm release name
- OpenClaw namespace
- OpenShell gateway endpoint
- OpenClaw image tag or digest, if testing a new build
- user-specific model credentials
