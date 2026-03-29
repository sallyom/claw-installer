# ADR 0002: Auto-approve Internal Device Pairing on OpenShift

## Status

Accepted

## Context

After deploying to OpenShift with a multi-agent bundle, the gateway's internal
client (the agent subprocess) creates an operator device pairing request on
startup. That request stays pending forever — nothing auto-approves it. This
blocks subagent delegation with `gateway closed (1008): pairing required`
(issue #69).

### Why auto-pairing doesn't work

The gateway normally auto-approves device pairing for localhost connections via
`shouldAllowSilentLocalPairing`. However, the OpenShift deployer sets
`gateway.trustedProxies: ["127.0.0.1", "::1"]` so the gateway correctly
handles `X-Forwarded-For` headers from the OAuth proxy sidecar.

This has a side effect: when the agent subprocess calls `callGateway()` to
spawn a subagent, it opens a WebSocket to the gateway at `127.0.0.1:18789`
**without** `X-Forwarded-For` headers (it's a direct connection, not proxied).
The gateway's `resolveClientIp()` sees the remote address is a trusted proxy,
looks for forwarding headers, finds none, and returns `undefined`. With an
undefined client IP, `shouldAllowSilentLocalPairing` returns `false` and the
pairing stays pending.

The `dangerouslyDisableDeviceAuth: true` flag does not help — it only bypasses
device identity checks for Control UI (operator-role) connections, not for
node-role connections like the agent subprocess.

### Why we can't just remove trustedProxies

Removing `trustedProxies` was attempted but causes a different failure: the
OAuth proxy forwards requests with `X-Forwarded-For` headers, and without
`trustedProxies` the gateway logs "Proxy headers detected from untrusted
address" and refuses to treat the connection as local. The Control UI gets
stuck at the gateway login screen.

Both the OAuth proxy and agent subprocess connect from `127.0.0.1`, but one
has proxy headers and one doesn't. The `trustedProxies` setting is necessary
for the OAuth proxy path.

## Decision

Keep `trustedProxies` and add a Kubernetes lifecycle `postStart` hook to the
gateway container that auto-approves the internal device pairing after the
gateway starts.

The hook:

1. Waits up to 30 seconds for the gateway to be listening on port 18789
2. Runs `openclaw devices approve --latest` to approve the pending pairing

This matches the manual fix that was verified to work on OpenShift (ROSA):
after running `openclaw devices approve --latest`, the gateway becomes
reachable and subagent delegation works immediately.

## Rationale

### The postStart hook is the right scope

- It runs once per pod start, which is exactly when the pairing request is
  created
- It runs inside the gateway container, so the `openclaw` CLI is available
- It runs concurrently with the main process, so there's minimal startup delay
- If it fails (gateway takes too long to start), the `|| true` prevents the
  container from crashing — the pairing just stays pending as before

### Alternatives considered

**Remove `trustedProxies`** — Breaks the OAuth proxy connection path. The
gateway rejects proxy headers from untrusted addresses.

**`allowRealIpFallback: true`** — A gateway config option that falls back to
the socket address when `X-Forwarded-For` is missing from a trusted proxy.
This would be the cleanest fix but depends on the gateway version supporting
this option, which is not guaranteed across all deployments.

**Separate listener** — Bind the gateway on two ports: one for the OAuth proxy
(with proxy trust), one for the agent subprocess (without). This is a larger
architectural change than needed for this bug.

**Switch to `auth.mode: "trusted-proxy"`** — Fully delegate auth to the OAuth
proxy. Requires the OAuth proxy to pass user identity headers and the gateway
to be configured with `auth.trustedProxy.userHeader`. A bigger change that
also modifies the auth model.

## Consequences

### Positive

- Subagent spawning works on OpenShift without manual intervention
- No changes to the gateway config or auth model
- The fix is self-contained in the Deployment patch
- If the gateway adds native support for `allowRealIpFallback` or similar,
  the postStart hook can be removed without other changes

### Negative

- Adds a timing dependency: the postStart hook must complete before the
  gateway's readiness probe timeout. The 30-second retry loop and the
  readiness probe's 30-second `initialDelaySeconds` should provide enough
  margin.
- The `openclaw devices approve --latest` command approves the most recent
  pending pairing request. In a single-pod deployment this is always the
  gateway's internal client, but the approach assumes no other pending
  requests exist at startup.
