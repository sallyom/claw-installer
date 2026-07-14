import * as k8s from "@kubernetes/client-node";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import jsYaml from "js-yaml";
import {
  MCP_APPS_OPENSHIFT_PROXY_PORT,
  MCP_APPS_SANDBOX_PORT,
} from "../../../src/server/deployers/mcp-apps.js";

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

export function mcpAppsSandboxProxyContainer(image: string): k8s.V1Container {
  const script = [
    "const http=require('node:http');",
    `const target='http://127.0.0.1:${MCP_APPS_SANDBOX_PORT}';`,
    "http.createServer(async(req,res)=>{",
    "try{",
    "const url=new URL(req.url||'/',target);",
    "if(url.pathname!=='/mcp-app-sandbox'||(req.method!=='GET'&&req.method!=='HEAD')){res.writeHead(404);res.end('Not Found');return}",
    "const upstream=await fetch(url,{method:req.method});",
    "res.writeHead(upstream.status,Object.fromEntries(upstream.headers));",
    "res.end(req.method==='HEAD'?undefined:Buffer.from(await upstream.arrayBuffer()));",
    "}catch{res.writeHead(502);res.end('Bad Gateway')}",
    `}).listen(${MCP_APPS_OPENSHIFT_PROXY_PORT},'0.0.0.0');`,
  ].join("");
  return {
    name: "mcp-apps-proxy",
    image,
    imagePullPolicy: "IfNotPresent",
    command: ["node", "-e", script],
    ports: [
      { name: "mcp-apps-proxy", containerPort: MCP_APPS_OPENSHIFT_PROXY_PORT, protocol: "TCP" },
    ],
    resources: {
      requests: { memory: "32Mi", cpu: "10m" },
      limits: { memory: "96Mi", cpu: "100m" },
    },
    securityContext: {
      allowPrivilegeEscalation: false,
      readOnlyRootFilesystem: true,
      capabilities: { drop: ["ALL"] },
    },
  };
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
