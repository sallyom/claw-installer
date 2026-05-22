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
- provide or approve the OpenClaw image that includes the OpenShell CLI at
  `/opt/openshell/bin/openshell`

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
- deploy OpenClaw with the approved CLI-bearing image
- choose the OpenShell sandbox backend only after the cluster admin has provided
  the user's OpenShell gateway endpoint
- set the OpenShell gateway endpoint in the installer
- use the normal provider credential flow for that user's OpenClaw instance

The installer installs the external `@openclaw/openshell-sandbox` plugin into
the PVC-backed OpenClaw home before gateway startup. The OpenShell CLI is baked
into the OpenClaw image; the installer no longer creates a separate OpenShell CLI
init container or `openshell-cli` volume.

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
- `oc`, `helm`, and `podman`
- access to push an OpenClaw image to a registry reachable by the cluster
- the `../openclaw`, `../claw-installer`, and `../OpenShell` repos checked out
- an OpenClaw image that includes `/opt/openshell/bin/openshell`

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
oc adm policy add-scc-to-user privileged -z default -n openshell-bob
```

Deploy OpenShell with a unique release name:

```shell
helm install openshell-bob oci://ghcr.io/nvidia/openshell/helm-chart \
  --version 0.0.44 \
  -n openshell-bob \
  -f openshell/configs/openshell-values-openshift.yaml \
  --set server.sandboxImage=quay.io/sallyom/openclaw-openshell-sandbox:latest
```

Verify:

```shell
oc wait --for=condition=Ready pod -l app.kubernetes.io/instance=openshell-bob -n openshell-bob --timeout=180s
oc get statefulset,svc,pod -n openshell-bob
```

Expected service DNS for Bob's OpenClaw install:

```text
http://openshell-bob.openshell-bob.svc.cluster.local:8080
```

## 3. Build the OpenClaw image

Build from checked-out `../openclaw`, then layer in the OpenShell CLI:

```shell
cd ../claw-installer
./openshell/build-openclaw-source-image.sh quay.io/<org>/openclaw:openshell
podman push quay.io/<org>/openclaw:openshell
```

For multi-arch farm builds, build the OpenClaw base first, capture its digest,
then use that digest as the base for the CLI-bearing image:

```shell
podman farm build \
  -f ../openclaw/Dockerfile \
  --build-arg OPENCLAW_EXTENSIONS=diagnostics-otel,codex \
  --build-arg OPENCLAW_IMAGE_APT_PACKAGES="openssh-client rsync" \
  ../openclaw

podman farm build \
  -f openshell/Dockerfile \
  --build-arg OPENCLAW_BASE_IMAGE=quay.io/<org>/openclaw@sha256:<base-digest> \
  .
```

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
npm run dev
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
          "command": "/opt/openshell/bin/openshell",
          "gateway": "openshell",
          "from": "quay.io/sallyom/openclaw-openshell-sandbox:latest",
          "mode": "mirror",
          "gatewayEndpoint": "http://openshell-bob.openshell-bob.svc.cluster.local:8080",
          "timeoutSeconds": 180
        }
      }
    }
  }
}
```

Before testing an agent turn, verify the baked CLI:

```shell
oc exec -n openclaw-bob deployment/openclaw -c gateway -- \
  /opt/openshell/bin/openshell --version
```

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
