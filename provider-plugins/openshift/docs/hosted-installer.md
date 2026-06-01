# Hosted OpenClaw Installer on OpenShift

This mode runs one shared installer route and uses OpenShift OAuth to act as the
current browser user for cluster operations.

## Deploy the Installer

Build and push a regular container image first. The OpenShift template deploys
that image directly; it does not create an ImageStream, BuildConfig, or
in-cluster build.

```bash
podman build -t quay.io/sallyom/openclaw-installer:latest -f Dockerfile .
podman push quay.io/sallyom/openclaw-installer:latest

APPS_DOMAIN="$(oc get ingress.config.openshift.io cluster -o jsonpath='{.spec.domain}')"
oc process -f provider-plugins/openshift/configs/hosted-installer-template.yaml \
  -p APPS_DOMAIN="${APPS_DOMAIN}" \
  -p INSTALLER_IMAGE=quay.io/sallyom/openclaw-installer:latest \
  | oc apply -f -
oc rollout restart deployment/openclaw-installer -n openclaw-installer
oc rollout status deployment/openclaw-installer -n openclaw-installer
```

The template creates the `openclaw-installer` namespace, OAuthClient,
ServiceAccount, OAuth-protected Deployment, Service, and Route. The installer
container image defaults to `quay.io/sallyom/openclaw-installer:latest` and can
be overridden with `-p INSTALLER_IMAGE=...`. Rebuild and push the image when you
update the installer, then restart the Deployment so it pulls the new image.

## Provider Secrets

For hosted installs, users should create provider credentials as a Secret in the
same namespace where their OpenClaw instance will run. If the namespace does not
exist yet, create it first with `oc new-project <namespace>`.

The hosted form checks the selected namespace for `openclaw-provider-secrets`
and warns before deploy when the Secret is missing or unreadable.

```bash
oc create secret generic openclaw-provider-secrets \
  -n sallyom-demo-openclaw \
  --from-literal=ANTHROPIC_API_KEY=sk-ant-... \
  --from-literal=OPENAI_API_KEY=sk-... \
  --from-literal=GEMINI_API_KEY=AIza... \
  --from-literal=OPENROUTER_API_KEY=sk-or-...
```

Then set **External Secret Providers -> OpenShift Provider Secret Name** to:

```text
openclaw-provider-secrets
```

The installer mounts that Secret into the OpenClaw pod as environment variables
and configures selected providers to resolve credentials through SecretRefs.

For OpenAI Codex OAuth, add the Codex CLI `auth.json` content to the same
Secret:

```bash
oc create secret generic openclaw-provider-secrets \
  -n sallyom-demo-openclaw \
  --from-file=OPENAI_CODEX_AUTH_JSON=$HOME/.codex/auth.json
```

For Google Vertex AI, add the service account JSON content and, optionally, the
project and location:

```bash
oc create secret generic openclaw-provider-secrets \
  -n sallyom-demo-openclaw \
  --from-file=GOOGLE_APPLICATION_CREDENTIALS_JSON=/path/to/service-account.json \
  --from-literal=GOOGLE_CLOUD_PROJECT=my-gcp-project \
  --from-literal=GOOGLE_CLOUD_LOCATION=us-east5
```

Use `us-east5` for Claude on Vertex unless your GCP setup uses another region.

For 1Password SecretRefs, create a service account token Secret in the target
namespace and enable **External Secret Providers -> Configure 1Password
SecretRefs**:

```bash
oc create secret generic openclaw-1password-token \
  -n sallyom-demo-openclaw \
  --from-literal=OP_SERVICE_ACCOUNT_TOKEN=ops_...
```

The generated SecretRef ids use the selected 1Password vault and item names
such as `op://OpenClaw/OpenRouter/credential`.
