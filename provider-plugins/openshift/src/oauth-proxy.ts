import * as k8s from "@kubernetes/client-node";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import jsYaml from "js-yaml";

// Resolve templates relative to this file's compiled location.
// At runtime this file is at provider-plugins/openshift/src/oauth-proxy.ts,
// templates are at ../templates/
const TEMPLATES_DIR = join(import.meta.dirname, "..", "templates");

function loadOpenshiftYaml(filename: string, vars: Record<string, string>): string {
  let content = readFileSync(join(TEMPLATES_DIR, filename), "utf-8");
  for (const [key, value] of Object.entries(vars)) {
    content = content.replaceAll(key, value);
  }
  return content;
}

export function oauthProxyContainer(ns: string): k8s.V1Container {
  const yaml = loadOpenshiftYaml("oauth-proxy-container.yaml", {
    __CLIENT_ID__: `system:serviceaccount:${ns}:openclaw-oauth-proxy`,
  });
  return jsYaml.load(yaml) as k8s.V1Container;
}

export function oauthServiceAccount(ns: string): k8s.V1ServiceAccount {
  const yaml = loadOpenshiftYaml("serviceaccount.yaml", {
    __NAMESPACE__: ns,
  });
  return jsYaml.load(yaml) as k8s.V1ServiceAccount;
}

export function oauthConfigSecret(ns: string): k8s.V1Secret {
  return {
    apiVersion: "v1",
    kind: "Secret",
    metadata: {
      name: "openclaw-oauth-config",
      namespace: ns,
      labels: { app: "openclaw" },
    },
    stringData: {
      cookie_secret: randomBytes(16).toString("hex"),
    },
  };
}
