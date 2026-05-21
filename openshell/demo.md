# Demo: Many OpenClaws on OpenShift with OpenShell Sandboxes

This runbook proves the target platform shape:

- cluster admin prepares OpenShell once per user namespace
- each user gets a normal OpenClaw app namespace
- OpenClaw uses `@openclaw/openshell-sandbox` for command execution
- OpenShell creates the actual sandbox runtime pods

## Prerequisites

- OpenShift cluster access
- `oc`, `helm`, and `podman`
- access to push an OpenClaw image to a registry reachable by the cluster
- an admin-provided NVIDIA OpenShell CLI mount at `/opt/openshell/bin/openshell`
  in the OpenClaw gateway container
- the `../openclaw`, `../claw-installer`, and `../OpenShell` repos checked out

## 1. Install OpenShell cluster prerequisites

Install the Agent Sandbox CRDs/controller once per cluster:

```shell
kubectl apply -f https://github.com/kubernetes-sigs/agent-sandbox/releases/latest/download/manifest.yaml
```

## 2. Create Alice's OpenShell namespace

```shell
oc apply -f openshell/configs/openshell-namespace.yaml
oc adm policy add-scc-to-user privileged -z default -n openshell-alice
```

Deploy OpenShell into Alice's namespace:

```shell
helm install openshell oci://ghcr.io/nvidia/openshell/helm-chart \
  --version <version> \
  -n openshell-alice \
  -f openshell/configs/openshell-values-openshift.yaml
```

Verify:

```shell
oc get pods -n openshell-alice
oc get svc -n openshell-alice
```

Expected service DNS for OpenClaw:

```text
http://openshell.openshell-alice.svc.cluster.local:8080
```

## 3. Build the OpenClaw image

Fast smoke-test path from the published beta:

```shell
cd ../claw-installer
podman build -t quay.io/<org>/openclaw-openshell:2026.5.19-beta.2 -f openshell/Dockerfile .
podman push quay.io/<org>/openclaw-openshell:2026.5.19-beta.2
```

Local-source path from `../openclaw`:

```shell
cd ../claw-installer
./openshell/build-openclaw-source-image.sh quay.io/<org>/openclaw-openshell:local
podman push quay.io/<org>/openclaw-openshell:local
```

Use the local-source path for the main PoC. The beta-derived image is useful
only for smoke tests when the base image already has the OpenShell plugin
available.

Do not install the OpenShell CLI into this image for the PoC. The OpenClaw
plugin expects the real NVIDIA OpenShell CLI to be mounted at
`/opt/openshell/bin/openshell`.

## 4. Create Alice's OpenClaw namespace

Edit [configs/openclaw-namespace-rbac.yaml](configs/openclaw-namespace-rbac.yaml)
for the user and apply it:

```shell
oc apply -f openshell/configs/openclaw-namespace-rbac.yaml
```

If the cluster uses default-deny egress, also edit and apply the NetworkPolicy:

```shell
oc apply -f openshell/configs/networkpolicy-openclaw-to-openshell.yaml
```

## 5. Deploy OpenClaw with the installer

Start the installer from `../claw-installer`:

```shell
npm run dev
```

In the UI:

- choose OpenShift
- set Project / Namespace to `openclaw-alice`
- set Image to the image from step 3
- use the normal provider credential flow
- enable the sandbox backend
- choose `OpenShell`
- set OpenShell Gateway Endpoint to `http://openshell.openshell-alice.svc.cluster.local:8080`
- confirm the platform has mounted the OpenShell CLI at
  `/opt/openshell/bin/openshell`

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
          "from": "openclaw",
          "mode": "mirror",
          "gatewayEndpoint": "http://openshell.openshell-alice.svc.cluster.local:8080",
          "timeoutSeconds": 180
        }
      }
    }
  }
}
```

Restart OpenClaw after changing the ConfigMap:

```shell
oc rollout restart deployment/openclaw -n openclaw-alice
oc rollout status deployment/openclaw -n openclaw-alice
```

Before testing an agent turn, verify the mounted CLI:

```shell
oc exec -n openclaw-alice deployment/openclaw -c gateway -- \
  /opt/openshell/bin/openshell --version
```

## 6. Verify the sandbox path

Open the OpenClaw route and run an agent turn that uses `exec`, for example:

```text
Run `pwd`, write the output to sandbox-proof.txt, then read it back.
```

Watch OpenShell create sandbox resources:

```shell
oc get pods -n openshell-alice -w
```

Inspect OpenClaw logs:

```shell
oc logs -n openclaw-alice deployment/openclaw -f
```

Inside OpenClaw, verify the backend:

```shell
openclaw sandbox list
openclaw sandbox explain
```

Expected result:

- OpenClaw remains deployed in `openclaw-alice`
- OpenShell sandbox pods appear in `openshell-alice`
- command execution output comes back through the OpenClaw UI

## 7. Repeat for another user

Repeat the namespace pair for Bob:

```text
openshell-bob
openclaw-bob
```

Update only:

- namespace names
- OpenShell gateway endpoint
- OpenClaw image tag, if testing a new build
- user-specific model credentials

## Remaining installer gaps

The installer now renders the OpenClaw sandbox/plugin config for OpenShell. The
remaining PoC gaps are:

- OpenClaw image override defaulting to the image built in this directory
- Kubernetes/OpenShift generation for the platform-provided OpenShell CLI mount
- optional `openshellPolicy` and `openshellProviders` fields
- secured OpenShell gateway auth material, if the gateway is not plaintext local

Until then, this runbook keeps the remaining platform steps explicit.
