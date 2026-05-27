# Non-Cluster-Admin OpenShift Deployments

OpenClaw can be deployed by regular OpenShift users when the cluster allows
project self-provisioning. This is the preferred pilot setup: users create their
own OpenClaw projects, and OpenShift grants them admin rights inside projects
they create through the ProjectRequest flow.

## Pilot Project Self-Provisioning

Many OpenShift clusters already bind the built-in `self-provisioner`
ClusterRole to authenticated users. Verify as the pilot user:

```bash
oc auth can-i create projectrequests.project.openshift.io
```

If that returns `yes`, no extra cluster-admin RBAC is needed for project
creation.

If the cluster disables self-provisioning by default, a cluster-admin can bind
the pilot group explicitly:

```bash
oc adm groups new openclaw-pilot-users
oc adm groups add-users openclaw-pilot-users sallyom cooktheryan

sed -e 's/OPENCLAW_GROUP/openclaw-pilot-users/g' \
    provider-plugins/openshift/configs/openclaw-pilot-self-provisioner.yaml | oc apply -f -
```

This grants `create` on OpenShift `ProjectRequest` resources via the built-in
`self-provisioner` ClusterRole. It does not grant deploy permissions in every
existing namespace. The installer uses the OpenShift ProjectRequest API when it
needs to create a project, then deploys into that newly-created project using
the project-local permissions OpenShift gives the requester.

Verify:

```bash
oc auth can-i create projectrequests.project.openshift.io \
  --as=sallyom --as-group=openclaw-pilot-users
```

With GitHub IDP, the RoleBinding subject must be an OpenShift group name. If the
cluster only uses GitHub for login and org/team restrictions, create or sync an
OpenShift group for the pilot users first; RBAC will not expand a raw GitHub
team name unless it exists as an OpenShift/Kubernetes group.

## Permission Inventory

Required for a normal OpenShift deploy:

| API group | Resources | Why |
|-----------|-----------|-----|
| core | `serviceaccounts` | Create `openclaw-oauth-proxy` and, for non-A2A Kubernetes paths, `openclaw` |
| core | `serviceaccounts/token` | Create the OAuth proxy client secret from the ServiceAccount TokenRequest API |
| core | `secrets` | Store gateway token, provider credentials, OAuth proxy config, optional GCP credentials |
| core | `configmaps` | Store OpenClaw config and agent workspace files |
| core | `persistentvolumeclaims` | Create `openclaw-home-pvc` |
| core | `services` | Create and update the `openclaw` ClusterIP Service |
| apps | `deployments` | Create, update, patch, scale, restart, and delete the OpenClaw Deployment |
| route.openshift.io | `routes` | Create and delete the OpenShift Route |
| core | `pods`, `pods/log`, `pods/exec`, `pods/portforward` | Status, logs, pairing approval, and local port-forward access |

Optional feature permissions:

| Feature | Resources |
|---------|-----------|
| OpenTelemetry Operator sidecar | `opentelemetrycollectors.opentelemetry.io` |
| A2A/Kagenti | `agentcards.agent.kagenti.dev` plus a namespace label set by cluster admin ahead of time |
| Hardened SCC defaults | platform-managed SCC policy for service accounts |

Namespace deletion, CRD/operator installation, and hardened SCC changes remain
cluster-admin/platform setup.
